import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { BottomSheet } from "./BottomSheet.js";

export interface ActionItem {
  id: string;
  label: string;
  disabled?: boolean;
  title?: string;
  separatorBefore?: boolean;
  tone?: "normal" | "danger";
  leading?: ReactNode;
  trailing?: ReactNode;
  onSelect: () => void;
}

interface ActionListProps {
  items: ActionItem[];
  density?: "compact" | "touch";
  itemRole?: "menuitem" | "button";
  onItemSelect?: () => void;
  onItemPointerDown?: React.PointerEventHandler<HTMLButtonElement>;
}

export function ActionList({
  items,
  density = "compact",
  itemRole = "menuitem",
  onItemSelect,
  onItemPointerDown,
}: ActionListProps) {
  const rowClass =
    density === "touch" ? "px-3 py-2.5 text-sm" : "px-3 py-1.5 text-sm";
  return (
    <div className="py-1">
      {items.map((item, idx) => (
        <div key={item.id}>
          {item.separatorBefore && (
            <div aria-hidden className="mx-2 my-1 border-t border-border" />
          )}
          <button
            type="button"
            role={itemRole}
            data-item-index={idx}
            disabled={item.disabled}
            {...(item.title ? { title: item.title } : {})}
            onPointerDown={onItemPointerDown}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              onItemSelect?.();
            }}
            className={`flex w-full items-center gap-2 rounded-control text-left text-text-primary hover:bg-row-hover-bg focus:bg-row-hover-bg focus:outline-none disabled:cursor-not-allowed disabled:text-text-secondary disabled:opacity-60 disabled:hover:bg-transparent ${
              item.tone === "danger" ? "text-danger" : ""
            } ${rowClass}`}
          >
            {item.leading}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.trailing && (
              <span className="shrink-0 text-xs text-text-secondary">
                {item.trailing}
              </span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}

interface FloatingActionMenuProps {
  items: ActionItem[];
  align?: "start" | "end";
  placement?: "top" | "bottom";
  portal?: boolean;
  anchorPoint?: { x: number; y: number };
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  renderTrigger?: (props: {
    open: boolean;
    toggle: () => void;
    triggerRef: (el: HTMLButtonElement | null) => void;
    menuId: string;
  }) => ReactNode;
}

export function FloatingActionMenu({
  items,
  align = "end",
  placement = "bottom",
  portal = false,
  anchorPoint,
  open: controlledOpen,
  onOpenChange,
  onClose,
  renderTrigger,
}: FloatingActionMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(
    Boolean(anchorPoint),
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [portalStyle, setPortalStyle] = useState<CSSProperties | null>(null);
  const triggerElRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const open = controlledOpen ?? uncontrolledOpen;
  const fixed = portal || Boolean(anchorPoint);

  const setOpen = useCallback(
    (next: boolean) => {
      if (!next) onClose?.();
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onClose, onOpenChange],
  );

  const updateFixedPosition = useCallback(() => {
    if (!fixed || typeof window === "undefined") return;
    const minWidth = 160;
    const gutter = 8;
    const yGap = 4;
    if (anchorPoint) {
      const left = Math.min(
        Math.max(anchorPoint.x, gutter),
        Math.max(gutter, window.innerWidth - minWidth - gutter),
      );
      setPortalStyle({
        left,
        minWidth,
        position: "fixed",
        top: anchorPoint.y,
      });
      return;
    }
    const rect = triggerElRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rawLeft = align === "end" ? rect.right - minWidth : rect.left;
    const left = Math.min(
      Math.max(rawLeft, gutter),
      Math.max(gutter, window.innerWidth - minWidth - gutter),
    );
    setPortalStyle({
      left,
      minWidth,
      position: "fixed",
      top: placement === "bottom" ? rect.bottom + yGap : rect.top - yGap,
      transform: placement === "top" ? "translateY(-100%)" : undefined,
    });
  }, [align, anchorPoint, fixed, placement]);

  const close = useCallback(() => {
    setOpen(false);
    triggerElRef.current?.focus();
  }, [setOpen]);

  const toggle = useCallback(() => {
    if (!open) {
      setActiveIndex(0);
      updateFixedPosition();
    }
    setOpen(!open);
  }, [open, setOpen, updateFixedPosition]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (triggerElRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    if (fixed) {
      updateFixedPosition();
      window.addEventListener("resize", updateFixedPosition);
      window.addEventListener("scroll", updateFixedPosition, true);
    }
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      if (fixed) {
        window.removeEventListener("resize", updateFixedPosition);
        window.removeEventListener("scroll", updateFixedPosition, true);
      }
    };
  }, [close, fixed, open, updateFixedPosition]);

  useEffect(() => {
    if (!open) return;
    panelRef.current
      ?.querySelector<HTMLButtonElement>(`[data-item-index="${activeIndex}"]`)
      ?.focus();
  }, [open, activeIndex]);

  const onPanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === " " || e.key === "Enter") {
      e.stopPropagation();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => nextEnabled(items, i, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => nextEnabled(items, i, -1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(nextEnabled(items, -1, 1));
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(nextEnabled(items, items.length, -1));
    }
  };

  const panel = open ? (
    <div
      ref={panelRef}
      id={menuId}
      role="menu"
      onKeyDown={onPanelKeyDown}
      style={fixed ? (portalStyle ?? undefined) : undefined}
      className={
        fixed
          ? "z-40 rounded-window border border-border bg-bg-secondary shadow-lg"
          : `absolute z-40 min-w-[160px] rounded-window border border-border bg-bg-secondary shadow-lg ${
              placement === "top" ? "bottom-full mb-1" : "top-full mt-1"
            } ${align === "end" ? "right-0" : "left-0"}`
      }
    >
      <ActionList items={items} onItemSelect={close} />
    </div>
  ) : null;

  if (anchorPoint) {
    if (!panel || typeof document === "undefined") return null;
    return createPortal(panel, document.body);
  }

  return (
    <div className={fixed ? "contents" : "relative inline-flex"}>
      {renderTrigger?.({
        open,
        toggle,
        triggerRef: (el) => {
          triggerElRef.current = el;
        },
        menuId,
      })}
      {fixed ? panel && createPortal(panel, document.body) : panel}
    </div>
  );
}

interface ActionSheetProps {
  open: boolean;
  items: ActionItem[];
  onDismiss: () => void;
  ariaLabel: string;
  title?: ReactNode;
  cancelLabel?: string;
  manageFocus?: boolean;
}

export function ActionSheet({
  open,
  items,
  onDismiss,
  ariaLabel,
  title,
  cancelLabel = "Cancel",
  manageFocus = true,
}: ActionSheetProps) {
  return (
    <BottomSheet
      open={open}
      onDismiss={onDismiss}
      ariaLabel={ariaLabel}
      manageFocus={manageFocus}
    >
      <div className="p-2">
        {title && (
          <div className="mb-2 truncate px-3 py-1 text-xs text-text-secondary">
            {title}
          </div>
        )}
        <ActionList
          items={items}
          density="touch"
          itemRole="button"
          onItemSelect={onDismiss}
        />
        <button
          type="button"
          className="mt-1 w-full rounded-control px-3 py-2.5 text-center text-sm text-text-secondary"
          onClick={onDismiss}
        >
          {cancelLabel}
        </button>
      </div>
    </BottomSheet>
  );
}

function nextEnabled(items: ActionItem[], from: number, step: 1 | -1): number {
  const n = items.length;
  if (n === 0) return 0;
  for (let i = 1; i <= n; i++) {
    const idx = (from + step * i + n) % n;
    if (!items[idx]?.disabled) return idx;
  }
  return from;
}
