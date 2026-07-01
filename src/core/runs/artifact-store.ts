import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { KotikitError } from "../../util/result.js";
import { type Artifact, ArtifactSchema } from "../schemas/artifact.js";
import { assertSafeLocalId } from "./safe-id.js";

export type ArtifactStore = {
  writeArtifact(artifact: Artifact): Promise<void>;
  getArtifact(artifactId: string): Promise<Artifact>;
  listArtifacts(runId?: string): Promise<Artifact[]>;
};

export function createArtifactStore(root: string): ArtifactStore {
  const artifactsDir = join(root, ".kotikit", "artifacts");

  return {
    async writeArtifact(artifact: Artifact): Promise<void> {
      assertSafeLocalId("artifact", artifact.id);
      await writeJsonAtomic(artifactPath(artifactsDir, artifact.id), parseArtifact(artifact));
    },
    async getArtifact(artifactId: string): Promise<Artifact> {
      assertSafeLocalId("artifact", artifactId);
      try {
        return parseArtifact(
          JSON.parse(await readFile(artifactPath(artifactsDir, artifactId), "utf8"))
        );
      } catch (err) {
        if (err instanceof KotikitError) throw err;
        throw new KotikitError(
          `I couldn't find kotikit artifact "${artifactId}".`,
          "Check the artifact id or list artifacts for the active run."
        );
      }
    },
    async listArtifacts(runId?: string): Promise<Artifact[]> {
      try {
        const entries = await readdir(artifactsDir);
        const artifacts = await Promise.all(
          entries
            .filter((entry) => entry.endsWith(".json"))
            .map((entry) => readFile(join(artifactsDir, entry), "utf8"))
        );
        return artifacts
          .map((artifact) => parseArtifact(JSON.parse(artifact)))
          .filter((artifact) => runId === undefined || artifact.runId === runId)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      } catch (err) {
        if ((err as { code?: string }).code === "ENOENT") return [];
        throw err;
      }
    },
  };
}

function artifactPath(artifactsDir: string, artifactId: string): string {
  return join(artifactsDir, `${assertSafeLocalId("artifact", artifactId)}.json`);
}

function parseArtifact(raw: unknown): Artifact {
  try {
    return ArtifactSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new KotikitError(
        "This kotikit artifact has an invalid format.",
        "Check that the artifact type, schema version, and payload schema match."
      );
    }
    throw err;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmpPath, path);
}
