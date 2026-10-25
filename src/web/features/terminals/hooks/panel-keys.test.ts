import { panelKey } from "./panel-keys.ts";

const press = (key: string, modifiers: Partial<KeyboardEvent> = {}) =>
  panelKey({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers });

describe("panel keys", () => {
  it("keeps the panel's own keys away from the terminal", () => {
    expect(press("b", { ctrlKey: true })).toBe("toggle-list");
    expect(press("b", { metaKey: true })).toBe("toggle-list");
    expect(press("F", { ctrlKey: true, shiftKey: true })).toBe("full-screen");
    expect(press("W", { ctrlKey: true, shiftKey: true })).toBe("close");
    expect(press("PageDown", { ctrlKey: true })).toBe("next");
    expect(press("PageUp", { ctrlKey: true })).toBe("previous");
    expect(press("F2")).toBe("rename");
  });

  it("lets everything else through, Escape and plain letters included", () => {
    expect(press("b")).toBeNull();
    expect(press("f", { ctrlKey: true })).toBeNull();
    expect(press("Escape")).toBeNull();
    expect(press("b", { ctrlKey: true, altKey: true })).toBeNull();
  });
});
