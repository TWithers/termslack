import { useEffect } from "react";
import { useForceRender } from "./useForceRender";

/** Milliseconds from `date` to the start of the next minute (at least a few, so a tick on the boundary does not repeat at once). */
export function msUntilNextMinute(date: Date): number {
  const sinceMinute = date.getSeconds() * 1000 + date.getMilliseconds();

  return Math.max(60_000 - sinceMinute, 20);
}

/** While `active`, re-renders at the start of every minute, so a clock drawn from `now` keeps up. */
export function useMinuteRedraw(now: () => Date, active: boolean): void {
  const redraw = useForceRender();

  useEffect(() => {
    if (!active) {
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        redraw();
        schedule();
      }, msUntilNextMinute(now()));
    };

    schedule();

    return () => clearTimeout(timer);
    // `now` is a stable function in practice; whether a clock shows is what matters.
  }, [active]);
}
