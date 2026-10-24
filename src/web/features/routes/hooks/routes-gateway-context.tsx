import { createContext, type ReactNode, useContext } from "react";
import type { RoutesGateway } from "../data/routes-gateway.ts";

const RoutesGatewayContext = createContext<RoutesGateway | null>(null);

/** Makes a backend available to the routes feature. The app root picks which one. */
export function RoutesGatewayProvider({
  gateway,
  children,
}: {
  gateway: RoutesGateway;
  children: ReactNode;
}) {
  return <RoutesGatewayContext value={gateway}>{children}</RoutesGatewayContext>;
}

export function useRoutesGateway(): RoutesGateway {
  const gateway = useContext(RoutesGatewayContext);
  if (!gateway) throw new Error("useRoutesGateway needs a RoutesGatewayProvider above it");
  return gateway;
}
