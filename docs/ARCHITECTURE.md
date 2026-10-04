# Architecture — RiffPlayer

## Components

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
│  Web (PWA)  │     │   Flutter   │     │ 3rd-party Subsonic│
│  React/TS   │     │ iOS+Android │     │ clients (Amperfy, │
└──────┬──────┘     └──────┬──────┘     │ Symfonium, …)     │
       │                   │            └─────────┬─────────┘
       │ custom API + Subsonic           Subsonic │
       └─────────┬─────────┴───────────────────────┘
                 ▼
        ┌───────────────────┐
        │   Server (Node)   │
        │  Fastify + TS     │
        │  ┌─────────────┐  │
        │  │ /rest  (Subsonic/OpenSubsonic)  │
        │  │ /api/v1 (custom REST)           │
        │  └─────────────┘  │
        │  Indexer · Streamer · Transcoder · Cover pipeline
        └─────────┬─────────┘
                  ▼
        SQLite  +  music files on disk  +  /covers cache
```

## API strategy (the key design)

Two namespaces sharing one database, one auth source, one set of files:

- **`/rest/*` — Subsonic / OpenSubsonic API.** Implement the core endpoints so existing clients work. Target the OpenSubsonic extensions where reasonable (e.g. transcoding negotiation, songLyrics).
- **`/api/v1/*` — RiffPlayer's own REST API.** Everything Subsonic can't express: custom playlist cover upload, advanced queue operations, recommendations, Wrapped, admin/config, multi-user management. The first-party web + Flutter clients use this *plus* the Subsonic endpoints.

Rule: a feature missing from Subsonic goes on `/api/v1`. Never fork/break Subsonic semantics.

### RiffPlayer Connect (`/api/v1/connect/*`)
Multi-device control lives entirely on the custom API, with **no schema change**: `server/src/connect/hub.ts` is an in-memory registry + relay (clock-injectable, no timers of its own), `server/src/connect/sse.ts` the safe writing side of a stream, `server/src/routes/api/connect.ts` the HTTP surface (`GET /stream` server-sent events over a Bearer-authenticated `fetch`, `GET /poll` long-poll fallback, `GET /state`, `GET /queue`, `POST /state`, `POST /command`, `POST /transfer`, `PATCH /device`). One process holds the hub (as deployed today); after a restart clients reconnect and the active device re-reports its state. See [`CONNECT-DESIGN.md`](CONNECT-DESIGN.md).

### Minimum Subsonic endpoints for Phase 1
`ping`, `getLicense`, `getMusicFolders`, `getIndexes`, `getMusicDirectory`, `getAlbumList2`, `getAlbum`, `getArtist`, `getArtists`, `getSong`, `search3`, `stream`, `download`, `getCoverArt`, `scrobble`, `star`/`unstar`, `getStarred2`, `getPlaylists`, `getPlaylist`, `createPlaylist`, `updatePlaylist`.

## Auth
- **Subsonic** (`/rest`): standard token auth — `u`, `t` (md5(password+salt)), `s`. Also support OpenSubsonic API-key auth.
- **Custom API** (`/api/v1`): issue a signed token (JWT) on login; clients send it as a Bearer header.
- One `users` table backs both. Roles: `admin`, `user`.

## Data model (SQLite — starting schema)
- `users` — id, username, password_hash, role, created_at
- `libraries` — id, name, fs_path
- `artists` — id, name, sort_name, mbid, image_path
- `albums` — id, name, artist_id, year, mbid, cover_path, created_at
- `tracks` — id, title, album_id, artist_id, disc_no, track_no, duration_s, path, size, bitrate, format, sample_rate, replaygain_track, replaygain_album, mbid, lyrics_id, added_at
- `playlists` — id, owner_id, name, cover_path (custom upload), is_public, created_at, updated_at
- `playlist_tracks` — playlist_id, track_id, position
- `favorites` — user_id, item_type ('track'|'album'|'artist'), item_id, created_at
- **`play_history`** — id, user_id, track_id, played_at, client _(populate from Phase 1; feeds counts, recently-played, recommendations, Wrapped)_
- **`external_plays`** — id, user_id, source (`spotify` / `apple_music` / `lastfm`), artist, title, album, played_at, duration_ms, track_id (nullable: set when the play matches a library song), dedupe_key _(listening history the user imports from other services so Wrapped covers the whole year, including songs not in the library; names and times only, never audio or a source; unique per user on dedupe_key so re-importing is harmless)_
- `lyrics` — id, track_id, synced_lrc (nullable), plain_text (nullable)
- `settings` — key, value (server + per-user config; donation prompt toggle, transcoding defaults, AI mode, etc.)

Derive play counts / "recently played" from `play_history` (optionally maintain a cached counter for speed).

## Indexer
Walk `libraries.fs_path`, read tags via `music-metadata`, upsert artists/albums/tracks. Detect changes via mtime/size or folder hashing. Run on startup + on a schedule + on-demand. Stream progress to the admin UI.

## Streaming & transcoding
Serve original file for `stream` by default. If the client requests a format/bitrate (OpenSubsonic params) or the admin set per-user transcoding, pipe through `ffmpeg` on the fly. Support HTTP range requests for seeking.

## Cover art pipeline
Precedence: **manual upload** > embedded art > fetched from Cover Art Archive (via MusicBrainz IDs). Cache to a `/covers` directory. Manual uploads (incl. custom playlist covers) live under `/api/v1` and are stored as files, never mutating the audio files.

## Web client
React + TS, responsive, installable PWA. Media Session API for lock-screen metadata where the browser allows. Talks to `/rest` + `/api/v1`. (Note: web is the desktop story; iOS background audio limits are why native mobile exists.)

## Mobile (Flutter)
One Dart codebase for iOS + Android. Native background playback, lock-screen / notification controls, track-skip shortcuts, offline downloads (store originals locally; respect transcoding settings). Talks to the same APIs.

## Deployment
Multi-stage Docker image; ship an example `docker-compose.yml` (mount music dir read-only, a data volume for SQLite + covers). Optional later: AUR / `.deb` / `.rpm`. Updates: document `docker compose pull`; mention Watchtower for opt-in auto-update. Never force silent updates.

## Importing listening history (Wrapped)

Users can import their own history from Spotify (Extended streaming history `.zip`/`.json`), Apple Music (privacy-export "Play Activity" CSV, also inside the nested zip Apple sends) and Last.fm (public profile, through the admin's `lastfm_api_key`). Parsing is on the server (`server/src/import/`); plays are matched to library songs on a normalised artist + title and stored in `external_plays`. A play that duplicates one already in `play_history` (e.g. a Last.fm scrobble of a RiffPlayer play, ±3 min) is not counted twice. `getWrappedStats` merges both tables; songs not in the library are returned with `external: true` and no ids/cover. Dependencies: `fflate` (server, pure-JS unzip, no native build) and `file_picker` (mobile, system file chooser for the export).

