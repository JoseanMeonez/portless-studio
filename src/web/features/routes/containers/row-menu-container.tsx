import type { OpenWithApp } from "../../../../core/api/contract.ts";
import { ContextMenu, type MenuEntry } from "../../../shared/ui/context-menu.tsx";
import { useRouteActions } from "../hooks/use-route-actions.ts";

/** What the row menu acts on: a route or a detected port. */
export type RowMenuTarget = {
  /** Shown in the menu's accessible name, e.g. `web.acme` or `port 5173`. */
  label: string;
  url: string;
  /** Project folder; null hides the folder actions. */
  path: string | null;
};

export type RowMenuRequest = { target: RowMenuTarget; x: number; y: number };

type RowMenuContainerProps = {
  request: RowMenuRequest;
  apps: readonly OpenWithApp[];
  onOpenWith: (app: OpenWithApp, path: string) => void;
  onCustomize: () => void;
  onClose: () => void;
};

/** The right-click menu of a row: open, copy, reveal the folder and open it with an app. */
export function RowMenuContainer({
  request,
  apps,
  onOpenWith,
  onCustomize,
  onClose,
}: RowMenuContainerProps) {
  const actions = useRouteActions();
  const { target } = request;
  return (
    <ContextMenu
      label={`Actions for ${target.label}`}
      x={request.x}
      y={request.y}
      entries={rowMenuEntries(target, apps, {
        openUrl: () => window.open(target.url, "_blank", "noopener,noreferrer"),
        copyUrl: () => void actions.copyLink(target.url),
        copyPath: (path) => void actions.copyPath(path),
        openWith: onOpenWith,
        customize: onCustomize,
      })}
      onClose={onClose}
    />
  );
}

type RowMenuActions = {
  openUrl: () => void;
  copyUrl: () => void;
  copyPath: (path: string) => void;
  openWith: (app: OpenWithApp, path: string) => void;
  customize: () => void;
};

function rowMenuEntries(
  target: RowMenuTarget,
  apps: readonly OpenWithApp[],
  run: RowMenuActions,
): MenuEntry[] {
  const entries: MenuEntry[] = [
    {
      kind: "item",
      id: "open",
      label: "Open in browser",
      icon: "arrowUpRight",
      onSelect: run.openUrl,
    },
    { kind: "item", id: "copy-url", label: "Copy URL", icon: "copy", onSelect: run.copyUrl },
  ];
  const { path } = target;
  if (path === null) return entries;

  entries.push({
    kind: "item",
    id: "copy-path",
    label: "Copy path",
    icon: "copy",
    onSelect: () => run.copyPath(path),
  });
  const fileManager = apps.find((app) => app.kind === "file-manager");
  if (fileManager) {
    entries.push({
      kind: "item",
      id: "reveal",
      label: `Reveal in ${fileManager.name}`,
      icon: "folder",
      onSelect: () => run.openWith(fileManager, path),
    });
  }
  const editors = apps.filter((app) => app.kind !== "file-manager");
  entries.push({
    kind: "submenu",
    id: "open-with",
    label: "Open with",
    icon: "terminal",
    entries: [
      ...(editors.length > 0
        ? editors.map(
            (app): MenuEntry => ({
              kind: "item",
              id: `app-${app.id}`,
              label: app.name,
              onSelect: () => run.openWith(app, path),
            }),
          )
        : [
            {
              kind: "item" as const,
              id: "no-apps",
              label: "No editors found",
              disabled: true,
              onSelect: () => {},
            },
          ]),
      { kind: "separator", id: "custom-separator" },
      {
        kind: "item",
        id: "customize",
        label: "Customize apps…",
        icon: "settings",
        onSelect: run.customize,
      },
    ],
  });
  return entries;
}
