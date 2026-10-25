import type { OpenWithApp } from "../../../../core/api/contract.ts";
import { ContextMenu, type MenuEntry } from "../../../shared/ui/context-menu.tsx";
import { useRouteActions } from "../hooks/use-route-actions.ts";

/** What the row menu acts on: a route or a detected port. */
export type RowMenuTarget = {
  /** Shown in the menu's accessible name, e.g. `web.acme` or `port 5173`. */
  label: string;
  url: string;
  /** `http://localhost:<port>`; the direct entries are left out when it equals `url`. */
  directUrl: string;
  port: number;
  /** `KEY=url` for a `.env` file; absent for ports without a name. */
  envLine?: string;
  /** Project folder; null hides the folder actions. */
  path: string | null;
};

export type RowMenuRequest = { target: RowMenuTarget; x: number; y: number };

type RowMenuContainerProps = {
  request: RowMenuRequest;
  apps: readonly OpenWithApp[];
  onOpenWith: (app: OpenWithApp, path: string) => void;
  onCustomize: () => void;
  /** Opens a terminal for the item in the folder; the entry is hidden without it. */
  onOpenTerminal?: ((path: string, port: number) => void) | undefined;
  onClose: () => void;
};

/** The right-click menu of a row: open, copy, reveal the folder and open it with an app. */
export function RowMenuContainer({
  request,
  apps,
  onOpenWith,
  onCustomize,
  onOpenTerminal,
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
        openUrl: () => actions.openLink(target.url),
        copyUrl: () => void actions.copyLink(target.url),
        openDirectUrl: () => actions.openLink(target.directUrl),
        copyDirectUrl: () => void actions.copyLink(target.directUrl),
        copyEnvLine: (line) => void actions.copyEnvLines([line]),
        copyPath: (path) => void actions.copyPath(path),
        openWith: onOpenWith,
        customize: onCustomize,
        openTerminal: onOpenTerminal ? (path) => onOpenTerminal(path, target.port) : undefined,
      })}
      onClose={onClose}
    />
  );
}

type RowMenuActions = {
  openUrl: () => void;
  copyUrl: () => void;
  openDirectUrl: () => void;
  copyDirectUrl: () => void;
  copyEnvLine: (line: string) => void;
  copyPath: (path: string) => void;
  openWith: (app: OpenWithApp, path: string) => void;
  customize: () => void;
  openTerminal: ((path: string) => void) | undefined;
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
  if (target.directUrl !== target.url) {
    entries.push(
      {
        kind: "item",
        id: "open-direct",
        label: "Open direct URL",
        icon: "arrowUpRight",
        onSelect: run.openDirectUrl,
      },
      {
        kind: "item",
        id: "copy-direct",
        label: "Copy direct URL",
        icon: "copy",
        onSelect: run.copyDirectUrl,
      },
    );
  }
  const { envLine, path } = target;
  if (envLine !== undefined) {
    entries.push({
      kind: "item",
      id: "copy-env",
      label: "Copy as .env line",
      icon: "copy",
      onSelect: () => run.copyEnvLine(envLine),
    });
  }
  if (path === null) return entries;

  entries.push({
    kind: "item",
    id: "copy-path",
    label: "Copy path",
    icon: "copy",
    onSelect: () => run.copyPath(path),
  });
  const { openTerminal } = run;
  if (openTerminal) {
    entries.push({
      kind: "item",
      id: "open-terminal",
      label: "Open terminal",
      icon: "terminal",
      onSelect: () => openTerminal(path),
    });
  }
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
