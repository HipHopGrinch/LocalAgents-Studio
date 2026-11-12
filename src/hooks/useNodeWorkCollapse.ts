import { useState } from 'react';

const STORAGE_KEY = 'localagents.nodeWorkCollapse';

export type NodeWorkCollapsePref = 'auto' | 'collapsed' | 'expanded';

function readPref(): NodeWorkCollapsePref {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'collapsed' || raw === 'expanded' || raw === 'auto') return raw;
  } catch {
    /* private mode or a blocked storage partition */
  }
  return 'auto';
}

function writePref(pref: NodeWorkCollapsePref) {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
}

/**
 * Node Work follows the live step list unless the user pins it open or closed.
 * `auto` collapses when `nodeWorkSteps` is empty and opens when a step appears.
 */
export function useNodeWorkCollapse(hasSteps: boolean): {
  collapsed: boolean;
  toggle: () => void;
} {
  const [pref, setPref] = useState<NodeWorkCollapsePref>(readPref);
  const collapsed = pref === 'collapsed' || (pref === 'auto' && !hasSteps);

  const toggle = () => {
    setPref(current => {
      const isCollapsed = current === 'collapsed' || (current === 'auto' && !hasSteps);
      const next: NodeWorkCollapsePref = isCollapsed ? (hasSteps ? 'auto' : 'expanded') : 'collapsed';
      writePref(next);
      return next;
    });
  };

  return { collapsed, toggle };
}
