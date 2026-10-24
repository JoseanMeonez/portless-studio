import { useCallback, useState } from "react";
import type {
  ProxyAction,
  StudioAction,
  StudioActionResponse,
} from "../../../../core/api/contract.ts";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { apiErrorMessage } from "./route-messages.ts";
import { useRoutesGateway } from "./routes-gateway-context.tsx";

export type ServiceControl = {
  /** The proxy action running right now, if any. */
  proxyBusy: ProxyAction | null;
  studioBusy: StudioAction | null;
  /** Resolves true when the action worked. */
  controlProxy: (action: ProxyAction) => Promise<boolean>;
  /** Resolves with the server's answer, or null after showing the error. */
  controlStudio: (action: StudioAction) => Promise<StudioActionResponse | null>;
};

/** Start, stop and restart for the portless proxy and for Studio itself, with their toasts. */
export function useServiceControl(): ServiceControl {
  const gateway = useRoutesGateway();
  const toast = useToast();
  const [proxyBusy, setProxyBusy] = useState<ProxyAction | null>(null);
  const [studioBusy, setStudioBusy] = useState<StudioAction | null>(null);

  const controlProxy = useCallback(
    async (action: ProxyAction) => {
      setProxyBusy(action);
      const result = await gateway.controlProxy(action);
      setProxyBusy(null);
      toast(
        result.ok
          ? { title: result.value.message || "Done", tone: "success" }
          : {
              title: `Could not ${action} the proxy`,
              description: apiErrorMessage(result.error),
              tone: "error",
            },
      );
      return result.ok;
    },
    [gateway, toast],
  );

  const controlStudio = useCallback(
    async (action: StudioAction) => {
      setStudioBusy(action);
      const result = await gateway.controlStudio(action);
      setStudioBusy(null);
      if (!result.ok) {
        toast({
          title: `Could not ${action} Studio`,
          description: apiErrorMessage(result.error),
          tone: "error",
        });
        return null;
      }
      if (action === "restart") toast({ title: result.value.message || "Studio is restarting." });
      return result.value;
    },
    [gateway, toast],
  );

  return { proxyBusy, studioBusy, controlProxy, controlStudio };
}
