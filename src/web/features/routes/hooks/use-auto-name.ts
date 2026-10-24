import { useCallback, useState } from "react";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { apiErrorMessage } from "./route-messages.ts";
import { useRoutesGateway } from "./routes-gateway-context.tsx";

export type AutoNameState = {
  enabled: boolean;
  /** True while the change is being saved; the switch shows the new value meanwhile. */
  saving: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
};

/**
 * The auto mode switch outside the settings panel. It saves only `autoName` and keeps every other
 * setting as the server has it.
 */
export function useAutoName(current: boolean): AutoNameState {
  const gateway = useRoutesGateway();
  const toast = useToast();
  const [pending, setPending] = useState<boolean | null>(null);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      setPending(enabled);
      const loaded = await gateway.getConfig();
      const saved = loaded.ok
        ? await gateway.updateConfig({ ...loaded.value.config, autoName: enabled })
        : loaded;
      setPending(null);
      toast(
        saved.ok
          ? enabled
            ? {
                title: "Auto-naming new servers",
                description: "New dev servers get their suggested name as soon as they answer.",
                tone: "success",
              }
            : {
                title: "Stopped auto-naming",
                description: "New dev servers wait for you to name them.",
              }
          : {
              title: "Could not change auto mode",
              description: apiErrorMessage(saved.error),
              tone: "error",
            },
      );
    },
    [gateway, toast],
  );

  return { enabled: pending ?? current, saving: pending !== null, setEnabled };
}
