import type { ProxyStatus, Route } from "../../../../core/routes/route.ts";
import { AliasDialog } from "../components/alias-dialog.tsx";
import { type AliasFormValues, useAliasForm } from "../hooks/use-alias-form.ts";
import { useRouteActions } from "../hooks/use-route-actions.ts";

export type AliasDialogRequest =
  /** `name` and `port` prefill the form, as when naming a detected port. */
  { mode: "create"; name?: string; port?: number } | { mode: "rename"; route: Route };

type AliasDialogContainerProps = {
  request: AliasDialogRequest;
  proxy: ProxyStatus;
  onClose: () => void;
};

export function AliasDialogContainer({ request, proxy, onClose }: AliasDialogContainerProps) {
  const actions = useRouteActions();
  const route = request.mode === "rename" ? request.route : null;
  const initialName = route ? route.name : request.mode === "create" ? request.name : undefined;
  const initialPort = route ? route.port : request.mode === "create" ? request.port : undefined;

  const form = useAliasForm({
    mode: request.mode,
    ...(initialName === undefined ? {} : { initialName }),
    ...(initialPort === undefined ? {} : { initialPort }),
    proxy,
    submit: ({ name, port, force }: AliasFormValues) =>
      route
        ? actions.renameAlias(route, name)
        : actions.createAlias(force ? { name, port, force } : { name, port }),
    onDone: onClose,
  });

  return (
    <AliasDialog
      mode={request.mode}
      {...(route ? { currentName: route.name } : {})}
      form={form}
      onClose={onClose}
    />
  );
}
