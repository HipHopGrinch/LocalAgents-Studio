/**
 * Run: node node_modules/tsx/dist/cli.mjs src/lib/projectBrain.selftest.ts
 */
import assert from 'node:assert/strict';
import { preferredExistingPath } from './projectBrain';

// B-91: a prefix is only stripped at a word boundary
assert.equal(preferredExistingPath(['src/roach.ts'], 'src/approach.ts'), null);
assert.equal(preferredExistingPath(['src/ointment.ts'], 'src/appointment.ts'), null);
assert.equal(preferredExistingPath(['src/overlay.ts'], 'src/gameoverlay.ts'), null);
assert.equal(preferredExistingPath(['src/CheckersBoard.tsx'], 'src/Board.tsx'), 'src/CheckersBoard.tsx');
assert.equal(preferredExistingPath(['src/Board.tsx'], 'src/CheckersBoard.tsx'), 'src/Board.tsx');
assert.equal(preferredExistingPath(['src/game-board.ts'], 'src/board.ts'), 'src/game-board.ts');

console.log('projectBrain.selftest ok');
