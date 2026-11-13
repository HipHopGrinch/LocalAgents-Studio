import type { ConductorRoleId, EndpointNode, RoleRoutePick, RoleRoutes } from '../types';
import { getEnabledModelsForNode, isFrontierNode } from './tools';

export const CONDUCTOR_ROLE_IDS: readonly ConductorRoleId[] = ['planner', 'coder', 'reviewer'];

export interface RoleRouteChoice {
  node: EndpointNode;
  model: string;
}

export interface ResolvedRoleRoute {
  node: EndpointNode;
  model: string;
  source: 'pick' | 'auto';
  fallbackReason?: string;
}

/** Docs and any other persona use the Coder pick. Planner and Reviewer use their own. */
export function conductorRoleForPersona(agent: { handle?: string; id?: string }): ConductorRoleId {
  const handle = (agent.handle || agent.id || '').toLowerCase();
  if (handle === 'planner') return 'planner';
  if (handle === 'reviewer') return 'reviewer';
  return 'coder';
}

/** Drop blank and unknown entries. Empty means every role is Auto. */
export function normalizeRoleRoutes(raw: unknown): RoleRoutes {
  if (!raw || typeof raw !== 'object') return {};
  const src = raw as Record<string, unknown>;
  const out: RoleRoutes = {};
  for (const role of CONDUCTOR_ROLE_IDS) {
    const pick = src[role];
    if (!pick || typeof pick !== 'object') continue;
    const record = pick as { nodeId?: unknown; model?: unknown };
    const nodeId = typeof record.nodeId === 'string' ? record.nodeId.trim() : '';
    const model = typeof record.model === 'string' ? record.model.trim() : '';
    if (!nodeId || !model) continue;
    out[role] = { nodeId, model };
  }
  return out;
}

export function sameRoleRoutes(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalizeRoleRoutes(a)) === JSON.stringify(normalizeRoleRoutes(b));
}

/** A saved pick, or undefined when this role is Auto. */
export function explicitRolePick(
  routes: RoleRoutes | undefined,
  role: ConductorRoleId
): RoleRoutePick | undefined {
  return normalizeRoleRoutes(routes)[role];
}

/** Run-log value: `auto` or `Node name / model`. */
export function roleRouteLabel(
  routes: RoleRoutes | undefined,
  role: ConductorRoleId,
  nodes: Array<{ id: string; name?: string }>
): string {
  const pick = explicitRolePick(routes, role);
  if (!pick) return 'auto';
  const node = nodes.find(item => item.id === pick.nodeId);
  const name = (node?.name || pick.nodeId).trim() || pick.nodeId;
  return `${name} / ${pick.model}`;
}

function frontierHasCredential(node: EndpointNode): boolean {
  if (typeof node.apiKey === 'string' && node.apiKey.trim()) return true;
  // Web console snapshots strip the key and leave hasApiKey instead.
  return (node as { hasApiKey?: boolean }).hasApiKey === true;
}

/**
 * Auto (no saved pick) returns undefined.
 * A saved pick is usable only when the computer is online, a frontier computer
 * has an API key, and the model is enabled.
 */
export function explicitPickStatus(
  nodes: EndpointNode[],
  roleRoutes: RoleRoutes | undefined,
  role: ConductorRoleId
): { ok: true; node: EndpointNode; model: string } | { ok: false; reason: string } | undefined {
  const pick = explicitRolePick(roleRoutes, role);
  if (!pick) return undefined;
  const node = nodes.find(item => item.id === pick.nodeId);
  if (!node) return { ok: false, reason: 'Computer not found' };
  if (!node.online) return { ok: false, reason: 'Computer offline' };
  if ((node.type === 'openai' || isFrontierNode(node)) && !frontierHasCredential(node)) {
    return { ok: false, reason: 'no API key' };
  }
  if (!getEnabledModelsForNode(node).includes(pick.model)) {
    return { ok: false, reason: 'Model disabled or not installed' };
  }
  return { ok: true, node, model: pick.model };
}

/**
 * Explicit pick when that computer can run it.
 * Auto (no pick) returns undefined and does not call `auto`, so callers keep
 * their existing routing. A bad pick calls `auto` and returns source `auto`.
 * A frontier pick with an API key is user-chosen spend.
 */
export function resolveRoleRoute(
  nodes: EndpointNode[],
  roleRoutes: RoleRoutes | undefined,
  role: ConductorRoleId,
  auto: () => RoleRouteChoice | undefined
): ResolvedRoleRoute | undefined {
  const status = explicitPickStatus(nodes, roleRoutes, role);
  if (!status) return undefined;
  if (status.ok) return { node: status.node, model: status.model, source: 'pick' };
  const fallback = auto();
  if (!fallback?.node || !fallback.model) return undefined;
  return {
    node: fallback.node,
    model: fallback.model,
    source: 'auto',
    fallbackReason: status.reason
  };
}
