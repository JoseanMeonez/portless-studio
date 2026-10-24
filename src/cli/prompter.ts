import { createInterface } from "node:readline/promises";

/** Asks the person running `init`. Injected so tests can answer from a script. */
export interface Prompter {
  /** A yes/no question; an empty answer takes `defaultYes`. */
  confirm(question: string, defaultYes?: boolean): Promise<boolean>;
  /** A text question; an empty answer takes `defaultValue`. */
  ask(question: string, defaultValue: string): Promise<string>;
  /**
   * Releases the terminal while `task` runs, so a child process such as `sudo` reads the keyboard
   * on its own, then takes it back.
   */
  suspend<T>(task: () => Promise<T>): Promise<T>;
  close(): void;
}

/** Reads answers from a terminal (or any pair of streams). */
export function createTerminalPrompter(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Prompter {
  const open = () => {
    const created = createInterface({ input, output });
    created.on("SIGINT", () => {
      created.close();
      output.write("\nCancelled.\n");
      process.exit(130);
    });
    return created;
  };
  let rl = open();

  return {
    async suspend(task) {
      // An open readline keeps the terminal in raw mode and reads keystrokes meant for the child.
      rl.close();
      try {
        return await task();
      } finally {
        rl = open();
      }
    },
    async confirm(question, defaultYes = true) {
      const hint = defaultYes ? "(Y/n)" : "(y/N)";
      for (;;) {
        const answer = (await rl.question(`${question} ${hint} `)).trim().toLowerCase();
        if (answer === "") return defaultYes;
        if (answer === "y" || answer === "yes") return true;
        if (answer === "n" || answer === "no") return false;
        output.write("Please answer y or n.\n");
      }
    },
    async ask(question, defaultValue) {
      const answer = (await rl.question(`${question} (${defaultValue}) `)).trim();
      return answer === "" ? defaultValue : answer;
    },
    close: () => rl.close(),
  };
}

/** Answers every question with its default, for `init --yes`, printing each one. */
export function createDefaultsPrompter(print: (line: string) => void): Prompter {
  return {
    suspend: (task) => task(),
    async confirm(question, defaultYes = true) {
      print(`? ${question} ${defaultYes ? "yes" : "no"}`);
      return defaultYes;
    },
    async ask(question, defaultValue) {
      print(`? ${question} ${defaultValue}`);
      return defaultValue;
    },
    close: () => {},
  };
}
