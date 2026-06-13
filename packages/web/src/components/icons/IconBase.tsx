import type { ReactNode, SVGProps } from "react";

export const ICON_SIZE = 16;
export const ICON_BASE_CLASS = "h-icon-base w-icon-base";
export const ICON_STROKE_WIDTH = 1;

type BaseIconProps = SVGProps<SVGSVGElement> & {
  children: ReactNode;
};

function iconClassName(
  className: string | undefined,
  width: SVGProps<SVGSVGElement>["width"],
  height: SVGProps<SVGSVGElement>["height"],
): string | undefined {
  if (className !== undefined) return className;
  return width === ICON_SIZE && height === ICON_SIZE
    ? ICON_BASE_CLASS
    : undefined;
}

export function StrokeIcon({
  className,
  children,
  viewBox = "0 0 24 24",
  width = ICON_SIZE,
  height = ICON_SIZE,
  ...p
}: BaseIconProps) {
  return (
    <svg
      viewBox={viewBox}
      width={width}
      height={height}
      className={iconClassName(className, width, height)}
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      {children}
    </svg>
  );
}

export function FillIcon({
  className,
  children,
  viewBox = "0 0 24 24",
  width = ICON_SIZE,
  height = ICON_SIZE,
  ...p
}: BaseIconProps) {
  return (
    <svg
      viewBox={viewBox}
      width={width}
      height={height}
      className={iconClassName(className, width, height)}
      fill="currentColor"
      aria-hidden
      {...p}
    >
      {children}
    </svg>
  );
}
