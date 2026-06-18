#!/usr/bin/env bun
import { runKotikitDoctor, formatDoctorReport } from "./doctor/doctor.js";
import { startServer } from "./mcp/server.js";
import { findProjectRoot } from "./util/paths.js";

const command = process.argv[2] ?? "help";

if (command === "doctor") {
  const root = findProjectRoot(process.cwd());
  const report = await runKotikitDoctor(root);
  process.stdout.write(formatDoctorReport(report));
  process.exit(report.ok ? 0 : 1);
}

if (command === "mcp") {
  await startServer();
} else {
  process.stderr.write("Usage: kotikit <doctor|mcp>\n");
  process.exit(1);
}
