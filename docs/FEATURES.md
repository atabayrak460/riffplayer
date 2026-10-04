# Features — RiffPlayer

Priority tiers. "Phase" maps to `ROADMAP.md`. Build MVP (Phases 0–3) first; tiers below MVP are added afterward.

## MVP (Phases 1–3) — must exist
- Library indexing from disk (tags via `music-metadata`).
- Subsonic/OpenSubsonic API (so 3rd-party clients work).
- Streaming with on-the-fly transcoding + range/seek.
- Auth (Subsonic token + custom-API bearer token).
- First-party web client: browse, search, player.
- **Queue management** (add, reorder, clear) — a headline gap in Navidrome's UX.
- Playlists with **custom cover upload**.
- Cover art (embedded → Cover Art Archive → manual override).
- **Play-history logging from Phase 1** (feeds everything later).

## Tier 1 — high value, add right after MVP
| Feature | Phase | Notes / acceptance |
|---|---|---|
| Synced lyrics | 3 | LRCLIB API; time-synced display; fall back to `.lrc` / plain. Highest value-to-effort. |
| ReplayGain / normalization | 3 | Read RG tags during indexing; apply gain in players. |
| On-the-fly transcode | 1/4 | Lower bitrate over mobile data; per-user setting. |
| Favorites + recently played + play counts | 2 | Derived from `play_history`. |
| Multi-user accounts | 4 | Each user: own playlists, favorites, history. Admin manages users. |
| Last.fm / ListenBrainz scrobbling | 4 | Opt-in; self-hosting crowd loves it. |

## Tier 2 — nice, later
Smart playlists (rule-based, auto-updating) · gapless playback + crossfade · equalizer · sleep timer · dynamic theming from album art · radio mode (station from a song/artist) · cross-device "resume where you left off" _(done as part of Connect — see below)_ · Chromecast / AirPlay.

## Tier 3 — out of scope for now (scope traps)
Podcasts / audiobooks (separate domain) · real-time collaborative playlists · social / friend activity (needs central server; breaks self-hosting) · anything sourcing external audio.

---

## Recommendation engine (Phase 6) — exact spec
- **Opt-in, default off.** Entirely the user's choice.
- **Default mode:** lightweight similar-artist/track suggestions via Last.fm / ListenBrainz.
- **Advanced mode:** admin connects a local Ollama instance; the model generates weekly suggestions from `play_history`. Runs locally, no internet, no data leaves the server.
- **Hard rule:** output is **names only** (+ optional cover art from Cover Art Archive). It must never provide a source, link, or any means to obtain the audio. How the user gets a track is their own business, outside the app.

## Year-end "Wrapped" (Phase 6) — exact spec
- ~90% statistics, not AI: top tracks/artists/albums, total minutes, top genres, listening trends — all SQL over `play_history`.
- AI's only role (advanced mode): write the personalized narrative summary ("your music personality").
- Requires a year of data → that's why play logging starts in Phase 1.

## In-app donation prompt — exact spec
- **No nag screens.** Self-hosting users abandon (and fork) naggy software.
- Always-available, quiet "Support" link in the UI (never blocks playback).
- At most an occasional gentle banner (e.g. once after ~30 days of use, or alongside Wrapped) with a permanent **"Don't show again."**
- **Admin can disable the prompt server-wide** (for family servers where end users aren't the donor).

---

## RiffPlayer Connect (multi-device control) — implemented
A user's devices register with the server, see each other, mirror what is playing and control it; only one device plays at a time (Spotify-Connect semantics). Web and Android; third-party Subsonic clients can't take part. Phase 1 scope: device list, transfer playback, remote play/pause/next/previous/seek, live "now playing" mirror, "Continue here" when the playing device disappears, resume of the last session. Phase 2: remote volume, remote queue view and editing (jump, remove, reorder, add next/at the end). Later: a desktop app; never: shared sessions between users, smart-speaker protocols, push wake-up of a closed app (needs a third-party push service). Full design, decisions and the security review: [`CONNECT-DESIGN.md`](CONNECT-DESIGN.md).
