/**
 * Run: npx --yes tsx src/lib/roleRoutes.selftest.ts
 */
import assert from 'node:assert/strict';
import { mergeSettings } from '../config/defaults';
import type { EndpointNode } from '../types';
import {
  conductorRoleForPersona,
  explicitRolePick,
  normalizeRoleRoutes,
  resolveRoleRoute,
  roleRouteLabel
} from './roleRoutes';

function fakeNode(over: Partial<EndpointNode> & Pick<EndpointNode, 'id' | 'name'>): EndpointNode {
  return {
    url: 'http://127.0.0.1:11434',
    type: 'ollama',
    online: true,
    latency: 5,
    models: [{ name: 'qwen2.5-coder:32b', size: 1 }],
    loaded: [],
    hardware: {
      cpu: 'cpu',
      gpu: 'gpu',
      vramGB: 16,
      gpuBandwidthGBs: 800,
      ramGB: 32,
      ramBandwidthGBs: 80,
      reserveVramGB: 1,
      kvCacheType: 'f16'
    },
    ...over
  } as EndpointNode;
}

const local = fakeNode({ id: 'local', name: 'Main Rig' });
const backup = fakeNode({
  id: 'backup',
  name: 'Laptop',
  models: [{ name: 'qwen2.5-coder:7b', size: 1 }]
});
const frontier = fakeNode({
  id: 'gemini',
  name: 'Google Gemini',
  type: 'openai',
  apiKey: 'stored-not-logged',
  models: [{ name: 'gemini-2.5-flash', size: 1 }]
});

const autoChoice = { node: backup, model: 'qwen2.5-coder:7b' };

assert.equal(mergeSettings(null).roleRoutes && Object.keys(mergeSettings(null).roleRoutes || {}).length, 0);
assert.deepEqual(mergeSettings({}).roleRoutes, {});
assert.deepEqual(
  mergeSettings({
    roleRoutes: {
      planner: { nodeId: 'gemini', model: 'gemini-2.5-flash' },
      coder: { nodeId: '  ', model: 'qwen2.5-coder:32b' }
    }
  }).roleRoutes,
  { planner: { nodeId: 'gemini', model: 'gemini-2.5-flash' } }
);
assert.equal(mergeSettings(null).agents.find(agent => agent.id === 'planner')?.endpointId, '');
assert.deepEqual(normalizeRoleRoutes({ reviewer: { nodeId: 'local', model: '' } }), {});

assert.equal(conductorRoleForPersona({ handle: 'docs' }), 'coder');
assert.equal(conductorRoleForPersona({ handle: 'planner' }), 'planner');
assert.equal(conductorRoleForPersona({ id: 'reviewer' }), 'reviewer');
assert.equal(conductorRoleForPersona({ handle: 'custom' }), 'coder');

{
  let calls = 0;
  const picked = resolveRoleRoute(
    [local, frontier],
    { coder: { nodeId: 'local', model: 'qwen2.5-coder:32b' } },
    'coder',
    () => {
      calls += 1;
      return autoChoice;
    }
  );
  assert.equal(calls, 0);
  assert.equal(picked?.source, 'pick');
  assert.equal(picked?.node.id, 'local');
  assert.equal(picked?.model, 'qwen2.5-coder:32b');
  assert.equal(picked?.fallbackReason, undefined);
}

{
  let calls = 0;
  const picked = resolveRoleRoute([frontier], { planner: { nodeId: 'gemini', model: 'gemini-2.5-flash' } }, 'planner', () => {
    calls += 1;
    return autoChoice;
  });
  assert.equal(calls, 0);
  assert.equal(picked?.source, 'pick');
  assert.equal(picked?.node.id, 'gemini');
  assert.equal(isFrontier(picked?.node), true);
}

{
  let calls = 0;
  const offline = fakeNode({ id: 'local', name: 'Main Rig', online: false });
  const picked = resolveRoleRoute(
    [offline, backup],
    { reviewer: { nodeId: 'local', model: 'qwen2.5-coder:32b' } },
    'reviewer',
    () => {
      calls += 1;
      return autoChoice;
    }
  );
  assert.equal(calls, 1);
  assert.equal(picked?.source, 'auto');
  assert.equal(picked?.fallbackReason, 'Computer offline');
  assert.equal(picked?.node.id, 'backup');
  assert.equal(picked?.model, 'qwen2.5-coder:7b');
}

{
  const disabled = fakeNode({
    id: 'local',
    name: 'Main Rig',
    disabledModels: ['qwen2.5-coder:32b'],
    models: [
      { name: 'qwen2.5-coder:32b', size: 1 },
      { name: 'qwen2.5-coder:7b', size: 1 }
    ]
  });
  const picked = resolveRoleRoute(
    [disabled, backup],
    { coder: { nodeId: 'local', model: 'qwen2.5-coder:32b' } },
    'coder',
    () => autoChoice
  );
  assert.equal(picked?.source, 'auto');
  assert.equal(picked?.fallbackReason, 'Model disabled or not installed');
}

{
  const removed = fakeNode({
    id: 'local',
    name: 'Main Rig',
    models: [{ name: 'qwen2.5-coder:7b', size: 1 }]
  });
  const picked = resolveRoleRoute(
    [removed, backup],
    { coder: { nodeId: 'local', model: 'qwen2.5-coder:32b' } },
    'coder',
    () => autoChoice
  );
  assert.equal(picked?.source, 'auto');
  assert.equal(picked?.fallbackReason, 'Model disabled or not installed');
}

{
  let calls = 0;
  const noKey = fakeNode({
    id: 'gemini',
    name: 'Google Gemini',
    type: 'openai',
    apiKey: '',
    models: [{ name: 'gemini-2.5-flash', size: 1 }]
  });
  const picked = resolveRoleRoute([noKey, backup], { planner: { nodeId: 'gemini', model: 'gemini-2.5-flash' } }, 'planner', () => {
    calls += 1;
    return autoChoice;
  });
  assert.equal(calls, 1);
  assert.equal(picked?.source, 'auto');
  assert.equal(picked?.fallbackReason, 'no API key');
  assert.equal(picked?.node.id, 'backup');
}

{
  let calls = 0;
  const missing = resolveRoleRoute([local], undefined, 'coder', () => {
    calls += 1;
    return autoChoice;
  });
  assert.equal(missing, undefined);
  assert.equal(calls, 0);
  assert.equal(
    resolveRoleRoute([local], { planner: { nodeId: '', model: 'gemini-2.5-flash' } }, 'planner', () => {
      calls += 1;
      return autoChoice;
    }),
    undefined
  );
  assert.equal(calls, 0);
  assert.equal(explicitRolePick({}, 'coder'), undefined);
}

{
  const none = resolveRoleRoute(
    [fakeNode({ id: 'local', name: 'Main Rig', online: false })],
    { coder: { nodeId: 'local', model: 'qwen2.5-coder:32b' } },
    'coder',
    () => undefined
  );
  assert.equal(none, undefined);
}

assert.equal(roleRouteLabel(undefined, 'planner', [local]), 'auto');
assert.equal(
  roleRouteLabel({ coder: { nodeId: 'local', model: 'qwen2.5-coder:32b' } }, 'coder', [local]),
  'Main Rig / qwen2.5-coder:32b'
);

function isFrontier(node: EndpointNode | undefined): boolean {
  return node?.type === 'openai' || !!node?.apiKey;
}

console.log('roleRoutes.selftest ok');
