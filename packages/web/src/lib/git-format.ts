/**
 * Local-time formatter for git commit timestamps. Renders in the user's
 * locale + timezone so the diff pane shows the absolute commit time.
 */
export function formatLocalDateTime(unixSec: number): string {
  if (!unixSec) return "";
  const d = new Date(unixSec * 1000);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
