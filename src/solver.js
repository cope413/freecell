// Best-first search solver used for hints and "is this position dead?" checks.
// Pure JS; runs inside a Web Worker (see solver-worker.js) or Node tests.
import { legalMoves, applyMove, safeAutoMove, isWon, stateKey, rankOf } from './engine.js';

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a; a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

/** Lower is better. 0 only for a won game. */
export function heuristic(s) {
  let h = 0;
  const onFoundation = s.foundations[0] + s.foundations[1] + s.foundations[2] + s.foundations[3];
  h += (52 - onFoundation) * 2;
  for (const col of s.cascades) {
    let minBelow = 99;
    for (let i = 0; i < col.length; i++) {
      const r = rankOf(col[i]);
      if (r > minBelow) h += 3;            // this card buries a lower card
      if (r < minBelow) minBelow = r;
    }
  }
  const usedCells = s.cells.filter((c) => c !== null).length;
  h += usedCells * 1.5;
  const emptyCols = s.cascades.filter((c) => !c.length).length;
  h -= emptyCols * 2;
  // Lowest card not yet on a foundation: deeper burial hurts.
  const minF = Math.min(...s.foundations);
  for (const col of s.cascades) {
    for (let i = 0; i < col.length; i++) {
      if (rankOf(col[i]) === minF) h += (col.length - 1 - i) * 1.0;
    }
  }
  return h;
}

function applyWithAuto(s, move) {
  let n = applyMove(s, move);
  const autos = [];
  let am;
  while ((am = safeAutoMove(n))) { n = applyMove(n, am); autos.push({ ...am, auto: true }); }
  return { state: n, autos };
}

/**
 * Solve from `start`. Returns
 *   { solved: true, moves: [...], nodes }
 *   { solved: false, exhausted: bool, nodes }   (exhausted = provably no solution)
 */
export function solve(start, { maxNodes = 200000, weight = 0.15 } = {}) {
  if (isWon(start)) return { solved: true, moves: [], nodes: 0 };
  const startKey = stateKey(start);
  const seen = new Map(); // key -> { parentKey, move, autos }
  seen.set(startKey, null);
  const heap = new MinHeap();
  heap.push({ f: heuristic(start), g: 0, state: start, key: startKey });
  let nodes = 0;

  while (heap.size) {
    const node = heap.pop();
    nodes++;
    if (nodes > maxNodes) return { solved: false, exhausted: false, nodes };
    const moves = legalMoves(node.state);
    for (const m of moves) {
      const { state: ns, autos } = applyWithAuto(node.state, m);
      const k = stateKey(ns);
      if (seen.has(k)) continue;
      seen.set(k, { parentKey: node.key, move: m, autos });
      if (isWon(ns)) return { solved: true, moves: reconstruct(seen, k), nodes };
      heap.push({ f: heuristic(ns) + weight * (node.g + 1), g: node.g + 1, state: ns, key: k });
    }
  }
  return { solved: false, exhausted: true, nodes };
}

function reconstruct(seen, key) {
  const out = [];
  let k = key;
  while (seen.get(k)) {
    const e = seen.get(k);
    out.unshift(e.move, ...e.autos);
    k = e.parentKey;
  }
  return out;
}
