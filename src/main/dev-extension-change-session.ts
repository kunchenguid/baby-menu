import { cp, mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { GitActionResult, GitSessionSnapshot, WorkspaceChange } from "../shared/contracts";
import { classifySnapshotChanges, directoriesDiffer } from "./extension-change";

export class DevExtensionChangeSession {
  readonly startedClean = true;
  readonly head = null;

  private completed = false;

  private constructor(
    private readonly extensionsDir: string,
    private readonly snapshotDir: string,
  ) {}

  get canSave(): boolean {
    return !this.completed;
  }

  get canRollback(): boolean {
    return !this.completed;
  }

  static async begin(extensionsDir: string, snapshotRoot: string): Promise<DevExtensionChangeSession> {
    await mkdir(extensionsDir, { recursive: true });
    await mkdir(snapshotRoot, { recursive: true });
    const snapshotDir = join(snapshotRoot, randomUUID());
    await cp(extensionsDir, snapshotDir, { recursive: true, force: true });
    return new DevExtensionChangeSession(extensionsDir, snapshotDir);
  }

  // Whether the workspace actually differs from the pre-turn snapshot. False
  // means the agent reported back without changing any file.
  async hasChanges(): Promise<boolean> {
    return directoriesDiffer(this.snapshotDir, this.extensionsDir);
  }

  // Classifies which workspace surfaces this turn created, updated, or removed by
  // comparing the pre-turn snapshot to the current workspace - never the agent's prose.
  async describeChanges(): Promise<WorkspaceChange[]> {
    return classifySnapshotChanges(this.snapshotDir, this.extensionsDir);
  }

  snapshot(message?: string): GitSessionSnapshot {
    return {
      startedClean: this.startedClean,
      canSave: this.canSave,
      canRollback: this.canRollback,
      head: this.head,
      message,
    };
  }

  async save(): Promise<GitActionResult> {
    if (this.completed) return { ok: false, reason: "Cannot save: session is already completed" };

    this.completed = true;
    await rm(this.snapshotDir, { recursive: true, force: true });
    return { ok: true };
  }

  async rollback(): Promise<GitActionResult> {
    if (this.completed) return { ok: false, reason: "Cannot rollback: session is already completed" };

    await rm(this.extensionsDir, { recursive: true, force: true });
    await cp(this.snapshotDir, this.extensionsDir, { recursive: true, force: true });
    await rm(this.snapshotDir, { recursive: true, force: true });
    this.completed = true;
    return { ok: true };
  }
}
