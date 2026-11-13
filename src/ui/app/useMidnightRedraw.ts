import { useEffect } from "react";
import { useForceRender } from "./useForceRender";

/** Re-renders just after local midnight, when `today` changes, so labels like "Today" move on. */
export function useMidnightRedraw(now: () => Date, today: string): void {
  const redraw = useForceRender();

  useEffect(() => {
    const current = now();
    const midnight = new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate() + 1,
    );
    const wait = Math.min(
      Math.max(midnight.getTime() - current.getTime(), 1000),
      2 ** 31 - 1,
    );
    const timer = setTimeout(redraw, wait);

    return () => clearTimeout(timer);
    // `now` is a stable function in practice; the day it reports is what matters.
  }, [today]);
}
