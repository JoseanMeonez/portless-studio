import { useState } from "react";
import { shortenPath } from "../../../shared/lib/shorten-path.ts";
import { type CommandItem, CommandMenu } from "../../../shared/ui/command-menu.tsx";
import type { TerminalFolder } from "../components/new-terminal-form.tsx";
import { OtherFolderDialog } from "../components/other-folder-dialog.tsx";
import type { TerminalPanelController } from "../hooks/use-terminal-panel.ts";

type TerminalPickerContainerProps = {
  panel: TerminalPanelController;
  /** Project and worktree folders Studio knows. */
  folders: readonly TerminalFolder[];
};

/**
 * New terminal: a searchable list of every project and worktree folder, plus Other folder to type
 * any folder on the machine. Picking one opens a shell there.
 */
export function TerminalPickerContainer({ panel, folders }: TerminalPickerContainerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setError(null);
    panel.setPicker("closed");
  };

  if (panel.picker === "other") {
    return (
      <OtherFolderDialog
        busy={busy}
        error={error}
        onClose={close}
        onSubmit={(folder) => {
          setBusy(true);
          void panel.openTypedFolder(folder).then((created) => {
            setBusy(false);
            if (created.ok) close();
            else setError(created.error.message);
          });
        }}
      />
    );
  }
  if (panel.picker !== "folders") return null;

  const items: CommandItem[] = [
    ...folders.map(
      (folder): CommandItem => ({
        id: `folder-${folder.path}`,
        group: "Project folders",
        label: folder.label,
        detail: [folder.branch, shortenPath(folder.path)].filter(Boolean).join(" · "),
        icon: "folder",
        onSelect: () => void panel.create({ cwd: folder.path }),
      }),
    ),
    {
      id: "other-folder",
      group: "Anywhere",
      label: "Other folder…",
      detail: "Type any folder on this machine",
      icon: "plus",
      onSelect: () => panel.setPicker("other"),
    },
  ];
  return (
    <CommandMenu
      items={items}
      onClose={close}
      label="New terminal"
      searchLabel="Search folders"
      placeholder="Open a shell in…"
    />
  );
}
