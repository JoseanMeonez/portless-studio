import { EventEmitter } from "node:events";
import { onShutdown, shutdownSignals } from "./shutdown.ts";

describe("shutdownSignals", () => {
  it("adds SIGHUP everywhere and SIGBREAK on Windows, which never sends SIGTERM", () => {
    expect(shutdownSignals("linux")).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
    expect(shutdownSignals("darwin")).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
    expect(shutdownSignals("win32")).toEqual(["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]);
  });

  it("stops on a closed console window", () => {
    const target = new EventEmitter();
    const stop = vi.fn();
    onShutdown(target, "win32", stop);
    target.emit("SIGHUP");
    target.emit("SIGBREAK");
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
