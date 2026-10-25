import { useMemo, useState } from "react";
import { type EnvRoute, envEntries, formatEnvLine } from "../../../../core/routes/env-lines.ts";

export type EnvForm = {
  /** Route names left out of the lines; every other route is in. */
  excluded: ReadonlySet<string>;
  toggle: (name: string) => void;
  prefix: string;
  setPrefix: (prefix: string) => void;
  strip: string;
  setStrip: (strip: string) => void;
  direct: boolean;
  setDirect: (direct: boolean) => void;
  /** The `KEY=url` lines for the chosen routes, or why they cannot be built. */
  lines: string[];
  error: string | null;
};

/** The choices of the `.env` dialog and the lines they give, rebuilt on every change. */
export function useEnvForm(routes: readonly EnvRoute[]): EnvForm {
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [prefix, setPrefix] = useState("");
  const [strip, setStrip] = useState("");
  const [direct, setDirect] = useState(false);

  const built = useMemo(() => {
    const chosen = routes.filter((route) => !excluded.has(route.name));
    const entries = envEntries(chosen, { prefix: prefix.trim(), strip, direct });
    return entries.ok
      ? { lines: entries.value.map(formatEnvLine), error: null }
      : { lines: [], error: entries.error };
  }, [routes, excluded, prefix, strip, direct]);

  const toggle = (name: string) =>
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return { excluded, toggle, prefix, setPrefix, strip, setStrip, direct, setDirect, ...built };
}
