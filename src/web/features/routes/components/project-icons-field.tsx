import { projectIconKind } from "../../../../core/projects/project-icon.ts";
import { Button } from "../../../shared/ui/button.tsx";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import { ItemIcon } from "../../../shared/ui/item-icon.tsx";
import styles from "./project-icons-field.module.css";

type ProjectIconsFieldProps = {
  /** Project names to offer: the ones on the dashboard and the ones with an icon already. */
  projects: readonly string[];
  icons: Readonly<Record<string, string>>;
  error: string | null;
  onChange: (project: string, value: string) => void;
};

/** One row per project: a preview, the emoji or URL, and a button that clears it. */
export function ProjectIconsField({ projects, icons, error, onChange }: ProjectIconsFieldProps) {
  if (projects.length === 0) {
    return <p className={styles.hint}>Projects show up here once one of their servers runs.</p>;
  }
  return (
    <div className={styles.field}>
      <p className={styles.hint}>
        An emoji, an http(s) image URL or a data:image URL. Studio downloads URLs itself. Empty uses
        the favicon the project's server serves.
      </p>
      <ul className={styles.list}>
        {projects.map((project) => {
          const value = icons[project] ?? "";
          const kind = projectIconKind(value.trim());
          const preview = kind === "text" || kind === "image" ? value.trim() : undefined;
          return (
            <li key={project} className={styles.row}>
              <ItemIcon icon={preview} name={project} />
              <span className={styles.name} title={project}>
                {project}
              </span>
              <input
                className={styles.input}
                aria-label={`Icon for ${project}`}
                placeholder="🚀 or https://…"
                value={value}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => onChange(project, event.target.value)}
              />
              <Button
                size="xs"
                variant="ghost"
                iconOnly
                aria-label={`Clear the icon of ${project}`}
                title="Clear"
                disabled={value === ""}
                onClick={() => onChange(project, "")}
              >
                <Icon name="x" size={14} />
              </Button>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
