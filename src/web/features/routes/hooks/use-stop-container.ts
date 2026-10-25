import { useCallback } from "react";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { apiErrorMessage } from "./route-messages.ts";
import { useRoutesGateway } from "./routes-gateway-context.tsx";

/** Stops a Docker container from its row with `docker stop` and says how it went. */
export function useStopContainer(): (name: string) => Promise<void> {
  const gateway = useRoutesGateway();
  const toast = useToast();
  return useCallback(
    async (name) => {
      const result = await gateway.stopContainer(name);
      toast(
        result.ok
          ? { title: `Stopped container ${name}`, tone: "success" }
          : {
              title: `Could not stop container ${name}`,
              description: apiErrorMessage(result.error),
              tone: "error",
            },
      );
    },
    [gateway, toast],
  );
}
