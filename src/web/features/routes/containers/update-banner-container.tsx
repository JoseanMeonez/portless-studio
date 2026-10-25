import { UpdateBanner } from "../components/update-banner.tsx";
import { useUpdateNotice } from "../hooks/use-update-notice.ts";

/** Shows the update notice when the server knows of a newer release not yet dismissed. */
export function UpdateBannerContainer({
  onCopyCommand,
}: {
  onCopyCommand: (command: string) => void;
}) {
  const { update, dismiss } = useUpdateNotice();
  if (!update?.latest) return null;
  return (
    <UpdateBanner
      current={update.current}
      latest={update.latest}
      command={update.command}
      onCopyCommand={onCopyCommand}
      onDismiss={dismiss}
    />
  );
}
