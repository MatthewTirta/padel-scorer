import { describe, it, expect } from 'vitest';
import { defaults, nextRound, stats, ranked, valid, normalize, pairKey, parseLine, calcPoints, playerLog, roundDone } from '../src/engine.js';

const mk = (n, mixed = false) => {
  const S = defaults();
  for (let i = 0; i < n; i++) S.players.push({ id: 'p' + String(i).padStart(2, '0'), name: 'P' + i, g: mixed ? (i % 2 ? 'F' : 'M') : 'M', active: true });
  return S;
};
const play = (S, rounds, scorer = () => [14, 10]) => {
  for (let i = 0; i < rounds; i++) {
    const r = nextRound(S);
    expect(r.ok).toBe(true);
    r.round.matches.forEach((m) => { [m.sa, m.sb] = scorer(m, i); });
    S.rounds.push(r.round);
  }
  return S;
};
const partnerCounts = (S) => {
  const c = {};
  S.rounds.forEach((r) => r.matches.forEach((m) => [m.a, m.b].forEach((t) => { const k = pairKey(t[0], t[1]); c[k] = (c[k] || 0) + 1; })));
  return c;
};
const roundIsValid = (r, ids) => {
  const seen = new Set();
  r.matches.forEach((m) => [...m.a, ...m.b].forEach((x) => { expect(seen.has(x)).toBe(false); seen.add(x); }));
  r.byes.forEach((x) => { expect(seen.has(x)).toBe(false); seen.add(x); });
  expect(seen.size).toBe(ids.length);
};

describe('americano open', () => {
  for (const [n, courts] of [[8, 2], [12, 3], [16, 4], [4, 1]]) {
    it(`${n} players / ${courts} courts: no partner repeats across ${n - 1} rounds`, () => {
      const S = mk(n); S.setup.courts = courts;
      play(S, n - 1);
      S.rounds.forEach((r) => roundIsValid(r, S.players));
      const c = partnerCounts(S);
      expect(Object.values(c).every((v) => v === 1)).toBe(true);
      expect(Object.keys(c).length).toBe((n * (n - 1)) / 2);
    });
  }

  it('10 players / 2 courts: byes rotate evenly', () => {
    const S = mk(10); S.setup.courts = 2;
    play(S, 10);
    const b = {};
    S.rounds.forEach((r) => { expect(r.byes.length).toBe(2); roundIsValid(r, S.players); r.byes.forEach((x) => (b[x] = (b[x] || 0) + 1)); });
    expect(Object.values(b).every((v) => v === 2)).toBe(true);
  });

  it('more courts than players can fill', () => {
    const S = mk(9); S.setup.courts = 4;
    const r = nextRound(S);
    expect(r.round.matches.length).toBe(2);
    expect(r.round.byes.length).toBe(1);
  });

  it('refuses under 4 players', () => {
    expect(nextRound(mk(3)).ok).toBe(false);
  });
});

describe('mixed', () => {
  it('every team is 1 M + 1 F', () => {
    const S = mk(8, true); S.setup.mixed = true;
    play(S, 6);
    const g = Object.fromEntries(S.players.map((p) => [p.id, p.g]));
    S.rounds.forEach((r) => r.matches.forEach((m) => [m.a, m.b].forEach((t) => expect(new Set(t.map((x) => g[x])).size).toBe(2))));
  });
  it('uneven M/F sits out the extras', () => {
    const S = mk(8, true); S.setup.mixed = true;
    S.players.push({ id: 'x1', name: 'X1', g: 'M' }, { id: 'x2', name: 'X2', g: 'M' });
    const r = nextRound(S).round;
    expect(r.matches.length).toBe(2);
    expect(r.byes.length).toBe(2);
  });
  it('refuses with fewer than 2 F', () => {
    const S = mk(4); S.setup.mixed = true;
    expect(nextRound(S).ok).toBe(false);
  });
});

describe('mexicano', () => {
  it('round 2+ pairs 1+4 vs 2+3 by standings', () => {
    const S = mk(8); S.setup.format = 'mexicano';
    play(S, 1, (m) => (m.court === 1 ? [20, 4] : [13, 11]));
    const order = ranked(stats(S)).map((s) => s.id);
    const r = nextRound(S).round;
    const top4 = new Set(order.slice(0, 4));
    expect([...r.matches[0].a, ...r.matches[0].b].every((x) => top4.has(x))).toBe(true);
    const c1 = r.matches[0];
    const team1 = new Set(c1.a);
    // Rank 1 partners rank 4 unless they partnered last round
    const lastP = new Set(S.rounds[0].matches.flatMap((m) => [pairKey(...m.a), pairKey(...m.b)]));
    if (!lastP.has(pairKey(order[0], order[3]))) expect(team1.has(order[0]) && team1.has(order[3])).toBe(true);
  });
});

describe('scoring', () => {
  it('sit-out compensation: own average', () => {
    const S = mk(5); S.setup.courts = 1;
    play(S, 5, () => [16, 8]);
    const st = stats(S);
    Object.values(st).forEach((s) => {
      expect(s.byes).toBe(1);
      expect(s.total).toBeCloseTo(s.pts + (s.pts / s.mp), 1);
    });
  });
  it('sit-out compensation: half points', () => {
    const S = mk(5); S.setup.courts = 1; S.setup.bye = 'half';
    play(S, 5, () => [16, 8]);
    Object.values(stats(S)).forEach((s) => expect(s.bonus).toBe(12));
  });
  it('ranking tiebreaks on wins then diff', () => {
    const S = mk(4); S.setup.courts = 1;
    play(S, 1, () => [12, 12]);
    const r = ranked(stats(S));
    expect(r.every((s) => s.total === 12 && s.d === 1)).toBe(true);
    expect(roundDone(S.rounds[0])).toBe(true);
  });
});

describe('backup validation', () => {
  it('accepts a real state and v1 artifact codes without new fields', () => {
    const S = play(mk(8), 2);
    const old = JSON.parse(JSON.stringify(S));
    delete old.seed; delete old.timer; delete old.setup.roundMin;
    expect(valid(old)).toBe(true);
    const n = normalize(old);
    expect(n.seed).toBeTruthy();
    expect(n.setup.roundMin).toBe(12);
    expect(nextRound(n).ok).toBe(true);
  });
  it('rejects junk', () => {
    expect(valid(null)).toBe(false);
    expect(valid({ v: 1 })).toBe(false);
    expect(valid({ v: 1, setup: {}, players: [{ id: 'a', name: 'A', g: 'X' }], rounds: [] })).toBe(false);
    expect(valid({ v: 1, setup: {}, players: [], rounds: [{ matches: [{ a: ['z', 'y'], b: ['q', 'w'] }], byes: [] }] })).toBe(false);
  });
});

describe('helpers', () => {
  it('parses WhatsApp list lines', () => {
    expect(parseLine('1. Matt M')).toEqual({ name: 'Matt', g: 'M' });
    expect(parseLine('- Yolla cewek')).toEqual({ name: 'Yolla', g: 'F' });
    expect(parseLine('Sari (P)')).toEqual({ name: 'Sari', g: 'F' });
    expect(parseLine('Dimas', 'F')).toEqual({ name: 'Dimas', g: 'F' });
    expect(parseLine('   ')).toBe(null);
  });
  it('points calculator recommends a multiple of 4', () => {
    const S = mk(8);
    const d = calcPoints(S, 120, 'normal');
    expect(d.target).toBe(7);
    expect(d.rec.p % 4).toBe(0);
  });
  it('player log', () => {
    const S = play(mk(5), 5);
    const log = playerLog(S, 'p00');
    expect(log.length).toBe(5);
    expect(log.filter((x) => x.bye).length).toBe(1);
  });
});
