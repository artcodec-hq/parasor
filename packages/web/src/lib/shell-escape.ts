export function shellEscape(arg: string): string {
  if (arg === "") return "''";
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function shellEscapeJoin(args: readonly string[]): string {
  return args.map(shellEscape).join(" ");
}
