/** A TCP port in LISTEN state on this machine, as the operating system reports it. */
export type ListeningPort = {
  port: number;
  pid: number | null;
  processName: string;
  cwd: string | null;
  /** Full path of the executable, when the system reports it (Linux does). */
  executable?: string | null;
};

/**
 * Lists listening ports. Implementations read `/proc` on Linux, `lsof` on macOS and `netstat`
 * on Windows; another backend can implement it any other way.
 */
export interface PortScanner {
  scan(): Promise<ListeningPort[]>;
  /** True when the port answers an HTTP request on loopback within a short timeout. */
  answersHttp(port: number): Promise<boolean>;
}
