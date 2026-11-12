import { useCallback, useRef } from 'react';

/**
 * Returns a function whose identity never changes.
 * The latest `fn` is read from a ref, so memoized children can take the callback
 * without re-rendering when the parent renders again.
 */
export function useStableCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result
): (...args: Args) => Result {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: Args) => ref.current(...args), []);
}
