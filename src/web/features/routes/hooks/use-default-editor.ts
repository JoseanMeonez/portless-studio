import { useCallback, useEffect, useState } from "react";
import type { OpenWithApp } from "../../../../core/api/contract.ts";
import { useRoutesGateway } from "./routes-gateway-context.tsx";

/**
 * The app each row's editor button opens: `defaultEditor` from the config when it is still in
 * the open-with list, else the first editor found on this machine. Null when there is none.
 */
export function pickDefaultEditor(
  apps: readonly OpenWithApp[],
  defaultEditor: string | null,
): OpenWithApp | null {
  const chosen = defaultEditor === null ? undefined : apps.find((app) => app.id === defaultEditor);
  if (chosen && chosen.kind !== "file-manager") return chosen;
  return apps.find((app) => app.kind === "editor") ?? null;
}

/** Loads the open-with apps and the configured default editor; `reload` after Settings saves. */
export function useDefaultEditor(): { editor: OpenWithApp | null; reload: () => void } {
  const gateway = useRoutesGateway();
  const [editor, setEditor] = useState<OpenWithApp | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    // Read again after Settings saves a new default editor or custom apps.
    void version;
    let current = true;
    void Promise.all([gateway.listOpenWithApps(), gateway.getConfig()]).then(([apps, config]) => {
      if (!current) return;
      const configured = config.ok ? (config.value.config.defaultEditor ?? null) : null;
      setEditor(apps.ok ? pickDefaultEditor(apps.value, configured) : null);
    });
    return () => {
      current = false;
    };
  }, [gateway, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { editor, reload };
}
