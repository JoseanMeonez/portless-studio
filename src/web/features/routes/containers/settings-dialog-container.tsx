import type { StudioConfig } from "../../../../core/config/studio-config.ts";
import { SettingsDialog } from "../components/settings-dialog.tsx";
import { useOpenWith } from "../hooks/use-open-with.ts";
import { useRouteActions } from "../hooks/use-route-actions.ts";
import { useSettingsForm } from "../hooks/use-settings-form.ts";
import { CustomAppsContainer } from "./custom-apps-container.tsx";

/** Loads the config when the panel opens and closes it after a successful save. */
export function SettingsDialogContainer({
  projects,
  onClose,
  onSaved,
}: {
  /** Projects the dashboard shows, offered in the icon settings. */
  projects: readonly string[];
  onClose: () => void;
  /** Gets the config that was saved. */
  onSaved?: ((config: StudioConfig) => void) | undefined;
}) {
  const form = useSettingsForm({
    onSaved: (config) => {
      onSaved?.(config);
      onClose();
    },
  });
  const actions = useRouteActions();
  const openWith = useOpenWith(true);
  return (
    <SettingsDialog
      form={form}
      projects={projects}
      onCopyPath={(path) => void actions.copyPath(path)}
      onClose={onClose}
      customApps={<CustomAppsContainer />}
      editorApps={openWith.apps}
    />
  );
}
