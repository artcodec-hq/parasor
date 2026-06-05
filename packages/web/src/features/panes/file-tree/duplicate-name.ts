// Finder splitting: directories never split; leading-dot-only names (.env) keep ext=""; otherwise last dot wins (foo.tar.gz -> foo.tar / .gz).
export function splitName(
  name: string,
  type: "file" | "directory",
): { base: string; ext: string } {
  if (type === "directory") return { base: name, ext: "" };
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, lastDot), ext: name.slice(lastDot) };
}

export function buildDuplicateName(
  base: string,
  ext: string,
  index: number,
): string {
  const suffix = index === 1 ? " copy" : ` copy ${index}`;
  return `${base}${suffix}${ext}`;
}

export function nextDuplicateName(
  name: string,
  type: "file" | "directory",
  existingNames: Iterable<string>,
): string {
  const taken = new Set(existingNames);
  const { base, ext } = splitName(name, type);
  for (let i = 1; i < 1000; i += 1) {
    const candidate = buildDuplicateName(base, ext, i);
    if (!taken.has(candidate)) return candidate;
  }
  // Defensive -- practically unreachable. Append timestamp to guarantee uniqueness.
  return buildDuplicateName(base, ext, Date.now());
}
