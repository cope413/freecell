import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealMS, cardName, newState, legalMoves, canMove, applyMove, isSafeToFoundation, maxMovable } from '../src/engine.js';
import { solve } from '../src/solver.js';
import { Game } from '../src/game.js';

// Microsoft FreeCell game #1, as dealt (rows left→right, top→bottom).
const GAME_1 = `
JD 2D 9H JC 5D 7H 7C 5H
KD KC 9S 5S AD QC KH 3H
2S KS 9D QD JS AS AH 3C
4C 5C 10S QH 4H AC 4D 7S
3S 10D 4S 10H 8H 2C JH 7D
6D 8S 8D QS 6C 3D 8C 10C
6S 9C 2H 6H`.trim().split('\n').map((r) => r.split(' '));

test('deal #1 matches Microsoft FreeCell', () => {
  const cascades = dealMS(1);
  for (let row = 0; row < GAME_1.length; row++) {
    for (let col = 0; col < GAME_1[row].length; col++) {
      assert.equal(cardName(cascades[col][row]), GAME_1[row][col], `row ${row} col ${col}`);
    }
  }
  assert.deepEqual(cascades.map((c) => c.length), [7, 7, 7, 7, 6, 6, 6, 6]);
});

test('deal #617 first column starts with 7D', () => {
  // Widely published: game 617 top row is 7D AD 5C 3S 5S 8C 2D AH
  const cascades = dealMS(617);
  assert.deepEqual(cascades.map((c) => cardName(c[0])), ['7D', 'AD', '5C', '3S', '5S', '8C', '2D', 'AH']);
});

test('every deal uses all 52 cards once', () => {
  for (const seed of [1, 2, 11982, 32000, 999999]) {
    const all = dealMS(seed).flat().sort((a, b) => a - b);
    assert.deepEqual(all, Array.from({ length: 52 }, (_, i) => i));
  }
});

test('legal moves are all accepted by canMove and change state', () => {
  const s = newState(1);
  const moves = legalMoves(s);
  assert.ok(moves.length > 0);
  for (const m of moves) {
    assert.ok(canMove(s, m), JSON.stringify(m));
    const n = applyMove(s, m);
    assert.notDeepEqual(n, s);
  }
});

test('supermove limit', () => {
  const s = newState(1);
  assert.equal(maxMovable(s, false), 5);
  s.cells[0] = 0;
  assert.equal(maxMovable(s, false), 4);
  s.cascades[7] = [];
  assert.equal(maxMovable(s, false), 8);
  assert.equal(maxMovable(s, true), 4);
});

test('safe auto-move rule', () => {
  const s = newState(1);
  s.foundations = [1, 1, 1, 1];
  // 2 of anything is always safe
  assert.ok(isSafeToFoundation(s, 1 << 2 | 0)); // 2C
  s.foundations = [2, 2, 2, 2];
  // 3C safe only if both red foundations hold at least a 2 → they hold 2 → safe
  assert.ok(isSafeToFoundation(s, 2 << 2 | 0));
  // 3C needs both red 2s already up: with diamonds still empty it is not safe
  s.foundations = [2, 0, 2, 2];
  assert.ok(!isSafeToFoundation(s, 2 << 2 | 0));
});

test('solver solves several known-solvable deals', () => {
  for (const seed of [1, 2, 3, 617, 1941, 10913]) {
    const r = solve(newState(seed), { maxNodes: 150000 });
    assert.ok(r.solved, `seed ${seed} unsolved after ${r.nodes} nodes`);
    // Replay the solution through the engine to prove every move is legal.
    let s = newState(seed);
    for (const m of r.moves) {
      assert.ok(canMove(s, m), `illegal move in solution for ${seed}: ${JSON.stringify(m)}`);
      s = applyMove(s, m);
    }
    assert.deepEqual(s.foundations, [13, 13, 13, 13]);
  }
});

test('solver reports #11982 (the famous unsolvable deal) as not solved', () => {
  const r = solve(newState(11982), { maxNodes: 200000 });
  assert.equal(r.solved, false);
});

test('Game undo/redo restores state', () => {
  const g = new Game(1);
  const before = JSON.stringify(g.state);
  const m = legalMoves(g.state)[0];
  assert.ok(g.move(m).ok);
  const after = JSON.stringify(g.state);
  assert.notEqual(before, after);
  g.undo();
  assert.equal(JSON.stringify(g.state), before);
  g.redo();
  assert.equal(JSON.stringify(g.state), after);
});

test('Game can be played to a win from solver output', () => {
  const g = new Game(1);
  const r = solve(newState(1), { maxNodes: 150000 });
  for (const m of r.moves) {
    if (m.auto) continue; // Game applies auto-moves itself
    if (g.won) break;
    const res = g.move(m);
    if (!res.ok) {
      // Auto-move may have already taken this card; that's fine when it went to the foundation.
      assert.equal(m.to.type, 'foundation', 'unexpected rejected move ' + JSON.stringify(m));
    }
  }
  assert.ok(g.won);
});
