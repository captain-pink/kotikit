import { describe, expect, it } from "bun:test";
import { formatMs, nullProgressEmitter, recordingProgressEmitter } from "../progress.js";

const CTX = { index: 1, total: 1, name: "TestFile" };

describe("nullProgressEmitter", () => {
  it("is callable on every method without throwing", () => {
    const e = nullProgressEmitter();
    expect(() => e.syncStart(1)).not.toThrow();
    expect(() => e.fileStart(CTX)).not.toThrow();
    expect(() => e.stage(CTX, "metadata")).not.toThrow();
    expect(() => e.stage(CTX, "writes")).not.toThrow();
    expect(() => e.stageProgress(CTX, "node_details", { processed: 50, total: 100 })).not.toThrow();
    expect(() => e.stageDone(CTX, "metadata", "1.4s")).not.toThrow();
    expect(() => e.stageDone(CTX, "writes", "0.3s")).not.toThrow();
    expect(() =>
      e.fileDone(CTX, { componentCount: 10, iconCount: 5, elapsedMs: 3000 })
    ).not.toThrow();
    expect(() =>
      e.syncDone({
        fileCount: 1,
        componentTotal: 10,
        iconTotal: 5,
        conflictCount: 0,
        elapsedMs: 3000,
      })
    ).not.toThrow();
  });
});

describe("recordingProgressEmitter", () => {
  it("records each method call in order", () => {
    const { emitter, events } = recordingProgressEmitter();

    emitter.syncStart(2);
    emitter.fileStart(CTX);
    emitter.stage(CTX, "metadata");
    emitter.stageDone(CTX, "metadata", "0.5s");
    emitter.stageProgress(CTX, "node_details", { processed: 100, total: 200 });
    emitter.stageProgress(CTX, "node_details", { processed: 200, total: 200, label: "1.1s" });
    emitter.fileDone(CTX, { componentCount: 3, iconCount: 1, elapsedMs: 2000 });
    emitter.syncDone({
      fileCount: 1,
      componentTotal: 3,
      iconTotal: 1,
      conflictCount: 0,
      elapsedMs: 2100,
    });

    expect(events).toHaveLength(8);
    expect(events[0]?.kind).toBe("syncStart");
    expect(events[1]?.kind).toBe("fileStart");
    expect(events[2]?.kind).toBe("stage");
    expect(events[3]?.kind).toBe("stageDone");
    expect(events[4]?.kind).toBe("stageProgress");
    expect(events[5]?.kind).toBe("stageProgress");
    expect(events[6]?.kind).toBe("fileDone");
    expect(events[7]?.kind).toBe("syncDone");
  });

  it("captures payload for syncStart", () => {
    const { emitter, events } = recordingProgressEmitter();
    emitter.syncStart(3);
    expect((events[0]?.payload as { fileCount: number })?.fileCount).toBe(3);
  });

  it("captures payload for stageProgress", () => {
    const { emitter, events } = recordingProgressEmitter();
    emitter.stageProgress(CTX, "node_details", { processed: 50, total: 100 });
    const p = (events[0]?.payload as { p: { processed: number; total: number } }).p;
    expect(p.processed).toBe(50);
    expect(p.total).toBe(100);
  });
});

describe("formatMs", () => {
  it("returns milliseconds for sub-second values", () => {
    expect(formatMs(0)).toBe("0ms");
    expect(formatMs(500)).toBe("500ms");
    expect(formatMs(999)).toBe("999ms");
  });

  it("returns seconds with one decimal for values under a minute", () => {
    expect(formatMs(1000)).toBe("1.0s");
    expect(formatMs(1400)).toBe("1.4s");
    expect(formatMs(18200)).toBe("18.2s");
    expect(formatMs(59999)).toBe("60.0s");
  });

  it("returns minutes and seconds for values >= 60s", () => {
    expect(formatMs(60_000)).toBe("1m 0s");
    expect(formatMs(192_000)).toBe("3m 12s");
    expect(formatMs(194_000)).toBe("3m 14s");
  });
});
