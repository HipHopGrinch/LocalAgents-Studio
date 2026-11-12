/** Runtime fields a live-session snapshot may carry. They are not settings. */
const LIVE_RUNTIME_FIELDS = ['online', 'latency', 'models', 'loaded', 'error', 'hasApiKey'] as const;

export interface SettingsNodeLike {
  id: string;
  apiKey?: string;
}

/**
 * Take config from a live snapshot without copying runtime status into settings.
 * API keys are stripped from session publish (`hasApiKey` only). Copy the key back
 * from the settings that were just loaded, matched by node id.
 */
export function settingsNodesFromLiveSnapshot<T extends SettingsNodeLike>(
  saved: readonly T[],
  liveNodes: ReadonlyArray<T>
): T[] {
  return liveNodes.map(live => {
    const cfg = { ...live } as T & Record<string, unknown>;
    for (const key of LIVE_RUNTIME_FIELDS) delete cfg[key];
    const prior = saved.find(node => node.id === cfg.id);
    const key = typeof cfg.apiKey === 'string' ? cfg.apiKey : '';
    if ((!key || key === '********') && prior?.apiKey) {
      cfg.apiKey = prior.apiKey;
    }
    return cfg;
  });
}
