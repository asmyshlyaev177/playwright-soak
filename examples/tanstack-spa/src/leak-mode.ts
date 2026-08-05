import { useSearch } from '@tanstack/react-router';

/**
 * `?leak=true` swaps the app into a deliberately leaky version of itself, so
 * the same soak test can be shown passing and failing.
 */
export function useLeakMode(): boolean {
  const search = useSearch({ strict: false }) as { leak?: boolean };
  return search.leak === true;
}
