import type { ApiError, Snapshot } from "../../../../core/api/contract.ts";
import type { ConnectionState, RoutesGateway } from "../data/routes-gateway.ts";

export type RoutesState = {
  /** Latest known state; kept while reconnecting so the list does not flash empty. */
  snapshot: Snapshot | null;
  /** Why the first load failed. Cleared by the next snapshot. */
  error: ApiError | null;
  connection: ConnectionState;
};

const INITIAL_STATE: RoutesState = { snapshot: null, error: null, connection: "connecting" };

/**
 * Holds the routes state for `useSyncExternalStore`: loads once, then follows live updates while
 * at least one component is subscribed.
 */
export class RoutesStore {
  readonly #gateway: RoutesGateway;
  readonly #listeners = new Set<() => void>();
  #state: RoutesState = INITIAL_STATE;
  #stopLive: (() => void) | null = null;

  constructor(gateway: RoutesGateway) {
    this.#gateway = gateway;
  }

  getState = (): RoutesState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) this.#start();
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) this.#stop();
    };
  };

  /** Loads the state again, for the Retry button of the error state. */
  reload = async (): Promise<void> => {
    const result = await this.#gateway.getSnapshot();
    if (result.ok) {
      // A live update may have arrived while this request was in flight; keep the newer one.
      const current = this.#state.snapshot;
      if (!current || result.value.readAt >= current.readAt)
        this.#set({ snapshot: result.value, error: null });
    } else if (!this.#state.snapshot) this.#set({ error: result.error });
  };

  #start(): void {
    this.#stopLive = this.#gateway.subscribe(
      (snapshot) => this.#set({ snapshot, error: null }),
      (connection) => this.#set({ connection }),
    );
    void this.reload();
  }

  #stop(): void {
    this.#stopLive?.();
    this.#stopLive = null;
  }

  #set(change: Partial<RoutesState>): void {
    this.#state = { ...this.#state, ...change };
    for (const listener of this.#listeners) listener();
  }
}
