import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  DialogCloseButton,
  DialogRoot,
  PaGlyph,
} from "../../components/primitives/index.js";
import { useMediaQuery } from "../../hooks/useMediaQuery.js";
import { useSettings } from "./SettingsProvider.js";
import { FieldRow, useFilteredSettingsResults } from "./settings-search.js";
import type { ServerSettingsBinding } from "./settings-sections.js";

interface SettingsOverlayProps {
  open: boolean;
  onClose: () => void;
  server?: ServerSettingsBinding;
}

/**
 * Mobile-first settings overlay.
 *
 * < md: drill-down. Layer 1 = section list with inline search,
 *   Layer 2 = section detail (back ← + label). Dialog fills the
 *   viewport and respects safe-area insets for iOS notch/home bar.
 * ≥ md: persistent dual-pane (200px section rail + content).
 */
export function SettingsOverlay({
  open,
  onClose,
  server,
}: SettingsOverlayProps) {
  const settings = useSettings();
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { isSearching, searchResults, sections } = useFilteredSettingsResults(
    settings,
    query,
    server,
  );

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      // Mobile drill-down: Esc on Layer 2 returns to Layer 1.
      if (!isDesktop && activeId !== null) {
        setActiveId(null);
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeId, isDesktop, onClose, open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveId(null);
    }
  }, [open]);

  // Auto-select the first section on desktop only -- mobile starts on
  // the list layer.
  useEffect(() => {
    if (!open) return;
    if (!isDesktop) return;
    if (activeId !== null) return;
    if (sections.length === 0) return;
    setActiveId(sections[0].id);
  }, [open, isDesktop, activeId, sections]);

  const activeSection = useMemo(
    () => sections.find((s) => s.id === activeId) ?? null,
    [sections, activeId],
  );

  if (!open) return null;

  const showListPane = isDesktop || activeId === null;
  const showDetailPane = isDesktop || activeId !== null;

  return createPortal(
    <DialogRoot
      open={open}
      ariaLabel="Settings"
      onClose={onClose}
      closeOnEscape={false}
      presentation={isDesktop ? "modal" : "fullscreen"}
      backdropClassName="bg-black/35"
      widthClassName="w-surface-lg max-w-[96vw]"
      panelClassName={
        isDesktop
          ? "flex h-[560px] max-h-[92vh] flex-col overflow-hidden text-text-primary"
          : "min-h-0 flex-col pt-[env(safe-area-inset-top)] text-text-primary"
      }
    >
      <SettingsHeader
        title={
          isDesktop
            ? "Settings"
            : activeId === null
              ? "Settings"
              : isSearching
                ? "Search results"
                : (activeSection?.label ?? "Settings")
        }
        onBack={
          !isDesktop && activeId !== null ? () => setActiveId(null) : null
        }
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {showListPane && (
          <ListPane
            sections={sections}
            activeId={activeId}
            onSelect={setActiveId}
            query={query}
            onQueryChange={setQuery}
            isDesktop={isDesktop}
            isSearching={isSearching}
            searchResults={searchResults}
          />
        )}
        {showDetailPane && (
          <DetailPane
            activeSection={activeSection}
            isDesktop={isDesktop}
            isSearching={isSearching}
            searchResults={searchResults}
          />
        )}
      </div>
    </DialogRoot>,
    document.body,
  );
}

function SettingsHeader({
  title,
  onBack,
  onClose,
}: {
  title: string;
  onBack: (() => void) | null;
  onClose: () => void;
}) {
  return (
    <div className="flex h-bar shrink-0 items-center gap-2 border-b border-border px-3">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to sections"
          className="inline-flex h-7 w-7 items-center justify-center rounded-control text-text-secondary hover:bg-row-hover-bg hover:text-text-primary focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          <PaGlyph.back />
        </button>
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
        {title}
      </span>
      <DialogCloseButton onClick={onClose} />
    </div>
  );
}

interface ListPaneProps {
  sections: ReturnType<typeof useFilteredSettingsResults>["sections"];
  activeId: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
  isDesktop: boolean;
  isSearching: boolean;
  searchResults: ReturnType<typeof useFilteredSettingsResults>["searchResults"];
}

function ListPane({
  sections,
  activeId,
  onSelect,
  query,
  onQueryChange,
  isDesktop,
  isSearching,
  searchResults,
}: ListPaneProps) {
  // Mobile when searching: render flat results inline (replacing the
  // section nav). Desktop: results land in the detail pane, so the
  // rail keeps showing nav.
  const showInlineResults = !isDesktop && isSearching;

  return (
    <aside className="flex w-full min-w-0 flex-col md:w-[220px] md:shrink-0 md:border-r md:border-border">
      <div className="border-b border-border px-3 py-2 md:px-2.5">
        <label className="flex h-9 items-center gap-1.5 rounded-control border border-border bg-bg-tertiary px-2.5 text-text-secondary focus-within:border-accent md:h-7">
          <span aria-hidden className="inline-flex shrink-0">
            <PaGlyph.search />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search…"
            className="min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-secondary focus:outline-none"
          />
        </label>
      </div>
      <div className="cm-scroll min-h-0 flex-1 overflow-y-auto pb-[max(env(safe-area-inset-bottom),0.5rem)] md:pb-2">
        {showInlineResults ? (
          <FlatResultsList results={searchResults} />
        ) : (
          <nav className="px-1.5 py-1.5">
            {sections.map((section) => {
              const active = section.id === activeId;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onSelect(section.id)}
                  className={`flex h-10 w-full items-center gap-2 rounded-control px-2.5 text-left text-sm text-text-primary md:h-8 ${
                    active
                      ? "bg-row-active-bg font-semibold"
                      : "font-normal hover:bg-row-hover-bg"
                  }`}
                >
                  <span className="flex-1 truncate">{section.label}</span>
                  <span aria-hidden className="text-text-secondary md:hidden">
                    <PaGlyph.disclosure className="h-4 w-4" />
                  </span>
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </aside>
  );
}

function FlatResultsList({
  results,
}: {
  results: ReturnType<typeof useFilteredSettingsResults>["searchResults"];
}) {
  if (results.length === 0) {
    return (
      <div className="px-4 py-4 text-sm text-text-secondary">
        No matching settings.
      </div>
    );
  }
  return (
    <div className="space-y-6 px-4 py-4">
      {results.map(({ section, field }) => (
        <div key={`${section.id}-${field.id}`} className="space-y-2">
          <div className="text-xs uppercase tracking-[0.06em] text-text-secondary">
            {section.label}
          </div>
          <FieldRow field={field} />
        </div>
      ))}
    </div>
  );
}

interface DetailPaneProps {
  activeSection:
    | ReturnType<typeof useFilteredSettingsResults>["sections"][number]
    | null;
  isDesktop: boolean;
  isSearching: boolean;
  searchResults: ReturnType<typeof useFilteredSettingsResults>["searchResults"];
}

function DetailPane({
  activeSection,
  isDesktop,
  isSearching,
  searchResults,
}: DetailPaneProps) {
  return (
    <section className="flex min-w-0 min-h-0 flex-1 flex-col">
      <div className="cm-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] md:px-5">
        {isSearching ? (
          searchResults.length === 0 ? (
            <div className="text-sm text-text-secondary">
              No matching settings.
            </div>
          ) : (
            <div className="space-y-6">
              {isDesktop && (
                <div className="text-xs font-medium text-text-secondary">
                  Search results
                </div>
              )}
              {searchResults.map(({ section, field }) => (
                <div key={`${section.id}-${field.id}`} className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.06em] text-text-secondary">
                    {section.label}
                  </div>
                  <FieldRow field={field} />
                </div>
              ))}
            </div>
          )
        ) : activeSection ? (
          <div className="space-y-6">
            {isDesktop && (
              <div className="text-xs font-medium text-text-secondary">
                {activeSection.label}
              </div>
            )}
            {activeSection.fields.map((field) => (
              <FieldRow key={field.id} field={field} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
