import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { existsSync } from "fs";
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, resolve as resolvePath, relative as relativePath } from "path";

import { defaultConfig } from "../../config/schema.js";
import { readScreenSpec, writeScreenSpec, readFlowManifest } from "../../spec/engine.js";
import { generateCodePlan } from "../../planning/code-planner.js";
import { writeCodePlan, readCodePlan } from "../../planning/plan-store.js";
import { reactAdapter } from "../../codegen/react/adapter.js";
import { runGates as defaultRunGates } from "../../codegen/gate-runner.js";
import { verifyGateEnvironment } from "../../codegen/environment.js";
import { autoCommitCode } from "../../codegen/code-commit.js";
import { formatGateReport } from "../../codegen/gate-report.js";
import { openDb } from "../../db/sqlite.js";
import { initRegistryDb, upsertRegistry, searchRegistry } from "../../db/registry-db.js";
import { ComponentJsonSchema, type ComponentJson } from "../../sync/component-shape.js";
import { searchComponents } from "../../db/components-db.js";
import { Database } from "bun:sqlite";

import {
  componentsDbPath,
  componentJsonPath,
  designSystemDir,
  registryDbPath,
  codeComponentDir,
  codeComponentFile,
} from "../../util/paths.js";
import { nowIso } from "../../util/ids.js";
import { toolText, toolError, KotikitError } from "../../util/result.js";
import type { AdapterContext, GateKind } from "../../codegen/adapter.js";

// ─── Stub system prompt text ──────────────────────────────────────────────────

const SYSTEM_PROMPT_STUB =
  "For the full React adapter prompt, call kotikit_get_system_prompt({ kind: 'react' }). Append this screen's context below.";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RegisterImplementCodeToolsOpts {
  /** For tests. If omitted, the real gate runner is used. */
  gateRunner?: typeof defaultRunGates;
}

// ─── Registrar ────────────────────────────────────────────────────────────────

export function registerImplementCodeTools(
  registry: ToolRegistry,
  ctx: ToolContext,
  opts: RegisterImplementCodeToolsOpts = {}
): void {
  registerStart(registry, ctx);
  registerSave(registry, ctx, opts);
  registerGate(registry, ctx, opts);
}

// ─── kotikit_implement_code_start ─────────────────────────────────────────────

function registerStart(registry: ToolRegistry, ctx: ToolContext): void {
  const tool: Tool = {
    name: "kotikit_implement_code_start",
    description:
      "Gather the context bundle for writing code for one screen. " +
      "Default response returns componentRefs (name + path + key) — " +
      "call kotikit_ds_get_component({path}) for each ref whose JSON you need before generating code. " +
      "systemPromptRef points at the React doctrine; call kotikit_get_system_prompt({kind:'react'}) once per session to fetch it. " +
      "Pass expand: true to inline all DS component JSONs in this response instead (uses more tokens).",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string" },
        screen: { type: "string" },
        expand: { type: "boolean" },
      },
      required: ["scope"],
    },
  };

  registry.tools.push(tool);

  registry.handlers.set("kotikit_implement_code_start", async (args) => {
    const { scope, screen: screenArg, expand = false } = args as { scope: string; screen?: string; expand?: boolean };
    const screen = screenArg ?? null;
    const root = ctx.root;

    try {
      // 1. Load config (default if missing)
      const config = (await ctx.loadConfig()) ?? defaultConfig();

      // 2. Read screen spec — friendly error if missing
      let spec: Awaited<ReturnType<typeof readScreenSpec>>;
      try {
        spec = await readScreenSpec(root, scope, screen);
      } catch (err) {
        if (err instanceof KotikitError) return toolError(err);
        return toolError(
          new KotikitError(
            `I couldn't find the spec for "${screen ?? scope}".`,
            "Check the scope and screen names, or use spec_list to see what exists."
          )
        );
      }

      // 3. Try flow manifest (optional)
      let flowManifest: Awaited<ReturnType<typeof readFlowManifest>> | undefined;
      try {
        flowManifest = await readFlowManifest(root, scope);
      } catch {
        flowManifest = undefined;
      }

      // 4. Verify gate environment — fail loudly if missing
      const envReport = await verifyGateEnvironment({
        root,
        adapter: reactAdapter,
        testFramework: config.project.testFramework,
      });
      if (!envReport.ok) {
        const hintList = envReport.missing
          .map((m) => `- ${m.hint}`)
          .join("\n");
        return toolError(
          new KotikitError(
            "Some required gate tools aren't installed in your project.",
            `Install the following before generating code:\n${hintList}`
          )
        );
      }

      // 5. Read or generate the code plan
      let plan = await readCodePlan(root, scope, screen);
      if (plan === null) {
        plan = generateCodePlan({ root, scope, screen, spec, flowManifest, config });
        await writeCodePlan(root, scope, screen, plan);
      }

      // 6. Load DS component JSONs (always loaded; returned inline or as refs based on `expand`)
      const dsComponents: Record<string, ComponentJson> = {};
      const dsDir = designSystemDir(root);
      const dbPath = componentsDbPath(root);

      // Track path + key per component so we can build refs
      const dsComponentMeta: Record<string, { path: string; key: string }> = {};

      if (existsSync(dsDir)) {
        // Try to search each dsRef in components.db first, then fall back to componentJsonPath
        for (const dsRef of plan.dsComponentRefs) {
          try {
            if (existsSync(dbPath)) {
              const db = new Database(dbPath, { readonly: true });
              try {
                const hits = searchComponents(db, dsRef.name, 1);
                if (hits.length > 0) {
                  const hit = hits[0]!;
                  const jsonPath = `${dsDir}/${hit.path}`;
                  if (existsSync(jsonPath)) {
                    const raw = JSON.parse(await readFile(jsonPath, "utf-8"));
                    const parsed = ComponentJsonSchema.safeParse(raw);
                    if (parsed.success) {
                      dsComponents[dsRef.name] = parsed.data;
                      dsComponentMeta[dsRef.name] = {
                        path: hit.path,
                        key: parsed.data.key,
                      };
                      continue;
                    }
                  }
                }
              } finally {
                db.close();
              }
            }
            // Fallback: try componentJsonPath
            const slug = dsRef.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
            const fallbackPath = componentJsonPath(root, slug);
            if (existsSync(fallbackPath)) {
              const raw = JSON.parse(await readFile(fallbackPath, "utf-8"));
              const parsed = ComponentJsonSchema.safeParse(raw);
              if (parsed.success) {
                dsComponents[dsRef.name] = parsed.data;
                dsComponentMeta[dsRef.name] = {
                  path: `components/${slug}.json`,
                  key: parsed.data.key,
                };
              }
            }
          } catch {
            // Skip silently on any failure
          }
        }
      }
      // If design-system doesn't exist, dsComponents stays {}

      // 7. Query registry for hits matching plan.dsComponentRefs names
      const registryHits: { name: string; codePath: string; status: string }[] = [];
      const regDbPath = registryDbPath(root);
      if (existsSync(regDbPath)) {
        const regDb = new Database(regDbPath, { readonly: true });
        try {
          for (const dsRef of plan.dsComponentRefs) {
            const hits = searchRegistry(regDb, { query: dsRef.name, limit: 5 });
            for (const h of hits) {
              if (!registryHits.some((r) => r.name === h.name)) {
                registryHits.push({ name: h.name, codePath: h.codePath ?? "", status: h.status });
              }
            }
          }
        } finally {
          regDb.close();
        }
      }

      // 8. Compute target paths
      const componentName = plan.componentName;
      const componentTargetPath = codeComponentFile(
        root,
        config.project.codeComponentsDir,
        scope,
        reactAdapter.fileNameFor(componentName, "component")
      );
      const testTargetPath = plan.testPath
        ? codeComponentFile(
            root,
            config.project.codeComponentsDir,
            scope,
            reactAdapter.fileNameFor(componentName, "test")
          )
        : undefined;

      // 9. Build the AdapterContext, then call testScaffold
      const adapterCtx: AdapterContext = {
        root,
        config,
        spec,
        flowManifest,
        dsComponents,
      };

      const testScaffold = reactAdapter.testScaffold(adapterCtx);

      // 10. Build per-screen context (spec excerpt only — no §7 baseline preamble)
      const breakpoints = config.defaults.breakpoints;
      const themes = config.defaults.themes;
      const dsComponentNames = Object.keys(dsComponents);

      // For specs with no loaded DS components, include names from spec.components
      const allDsNames =
        dsComponentNames.length > 0
          ? dsComponentNames
          : (spec.components ?? []).map((c: { name: string }) => c.name);

      const screenContextLines: string[] = [];
      screenContextLines.push(`## Screen: ${spec.title}`);
      screenContextLines.push(`**Description:** ${spec.context.description}`);
      if (spec.requirements.functional.length > 0) {
        screenContextLines.push("**Functional requirements:** " + spec.requirements.functional.join("; "));
      }
      const stateEntries = Object.entries(spec.requirements.states);
      if (stateEntries.length > 0) {
        screenContextLines.push("**States:** " + stateEntries.map(([k, v]) => `${k}: ${v}`).join("; "));
      }
      if (spec.acceptanceCriteria.length > 0) {
        screenContextLines.push("**Acceptance criteria:** " + spec.acceptanceCriteria.join("; "));
      }
      screenContextLines.push(`**Breakpoints (px):** ${breakpoints.join(", ")}`);
      screenContextLines.push(`**Themes:** ${themes.join(", ")}`);
      if (allDsNames.length > 0) {
        screenContextLines.push("**Available DS components:** " + allDsNames.join(", "));
      }
      if (flowManifest) {
        screenContextLines.push(`**Part of flow:** ${flowManifest.title}`);
      }
      const screenContext = screenContextLines.join("\n");

      // 11. Build the component refs or full dsComponents depending on `expand`
      type ComponentRef = { name: string; path: string; key: string };
      const componentRefs: ComponentRef[] = plan.dsComponentRefs.map((dsRef) => {
        const meta = dsComponentMeta[dsRef.name];
        return {
          name: dsRef.name,
          path: meta?.path ?? `components/${dsRef.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`,
          key: meta?.key ?? (dsRef.dsKey ?? ""),
        };
      });

      // 12. Return context bundle
      const baseDetail = {
        componentName,
        targetPath: componentTargetPath,
        testPath: testTargetPath,
        systemPromptRef: "react" as const,
        systemPrompt: SYSTEM_PROMPT_STUB,
        screenContext,
        spec,
        flow: flowManifest,
        config: {
          breakpoints,
          themes,
          codeComponentsDir: config.project.codeComponentsDir,
        },
        registryHits,
        testFramework: config.project.testFramework,
        testScaffold,
        plan,
      };

      if (expand) {
        return toolText(`Ready to implement ${componentName}.`, {
          ...baseDetail,
          dsComponents,
        });
      } else {
        return toolText(`Ready to implement ${componentName}.`, {
          ...baseDetail,
          componentRefs,
        });
      }
    } catch (err) {
      if (err instanceof KotikitError) return toolError(err);
      return toolError(err);
    }
  });
}

// ─── kotikit_implement_code_save ──────────────────────────────────────────────

function registerSave(
  registry: ToolRegistry,
  ctx: ToolContext,
  opts: RegisterImplementCodeToolsOpts
): void {
  const tool: Tool = {
    name: "kotikit_implement_code_save",
    description:
      "Write generated files, run quality gates, and commit on success.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string" },
        screen: { type: "string" },
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
      required: ["scope", "files"],
    },
  };

  registry.tools.push(tool);

  registry.handlers.set("kotikit_implement_code_save", async (args) => {
    const { scope, screen: screenArg, files } = args as {
      scope: string;
      screen?: string;
      files: { path: string; content: string }[];
    };
    const screen = screenArg ?? null;
    const root = ctx.root;
    const runGates = opts.gateRunner ?? defaultRunGates;

    try {
      // Load config
      const config = (await ctx.loadConfig()) ?? defaultConfig();

      // 1. Validate file paths — must be inside codeComponentDir/<scope>/
      const targetDir = codeComponentDir(root, config.project.codeComponentsDir, scope);
      const resolvedPaths: { absolute: string; content: string }[] = [];

      for (const file of files) {
        const absolute = resolvePath(file.path);
        const rel = relativePath(targetDir, absolute);
        // If rel starts with ".." or is absolute, reject
        if (rel.startsWith("..") || rel.startsWith("/")) {
          return toolError(
            new KotikitError(
              "That file path is outside your code components directory.",
              `Generated files must live under ${config.project.codeComponentsDir}/${scope}/.`
            )
          );
        }
        resolvedPaths.push({ absolute, content: file.content });
      }

      // 2. Load spec + flow
      let spec: Awaited<ReturnType<typeof readScreenSpec>>;
      try {
        spec = await readScreenSpec(root, scope, screen);
      } catch (err) {
        if (err instanceof KotikitError) return toolError(err);
        return toolError(
          new KotikitError(
            `I couldn't find the spec for "${screen ?? scope}".`,
            "Check the scope and screen names."
          )
        );
      }

      let flowManifest: Awaited<ReturnType<typeof readFlowManifest>> | undefined;
      try {
        flowManifest = await readFlowManifest(root, scope);
      } catch {
        flowManifest = undefined;
      }

      // 3. Determine kind: "create" if ANY target file did NOT exist before the write
      const anyNew = resolvedPaths.some((f) => !existsSync(f.absolute));
      const writeKind: "create" | "update" = anyNew ? "create" : "update";

      // 4. Write each file (creating parent dirs)
      for (const { absolute, content } of resolvedPaths) {
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, content, "utf-8");
      }

      const filePaths = resolvedPaths.map((f) => f.absolute);

      // 5. Load plan (or generate if missing)
      let plan = await readCodePlan(root, scope, screen);
      if (plan === null) {
        plan = generateCodePlan({ root, scope, screen, spec, flowManifest, config });
        await writeCodePlan(root, scope, screen, plan);
      }

      // Build DS components (best-effort, same as start)
      const dsComponents: Record<string, ComponentJson> = {};
      const dsDir = designSystemDir(root);
      const dbPath = componentsDbPath(root);
      if (existsSync(dsDir)) {
        for (const dsRef of plan.dsComponentRefs) {
          try {
            if (existsSync(dbPath)) {
              const db = new Database(dbPath, { readonly: true });
              try {
                const hits = searchComponents(db, dsRef.name, 1);
                if (hits.length > 0) {
                  const jsonPath = `${dsDir}/${hits[0]!.path}`;
                  if (existsSync(jsonPath)) {
                    const raw = JSON.parse(await readFile(jsonPath, "utf-8"));
                    const parsed = ComponentJsonSchema.safeParse(raw);
                    if (parsed.success) {
                      dsComponents[dsRef.name] = parsed.data;
                    }
                  }
                }
              } finally {
                db.close();
              }
            }
          } catch {
            // Skip silently
          }
        }
      }

      const adapterCtx: AdapterContext = {
        root,
        config,
        spec,
        flowManifest,
        dsComponents,
      };

      // 6. Run gates
      const report = await runGates({
        root,
        adapter: reactAdapter,
        ctx: adapterCtx,
        files: filePaths,
      });

      if (!report.passed) {
        // Files are already written (for next iteration), but no commit / spec update / registry
        const gateMsg = formatGateReport(report);
        return {
          content: [
            {
              type: "text",
              text:
                `${gateMsg}\n\nFix the failures and call implement_code_gate to re-validate.\n\n${JSON.stringify({ report, files: filePaths }, null, 2)}`,
            },
          ],
          isError: true,
        };
      }

      // Gates passed:
      // 7a. Upsert registry
      const componentName = plan.componentName;
      const relTargetPath = relativePath(root, resolvedPaths[0]!.absolute);
      const regDbPath = registryDbPath(root);
      const regDb = openDb(regDbPath);
      try {
        initRegistryDb(regDb);
        upsertRegistry(regDb, {
          kind: "screen",
          name: componentName,
          dsPath: null,
          codePath: relTargetPath,
          status: "code-only",
        });
      } finally {
        regDb.close();
      }

      // 7b. Auto-commit
      const commitResult = await autoCommitCode({
        root,
        scope,
        screen,
        kind: writeKind,
        files: [...filePaths, regDbPath],
        enabled: config.git.autoCommit,
        coAuthor: config.git.coAuthor,
      });

      // 7c. Update spec status to "active" if not already
      if (spec.status !== "active") {
        const updatedSpec = {
          ...spec,
          status: "active" as const,
          metadata: {
            ...spec.metadata,
            updatedAt: nowIso(),
          },
        };
        await writeScreenSpec(root, scope, screen, updatedSpec);
      }

      const actionVerb = writeKind === "create" ? "Implemented" : "Updated";
      return toolText(
        `${actionVerb} ${componentName}. All gates passed. ${commitResult.message}.`,
        { report, commit: commitResult, paths: filePaths }
      );
    } catch (err) {
      if (err instanceof KotikitError) return toolError(err);
      return toolError(err);
    }
  });
}

// ─── kotikit_implement_code_gate ──────────────────────────────────────────────

function registerGate(
  registry: ToolRegistry,
  ctx: ToolContext,
  opts: RegisterImplementCodeToolsOpts
): void {
  const tool: Tool = {
    name: "kotikit_implement_code_gate",
    description:
      "Re-run quality gates on already-written generated files.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string" },
        screen: { type: "string" },
        only: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["scope"],
    },
  };

  registry.tools.push(tool);

  registry.handlers.set("kotikit_implement_code_gate", async (args) => {
    const { scope, screen: screenArg, only } = args as {
      scope: string;
      screen?: string;
      only?: ("tsc" | "eslint" | "prettier" | "vitest")[];
    };
    const screen = screenArg ?? null;
    const root = ctx.root;
    const runGates = opts.gateRunner ?? defaultRunGates;

    try {
      // 1. Load config, spec, flow
      const config = (await ctx.loadConfig()) ?? defaultConfig();

      let spec: Awaited<ReturnType<typeof readScreenSpec>>;
      try {
        spec = await readScreenSpec(root, scope, screen);
      } catch (err) {
        if (err instanceof KotikitError) return toolError(err);
        return toolError(
          new KotikitError(
            `I couldn't find the spec for "${screen ?? scope}".`,
            "Check the scope and screen names."
          )
        );
      }

      let flowManifest: Awaited<ReturnType<typeof readFlowManifest>> | undefined;
      try {
        flowManifest = await readFlowManifest(root, scope);
      } catch {
        flowManifest = undefined;
      }

      // Get plan to know component name and target paths
      let plan = await readCodePlan(root, scope, screen);
      if (plan === null) {
        plan = generateCodePlan({ root, scope, screen, spec, flowManifest, config });
      }

      const componentName = plan.componentName;
      const componentTargetPath = codeComponentFile(
        root,
        config.project.codeComponentsDir,
        scope,
        reactAdapter.fileNameFor(componentName, "component")
      );
      const testTargetPath = plan.testPath
        ? codeComponentFile(
            root,
            config.project.codeComponentsDir,
            scope,
            reactAdapter.fileNameFor(componentName, "test")
          )
        : undefined;

      // 2. Verify files exist
      const existingPaths = [componentTargetPath, testTargetPath].filter(
        (p): p is string => p !== undefined && existsSync(p)
      );

      if (existingPaths.length === 0) {
        return toolError(
          new KotikitError(
            "There's no generated code yet.",
            "Call implement_code_save first with the file contents."
          )
        );
      }

      // 3. Build adapter context + run gates
      const dsComponents: Record<string, ComponentJson> = {};

      const adapterCtx: AdapterContext = {
        root,
        config,
        spec,
        flowManifest,
        dsComponents,
      };

      const report = await runGates({
        root,
        adapter: reactAdapter,
        ctx: adapterCtx,
        files: existingPaths,
        only: only as GateKind[] | undefined,
      });

      // 4. Return formatted report
      const text = formatGateReport(report);
      if (!report.passed) {
        return {
          content: [{ type: "text", text: `${text}\n\n${JSON.stringify({ report }, null, 2)}` }],
          isError: true,
        };
      }
      return toolText(text, { report });
    } catch (err) {
      if (err instanceof KotikitError) return toolError(err);
      return toolError(err);
    }
  });
}
