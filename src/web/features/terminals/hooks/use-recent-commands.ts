import { useEffect, useState } from "react";
import { useTerminalsGateway } from "./terminals-gateway-context.tsx";

/** The last commands per folder, asked for again each time `active` turns true. */
export function useRecentCommands(active: boolean): Record<string, string[]> {
  const gateway = useTerminalsGateway();
  const [recent, setRecent] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!active) return;
    let current = true;
    void gateway.recentCommands().then((result) => {
      if (current && result.ok) setRecent(result.value);
    });
    return () => {
      current = false;
    };
  }, [gateway, active]);
  return recent;
}
