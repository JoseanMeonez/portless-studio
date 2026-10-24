import { Button } from "../../../shared/ui/button.tsx";
import styles from "./no-matches.module.css";

type NoMatchesProps = {
  query: string;
  onClear: () => void;
};

export function NoMatches({ query, onClear }: NoMatchesProps) {
  return (
    <div className={styles.noMatches}>
      {query ? (
        <p>
          No routes match <span className={styles.query}>{query}</span>
        </p>
      ) : (
        <p>No routes match these filters</p>
      )}
      <Button variant="ghost" size="sm" onClick={onClear}>
        {query ? "Clear filter" : "Clear filters"}
      </Button>
    </div>
  );
}
