import { useCallback, useEffect, useState } from "react";
import { injectFontFace } from "../../lib/font-loader.js";
import {
  type CatalogEntry,
  CLIENT_FONT_PRESETS,
  type ClientFontPreset,
  fetchCatalog,
  requestInstall,
} from "./font-presets.js";

/*
 * Settings tile that lists the server-provisioned OFL monospace presets and
 * lets the user install + apply one with a single click. Keeps its own
 * catalog state separate from SettingsProvider so a background refresh
 * (install completed, user switched backend) can refetch without rerunning
 * the whole Settings tree.
 */

type InstallState = "idle" | "installing";

interface PresetRowState {
  installed: boolean;
  installState: InstallState;
  error: string | null;
}

export interface FontPresetPickerProps {
  selectedPresetId: string;
  onSelect: (id: string) => void;
}

export function FontPresetPicker({
  selectedPresetId,
  onSelect,
}: FontPresetPickerProps) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>(() =>
    CLIENT_FONT_PRESETS.map((preset) => ({ ...preset, installed: false })),
  );
  const [rowStates, setRowStates] = useState<Record<string, PresetRowState>>(
    () =>
      Object.fromEntries(
        CLIENT_FONT_PRESETS.map((preset) => [
          preset.id,
          {
            installed: false,
            installState: "idle" as InstallState,
            error: null,
          },
        ]),
      ),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const entries = await fetchCatalog();
      if (cancelled) return;
      setCatalog(entries);
      setRowStates((prev) => {
        const next = { ...prev };
        for (const entry of entries) {
          next[entry.id] = {
            installed: entry.installed,
            installState: "idle",
            error: null,
          };
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleApply = useCallback(
    async (preset: ClientFontPreset, installed: boolean) => {
      setRowStates((prev) => {
        const current = prev[preset.id] ?? {
          installed,
          installState: "idle",
          error: null,
        };
        return {
          ...prev,
          [preset.id]: {
            ...current,
            installState: installed ? "idle" : "installing",
            error: null,
          },
        };
      });
      try {
        if (!installed) {
          const result = await requestInstall(preset.id);
          await injectFontFace({
            family: result.family,
            url: result.url,
          });
          setRowStates((prev) => ({
            ...prev,
            [preset.id]: {
              installed: true,
              installState: "idle",
              error: null,
            },
          }));
          setCatalog((prev) =>
            prev.map((entry) =>
              entry.id === preset.id ? { ...entry, installed: true } : entry,
            ),
          );
        } else {
          await injectFontFace({
            family: preset.family,
            url: `/api/fonts/file/${preset.id}`,
          });
        }
        onSelect(preset.id);
      } catch (error) {
        setRowStates((prev) => {
          const current = prev[preset.id] ?? {
            installed,
            installState: "idle",
            error: null,
          };
          return {
            ...prev,
            [preset.id]: {
              ...current,
              installState: "idle",
              error: (error as Error).message,
            },
          };
        });
      }
    },
    [onSelect],
  );

  const handleUseDefault = useCallback(() => {
    onSelect("");
  }, [onSelect]);

  const latin = catalog.filter((entry) => entry.category === "latin");
  const asian = catalog.filter((entry) => entry.category === "asian");

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleUseDefault}
        aria-pressed={selectedPresetId === ""}
        className={`flex w-full items-center justify-between rounded-control border px-2.5 py-1.5 text-left text-sm transition-colors ${
          selectedPresetId === ""
            ? "border-accent bg-accent/10 text-text-primary"
            : "border-border text-text-secondary hover:bg-bg-secondary"
        }`}
      >
        <span>Use system monospace default</span>
        <span className="text-xs text-text-secondary">
          No download · fallback stack only
        </span>
      </button>

      <PresetCategory
        heading="Latin"
        presets={latin}
        rowStates={rowStates}
        selectedPresetId={selectedPresetId}
        onApply={handleApply}
      />
      <PresetCategory
        heading="Asian (2:1 CJK alignment)"
        presets={asian}
        rowStates={rowStates}
        selectedPresetId={selectedPresetId}
        onApply={handleApply}
      />
    </div>
  );
}

function PresetCategory({
  heading,
  presets,
  rowStates,
  selectedPresetId,
  onApply,
}: {
  heading: string;
  presets: CatalogEntry[];
  rowStates: Record<string, PresetRowState>;
  selectedPresetId: string;
  onApply: (preset: ClientFontPreset, installed: boolean) => Promise<void>;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {heading}
      </div>
      <div className="flex flex-col gap-1">
        {presets.map((preset) => {
          const rowState = rowStates[preset.id] ?? {
            installed: preset.installed,
            installState: "idle" as InstallState,
            error: null,
          };
          return (
            <PresetRow
              key={preset.id}
              preset={preset}
              rowState={rowState}
              selected={selectedPresetId === preset.id}
              onApply={() => onApply(preset, rowState.installed)}
            />
          );
        })}
      </div>
    </div>
  );
}

function PresetRow({
  preset,
  rowState,
  selected,
  onApply,
}: {
  preset: CatalogEntry;
  rowState: PresetRowState;
  selected: boolean;
  onApply: () => Promise<void>;
}) {
  const { installed, installState, error } = rowState;
  const busy = installState === "installing";
  const buttonLabel = installed
    ? "Apply"
    : `Install & apply (${preset.zipSizeMb}MB)`;

  return (
    <div
      className={`rounded-control border px-2.5 py-1.5 ${
        selected
          ? "border-accent bg-accent/10"
          : "border-border hover:bg-bg-secondary"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-text-primary">
              {preset.name}
            </span>
            {installed && (
              <span className="rounded-control bg-success/20 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-success">
                Installed
              </span>
            )}
            {selected && (
              <span className="rounded-control bg-accent/20 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-accent">
                Active
              </span>
            )}
          </div>
          <div className="text-xs text-text-secondary">
            {preset.description}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            void onApply();
          }}
          disabled={busy || selected}
          className="whitespace-nowrap rounded-control border border-border px-3 py-1.5 text-xs text-text-primary enabled:hover:bg-bg-primary disabled:opacity-40"
        >
          {busy ? "Downloading…" : buttonLabel}
        </button>
      </div>
      {error && (
        <div className="mt-2 rounded-control border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger">
          {error}
        </div>
      )}
    </div>
  );
}
