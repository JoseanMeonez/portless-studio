import { useMemo, useSyncExternalStore } from "react";
import { useRoutesGateway } from "./routes-gateway-context.tsx";
import { type RoutesState, RoutesStore } from "./routes-store.ts";

/** Live routes state from the gateway, plus a way to load it again after an error. */
export function useRoutes(): RoutesState & { reload: () => Promise<void> } {
  const gateway = useRoutesGateway();
  const store = useMemo(() => new RoutesStore(gateway), [gateway]);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return { ...state, reload: store.reload };
}
