import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerActiveTerminal } from "../../../lib/terminal-registry.js";
import { attachTerminalActiveRegistrationLifecycle } from "./terminal-active-registration-lifecycle.js";

const registryMocks = vi.hoisted(() => ({
  unregister: vi.fn(),
}));

vi.mock("../../../lib/terminal-registry.js", () => ({
  registerActiveTerminal: vi.fn(),
}));

const mockRegisterActiveTerminal = vi.mocked(registerActiveTerminal);

describe("attachTerminalActiveRegistrationLifecycle", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    registryMocks.unregister.mockReset();
    mockRegisterActiveTerminal.mockReset();
    mockRegisterActiveTerminal.mockReturnValue(registryMocks.unregister);
  });

  it("registers the terminal input target on focus and unregisters on cleanup", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const sendInput = vi.fn();
    const cleanup = attachTerminalActiveRegistrationLifecycle({
      container,
      sendInput,
    });

    container.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    expect(mockRegisterActiveTerminal).toHaveBeenCalledWith(sendInput);
    expect(registryMocks.unregister).not.toHaveBeenCalled();

    cleanup();

    expect(registryMocks.unregister).toHaveBeenCalledTimes(1);
  });

  it("re-registers when focus enters again and registers immediately if focus is already inside", () => {
    const container = document.createElement("div");
    const input = document.createElement("input");
    container.append(input);
    document.body.append(container);
    input.focus();
    const sendInput = vi.fn();
    const cleanup = attachTerminalActiveRegistrationLifecycle({
      container,
      sendInput,
    });

    expect(mockRegisterActiveTerminal).toHaveBeenCalledTimes(1);

    container.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    expect(mockRegisterActiveTerminal).toHaveBeenCalledTimes(2);
    expect(registryMocks.unregister).toHaveBeenCalledTimes(1);

    cleanup();

    expect(registryMocks.unregister).toHaveBeenCalledTimes(2);
  });
});
