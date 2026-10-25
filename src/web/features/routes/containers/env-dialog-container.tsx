import type { EnvRoute } from "../../../../core/routes/env-lines.ts";
import { EnvDialog } from "../components/env-dialog.tsx";
import { useEnvForm } from "../hooks/use-env-form.ts";
import { useRouteActions } from "../hooks/use-route-actions.ts";

type EnvDialogContainerProps = {
  routes: readonly EnvRoute[];
  onClose: () => void;
};

/** The `.env` dialog from the command menu: pick routes, preview the lines, copy them. */
export function EnvDialogContainer({ routes, onClose }: EnvDialogContainerProps) {
  const form = useEnvForm(routes);
  const actions = useRouteActions();
  return (
    <EnvDialog
      routeNames={[...routes].map((route) => route.name).sort()}
      excluded={form.excluded}
      onToggle={form.toggle}
      prefix={form.prefix}
      onPrefixChange={form.setPrefix}
      strip={form.strip}
      onStripChange={form.setStrip}
      direct={form.direct}
      onDirectChange={form.setDirect}
      lines={form.lines}
      error={form.error}
      onCopy={() => void actions.copyEnvLines(form.lines)}
      onClose={onClose}
    />
  );
}
