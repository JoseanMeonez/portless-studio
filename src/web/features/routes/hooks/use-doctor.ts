import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiError } from "../../../../core/api/contract.ts";
import {
  type DoctorCheck,
  type DoctorStatus,
  overallStatus,
} from "../../../../core/doctor/doctor-check.ts";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { apiErrorMessage } from "./route-messages.ts";
import { useRoutesGateway } from "./routes-gateway-context.tsx";

/** The checks spawn system commands on the server, so they run now and then, not on every push. */
const REFRESH_MS = 60_000;

export type DoctorState = {
  checks: DoctorCheck[] | null;
  error: ApiError | null;
  /** Worst status of the checks; null until they first load. */
  status: DoctorStatus | null;
  /** For the Health button: "Health: 1 warning", "Health: all good". */
  label: string;
  /** Id of the check whose fix is running. */
  fixing: string | null;
  refresh: () => Promise<void>;
  fix: (id: string) => Promise<void>;
};

/**
 * Health checks for the header dot and the Health panel. `changeKey` is anything whose change
 * should run them again, such as the proxy's state.
 */
export function useDoctor(changeKey: string): DoctorState {
  const gateway = useRoutesGateway();
  const toast = useToast();
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const result = await gateway.getDoctor();
    if (!mounted.current) return;
    if (result.ok) {
      setChecks(result.value.checks);
      setError(null);
    } else setError(result.error);
  }, [gateway]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: changeKey only triggers a new run.
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh, changeKey]);

  const fix = useCallback(
    async (id: string) => {
      setFixing(id);
      const result = await gateway.runDoctorFix(id);
      if (!mounted.current) return;
      setFixing(null);
      if (result.ok) {
        setChecks(result.value.checks);
        toast({ title: result.value.message || "Done", tone: "success" });
      } else {
        toast({
          title: "The fix did not work",
          description: apiErrorMessage(result.error),
          tone: "error",
        });
      }
    },
    [gateway, toast],
  );

  const status = checks ? overallStatus(checks) : null;
  return { checks, error, status, label: describeHealth(checks), fixing, refresh, fix };
}

export function describeHealth(checks: readonly DoctorCheck[] | null): string {
  if (checks === null) return "Health: checking";
  const count = (status: DoctorStatus, one: string, many: string) => {
    const total = checks.filter((check) => check.status === status).length;
    return total === 0 ? null : `${total} ${total === 1 ? one : many}`;
  };
  const parts = [count("fail", "problem", "problems"), count("warn", "warning", "warnings")];
  const found = parts.filter(Boolean);
  return found.length === 0 ? "Health: all good" : `Health: ${found.join(" and ")}`;
}
