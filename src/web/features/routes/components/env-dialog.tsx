import { Button } from "../../../shared/ui/button.tsx";
import { Dialog } from "../../../shared/ui/dialog.tsx";
import { Switch } from "../../../shared/ui/switch.tsx";
import { TextField } from "../../../shared/ui/text-field.tsx";
import styles from "./env-dialog.module.css";

type EnvDialogProps = {
  routeNames: readonly string[];
  excluded: ReadonlySet<string>;
  onToggle: (name: string) => void;
  prefix: string;
  onPrefixChange: (prefix: string) => void;
  strip: string;
  onStripChange: (strip: string) => void;
  direct: boolean;
  onDirectChange: (direct: boolean) => void;
  lines: readonly string[];
  /** Why the lines cannot be built, e.g. a prefix that is not a variable name. */
  error: string | null;
  onCopy: () => void;
  onClose: () => void;
};

/** Picks routes, a key prefix and a suffix to drop, and previews the `.env` lines they give. */
export function EnvDialog(props: EnvDialogProps) {
  const { lines, error } = props;
  return (
    <Dialog
      title="Copy routes as .env lines"
      description="Point an app at another one by name: the URL stays the same when its port changes."
      size="lg"
      onClose={props.onClose}
    >
      <div className={styles.body}>
        <fieldset className={styles.routes}>
          <legend className={styles.legend}>Routes</legend>
          {props.routeNames.map((name) => (
            <label key={name} className={styles.option}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={!props.excluded.has(name)}
                onChange={() => props.onToggle(name)}
              />
              <span className={styles.optionLabel}>{name}</span>
            </label>
          ))}
        </fieldset>
        <div className={styles.fields}>
          <TextField
            label="Prefix"
            placeholder="VITE_"
            hint="Put in front of every key, e.g. VITE_ or NEXT_PUBLIC_."
            mono
            value={props.prefix}
            onChange={(event) => props.onPrefixChange(event.target.value)}
          />
          <TextField
            label="Strip suffix"
            placeholder="acme"
            hint="Dropped from names: acme turns api.acme into API_URL."
            mono
            value={props.strip}
            onChange={(event) => props.onStripChange(event.target.value)}
          />
        </div>
        <Switch
          label="Direct URLs"
          description="Use http://localhost:<port>, which changes when the port does."
          checked={props.direct}
          onChange={props.onDirectChange}
        />
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <output className={styles.preview} aria-label="Preview">
          {lines.join("\n")}
        </output>
        <footer className={styles.footer}>
          <Button variant="ghost" size="sm" onClick={props.onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={error !== null || lines.length === 0}
            onClick={props.onCopy}
          >
            Copy
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}
