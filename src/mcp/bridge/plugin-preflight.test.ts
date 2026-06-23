import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KotikitError } from "../../util/result.js";
import {
  type CommandResult,
  patchPluginManifestAllowedDomains,
  preparePluginBuild,
} from "./plugin-preflight.js";

const roots: string[] = [];

const makePluginRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "kotikit-plugin-"));
  roots.push(root);
  return root;
};

const writeText = (path: string, text: string): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text, "utf-8");
};

const touch = (path: string, when: Date): void => {
  utimesSync(path, when, when);
};

const seedPluginSources = (root: string): void => {
  writeText(join(root, "package.json"), JSON.stringify({ scripts: { build: "vite build" } }));
  writeText(join(root, "bun.lock"), "");
  writeText(join(root, "code.ts"), "figma.showUI(__html__);");
  writeText(join(root, "ui/index.html"), '<div id="root"></div>');
  writeText(join(root, "ui/main.tsx"), "console.log('ui');");
};

const writePluginDist = (root: string): void => {
  writeText(join(root, "dist/code.js"), "compiled code");
  writeText(join(root, "dist/ui.html"), "compiled ui");
};

const ok = (stdout = ""): CommandResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string): CommandResult => ({ code: 1, stdout: "", stderr });

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("patchPluginManifestAllowedDomains", () => {
  it("replaces wildcard localhost domains with exact bridge port domains", async () => {
    const root = makePluginRoot();
    writeText(
      join(root, "manifest.json"),
      JSON.stringify(
        {
          name: "kotikit",
          networkAccess: {
            allowedDomains: [
              "http://localhost:*",
              "ws://localhost:*",
              "https://localhost:*",
              "https://api.example.com",
            ],
            reasoning: "Connects locally.",
          },
        },
        null,
        2
      )
    );

    const domains = await patchPluginManifestAllowedDomains(root, 53125);
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf-8"));

    expect(domains).toEqual([
      "http://localhost:53125",
      "ws://localhost:53125",
      "https://localhost:53125",
      "https://api.example.com",
    ]);
    expect(manifest.networkAccess.allowedDomains).toEqual(domains);
  });

  it("fails with a user-facing error when the plugin manifest is missing", async () => {
    const root = makePluginRoot();

    try {
      await patchPluginManifestAllowedDomains(root, 53124);
      throw new Error("expected patchPluginManifestAllowedDomains to fail");
    } catch (err) {
      expect(err).toBeInstanceOf(KotikitError);
      expect((err as KotikitError).userMessage).toContain("Figma plugin manifest is missing");
    }
  });
});

describe("preparePluginBuild", () => {
  it("does not run install or build commands when plugin dist is fresh", async () => {
    const root = makePluginRoot();
    seedPluginSources(root);
    writeText(join(root, "dist/code.js"), "compiled code");
    writeText(join(root, "dist/ui.html"), "compiled ui");
    mkdirSync(join(root, "node_modules"), { recursive: true });

    const old = new Date("2026-01-01T00:00:00.000Z");
    const fresh = new Date("2026-01-02T00:00:00.000Z");
    for (const path of ["package.json", "bun.lock", "code.ts", "ui/index.html", "ui/main.tsx"])
      touch(join(root, path), old);
    touch(join(root, "dist/code.js"), fresh);
    touch(join(root, "dist/ui.html"), fresh);
    touch(join(root, "node_modules"), fresh);

    const commands: string[] = [];
    const result = await preparePluginBuild(root, {
      runCommand: async (command, args) => {
        commands.push([command, ...args].join(" "));
        if (command === "bun" && args.join(" ") === "run build") writePluginDist(root);
        return ok();
      },
    });

    expect(result.rebuilt).toBe(false);
    expect(commands).toEqual([]);
  });

  it("installs and builds with bun when dist is missing", async () => {
    const root = makePluginRoot();
    seedPluginSources(root);
    const commands: string[] = [];

    const result = await preparePluginBuild(root, {
      runCommand: async (command, args) => {
        commands.push([command, ...args].join(" "));
        if (command === "bun" && args.join(" ") === "run build") writePluginDist(root);
        return ok();
      },
    });

    expect(result.rebuilt).toBe(true);
    expect(result.packageManager).toBe("bun");
    expect(commands).toEqual(["bun --version", "bun install", "bun run build"]);
  });

  it("falls back to npm when bun is unavailable and surfaces a warning", async () => {
    const root = makePluginRoot();
    seedPluginSources(root);
    const commands: string[] = [];

    const result = await preparePluginBuild(root, {
      runCommand: async (command, args) => {
        commands.push([command, ...args].join(" "));
        if (command === "bun") return fail("bun not found");
        if (command === "npm" && args.join(" ") === "run build") writePluginDist(root);
        return ok();
      },
    });

    expect(result.rebuilt).toBe(true);
    expect(result.packageManager).toBe("npm");
    expect(result.warning).toContain("Bun");
    expect(commands).toEqual(["bun --version", "npm --version", "npm install", "npm run build"]);
  });

  it("fails with raw build output when the plugin build fails", async () => {
    const root = makePluginRoot();
    seedPluginSources(root);

    try {
      await preparePluginBuild(root, {
        runCommand: async (command, args) => {
          if (command === "bun" && args[0] === "run") return fail("vite failed");
          return ok();
        },
      });
      throw new Error("expected preparePluginBuild to fail");
    } catch (err) {
      expect(err).toBeInstanceOf(KotikitError);
      expect((err as KotikitError).userMessage).toContain("couldn't build the Figma plugin");
      expect((err as KotikitError).hint).toContain("vite failed");
    }
  });
});
