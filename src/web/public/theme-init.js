// Applies a saved theme before the first paint so the page does not flash the other one.
// It is a separate file because the server's Content-Security-Policy blocks inline scripts.
try {
  const theme = localStorage.getItem("portless-studio:theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {}
