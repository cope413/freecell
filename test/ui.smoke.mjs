// UI smoke test: loads the app at a phone viewport, plays a few moves via tap
// and drag, checks console for errors, and saves screenshots. Run with the
// static server up on :8080 (`npm run serve`).
import { chromium, devices } from 'playwright';

const base = process.env.BASE || 'http://localhost:8080/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'], hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(base + '?deal=1');
await page.waitForTimeout(800);
await page.screenshot({ path: 'test/shots/01-deal1.png' });

// Tap-to-move: pick up 5H (bottom of column 7 in deal 1 → rank 4, suit H = (4<<2)|2 = 18) and tap the 6C column?
// Simpler: use the smart-move: tap a card twice and expect the move count to rise if legal.
const cardCenter = async (id) => {
  const box = await page.locator(`.card[data-card="${id}"]`).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height * 0.85 };
};
// Deal 1 bottom cards: col0 6S(23), col1 9C(32), col2 2H(6), col3 6H(22), col4 8H(30), col5 2C(4), col6 JH(42), col7 7D(25)
// 6H (red) can go onto... nothing directly; move 2C (col5) via smart-move → it goes to a free cell.
let c = await cardCenter(9); // 3D, bottom of column 5
await page.touchscreen.tap(c.x, c.y);
await page.waitForTimeout(150);
await page.touchscreen.tap(c.x, c.y);
await page.waitForTimeout(500);
let moves = await page.locator('#status-moves').textContent();
console.log('after smart-move:', moves);

// Drag: 2C (now bottom of column 5, id 4) into free cell 1 — legal.
const from = await cardCenter(4);
const cellBox = await page.locator('.slot.cell[data-index="1"]').boundingBox();
const to = { x: cellBox.x + cellBox.width / 2, y: cellBox.y + cellBox.height / 2 };
await page.mouse.move(from.x, from.y);
await page.mouse.down();
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(from.x + (to.x - from.x) * i / 10, from.y + (to.y - from.y) * i / 10);
}
await page.mouse.up();
await page.waitForTimeout(500);
moves = await page.locator('#status-moves').textContent();
console.log('after drag:', moves);
console.log('2C now at', await page.locator('.card[data-card="4"]').getAttribute('data-loc'));

// Hint
await page.click('#btn-hint');
await page.waitForTimeout(2500);
const dot = await page.locator('#solvable-dot').getAttribute('class');
console.log('solvable dot:', dot);
await page.screenshot({ path: 'test/shots/02-after-moves.png' });

// Undo twice
await page.click('#btn-undo'); await page.waitForTimeout(300); await page.click('#btn-undo');
await page.waitForTimeout(400);
console.log('after undo:', await page.locator('#status-moves').textContent());

// Reload → state restored
await page.reload();
await page.waitForTimeout(600);
console.log('after reload:', await page.locator('#status-seed').textContent(), await page.locator('#status-moves').textContent());

// Open menu → stats
await page.click('#btn-menu');
await page.waitForTimeout(200);
await page.screenshot({ path: 'test/shots/03-menu.png' });
await page.click('#dlg-menu button[value="stats"]');
await page.waitForTimeout(200);
await page.screenshot({ path: 'test/shots/04-stats.png' });
await page.click('#dlg-stats button[value="close"]');

// Service worker registered?
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r; });
console.log('service worker registered:', sw);

// Desktop viewport
const desk = await browser.newPage({ viewport: { width: 1200, height: 800 } });
desk.on('pageerror', (e) => errors.push('desktop: ' + e));
await desk.goto(base + '?deal=617');
await desk.waitForTimeout(700);
await desk.screenshot({ path: 'test/shots/05-desktop.png' });

console.log('errors:', errors);
await browser.close();
process.exit(errors.length ? 1 : 0);
