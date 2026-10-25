import { useState } from "react";
import type { DetectedPort } from "../../../../core/ports/detected-port.ts";
import type { OtherPort } from "../../../../core/ports/helper-ports.ts";
import { DetectedSection } from "../components/detected-section.tsx";
import type { MenuPoint } from "../components/row-menu-trigger.ts";
import { useAutoName } from "../hooks/use-auto-name.ts";
import { useDetectedActions } from "../hooks/use-detected-actions.ts";
import { useRouteActions } from "../hooks/use-route-actions.ts";
import { useStopContainer } from "../hooks/use-stop-container.ts";
import { useStopProcess } from "../hooks/use-stop-process.ts";
import { useStoredFlag } from "../hooks/use-stored-flag.ts";

const COLLAPSED_KEY = "portless-studio:detected-collapsed";
const OTHER_OPEN_KEY = "portless-studio:detected-other-open";

type DetectedContainerProps = {
  visible: readonly DetectedPort[];
  totalCount: number;
  /** Helper ports, debuggers and temporary ports from the snapshot. */
  otherPorts: readonly OtherPort[];
  autoName: boolean;
  /** Opens the Name a port dialog prefilled with this port and its suggested name. */
  onName: (detected: DetectedPort) => void;
  /** Opens the row menu (open with, copy path…) for this port. */
  onMenu: (detected: DetectedPort, point: MenuPoint) => void;
  /** Shows the port's terminal or opens a shell in its folder; absent hides the button. */
  onOpenTerminal?: ((detected: DetectedPort, folder: string) => void) | undefined;
};

export function DetectedContainer({
  visible,
  totalCount,
  otherPorts,
  autoName,
  onName,
  onMenu,
  onOpenTerminal,
}: DetectedContainerProps) {
  const routeActions = useRouteActions();
  const actions = useDetectedActions();
  const auto = useAutoName(autoName);
  const [namingAll, setNamingAll] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState<number | null>(null);
  const stopProcess = useStopProcess();
  const stopContainer = useStopContainer();
  const [collapsed, toggleCollapsed] = useStoredFlag(COLLAPSED_KEY, false);
  const [otherOpen, toggleOther] = useStoredFlag(OTHER_OPEN_KEY, false);

  const stop = async (item: DetectedPort) => {
    setConfirmingStop(null);
    if (item.container) return stopContainer(item.container.name);
    if (item.pid === null) return;
    await stopProcess({ pid: item.pid, port: item.port, processName: item.processName });
  };

  const nameAll = async () => {
    setNamingAll(true);
    await actions.nameAll(visible);
    setNamingAll(false);
  };

  return (
    <DetectedSection
      detected={visible}
      totalCount={totalCount}
      autoName={auto.enabled}
      autoNameSaving={auto.saving}
      namingAll={namingAll}
      onAutoNameChange={(enabled) => void auto.setEnabled(enabled)}
      onName={onName}
      onIgnore={(item) => void actions.ignore(item)}
      onNameAll={() => void nameAll()}
      confirmingStop={confirmingStop}
      onRequestStop={(item) => setConfirmingStop(item.port)}
      onConfirmStop={(item) => void stop(item)}
      onCancelStop={() => setConfirmingStop(null)}
      onMenu={onMenu}
      onCopyDirectUrl={(port) => void routeActions.copyDirectUrl(port)}
      otherPorts={otherPorts}
      collapsed={collapsed}
      onToggleCollapsed={toggleCollapsed}
      otherPortsOpen={otherOpen}
      onToggleOtherPorts={toggleOther}
      terminalFor={
        onOpenTerminal
          ? (item) => {
              const folder = item.project?.path ?? item.cwd;
              return folder ? () => onOpenTerminal(item, folder) : null;
            }
          : undefined
      }
    />
  );
}
