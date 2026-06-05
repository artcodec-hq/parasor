/*
 * Lightweight, module-level registry of the most-recently-focused Terminal
 * instance. Used by cross-pane actions (e.g. FileContextMenu's
 * "Insert path into terminal") that need to target "the terminal the user
 * just interacted with" without threading a ref through the pane tree.
 *
 * We keep a stack so that when a focused terminal unmounts, any previously
 * registered terminal becomes active again -- otherwise the registry would
 * fall to null while another mounted terminal still exists.
 */

type TerminalInputFn = (data: string) => void;

const stack: TerminalInputFn[] = [];

export function registerActiveTerminal(fn: TerminalInputFn): () => void {
  const existingIndex = stack.indexOf(fn);
  if (existingIndex !== -1) stack.splice(existingIndex, 1);
  stack.push(fn);
  return () => {
    const i = stack.indexOf(fn);
    if (i !== -1) stack.splice(i, 1);
  };
}

export function hasActiveTerminal(): boolean {
  return stack.length > 0;
}

export function sendToActiveTerminal(data: string): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top(data);
  return true;
}
