import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative as relativePath, resolve as resolvePath } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { AdapterContext } from "../../codegen/adapter.js";
import { verifyGateEnvironment } from "../../codegen/environment.js";
import type { GateRunReport } from "../../codegen/gate-output.js";
import { formatGateReport } from "../../codegen/gate-report.js";
import { runGates as defaultRunGates } from "../../codegen/gate-runner.js";
import { reactAdapter } from "../../codegen/react/adapter.js";
import { scaffoldComponent } from "../../codegen/react/scaffold.js";
import { hasStorybook } from "../../codegen/react/storybook-detect.js";
import { defaultConfig } from "../../config/schema.js";
import {
  getRegistry,
  initRegistryDb,
  listDesignOnlyComponents,
  upsertRegistry,
} from "../../db/registry-db.js";
import { openDb } from "../../db/sqlite.js";
import { autoCommit } from "../../git/auto-commit.js";
import { newScreenSpec } from "../../spec/schema.js";
import { type ComponentJson, ComponentJsonSchema } from "../../sync/component-shape.js";
import { pascalCase } from "../../util/ids.js";
import {
  designSystemDir,
  registryDbPath,
  uiComponentFile,
  uiDir,
  uiStoryFile,
} from "../../util/paths.js";
import { KotikitError, toolError, toolText } from "../../util/result.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RegisterScaffoldToolsOpts {
  /** For tests. If omitted, the real gate runner is used. */
  gateRunner?: typeof defaultRunGates;
}

// ─── Registrar ────────────────────────────────────────────────────────────────

export function registerScaffoldTools(
  registry: ToolRegistry,
  ctx: ToolContext,
  opts: RegisterScaffoldToolsOpts = {}
): void {
  registerScaffoldStart(registry, ctx);
  registerScaffoldSave(registry, ctx, opts);
}

// ─── Compact dsJson shape ─────────────────────────────────────────────────────

interface CompactComponentJson {
  name: string;
  key: string;
  variants: { propertyName: string; values: string[] }[];
  propertyNames: string[];
}

function toCompactJson(json: ComponentJson): CompactComponentJson {
  return {
    name: json.name,
    key: json.key,
    variants: json.variants,
    propertyNames: Object.keys(json.properties),
  };
}

// ─── kotikit_scaffold_start ──────────────────────────────────────────────────

function registerScaffoldStart(registry: ToolRegistry, ctx: ToolContext): void {
  const tool: Tool = {
    name: "kotikit_scaffold_start",
    description:
      "Scaffold DS components into React. Returns up to pageSize (default 3) component skeletons per page — call with cursor=nextCursor for the next page. " +
      "systemPromptRef points at the React doctrine; call kotikit_get_system_prompt({kind:'scaffold'}) once per session to fetch it. " +
      "Default compact dsJson is sufficient for codegen; pass compact: false only if you need the full DS metadata.",
    inputSchema: {
      type: "object",
      properties: {
        names: {
          type: "array",
          items: { type: "string" },
          description: "Component names to scaffold. Omit to scaffold all design-only components.",
        },
        pageSize: {
          type: "number",
          description: "Max components per page (default 3, clamped to [1, 10]).",
        },
        cursor: {
          type: "string",
          description:
            "Name of the last component from the previous page. Pass to get the next page.",
        },
        compact: {
          type: "boolean",
          description:
            "When true (default), each component's dsJson is stripped to {name, key, variants, propertyNames}. Set false for the full ComponentJson.",
        },
        expand: {
          type: "boolean",
          description: "Reserved for future use. Currently the inverse of compact.",
        },
      },
    },
  };

  registry.tools.push(tool);

  registry.handlers.set("kotikit_scaffold_start", async (args) => {
    const {
      names,
      pageSize: rawPageSize,
      cursor,
      compact: rawCompact,
      expand: rawExpand,
    } = args as {
      names?: string[];
      pageSize?: number;
      cursor?: string;
      compact?: boolean;
      expand?: boolean;
    };
    const root = ctx.root;

    // Resolve pagination + compact defaults
    const pageSize = Math.min(
      10,
      Math.max(1, typeof rawPageSize === "number" ? Math.floor(rawPageSize) : 3)
    );
    // compact defaults true; expand defaults false (inverse of compact)
    const compact = rawExpand === true ? false : rawCompact !== undefined ? rawCompact : true;

    try {
      // 1. Load config (default if missing)
      const config = (await ctx.loadConfig()) ?? defaultConfig();

      // 2. Check registry exists
      const regPath = registryDbPath(root);
      if (!existsSync(regPath)) {
        return toolError(new KotikitError("No registry yet.", "Run sync_ds first to populate it."));
      }

      // 3. Open registry (write mode so initRegistryDb migration can run if needed; it's idempotent)
      const db = openDb(regPath);
      initRegistryDb(db);

      // 4. List design-only components and sort alphabetically (case-insensitive)
      const allRows = listDesignOnlyComponents(db, names);
      db.close();

      if (allRows.length === 0) {
        return toolError(
          new KotikitError(
            "There are no design-only components to scaffold.",
            "Run sync_ds first, or check that the names match what's in your registry."
          )
        );
      }

      // Sort alphabetically, case-insensitive
      allRows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

      // Apply cursor: skip components whose name <= cursor
      const afterCursor = cursor
        ? allRows.filter((r) => r.name.localeCompare(cursor) > 0)
        : allRows;

      // Take the current page
      const rows = afterCursor.slice(0, pageSize);
      const totalRemaining = Math.max(0, afterCursor.length - rows.length);
      const hasMore = afterCursor.length > rows.length;
      const lastRow = rows.at(-1);
      const nextCursor = hasMore && lastRow !== undefined ? lastRow.name : undefined;

      // 5. Read DS JSON for each row; track skipped
      const dsDir = designSystemDir(root);
      type ComponentEntry = {
        row: (typeof rows)[0];
        json: ComponentJson;
      };
      const entries: ComponentEntry[] = [];
      const skipped: { name: string; reason: string }[] = [];

      for (const row of rows) {
        if (!row.dsPath) {
          skipped.push({ name: row.name, reason: "No ds_path set in registry." });
          continue;
        }
        const jsonPath = `${dsDir}/${row.dsPath}`;
        if (!existsSync(jsonPath)) {
          skipped.push({ name: row.name, reason: `Component JSON not found at ${row.dsPath}.` });
          continue;
        }
        try {
          const raw = JSON.parse(await readFile(jsonPath, "utf-8"));
          const parsed = ComponentJsonSchema.safeParse(raw);
          if (!parsed.success) {
            skipped.push({ name: row.name, reason: "Component JSON failed validation." });
            continue;
          }
          entries.push({ row, json: parsed.data });
        } catch {
          skipped.push({ name: row.name, reason: "Failed to read component JSON." });
        }
      }

      if (entries.length === 0 && skipped.length > 0) {
        // All were skipped — this isn't a hard error; fall through to return skipped info.
        // But we still need something to scaffold. Return success with empty components + skipped.
      }

      // 6. Verify gate environment
      const envReport = await verifyGateEnvironment({
        root,
        adapter: reactAdapter,
        testFramework: config.project.testFramework,
      });
      if (!envReport.ok) {
        const hint = `Install the missing tools:${envReport.missing
          .map((m) => `\n  • ${m.hint}`)
          .join("")}`;
        return toolError(
          new KotikitError("Some required gate tools aren't installed in your project.", hint)
        );
      }

      // 7. Detect Storybook
      const hasSb = await hasStorybook(root);

      // 8. Build per-component scaffold shapes + target paths
      type ComponentOutput = {
        name: string;
        kebabName: string;
        targetPath: string;
        storyPath?: string;
        dsJson: ComponentJson;
        scaffoldShape: { tsx: string; stories?: string };
      };

      const components: ComponentOutput[] = [];

      for (const { json } of entries) {
        const result = scaffoldComponent(
          { json, hasStorybook: hasSb },
          config.project.codeComponentsDir
        );
        const kebabName = result.kebabName;

        // Paths are relative (e.g. "src/components/ui/button.tsx")
        const absTarget = uiComponentFile(root, config.project.codeComponentsDir, kebabName);
        const targetPath = relativePath(root, absTarget);
        const storyPath = hasSb
          ? relativePath(root, uiStoryFile(root, config.project.codeComponentsDir, kebabName))
          : undefined;

        const scaffoldShape: { tsx: string; stories?: string } = {
          tsx: result.files[0]?.content ?? "",
        };
        if (hasSb && result.files[1]) {
          scaffoldShape.stories = result.files[1].content;
        }

        components.push({
          name: result.componentName,
          kebabName,
          targetPath,
          storyPath,
          dsJson: json,
          scaffoldShape,
        });
      }

      // 9. Apply compact mode to dsJson and build response components
      const responseComponents = components.map((c) => ({
        ...c,
        dsJson: compact ? toCompactJson(c.dsJson) : c.dsJson,
      }));

      // 10. System prompt stub (full prompt available via kotikit_get_system_prompt)
      const systemPrompt =
        "For the full React adapter prompt, call kotikit_get_system_prompt({ kind: 'scaffold' }).";

      const n = responseComponents.length;
      return toolText(`Ready to scaffold ${n} component${n !== 1 ? "s" : ""}.`, {
        components: responseComponents,
        nextCursor,
        hasMore,
        totalRemaining,
        systemPromptRef: "react",
        systemPrompt,
        hasStorybook: hasSb,
        skipped,
        testFramework: config.project.testFramework,
      });
    } catch (err) {
      if (err instanceof KotikitError) return toolError(err);
      return toolError(err);
    }
  });
}

// ─── kotikit_scaffold_save ────────────────────────────────────────────────────

function registerScaffoldSave(
  registry: ToolRegistry,
  ctx: ToolContext,
  opts: RegisterScaffoldToolsOpts
): void {
  const tool: Tool = {
    name: "kotikit_scaffold_save",
    description:
      "Write the refined scaffold files, run gates once on the batch, then commit and mark each component synced.",
    inputSchema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["path", "content"],
          },
        },
      },
      required: ["files"],
    },
  };

  registry.tools.push(tool);

  registry.handlers.set("kotikit_scaffold_save", async (args) => {
    const { files } = args as { files: { path: string; content: string }[] };
    const root = ctx.root;
    const runGates = opts.gateRunner ?? defaultRunGates;

    try {
      // 1. Load config
      const config = (await ctx.loadConfig()) ?? defaultConfig();

      // 2. Validate all paths — must resolve inside uiDir
      const targetUiDir = uiDir(root, config.project.codeComponentsDir);
      const resolvedFiles: { absolute: string; content: string }[] = [];

      for (const file of files) {
        const absolute = resolvePath(file.path);
        const rel = relativePath(targetUiDir, absolute);
        if (rel.startsWith("..") || rel.startsWith("/")) {
          return toolError(
            new KotikitError(
              "That file path is outside your scaffold directory.",
              `Scaffold files must live under ${config.project.codeComponentsDir}/ui/.`
            )
          );
        }
        resolvedFiles.push({ absolute, content: file.content });
      }

      // 3. Determine create vs update (check BEFORE writing)
      const anyNew = resolvedFiles.some((f) => !existsSync(f.absolute));
      const writeKind: "create" | "update" = anyNew ? "create" : "update";

      // 4. Write all files
      for (const { absolute, content } of resolvedFiles) {
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, content, "utf-8");
      }

      const filePaths = resolvedFiles.map((f) => f.absolute);

      // 5. Build AdapterContext fixture for the gate runner.
      // The qualityGates() definition doesn't actually consult the spec content —
      // gates are file-driven. We use a placeholder spec so the adapter types are satisfied.
      const fakeSpec = newScreenSpec({ title: "Scaffold", description: "Batch scaffold." });
      const adapterCtx: AdapterContext = {
        root,
        config,
        spec: fakeSpec,
        dsComponents: {},
      };

      // 6. Run gates ONCE across the entire batch
      const report: GateRunReport = await runGates({
        root,
        adapter: reactAdapter,
        ctx: adapterCtx,
        files: filePaths,
      });

      // 7. Gate failure — files stay on disk, no commit, no registry upsert
      if (!report.passed) {
        const gateMsg = formatGateReport(report);
        return {
          content: [
            {
              type: "text",
              text: `${gateMsg}\n\nFix the failures in the written files and call scaffold_save again with the corrected content.\n\n${JSON.stringify({ report }, null, 2)}`,
            },
          ],
          isError: true,
        };
      }

      // 8. Gates passed — open registry, upsert each component as synced
      const regDb = openDb(registryDbPath(root));
      initRegistryDb(regDb);

      // Extract component names from .tsx files (NOT .stories.tsx)
      const componentPaths = resolvedFiles.filter(
        (f) => f.absolute.endsWith(".tsx") && !f.absolute.endsWith(".stories.tsx")
      );

      const upsertedNames: string[] = [];

      for (const { absolute } of componentPaths) {
        const fileName = absolute.split("/").pop() ?? "";
        // "button.tsx" → "Button", "pie-chart-3d.tsx" → "PieChart3D"
        const kebabName = fileName.replace(/\.tsx$/, "");
        const componentName = pascalCase(kebabName);

        const relCodePath = relativePath(root, absolute);

        // Preserve dsPath if already set by sync
        const existing = getRegistry(regDb, "component", componentName);
        upsertRegistry(regDb, {
          kind: "component",
          name: componentName,
          dsPath: existing?.dsPath ?? null,
          codePath: relCodePath,
          status: "synced",
        });

        upsertedNames.push(componentName);
      }

      regDb.close();

      // 9. Build commit subject suffix
      const sorted = [...upsertedNames].sort();
      let subjectSuffix: string;
      if (sorted.length === 1) {
        subjectSuffix = ` (${sorted[0]})`;
      } else if (sorted.length <= 5) {
        subjectSuffix = ` (${sorted.join(", ")})`;
      } else {
        subjectSuffix = ` (${sorted.length} components)`;
      }

      // 10. Auto-commit: all written files + registry db
      const commitResult = await autoCommit({
        root,
        scope: "scaffold",
        kind: writeKind,
        files: [...filePaths, registryDbPath(root)],
        enabled: config.git.autoCommit,
        coAuthor: config.git.coAuthor,
        subjectScope: "code",
        subjectSuffix,
      });

      const n = upsertedNames.length;
      return toolText(
        `Scaffolded ${n} component${n !== 1 ? "s" : ""}. All gates passed. ${commitResult.message}.`,
        { report, commit: commitResult, paths: filePaths }
      );
    } catch (err) {
      if (err instanceof KotikitError) return toolError(err);
      return toolError(err);
    }
  });
}
