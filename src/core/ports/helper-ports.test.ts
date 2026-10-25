import type { DetectedPort } from "./detected-port.ts";
import {
  type ArrangeInput,
  arrangeDetected,
  DEFAULT_EPHEMERAL_RANGES,
  isDebuggerVersionInfo,
} from "./helper-ports.ts";

const item = (
  port: number,
  pid: number | null,
  extra: Partial<DetectedPort> = {},
): DetectedPort => ({
  port,
  pid,
  processName: "node",
  cwd: `/code/app-${pid ?? "none"}`,
  suggestedName: `app-${pid ?? "none"}`,
  ...extra,
});

const input = (detected: DetectedPort[], extra: Partial<ArrangeInput> = {}): ArrangeInput => ({
  detected,
  debuggers: new Map(),
  ephemeralRange: DEFAULT_EPHEMERAL_RANGES.linux,
  showEphemeral: false,
  routes: [],
  ...extra,
});

const ports = (items: readonly { port: number }[]) => items.map((entry) => entry.port);

describe("arrangeDetected", () => {
  it("moves ports in the ephemeral range to Other ports unless showEphemeral is on", () => {
    const hidden = arrangeDetected(input([item(3000, 1), item(40015, 2)]));
    expect(ports(hidden.detected)).toEqual([3000]);
    expect(hidden.otherPorts).toEqual([
      expect.objectContaining({ port: 40015, reason: "ephemeral" }),
    ]);

    const shown = arrangeDetected(input([item(3000, 1), item(40015, 2)], { showEphemeral: true }));
    expect(ports(shown.detected)).toEqual([3000, 40015]);
    expect(shown.otherPorts).toEqual([]);
  });

  it("keeps a Docker container's ephemeral host port in the main list", () => {
    const container = { name: "api-1", image: "acme/api", composeProject: null };
    const result = arrangeDetected(input([item(49200, null, { container })]));
    expect(ports(result.detected)).toEqual([49200]);
  });

  it("moves debuggers by their answer, and 9229 or 9222 when the probe could not tell", () => {
    const result = arrangeDetected(
      input([item(9229, 1), item(9222, 2), item(4100, 3), item(9230, 4)], {
        debuggers: new Map([
          [4100, "debugger"],
          [9230, "other"],
        ]),
      }),
    );
    expect(ports(result.detected)).toEqual([9230]);
    expect(result.otherPorts.map((other) => [other.port, other.reason])).toEqual([
      [4100, "debugger"],
      [9222, "debugger"],
      [9229, "debugger"],
    ]);
  });

  it("shows 9229 when the probe says it is an ordinary server", () => {
    const result = arrangeDetected(
      input([item(9229, 1)], { debuggers: new Map([[9229, "other"]]) }),
    );
    expect(ports(result.detected)).toEqual([9229]);
  });

  it("files other ports of a named route's process under that route", () => {
    const routes = [{ name: "api.acme", port: 8787, pid: 10, cwd: "/code/api" }];
    const result = arrangeDetected(input([item(5000, 10), item(5003, 13)], { routes }));
    expect(ports(result.detected)).toEqual([5003]);
    expect(result.otherPorts).toEqual([
      expect.objectContaining({ port: 5000, reason: "sibling", routeName: "api.acme" }),
    ]);
  });

  it("keeps another process of the same folder or suggested name in the main list", () => {
    // An app on 5173 with a name, and Storybook started from the same folder on 6006.
    const routes = [{ name: "web.acme", port: 5173, pid: 10, cwd: "/code/web" }];
    const storybook = item(6006, 11, { cwd: "/code/web", suggestedName: "web.acme" });
    const result = arrangeDetected(input([storybook], { routes }));
    expect(result.detected).toEqual([storybook]);
    expect(result.otherPorts).toEqual([]);
  });

  it("names the route of a debugger or ephemeral port that belongs to one", () => {
    const routes = [{ name: "api.acme", port: 8787, pid: 10, cwd: "/code/api" }];
    const result = arrangeDetected(input([item(9229, 10), item(33111, 10)], { routes }));
    expect(result.otherPorts).toEqual([
      expect.objectContaining({ port: 9229, reason: "debugger", routeName: "api.acme" }),
      expect.objectContaining({ port: 33111, reason: "sibling", routeName: "api.acme" }),
    ]);
  });

  it("groups the ports of one process under its lowest port outside the ephemeral range", () => {
    const result = arrangeDetected(
      input([item(5174, 7), item(5173, 7), item(41000, 7), item(6000, 8)], { showEphemeral: true }),
    );
    expect(result.detected).toEqual([
      expect.objectContaining({ port: 5173, extraPorts: [5174, 41000] }),
      item(6000, 8),
    ]);
  });

  it("never groups ports whose process is unknown", () => {
    const result = arrangeDetected(input([item(3000, null), item(3001, null)]));
    expect(ports(result.detected)).toEqual([3000, 3001]);
    expect(result.detected[0]?.extraPorts).toBeUndefined();
  });
});

describe("isDebuggerVersionInfo", () => {
  it("knows the V8 inspector and Chrome DevTools answers", () => {
    expect(isDebuggerVersionInfo({ Browser: "node.js/v22", "Protocol-Version": "1.1" })).toBe(true);
    expect(isDebuggerVersionInfo({ "V8-Version": "12.4" })).toBe(true);
    expect(isDebuggerVersionInfo({ version: "1.0.0" })).toBe(false);
    expect(isDebuggerVersionInfo(["Browser"])).toBe(false);
    expect(isDebuggerVersionInfo(null)).toBe(false);
  });
});
