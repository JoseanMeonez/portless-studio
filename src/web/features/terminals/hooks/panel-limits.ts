/**
 * How big the terminal panel and its list may get for the window, so dragging never breaks the
 * page next to them. Pure functions: the panel hook applies them on every resize.
 */

export type Limits = { min: number; max: number };

/**
 * The routes list keeps at least this width next to the right pane: with the page padding it
 * leaves the 672 px a route row needs to show kind, port and uptime in their columns.
 */
export const MIN_DASHBOARD_WIDTH = 720;
export const MIN_PANE_WIDTH = 360;
export const MIN_PANEL_HEIGHT = 160;
/** The page header and a few rows stay visible above the bottom panel. */
const BOTTOM_PANEL_GAP = 160;
export const MIN_LIST_WIDTH = 200;
export const MAX_LIST_WIDTH = 420;
/** The terminal keeps at least this width next to the list; below it the list is a dropdown. */
export const MIN_TERMINAL_WIDTH = 260;

export function rightPaneLimits(windowWidth: number): Limits {
  return { min: MIN_PANE_WIDTH, max: Math.max(MIN_PANE_WIDTH, windowWidth - MIN_DASHBOARD_WIDTH) };
}

export function bottomPanelLimits(windowHeight: number): Limits {
  return {
    min: MIN_PANEL_HEIGHT,
    max: Math.max(MIN_PANEL_HEIGHT, windowHeight - BOTTOM_PANEL_GAP),
  };
}

/** Limits of the terminal list inside a panel `panelWidth` wide. */
export function listWidthLimits(panelWidth: number): Limits {
  return {
    min: MIN_LIST_WIDTH,
    max: Math.max(MIN_LIST_WIDTH, Math.min(MAX_LIST_WIDTH, panelWidth - MIN_TERMINAL_WIDTH)),
  };
}

/** Whether the list fits beside the terminal in a panel `panelWidth` wide. */
export function listFits(panelWidth: number): boolean {
  return panelWidth >= MIN_LIST_WIDTH + MIN_TERMINAL_WIDTH;
}

export function clamp(value: number, limits: Limits): number {
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}
