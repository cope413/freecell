// localStorage persistence: current game, stats, settings. Everything is
// wrapped in try/catch because storage can be unavailable (private mode).
const KEY_GAME = 'freecell.game.v1';
const KEY_STATS = 'freecell.stats.v1';
const KEY_SETTINGS = 'freecell.settings.v1';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

export const DEFAULT_SETTINGS = {
  autoMove: true,
  showSolvable: true,
  haptics: true,
  theme: 'felt',       // felt | night | ocean
  bigCards: false,
};

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEY_SETTINGS, {}) };
}
export function saveSettings(s) { write(KEY_SETTINGS, s); }

export function loadGame() { return read(KEY_GAME, null); }
export function saveGame(g) { write(KEY_GAME, g); }
export function clearGame() { try { localStorage.removeItem(KEY_GAME); } catch { /* ignore */ } }

export const EMPTY_STATS = {
  played: 0,
  won: 0,
  streak: 0,        // current streak (positive = wins, negative = losses)
  bestStreak: 0,
  bestTimeMs: null,
  fewestMoves: null,
  totalTimeMs: 0,
  recent: [],       // last 50 games: { seed, won, ms, moves, at }
};

export function loadStats() { return { ...EMPTY_STATS, ...read(KEY_STATS, {}) }; }
export function saveStats(s) { write(KEY_STATS, s); }
export function resetStats() { write(KEY_STATS, EMPTY_STATS); }

/** Record a finished (won or abandoned) game. */
export function recordGame({ seed, won, ms, moves }) {
  const s = loadStats();
  s.played++;
  if (won) {
    s.won++;
    s.streak = s.streak > 0 ? s.streak + 1 : 1;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    if (s.bestTimeMs === null || ms < s.bestTimeMs) s.bestTimeMs = ms;
    if (s.fewestMoves === null || moves < s.fewestMoves) s.fewestMoves = moves;
    s.totalTimeMs += ms;
  } else {
    s.streak = s.streak < 0 ? s.streak - 1 : -1;
  }
  s.recent.unshift({ seed, won, ms, moves, at: Date.now() });
  s.recent = s.recent.slice(0, 50);
  saveStats(s);
  return s;
}
