import { chromium, devices } from 'playwright';
import { newState } from '/home/claude/freecell/src/engine.js';
import { solve } from '/home/claude/freecell/src/solver.js';
const r = solve(newState(617), { maxNodes: 200000 });
const browser = await chromium.launch();
const page = await browser.newPage({ ...devices['Pixel 7'] });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:8080/?deal=617'); await page.waitForTimeout(500);
for (const m of r.moves) { if (m.auto) continue; await page.evaluate((m) => { if (!window.__fc.game.won) window.__fc.play(m); }, m); }
await page.waitForTimeout(1200);
console.log('won:', await page.evaluate(() => window.__fc.game.won), 'dialog open:', await page.locator('#dlg-won[open]').count());
await page.screenshot({ path: 'test/shots/06-won.png' });
await page.click('#dlg-won button[value="next"]'); await page.waitForTimeout(600);
console.log('next seed:', await page.locator('#status-seed').textContent());
await page.click('#btn-menu'); await page.click('#dlg-menu button[value="stats"]'); await page.waitForTimeout(200);
await page.screenshot({ path: 'test/shots/07-stats.png' });
console.log('errors', errors);
await browser.close();
