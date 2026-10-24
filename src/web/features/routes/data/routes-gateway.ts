import type {
  ApiError,
  CreateAliasRequest,
  InstallPortlessResponse,
  RenameAliasRequest,
  Snapshot,
} from "../../../../core/api/contract.ts";
import type { Result } from "../../../../core/result.ts";

/** Whether live updates are flowing. `reconnecting` means the last snapshot may be stale. */
export type ConnectionState = "connecting" | "open" | "reconnecting";

export type SnapshotListener = (snapshot: Snapshot) => void;
export type ConnectionListener = (state: ConnectionState) => void;

/**
 * Everything the routes feature needs from a backend. The UI depends only on this port, so a
 * different backend is one new class that implements it (see docs/architecture.md).
 */
export interface RoutesGateway {
  /** Reads the current state once. */
  getSnapshot(): Promise<Result<Snapshot, ApiError>>;
  /** Calls `listener` with every new snapshot until the returned function is called. */
  subscribe(listener: SnapshotListener, onConnectionChange?: ConnectionListener): () => void;
  createAlias(request: CreateAliasRequest): Promise<Result<null, ApiError>>;
  renameAlias(currentName: string, request: RenameAliasRequest): Promise<Result<null, ApiError>>;
  removeAlias(name: string): Promise<Result<null, ApiError>>;
  /** Runs `npm install -g portless` on the server; resolves when npm finishes. */
  installPortless(): Promise<Result<InstallPortlessResponse, ApiError>>;
}
