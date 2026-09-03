// Game session: wraps the engine with move history (undo/redo) and
// safe auto-moves to the foundations.
import { newState, canMove, applyMove, safeAutoMove, isWon, cloneState, suitOf, rankOf } from './engine.js';

export class Game {
  constructor(seed, opts = {}) {
    this.seed = seed;
    this.autoMove = opts.autoMove !== false;
    this.state = newState(seed);
    this.history = [];   // [{ moves: [move...], before: state }]
    this.redoStack = [];
    this.moveCount = 0;  // user moves (auto-moves not counted)
    this.won = false;
  }

  /** Try a user move. Returns { ok, moves } where moves includes auto-moves. */
  move(move) {
    if (this.won) return { ok: false, moves: [] };
    if (!canMove(this.state, move)) return { ok: false, moves: [] };
    const before = cloneState(this.state);
    let s = applyMove(this.state, move);
    const moves = [move];
    if (this.autoMove) {
      let am;
      while ((am = safeAutoMove(s))) {
        s = applyMove(s, am);
        moves.push(am);
      }
    }
    this.state = s;
    this.history.push({ moves, before });
    this.redoStack = [];
    this.moveCount++;
    this.won = isWon(s);
    return { ok: true, moves };
  }

  /** Move every card that can legally go to a foundation right now (not just safe ones). */
  collectAll() {
    if (this.won) return { ok: false, moves: [] };
    const before = cloneState(this.state);
    let s = this.state;
    const moves = [];
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let i = 0; i < 4; i++) {
        const c = s.cells[i];
        if (c !== null && s.foundations[suitOf(c)] === rankOf(c)) {
          const m = { from: { type: 'cell', index: i }, to: { type: 'foundation', index: suitOf(c) }, count: 1 };
          s = applyMove(s, m); moves.push(m); progressed = true;
        }
      }
      for (let i = 0; i < 8; i++) {
        const col = s.cascades[i];
        if (!col.length) continue;
        const c = col[col.length - 1];
        if (s.foundations[suitOf(c)] === rankOf(c)) {
          const m = { from: { type: 'cascade', index: i }, to: { type: 'foundation', index: suitOf(c) }, count: 1 };
          s = applyMove(s, m); moves.push(m); progressed = true;
        }
      }
    }
    if (!moves.length) return { ok: false, moves: [] };
    this.state = s;
    this.history.push({ moves, before });
    this.redoStack = [];
    this.moveCount++;
    this.won = isWon(s);
    return { ok: true, moves };
  }

  canUndo() { return this.history.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() {
    const entry = this.history.pop();
    if (!entry) return null;
    this.redoStack.push({ moves: entry.moves, after: this.state });
    this.state = entry.before;
    this.moveCount++; // undo counts as a move, like the classic game
    this.won = false;
    return entry.moves;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.history.push({ moves: entry.moves, before: this.state });
    this.state = entry.after;
    this.moveCount++;
    this.won = isWon(this.state);
    return entry.moves;
  }

  /** Every card is in an ordered run or foundation — the game is effectively over. */
  isTriviallyWon() {
    if (this.won) return true;
    const s = this.state;
    return s.cascades.every((col) => {
      for (let i = 1; i < col.length; i++) {
        if (rankOf(col[i]) !== rankOf(col[i - 1]) - 1) return false;
      }
      return true;
    });
  }

  toJSON() {
    return {
      seed: this.seed,
      autoMove: this.autoMove,
      state: this.state,
      history: this.history,
      redoStack: this.redoStack,
      moveCount: this.moveCount,
      won: this.won,
    };
  }

  static fromJSON(j) {
    const g = new Game(j.seed, { autoMove: j.autoMove });
    g.state = j.state;
    g.history = j.history || [];
    g.redoStack = j.redoStack || [];
    g.moveCount = j.moveCount || 0;
    g.won = !!j.won;
    return g;
  }
}
