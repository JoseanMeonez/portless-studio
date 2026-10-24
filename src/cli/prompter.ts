import { createInterface } from "node:readline/promises";

/** Asks the person running `init`. Injected so tests can answer from a script. */
export interface Prompter {
  /** A yes/no question; an empty answer takes `defaultYes`. */
  confirm(question: string, defaultYes?: boolean): Promise<boolean>;
  /** A text question; an empty answer takes `defaultValue`. */
  ask(question: string, defaultValue: string): Promise<string>;
  close(): void;
}

/** Reads answers from a terminal (or any pair of streams). */
export function createTerminalPrompter(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Prompter {
  const rl = createInterface({ input, output });
  rl.on("SIGINT", () => {
    rl.close();
    output.write("\nCancelled.\n");
    process.exit(130);
  });

  return {
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
