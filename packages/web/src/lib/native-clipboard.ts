export type NativeClipboardCopyResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function copyTextToNativeClipboard(
  value: string,
): Promise<NativeClipboardCopyResult> {
  const writeText = navigator.clipboard?.writeText;
  let clipboardApiFailure: string | null = null;

  if (writeText) {
    try {
      await writeText.call(navigator.clipboard, value);
      return { ok: true };
    } catch (err) {
      clipboardApiFailure = getErrorName(err);
    }
  } else {
    clipboardApiFailure = "clipboard-api-unavailable";
  }

  const execCommand = document.execCommand;
  if (typeof execCommand !== "function") {
    return { ok: false, reason: clipboardApiFailure };
  }

  const ta = document.createElement("textarea");
  ta.value = value;
  ta.readOnly = true;
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.width = "1px";
  ta.style.height = "1px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);

  try {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, value.length);
    return execCommand.call(document, "copy")
      ? { ok: true }
      : { ok: false, reason: "exec-command-failed" };
  } catch (err) {
    return { ok: false, reason: getErrorName(err) };
  } finally {
    document.body.removeChild(ta);
  }
}

function getErrorName(err: unknown): string {
  if (
    err &&
    typeof err === "object" &&
    "name" in err &&
    typeof err.name === "string" &&
    err.name.length > 0
  ) {
    return err.name;
  }
  return "unknown";
}
