export interface PaTabOption<T extends string> {
  value: T;
  label: string;
}

interface PaTabsProps<T extends string> {
  value: T;
  options: readonly PaTabOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

/**
 * Underline-style category tabs, e.g. modal section navigation.
 */
export function PaTabs<T extends string>({
  value,
  options,
  onChange,
  className,
}: PaTabsProps<T>) {
  return (
    <div
      role="tablist"
      className={`flex min-w-0 border-b border-border${className ? ` ${className}` : ""}`}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`min-w-0 flex-1 truncate border-b-2 px-3 py-2 text-xs transition-colors ${
              active
                ? "border-accent text-accent"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
