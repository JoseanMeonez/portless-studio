import { useEffect, useState } from "react";
import {
  DEFAULT_TERMINAL_APPEARANCE,
  type StudioConfig,
  type TerminalAppearance,
} from "../../core/config/studio-config.ts";
import { useRoutesGateway } from "../features/routes/index.ts";

/**
 * The terminal look from the Studio config: read once on load, then taken from every config
 * Settings saves, so open terminals change at once.
 */
export function useTerminalAppearance(): {
  appearance: TerminalAppearance;
  onConfigSaved: (config: StudioConfig) => void;
} {
  const gateway = useRoutesGateway();
  const [appearance, setAppearance] = useState(DEFAULT_TERMINAL_APPEARANCE);
  useEffect(() => {
    let current = true;
    void gateway.getConfig().then((result) => {
      if (current && result.ok && result.value.config.terminal) {
        setAppearance(result.value.config.terminal);
      }
    });
    return () => {
      current = false;
    };
  }, [gateway]);
  return { appearance, onConfigSaved: (config) => setAppearance(config.terminal) };
}
