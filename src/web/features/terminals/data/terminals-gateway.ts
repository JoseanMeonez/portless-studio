import type {
  ApiError,
  CreateTerminalRequest,
  TerminalOutputChunk,
} from "../../../../core/api/contract.ts";
import type { Result } from "../../../../core/result.ts";
import type { TerminalInfo } from "../../../../core/terminals/terminal.ts";

export type TerminalStreamHandlers = {
  onOutput(chunk: TerminalOutputChunk): void;
  onStatus(info: TerminalInfo): void;
};

/**
 * Everything the terminals feature needs from a backend. The UI depends only on this port; the
 * HTTP version talks to Studio, the in-memory one serves tests and `?demo`.
 */
export interface TerminalsGateway {
  /** Calls `listener` with every terminal now and after each change, until unsubscribed. */
  watchList(listener: (terminals: TerminalInfo[]) => void): () => void;
  create(request: CreateTerminalRequest): Promise<Result<TerminalInfo, ApiError>>;
  /** Starts a terminal in any existing folder the person typed or picked; `~` is home. */
  createInFolder(request: CreateTerminalRequest): Promise<Result<TerminalInfo, ApiError>>;
  /** Names the terminal; an empty title gives back the default one. */
  rename(id: string, title: string): Promise<Result<TerminalInfo, ApiError>>;
  /** Types into the command; Enter is `\r`. */
  input(id: string, text: string): Promise<Result<null, ApiError>>;
  stop(id: string): Promise<Result<TerminalInfo, ApiError>>;
  restart(id: string): Promise<Result<TerminalInfo, ApiError>>;
  /** Closes the terminal, killing its command if it still runs. */
  remove(id: string): Promise<Result<null, ApiError>>;
  /** All the output Studio still keeps, escape codes included. */
  output(id: string): Promise<Result<string, ApiError>>;
  /** Output from offset `from`, then live output and status, until unsubscribed. */
  stream(id: string, from: number, handlers: TerminalStreamHandlers): () => void;
}
