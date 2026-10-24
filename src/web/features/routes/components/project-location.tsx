import type { ItemProject } from "../../../../core/routes/route.ts";
import { shortenPath } from "../../../shared/lib/shorten-path.ts";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import styles from "./project-location.module.css";

type ProjectLocationProps = {
  project: ItemProject | null | undefined;
  /** Leave the folder out when the row already shows one. */
  showPath?: boolean;
};

/**
 * Where a server runs: its git branch, the linked worktree and the folder, shortened with `~`
 * (the full path is the tooltip). Renders nothing when the project is unknown.
 */
export function ProjectLocation({ project, showPath = true }: ProjectLocationProps) {
  if (!project) return null;
  const { branch, worktree } = project;
  const folder = showPath ? (project.path ?? null) : null;
  if (!branch && !worktree && !folder) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset cannot sit inside the row's text line.
    <span className={styles.location} role="group" aria-label="Where it runs">
      {branch ? (
        <span className={styles.part} title={`Git branch ${branch}`}>
          <Icon name="branch" size={12} className={styles.icon} />
          <span className={styles.text}>{branch}</span>
        </span>
      ) : null}
      {worktree ? (
        <span className={styles.part} title={`Git worktree ${worktree}`}>
          <Icon name="layers" size={12} className={styles.icon} />
          <span className={styles.text}>{worktree}</span>
        </span>
      ) : null}
      {folder ? (
        <span className={styles.part}>
          <Icon name="folder" size={12} className={styles.icon} />
          <span className={styles.text} title={folder}>
            {shortenPath(folder)}
          </span>
        </span>
      ) : null}
    </span>
  );
}
