/**
 * Run: node node_modules/tsx/dist/cli.mjs src/lib/modelRequest.selftest.ts
 */
import assert from 'node:assert/strict';
import { prependVolatileContext } from '../components/agent/modelRequest';
import { emptyWorkLog, renderWorkLog } from './workLog';

const log = { ...emptyWorkLog(), request: 'Build a checkers game', next: 'wire the board' };
const progressLog = renderWorkLog(log);

// B-96: the words "work log" in a user message don't drop the log
const mentioned = prependVolatileContext('Please update the work log format', { progressLog });
assert.ok(mentioned.includes('wire the board'), 'progress log kept');
assert.ok(mentioned.endsWith('Please update the work log format'));

// A packet that already carries the rendered log doesn't get a second copy
const already = prependVolatileContext(`Task\n\n${progressLog}`, { progressLog });
assert.equal(already.split('wire the board').length - 1, 1);

console.log('modelRequest.selftest ok');
