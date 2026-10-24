import { createContext, type ReactNode, useContext } from "react";
import type { TerminalsGateway } from "../data/terminals-gateway.ts";

const TerminalsGatewayContext = createContext<TerminalsGateway | null>(null);

/** Makes a terminals backend available to the feature. The app root picks which one. */
export function TerminalsGatewayProvider({
  gateway,
  children,
}: {
  gateway: TerminalsGateway;
  children: ReactNode;
}) {
  return <TerminalsGatewayContext value={gateway}>{children}</TerminalsGatewayContext>;
}

export function useTerminalsGateway(): TerminalsGateway {
  const gateway = useContext(TerminalsGatewayContext);
  if (!gateway) throw new Error("useTerminalsGateway needs a TerminalsGatewayProvider above it");
  return gateway;
}
