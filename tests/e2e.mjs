// End-to-end smoke test on phone and laptop viewports.
// Usage: BASE_URL=http://localhost:4173 node tests/e2e.mjs   (defaults to vite preview on 4173)
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright'); }
const { chromium, devices } = pw;

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const SHOTS = process.env.SHOTS || 'shots';
fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (c, msg) => { if (c) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } };

const LIST = ['1. Matt M', '2. Yolla F', '3. Dimas cowok', '4. Sari cewek', '5. Budi L', '6. Rina P', '7. Andi M', '8. Tika F', '9. Joko M', '10. Wulan F'].join('\n');

async function noHScroll(page, label) {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  ok(sw <= iw, `${label}: no horizontal scroll (${sw} <= ${iw})`);
}
async function scoreRound(page, val) {
  const n = await page.locator('.card').first().locator('.matches .match').count();
  for (let i = 0; i < n; i++) {
    await page.locator('.card').first().locator('.matches .match').nth(i).locator('button.team').first().click();
    await page.locator('.grid button', { hasText: new RegExp(`^${val}$`) }).click();
  }
  return n;
}

async function run(name, ctxOpts, desktop) {
  console.log(`\n${name}`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  ok(await page.locator('h1').innerText() === 'Padel Night', 'app renders');
  await page.screenshot({ path: `${SHOTS}/${name}-0-empty.png`, fullPage: true });

  // players via WhatsApp paste
  await page.click('text=+ Paste a list from WhatsApp');
  await page.fill('#pasteBox', LIST);
  await page.click('text=Add all');
  ok(await page.locator('.prow').count() === 10, '10 players pasted');
  ok(await page.locator('.prow .g.F').count() === 5, 'genders parsed (5 F)');
  await page.fill('#newName', 'Extra');
  await page.keyboard.press('Enter');
  ok(await page.locator('.prow').count() === 11, 'add player with Enter');
  await page.locator('.prow').last().locator('.x').click();
  ok(await page.locator('.prow').count() === 10, 'remove player');

  // calculator
  await page.click('text=Not sure? Calculate');
  ok(await page.locator('.recbox').isVisible(), 'points calculator opens');
  await page.locator('.recbox .btn.pri').click();
  await page.click('[data-act="points"][data-v="24"]');
  await noHScroll(page, 'setup');
  await page.screenshot({ path: `${SHOTS}/${name}-1-setup.png`, fullPage: true });

  // start
  await page.click('text=Start tournament');
  ok(await page.locator('text=Round 1').first().isVisible(), 'round 1 generated');
  ok(await page.locator('.byes .nchip').count() === 2, '2 sitting out with 10 players / 2 courts');
  ok(await page.locator('button[data-act="next"]').isDisabled(), 'next disabled until scored');

  // score round 1 (fixed 24: tap 15, opponent auto 9)
  const nm = await scoreRound(page, 15);
  ok(nm === 2, '2 matches on 2 courts');
  const scores = await page.locator('.card').first().locator('.sc').allInnerTexts();
  ok(scores.join(',') === '15,9,15,9', `auto-fill opponent score (${scores.join(',')})`);
  await noHScroll(page, 'play');
  await page.screenshot({ path: `${SHOTS}/${name}-2-play.png`, fullPage: true });

  await page.click('button[data-act="next"]');
  ok(await page.locator('h2', { hasText: 'Round 2' }).isVisible(), 'round 2 generated');

  if (desktop) {
    await page.locator('.card').first().locator('button.team').first().click();
    await page.keyboard.type('17');
    await page.keyboard.press('Enter');
    const s = await page.locator('.card').first().locator('.match').first().locator('.sc').allInnerTexts();
    ok(s.join(',') === '17,7', `keyboard score entry (${s.join(',')})`);
    ok(await page.locator('.side table tbody tr').count() === 10, 'sidebar standings visible on laptop');
    await page.locator('.card').first().locator('.match').nth(1).locator('button.team').first().click();
    await page.keyboard.press('Escape');
    ok(await page.locator('.sheetbox').count() === 0, 'Esc closes sheet');
    await scoreRound(page, 12);
  } else {
    ok(!(await page.locator('.side').isVisible()), 'sidebar hidden on phone');
    await scoreRound(page, 12);
  }
  // edit a previous round
  await page.click('button[data-act="openR"]');
  await page.locator('.pr .prbody button.team').first().click();
  await page.locator('.grid button', { hasText: /^20$/ }).click();
  ok((await page.locator('.pr .prbody .sc').first().innerText()) === '20', 'edit previous round score');

  // timer
  await page.click('button[data-act="tNew"]');
  ok(await page.locator('.timer').isVisible(), 'timer appears');
  await page.click('button[data-act="tToggle"]');
  await page.waitForTimeout(1300);
  const t = await page.locator('[data-clock]').first().innerText();
  ok(/^11:5\d$/.test(t), `timer counts down (${t})`);

  // standings + player sheet
  await page.click('nav.tabs button[data-v="standings"]');
  ok(await page.locator('.narrow table tbody tr').count() === 10, 'standings lists 10');
  await page.locator('.narrow table tbody tr').first().click();
  ok(await page.locator('.plog .it').count() >= 2, 'player detail shows match log');
  await page.screenshot({ path: `${SHOTS}/${name}-3-player.png`, fullPage: false });
  await page.keyboard.press('Escape');
  await page.click('[data-act="seg"][data-k="filter"][data-v="F"]');
  ok(await page.locator('.narrow table tbody tr').count() === 5, 'women filter');
  await page.click('[data-act="seg"][data-k="filter"][data-v="all"]');
  await noHScroll(page, 'standings');
  await page.screenshot({ path: `${SHOTS}/${name}-4-standings.png`, fullPage: true });

  // persistence
  await page.reload({ waitUntil: 'networkidle' });
  ok(await page.locator('h2', { hasText: 'Round 3' }).isVisible() || await page.locator('h2', { hasText: 'Round 2' }).isVisible(), 'state survives reload');

  // display mode synced from a second window
  const disp = await ctx.newPage();
  await disp.goto(BASE + '/#display', { waitUntil: 'networkidle' });
  ok(await disp.locator('.disp .match').count() === 2, 'display mode shows courts');
  await noHScroll(disp, 'display');
  await disp.screenshot({ path: `${SHOTS}/${name}-5-display.png`, fullPage: true });
  await page.click('nav.tabs button[data-v="play"]');
  if (await page.locator('button[data-act="next"]').isEnabled()) await page.click('button[data-act="next"]');
  await page.locator('.card').first().locator('button.team').first().click();
  await page.locator('.grid button', { hasText: /^21$/ }).click();
  await disp.waitForTimeout(400);
  ok((await disp.locator('.disp .match .sc').first().innerText()) === '21', 'display window syncs live');
  await disp.close();

  // backup round-trip
  const code = await page.evaluate(() => JSON.stringify(window.__padel.S));
  await page.click('nav.tabs button[data-v="setup"]');
  await page.click('text=Reset everything');
  await page.click('text=Tap again to wipe');
  ok(await page.locator('.prow').count() === 0, 'reset clears');
  await page.click('text=Load backup');
  await page.fill('#importBox', 'not json');
  await page.click('button[data-act="doImport"]');
  ok(await page.locator('#toast', { hasText: 'not a valid backup' }).isVisible(), 'rejects bad backup');
  await page.fill('#importBox', code);
  await page.click('button[data-act="doImport"]');
  ok(await page.locator('.card').first().locator('.match').count() === 2, 'backup restores tournament');

  // finish
  await page.click('text=Finish tournament');
  ok(await page.locator('.podium').isVisible(), 'finish shows podium');
  await page.screenshot({ path: `${SHOTS}/${name}-6-final.png`, fullPage: true });

  ok(errors.length === 0, `no JS errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
}

async function runTimedMixed() {
  console.log('\nmobile · mixed mexicano timed');
  const browser = await chromium.launch();
  const page = await browser.newPage({ ...devices['iPhone 13'] });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('[data-k="format"][data-v="mexicano"]');
  await page.click('[data-k="mixed"][data-v="1"]');
  await page.click('[data-k="scoring"][data-v="timed"]');
  await page.click('[data-act="roundMin"][data-v="10"]');
  await page.click('text=+ Paste a list from WhatsApp');
  await page.fill('#pasteBox', LIST);
  await page.click('text=Add all');
  await page.click('text=Start tournament');
  ok(await page.locator('.timer').isVisible(), 'timed mode shows timer');
  ok((await page.locator('[data-clock]').innerText()) === '10:00', 'timer set to 10:00');
  // timed: enter both sides
  for (let i = 0; i < 2; i++) {
    await page.locator('.match').nth(i).locator('button.team').first().click();
    await page.locator('.grid button', { hasText: /^11$/ }).click();
    await page.locator('.grid button', { hasText: /^7$/ }).click();
  }
  const sc = await page.locator('.match .sc').allInnerTexts();
  ok(sc.join(',') === '11,7,11,7', `timed entry both sides (${sc.join(',')})`);
  // every team mixed
  const teams = await page.locator('.match button.team').evaluateAll((els) => els.map((e) => [...e.querySelectorAll('.g')].map((g) => g.textContent).sort().join('')));
  ok(teams.every((t) => t === 'FM'), 'every team is 1 M + 1 F');
  await page.click('button[data-act="next"]');
  ok(await page.locator('h2', { hasText: 'Round 2' }).isVisible(), 'mexicano round 2');
  ok((await page.locator('[data-clock]').innerText()) === '10:00', 'timer resets for new round');
  await page.screenshot({ path: `${SHOTS}/mobile-timed.png`, fullPage: true });
  ok(errors.length === 0, 'no JS errors');
  await browser.close();
}

await run('mobile', { ...devices['iPhone 13'] }, false);
await run('laptop', { viewport: { width: 1440, height: 900 } }, true);
await runTimedMixed();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
