import type { ToolContext } from "../context.js";
import type { ToolRegistry } from "../server.js";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import { Database } from "bun:sqlite";
import { runAudit } from "../../audit/engine.js";
import { registryDbPath } from "../../util/paths.js";
import { toolText, toolError, KotikitError } from "../../util/result.js";

export function registerAuditTools(registry: ToolRegistry, ctx: ToolContext): void {
  registry.tools.push({
    name: "kotikit_audit",
    description:
      "Walk the kotikit registry and report drift between design and code (synced-ok / synced-mismatched / design-only / code-only).",
    inputSchema: { type: "object", properties: {} },
  });

  registry.handlers.set("kotikit_audit", async (_args) => {
    try {
      const { root } = ctx;
      const regPath = registryDbPath(root);
      if (!existsSync(regPath)) {
        return toolError(
          new KotikitError(
            "No registry yet.",
            "Run sync_ds first to populate the design-only side of the registry."
          )
        );
      }

      const db = new Database(regPath, { readonly: true });
      let report;
      try {
        report = await runAudit({ root, registryDb: db });
      } finally {
        db.close();
      }

      // Write audit-report.json
      const reportPath = `${root}/.kotikit/audit-report.json`;
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf-8");

      const s = report.summary;
      const total = s.syncedOk + s.syncedMismatched + s.designOnly + s.codeOnly;
      const summary = `Audit complete: ${total} entries (${s.syncedOk} synced-ok, ${s.syncedMismatched} mismatched, ${s.designOnly} design-only, ${s.codeOnly} code-only).`;

      return toolText(summary, { reportPath, report });
    } catch (err) {
      return toolError(err);
    }
  });
}
