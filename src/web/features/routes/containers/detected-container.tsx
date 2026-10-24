import { useState } from "react";
import type { DetectedPort } from "../../../../core/ports/detected-port.ts";
import { DetectedSection } from "../components/detected-section.tsx";
import { useAutoName } from "../hooks/use-auto-name.ts";
import { useDetectedActions } from "../hooks/use-detected-actions.ts";

type DetectedContainerProps = {
  visible: readonly DetectedPort[];
  totalCount: number;
  autoName: boolean;
  /** Opens the Name a port dialog prefilled with this port and its suggested name. */
  onName: (detected: DetectedPort) => void;
};

export function DetectedContainer({
  visible,
  totalCount,
  autoName,
  onName,
}: DetectedContainerProps) {
  const actions = useDetectedActions();
  const auto = useAutoName(autoName);
  const [namingAll, setNamingAll] = useState(false);

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
    />
  );
}
