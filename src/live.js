// Live sharing: the organizer's device publishes the tournament to Supabase, spectators poll it.
// Writes go through the live_publish RPC, which only accepts the token that created the code.
// The publishable key is public by design; the table itself is not readable or writable with it.

const API = 'https://jpofcdkinzxogagybbhi.supabase.co/rest/v1/rpc/';
const KEY = 'sb_publishable_76i5xvnGNyckUrIPenIBPw_Yd94zsQq';
const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789'; // no l/o/0/1, easy to read out loud

export const CODE_RE = /^[a-z0-9]{6,16}$/;

function rand(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, (x) => ALPHA[x % ALPHA.length]).join('');
}

async function rpc(fn, body) {
  const r = await fetch(API + fn, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const txt = await r.text();
  if (!r.ok) {
    let msg = txt;
    try { msg = JSON.parse(txt).message || txt; } catch (e) {}
    throw new Error(msg || 'HTTP ' + r.status);
  }
  return txt ? JSON.parse(txt) : null;
}

export const newLive = () => ({ code: rand(8), token: rand(32) });

// What spectators get: everything needed to render, minus the publishing secret.
export function publicState(S) {
  const { live, seed, ...rest } = S;
  return rest;
}

export const publish = (live, S) => rpc('live_publish', { p_code: live.code, p_token: live.token, p_state: publicState(S) });
export const fetchLive = (code, since) => rpc('live_get', { p_code: code, p_since: since || null });
export const stopLive = (live) => rpc('live_stop', { p_code: live.code, p_token: live.token });
export const liveUrl = (code) => `${location.origin}/?live=${code}`;

export function liveCodeFromUrl() {
  const c = (new URLSearchParams(location.search).get('live') || '').trim().toLowerCase();
  return CODE_RE.test(c) ? c : null;
}
