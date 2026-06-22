#!/usr/bin/env bun
import { runKotikitDoctor, formatDoctorReport } from "./doctor/doctor.js";
import { runMigrationDryRun, formatMigrationDryRunReport } from "./migrations/dry-run.js";
import { startServer } from "./mcp/server.js";
import { findProjectRoot } from "./util/paths.js";

const [command = "help", ...args] = process.argv.slice(2);
const usage = "Usage: kotikit <doctor|mcp|migrate --dry-run>\n";

if (command === "doctor") {
  const root = findProjectRoot(process.cwd());
  const report = await runKotikitDoctor(root);
  process.stdout.write(formatDoctorReport(report));
  process.exit(report.ok ? 0 : 1);
}

if (command === "migrate") {
  if (args.length !== 1 || args[0] !== "--dry-run") {
    process.stderr.write("Usage: kotikit migrate --dry-run\n");
    process.stderr.write("Kotikit upgrades JSON artifacts lazily when they are edited.\n");
    process.exit(1);
  }
  const root = findProjectRoot(process.cwd());
  const report = await runMigrationDryRun(root);
  process.stdout.write(formatMigrationDryRunReport(report));
  process.exit(report.ok ? 0 : 1);
}

if (command === "mcp") {
  await startServer();
} else {
  process.stderr.write(usage);
  process.exit(1);
}
