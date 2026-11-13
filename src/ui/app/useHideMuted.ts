import { useEffect, useRef, useState } from "react";
import type { HideMutedMemory } from "../../config/state";

/**
 * Whether the sidebar hides muted channels. Recalls what an earlier run
 * remembered (unless the user has already chosen since) and remembers every
 * change.
 */
export function useHideMuted(memory?: HideMutedMemory): {
  hideMuted: boolean;
  /** Hides or shows muted channels, and remembers the choice. */
  setHideMuted(hide: boolean): void;
} {
  const [hideMuted, setHidden] = useState(false);
  const chosen = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void memory?.recall().then((recalled) => {
      if (!cancelled && !chosen.current) {
        setHidden(recalled);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [memory]);

  function setHideMuted(hide: boolean) {
    chosen.current = true;
    setHidden(hide);
    memory?.remember(hide);
  }

  return { hideMuted, setHideMuted };
}
