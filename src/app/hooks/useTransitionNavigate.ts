import { useCallback, useTransition } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Wraps react-router navigate with React.startTransition so the current page
 * stays visible while a lazy-loaded route chunk is fetched, preventing the
 * Suspense fallback (PageSkeleton) from flashing.
 */
export function useTransitionNavigate() {
  const navigate = useNavigate();
  const [isPending, startTransition] = useTransition();

  const transitionNavigate = useCallback(
    (to: string) => {
      startTransition(() => {
        navigate(to);
      });
    },
    [navigate, startTransition],
  );

  return { navigate: transitionNavigate, isPending };
}
