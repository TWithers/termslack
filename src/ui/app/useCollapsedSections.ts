import { useEffect, useMemo, useState } from "react";
import type { CollapseMemory } from "../../config/state";

/**
 * The sidebar sections the user collapsed. Recalls what an earlier run
 * remembered (keeping anything collapsed since) and remembers every change.
 */
export function useCollapsedSections(memory?: CollapseMemory): {
  collapsed: ReadonlySet<string>;
  /** Collapses or expands a section, and remembers the choice. */
  setSectionCollapsed(id: string, collapse: boolean): void;
} {
  const [ids, setIds] = useState<readonly string[]>([]);
  const collapsed = useMemo(() => new Set(ids), [ids]);

  useEffect(() => {
    let cancelled = false;

    void memory?.recall().then((recalled) => {
      if (!cancelled) {
        setIds((current) => [...new Set([...recalled, ...current])]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [memory]);

  function setSectionCollapsed(id: string, collapse: boolean) {
    if (collapsed.has(id) === collapse) {
      return;
    }

    const next = collapse ? [...ids, id] : ids.filter((other) => other !== id);

    setIds(next);
    memory?.remember(next);
  }

  return { collapsed, setSectionCollapsed };
}
