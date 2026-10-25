import { createConnection } from "node:net";

/** A refused TCP connection confirms closure; timeouts and unexpected errors do not. */
export async function portClosed(port: number): Promise<boolean> {
  const answers = await Promise.all(
    ["127.0.0.1", "::1"].map(
      (host) =>
        new Promise<boolean>((resolve) => {
          const socket = createConnection({ host, port });
          const finish = (closed: boolean) => {
            socket.destroy();
            resolve(closed);
          };
          socket.once("connect", () => finish(false));
          socket.once("error", (error: NodeJS.ErrnoException) =>
            finish(error.code === "ECONNREFUSED" || error.code === "EAFNOSUPPORT"),
          );
          socket.setTimeout(800, () => finish(false));
        }),
    ),
  );
  return answers.every(Boolean);
}
