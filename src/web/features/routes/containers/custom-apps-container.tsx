import { CustomAppsField } from "../components/custom-apps-field.tsx";
import { useCustomApps } from "../hooks/use-custom-apps.ts";

/** The custom open-with apps in Settings, loaded and saved apart from the config. */
export function CustomAppsContainer() {
  const form = useCustomApps();
  return (
    <CustomAppsField
      apps={form.apps}
      error={form.error}
      status={form.status}
      onChange={form.change}
      onAdd={form.add}
      onRemove={form.remove}
      onSave={() => void form.save()}
    />
  );
}
