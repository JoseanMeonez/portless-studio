import { cleanup } from "@testing-library/react";

// jsdom has no matchMedia; the theme hook reads it to follow the system setting.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  // The view, search and filters live in the URL; each test starts from a clean one.
  window.history.replaceState(null, "", "/");
  document.documentElement.removeAttribute("data-theme");
});
