/**
 * Run: node node_modules/tsx/dist/cli.mjs src/lib/projectBrain.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  brainIsStaleForFolder,
  brainWorkspaceKey,
  brainWriteDecision,
  emptyProjectBrain,
  isBlankProjectBrain,
  preferredExistingPath,
  rememberOwnedFile,
  shadowOwnedPath
} from './projectBrain';

// B-91: a prefix is only stripped at a word boundary
assert.equal(preferredExistingPath(['src/roach.ts'], 'src/approach.ts'), null);
assert.equal(preferredExistingPath(['src/ointment.ts'], 'src/appointment.ts'), null);
assert.equal(preferredExistingPath(['src/overlay.ts'], 'src/gameoverlay.ts'), null);
assert.equal(preferredExistingPath(['src/CheckersBoard.tsx'], 'src/Board.tsx'), 'src/CheckersBoard.tsx');
assert.equal(preferredExistingPath(['src/Board.tsx'], 'src/CheckersBoard.tsx'), 'src/Board.tsx');
assert.equal(preferredExistingPath(['src/game-board.ts'], 'src/board.ts'), 'src/game-board.ts');

// A shortened path of an owned file is a shadow, even for generic or short stems
const ownedGame = ['src/game/types.ts', 'src/components/HUD.tsx', 'src/App.tsx'];
assert.equal(shadowOwnedPath(ownedGame, 'game/types.ts'), 'src/game/types.ts');
assert.equal(shadowOwnedPath(ownedGame, './components/hud.tsx'), 'src/components/HUD.tsx');
assert.equal(shadowOwnedPath(ownedGame, 'components\\HUD.tsx'), 'src/components/HUD.tsx');
assert.equal(shadowOwnedPath(ownedGame, 'types.ts'), 'src/game/types.ts');
assert.equal(shadowOwnedPath(['a/b/types.ts', 'x/types.ts'], 'types.ts'), 'x/types.ts');
assert.equal(shadowOwnedPath(ownedGame, 'src/game/types.ts'), null);
assert.equal(shadowOwnedPath(ownedGame, 'src/components/HUD.tsx'), null);
assert.equal(shadowOwnedPath(ownedGame, 'src/ui/HUD.tsx'), null);
assert.equal(shadowOwnedPath(['index.html', 'public/index.html'], 'index.html'), null);
assert.equal(shadowOwnedPath(['src/index.html'], 'index.html'), null);
assert.equal(shadowOwnedPath(['config/.gitignore'], '.gitignore'), null);
assert.equal(shadowOwnedPath(['src/index.css'], 'index.css'), 'src/index.css');

// Stale project state must not leak into a deleted-and-recreated folder.
const freshBrain = emptyProjectBrain();
assert.equal(isBlankProjectBrain(freshBrain), true);
const usedBrain = rememberOwnedFile({ ...freshBrain, brief: 'old game' }, 'src/App.tsx');
assert.equal(isBlankProjectBrain(usedBrain), false);
assert.equal(isBlankProjectBrain({ ...freshBrain, lastVerifyNote: 'tsc failed' }), false);
assert.equal(isBlankProjectBrain({ ...freshBrain, todo: [{ id: '1', title: 'x', status: 'pending' }] }), false);
// Brain file gone from disk while memory still holds one: reset it.
assert.equal(brainIsStaleForFolder(false, usedBrain), true);
// Brain file present, or nothing worth resetting: keep.
assert.equal(brainIsStaleForFolder(true, usedBrain), false);
assert.equal(brainIsStaleForFolder(false, freshBrain), false);

// The same path opened again is a new folder key.
assert.notEqual(brainWorkspaceKey('D:\\proj\\connect4', 1), brainWorkspaceKey('D:\\proj\\connect4', 2));
assert.equal(brainWorkspaceKey('D:\\proj\\connect4\\', 1), brainWorkspaceKey('d:\\proj\\Connect4', 1));
assert.notEqual(brainWorkspaceKey('D:\\proj\\a', 1), brainWorkspaceKey('D:\\proj\\b', 1));

// Where a brain commit may go.
const openKey = brainWorkspaceKey('D:\\proj\\connect4', 2);
const oldKey = brainWorkspaceKey('D:\\proj\\connect4', 1);
assert.equal(brainWriteDecision(openKey, openKey, openKey), 'write');
assert.equal(brainWriteDecision(openKey, openKey, oldKey), 'memory-only');
assert.equal(brainWriteDecision(openKey, openKey, ''), 'memory-only');
assert.equal(brainWriteDecision(oldKey, openKey, openKey), 'drop');
console.log('projectBrain.selftest ok');
