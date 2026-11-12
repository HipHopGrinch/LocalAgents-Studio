import { useCallback, useLayoutEffect, useRef, useState } from 'react';

const NEAR_BOTTOM_PX = 96;

/**
 * Pins a scroller to the bottom only while the user is already near it.
 * `signature` should change when new content arrives (including stream ticks).
 */
export function useStickToBottom(signature: string) {
  const ref = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [away, setAway] = useState(false);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < NEAR_BOTTOM_PX;
    stickRef.current = near;
    setAway(prev => (prev === !near ? prev : !near));
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [signature]);

  const jump = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    stickRef.current = true;
    el.scrollTop = el.scrollHeight;
    setAway(false);
  }, []);

  return { ref, onScroll, away, jump };
}
