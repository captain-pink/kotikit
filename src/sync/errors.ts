export class SyncPausedError extends Error {
  constructor(
    public readonly filesCompleted: number,
    public readonly totalFiles: number,
    public readonly lastStage: string
  ) {
    super("Sync paused: approaching timeout - checkpoint saved, run again to resume.");
    this.name = "SyncPausedError";
  }
}
