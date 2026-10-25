import {
  bottomPanelLimits,
  clamp,
  listFits,
  listWidthLimits,
  MIN_DASHBOARD_WIDTH,
  MIN_LIST_WIDTH,
  MIN_PANE_WIDTH,
  MIN_PANEL_HEIGHT,
  MIN_TERMINAL_WIDTH,
  rightPaneLimits,
} from "./panel-limits.ts";

describe("right pane limits", () => {
  it("keeps the dashboard list wide enough for its columns", () => {
    expect(rightPaneLimits(1280)).toEqual({ min: MIN_PANE_WIDTH, max: 1280 - MIN_DASHBOARD_WIDTH });
    expect(rightPaneLimits(1920).max).toBe(1920 - MIN_DASHBOARD_WIDTH);
  });

  it("never lets the maximum fall under the minimum", () => {
    expect(rightPaneLimits(900)).toEqual({ min: MIN_PANE_WIDTH, max: MIN_PANE_WIDTH });
  });
});

describe("bottom panel limits", () => {
  it("leaves room for the page header and a few rows", () => {
    const limits = bottomPanelLimits(900);
    expect(limits.min).toBe(MIN_PANEL_HEIGHT);
    expect(limits.max).toBeLessThan(900);
    expect(limits.max).toBeGreaterThan(MIN_PANEL_HEIGHT);
  });
});

describe("terminal list limits", () => {
  it("keeps room for the terminal next to the list", () => {
    expect(listWidthLimits(1000).max).toBeLessThanOrEqual(1000 - MIN_TERMINAL_WIDTH);
    expect(listWidthLimits(1000).min).toBe(MIN_LIST_WIDTH);
    expect(listWidthLimits(300).max).toBe(MIN_LIST_WIDTH);
  });

  it("says when the list no longer fits beside the terminal", () => {
    expect(listFits(MIN_LIST_WIDTH + MIN_TERMINAL_WIDTH)).toBe(true);
    expect(listFits(MIN_LIST_WIDTH + MIN_TERMINAL_WIDTH - 1)).toBe(false);
  });
});

describe("clamp", () => {
  it("rounds and keeps a value between the limits", () => {
    expect(clamp(10.4, { min: 20, max: 40 })).toBe(20);
    expect(clamp(50, { min: 20, max: 40 })).toBe(40);
    expect(clamp(30.6, { min: 20, max: 40 })).toBe(31);
  });
});
