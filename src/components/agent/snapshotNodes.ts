import type { EndpointNode, NodeConfig } from '../../types';

/** Settings-shaped copy of the cluster, without live ping fields. */
export function snapshotNodeConfigs(list: EndpointNode[]): NodeConfig[] {
  return list.map(node => {
    const {
      online: _online,
      latency: _latency,
      models: _models,
      loaded: _loaded,
      error: _error,
      version: _version,
      ...config
    } = node;
    return JSON.parse(JSON.stringify(config)) as NodeConfig;
  });
}
