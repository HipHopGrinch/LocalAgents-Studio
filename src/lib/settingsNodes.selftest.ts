/**
 * Run: npx --yes tsx src/lib/settingsNodes.selftest.ts
 */
import assert from 'node:assert/strict';
import { settingsNodesFromLiveSnapshot } from './settingsNodes';

const saved = [
  { id: 'cloud', name: 'Gemini', url: 'https://example.test', apiKey: 'secret-key' },
  { id: 'local', name: 'Ollama', url: 'http://127.0.0.1:11434' }
];
const live = [
  {
    id: 'cloud',
    name: 'Gemini',
    url: 'https://example.test',
    hasApiKey: true,
    online: true,
    latency: 12,
    models: [{ name: 'gemini' }],
    loaded: [],
    error: ''
  },
  { id: 'local', name: 'Ollama', url: 'http://127.0.0.1:11434', online: false }
];

const merged = settingsNodesFromLiveSnapshot(saved, live as typeof saved);
assert.equal(merged[0]?.apiKey, 'secret-key');
assert.equal('online' in merged[0], false);
assert.equal('hasApiKey' in merged[0], false);
assert.equal('models' in merged[0], false);
assert.equal(merged[1]?.apiKey, undefined);
assert.equal(merged[1]?.name, 'Ollama');

const kept = settingsNodesFromLiveSnapshot(saved, [
  { id: 'cloud', name: 'Gemini', url: 'https://example.test', apiKey: 'rotated' }
]);
assert.equal(kept[0]?.apiKey, 'rotated');

console.log('settingsNodes.selftest ok');
