import { useReducer } from "react";

/** A function that re-renders the component, for state kept outside React (a ref, say) that just changed. */
export function useForceRender(): () => void {
  const [, force] = useReducer((count: number) => count + 1, 0);

  return force;
}
