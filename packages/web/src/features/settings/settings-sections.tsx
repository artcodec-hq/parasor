import {
  type IdeCommandConfig,
  normalizeIdeCommands,
  type PortDetectionMode,
  type ServiceConfig,
} from "@parasor/shared";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { PaButton } from "../../components/primitives/index.js";
import { DEFAULT_UI_FONT_STACK, resolveFontStack } from "../../lib/fonts.js";
import { ThemeValidationError } from "../../lib/theme/loader.js";
import type { ThemeEntry } from "../../lib/theme/types.js";
import { FontPresetPicker } from "./FontPresetPicker.js";
import {
  CONTENT_FONT_SIZE_RANGE,
  type SettingsContextValue,
  UI_FONT_SIZE_RANGE,
} from "./SettingsProvider.js";

export interface SettingField {
  id: string;
  label: string;
  description?: string;
  keywords?: string[];
  render: () => ReactNode;
}

export interface SettingSection {
  id: string;
  label: string;
  fields: SettingField[];
}

export interface ServerSettingsBinding {
  serviceConfig: ServiceConfig;
  hostPlatform: NodeJS.Platform | null;
  onPreventIdleSleepChange: (enabled: boolean) => void;
  onPortDetectionChange: (mode: PortDetectionMode) => void;
  onDropSizeMaxBytesChange: (bytes: number) => void;
  ideCommands?: IdeCommandConfig[];
  onIdeCommandsChange?: (commands: IdeCommandConfig[]) => void;
}

export function useSettingsSections(
  settings: SettingsContextValue,
  server?: ServerSettingsBinding,
): SettingSection[] {
  const {
    addCustomTheme,
    contentFontSize,
    customFontFamily,
    fontPresetId,
    playAttentionSound,
    playCompletionSound,
    removeCustomTheme,
    setContentFontSize,
    setCustomFontFamily,
    setFontPresetId,
    setPlayAttentionSound,
    setPlayCompletionSound,
    setThemeId,
    setUiFontFamily,
    setUiFontSize,
    themeId,
    themes,
    uiFontFamily,
    uiFontSize,
  } = settings;

  const serviceConfig = server?.serviceConfig;
  const hostPlatform = server?.hostPlatform ?? null;
  const onPreventIdleSleepChange = server?.onPreventIdleSleepChange;
  const onPortDetectionChange = server?.onPortDetectionChange;
  const onDropSizeMaxBytesChange = server?.onDropSizeMaxBytesChange;
  const ideCommands = server?.ideCommands;
  const onIdeCommandsChange = server?.onIdeCommandsChange;

  return useMemo<SettingSection[]>(() => {
    const sections: SettingSection[] = [
      {
        id: "theme",
        label: "Theme",
        fields: [
          {
            id: "color-theme",
            label: "Color theme",
            description:
              "Choose a bundled theme or paste a VS Code--compatible color theme JSON.",
            keywords: ["theme", "color", "palette", "dark", "light"],
            render: () => (
              <ThemePicker
                value={themeId}
                themes={themes}
                onAdd={addCustomTheme}
                onChange={setThemeId}
                onRemove={removeCustomTheme}
              />
            ),
          },
        ],
      },
      {
        id: "font",
        label: "Font",
        fields: [
          {
            id: "ui-font-family",
            label: "UI font family",
            description:
              "Custom font-family stack for chrome, sidebars, menus, dialogs, and controls. Leave empty to use the system font.",
            keywords: [
              "font",
              "family",
              "custom",
              "override",
              "ui",
              "chrome",
              "sidebar",
              "controls",
              "system",
            ],
            render: () => (
              <FontFamilyInput
                value={uiFontFamily}
                onChange={setUiFontFamily}
                previewFontSize={uiFontSize}
                defaultStack={DEFAULT_UI_FONT_STACK}
                placeholder="System default"
                previewLines={PREVIEW_LINES_UI}
              />
            ),
          },
          {
            id: "ui-font-size",
            label: "UI font size",
            description:
              "Base size for chrome, sidebars, menus, dialogs, and controls.",
            keywords: [
              "font",
              "size",
              "zoom",
              "text",
              "scale",
              "ui",
              "chrome",
              "sidebar",
              "controls",
            ],
            render: () => (
              <FontSizeStepper
                value={uiFontSize}
                range={UI_FONT_SIZE_RANGE}
                onChange={setUiFontSize}
              />
            ),
          },
          {
            id: "font-preset",
            label: "Content font preset",
            description:
              "Bundled OFL monospace font used by terminal and editor content. Downloaded from GitHub Releases on first use for CJK-aligned or Latin-optimized rendering.",
            keywords: [
              "font",
              "preset",
              "mono",
              "terminal",
              "japanese",
              "cjk",
              "udev",
              "plemol",
              "sarasa",
              "jetbrains",
              "fira",
              "install",
              "download",
            ],
            render: () => (
              <FontPresetPicker
                selectedPresetId={fontPresetId}
                onSelect={setFontPresetId}
              />
            ),
          },
          {
            id: "custom-font",
            label: "Content custom font family",
            description:
              "Custom monospace stack for terminal and editor content. Overrides the preset; leave empty to use the preset, or the default content stack when no preset is selected.",
            keywords: [
              "font",
              "family",
              "custom",
              "override",
              "jetbrains",
              "fira",
              "hack",
              "nerd",
            ],
            render: () => (
              <FontFamilyInput
                value={customFontFamily}
                onChange={setCustomFontFamily}
                previewFontSize={contentFontSize}
                presetId={fontPresetId}
              />
            ),
          },
          {
            id: "content-font-size",
            label: "Content font size",
            description: "Base size for terminal and editor content.",
            keywords: [
              "font",
              "size",
              "zoom",
              "text",
              "scale",
              "content",
              "terminal",
              "editor",
              "code",
            ],
            render: () => (
              <FontSizeStepper
                value={contentFontSize}
                range={CONTENT_FONT_SIZE_RANGE}
                onChange={setContentFontSize}
              />
            ),
          },
        ],
      },
      {
        id: "sounds",
        label: "Sounds",
        fields: [
          {
            id: "attention-sound",
            label: "Play sound when an agent needs attention",
            description:
              "Plays through the active browser tab when an agent enters a waiting state in a background project. Audio unlocks on first tap; mobile browsers may mute backgrounded tabs.",
            keywords: ["sound", "audio", "attention", "waiting", "notify"],
            render: () => (
              <SettingToggle
                checked={playAttentionSound}
                onChange={setPlayAttentionSound}
                label="Enable attention sound"
              />
            ),
          },
          {
            id: "completion-sound",
            label: "Play sound when an agent completes",
            description:
              "Plays through the active browser tab when an agent finishes work in a background project. Audio unlocks on first tap; mobile browsers may mute backgrounded tabs.",
            keywords: ["sound", "audio", "completion", "done", "review"],
            render: () => (
              <SettingToggle
                checked={playCompletionSound}
                onChange={setPlayCompletionSound}
                label="Enable completion sound"
              />
            ),
          },
        ],
      },
    ];

    const systemFields: SettingField[] = [];
    if (
      hostPlatform === "darwin" &&
      serviceConfig &&
      onPreventIdleSleepChange
    ) {
      systemFields.push({
        id: "prevent-idle-sleep",
        label: "Prevent idle sleep while attached",
        description:
          "Keeps this Mac awake while a browser tab is connected so long-running agents are not interrupted by sleep. Uses `caffeinate -i`; released on last disconnect.",
        keywords: [
          "sleep",
          "idle",
          "caffeinate",
          "mac",
          "macos",
          "power",
          "display",
          "wake",
        ],
        render: () => (
          <SettingToggle
            checked={serviceConfig.preventIdleSleep}
            onChange={onPreventIdleSleepChange}
            label="Keep Mac awake while browser tabs are connected"
          />
        ),
      });
    }
    if (serviceConfig && onPortDetectionChange) {
      systemFields.push({
        id: "port-detection",
        label: "Track dev server ports",
        description:
          "Marks newly detected reachable ports in the sidebar network menu. Loopback-only ports are listed but cannot be opened from remote devices.",
        keywords: [
          "port",
          "dev server",
          "preview",
          "tailscale",
          "mobile",
          "iphone",
          "network",
        ],
        render: () => (
          <SettingToggle
            checked={serviceConfig.portDetection === "all-interfaces"}
            onChange={(enabled) =>
              onPortDetectionChange(enabled ? "all-interfaces" : "off")
            }
            label="Show a toast when a public dev server port is detected"
          />
        ),
      });
    }
    if (serviceConfig && onDropSizeMaxBytesChange) {
      systemFields.push({
        id: "drop-size-max",
        label: "File drop size limit",
        description:
          "Per-file cap for Terminal drop-to-upload. The server enforces a hard cap above this limit regardless of the setting.",
        keywords: ["upload", "drop", "file", "size", "limit", "quota", "cap"],
        render: () => (
          <DropSizePicker
            valueBytes={serviceConfig.dropSizeMaxBytes}
            hardMaxBytes={serviceConfig.dropSizeHardMaxBytes}
            onChange={onDropSizeMaxBytesChange}
          />
        ),
      });
    }
    if (systemFields.length > 0) {
      sections.push({
        id: "system",
        label: "System",
        fields: systemFields,
      });
    }
    if (ideCommands && onIdeCommandsChange) {
      sections.push({
        id: "ide",
        label: "IDE",
        fields: [
          {
            id: "ide-commands",
            label: "Custom IDE commands",
            description:
              "Additional Open in IDE actions for worktree menus. Arguments are fixed argv entries, one per line; no shell is used.",
            keywords: [
              "ide",
              "editor",
              "zed",
              "windsurf",
              "intellij",
              "cursor",
              "vscode",
              "worktree",
              "open",
            ],
            render: () => (
              <IdeCommandsEditor
                commands={ideCommands}
                onChange={onIdeCommandsChange}
              />
            ),
          },
        ],
      });
    }

    return sections;
  }, [
    addCustomTheme,
    contentFontSize,
    customFontFamily,
    fontPresetId,
    hostPlatform,
    ideCommands,
    onDropSizeMaxBytesChange,
    onIdeCommandsChange,
    onPortDetectionChange,
    onPreventIdleSleepChange,
    playAttentionSound,
    playCompletionSound,
    removeCustomTheme,
    serviceConfig,
    setContentFontSize,
    setCustomFontFamily,
    setFontPresetId,
    setPlayAttentionSound,
    setPlayCompletionSound,
    setThemeId,
    setUiFontFamily,
    setUiFontSize,
    themeId,
    themes,
    uiFontFamily,
    uiFontSize,
  ]);
}

function IdeCommandsEditor({
  commands,
  onChange,
}: {
  commands: IdeCommandConfig[];
  onChange: (commands: IdeCommandConfig[]) => void;
}) {
  const [drafts, setDrafts] = useState<IdeCommandDraft[]>(() =>
    commands.map(toIdeCommandDraft),
  );

  useEffect(() => {
    setDrafts(commands.map(toIdeCommandDraft));
  }, [commands]);

  const normalized = normalizeIdeCommands(drafts);
  const invalid = drafts.length !== normalized.length;
  const changed = JSON.stringify(normalized) !== JSON.stringify(commands);

  const update = (index: number, patch: Partial<IdeCommandConfig>): void => {
    setDrafts((current) =>
      current.map((command, i) =>
        i === index ? { ...command, ...patch } : command,
      ),
    );
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {drafts.map((command, index) => (
          <div
            key={command.draftKey}
            className="space-y-2 rounded-control border border-border bg-bg-secondary p-3"
          >
            <div className="grid gap-2 md:grid-cols-3">
              <label className="block text-xs text-text-secondary">
                ID
                <input
                  type="text"
                  value={command.id}
                  onChange={(event) =>
                    update(index, { id: event.target.value })
                  }
                  placeholder="zed"
                  className="mt-1 w-full rounded-control border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
                />
              </label>
              <label className="block text-xs text-text-secondary">
                Label
                <input
                  type="text"
                  value={command.label}
                  onChange={(event) =>
                    update(index, { label: event.target.value })
                  }
                  placeholder="Zed"
                  className="mt-1 w-full rounded-control border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
                />
              </label>
              <label className="block text-xs text-text-secondary">
                Command
                <input
                  type="text"
                  value={command.command}
                  onChange={(event) =>
                    update(index, { command: event.target.value })
                  }
                  placeholder="zed"
                  className="mt-1 w-full rounded-control border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
                />
              </label>
            </div>
            <label className="block text-xs text-text-secondary">
              Arguments
              <textarea
                value={command.args.join("\n")}
                onChange={(event) =>
                  update(index, {
                    args: event.target.value
                      .split("\n")
                      .map((arg) => arg.trim())
                      .filter(Boolean),
                  })
                }
                rows={3}
                placeholder="{path}"
                className="mt-1 w-full resize-y rounded-control border border-border bg-bg-primary px-2 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                spellCheck={false}
              />
            </label>
            <div className="flex justify-end">
              <PaButton
                kind="normal"
                onClick={() =>
                  setDrafts((current) => current.filter((_, i) => i !== index))
                }
              >
                Remove
              </PaButton>
            </div>
          </div>
        ))}
      </div>
      {drafts.length === 0 && (
        <div className="rounded-control border border-dashed border-border px-3 py-2 text-sm text-text-secondary">
          No custom IDE commands
        </div>
      )}
      {invalid && (
        <div className="rounded-control border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-warning">
          Each command needs a unique non-built-in ID, a label, and a command.
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <PaButton
          kind="normal"
          onClick={() =>
            setDrafts((current) => [
              ...current,
              toIdeCommandDraft({
                id: "",
                label: "",
                command: "",
                args: ["{path}"],
              }),
            ])
          }
        >
          Add
        </PaButton>
        <PaButton
          kind="submit"
          disabled={invalid || !changed}
          onClick={() => onChange(normalized)}
        >
          Save
        </PaButton>
      </div>
    </div>
  );
}

interface IdeCommandDraft extends IdeCommandConfig {
  draftKey: string;
}

function toIdeCommandDraft(command: IdeCommandConfig): IdeCommandDraft {
  return {
    ...command,
    draftKey: Math.random().toString(36).slice(2),
  };
}

function SettingToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-3 rounded-control border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-accent"
      />
      <span>{label}</span>
    </label>
  );
}

function DropSizePicker({
  valueBytes,
  hardMaxBytes,
  onChange,
}: {
  valueBytes: number;
  hardMaxBytes: number;
  onChange: (bytes: number) => void;
}) {
  /**
   * Presets reflect typical paste / screenshot / small-asset sizes. We
   * deliberately skip values above the server hard cap (filter below);
   * increasing the cap is an operator task, not a per-user setting. Rendered
   * with a native select to sidestep the a11y-radio bike-shed.
   */
  const options: { value: number; label: string }[] = [
    { value: 1 * 1024 * 1024, label: "1 MB" },
    { value: 5 * 1024 * 1024, label: "5 MB" },
    { value: 10 * 1024 * 1024, label: "10 MB" },
    { value: 25 * 1024 * 1024, label: "25 MB" },
    { value: 50 * 1024 * 1024, label: "50 MB" },
    { value: 100 * 1024 * 1024, label: "100 MB" },
  ];
  const shown = options.filter((o) => o.value <= hardMaxBytes);
  return (
    <select
      aria-label="File drop size limit"
      className="rounded-control border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-primary"
      value={valueBytes}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {shown.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function ThemePicker({
  value,
  themes,
  onChange,
  onAdd,
  onRemove,
}: {
  value: string;
  themes: ThemeEntry[];
  onChange: (id: string) => void;
  onAdd: SettingsContextValue["addCustomTheme"];
  onRemove: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [json, setJson] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setAdding(false);
    setName("");
    setJson("");
    setError(null);
  };

  const handleSave = () => {
    setError(null);
    try {
      const entry = onAdd({ name, json });
      onChange(entry.id);
      reset();
    } catch (error) {
      if (error instanceof ThemeValidationError) {
        setError(error.message);
      } else {
        setError((error as Error).message || "Failed to add theme");
      }
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1.5">
        {themes.map((theme) => (
          <ThemeRadio
            key={theme.id}
            theme={theme}
            selected={value === theme.id}
            onRemove={
              theme.source === "custom" ? () => onRemove(theme.id) : undefined
            }
            onSelect={() => onChange(theme.id)}
          />
        ))}
      </div>

      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-control border border-dashed border-border px-3 py-1.5 text-xs text-text-secondary hover:border-accent hover:text-text-primary"
        >
          <span aria-hidden>+</span>
          <span>Add theme</span>
        </button>
      ) : (
        <div className="space-y-2 rounded-control border border-border bg-bg-secondary p-3">
          <label className="block text-xs text-text-secondary">
            Name
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My Theme"
              className="mt-1 w-full rounded-control border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
            />
          </label>
          <label className="block text-xs text-text-secondary">
            Theme JSON
            <textarea
              value={json}
              onChange={(event) => setJson(event.target.value)}
              rows={8}
              placeholder='{ "name": "...", "type": "dark", "colors": { ... } }'
              className="mt-1 w-full resize-y rounded-control border border-border bg-bg-primary px-2 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
              spellCheck={false}
            />
          </label>
          {error && (
            <div className="rounded-control border border-danger/40 bg-danger/10 px-2 py-1.5 text-xs text-danger">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <PaButton kind="normal" onClick={reset}>
              Cancel
            </PaButton>
            <PaButton kind="submit" onClick={handleSave}>
              Save
            </PaButton>
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeRadio({
  theme,
  selected,
  onSelect,
  onRemove,
}: {
  theme: ThemeEntry;
  selected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  const background = theme.tokens["--theme-editor-bg"];
  const foreground = theme.tokens["--theme-editor-fg"];
  const accent = theme.tokens["--theme-link-fg"];

  return (
    <div
      className={`
        flex items-center gap-3 rounded-control border px-3 py-2 text-sm transition-colors
        ${
          selected
            ? "border-accent bg-accent/10"
            : "border-border hover:bg-bg-secondary"
        }
      `}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex flex-1 items-center gap-3 text-left"
      >
        <span
          className="flex h-6 w-10 shrink-0 overflow-hidden rounded-control border border-border"
          aria-hidden
        >
          <span className="flex-1" style={{ background }} />
          <span className="flex-1" style={{ background: foreground }} />
          <span className="flex-1" style={{ background: accent }} />
        </span>
        <span className="flex-1 truncate">{theme.name}</span>
        <span className="text-xs text-text-secondary">{theme.mode}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${theme.name}`}
          className="rounded-control p-1 text-text-secondary hover:bg-danger/20 hover:text-danger"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M5.7 4.3a1 1 0 0 0-1.4 1.4L8.6 10l-4.3 4.3a1 1 0 1 0 1.4 1.4L10 11.4l4.3 4.3a1 1 0 0 0 1.4-1.4L11.4 10l4.3-4.3a1 1 0 0 0-1.4-1.4L10 8.6 5.7 4.3Z" />
          </svg>
        </button>
      )}
    </div>
  );
}

/*
 * Sample lines per active preset so the preview shows what THAT font
 * actually draws -- a Latin-only font like Fira Code never falls back to
 * the system Japanese font, a Korean preset shows Hangul, etc.
 */
const PREVIEW_LINES_LATIN = [
  "The quick brown fox jumps => != -> >=",
  "if (count !== 0) return items.map(fn);",
  "0123456789  {}[]<>()  + - * / =",
];
const PREVIEW_LINES_UI = [
  "Settings, sidebars, menus, and dialogs",
  "Project status: Running  0123456789",
  "日本語 UI text  アイコン  ラベル",
];
const PREVIEW_LINES_JP = [
  "The quick brown fox jumps => != -> >=",
  "素早い茶色の狐が跳ぶ 日本語 漢字あいう",
  "ひらがな カタカナ 漢字 0123456789",
];
const PREVIEW_LINES_KR = [
  "The quick brown fox jumps => != -> >=",
  "다람쥐 헌 쳇바퀴에 타고파 한글 코딩",
  "가나다라 ㄱㄴㄷㄹㅁㅂㅅ 0123456789",
];
const PREVIEW_LINES_SC = [
  "The quick brown fox jumps => != -> >=",
  "敏捷的棕色狐狸跳过懒狗 简体中文",
  "你好世界 编程字体 0123456789",
];

function pickPreviewLines(presetId: string, hasCustom: boolean): string[] {
  // Custom override and unselected default both fall back to a Latin-only
  // sample so the picker has no locale bias when nothing is chosen.
  if (hasCustom) return PREVIEW_LINES_LATIN;
  switch (presetId) {
    case "udev-gothic":
      return PREVIEW_LINES_JP;
    case "d2-coding":
      return PREVIEW_LINES_KR;
    case "maple-mono-cn":
      return PREVIEW_LINES_SC;
    default:
      return PREVIEW_LINES_LATIN;
  }
}

function FontFamilyInput({
  value,
  onChange,
  previewFontSize,
  defaultStack,
  placeholder = "Default",
  presetId = "",
  previewLines,
}: {
  value: string;
  onChange: (family: string) => void;
  previewFontSize: number;
  defaultStack?: string;
  placeholder?: string;
  presetId?: string;
  previewLines?: string[];
}) {
  // Match the apply-side stack exactly: `resolveFontStack` quotes
  // multi-word families and falls back to the requested default when empty,
  // so the preview reflects what the page will actually render.
  const effectiveStack = resolveFontStack(value, defaultStack);
  const shownPreviewLines =
    previewLines ?? pickPreviewLines(presetId, value.trim().length > 0);

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="w-full rounded-control border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
      />
      <div
        className="rounded-control border border-border bg-bg-secondary px-3 py-2 text-text-primary"
        style={{
          fontFamily: effectiveStack,
          fontSize: `${previewFontSize}px`,
          lineHeight: 1.5,
        }}
      >
        {shownPreviewLines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </div>
  );
}

function FontSizeStepper({
  value,
  range,
  onChange,
}: {
  value: number;
  range: { min: number; max: number };
  onChange: (value: number) => void;
}) {
  const atMin = value <= range.min;
  const atMax = value >= range.max;

  return (
    <div className="inline-flex items-center overflow-hidden rounded-control border border-border">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={atMin}
        aria-label="Decrease font size"
        className="px-3 py-1.5 text-sm text-text-primary enabled:hover:bg-bg-secondary disabled:opacity-40"
      >
        −
      </button>
      <span className="min-w-14 border-x border-border px-3 py-1.5 text-center text-sm tabular-nums">
        {value}px
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={atMax}
        aria-label="Increase font size"
        className="px-3 py-1.5 text-sm text-text-primary enabled:hover:bg-bg-secondary disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
