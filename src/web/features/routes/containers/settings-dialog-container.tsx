import { SettingsDialog } from "../components/settings-dialog.tsx";
import { useRouteActions } from "../hooks/use-route-actions.ts";
import { useSettingsForm } from "../hooks/use-settings-form.ts";

/** Loads the config when the panel opens and closes it after a successful save. */
export function SettingsDialogContainer({ onClose }: { onClose: () => void }) {
  const form = useSettingsForm({ onSaved: onClose });
  const actions = useRouteActions();
  return (
    <SettingsDialog
      form={form}
      onCopyPath={(path) => void actions.copyPath(path)}
      onClose={onClose}
    />
  );
}
