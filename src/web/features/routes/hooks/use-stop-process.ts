import { useCallback } from "react";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { apiErrorMessage } from "./route-messages.ts";
import { useRoutesGateway } from "./routes-gateway-context.tsx";

/** What the confirmation and the toast call the process: `ng on port 4209`. */
export type ProcessTarget = { pid: number; port: number; processName?: string };

/** Stops a dev server from its row and says how it went. */
export function useStopProcess(): (target: ProcessTarget) => Promise<void> {
  const gateway = useRoutesGateway();
  const toast = useToast();
  return useCallback(
    async ({ pid, port, processName }) => {
      const what = processName ? `${processName} on port ${port}` : `the server on port ${port}`;
      const result = await gateway.stopProcess(pid);
      toast(
        result.ok
          ? { title: `Stopped ${what}`, tone: "success" }
          : {
              title: `Could not stop ${what}`,
              description: apiErrorMessage(result.error),
              tone: "error",
            },
      );
    },
    [gateway, toast],
  );
}
