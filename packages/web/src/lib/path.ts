export function basename(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const trimmed = normalized.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function dirname(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const trimmed = normalized.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx === -1) return "";
  if (idx === 0) return "/";
  return trimmed.slice(0, idx);
}

export function extname(p: string): string {
  const name = basename(p);
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return "";
  return name.slice(idx + 1).toLowerCase();
}
