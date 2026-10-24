import { SettingsDialog } from "../components/settings-dialog.tsx";
import { useRouteActions } from "../hooks/use-route-actions.ts";
import { useSettingsForm } from "../hooks/use-settings-form.ts";
import { CustomAppsContainer } from "./custom-apps-container.tsx";

/** Loads the config when the panel opens and closes it after a successful save. */
export function SettingsDialogContainer({
  projects,
  onClose,
}: {
  /** Projects the dashboard shows, offered in the icon settings. */
  projects: readonly string[];
  onClose: () => void;
}) {
  const form = useSettingsForm({ onSaved: onClose });
  const actions = useRouteActions();
  return (
    <SettingsDialog
      form={form}
      projects={projects}
      onCopyPath={(path) => void actions.copyPath(path)}
      onClose={onClose}
      customApps={<CustomAppsContainer />}
    />
  );
}
