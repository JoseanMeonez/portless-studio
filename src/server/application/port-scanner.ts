/** A TCP port in LISTEN state on this machine, as the operating system reports it. */
export type ListeningPort = {
  port: number;
  pid: number | null;
  processName: string;
  cwd: string | null;
  /** Full path of the executable: from `/proc` on Linux, `ps` on macOS, `Win32_Process` on Windows. */
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

/** One HTTP answer from a local port. */
export type HttpProbe = {
  status: number;
  latencyMs: number;
  /** The answer came from a Portless Studio (it sent `x-portless-studio`). */
  studio: boolean;
};

/** Sends one request to a loopback port; null when nothing answered in time. */
export type ProbePort = (port: number) => Promise<HttpProbe | null>;
