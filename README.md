# Padel Scorer

Americano and Mexicano padel tournament scorer. Works on phone and laptop, installable as an app, works offline.

## Features

- **Americano**: partners rotate so everyone plays with everyone. With no one sitting out, follows a perfect rotation (no repeated partner for n−1 rounds).
- **Mexicano**: round 1 random, then 1+4 vs 2+3 by standings per court, avoids last round's partner.
- **Open, Mixed** (1 M + 1 F per team) **or Split** (men only play men, women only play women, separate standings; courts shared fairly between the two sides).
- **Fixed points** (enter one side, the other fills in) or **timed** rounds with a countdown and beep.
- Fair sit-outs for uneven numbers, with compensation (own average, half points, or none).
- Points calculator from booking time.
- Paste a player list straight from WhatsApp (`Matt M`, `Sari cewek`, `Budi L`, `Rina P`).
- Standings with Men/Women filter, player detail (partners, match log), podium at the end.
- **Live link** (`/?live=CODE`): tap Share in the round card, send the link, everyone follows scores and standings on their own phone. View only, refreshes every ~4s. Stored in Supabase (`padel-scorer` project, table `padel_live`, written only through the token-checked `live_publish` RPC). Links unused for 30 days are cleaned up.
- **Display mode** (`/#display`) for a TV or projector. Syncs live with the controlling tab on the same laptop.
- Laptop: type scores on the keyboard, Enter to save, Esc to close.
- Copy rounds and standings as WhatsApp text. Backup code to move a tournament between devices.
- Data stays in the browser (localStorage). No account. The only server use is the optional live link.

## Develop

```bash
npm install
npm run dev
```

## Test

```bash
npm test                      # engine unit tests (pairing, scoring, validation)
npm run build && npx vite preview --port 4173 &
npm run e2e                   # Playwright smoke test on iPhone and 1440px laptop viewports
```

## Deploy

Vercel, Vite preset. Build `npm run build`, output `dist`. Every push to `main` deploys.
