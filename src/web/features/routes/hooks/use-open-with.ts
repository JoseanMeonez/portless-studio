import { useCallback, useEffect, useState } from "react";
import type { OpenWithApp } from "../../../../core/api/contract.ts";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { apiErrorMessage } from "./route-messages.ts";
import { useRoutesGateway } from "./routes-gateway-context.tsx";

export type OpenWithState = {
  /** Null until the first answer; empty when the server found none or could not be asked. */
  apps: readonly OpenWithApp[] | null;
  open: (app: OpenWithApp, path: string) => Promise<void>;
};

/**
 * The apps a folder can be opened with. They are asked for again each time `active` turns on,
 * so a new editor or a custom app added in Settings shows up the next time the menu opens.
 */
export function useOpenWith(active: boolean): OpenWithState {
  const gateway = useRoutesGateway();
  const toast = useToast();
  const [apps, setApps] = useState<readonly OpenWithApp[] | null>(null);

  useEffect(() => {
    if (!active) return;
    let current = true;
    void gateway.listOpenWithApps().then((result) => {
      if (current) setApps(result.ok ? result.value : []);
    });
    return () => {
      current = false;
    };
  }, [active, gateway]);

  const open = useCallback(
    async (app: OpenWithApp, path: string) => {
      const result = await gateway.openWith({ appId: app.id, path });
      toast(
        result.ok
          ? { title: `Opened in ${app.name}`, description: path, tone: "success" }
          : {
              title: `Could not open in ${app.name}`,
              description: apiErrorMessage(result.error),
              tone: "error",
            },
      );
    },
    [gateway, toast],
  );

  return { apps, open };
}
