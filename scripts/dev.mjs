// Runs the API server and the Vite dev server together, on every system: `a & b` in a package
// script needs a POSIX shell, and on Windows cmd.exe it waits for `a` to end first. Ctrl+C or a
// failure of either one stops both.
import { spawn } from "node:child_process";

const scripts = ["dev:server", "dev:web"];
const children = scripts.map((name) =>
  spawn(process.execPath, ["--run", name], { stdio: "inherit" }),
);

let stopping = false;
function stopAll(code) {
  if (!stopping) {
    stopping = true;
    process.exitCode = code;
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  }
}

for (const child of children) {
  child.on("exit", (code) => stopAll(code ?? 0));
  child.on("error", (error) => {
    console.error(error.message);
    stopAll(1);
  });
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(signal, () => stopAll(0));
}
