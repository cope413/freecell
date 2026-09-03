import { Game } from './game.js';
import {
  rankOf, suitOf, isRed, RANKS, SUIT_GLYPH, SUITS, runLength, canMove, legalMoves, MAX_SEED, sameLocation,
} from './engine.js';
import {
  loadSettings, saveSettings, loadGame, saveGame, clearGame, loadStats, resetStats, recordGame,
} from './storage.js';

const APP_VERSION = '1.0.1';

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);
const board = $('#board');
const cardsLayer = $('#cards');
const slots = {
  cell: [...document.querySelectorAll('.slot.cell')],
  foundation: [...document.querySelectorAll('.slot.foundation')],
  cascade: [...document.querySelectorAll('.slot.cascade')],
};
const statusSeed = $('#status-seed');
const statusMoves = $('#status-moves');
const statusTime = $('#status-time');
const solvableDot = $('#solvable-dot');
const toastEl = $('#toast');
const btnUndo = $('#btn-undo');
const btnRedo = $('#btn-redo');
const btnHint = $('#btn-hint');
const btnCollect = $('#btn-collect');

// ---------- State ----------
let settings = loadSettings();
let game = null;
let cardEls = [];            // 52 card elements, indexed by card id
let selection = null;        // { from: {type,index}, count, cards: [ids] }
let elapsedMs = 0;           // accumulated time
let runningSince = null;     // timestamp when timer started running
let counted = false;         // has this game been counted in stats (as started)?
let metrics = null;          // layout metrics
let timerHandle = null;
let hintTimer = null;

// ---------- Solver worker ----------
let worker = null;
let workerReqId = 0;
const pending = new Map();
function getWorker() {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./solver-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const cb = pending.get(e.data.id);
      if (cb) { pending.delete(e.data.id); cb(e.data); }
    };
    worker.onerror = () => { worker = null; };
  } catch { worker = null; }
  return worker;
}
function solveAsync(state, maxNodes) {
  return new Promise((resolve) => {
    const w = getWorker();
    if (!w) return resolve({ solved: false, exhausted: false, nodes: 0, unavailable: true });
    const id = ++workerReqId;
    pending.set(id, resolve);
    w.postMessage({ id, state, maxNodes });
  });
}

// ---------- Cards ----------
function buildCards() {
  cardsLayer.innerHTML = '';
  cardEls = [];
  for (let c = 0; c < 52; c++) {
    const el = document.createElement('div');
    const r = rankOf(c), s = suitOf(c);
    const face = r >= 10;
    el.className = 'card' + (isRed(c) ? ' red' : '') + (face ? ' face' : '');
    el.dataset.card = c;
    const glyph = SUIT_GLYPH[SUITS[s]];
    const rank = RANKS[r];
    el.innerHTML = `
      <div class="corner"><span>${rank}</span><span class="suit">${glyph}</span></div>
      <div class="pip">${face ? `${rank}<small>${glyph}</small>` : glyph}</div>
      <div class="corner br"><span>${rank}</span><span class="suit">${glyph}</span></div>`;
    cardsLayer.appendChild(el);
    cardEls.push(el);
  }
}

// ---------- Layout ----------
function computeLayout() {
  const bw = board.clientWidth;
  const bh = board.clientHeight;
  let gap = Math.max(4, bw * 0.02);
  let cw = (bw - 9 * gap) / 8;
  let ch = cw * 1.4;
  // Make sure a tall-ish column (card + 12 fanned cards) fits the height.
  const need = () => gap * 0.5 + ch + gap * 1.5 + ch + 12 * ch * 0.27 + gap;
  while (need() > bh && cw > 30) { cw -= 1; ch = cw * 1.4; gap = Math.max(4, Math.min(gap, cw * 0.2)); }
  board.style.setProperty('--card-w', cw + 'px');
  board.style.setProperty('--gap', gap + 'px');
  const boardRect = board.getBoundingClientRect();
  const pos = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - boardRect.left, y: r.top - boardRect.top };
  };
  metrics = {
    cw, ch, gap, bh,
    cells: slots.cell.map(pos),
    foundations: slots.foundation.map(pos),
    cascades: slots.cascade.map(pos),
    boardRect,
  };
}

function cascadeOffsets(colLen) {
  // Vertical fan offset per card so the column fits on screen.
  const { ch, bh, cascades, gap } = metrics;
  const def = ch * 0.27;
  if (colLen <= 1) return def;
  const avail = bh - cascades[0].y - ch - gap;
  // Floor of 0.15ch keeps the rank+suit corner readable even in long columns.
  return Math.max(ch * 0.15, Math.min(def, avail / (colLen - 1)));
}

function cardPosition(loc, depth, colLen) {
  if (loc.type === 'cell') return metrics.cells[loc.index];
  if (loc.type === 'foundation') return metrics.foundations[loc.index];
  const base = metrics.cascades[loc.index];
  return { x: base.x, y: base.y + depth * cascadeOffsets(colLen) };
}

function render(animate = true) {
  if (!metrics) computeLayout();
  const s = game.state;
  const placed = new Set();
  const place = (card, loc, depth, colLen, z) => {
    const el = cardEls[card];
    const { x, y } = cardPosition(loc, depth, colLen);
    el.classList.toggle('no-anim', !animate);
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.zIndex = z;
    el.dataset.loc = `${loc.type}:${loc.index}`;
    el.dataset.depth = depth;
    el.hidden = false;
    placed.add(card);
  };
  s.cascades.forEach((col, i) => col.forEach((card, d) => place(card, { type: 'cascade', index: i }, d, col.length, 10 + d)));
  s.cells.forEach((card, i) => { if (card !== null) place(card, { type: 'cell', index: i }, 0, 1, 10); });
  s.foundations.forEach((n, suit) => {
    for (let r = 0; r < n; r++) {
      const card = (r << 2) | suit;
      place(card, { type: 'foundation', index: suit }, 0, 1, 10 + r);
    }
  });
  for (let c = 0; c < 52; c++) if (!placed.has(c)) cardEls[c].hidden = true;
  if (!animate) requestAnimationFrame(() => cardEls.forEach((el) => el.classList.remove('no-anim')));

  statusSeed.textContent = '#' + game.seed;
  statusMoves.textContent = `${game.moveCount} move${game.moveCount === 1 ? '' : 's'}`;
  btnUndo.disabled = !game.canUndo();
  btnRedo.disabled = !game.canRedo();
  btnCollect.disabled = game.won || !legalMoves(s).some((m) => m.to.type === 'foundation');
  btnHint.disabled = game.won;
  updateSelectionClasses();
}

// ---------- Timer ----------
function fmtTime(ms) {
  const t = Math.floor(ms / 1000);
  const m = Math.floor(t / 60), sec = t % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
function currentElapsed() { return elapsedMs + (runningSince ? Date.now() - runningSince : 0); }
function startTimer() {
  if (runningSince || game.won) return;
  runningSince = Date.now();
  if (!timerHandle) timerHandle = setInterval(() => { statusTime.textContent = fmtTime(currentElapsed()); }, 500);
}
function pauseTimer() {
  if (runningSince) { elapsedMs += Date.now() - runningSince; runningSince = null; }
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
  statusTime.textContent = fmtTime(currentElapsed());
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pauseTimer(); persist(); }
  else if (game && game.history.length && !game.won) startTimer();
});

// ---------- Persistence ----------
function persist() {
  if (!game) return;
  saveGame({ game: game.toJSON(), elapsedMs: currentElapsed(), counted });
}

// ---------- Game flow ----------
function abandonCurrentIfNeeded() {
  if (game && counted && !game.won) {
    recordGame({ seed: game.seed, won: false, ms: currentElapsed(), moves: game.moveCount });
  }
}

function newGame(seed) {
  abandonCurrentIfNeeded();
  pauseTimer();
  elapsedMs = 0; runningSince = null; counted = false;
  game = new Game(seed, { autoMove: settings.autoMove });
  clearSelection();
  clearHint();
  statusTime.textContent = '0:00';
  if (!metrics) computeLayout();
  // Deal animation: stack everything on the first free cell, then fan out.
  const start = metrics.cells[0];
  cardEls.forEach((el, i) => {
    el.classList.remove('won');
    el.style.animationDelay = '';
    el.classList.add('no-anim');
    el.hidden = false;
    el.style.transform = `translate(${start.x}px, ${start.y}px)`;
    el.style.zIndex = i;
  });
  requestAnimationFrame(() => requestAnimationFrame(() => render(true)));
  persist();
  checkSolvable();
}

function randomSeed() { return 1 + Math.floor(Math.random() * 32000); }

function afterMove(result) {
  if (!result.ok) return;
  if (!counted) { counted = true; }
  startTimer();
  if (settings.haptics && navigator.vibrate) navigator.vibrate(8);
  clearSelection();
  clearHint();
  render();
  persist();
  if (game.won) onWin();
  else checkSolvable();
}

function onWin() {
  pauseTimer();
  const ms = currentElapsed();
  recordGame({ seed: game.seed, won: true, ms, moves: game.moveCount });
  counted = false; // already recorded
  clearGame();
  persist();
  setSolvable('hidden');
  cardEls.forEach((el, i) => { el.style.animationDelay = `${(i % 13) * 40}ms`; el.classList.add('won'); });
  $('#won-summary').textContent = `Deal #${game.seed} in ${fmtTime(ms)} with ${game.moveCount} moves.`;
  $('#won-next-seed').textContent = '#' + (game.seed % MAX_SEED + 1);
  setTimeout(() => $('#dlg-won').showModal(), 600);
}

// ---------- Selection & moves ----------
function clearSelection() {
  selection = null;
  updateSelectionClasses();
}
function updateSelectionClasses() {
  cardEls.forEach((el) => el.classList.remove('selected'));
  document.querySelectorAll('.slot.target').forEach((el) => el.classList.remove('target'));
  if (!selection) return;
  selection.cards.forEach((c) => cardEls[c].classList.add('selected'));
}

/** Cards that move if you pick up `card` (null if not pickable). */
function pickup(card) {
  const s = game.state;
  const ci = s.cells.indexOf(card);
  if (ci >= 0) return { from: { type: 'cell', index: ci }, count: 1, cards: [card] };
  for (let i = 0; i < 8; i++) {
    const col = s.cascades[i];
    const d = col.indexOf(card);
    if (d < 0) continue;
    const count = col.length - d;
    if (runLength(col) < count) return null;
    return { from: { type: 'cascade', index: i }, count, cards: col.slice(d) };
  }
  return null;
}

function tryMove(from, to, count) {
  const move = { from, to, count };
  if (to.type === 'foundation') {
    // Any foundation tap sends the card to its own suit's pile.
    const card = from.type === 'cell' ? game.state.cells[from.index]
      : game.state.cascades[from.index][game.state.cascades[from.index].length - 1];
    if (card === null || card === undefined) return false;
    move.to = { type: 'foundation', index: suitOf(card) };
    move.count = 1;
  }
  if (!canMove(game.state, move)) return false;
  afterMove(game.move(move));
  return true;
}

/** Best automatic destination for a picked-up run: foundation > non-empty cascade > empty cascade > cell. */
function smartMove(sel) {
  const s = game.state;
  const { from, count } = sel;
  const top = sel.cards[0];
  if (count === 1 && s.foundations[suitOf(top)] === rankOf(top)) {
    return tryMove(from, { type: 'foundation', index: suitOf(top) }, 1);
  }
  // Prefer a cascade whose bottom card accepts this run; pick the one with the longest run below (most "built").
  let best = null;
  for (let j = 0; j < 8; j++) {
    if (from.type === 'cascade' && from.index === j) continue;
    const dst = s.cascades[j];
    if (!dst.length) continue;
    const m = { from, to: { type: 'cascade', index: j }, count };
    if (canMove(s, m)) {
      const score = runLength(dst);
      if (!best || score > best.score) best = { m, score };
    }
  }
  if (best) { afterMove(game.move(best.m)); return true; }
  // Empty cascade (only when moving from a cell, or when not the whole column)
  const emptyIdx = s.cascades.findIndex((c) => !c.length);
  if (emptyIdx >= 0 && !(from.type === 'cascade' && s.cascades[from.index].length === count)) {
    const m = { from, to: { type: 'cascade', index: emptyIdx }, count };
    if (canMove(s, m)) { afterMove(game.move(m)); return true; }
  }
  if (count === 1 && from.type === 'cascade') {
    const cellIdx = s.cells.indexOf(null);
    if (cellIdx >= 0) { afterMove(game.move({ from, to: { type: 'cell', index: cellIdx }, count: 1 })); return true; }
  }
  shake(sel.cards);
  return false;
}

function shake(cards) {
  cards.forEach((c) => {
    const el = cardEls[c];
    el.animate([{ translate: '0 0' }, { translate: '-4px 0' }, { translate: '4px 0' }, { translate: '0 0' }], { duration: 180 });
  });
}

// ---------- Pointer handling (tap + drag) ----------
let drag = null;
const TAP_SLOP = 8;

function locFromPoint(x, y) {
  // Which slot column/area is under the pointer?
  const bx = x - metrics.boardRect.left, by = y - metrics.boardRect.top;
  const { cw, ch, gap } = metrics;
  const topRowBottom = metrics.cells[0].y + ch + gap * 0.75;
  if (by < topRowBottom) {
    for (let i = 0; i < 4; i++) if (bx >= metrics.cells[i].x - gap / 2 && bx < metrics.cells[i].x + cw + gap / 2) return { type: 'cell', index: i };
    for (let i = 0; i < 4; i++) if (bx >= metrics.foundations[i].x - gap / 2 && bx < metrics.foundations[i].x + cw + gap / 2) return { type: 'foundation', index: i };
    return null;
  }
  for (let i = 0; i < 8; i++) {
    if (bx >= metrics.cascades[i].x - gap / 2 && bx < metrics.cascades[i].x + cw + gap / 2) return { type: 'cascade', index: i };
  }
  return null;
}

board.addEventListener('pointerdown', (e) => {
  if (game.won) return;
  const cardEl = e.target.closest('.card');
  const card = cardEl ? Number(cardEl.dataset.card) : null;
  drag = { startX: e.clientX, startY: e.clientY, card, moved: false, pick: null, pointerId: e.pointerId };
  if (card !== null && cardEl.dataset.loc?.startsWith('foundation')) drag.card = null;
  board.setPointerCapture(e.pointerId);
});

board.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < TAP_SLOP) return;
    if (drag.card === null) { drag = null; return; }
    const pick = pickup(drag.card);
    if (!pick) { drag = null; return; }
    drag.moved = true;
    drag.pick = pick;
    clearHint();
    if (selection) clearSelection();
    pick.cards.forEach((c, i) => {
      const el = cardEls[c];
      el.classList.add('dragging');
      el.style.zIndex = 500 + i;
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform);
      el.dataset.ox = m ? m[1] : 0; el.dataset.oy = m ? m[2] : 0;
    });
  }
  drag.pick.cards.forEach((c) => {
    const el = cardEls[c];
    el.style.transform = `translate(${+el.dataset.ox + dx}px, ${+el.dataset.oy + dy}px)`;
  });
  const loc = locFromPoint(e.clientX, e.clientY);
  document.querySelectorAll('.slot.target').forEach((el) => el.classList.remove('target'));
  if (loc) {
    const m = { from: drag.pick.from, to: loc, count: drag.pick.count };
    if (loc.type === 'foundation') { m.to = { type: 'foundation', index: suitOf(drag.pick.cards[0]) }; }
    if (canMove(game.state, m)) slots[loc.type][m.to.index].classList.add('target');
  }
});

function endDrag(e, cancelled) {
  if (!drag) return;
  const d = drag; drag = null;
  document.querySelectorAll('.slot.target').forEach((el) => el.classList.remove('target'));
  if (d.moved) {
    d.pick.cards.forEach((c) => cardEls[c].classList.remove('dragging'));
    const loc = cancelled ? null : locFromPoint(e.clientX, e.clientY);
    let ok = false;
    if (loc && !sameLocation(loc, d.pick.from)) ok = tryMove(d.pick.from, loc, d.pick.count);
    if (!ok) render(); // snap back
    return;
  }
  if (cancelled) return;
  // --- Tap ---
  const loc = d.card !== null ? null : locFromPoint(e.clientX, e.clientY);
  if (d.card !== null) {
    const pick = pickup(d.card);
    if (selection) {
      if (selection.cards[0] === d.card) { smartMove(selection); return; }
      // Tap a card in another column: try moving there.
      const cardLoc = cardEls[d.card].dataset.loc.split(':');
      const to = { type: cardLoc[0], index: Number(cardLoc[1]) };
      if (!sameLocation(to, selection.from) && tryMove(selection.from, to, selection.count)) return;
      if (pick) { selection = pick; updateSelectionClasses(); return; }
      clearSelection();
      return;
    }
    if (pick) { selection = pick; updateSelectionClasses(); clearHint(); }
    else shake([d.card]);
    return;
  }
  if (selection && loc) {
    if (!tryMove(selection.from, loc, selection.count)) shake(selection.cards);
    clearSelection();
    return;
  }
  clearSelection();
}
board.addEventListener('pointerup', (e) => endDrag(e, false));
board.addEventListener('pointercancel', (e) => endDrag(e, true));

// ---------- Hints & solvability ----------
function clearHint() {
  if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
  cardEls.forEach((el) => el.classList.remove('hint'));
  document.querySelectorAll('.slot.hint-target').forEach((el) => el.classList.remove('hint-target'));
}

function showHintMove(m) {
  clearHint();
  const s = game.state;
  const cards = m.from.type === 'cell' ? [s.cells[m.from.index]]
    : s.cascades[m.from.index].slice(s.cascades[m.from.index].length - m.count);
  cards.forEach((c) => cardEls[c].classList.add('hint'));
  slots[m.to.type][m.to.index].classList.add('hint-target');
  hintTimer = setTimeout(clearHint, 2500);
}

let hintBusy = false;
async function hint() {
  if (hintBusy || game.won) return;
  hintBusy = true;
  btnHint.disabled = true;
  setSolvable('thinking');
  const r = await solveAsync(game.state, 400000);
  hintBusy = false;
  btnHint.disabled = false;
  if (r.solved) {
    setSolvable('solvable');
    const first = r.moves.find((m) => !m.auto) || r.moves[0];
    if (first) showHintMove(first);
    else toast('Everything is already headed home.');
  } else if (r.exhausted) {
    setSolvable('dead');
    toast('No way out from here. Undo a few moves or start over.');
  } else {
    setSolvable('unknown');
    const legal = legalMoves(game.state).filter((m) => m.to.type !== 'cell');
    if (legal.length) { showHintMove(legal[0]); toast("Couldn't find a full solution in time — here's a legal move."); }
    else toast('No solution found in time.');
  }
}

function setSolvable(kind) {
  solvableDot.hidden = kind === 'hidden' || !settings.showSolvable;
  solvableDot.className = 'dot' + (kind === 'solvable' || kind === 'dead' || kind === 'thinking' ? ' ' + kind : '');
  solvableDot.title = { solvable: 'Solvable from here', dead: 'No solution from here', thinking: 'Checking…', unknown: 'Unknown' }[kind] || '';
}

let solvableReq = 0;
async function checkSolvable() {
  if (!settings.showSolvable || game.won) { setSolvable('hidden'); return; }
  const myReq = ++solvableReq;
  setSolvable('thinking');
  const r = await solveAsync(game.state, 120000);
  if (myReq !== solvableReq) return; // stale
  if (r.solved) setSolvable('solvable');
  else if (r.exhausted) { setSolvable('dead'); if (!legalMoves(game.state).length) toast('No moves left.'); }
  else setSolvable('unknown');
}

// ---------- Toast ----------
let toastTimer = null;
function toast(msg, action) {
  toastEl.innerHTML = '';
  toastEl.append(document.createTextNode(msg));
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = action.onClick;
    toastEl.append(b);
  }
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, action ? 8000 : 2800);
}

// ---------- Toolbar & dialogs ----------
$('#btn-undo').addEventListener('click', () => {
  if (!game.canUndo()) return;
  game.undo(); clearSelection(); clearHint(); render(); persist(); checkSolvable();
  cardEls.forEach((el) => el.classList.remove('won'));
});
$('#btn-redo').addEventListener('click', () => {
  if (!game.canRedo()) return;
  const r = game.redo(); clearSelection(); clearHint(); render(); persist();
  if (game.won) onWin(); else checkSolvable();
});
$('#btn-hint').addEventListener('click', hint);
$('#btn-collect').addEventListener('click', () => { const r = game.collectAll(); afterMove(r); });

const dlgNew = $('#dlg-new');
$('#btn-new').addEventListener('click', () => { $('#new-seed').value = ''; dlgNew.showModal(); });
dlgNew.addEventListener('close', () => {
  const v = dlgNew.returnValue;
  if (v === 'random') newGame(randomSeed());
  else if (v === 'replay') newGame(game.seed);
  else if (v === 'seed') {
    const n = parseInt($('#new-seed').value, 10);
    if (n >= 1 && n <= MAX_SEED) newGame(n);
    else toast('Enter a deal number between 1 and 1,000,000.');
  }
});
// Let Enter in the seed field submit "Play numbered deal".
$('#new-seed').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); dlgNew.close('seed'); }
});

const dlgMenu = $('#dlg-menu');
$('#btn-menu').addEventListener('click', () => dlgMenu.showModal());
dlgMenu.addEventListener('close', () => {
  const v = dlgMenu.returnValue;
  if (v === 'stats') openStats();
  else if (v === 'settings') openSettings();
  else if (v === 'rules') $('#dlg-rules').showModal();
});

const dlgStats = $('#dlg-stats');
function openStats() {
  const s = loadStats();
  const pct = s.played ? Math.round((100 * s.won) / s.played) : 0;
  const stat = (v, label) => `<div class="stat"><b>${v}</b><span>${label}</span></div>`;
  let html = stat(s.played, 'played') + stat(`${pct}%`, `won (${s.won})`)
    + stat(s.streak > 0 ? s.streak : 0, 'current streak') + stat(s.bestStreak, 'best streak')
    + stat(s.bestTimeMs != null ? fmtTime(s.bestTimeMs) : '–', 'best time')
    + stat(s.fewestMoves != null ? s.fewestMoves : '–', 'fewest moves');
  if (s.recent.length) {
    html += '<div class="recent">' + s.recent.slice(0, 10).map((g) =>
      `<div><span>#${g.seed}</span><span class="${g.won ? 'w' : 'l'}">${g.won ? 'Won' : 'Lost'}</span><span>${fmtTime(g.ms)} · ${g.moves} mv</span></div>`).join('') + '</div>';
  }
  $('#stats-body').innerHTML = html;
  dlgStats.showModal();
}
dlgStats.addEventListener('close', () => {
  if (dlgStats.returnValue === 'reset') { resetStats(); toast('Statistics reset.'); }
});

const dlgSettings = $('#dlg-settings');
function openSettings() {
  $('#set-automove').checked = settings.autoMove;
  $('#set-solvable').checked = settings.showSolvable;
  $('#set-haptics').checked = settings.haptics;
  $('#set-bigcards').checked = settings.bigCards;
  $('#set-theme').value = settings.theme;
  $('#app-version').textContent = APP_VERSION;
  dlgSettings.showModal();
}
dlgSettings.addEventListener('close', () => {
  settings = {
    autoMove: $('#set-automove').checked,
    showSolvable: $('#set-solvable').checked,
    haptics: $('#set-haptics').checked,
    bigCards: $('#set-bigcards').checked,
    theme: $('#set-theme').value,
  };
  saveSettings(settings);
  applySettings();
  if (game) { game.autoMove = settings.autoMove; persist(); checkSolvable(); }
});
function applySettings() {
  document.body.dataset.theme = settings.theme;
  document.body.classList.toggle('big-corners', settings.bigCards);
  const color = { felt: '#1f6f43', night: '#23272e', ocean: '#1d4f73' }[settings.theme];
  document.querySelector('meta[name=theme-color]').setAttribute('content', color);
  computeLayout();
  if (game) render(false);
}

const dlgWon = $('#dlg-won');
dlgWon.addEventListener('close', () => {
  const v = dlgWon.returnValue;
  if (v === 'random') newGame(randomSeed());
  else if (v === 'next') newGame(game.seed % MAX_SEED + 1);
});

// Keyboard shortcuts (desktop)
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || document.querySelector('dialog[open]')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? btnRedo : btnUndo).click(); }
  else if (e.key === 'h') hint();
  else if (e.key === 'n') $('#btn-new').click();
  else if (e.key === 'Escape') clearSelection();
});

// ---------- Service worker ----------
let swReg = null;
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register('sw.js');
    const promptUpdate = (w) => toast('A new version is ready.', {
      label: 'Reload',
      onClick: () => { w.postMessage({ type: 'SKIP_WAITING' }); },
    });
    if (swReg.waiting) promptUpdate(swReg.waiting);
    swReg.addEventListener('updatefound', () => {
      const w = swReg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(w);
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => { persist(); location.reload(); });
  } catch { /* offline or unsupported */ }
}
$('#btn-update').addEventListener('click', async () => {
  if (!swReg) return toast('Offline support is not active.');
  await swReg.update();
  // Give the browser a beat to start installing before reporting the result.
  setTimeout(() => {
    if (swReg.waiting || swReg.installing) toast('Updating…');
    else toast('You have the latest version.');
  }, 800);
});

// ---------- Boot ----------
function boot() {
  buildCards();
  applySettings();
  const saved = loadGame();
  const params = new URLSearchParams(location.search);
  const wantNew = params.has('new') || params.has('deal');
  if (wantNew) history.replaceState(null, '', location.pathname);
  if (saved && saved.game && !saved.game.won && !wantNew) {
    game = Game.fromJSON(saved.game);
    game.autoMove = settings.autoMove;
    elapsedMs = saved.elapsedMs || 0;
    counted = !!saved.counted;
    render(false);
    statusTime.textContent = fmtTime(elapsedMs);
    if (game.history.length) startTimer();
    checkSolvable();
  } else {
    if (saved && saved.game && !saved.game.won) { game = Game.fromJSON(saved.game); counted = !!saved.counted; elapsedMs = saved.elapsedMs || 0; }
    const n = parseInt(params.get('deal'), 10);
    newGame(n >= 1 && n <= MAX_SEED ? n : randomSeed());
  }
  window.addEventListener('resize', () => { computeLayout(); render(false); });
  window.addEventListener('pagehide', persist);
  registerSW();
}

boot();

// Debug hook (handy from the devtools console): __fc.game, __fc.newGame(seed)
window.__fc = { get game() { return game; }, newGame, play: (m) => afterMove(game.move(m)) };
