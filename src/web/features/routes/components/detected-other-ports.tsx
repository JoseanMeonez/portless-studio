import type { OtherPort } from "../../../../core/ports/helper-ports.ts";
import { Icon } from "../../../shared/ui/icons/icon.tsx";
import styles from "./detected-other-ports.module.css";
import { DirectUrl } from "./direct-url.tsx";

type DetectedOtherPortsProps = {
  ports: readonly OtherPort[];
  open: boolean;
  onToggle: () => void;
  onCopyDirectUrl: (port: number) => void;
};

/**
 * Detected ports that are not servers to name: helper ports of a named server, debuggers and
 * ports the system handed out. Closed by default and quieter than the main list.
 */
export function DetectedOtherPorts({
  ports,
  open,
  onToggle,
  onCopyDirectUrl,
}: DetectedOtherPortsProps) {
  if (ports.length === 0) return null;
  return (
    <div className={styles.other}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={open ? "detected-other-ports" : undefined}
        onClick={onToggle}
      >
        <Icon
          name="chevronDown"
          size={12}
          className={open ? styles.chevron : `${styles.chevron} ${styles.closed}`}
        />
        Other ports ({ports.length})
      </button>
      {open ? (
        <ul id="detected-other-ports" className={styles.list} aria-label="Other ports">
          {ports.map((item) => (
            <li key={item.port} className={styles.row} data-port={item.port}>
              <span className={styles.port}>:{item.port}</span>
              <span className={styles.process}>{item.processName || "unknown process"}</span>
              <span className={styles.reason}>{otherPortReason(item)}</span>
              <DirectUrl port={item.port} onCopy={() => onCopyDirectUrl(item.port)} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Why the port is here, in words: "internal port of api.acme", "debugger", "temporary port". */
export function otherPortReason(item: OtherPort): string {
  const of = item.routeName ? ` of ${item.routeName}` : "";
  if (item.reason === "sibling") return `internal port${of}`;
  if (item.reason === "debugger") return `debugger${of}`;
  return `temporary port${of}`;
}
