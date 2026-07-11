import { registerActiveTerminal } from "../../../lib/terminal-registry.js";

export function attachTerminalActiveRegistrationLifecycle({
  container,
  sendInput,
}: {
  container: HTMLElement;
  sendInput: (data: string) => void;
}) {
  let unregister: (() => void) | null = null;
  const register = () => {
    unregister?.();
    unregister = registerActiveTerminal(sendInput);
  };
  const onFocusIn = () => register();

  container.addEventListener("focusin", onFocusIn);
  if (container.contains(document.activeElement)) register();

  return () => {
    container.removeEventListener("focusin", onFocusIn);
    unregister?.();
  };
}
