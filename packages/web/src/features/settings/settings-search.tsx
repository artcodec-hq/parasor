import { useMemo } from "react";
import type { SettingsContextValue } from "./SettingsProvider.js";
import type {
  ServerSettingsBinding,
  SettingField,
  SettingSection,
} from "./settings-sections.js";
import { useSettingsSections } from "./settings-sections.js";

export function useFilteredSettingsResults(
  settings: SettingsContextValue,
  query: string,
  server?: ServerSettingsBinding,
) {
  const sections = useSettingsSections(settings, server);
  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  const searchResults = useMemo(
    () =>
      isSearching
        ? sections.flatMap((section) =>
            section.fields
              .filter((field) => {
                const haystack = [
                  section.label,
                  field.label,
                  field.description ?? "",
                  ...(field.keywords ?? []),
                ]
                  .join(" ")
                  .toLowerCase();
                return haystack.includes(normalizedQuery);
              })
              .map((field) => ({ section, field })),
          )
        : [],
    [isSearching, normalizedQuery, sections],
  );

  return { isSearching, searchResults, sections };
}

export function FieldRow({ field }: { field: SettingField }) {
  if (field.layout === "row") {
    return (
      <div className="flex min-h-12 flex-col gap-2 border-b border-border/60 py-3 last:border-b-0 md:flex-row md:items-center md:gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary">
            {field.label}
          </div>
          {field.description && (
            <div className="text-xs text-text-secondary">
              {field.description}
            </div>
          )}
        </div>
        <div className="shrink-0 md:max-w-[18rem]">{field.render()}</div>
      </div>
    );
  }

  return (
    <div className="space-y-2 pb-1">
      <div>
        <div className="text-sm font-semibold text-text-primary">
          {field.label}
        </div>
        {field.description && (
          <div className="text-xs text-text-secondary">{field.description}</div>
        )}
      </div>
      {field.render()}
    </div>
  );
}

export type { SettingField, SettingSection };
