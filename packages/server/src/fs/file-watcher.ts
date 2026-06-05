import { realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { type AsyncSubscription, subscribe } from "@parcel/watcher";

export type FileChangeEvent = "create" | "update" | "delete";
type FileChangeCallback = (event: FileChangeEvent, relPath: string) => void;
type GitignoreChangeCallback = () => void;
type GitRefChangeCallback = () => void;
type IsIgnoredCallback = (relPath: string, isDir: boolean) => boolean;

const FILE_IGNORED = new Set([".DS_Store", "Thumbs.db"]);
const GIT_REF_PATHS = /^\.git\/(HEAD|index|refs\/)/;
const DEBOUNCE_MS = 300;
const GIT_REF_DEBOUNCE_MS = 500;

export class FileWatcher {
  private subscription: AsyncSubscription | null = null;
  private readonly root: string;
  private readonly onChange: FileChangeCallback;
  private readonly onGitignoreChange: GitignoreChangeCallback;
  private readonly onGitRefChange: GitRefChangeCallback;
  private readonly isIgnored: IsIgnoredCallback;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private gitRefTimer: ReturnType<typeof setTimeout> | null = null;
  private gitignoreTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    root: string,
    onChange: FileChangeCallback,
    onGitignoreChange?: GitignoreChangeCallback,
    onGitRefChange?: GitRefChangeCallback,
    isIgnored?: IsIgnoredCallback,
  ) {
    this.root = realpathSync(root);
    this.onChange = onChange;
    this.onGitignoreChange = onGitignoreChange ?? (() => {});
    this.onGitRefChange = onGitRefChange ?? (() => {});
    this.isIgnored = isIgnored ?? (() => false);
  }

  async start(): Promise<void> {
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

    const key = `${type}:${posixRel}`;
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        this.onChange(type, posixRel);
      }, DEBOUNCE_MS),
    );
  }

  async stop(): Promise<void> {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
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
