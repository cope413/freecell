// FreeCell rules engine. Pure functions, no DOM, so it runs in the page,
// in the solver worker, and in Node tests.

export const SUITS = ['C', 'D', 'H', 'S'];          // matches MS card numbering: c % 4
export const SUIT_GLYPH = { C: '♣', D: '♦', H: '♥', S: '♠' };
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const rankOf = (c) => c >> 2;      // 0 = Ace … 12 = King
export const suitOf = (c) => c & 3;       // 0 C, 1 D, 2 H, 3 S
export const isRed = (c) => (c & 3) === 1 || (c & 3) === 2;
export const cardName = (c) => RANKS[rankOf(c)] + SUITS[suitOf(c)];

export const MAX_SEED = 1000000;

/** Microsoft FreeCell deal for a given game number (1..1000000). */
export function dealMS(seed) {
  let state = seed >>> 0;
  const rand = () => {
    state = (Math.imul(state, 214013) + 2531011) >>> 0;
    return (state >>> 16) & 0x7fff;
  };
  const deck = Array.from({ length: 52 }, (_, i) => i);
  const cascades = Array.from({ length: 8 }, () => []);
  for (let i = 51; i >= 0; i--) {
    const j = rand() % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
    cascades[(51 - i) % 8].push(deck[i]);
  }
  return cascades;
}

export function newState(seed) {
  return {
    cascades: dealMS(seed),
    cells: [null, null, null, null],
    foundations: [0, 0, 0, 0], // cards placed per suit (0 = empty, 13 = complete)
  };
}

export function cloneState(s) {
  return {
    cascades: s.cascades.map((c) => c.slice()),
    cells: s.cells.slice(),
    foundations: s.foundations.slice(),
  };
}

export function isWon(s) {
  return s.foundations.every((f) => f === 13);
}

/** Can `upper` sit on `lower` in a cascade (alternating colour, one rank down)? */
export function stacks(upper, lower) {
  return rankOf(upper) === rankOf(lower) - 1 && isRed(upper) !== isRed(lower);
}

/** Length of the ordered run at the bottom of a cascade. */
export function runLength(cascade) {
  let n = cascade.length;
  if (n === 0) return 0;
  let len = 1;
  for (let i = n - 1; i > 0; i--) {
    if (stacks(cascade[i], cascade[i - 1])) len++;
    else break;
  }
  return len;
}

/** Max cards movable as a unit. */
export function maxMovable(s, targetIsEmptyCascade) {
  const freeCells = s.cells.filter((c) => c === null).length;
  let emptyCascades = s.cascades.filter((c) => c.length === 0).length;
  if (targetIsEmptyCascade) emptyCascades = Math.max(0, emptyCascades - 1);
  return (freeCells + 1) * Math.pow(2, emptyCascades);
}

function topCard(s, from) {
  if (from.type === 'cascade') {
    const c = s.cascades[from.index];
    return c.length ? c[c.length - 1] : null;
  }
  return s.cells[from.index];
}

/**
 * Validate a move. `count` is the number of cards moved (only >1 for
 * cascade→cascade). Returns true/false.
 */
export function canMove(s, move) {
  const { from, to, count = 1 } = move;
  if (from.type === to.type && from.index === to.index) return false;
  if (count < 1) return false;
  if (from.type !== 'cascade' && count !== 1) return false;
  if (to.type !== 'cascade' && count !== 1) return false;

  let card;
  if (from.type === 'cascade') {
    const src = s.cascades[from.index];
    if (src.length < count) return false;
    if (runLength(src) < count) return false;
    card = src[src.length - count];
  } else if (from.type === 'cell') {
    card = s.cells[from.index];
    if (card === null) return false;
  } else return false;

  if (to.type === 'cell') return s.cells[to.index] === null;

  if (to.type === 'foundation') {
    const suit = suitOf(card);
    if (to.index !== suit) return false;
    return s.foundations[suit] === rankOf(card);
  }

  if (to.type === 'cascade') {
    const dst = s.cascades[to.index];
    if (dst.length === 0) {
      return count <= maxMovable(s, true);
    }
    if (count > maxMovable(s, false)) return false;
    return stacks(card, dst[dst.length - 1]);
  }
  return false;
}

/** Apply a move (assumed legal) and return a new state. */
export function applyMove(s, move) {
  const n = cloneState(s);
  const { from, to, count = 1 } = move;
  let cards;
  if (from.type === 'cascade') {
    cards = n.cascades[from.index].splice(n.cascades[from.index].length - count, count);
  } else {
    cards = [n.cells[from.index]];
    n.cells[from.index] = null;
  }
  if (to.type === 'cascade') n.cascades[to.index].push(...cards);
  else if (to.type === 'cell') n.cells[to.index] = cards[0];
  else n.foundations[to.index]++;
  return n;
}

/**
 * Is it safe to auto-play `card` to its foundation? Safe when no card still
 * in play could ever need to sit on it: both opposite-colour foundations
 * already hold rank-1 (aces and twos are always safe).
 */
export function isSafeToFoundation(s, card) {
  const r = rankOf(card);
  const suit = suitOf(card);
  if (s.foundations[suit] !== r) return false;
  if (r <= 1) return true;
  const opp = isRed(card) ? [0, 3] : [1, 2];
  return s.foundations[opp[0]] >= r - 1 && s.foundations[opp[1]] >= r - 1;
}

/** One round of safe auto-moves (returns [] when nothing more to do). */
export function safeAutoMove(s) {
  for (let i = 0; i < 4; i++) {
    const c = s.cells[i];
    if (c !== null && isSafeToFoundation(s, c)) {
      return { from: { type: 'cell', index: i }, to: { type: 'foundation', index: suitOf(c) }, count: 1 };
    }
  }
  for (let i = 0; i < 8; i++) {
    const col = s.cascades[i];
    if (!col.length) continue;
    const c = col[col.length - 1];
    if (isSafeToFoundation(s, c)) {
      return { from: { type: 'cascade', index: i }, to: { type: 'foundation', index: suitOf(c) }, count: 1 };
    }
  }
  return null;
}

/**
 * All legal single-unit moves from state (for hints/solver). Cascade→cascade
 * moves include every legal run length; moves that shuffle between two
 * empty cascades or between free cells are skipped as pointless.
 */
export function legalMoves(s) {
  const moves = [];
  const emptyCell = s.cells.indexOf(null);
  const emptyCascade = s.cascades.findIndex((c) => c.length === 0);

  // From cells
  for (let i = 0; i < 4; i++) {
    const c = s.cells[i];
    if (c === null) continue;
    if (s.foundations[suitOf(c)] === rankOf(c)) {
      moves.push({ from: { type: 'cell', index: i }, to: { type: 'foundation', index: suitOf(c) }, count: 1 });
    }
    for (let j = 0; j < 8; j++) {
      const dst = s.cascades[j];
      if (dst.length === 0) {
        if (j === emptyCascade) moves.push({ from: { type: 'cell', index: i }, to: { type: 'cascade', index: j }, count: 1 });
      } else if (stacks(c, dst[dst.length - 1])) {
        moves.push({ from: { type: 'cell', index: i }, to: { type: 'cascade', index: j }, count: 1 });
      }
    }
  }

  // From cascades
  for (let i = 0; i < 8; i++) {
    const src = s.cascades[i];
    if (!src.length) continue;
    const top = src[src.length - 1];
    if (s.foundations[suitOf(top)] === rankOf(top)) {
      moves.push({ from: { type: 'cascade', index: i }, to: { type: 'foundation', index: suitOf(top) }, count: 1 });
    }
    const run = runLength(src);
    const maxNonEmpty = Math.min(run, maxMovable(s, false));
    const maxEmpty = Math.min(run, maxMovable(s, true));
    for (let j = 0; j < 8; j++) {
      if (i === j) continue;
      const dst = s.cascades[j];
      if (dst.length === 0) {
        if (j !== emptyCascade) continue;          // all empty cascades are equivalent
        if (run === src.length && maxEmpty >= run) continue; // moving a whole column to another empty column is pointless
        for (let n = 1; n <= maxEmpty; n++) {
          moves.push({ from: { type: 'cascade', index: i }, to: { type: 'cascade', index: j }, count: n });
        }
      } else {
        const bottom = dst[dst.length - 1];
        for (let n = 1; n <= maxNonEmpty; n++) {
          if (stacks(src[src.length - n], bottom)) {
            moves.push({ from: { type: 'cascade', index: i }, to: { type: 'cascade', index: j }, count: n });
            break; // only one n can match a given bottom card
          }
        }
      }
    }
    if (emptyCell >= 0) {
      moves.push({ from: { type: 'cascade', index: i }, to: { type: 'cell', index: emptyCell }, count: 1 });
    }
  }
  return moves;
}

/** Canonical key: cascades and cells are order-independent. */
export function stateKey(s) {
  const cols = s.cascades.map((c) => String.fromCharCode(...c.map((x) => x + 40))).sort();
  const cells = s.cells.filter((c) => c !== null).sort((a, b) => a - b);
  return cols.join('|') + '#' + String.fromCharCode(...cells.map((x) => x + 40)) + '#' + s.foundations.join(',');
}

export function sameLocation(a, b) {
  return a.type === b.type && a.index === b.index;
}
