import { Osc7Parser } from "./osc7-parser.js";

export class Osc7Lifecycle {
  private parsers = new Map<string, Osc7Parser>();

  feed(sessionId: string, data: string): string | null {
    let parser = this.parsers.get(sessionId);
    if (!parser) {
      parser = new Osc7Parser();
      this.parsers.set(sessionId, parser);
    }
    return parser.feed(data);
  }

  removeSession(sessionId: string): void {
    this.parsers.delete(sessionId);
  }

  has(sessionId: string): boolean {
    return this.parsers.has(sessionId);
  }

  get size(): number {
    return this.parsers.size;
  }
}
