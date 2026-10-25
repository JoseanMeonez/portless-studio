import { useCallback, useEffect, useState } from "react";
import type { UpdateStatus } from "../../../../core/api/contract.ts";
import { useRoutesGateway } from "./routes-gateway-context.tsx";

const DISMISSED_KEY = "portless-studio:update-dismissed";

/**
 * Asks the server once whether a newer release exists. A dismissed version stays hidden; a later
 * release shows the notice again.
 */
export function useUpdateNotice(): { update: UpdateStatus | null; dismiss: () => void } {
  const gateway = useRoutesGateway();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);

  useEffect(() => {
    if (!gateway.getUpdateStatus) return;
    let active = true;
    void gateway.getUpdateStatus().then((result) => {
      if (active && result.ok) setStatus(result.value);
    });
    return () => {
      active = false;
    };
  }, [gateway]);

  const dismiss = useCallback(() => {
    const latest = status?.latest ?? null;
    if (latest === null) return;
    setDismissed(latest);
    try {
      localStorage.setItem(DISMISSED_KEY, latest);
    } catch {
      // Storage can be off; the notice then comes back on the next visit.
    }
  }, [status]);

  const visible = status?.available && status.latest !== dismissed ? status : null;
  return { update: visible, dismiss };
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}
