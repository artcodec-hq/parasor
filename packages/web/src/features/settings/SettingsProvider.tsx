import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { injectFontFace } from "../../lib/font-loader.js";
import { DEFAULT_UI_FONT_STACK, resolveFontStack } from "../../lib/fonts.js";
import {
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
  WORKBENCH_TOKEN_KEYS,
} from "../../lib/theme/loader.js";
import type { ThemeEntry } from "../../lib/theme/types.js";
import { findClientPreset } from "./font-presets.js";
import {
  ACTIVE_THEME_MODE_KEY,
  ACTIVE_THEME_TOKENS_KEY,
  buildCustomEntries,
  CONTENT_FONT_SIZE_RANGE,
  type CustomThemeInput,
  createStoredCustomTheme,
  loadSettings,
  loadStoredCustomThemes,
  type SettingsState,
  type StoredCustomTheme,
  saveCustomThemes,
  saveSettings,
  UI_FONT_SIZE_RANGE,
} from "./settings-storage.js";

export interface SettingsContextValue extends SettingsState {
  themes: ThemeEntry[];
  activeTheme: ThemeEntry;
  customThemes: ThemeEntry[];
  resolvedFontStack: string;
  resolvedUiFontStack: string;
  setThemeId: (id: string) => void;
  setUiFontFamily: (family: string) => void;
  setUiFontSize: (size: number) => void;
  setContentFontSize: (size: number) => void;
  setCustomFontFamily: (family: string) => void;
  setFontPresetId: (id: string) => void;
  setPlayAttentionSound: (enabled: boolean) => void;
  setPlayCompletionSound: (enabled: boolean) => void;
  addCustomTheme: (input: CustomThemeInput) => ThemeEntry;
  removeCustomTheme: (id: string) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);
const PRESET_FONT_LOAD_FALLBACK_MS = 1200;

function scheduleAfterInitialPaint(task: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let cancelled = false;
  let timeoutId: number | null = window.setTimeout(() => {
    timeoutId = null;
    runTask();
  }, PRESET_FONT_LOAD_FALLBACK_MS);
  let frameA: number | null = window.requestAnimationFrame(() => {
    frameA = null;
    frameB = window.requestAnimationFrame(() => {
      frameB = null;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      const idleScheduler = window.requestIdleCallback;
      if (idleScheduler) {
        idleId = idleScheduler(runTask, { timeout: 2000 });
        return;
      }
      runTask();
    });
  });
  let frameB: number | null = null;
  let idleId: number | null = null;

  function runTask() {
    if (cancelled) return;
    cancelled = true;
    task();
  }

  return () => {
    cancelled = true;
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    if (frameA !== null) window.cancelAnimationFrame(frameA);
    if (frameB !== null) window.cancelAnimationFrame(frameB);
    if (idleId !== null) window.cancelIdleCallback?.(idleId);
  };
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SettingsState>(() => loadSettings());
  const [customThemeStore, setCustomThemeStore] = useState<StoredCustomTheme[]>(
    () => loadStoredCustomThemes(),
  );

  const customThemes = useMemo(
    () => buildCustomEntries(customThemeStore),
    [customThemeStore],
  );
  const themes = useMemo<ThemeEntry[]>(
    () => [...BUILTIN_THEMES, ...customThemes],
    [customThemes],
  );

  const activeTheme = useMemo<ThemeEntry>(() => {
    return (
      themes.find((theme) => theme.id === state.themeId) ?? BUILTIN_THEMES[0]
    );
  }, [themes, state.themeId]);

  /*
   * Combine the custom free-text override with the selected preset family,
   * then hand the joined string to the default resolver. Custom input wins
   * when both are set (per spec -- preset still lives in the fallback chain
   * so a locally-missing custom font degrades to the preset before the
   * stock system mono stack).
   */
  const resolvedFontStack = useMemo(() => {
    const preset = state.fontPresetId
      ? findClientPreset(state.fontPresetId)
      : undefined;
    const parts: string[] = [];
    const customTrimmed = state.customFontFamily.trim();
    if (customTrimmed.length > 0) parts.push(customTrimmed);
    if (preset) parts.push(preset.family);
    return resolveFontStack(parts.join(", "));
  }, [state.customFontFamily, state.fontPresetId]);

  const resolvedUiFontStack = useMemo(
    () => resolveFontStack(state.uiFontFamily, DEFAULT_UI_FONT_STACK),
    [state.uiFontFamily],
  );

  /*
   * Make sure the browser has the preset font loaded whenever the user
   * selects one. On first page load after a refresh, the @font-face rule
   * does not survive in memory -- we re-register it from the server-served
   * URL so xterm and the rest of the UI can actually resolve the family.
   * No-ops when the preset is not installed on this backend.
   */
  useEffect(() => {
    const preset = state.fontPresetId
      ? findClientPreset(state.fontPresetId)
      : undefined;
    if (!preset) return;
    return scheduleAfterInitialPaint(() => {
      void injectFontFace({
        family: preset.family,
        url: `/api/fonts/file/${preset.id}`,
      }).catch(() => {
        // Font not installed on this backend (404) or transient network
        // error -- UI will let the user re-install from Settings.
      });
    });
  }, [state.fontPresetId]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = activeTheme.mode;
    root.style.setProperty("--parasor-ui-font-size", `${state.uiFontSize}px`);
    root.style.setProperty("--parasor-ui-font", resolvedUiFontStack);
    root.style.setProperty(
      "--parasor-content-font-size",
      `${state.contentFontSize}px`,
    );
    root.style.setProperty("--parasor-font-size", `${state.contentFontSize}px`);
    root.style.setProperty("--parasor-content-font", resolvedFontStack);
    root.style.setProperty("--parasor-font", resolvedFontStack);
    for (const key of WORKBENCH_TOKEN_KEYS) {
      root.style.setProperty(key, activeTheme.tokens[key]);
    }
    // Cache the resolved tokens for the next cold load. The inline
    // pre-paint script in index.html reads this and applies it before
    // React mounts, eliminating first-paint flash for non-default themes.
    try {
      localStorage.setItem(
        ACTIVE_THEME_TOKENS_KEY,
        JSON.stringify(activeTheme.tokens),
      );
      localStorage.setItem(ACTIVE_THEME_MODE_KEY, activeTheme.mode);
    } catch {
      // localStorage unavailable -- degrade silently to first-paint flash.
    }
  }, [
    activeTheme,
    resolvedFontStack,
    resolvedUiFontStack,
    state.contentFontSize,
    state.uiFontSize,
  ]);

  useEffect(() => {
    saveSettings(state);
  }, [state]);

  useEffect(() => {
    saveCustomThemes(customThemeStore);
  }, [customThemeStore]);

  useEffect(() => {
    if (!themes.some((theme) => theme.id === state.themeId)) {
      setState((prev) => ({ ...prev, themeId: DEFAULT_THEME_ID }));
    }
  }, [themes, state.themeId]);

  const setThemeId = useCallback((id: string) => {
    setState((prev) => ({ ...prev, themeId: id }));
  }, []);

  const setUiFontSize = useCallback((size: number) => {
    const clamped = Math.min(
      UI_FONT_SIZE_RANGE.max,
      Math.max(UI_FONT_SIZE_RANGE.min, Math.round(size)),
    );
    setState((prev) => ({ ...prev, uiFontSize: clamped }));
  }, []);

  const setUiFontFamily = useCallback((family: string) => {
    setState((prev) => ({ ...prev, uiFontFamily: family }));
  }, []);

  const setContentFontSize = useCallback((size: number) => {
    const clamped = Math.min(
      CONTENT_FONT_SIZE_RANGE.max,
      Math.max(CONTENT_FONT_SIZE_RANGE.min, Math.round(size)),
    );
    setState((prev) => ({ ...prev, contentFontSize: clamped }));
  }, []);

  const setCustomFontFamily = useCallback((family: string) => {
    setState((prev) => ({ ...prev, customFontFamily: family }));
  }, []);

  const setFontPresetId = useCallback((id: string) => {
    setState((prev) => ({ ...prev, fontPresetId: id }));
  }, []);

  const setPlayAttentionSound = useCallback((enabled: boolean) => {
    setState((prev) => ({ ...prev, playAttentionSound: enabled }));
  }, []);

  const setPlayCompletionSound = useCallback((enabled: boolean) => {
    setState((prev) => ({ ...prev, playCompletionSound: enabled }));
  }, []);

  const addCustomTheme = useCallback(
    (input: CustomThemeInput): ThemeEntry => {
      const { entry, storedTheme } = createStoredCustomTheme(input, [
        ...BUILTIN_THEMES.map((theme) => theme.id),
        ...customThemeStore.map((theme) => theme.id),
      ]);
      setCustomThemeStore((prev) => [...prev, storedTheme]);
      return entry;
    },
    [customThemeStore],
  );

  const removeCustomTheme = useCallback((id: string) => {
    setCustomThemeStore((prev) => prev.filter((theme) => theme.id !== id));
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      ...state,
      themes,
      activeTheme,
      customThemes,
      resolvedFontStack,
      resolvedUiFontStack,
      setThemeId,
      setUiFontFamily,
      setUiFontSize,
      setContentFontSize,
      setCustomFontFamily,
      setFontPresetId,
      setPlayAttentionSound,
      setPlayCompletionSound,
      addCustomTheme,
      removeCustomTheme,
    }),
    [
      activeTheme,
      addCustomTheme,
      customThemes,
      removeCustomTheme,
      resolvedUiFontStack,
      resolvedFontStack,
      setContentFontSize,
      setCustomFontFamily,
      setFontPresetId,
      setPlayAttentionSound,
      setPlayCompletionSound,
      setUiFontFamily,
      setUiFontSize,
      setThemeId,
      state,
      themes,
    ],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return context;
}

export { CONTENT_FONT_SIZE_RANGE, UI_FONT_SIZE_RANGE };
