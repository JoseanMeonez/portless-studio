import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import type { RowTerminal } from "./row-terminal.ts";

/** Logs, then Stop while it runs or Run again once it ended, for a row's terminal. */
export function RowTerminalActions({ terminal, label }: { terminal: RowTerminal; label: string }) {
  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        aria-label={`Logs of ${label}`}
        title="Show the terminal (T)"
        onClick={terminal.onShow}
      >
        <Icon name="terminal" size={14} />
        Logs
      </Button>
      {terminal.running ? (
        <Button
          size="xs"
          variant="ghost"
          iconOnly
          aria-label={`Stop the terminal of ${label}`}
          title={`Stop ${terminal.title}`}
          onClick={terminal.onStop}
        >
          <Icon name="power" size={14} />
        </Button>
      ) : (
        <Button
          size="xs"
          variant="ghost"
          iconOnly
          aria-label={`Run the terminal of ${label} again`}
          title={`Run ${terminal.title} again`}
          onClick={terminal.onRunAgain}
        >
          <Icon name="refresh" size={14} />
        </Button>
      )}
    </>
  );
}
