import * as nodeFs from "node:fs";
import * as path from "node:path";

/** The file calls a write makes; tests pass a fake to simulate a locked file. */
export type AtomicWriteFs = {
  mkdirSync(dir: string, options: { recursive: true }): unknown;
  writeFileSync(file: string, text: string): void;
  renameSync(from: string, to: string): void;
  copyFileSync(from: string, to: string): void;
  rmSync(file: string, options: { force: true }): void;
};

export type AtomicWriteOptions = { fs?: AtomicWriteFs; pid?: number; sleep?: (ms: number) => void };

// Windows refuses to replace a file another program (an editor, an antivirus scan) has open.
const LOCKED = new Set(["EPERM", "EBUSY", "EACCES"]);
const RETRY_DELAYS_MS = [20, 40, 80, 160];

/**
 * Writes a temporary file and renames it into place, so a reader never sees half a file. A rename
 * a lock refuses is retried with growing pauses, then replaced by a copy over the file.
 */
export function writeFileAtomic(
  file: string,
  text: string,
  options: AtomicWriteOptions = {},
): void {
  const fs = options.fs ?? nodeFs;
  const sleep = options.sleep ?? sleepSync;
  const temporary = `${file}.${options.pid ?? process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, text);
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(temporary, file);
        return;
      } catch (error) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (!LOCKED.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
        if (delay === undefined) break;
        sleep(delay);
      }
    }
    fs.copyFileSync(temporary, file);
    fs.rmSync(temporary, { force: true });
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
