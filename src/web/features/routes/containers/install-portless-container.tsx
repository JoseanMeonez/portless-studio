import { InstallPortlessBanner } from "../components/install-portless-banner.tsx";
import { useInstallPortless } from "../hooks/use-install-portless.ts";

/** Connects the install banner to the install action. */
export function InstallPortlessContainer({
  onCopyCommand,
}: {
  onCopyCommand: (command: string) => void;
}) {
  const { status, error, output, install } = useInstallPortless();
  return (
    <InstallPortlessBanner
      status={status}
      error={error}
      output={output}
      onInstall={() => void install()}
      onCopyCommand={onCopyCommand}
    />
  );
}
