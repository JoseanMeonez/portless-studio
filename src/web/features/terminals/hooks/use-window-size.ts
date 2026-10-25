import { useEffect, useState } from "react";

type WindowSize = { width: number; height: number };

const read = (): WindowSize => ({ width: window.innerWidth, height: window.innerHeight });

/** The window's inner size, kept current while it is resized. */
export function useWindowSize(): WindowSize {
  const [size, setSize] = useState(read);
  useEffect(() => {
    const update = () =>
      setSize((current) => {
        const next = read();
        return next.width === current.width && next.height === current.height ? current : next;
      });
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}
