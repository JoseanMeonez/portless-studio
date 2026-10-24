import { useEffect, useState } from "react";
import type { TerminalInfo } from "../../../../core/terminals/terminal.ts";
import { useTerminalsGateway } from "./terminals-gateway-context.tsx";

/** Every terminal Studio runs, kept live. */
export function useTerminals(): TerminalInfo[] {
  const gateway = useTerminalsGateway();
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  useEffect(() => gateway.watchList(setTerminals), [gateway]);
  return terminals;
}
