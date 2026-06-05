export type PaneNode =
  | { type: "terminal"; id: string; sessionId: string }
  | { type: "browser"; id: string; url: string }
  | { type: "filetree"; id: string; projectId: string; expandedPaths: string[] }
  | { type: "diff"; id: string; projectId: string }
  | { type: "editor"; id: string; projectId: string; filePath: string }
  | { type: "empty"; id: string }
  | {
      type: "split";
      id: string;
      direction: "horizontal" | "vertical";
      children: PaneNode[];
      sizes: number[];
    };
