import { existsSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { type AsyncSubscription, subscribe } from "@parcel/watcher";

export type FileChangeEvent = "create" | "update" | "delete";
export interface FileChangeEntry {
  event: FileChangeEvent;
  path: string;
}
export interface FileChangeBatch {
  events: FileChangeEntry[];
  overflow: boolean;
  count: number;
}
type FileChangeCallback = (batch: FileChangeBatch) => void;
type GitignoreChangeCallback = () => void;
type GitRefChangeCallback = () => void;
type IsIgnoredCallback = (relPath: string, isDir: boolean) => boolean;

const FILE_IGNORED = new Set([".DS_Store", "Thumbs.db"]);
const GIT_REF_PATHS = /^\.git\/(HEAD|index|refs\/)/;
const FILE_BATCH_FLUSH_MS = 150;
const FILE_BATCH_MAX_WAIT_MS = 500;
const MAX_FILE_BATCH_EVENTS = 5_000;
const DEBOUNCE_MS = 300;
const GIT_REF_DEBOUNCE_MS = 500;

export class FileWatcher {
  private subscription: AsyncSubscription | null = null;
  private readonly root: string;
  private readonly onChange: FileChangeCallback;
  private readonly onGitignoreChange: GitignoreChangeCallback;
  private readonly onGitRefChange: GitRefChangeCallback;
  private readonly isIgnored: IsIgnoredCallback;
  private pendingEvents = new Map<string, FileChangeEntry>();
  private pendingEventCount = 0;
  private pendingOverflow = false;
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private batchFirstEventAt = 0;
  private gitRefTimer: ReturnType<typeof setTimeout> | null = null;
  private gitignoreTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    root: string,
    onChange: FileChangeCallback,
    onGitignoreChange?: GitignoreChangeCallback,
    onGitRefChange?: GitRefChangeCallback,
    isIgnored?: IsIgnoredCallback,
  ) {
    const resolved = resolve(root);
    try {
      this.root = realpathSync(resolved);
    } catch {
      this.root = resolved;
    }
    this.onChange = onChange;
    this.onGitignoreChange = onGitignoreChange ?? (() => {});
    this.onGitRefChange = onGitRefChange ?? (() => {});
    this.isIgnored = isIgnored ?? (() => false);
  }

  async start(): Promise<void> {
    if (!existsSync(this.root)) {
      console.warn(`File watching disabled for ${this.root}: missing`);
      this.subscription = null;
      return;
    }
    try {
      this.subscription = await subscribe(
        this.root,
        (err, events) => {
          if (err) return;
          for (const event of events) {
            this.handleEvent(event.type, event.path);
          }
        },
        { ignore: [join(this.root, "node_modules")] },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`File watching disabled for ${this.root}: ${message}`);
      this.subscription = null;
    }
  }

  private clearBatchTimer(): void {
    if (!this.batchTimer) return;
    clearTimeout(this.batchTimer);
    this.batchTimer = null;
  }

  private flushBatch(): void {
    this.clearBatchTimer();
    if (this.pendingEventCount === 0) return;

    const batch: FileChangeBatch = {
      events: this.pendingOverflow ? [] : [...this.pendingEvents.values()],
      overflow: this.pendingOverflow,
      count: this.pendingEventCount,
    };
    this.pendingEvents.clear();
    this.pendingEventCount = 0;
    this.pendingOverflow = false;
    this.batchFirstEventAt = 0;
    this.onChange(batch);
  }

  private queueChange(event: FileChangeEvent, path: string): void {
    this.pendingEventCount += 1;
    if (!this.pendingOverflow) {
      if (this.pendingEventCount > MAX_FILE_BATCH_EVENTS) {
        this.pendingEvents.clear();
        this.pendingOverflow = true;
      } else {
        this.pendingEvents.set(`${event}:${path}`, { event, path });
      }
    }

    const now = Date.now();
    if (this.batchFirstEventAt === 0) this.batchFirstEventAt = now;
    if (now - this.batchFirstEventAt >= FILE_BATCH_MAX_WAIT_MS) {
      this.flushBatch();
      return;
    }

    this.clearBatchTimer();
    this.batchTimer = setTimeout(() => {
      this.flushBatch();
    }, FILE_BATCH_FLUSH_MS);
    this.batchTimer.unref?.();
  }

  private handleEvent(type: FileChangeEvent, absPath: string): void {
    const relPath = relative(this.root, absPath);
    const name = relPath.split(sep).pop() ?? "";

    if (FILE_IGNORED.has(name)) return;

    const posixRel = sep === "/" ? relPath : relPath.split(sep).join("/");

    if (GIT_REF_PATHS.test(posixRel)) {
      if (!this.gitRefTimer) {
        this.gitRefTimer = setTimeout(() => {
          this.gitRefTimer = null;
          this.onGitRefChange();
        }, GIT_REF_DEBOUNCE_MS);
      }
      return;
    }

    if (posixRel.startsWith(".git/") || posixRel === ".git") return;

    if (posixRel === ".gitignore" && (type === "create" || type === "update")) {
      if (this.gitignoreTimer) clearTimeout(this.gitignoreTimer);
      this.gitignoreTimer = setTimeout(() => {
        this.gitignoreTimer = null;
        this.onGitignoreChange();
      }, DEBOUNCE_MS);
    }

    if (posixRel !== ".gitignore") {
      let isDir = false;
      try {
        isDir = statSync(absPath).isDirectory();
      } catch {
        // path may no longer exist (delete event) -- treat as file
      }
      if (this.isIgnored(posixRel, isDir)) return;
    }

    this.queueChange(type, posixRel);
  }

  async stop(): Promise<void> {
    this.clearBatchTimer();
    this.pendingEvents.clear();
    this.pendingEventCount = 0;
    this.pendingOverflow = false;
    this.batchFirstEventAt = 0;
    if (this.gitRefTimer) {
      clearTimeout(this.gitRefTimer);
      this.gitRefTimer = null;
    }
    if (this.gitignoreTimer) {
      clearTimeout(this.gitignoreTimer);
      this.gitignoreTimer = null;
    }

    if (this.subscription) {
      await this.subscription.unsubscribe();
      this.subscription = null;
    }
  }
}
