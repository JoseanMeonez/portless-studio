import { ICON_PATHS, type IconName } from "./icon-paths.ts";

type IconProps = {
  name: IconName;
  /** Pixel size of the square icon. */
  size?: number;
  className?: string | undefined;
};

/** Decorative icon; the control that holds it carries the accessible name. */
export function Icon({ name, size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
