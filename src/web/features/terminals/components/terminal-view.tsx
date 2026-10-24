import { useEffect, useRef, useState } from "react";
import type { TerminalEngine } from "../hooks/xterm-loader.ts";
import styles from "./terminal-view.module.css";

type TerminalViewProps = {
  /** Output written with bare `\n` (pipes mode) needs it turned into a new line. */
  convertEol: boolean;
  /** Keep the newest output in view. */
  follow: boolean;
  /** Changes when the page theme changes, so the colors are read again. */
  themeKey: string;
  loadEngine: () => Promise<TerminalEngine>;
  /** Starts sending output to `write`; returns how to stop. */
  connect: (write: (text: string) => void) => () => void;
  onInput: (text: string) => void;
};

/**
 * One terminal drawn by xterm.js, loaded on first use. Mount it with a `key` per terminal so
 * switching tabs starts a fresh screen that replays the kept output.
 */
export function TerminalView({
  convertEol,
  follow,
  themeKey,
  loadEngine,
  connect,
  onInput,
}: TerminalViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const latest = useRef({ follow, onInput, connect });
  latest.current = { follow, onInput, connect };
  const terminal = useRef<{ setTheme(): void } | null>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    loadEngine().then(
      (engine) => {
        const element = host.current;
        if (disposed || !element) return;
        const term = engine.createTerminal({
          convertEol,
          cursorBlink: true,
          fontFamily: cssVar("--font-mono") || "monospace",
          fontSize: 12,
          scrollback: 5_000,
          theme: readTheme(),
        });
        const fit = engine.createFit();
        term.loadAddon(fit);
        term.open(element);
        const resize = () => {
          try {
            fit.fit();
          } catch {
            // A hidden panel has no size to fit.
          }
        };
        resize();
        const typed = term.onData((text) => latest.current.onInput(text));
        const stop = latest.current.connect((text) => {
          term.write(text);
          if (latest.current.follow) term.scrollToBottom();
        });
        const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
        observer?.observe(element);
        terminal.current = { setTheme: () => (term.options.theme = readTheme()) };
        setState("ready");
        cleanup = () => {
          observer?.disconnect();
          stop();
          typed.dispose();
          term.dispose();
          terminal.current = null;
        };
      },
      () => {
        if (!disposed) setState("failed");
      },
    );
    return () => {
      disposed = true;
      cleanup();
    };
  }, [convertEol, loadEngine]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: themeKey says when the CSS colors changed.
  useEffect(() => {
    terminal.current?.setTheme();
  }, [themeKey]);

  return (
    <div className={styles.view}>
      {state === "loading" ? <p className={styles.message}>Loading the terminal…</p> : null}
      {state === "failed" ? (
        <p className={styles.message}>The terminal could not load. Reload the page to try again.</p>
      ) : null}
      <div ref={host} className={styles.screen} data-testid="terminal-screen" />
    </div>
  );
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** xterm.js colors from the design tokens, so the terminal follows light and dark mode. */
function readTheme() {
  return {
    background: cssVar("--color-bg-subtle"),
    foreground: cssVar("--color-text"),
    cursor: cssVar("--color-accent"),
    selectionBackground: cssVar("--color-accent-subtle"),
  };
}
