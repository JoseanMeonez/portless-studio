import { useCallback, useState } from "react";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { apiErrorMessage } from "./route-messages.ts";
import { useRoutesGateway } from "./routes-gateway-context.tsx";

export type InstallStatus = "idle" | "installing" | "failed";

export type InstallPortlessState = {
  status: InstallStatus;
  /** Why the last install failed, including what npm printed. */
  error: string | null;
  /** What npm printed on the last successful install. */
  output: string | null;
  install: () => Promise<void>;
};

/** Runs `npm install -g portless` through the gateway and tracks its progress for the banner. */
export function useInstallPortless(): InstallPortlessState {
  const gateway = useRoutesGateway();
  const toast = useToast();
  const [status, setStatus] = useState<InstallStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);

  const install = useCallback(async () => {
    setStatus("installing");
    setError(null);
    setOutput(null);
    const result = await gateway.installPortless();
    if (!result.ok) {
      setStatus("failed");
      setError(apiErrorMessage(result.error));
      return;
    }
    setStatus("idle");
    setOutput(result.value.output);
    const { version } = result.value;
    toast(
      version
        ? { title: `portless ${version} installed`, tone: "success" }
        : {
            title: "npm installed portless",
            description: "The server still cannot find the portless command. Check its PATH.",
            tone: "error",
          },
    );
  }, [gateway, toast]);

  return { status, error, output, install };
}
