import { type FormEvent, useState } from "react";
import type { CustomGroup } from "../../../../core/views/view.ts";
import { Button } from "../../../shared/ui/button.tsx";
import { Dialog } from "../../../shared/ui/dialog.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { TextField } from "../../../shared/ui/text-field.tsx";
import styles from "./move-to-group-dialog.module.css";

type MoveToGroupDialogProps = {
  routeName: string;
  viewName: string;
  groups: readonly CustomGroup[];
  /** Id of the group the route is in now, if any. */
  currentGroupId: string | null;
  onMove: (groupId: string | null) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
};

/** Puts a route in one of the current view's custom groups, or in a new one. */
export function MoveToGroupDialog({
  routeName,
  viewName,
  groups,
  currentGroupId,
  onMove,
  onCreate,
  onClose,
}: MoveToGroupDialogProps) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const create = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed) onCreate(trimmed);
  };

  return (
    <Dialog
      title={`Move ${routeName} to a group`}
      description={`Groups belong to the view "${viewName}". Group it by Custom groups to see them.`}
      onClose={onClose}
    >
      <div className={styles.body}>
        {groups.length > 0 ? (
          <ul className={styles.groups} aria-label="Groups">
            {groups.map((group) => (
              <li key={group.id}>
                <button
                  type="button"
                  className={styles.group}
                  aria-current={group.id === currentGroupId ? "true" : undefined}
                  onClick={() => onMove(group.id)}
                >
                  <Icon name="folder" size={14} className={styles.groupIcon} />
                  <span className={styles.groupName}>{group.name}</span>
                  {group.id === currentGroupId ? (
                    <span className={styles.note}>Current</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <form className={styles.create} onSubmit={create}>
          <TextField
            label="New group"
            placeholder="Backends"
            value={name}
            maxLength={60}
            autoFocus={groups.length === 0}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" variant="primary" size="sm" disabled={!trimmed}>
            Create and move
          </Button>
        </form>
        <footer className={styles.footer}>
          {currentGroupId ? (
            <Button variant="ghost" size="sm" onClick={() => onMove(null)}>
              Take it out of its group
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}
