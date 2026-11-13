/**
 * Run: npx --yes tsx src/lib/stuckEscalation.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  escalationMatchesRoute,
  latestCoderRoute,
  latestStepWritePaths,
  priorStepWritePaths,
  shouldEscalateStuck,
  tasksAreDifferentWork
} from './stuckEscalation';

assert.equal(
  tasksAreDifferentWork('Create tsconfig.json for the Vite app', 'Create vite.config.ts for the Vite app'),
  true
);
assert.equal(
  tasksAreDifferentWork('Fix src/App.tsx types', 'Fix src/App.tsx types again'),
  false
);
assert.equal(shouldEscalateStuck({ previousTask: 'Create tsconfig.json', nextTask: 'Create tsconfig.json' }), true);
assert.equal(
  shouldEscalateStuck({
    previousTask: 'Create tsconfig.json',
    nextTask: 'Create tsconfig.json',
    recentWritePaths: ['tsconfig.json']
  }),
  true
);
assert.equal(
  shouldEscalateStuck({
    previousTask: 'Create tsconfig.json',
    nextTask: 'Create vite.config.ts',
    recentWritePaths: ['tsconfig.json']
  }),
  false
);
assert.equal(
  shouldEscalateStuck({
    previousTask: 'Add the missing Vite config files',
    nextTask: 'Add the missing Vite config files',
    recentWritePaths: ['tsconfig.json']
  }),
  false
);
assert.equal(
  shouldEscalateStuck({
    previousTask: 'Add the missing Vite config files',
    nextTask: 'Add the missing Vite config files',
    recentWritePaths: ['tsconfig.json'],
    priorWritePaths: ['tsconfig.json']
  }),
  true
);
assert.equal(
  shouldEscalateStuck({
    previousTask: 'Add the missing Vite config files',
    nextTask: 'Add the missing Vite config files',
    recentWritePaths: ['vite.config.ts'],
    priorWritePaths: ['tsconfig.json']
  }),
  false
);
assert.equal(
  shouldEscalateStuck({
    previousTask: 'Fix src/App.tsx',
    nextTask: 'Fix src/App.tsx',
    recentWritePaths: ['src/App.tsx']
  }),
  true
);

assert.equal(
  escalationMatchesRoute({ nodeId: 'local', model: 'qwen2.5-coder:14b' }, { nodeId: 'local', model: 'qwen2.5-coder:14b' }),
  true
);
assert.equal(
  escalationMatchesRoute({ nodeId: 'local', model: 'qwen2.5-coder:14b' }, { nodeId: 'local', model: 'qwen2.5:32b' }),
  false
);
assert.equal(escalationMatchesRoute({ nodeId: 'local', model: '' }, { nodeId: 'local', model: 'qwen' }), false);
assert.equal(
  escalationMatchesRoute({ nodeId: 'local', model: 'foo' }, { nodeId: 'local', model: 'foo:latest' }),
  true
);
assert.equal(
  escalationMatchesRoute({ nodeId: 'local', model: 'qwen:14b' }, { nodeId: 'local', model: 'qwen:32b' }),
  false
);

const messages = [
  {
    id: 'plan',
    role: 'assistant',
    personaHandle: 'coder',
    endpointId: 'gpu-a',
    model: 'small',
    toolCalls: []
  },
  {
    id: 'coder',
    role: 'assistant',
    personaHandle: 'coder',
    endpointId: 'gpu-a',
    model: 'small',
    toolCalls: [{ name: 'write_file', status: 'done', args: { path: 'vite.config.ts' } }]
  },
  {
    id: 'review',
    role: 'assistant',
    personaHandle: 'reviewer',
    endpointId: 'gpu-b',
    model: 'big',
    toolCalls: [{ name: 'read_file', status: 'done', args: { path: 'vite.config.ts' } }]
  },
  {
    id: 'reread',
    role: 'assistant',
    personaHandle: 'coder',
    endpointId: 'gpu-b',
    model: 'big',
    toolCalls: [{ name: 'read_file', status: 'done', args: { path: 'vite.config.ts' } }]
  },
  { id: 'next', role: 'assistant', personaHandle: 'coder', toolCalls: [] }
];
assert.deepEqual(latestStepWritePaths(messages, ['next']), ['vite.config.ts']);
assert.deepEqual(priorStepWritePaths(messages, ['next']), []);
assert.deepEqual(latestCoderRoute(messages, ['next']), { nodeId: 'gpu-a', model: 'small' });
