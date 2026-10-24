import type { StudioActionResponse } from "../../../../core/api/contract.ts";
import { HealthPanel } from "../components/health-panel.tsx";
import { apiErrorMessage } from "../hooks/route-messages.ts";
import type { DoctorState } from "../hooks/use-doctor.ts";
import { useRouteActions } from "../hooks/use-route-actions.ts";
import type { ServiceControl } from "../hooks/use-service-control.ts";

type HealthPanelContainerProps = {
  doctor: DoctorState;
  services: ServiceControl;
  /** Studio answered a stop; the page shows how to start it again. */
  onStudioStopped: (response: StudioActionResponse) => void;
  onClose: () => void;
};

/** Runs the checks again when the panel opens, and connects fixes and Studio controls. */
export function HealthPanelContainer({
  doctor,
  services,
  onStudioStopped,
  onClose,
}: HealthPanelContainerProps) {
  const actions = useRouteActions();

  const stopStudio = async () => {
    const response = await services.controlStudio("stop");
    if (response) onStudioStopped(response);
  };

  return (
    <HealthPanel
      checks={doctor.checks}
      error={doctor.error ? apiErrorMessage(doctor.error) : null}
      fixing={doctor.fixing}
      studioBusy={services.studioBusy}
      onFix={(id) => void doctor.fix(id)}
      onCopy={(command) => void actions.copyCommand(command)}
      onRefresh={() => void doctor.refresh()}
      onRestartStudio={() => void services.controlStudio("restart")}
      onStopStudio={() => void stopStudio()}
      onClose={onClose}
    />
  );
}
