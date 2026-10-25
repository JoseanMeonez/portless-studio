import { createServer, type Server, type Socket, connect as tcpConnect } from "node:net";
import { err, ok, type Result } from "../../../core/result.ts";

/** Loopback on IPv4 and IPv6, because browsers may resolve `name.localhost` to either. */
export const LOOPBACK_HOSTS = ["127.0.0.1", "::1"] as const;

/** Why the forwarder could not listen: the system refused this user, or a program holds the port. */
export type ForwarderFailure = {
  reason: "denied" | "in-use" | "failed";
  message: string;
};

export type RunningForwarder = {
  /** The port it listens on; the real one when `0` was asked for. */
  port: number;
  close(): Promise<void>;
};

export type ForwarderOptions = {
  port: number;
  /** Defaults to `LOOPBACK_HOSTS`. */
  hosts?: readonly string[];
  /** Where every connection goes: the portless proxy on 127.0.0.1. */
  targetPort: number;
  targetHost?: string;
};

/** A system without IPv6 cannot bind `::1`; that is not a failure when IPv4 works. */
const NO_ADDRESS = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT"]);

/**
 * Listens on loopback and pipes every TCP connection to the target, byte for byte. Piping the
 * connection rather than re-sending requests keeps the Host header, the method, streamed bodies,
 * keep-alive and WebSocket upgrades exactly as the browser sent them; portless then adds its own
 * `X-Forwarded-*` headers from that Host. Never asks for more rights: a refused bind is reported.
 */
export async function startForwarder(
  options: ForwarderOptions,
): Promise<Result<RunningForwarder, ForwarderFailure>> {
  const hosts = options.hosts ?? LOOPBACK_HOSTS;
  const targetHost = options.targetHost ?? "127.0.0.1";
  const sockets = new Set<Socket>();
  const servers: Server[] = [];
  let port = options.port;

  const handle = (client: Socket) => {
    const upstream = tcpConnect({ host: targetHost, port: options.targetPort });
    sockets.add(client);
    sockets.add(upstream);
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    const finish = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on("error", finish);
    upstream.on("error", finish);
    client.on("close", finish);
    upstream.on("close", finish);
    client.pipe(upstream);
    upstream.pipe(client);
  };

  const close = async () => {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  };

  for (const [index, host] of hosts.entries()) {
    const server = createServer(handle);
    const bound = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      server.once("error", resolve);
      server.listen({ port, host, exclusive: true }, () => {
        server.off("error", resolve);
        resolve(null);
      });
    });
    if (bound === null) {
      servers.push(server);
      // Port 0 picks a free port on the first host; the others use that same one.
      if (index === 0) port = (server.address() as { port: number }).port;
      continue;
    }
    if (index > 0 && NO_ADDRESS.has(bound.code ?? "")) continue;
    await close();
    return err(failureOf(bound, port));
  }
  return ok({ port, close });
}

function failureOf(error: NodeJS.ErrnoException, port: number): ForwarderFailure {
  if (error.code === "EADDRINUSE") {
    return { reason: "in-use", message: `port ${port} is in use by another program.` };
  }
  if (error.code === "EACCES" || error.code === "EPERM") {
    return {
      reason: "denied",
      message: `this system does not let this user listen on port ${port} without sudo.`,
    };
  }
  return { reason: "failed", message: `could not listen on port ${port}: ${error.message}` };
}
