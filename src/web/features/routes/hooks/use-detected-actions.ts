import { useMemo } from "react";
import type { DetectedPort } from "../../../../core/ports/detected-port.ts";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { apiErrorMessage } from "./route-messages.ts";
import { useRoutesGateway } from "./routes-gateway-context.tsx";

export type DetectedActions = {
  ignore: (detected: DetectedPort) => Promise<void>;
  /** Names every port that has a suggestion, one after another, and reports once at the end. */
  nameAll: (detected: readonly DetectedPort[]) => Promise<void>;
};

/** What a person can do with ports the server detected but portless does not know yet. */
export function useDetectedActions(): DetectedActions {
  const gateway = useRoutesGateway();
  const toast = useToast();

  return useMemo<DetectedActions>(
    () => ({
      ignore: async (detected) => {
        const result = await gateway.ignoreDetected(detected.port);
        toast(
          result.ok
            ? {
                title: `Ignoring port ${detected.port}`,
                description: "Remove it from the ignored ports in Settings to see it again.",
              }
            : {
                title: `Could not ignore port ${detected.port}`,
                description: apiErrorMessage(result.error),
                tone: "error",
              },
        );
      },
      nameAll: async (detected) => {
        const named: string[] = [];
        const failures: string[] = [];
        for (const item of detected) {
          if (item.suggestedName === null) continue;
          const result = await gateway.createAlias({ name: item.suggestedName, port: item.port });
          if (result.ok) named.push(item.suggestedName);
          else failures.push(`${item.suggestedName}: ${apiErrorMessage(result.error)}`);
        }
        const total = named.length + failures.length;
        toast(
          failures.length === 0
            ? {
                title: `Named ${total} ${total === 1 ? "port" : "ports"}`,
                description: named.join(", "),
                tone: "success",
              }
            : {
                title: `Named ${named.length} of ${total} ports`,
                description: failures.join(" "),
                tone: "error",
              },
        );
      },
    }),
    [gateway, toast],
  );
}
