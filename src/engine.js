// Pure tournament logic. No DOM. Every function takes the state object explicitly.

export const VERSION = 1;

export const uid = () => Math.random().toString(36).slice(2, 9);
export const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
export const fmt = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function defaults(players) {
  return {
    v: VERSION,
    setup: { name: 'Padel Night', format: 'americano', mixed: false, split: false, points: 24, courts: 2, scoring: 'fixed', bye: 'avg', roundMin: 12 },
    players: players || [],
    rounds: [],
    status: 'setup',
    seed: uid(),
    timer: null,
  };
}

const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const isId = (x) => typeof x === 'string' && x.length > 0;
const isScore = (x) => x == null || (Number.isInteger(x) && x >= 0 && x <= 999);

// Strict validation so a bad backup code can never crash the app.
export function valid(o) {
  if (!isObj(o) || o.v !== VERSION || !isObj(o.setup) || !Array.isArray(o.players) || !Array.isArray(o.rounds)) return false;
  if (!o.players.every((p) => isObj(p) && isId(p.id) && typeof p.name === 'string' && (p.g === 'M' || p.g === 'F'))) return false;
  const ids = new Set(o.players.map((p) => p.id));
  const team = (t) => Array.isArray(t) && t.length === 2 && t.every((id) => ids.has(id));
  return o.rounds.every(
    (r) =>
      isObj(r) &&
      Array.isArray(r.byes) &&
      r.byes.every((id) => ids.has(id)) &&
      Array.isArray(r.matches) &&
      r.matches.length > 0 &&
      r.matches.every((m) => isObj(m) && team(m.a) && team(m.b) && isScore(m.sa) && isScore(m.sb)),
  );
}

// Fill in fields added after v1 shipped, so old backup codes keep loading.
export function normalize(o) {
  const d = defaults();
  o.setup = { ...d.setup, ...o.setup };
  o.setup.points = clampInt(o.setup.points, 4, 99, 24);
  o.setup.courts = clampInt(o.setup.courts, 1, 12, 2);
  o.setup.roundMin = clampInt(o.setup.roundMin, 1, 90, 12);
  if (!['americano', 'mexicano'].includes(o.setup.format)) o.setup.format = 'americano';
  if (!['fixed', 'timed'].includes(o.setup.scoring)) o.setup.scoring = 'fixed';
  if (!['avg', 'half', 'zero'].includes(o.setup.bye)) o.setup.bye = 'avg';
  o.setup.mixed = !!o.setup.mixed;
  o.setup.split = !!o.setup.split && !o.setup.mixed;
  if (!['setup', 'playing', 'finished'].includes(o.status)) o.status = o.rounds.length ? 'playing' : 'setup';
  if (!o.seed) o.seed = uid();
  if (!isObj(o.timer)) o.timer = null;
  o.rounds.forEach((r, i) => r.matches.forEach((m, k) => { if (!m.court) m.court = k + 1; }));
  return o;
}
function clampInt(v, lo, hi, dflt) {
  v = parseInt(v, 10);
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
}

export const isActive = (p) => p.active !== false;
export const roundDone = (r) => r.matches.every((m) => m.sa != null && m.sb != null);

/* ---------------- stats ---------------- */
export function stats(S) {
  const st = {};
  S.players.forEach((p) => (st[p.id] = { id: p.id, name: p.name, g: p.g, pts: 0, mp: 0, w: 0, d: 0, l: 0, diff: 0, byes: 0, bonus: 0, total: 0 }));
  S.rounds.forEach((r) => {
    if (roundDone(r)) r.byes.forEach((id) => { if (st[id]) st[id].byes++; });
    r.matches.forEach((m) => {
      if (m.sa == null || m.sb == null) return;
      [[m.a, m.sa, m.sb], [m.b, m.sb, m.sa]].forEach(([t, f, a]) =>
        t.forEach((id) => {
          const s = st[id];
          if (!s) return;
          s.pts += f; s.mp++; s.diff += f - a;
          if (f > a) s.w++; else if (f < a) s.l++; else s.d++;
        }),
      );
    });
  });
  const mode = S.setup.bye === 'half' && S.setup.scoring !== 'fixed' ? 'avg' : S.setup.bye;
  Object.values(st).forEach((s) => {
    if (s.byes) {
      if (mode === 'avg') s.bonus = s.mp ? (s.pts / s.mp) * s.byes : 0;
      else if (mode === 'half') s.bonus = (S.setup.points / 2) * s.byes;
    }
    s.bonus = Math.round(s.bonus * 10) / 10;
    s.total = Math.round((s.pts + s.bonus) * 10) / 10;
  });
  return st;
}
export const ranked = (st) =>
  Object.values(st).sort((a, b) => b.total - a.total || b.w - a.w || b.diff - a.diff || a.name.localeCompare(b.name));

/* ---------------- history ---------------- */
export function hist(S) {
  const H = { P: {}, O: {}, B: {}, last: new Set(), lastP: new Set() };
  const n = S.rounds.length;
  S.rounds.forEach((r, i) => {
    r.byes.forEach((id) => (H.B[id] = (H.B[id] || 0) + 1));
    r.matches.forEach((m) => {
      [m.a, m.b].forEach((t) => {
        const k = pairKey(t[0], t[1]);
        H.P[k] = (H.P[k] || 0) + 1;
        if (i === n - 1) H.lastP.add(k);
      });
      m.a.forEach((x) => m.b.forEach((y) => { const k = pairKey(x, y); H.O[k] = (H.O[k] || 0) + 1; }));
    });
    if (i === n - 1) H.last = new Set(r.byes);
  });
  return H;
}
const teamCost = (t, H) => { const k = pairKey(t[0], t[1]); const p = H.P[k] || 0; return p * p * 100 + (H.lastP.has(k) ? 80 : 0); };
export function matchCost(a, b, H) {
  let c = teamCost(a, H) + teamCost(b, H);
  a.forEach((x) => b.forEach((y) => { const o = H.O[pairKey(x, y)] || 0; c += o * o * 6; }));
  return c;
}

/* ---------------- pairing ---------------- */
function pickByes(pool, n, H, rnd) {
  if (n <= 0) return [];
  return shuffle(pool, rnd)
    .sort((x, y) => (H.B[x] || 0) - (H.B[y] || 0) || (H.last.has(x) ? 1 : 0) - (H.last.has(y) ? 1 : 0))
    .slice(0, n);
}

function bestSearch(nC, H, build, tries = 4000) {
  let best = null, bc = Infinity;
  for (let t = 0; t < tries && bc > 0; t++) {
    const opts = build();
    let cost = 0;
    const ms = [];
    for (let k = 0; k < nC; k++) {
      let bo = null, boc = Infinity;
      opts[k].forEach((o) => { const c = matchCost(o[0], o[1], H); if (c < boc) { boc = c; bo = o; } });
      cost += boc; ms.push(bo);
      if (cost >= bc) break;
    }
    if (ms.length === nC && cost < bc) { bc = cost; best = ms; }
  }
  return { ms: best, cost: bc };
}

function randOpen(pl, nC, H, rnd) {
  return bestSearch(nC, H, () => {
    const s = shuffle(pl, rnd);
    const out = [];
    for (let k = 0; k < nC; k++) {
      const q = s.slice(4 * k, 4 * k + 4);
      out.push([[[q[0], q[1]], [q[2], q[3]]], [[q[0], q[2]], [q[1], q[3]]], [[q[0], q[3]], [q[1], q[2]]]]);
    }
    return out;
  });
}

// Deterministic seeded RNG (mulberry32) so the circle schedule is stable per tournament.
export function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Circle method: round r of a perfect partner rotation for an even-sized list.
function circlePairs(order, r) {
  const n = order.length, m = n - 1, rr = r % m;
  const rot = [order[0], ...order.slice(1).map((_, i) => order[1 + ((i + rr) % m)])];
  const pairs = [];
  for (let i = 0; i < n / 2; i++) pairs.push([rot[i], rot[n - 1 - i]]);
  return pairs;
}

// Americano open with everyone playing: follow a perfect rotation so nobody repeats a partner
// for n-1 rounds. Falls back to search when the roster changed or the slot was already used.
function circleOpen(S, pl, nC, H, rnd) {
  if (pl.length !== nC * 4 || pl.length < 4) return null;
  const order = shuffle(pl.slice().sort(), seeded(S.seed + '|' + pl.slice().sort().join(',')));
  for (let off = 0; off < pl.length - 1; off++) {
    const pairs = circlePairs(order, S.rounds.length + off);
    if (pairs.some((p) => H.P[pairKey(p[0], p[1])])) continue;
    // Group pairs into matches, minimising opponent repeats.
    let best = null, bc = Infinity;
    for (let t = 0; t < 600 && bc > 0; t++) {
      const sp = shuffle(pairs, rnd);
      const ms = [];
      let c = 0;
      for (let k = 0; k < nC; k++) { const m = [sp[2 * k], sp[2 * k + 1]]; c += matchCost(m[0], m[1], H); ms.push(m); }
      if (c < bc) { bc = c; best = ms; }
    }
    return best;
  }
  return null;
}

function randMixed(men, wo, nC, H, rnd) {
  return bestSearch(nC, H, () => {
    const a = shuffle(men, rnd), b = shuffle(wo, rnd);
    const out = [];
    for (let k = 0; k < nC; k++) {
      const m0 = a[2 * k], m1 = a[2 * k + 1], w0 = b[2 * k], w1 = b[2 * k + 1];
      out.push([[[m0, w0], [m1, w1]], [[m0, w1], [m1, w0]]]);
    }
    return out;
  }).ms;
}

// Mexicano: 1+4 vs 2+3 per group of four, avoiding last round's partner when possible.
function mexOpen(plR, nC, H) {
  const ms = [];
  for (let k = 0; k < nC; k++) {
    const q = plR.slice(4 * k, 4 * k + 4);
    const sp = [[[q[0], q[3]], [q[1], q[2]]], [[q[0], q[2]], [q[1], q[3]]], [[q[0], q[1]], [q[2], q[3]]]];
    ms.push(sp.find((o) => !H.lastP.has(pairKey(o[0][0], o[0][1])) && !H.lastP.has(pairKey(o[1][0], o[1][1]))) || sp[0]);
  }
  return ms;
}
function mexMixed(mR, wR, nC, H) {
  const ms = [];
  for (let k = 0; k < nC; k++) {
    const mh = mR[2 * k], ml = mR[2 * k + 1], wh = wR[2 * k], wl = wR[2 * k + 1];
    let o = [[mh, wl], [ml, wh]];
    if (H.lastP.has(pairKey(mh, wl)) || H.lastP.has(pairKey(ml, wh))) {
      if (!H.lastP.has(pairKey(mh, wh)) && !H.lastP.has(pairKey(ml, wl))) o = [[mh, wh], [ml, wl]];
    }
    ms.push(o);
  }
  return ms;
}

// Split mode: men and women play in separate pools. Hand out courts one at a time to the pool
// with the smallest share of its players on court (ties: more players waiting), so a small
// group still gets a court instead of watching the bigger one play every round.
export function splitCourts(m, f, C) {
  const cap = [Math.floor(m / 4), Math.floor(f / 4)], n = [m, f], c = [0, 0];
  for (let k = 0; k < C; k++) {
    const open = [0, 1].filter((i) => c[i] < cap[i]);
    if (!open.length) break;
    open.sort((x, y) => (4 * c[x]) / n[x] - (4 * c[y]) / n[y] || n[y] - 4 * c[y] - (n[x] - 4 * c[x]) || x - y);
    c[open[0]]++;
  }
  return c;
}

export function courtsInUse(S) {
  const act = S.players.filter(isActive), C = S.setup.courts;
  if (S.setup.split) { const m = act.filter((p) => p.g === 'M').length; const [cm, cf] = splitCourts(m, act.length - m, C); return cm + cf; }
  if (!S.setup.mixed) return Math.min(C, Math.floor(act.length / 4));
  const m = act.filter((p) => p.g === 'M').length, f = act.length - m;
  return Math.min(C, Math.floor(m / 2), Math.floor(f / 2));
}

// Returns {ok:true, round} or {ok:false, error}. Does not mutate S.
export function nextRound(S, rnd = Math.random) {
  const H = hist(S);
  const order = ranked(stats(S)).map((s) => s.id);
  const rk = (id) => order.indexOf(id);
  const act = S.players.filter(isActive);
  const C = S.setup.courts;
  const mex = S.setup.format === 'mexicano' && S.rounds.length > 0;
  let ms, byes;
  if (S.setup.split) {
    const men = act.filter((p) => p.g === 'M').map((p) => p.id), wo = act.filter((p) => p.g === 'F').map((p) => p.id);
    const cs = splitCourts(men.length, wo.length, C);
    if (!cs[0] && !cs[1]) return { ok: false, error: 'Split needs at least 4 men or 4 women active' };
    ms = []; byes = [];
    [men, wo].forEach((ids, i) => {
      const nC = cs[i];
      if (!nC) return; // fewer than 4 of this gender: nobody to play against, so not counted as a bye
      const b = pickByes(ids, ids.length - nC * 4, H, rnd);
      byes.push(...b);
      const pl = ids.filter((x) => !b.includes(x));
      if (mex) ms.push(...mexOpen(pl.sort((a, b2) => rk(a) - rk(b2)), nC, H));
      else ms.push(...((S.setup.format === 'americano' && circleOpen(S, pl, nC, H, rnd)) || randOpen(pl, nC, H, rnd).ms));
    });
  } else if (!S.setup.mixed) {
    const ids = act.map((p) => p.id);
    const nC = Math.min(C, Math.floor(ids.length / 4));
    if (nC < 1) return { ok: false, error: 'Need at least 4 active players' };
    byes = pickByes(ids, ids.length - nC * 4, H, rnd);
    const pl = ids.filter((i) => !byes.includes(i));
    if (mex) ms = mexOpen(pl.sort((a, b) => rk(a) - rk(b)), nC, H);
    else ms = (S.setup.format === 'americano' && circleOpen(S, pl, nC, H, rnd)) || randOpen(pl, nC, H, rnd).ms;
  } else {
    const men = act.filter((p) => p.g === 'M').map((p) => p.id), wo = act.filter((p) => p.g === 'F').map((p) => p.id);
    const nC = Math.min(C, Math.floor(men.length / 2), Math.floor(wo.length / 2));
    if (nC < 1) return { ok: false, error: 'Mixed needs at least 2 M and 2 F active' };
    const bm = pickByes(men, men.length - 2 * nC, H, rnd), bw = pickByes(wo, wo.length - 2 * nC, H, rnd);
    byes = bm.concat(bw);
    const pm = men.filter((i) => !bm.includes(i)), pw = wo.filter((i) => !bw.includes(i));
    ms = mex ? mexMixed(pm.sort((a, b) => rk(a) - rk(b)), pw.sort((a, b) => rk(a) - rk(b)), nC, H) : randMixed(pm, pw, nC, H, rnd);
  }
  return { ok: true, round: { matches: ms.map((t, i) => ({ court: i + 1, a: t[0], b: t[1], sa: null, sb: null })), byes } };
}

/* ---------------- planning helpers ---------------- */
export const PACE = { casual: 40, normal: 33, fast: 27 };

export function roundsTarget(S) {
  const act = S.players.filter(isActive), C = S.setup.courts, m = act.filter((p) => p.g === 'M').length, f = act.length - m, n = act.length;
  let nC = 0, target = 0, why = '';
  if (S.setup.split) {
    const cs = splitCourts(m, f, C);
    nC = cs[0] + cs[1];
    if (nC && S.setup.format === 'americano') {
      target = Math.max(...[[m, cs[0]], [f, cs[1]]].map(([k, c]) => (c ? Math.ceil((k * (k - 1)) / (c * 4)) : 0)));
      why = `${target} rounds lets every man partner every man, and every woman every woman, once`;
    }
  } else if (!S.setup.mixed) {
    nC = Math.min(C, Math.floor(n / 4));
    if (nC && S.setup.format === 'americano') { target = Math.ceil((n * (n - 1)) / (nC * 4)); why = `${target} rounds lets all ${n} players partner everyone once`; }
  } else {
    nC = Math.min(C, Math.floor(m / 2), Math.floor(f / 2));
    if (nC && S.setup.format === 'americano') { target = Math.ceil((m * f) / (2 * nC)); why = `${target} rounds lets every M partner every F once`; }
  }
  if (!target) { target = 6; why = !nC ? 'Add players first for an exact target. Using 6 rounds as a default' : 'Mexicano needs about 5 to 7 rounds for the standings to sort out'; }
  if (target > 12) { target = 12; why += ' (capped at 12 rounds, a full rotation will not fit in one session)'; }
  return { target, why, nC, n };
}

export function calcPoints(S, dur, pace) {
  const { target, why, nC, n } = roundsTarget(S);
  const sec = PACE[pace] || 33;
  const opts = [16, 21, 24, 32].map((p) => { const per = (p * sec) / 60 + 2; return { p, per, rounds: Math.floor(dur / per) }; });
  const fit = opts.filter((o) => o.p % 4 === 0 && o.rounds >= target);
  const rec = fit.length ? fit[fit.length - 1] : opts[0];
  return { opts, rec, short: !fit.length, target, why, nC, n };
}

/* ---------------- player history ---------------- */
export function playerLog(S, id) {
  const out = [];
  S.rounds.forEach((r, i) => {
    if (r.byes.includes(id)) { out.push({ round: i + 1, bye: true }); return; }
    r.matches.forEach((m) => {
      const side = m.a.includes(id) ? 'a' : m.b.includes(id) ? 'b' : null;
      if (!side) return;
      const mine = side === 'a' ? m.a : m.b, opp = side === 'a' ? m.b : m.a;
      const f = side === 'a' ? m.sa : m.sb, ag = side === 'a' ? m.sb : m.sa;
      out.push({ round: i + 1, court: m.court, partner: mine.find((x) => x !== id), opp, f, ag });
    });
  });
  return out;
}

/* ---------------- text exports ---------------- */
export function roundText(S, i, name) {
  const r = S.rounds[i];
  const nm = (t) => t.map(name).join(' & ');
  let t = `🎾 ${S.setup.name} · Round ${i + 1}\n`;
  r.matches.forEach((m) => { t += `Court ${m.court}: ${nm(m.a)}${m.sa != null && m.sb != null ? `  ${m.sa}–${m.sb}  ` : ' vs '}${nm(m.b)}\n`; });
  if (r.byes.length) t += `Sitting out: ${r.byes.map(name).join(', ')}\n`;
  return t.trim();
}
export function standText(S, list, filter) {
  const nd = S.rounds.filter(roundDone).length;
  const lbl = filter === 'M' ? ' (Men)' : filter === 'F' ? ' (Women)' : '';
  let t = `🏆 ${S.setup.name}${lbl} · ${S.status === 'finished' ? 'Final standings' : `Standings after round ${nd}`}\n`;
  list.forEach((s, i) => { t += `${i + 1}. ${s.name} · ${fmt(s.total)} pts${s.mp ? ` (${s.w}W ${s.l}L)` : ''}\n`; });
  return t.trim();
}

/* ---------------- list paste ---------------- */
export const cleanName = (s) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 24);
export function parseLine(l, dfltG = 'M') {
  l = l.replace(/^\s*(\d+\s*[.)]\s*|[-•*]\s*)/, '').trim();
  if (!l) return null;
  const m = l.match(/^(.*?)[\s,;/\-(]+(m|f|l|p|male|female|cowo|cowok|cewe|cewek|man|woman|pria|wanita)\)?\s*$/i);
  let name = l, g = dfltG;
  if (m && m[1].trim()) {
    name = m[1];
    const t = m[2].toLowerCase();
    g = ['f', 'p', 'female', 'cewe', 'cewek', 'woman', 'wanita'].includes(t) ? 'F' : 'M';
  }
  name = cleanName(name);
  return name ? { name, g } : null;
}
