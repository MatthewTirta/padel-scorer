import './style.css';
import {
  defaults, valid, normalize, uid, fmt, isActive, roundDone, stats, ranked, nextRound,
  calcPoints, playerLog, roundText, standText, cleanName, parseLine, PACE,
} from './engine.js';

const KEY = 'padel_scorer_v1';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ---------------- storage ---------------- */
let storageOK = true;
function load() {
  try {
    const r = localStorage.getItem(KEY);
    if (r) { const o = JSON.parse(r); if (valid(o)) return normalize(o); }
  } catch (e) { storageOK = false; }
  return null;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); storageOK = true; } catch (e) { storageOK = false; }
}
let S = load() || defaults();

const ui = {
  tab: S.status === 'setup' ? 'setup' : 'play', gender: 'M', filter: 'all', confirm: null, ct: null,
  sheet: null, paste: false, openRounds: {}, calc: { dur: 120, pace: 'normal' }, beeped: null,
};
const isDisplay = () => location.hash === '#display';
const P = (id) => S.players.find((p) => p.id === id) || { id, name: '?', g: 'M' };
const name = (id) => P(id).name;

/* ---------------- timer ---------------- */
const timerLeft = (t = S.timer) => (!t ? null : t.end != null ? t.end - Date.now() : t.left);
const timerRunning = () => !!(S.timer && S.timer.end != null);
function clockText(ms) {
  const neg = ms < 0, s = Math.ceil(Math.abs(ms) / 1000);
  return (neg ? '+' : '') + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
const clockCls = (ms) => (ms <= 0 ? 'over' : ms <= 60000 ? 'low' : '');
function beep() {
  try {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = beep.ctx || (beep.ctx = new C());
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.28);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3);
    });
  } catch (e) {}
  try { navigator.vibrate && navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) {}
}
setInterval(() => {
  if (!S.timer) return;
  const ms = timerLeft();
  document.querySelectorAll('[data-clock]').forEach((el) => {
    el.textContent = clockText(ms);
    const box = el.closest('.timer') || el;
    box.classList.toggle('low', clockCls(ms) === 'low');
    box.classList.toggle('over', clockCls(ms) === 'over');
  });
  if (timerRunning() && ms <= 0 && ui.beeped !== S.timer.end) {
    ui.beeped = S.timer.end;
    if (!isDisplay() || !document.hidden) beep();
    toast("Time's up. Finish the point and enter scores");
  }
}, 250);

/* ---------------- helpers ---------------- */
function toast(t) {
  const el = $('#toast'); el.textContent = t; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}
function confirmTap(k, fn) {
  clearTimeout(ui.ct);
  if (ui.confirm === k) { ui.confirm = null; fn(); }
  else { ui.confirm = k; ui.ct = setTimeout(() => { ui.confirm = null; render(); }, 3500); }
  render();
}
function copyText(t, msg) {
  const done = () => toast(msg || 'Copied. Paste it in WhatsApp');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      navigator.clipboard.writeText(t).then(done).catch(() => manualCopy(t)); return;
    }
  } catch (e) {}
  manualCopy(t);
}
function manualCopy(t) {
  ui.sheet = { type: 'copy', text: t }; render();
  setTimeout(() => { const el = $('#copyBox'); if (el) { el.focus(); el.select(); } }, 60);
}
const dupe = (n, exceptId) => S.players.some((p) => p.id !== exceptId && p.name.toLowerCase() === n.toLowerCase());
const fmtLabel = () => (S.setup.mixed ? 'Mixed ' : '') + (S.setup.format === 'americano' ? 'Americano' : 'Mexicano');
const used = (id) => S.rounds.some((r) => r.byes.includes(id) || r.matches.some((m) => m.a.includes(id) || m.b.includes(id)));

function genRound() {
  const res = nextRound(S);
  if (!res.ok) { toast(res.error); return false; }
  S.rounds.push(res.round);
  S.timer = S.setup.scoring === 'timed' ? { dur: S.setup.roundMin * 60000, end: null, left: S.setup.roundMin * 60000 } : null;
  save(); return true;
}

function capHint() {
  const act = S.players.filter(isActive), C = S.setup.courts;
  if (!S.setup.mixed) {
    const n = act.length;
    if (n < 4) return ['warn', `Add at least ${4 - n} more player${4 - n > 1 ? 's' : ''} to start.`];
    const nC = Math.min(C, Math.floor(n / 4)), play = nC * 4, sit = n - play;
    let t = `${nC} court${nC > 1 ? 's' : ''} in use · ${play} play each round` + (sit ? ` · ${sit} sit out, rotated fairly` : '');
    if (nC < C) t += ` · ${C - nC} court${C - nC > 1 ? 's' : ''} unused`;
    if (S.setup.format === 'americano' && !sit) t += ` · full partner rotation = ${n - 1} rounds`;
    return [sit ? '' : 'ok', t];
  }
  const m = act.filter((p) => p.g === 'M').length, f = act.length - m;
  if (m < 2 || f < 2) return ['warn', 'Mixed needs at least 2 M and 2 F.'];
  const nC = Math.min(C, Math.floor(m / 2), Math.floor(f / 2)), sm = m - 2 * nC, sf = f - 2 * nC;
  let t = `${nC} court${nC > 1 ? 's' : ''} in use · ${2 * nC} M + ${2 * nC} F play each round`;
  if (sm || sf) t += ` · sitting out each round: ${sm} M, ${sf} F`;
  if (nC < C) t += ` · ${C - nC} court${C - nC > 1 ? 's' : ''} unused`;
  if (m !== f) t += ' · tip: equal M and F is smoothest';
  return [sm || sf ? '' : 'ok', t];
}

/* ---------------- views ---------------- */
const nav = () => `<nav class="tabs">${[['setup', 'Setup'], ['play', 'Play'], ['standings', 'Standings']]
  .map(([k, l]) => `<button class="${ui.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${l}</button>`).join('')}</nav>`;
function header() {
  const n = S.rounds.length;
  const sub = [fmtLabel(), S.setup.scoring === 'fixed' ? S.setup.points + ' pts' : `Timed ${S.setup.roundMin} min`, n ? 'Round ' + n : null, S.status === 'finished' ? 'Finished' : null].filter(Boolean).join(' · ');
  return `<header class="top"><div class="brand"><div class="ball"></div><div style="min-width:0"><h1>${esc(S.setup.name || 'Padel Night')}</h1><div class="sub">${sub}</div></div></div>${nav()}</header>`;
}
function seg(k, opts, cur, locked) {
  return `<div class="seg ${locked ? 'locked' : ''}">${opts.map(([v, l]) => `<button class="${String(cur) === v ? 'on' : ''}" data-act="seg" data-k="${k}" data-v="${v}" ${locked ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
}
const gi = (p) => `<i class="g ${p.g}">${p.g}</i>`;
const pl = (id) => { const p = P(id); return `<span class="pl">${gi(p)}<span class="nm">${esc(p.name)}</span></span>`; };
const chipName = (id) => { const p = P(id); return `<span class="nchip">${gi(p)}${esc(p.name)}</span>`; };

function vSetup() {
  const s = S.setup, locked = S.status !== 'setup';
  const act = S.players.filter(isActive); const m = act.filter((p) => p.g === 'M').length, f = act.length - m;
  const [hc, ht] = capHint();
  const presets = [16, 21, 24, 32];
  const lockNote = locked ? `<div class="hint">Format, teams and scoring are locked once the tournament starts.</div>` : '';
  const byeOpts = s.scoring === 'fixed' ? [['avg', 'Own average'], ['half', 'Half points'], ['zero', 'None']] : [['avg', 'Own average'], ['zero', 'None']];
  const byeCur = s.bye === 'half' && s.scoring !== 'fixed' ? 'avg' : s.bye;
  const mins = [8, 10, 12, 15];
  return `<div class="cols2"><div>
  <div class="card">
    <div class="cardh"><h2>Tournament</h2></div>
    <input class="txt" data-in="name" value="${esc(s.name)}" placeholder="Tournament name" maxlength="40" aria-label="Tournament name">
    <div class="label">Format</div>
    ${seg('format', [['americano', 'Americano'], ['mexicano', 'Mexicano']], s.format, locked)}
    <div class="hint">${s.format === 'americano' ? 'Partners and opponents rotate every round so everyone plays with everyone.' : 'Round 1 is random. After that pairs follow the standings: 1+4 vs 2+3 on court 1, 5+8 vs 6+7 on court 2, and so on.'}</div>
    <div class="label">Teams</div>
    ${seg('mixed', [['0', 'Open'], ['1', 'Mixed · 1 M + 1 F']], s.mixed ? '1' : '0', locked)}
    <div class="label">Scoring</div>
    ${seg('scoring', [['fixed', 'Fixed total points'], ['timed', 'Timed']], s.scoring, locked)}
    ${lockNote}
    ${s.scoring === 'fixed' ? `<div class="label">Points per match</div>
      <div class="chips">${presets.map((v) => `<button class="chip ${s.points === v ? 'on' : ''}" data-act="points" data-v="${v}">${v}</button>`).join('')}
      <input class="txt mini" data-in="points" type="number" inputmode="numeric" min="4" max="99" value="${presets.includes(s.points) ? '' : s.points}" placeholder="Custom" aria-label="Custom points"></div>
      <div class="hint">Both scores add up to ${s.points}. Enter one team, the other fills in.</div>
      <button class="linkbtn" data-act="openCalc">Not sure? Calculate from booking time →</button>`
    : `<div class="label">Minutes per round</div>
      <div class="chips">${mins.map((v) => `<button class="chip ${s.roundMin === v ? 'on' : ''}" data-act="roundMin" data-v="${v}">${v}</button>`).join('')}
      <input class="txt mini" data-in="roundMin" type="number" inputmode="numeric" min="1" max="90" value="${mins.includes(s.roundMin) ? '' : s.roundMin}" placeholder="Custom" aria-label="Custom minutes"></div>
      <div class="hint">Each round gets a countdown with a beep at zero. Enter both teams' points after.</div>`}
    <div class="label">Courts</div>
    <div class="stepper"><button class="btn" data-act="courts" data-v="-1" aria-label="Fewer courts">−</button><b>${s.courts}</b><button class="btn" data-act="courts" data-v="1" aria-label="More courts">+</button></div>
    <div class="label">Sit-out compensation</div>
    ${seg('bye', byeOpts, byeCur, false)}
    <div class="hint">Points credited for rounds a player sits out, so uneven numbers stay fair. "Own average" = their average points per match.</div>
  </div>
  </div><div>
  <div class="card">
    <div class="cardh"><h2>Players</h2><span class="sub">${act.length} active · <span style="color:var(--m)">${m} M</span> · <span style="color:var(--f)">${f} F</span></span></div>
    <div class="addrow">
      <div class="seg gsel">${['M', 'F'].map((g) => `<button class="${ui.gender === g ? 'on' : ''}" data-act="ng" data-v="${g}" aria-label="${g === 'M' ? 'Male' : 'Female'}">${g}</button>`).join('')}</div>
      <input class="txt" id="newName" placeholder="Player name" maxlength="24" autocomplete="off" enterkeyhint="done" aria-label="Player name">
      <button class="btn pri" data-act="add">Add</button>
    </div>
    <button class="linkbtn" data-act="togglePaste">${ui.paste ? 'Hide list paste' : '+ Paste a list from WhatsApp'}</button>
    ${ui.paste ? `<textarea id="pasteBox" class="txt" rows="6" placeholder="One name per line. Gender after the name:&#10;Matt M&#10;Yolla F&#10;Dimas cowok&#10;Sari cewek&#10;(L/P also works)"></textarea><button class="btn block" data-act="pasteAdd">Add all</button>` : ''}
    <div class="plist">${S.players.length ? S.players.map(prow).join('') : '<div class="empty">No players yet. Tap M or F, type a name, hit Add.</div>'}</div>
    <div class="hint ${hc}">${ht}</div>
    ${S.status === 'setup' ? `<button class="btn pri block big" data-act="start">Start tournament</button>` : `<button class="btn block" data-act="tab" data-v="play">Back to Play</button>`}
  </div>
  <div class="card">
    <div class="cardh"><h2>Data</h2></div>
    <div class="hint" style="margin-top:0">Saves automatically on this device and works offline. To continue on another phone or laptop, copy the backup code here and load it there.</div>
    <div class="row2"><button class="btn" data-act="copyBackup">Copy backup code</button><button class="btn" data-act="openImport">Load backup</button></div>
    <div class="row2">
      <button class="btn ghost ${ui.confirm === 'newKeep' ? 'armed' : ''}" data-act="newKeep">${ui.confirm === 'newKeep' ? 'Tap again to confirm' : 'New tournament, keep players'}</button>
      <button class="btn ghost danger ${ui.confirm === 'reset' ? 'armed' : ''}" data-act="reset">${ui.confirm === 'reset' ? 'Tap again to wipe' : 'Reset everything'}</button>
    </div>
  </div>
  </div></div>`;
}
function prow(p) {
  const off = !isActive(p), u = used(p.id);
  const right = u ? `<button class="pill" data-act="pact" data-id="${p.id}">${off ? 'Rejoin' : 'Withdraw'}</button>`
    : `<button class="x" data-act="pdel" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button>`;
  return `<div class="prow ${off ? 'off' : ''}"><button class="g ${p.g}" data-act="pg" data-id="${p.id}" title="Tap to switch M/F" aria-label="Gender ${p.g}, tap to switch">${p.g}</button><input data-in="pname" data-id="${p.id}" value="${esc(p.name)}" maxlength="24" aria-label="Player name">${right}</div>`;
}

function matchCard(ri, mi, m, ro) {
  const has = m.sa != null && m.sb != null, wa = has && m.sa > m.sb, wb = has && m.sb > m.sa;
  const team = (t, side, sc, win) => {
    const inner = `<div class="names">${t.map(pl).join('')}</div><div class="sc ${sc == null ? 'empty' : ''}">${sc == null ? (ro ? '–' : 'Score') : sc}</div>`;
    return ro ? `<div class="team ${win ? 'win' : ''}">${inner}</div>`
      : `<button class="team ${win ? 'win' : ''}" data-act="score" data-r="${ri}" data-m="${mi}" data-side="${side}" aria-label="Enter score for ${esc(t.map(name).join(' and '))}">${inner}</button>`;
  };
  return `<div class="match"><div class="mhead"><span>Court ${m.court}</span>${has ? '<span class="done">Done</span>' : ''}</div>${team(m.a, 'a', m.sa, wa)}<div class="vs">VS</div>${team(m.b, 'b', m.sb, wb)}</div>`;
}
function prevRound(i) {
  const r = S.rounds[i], open = ui.openRounds[i];
  const sum = r.matches.map((m) => (m.sa == null ? '–' : `${m.sa}–${m.sb}`)).join('  ·  ');
  return `<div class="card pr"><button class="prh" data-act="openR" data-r="${i}" aria-expanded="${!!open}"><b>Round ${i + 1}</b><span class="sub">${sum}</span><span class="chev">${open ? '−' : '+'}</span></button>
  ${open ? `<div class="prbody"><div class="matches">${r.matches.map((m, mi) => matchCard(i, mi, m)).join('')}</div>${r.byes.length ? `<div class="byes"><span>Sat out</span>${r.byes.map(chipName).join('')}</div>` : ''}<button class="btn ghost sm" style="margin-top:12px" data-act="copyRound" data-r="${i}">Copy round</button></div>` : ''}</div>`;
}
function timerBox() {
  if (!S.timer) return '';
  const ms = timerLeft(), run = timerRunning();
  return `<div class="timer ${clockCls(ms)}"><div class="clock"><span data-clock>${clockText(ms)}</span><small>${run ? 'running' : ms === S.timer.dur ? 'ready' : 'paused'}</small></div>
    <div class="adj"><button class="btn sm ghost" data-act="tAdj" data-v="-60" aria-label="Minus 1 minute">−1m</button><button class="btn sm ghost" data-act="tAdj" data-v="60" aria-label="Plus 1 minute">+1m</button></div>
    <button class="btn sm ghost" data-act="tReset" aria-label="Reset timer">↺</button>
    <button class="btn sm ${run ? '' : 'pri'}" data-act="tToggle">${run ? 'Pause' : 'Start'}</button></div>`;
}
function vPlay() {
  if (!S.rounds.length) return `<div class="narrow"><div class="card" style="text-align:center;padding:32px 18px"><h2>No rounds yet</h2><p class="sub">Add players in Setup, then hit Start.</p><button class="btn pri" data-act="tab" data-v="setup">Go to Setup</button></div></div>`;
  const n = S.rounds.length, cur = S.rounds[n - 1], done = roundDone(cur), fin = S.status === 'finished';
  const left = cur.matches.filter((m) => m.sa == null || m.sb == null).length;
  const prev = S.rounds.slice(0, -1).map((r, i) => i).reverse();
  return `<div class="cols"><div>
    ${fin ? `<div class="banner"><span>Tournament finished</span><button class="btn ghost sm" data-act="resume">Resume</button></div>` : ''}
    <div class="card">
      <div class="cardh"><h2>Round ${n}</h2><div class="acts">${!fin && !S.timer ? `<button class="btn ghost sm" data-act="tNew">Timer</button>` : ''}<button class="btn ghost sm" data-act="display" title="Big-screen view for a TV or projector">Display</button><button class="btn ghost sm" data-act="copyRound" data-r="${n - 1}">Copy</button></div></div>
      ${fin ? '' : timerBox()}
      <div class="matches">${cur.matches.map((m, i) => matchCard(n - 1, i, m)).join('')}</div>
      ${cur.byes.length ? `<div class="byes"><span>Sitting out</span>${cur.byes.map(chipName).join('')}</div>` : ''}
      ${fin ? '' : `<div class="actions"><button class="btn pri block big" data-act="next" ${done ? '' : 'disabled'}>${done ? `Next round →` : `${left} match${left > 1 ? 'es' : ''} left to score`}</button>
      <button class="btn ghost block" data-act="finish">Finish tournament</button></div>`}
    </div>
    ${prev.length ? `<div class="label" style="margin-left:4px">Previous rounds · tap to edit</div>${prev.map(prevRound).join('')}` : ''}
    ${fin ? '' : `<button class="btn ghost danger block ${ui.confirm === 'undo' ? 'armed' : ''}" data-act="undo">${ui.confirm === 'undo' ? `Tap again to delete Round ${n}` : `Undo Round ${n}`}</button>`}
  </div><aside class="side">${standingsCard(true)}</aside></div>`;
}
function podium(list) {
  const box = (s, c, r) => (s ? `<div class="pod ${c}"><div class="medal">${r}</div><div class="n">${esc(s.name)}</div><div class="t">${fmt(s.total)} pts</div></div>` : '<div></div>');
  return `<div class="podium">${box(list[1], 'p2', 2)}${box(list[0], 'p1', 1)}${box(list[2], 'p3', 3)}</div>`;
}
function standingList() {
  let list = ranked(stats(S)).filter((s) => { const p = P(s.id); return isActive(p) || s.mp > 0 || s.byes > 0; });
  if (ui.filter !== 'all') list = list.filter((s) => s.g === ui.filter);
  return list;
}
function standTable(list, ro) {
  const rows = list.map((s, i) => `<tr class="${i === 0 && s.mp ? 'r1' : ''} ${ro ? '' : 'click'}" ${ro ? '' : `data-act="player" data-id="${s.id}"`}><td class="rk">${i + 1}</td><td class="nm"><span class="pl">${gi(s)}<span class="nm">${esc(s.name)}</span></span></td><td class="pts">${fmt(s.total)}${s.bonus ? `<span class="bon">+${fmt(s.bonus)} sit</span>` : ''}</td><td>${s.mp}</td><td class="hide-s">${s.w}-${s.d}-${s.l}</td><td>${s.diff > 0 ? '+' : ''}${s.diff}</td></tr>`).join('');
  return list.length ? `<table><thead><tr><th class="l">#</th><th class="l">Player</th><th>Pts</th><th>MP</th><th class="hide-s">W-D-L</th><th>+/−</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">No players</div>';
}
function standingsCard(side) {
  const list = standingList();
  const hasM = S.players.some((p) => p.g === 'M'), hasF = S.players.some((p) => p.g === 'F');
  const nd = S.rounds.filter(roundDone).length, fin = S.status === 'finished';
  return `<div class="card">
    <div class="cardh"><h2>Standings</h2><button class="btn ghost sm" data-act="copyStand">Copy</button></div>
    <div class="sub" style="margin:-6px 0 12px">${nd ? `After ${nd} completed round${nd > 1 ? 's' : ''} · tap a player for details` : 'No completed rounds yet'}</div>
    ${hasM && hasF ? `<div style="margin-bottom:12px">${seg('filter', [['all', 'All'], ['M', 'Men'], ['F', 'Women']], ui.filter, false)}</div>` : ''}
    ${fin && !side && list.length >= 2 && nd ? podium(list) : ''}
    ${standTable(list, false)}
  </div>`;
}
const vStand = () => `<div class="narrow">${standingsCard(false)}</div>`;

function vDisplay() {
  const n = S.rounds.length, cur = S.rounds[n - 1];
  const ms = S.timer ? timerLeft() : null;
  const list = ranked(stats(S)).filter((s) => isActive(P(s.id)) || s.mp > 0 || s.byes > 0);
  const nd = S.rounds.filter(roundDone).length;
  return `<div class="disp">
    <div class="disp-h"><div class="brand"><div class="ball"></div><div><h1>${esc(S.setup.name)}</h1><div class="rnd">${fmtLabel()} · ${n ? (S.status === 'finished' ? 'Final' : 'Round ' + n) : 'Waiting to start'}</div></div></div>
      ${ms != null && S.status !== 'finished' ? `<div class="clock ${clockCls(ms)}" data-clock>${clockText(ms)}</div>` : ''}</div>
    <div class="disp-body">
      <div>${cur ? `<div class="matches">${cur.matches.map((m, i) => matchCard(n - 1, i, m, true)).join('')}</div>${cur.byes.length ? `<div class="byes"><span>Sitting out</span>${cur.byes.map(chipName).join('')}</div>` : ''}` : '<div class="card empty">No rounds yet</div>'}</div>
      <div class="card"><div class="cardh"><h2>Standings</h2><span class="sub">${nd ? `after ${nd} round${nd > 1 ? 's' : ''}` : ''}</span></div>${standTable(list, true)}</div>
    </div>
    <button class="btn ghost sm disp-exit" data-act="exitDisplay">Exit display</button>
  </div>`;
}

/* ---------------- sheets ---------------- */
function calcSheet() {
  const c = ui.calc, d = calcPoints(S, c.dur, c.pace), durs = [60, 90, 120, 150, 180];
  const row = (o) => `<div class="crow ${o.p === d.rec.p ? 'rec' : ''}"><b>${o.p} pts</b><span>~${Math.round(o.per)} min/round</span><span>${o.rounds} round${o.rounds === 1 ? '' : 's'}</span><button class="btn sm ${o.p === S.setup.points ? '' : 'ghost'}" data-act="usePts" data-v="${o.p}">${o.p === S.setup.points ? 'In use' : 'Use'}</button></div>`;
  return `<div class="ov" data-act="closeSheet"></div><div class="sheetbox" role="dialog" aria-modal="true" aria-label="Points calculator">
    <div class="sh-h"><div><div class="sub">${fmtLabel()} · ${d.n} players · ${S.setup.courts} court${S.setup.courts > 1 ? 's' : ''}</div><b>Points calculator</b></div><button class="x" data-act="closeSheet" aria-label="Close">✕</button></div>
    <div class="label">Booking time (minutes)</div>
    <div class="chips">${durs.map((v) => `<button class="chip ${c.dur === v ? 'on' : ''}" data-act="calcDur" data-v="${v}">${v}</button>`).join('')}<input class="txt mini" data-in="calcDur" type="number" inputmode="numeric" min="20" max="600" value="${durs.includes(c.dur) ? '' : c.dur}" placeholder="Other" aria-label="Other duration"></div>
    <div class="label">Pace</div>
    ${seg('pace', [['casual', 'Casual'], ['normal', 'Normal'], ['fast', 'Fast']], c.pace, false)}
    <div class="recbox"><div class="sub">Recommended</div><div class="big">${d.rec.p} points <span>· ${d.rec.rounds} rounds · ~${Math.round(d.rec.per)} min each</span></div>
      <div class="hint" style="margin-top:6px;color:${d.short ? 'var(--warn)' : 'var(--muted)'}">${d.short ? `Target is ${d.target} rounds but only ${d.rec.rounds} fit at 16 points. Book more time, add a court, or accept fewer rounds.` : `Target: ${d.why}.`}</div>
      <button class="btn pri block" data-act="usePts" data-v="${d.rec.p}">Use ${d.rec.p} points</button></div>
    <div class="label">All options</div>
    ${d.opts.map(row).join('')}
    <div class="hint">Estimate: ~${PACE[c.pace]}s per point incl. walking and serving, +2 min per round to swap courts. Multiples of 4 keep serves even.</div>
  </div>`;
}
function playerSheet(id) {
  const p = P(id), s = stats(S)[id], log = playerLog(S, id);
  if (!s) { ui.sheet = null; return ''; }
  const rank = standingList().findIndex((x) => x.id === id) + 1;
  const partners = {};
  log.forEach((x) => { if (x.partner) partners[x.partner] = (partners[x.partner] || 0) + 1; });
  const items = log.slice().reverse().map((x) => {
    if (x.bye) return `<div class="it"><span class="r">R${x.round}</span><span class="sub">Sat out</span><span class="w loss">${s.bonus ? '+' + fmt(s.bonus / s.byes) : ''}</span></div>`;
    const has = x.f != null && x.ag != null, cls = !has ? '' : x.f > x.ag ? 'win' : 'loss';
    return `<div class="it"><span class="r">R${x.round}</span><span style="min-width:0">with <b>${esc(name(x.partner))}</b><br><span class="sub">vs ${esc(x.opp.map(name).join(' & '))}</span></span><span class="w ${cls}">${has ? `${x.f}–${x.ag}` : '–'}</span></div>`;
  }).join('');
  return `<div class="ov" data-act="closeSheet"></div><div class="sheetbox" role="dialog" aria-modal="true" aria-label="${esc(p.name)}">
    <div class="sh-h"><div><div class="sub">${rank ? `#${rank} · ` : ''}${p.g === 'F' ? 'Female' : 'Male'}${isActive(p) ? '' : ' · withdrawn'}</div><b>${esc(p.name)}</b></div><button class="x" data-act="closeSheet" aria-label="Close">✕</button></div>
    <div class="statrow"><div class="stat"><b>${fmt(s.total)}</b><span>Points</span></div><div class="stat"><b>${s.mp}</b><span>Played</span></div><div class="stat"><b>${s.w}-${s.l}</b><span>W-L</span></div><div class="stat"><b>${s.mp ? fmt(Math.round((s.pts / s.mp) * 10) / 10) : '–'}</b><span>Avg</span></div></div>
    <div class="hint">Partnered ${Object.keys(partners).length} different player${Object.keys(partners).length === 1 ? '' : 's'}${Object.values(partners).some((v) => v > 1) ? ', some more than once' : ''}.</div>
    <div class="plog">${items || '<div class="empty">No matches yet</div>'}</div>
  </div>`;
}
function scoreSheet(sh) {
  const r = S.rounds[sh.r], m = r && r.matches[sh.m];
  if (!m) { ui.sheet = null; return ''; }
  const team = sh.side === 'a' ? m.a : m.b, oteam = sh.side === 'a' ? m.b : m.a, cur = m['s' + sh.side], ocur = m['s' + (sh.side === 'a' ? 'b' : 'a')];
  const fixed = S.setup.scoring === 'fixed', max = fixed ? S.setup.points : 40;
  const buf = sh.buf || '';
  const shown = buf !== '' ? +buf : cur;
  const other = fixed ? (shown == null ? 'auto' : S.setup.points - shown) : ocur == null ? 'next' : ocur;
  return `<div class="ov" data-act="closeSheet"></div><div class="sheetbox" role="dialog" aria-modal="true" aria-label="Enter score">
    <div class="sh-h"><div><div class="sub">Round ${sh.r + 1} · Court ${m.court}</div><b>${team.map((id) => esc(name(id))).join(' & ')}</b></div><button class="x" data-act="closeSheet" aria-label="Close">✕</button></div>
    <div class="grid">${Array.from({ length: max + 1 }, (_, i) => `<button class="${shown === i ? 'on' : ''}" data-act="pick" data-v="${i}">${i}</button>`).join('')}</div>
    ${fixed ? '' : `<div class="other"><input class="txt" id="otherScore" type="number" inputmode="numeric" min="0" max="999" placeholder="More than 40? Type it" aria-label="Score above 40"><button class="btn" data-act="pickOther">Set</button></div>`}
    <div class="preview"><span>${oteam.map((id) => esc(name(id))).join(' & ')}</span><b>${other}</b></div>
    <div class="kbd">Keyboard: type the score${buf ? ` (<b>${esc(buf)}</b>)` : ''}, <kbd>Enter</kbd> to save, <kbd>Esc</kbd> to close</div>
    ${cur != null || ocur != null ? `<button class="btn ghost block" data-act="clearScore">Clear this match</button>` : ''}
  </div>`;
}
function sheetHTML() {
  const sh = ui.sheet;
  if (sh.type === 'calc') return calcSheet();
  if (sh.type === 'player') return playerSheet(sh.id);
  if (sh.type === 'copy') return `<div class="ov" data-act="closeSheet"></div><div class="sheetbox" role="dialog" aria-modal="true"><div class="sh-h"><b>Copy this</b><button class="x" data-act="closeSheet" aria-label="Close">✕</button></div><div class="hint">Select all and copy, then paste into WhatsApp.</div><textarea id="copyBox" class="txt" rows="10" readonly>${esc(sh.text)}</textarea></div>`;
  if (sh.type === 'import') return `<div class="ov" data-act="closeSheet"></div><div class="sheetbox" role="dialog" aria-modal="true"><div class="sh-h"><b>Load backup</b><button class="x" data-act="closeSheet" aria-label="Close">✕</button></div><div class="hint">Paste a backup code from another device. This replaces what's on this device.</div><textarea id="importBox" class="txt" rows="8" placeholder="Paste backup code"></textarea><button class="btn pri block" data-act="doImport">Load</button></div>`;
  return scoreSheet(sh);
}

function render() {
  if (isDisplay()) {
    $('#app').innerHTML = vDisplay(); $('#sheet').innerHTML = '';
    document.body.style.overflow = '';
    return;
  }
  const v = ui.tab === 'setup' ? vSetup() : ui.tab === 'play' ? vPlay() : vStand();
  $('#app').innerHTML = `<div class="wrap">${header()}${storageOK ? '' : '<div class="banner warn">This browser is not saving data. Keep this page open until you finish.</div>'}${v}</div>`;
  $('#sheet').innerHTML = ui.sheet ? sheetHTML() : '';
  document.body.style.overflow = ui.sheet ? 'hidden' : '';
}

/* ---------------- actions ---------------- */
function addPlayer() {
  const el = $('#newName'); if (!el) return;
  const n = cleanName(el.value);
  if (!n) { el.focus(); return; }
  if (dupe(n)) { toast(`${n} is already in the list`); el.select(); return; }
  S.players.push({ id: uid(), name: n, g: ui.gender, active: true }); save(); render();
  const nn = $('#newName'); if (nn) nn.focus();
}
function setScore(v) {
  const sh = ui.sheet, m = S.rounds[sh.r].matches[sh.m], o = sh.side === 'a' ? 'b' : 'a';
  const fixed = S.setup.scoring === 'fixed';
  if (!Number.isInteger(v) || v < 0 || (fixed && v > S.setup.points) || v > 999) { toast('Not a valid score'); return; }
  m['s' + sh.side] = v;
  if (fixed) { m['s' + o] = S.setup.points - v; ui.sheet = null; }
  else ui.sheet = m['s' + o] == null ? { type: 'score', r: sh.r, m: sh.m, side: o } : null;
  save();
  const r = S.rounds[sh.r];
  if (sh.r === S.rounds.length - 1 && roundDone(r) && !ui.sheet) toast('Round complete. Tap Next round');
}
const A = {
  tab: (el) => { ui.tab = el.dataset.v; ui.confirm = null; window.scrollTo(0, 0); },
  seg: (el) => {
    const k = el.dataset.k, v = el.dataset.v;
    if (k === 'filter') ui.filter = v;
    else if (k === 'pace') ui.calc.pace = v;
    else if (k === 'mixed') S.setup.mixed = v === '1';
    else { S.setup[k] = v; if (k === 'scoring' && v === 'timed' && S.setup.bye === 'half') S.setup.bye = 'avg'; }
    save();
  },
  points: (el) => { S.setup.points = +el.dataset.v; save(); },
  roundMin: (el) => { S.setup.roundMin = +el.dataset.v; save(); },
  courts: (el) => { S.setup.courts = Math.max(1, Math.min(12, S.setup.courts + +el.dataset.v)); save(); },
  ng: (el) => { ui.gender = el.dataset.v; render(); const n = $('#newName'); if (n && n.value) n.focus(); return 'skip'; },
  add: () => { addPlayer(); return 'skip'; },
  togglePaste: () => { ui.paste = !ui.paste; },
  pasteAdd: () => {
    const box = $('#pasteBox'); if (!box) return;
    let add = 0, skip = 0;
    box.value.split(/\r?\n/).forEach((l) => {
      const r = parseLine(l, ui.gender); if (!r) return;
      if (dupe(r.name)) { skip++; return; }
      S.players.push({ id: uid(), name: r.name, g: r.g, active: true }); add++;
    });
    save(); ui.paste = !add;
    toast(`Added ${add}${skip ? `, skipped ${skip} duplicate${skip > 1 ? 's' : ''}` : ''}`);
  },
  pg: (el) => { const p = P(el.dataset.id); p.g = p.g === 'M' ? 'F' : 'M'; save(); },
  pdel: (el) => { S.players = S.players.filter((p) => p.id !== el.dataset.id); save(); },
  pact: (el) => { const p = P(el.dataset.id); p.active = !isActive(p); save(); toast(p.active ? `${p.name} is back in from next round` : `${p.name} withdrawn from next round`); },
  start: () => {
    const act = S.players.filter(isActive), m = act.filter((p) => p.g === 'M').length, f = act.length - m;
    if (!S.setup.mixed && act.length < 4) { toast('Need at least 4 players'); return; }
    if (S.setup.mixed && (m < 2 || f < 2)) { toast('Mixed needs at least 2 M and 2 F'); return; }
    S.status = 'playing';
    if (genRound()) { ui.tab = 'play'; window.scrollTo(0, 0); } else S.status = 'setup';
    save();
  },
  score: (el) => { ui.sheet = { type: 'score', r: +el.dataset.r, m: +el.dataset.m, side: el.dataset.side }; },
  pick: (el) => setScore(+el.dataset.v),
  pickOther: () => { const el = $('#otherScore'); if (el && el.value !== '') setScore(parseInt(el.value, 10)); },
  clearScore: () => { const sh = ui.sheet, m = S.rounds[sh.r].matches[sh.m]; m.sa = null; m.sb = null; ui.sheet = null; save(); },
  closeSheet: () => { ui.sheet = null; },
  openCalc: () => { ui.sheet = { type: 'calc' }; },
  calcDur: (el) => { ui.calc.dur = +el.dataset.v; },
  usePts: (el) => { S.setup.points = +el.dataset.v; save(); ui.sheet = null; toast(`Set to ${S.setup.points} points`); },
  player: (el) => { ui.sheet = { type: 'player', id: el.dataset.id }; },
  next: () => {
    if (!roundDone(S.rounds[S.rounds.length - 1])) return;
    ui.openRounds = {}; ui.confirm = null;
    if (genRound()) { window.scrollTo(0, 0); toast(`Round ${S.rounds.length} is up`); }
  },
  finish: () => {
    const cur = S.rounds[S.rounds.length - 1];
    if (cur && cur.matches.every((m) => m.sa == null && m.sb == null)) S.rounds.pop();
    S.timer = null;
    if (!S.rounds.length) { S.status = 'setup'; ui.tab = 'setup'; save(); toast('No scores yet, back to setup'); return; }
    S.status = 'finished'; ui.tab = 'standings'; save(); window.scrollTo(0, 0);
  },
  resume: () => { S.status = 'playing'; save(); },
  undo: () => {
    confirmTap('undo', () => {
      S.rounds.pop(); S.timer = null;
      if (!S.rounds.length) { S.status = 'setup'; ui.tab = 'setup'; }
      save();
    });
    return 'skip';
  },
  openR: (el) => { const i = +el.dataset.r; ui.openRounds[i] = !ui.openRounds[i]; },
  copyRound: (el) => { copyText(roundText(S, +el.dataset.r, name)); return 'skip'; },
  copyStand: () => { copyText(standText(S, standingList(), ui.filter)); return 'skip'; },
  copyBackup: () => { copyText(JSON.stringify(S), 'Backup code copied'); return 'skip'; },
  openImport: () => { ui.sheet = { type: 'import' }; },
  doImport: () => {
    const box = $('#importBox');
    try {
      const o = JSON.parse(box.value.trim());
      if (!valid(o)) throw 0;
      S = normalize(o); save(); ui.sheet = null; ui.tab = S.status === 'setup' ? 'setup' : 'play'; toast('Backup loaded');
    } catch (e) { toast('That code is not a valid backup'); }
  },
  newKeep: () => {
    confirmTap('newKeep', () => {
      const pls = S.players.map((p) => ({ ...p, active: true })); const st = { ...S.setup };
      S = defaults(pls); S.setup = st; ui.tab = 'setup'; ui.filter = 'all'; save(); toast('New tournament ready');
    });
    return 'skip';
  },
  reset: () => { confirmTap('reset', () => { S = defaults(); ui.tab = 'setup'; ui.filter = 'all'; save(); toast('Everything cleared'); }); return 'skip'; },
  // timer
  tNew: () => { const d = S.setup.roundMin * 60000; S.timer = { dur: d, end: null, left: d }; save(); },
  tToggle: () => {
    const t = S.timer; if (!t) return;
    if (t.end != null) { t.left = t.end - Date.now(); t.end = null; }
    else { t.end = Date.now() + t.left; beep.ctx || primeAudio(); }
    save();
  },
  tReset: () => { const t = S.timer; if (!t) return; t.end = null; t.left = t.dur; save(); },
  tAdj: (el) => {
    const t = S.timer; if (!t) return; const d = +el.dataset.v * 1000;
    if (t.end != null) t.end += d; else t.left = Math.max(0, t.left + d);
    save();
  },
  display: () => { location.hash = 'display'; },
  exitDisplay: () => { history.replaceState(null, '', location.pathname + location.search); render(); },
};
// iOS needs a user gesture before audio can play later.
function primeAudio() {
  try { const C = window.AudioContext || window.webkitAudioContext; if (C && !beep.ctx) { beep.ctx = new C(); beep.ctx.resume && beep.ctx.resume(); } } catch (e) {}
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const f = A[el.dataset.act]; if (!f) return;
  if (f(el) !== 'skip') render();
});
document.addEventListener('change', (e) => {
  const el = e.target, k = el.dataset && el.dataset.in; if (!k) return;
  if (k === 'name') { S.setup.name = el.value.trim().slice(0, 40) || 'Padel Night'; save(); render(); }
  else if (k === 'points') { const v = parseInt(el.value, 10); if (v >= 4 && v <= 99) S.setup.points = v; else if (el.value) toast('Points must be 4 to 99'); save(); render(); }
  else if (k === 'roundMin') { const v = parseInt(el.value, 10); if (v >= 1 && v <= 90) S.setup.roundMin = v; else if (el.value) toast('Minutes must be 1 to 90'); save(); render(); }
  else if (k === 'calcDur') { const v = parseInt(el.value, 10); if (v >= 20 && v <= 600) ui.calc.dur = v; else if (el.value) toast('Enter 20 to 600 minutes'); render(); }
  else if (k === 'pname') {
    const p = P(el.dataset.id), n = cleanName(el.value);
    if (!n) { el.value = p.name; return; }
    if (dupe(n, p.id)) { toast(`${n} is already in the list`); el.value = p.name; return; }
    p.name = n; save(); render();
  }
});
document.addEventListener('keydown', (e) => {
  const tgt = e.target;
  if (e.key === 'Escape' && ui.sheet) { ui.sheet = null; render(); return; }
  // Laptop score entry: type digits while the score sheet is open.
  if (ui.sheet && ui.sheet.type === 'score' && !(tgt && tgt.id === 'otherScore')) {
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      const nb = ((ui.sheet.buf || '') + e.key).replace(/^0+(?=\d)/, '').slice(-3);
      const fixed = S.setup.scoring === 'fixed';
      ui.sheet.buf = fixed && +nb > S.setup.points ? e.key : nb;
      render(); return;
    }
    if (e.key === 'Backspace') { e.preventDefault(); ui.sheet.buf = (ui.sheet.buf || '').slice(0, -1); render(); return; }
    if (e.key === 'Enter' && ui.sheet.buf) { e.preventDefault(); const v = +ui.sheet.buf; setScore(v); render(); return; }
  }
  if (e.key === 'Enter' && tgt.id === 'otherScore') { e.preventDefault(); A.pickOther(); render(); return; }
  if (e.key === 'Enter' && tgt.id === 'newName') { e.preventDefault(); addPlayer(); }
  else if (e.key === 'Enter' && tgt.dataset && tgt.dataset.in) tgt.blur();
});
// Keep several tabs/windows in sync (e.g. laptop controls + projector display window).
window.addEventListener('storage', (e) => {
  if (e.key !== KEY || !e.newValue) return;
  try {
    const o = JSON.parse(e.newValue);
    if (!valid(o)) return;
    S = normalize(o);
    if (ui.sheet && ui.sheet.type === 'score' && !(S.rounds[ui.sheet.r] && S.rounds[ui.sheet.r].matches[ui.sheet.m])) ui.sheet = null;
    const active = document.activeElement;
    if (active && active.tagName === 'INPUT' && !isDisplay()) return; // don't wipe what someone is typing
    render();
  } catch (err) {}
});
window.addEventListener('hashchange', render);

render();
window.__padel = { get S() { return S; }, A };

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
