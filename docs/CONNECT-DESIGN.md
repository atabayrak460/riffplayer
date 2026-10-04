# RiffPlayer Connect — Phase 1 design

> **Approved by the owner 2026-10-03.** Status: **Phase 1 implemented (v0.2.0); Phase 2 implemented (§16)** — server (`server/src/connect/`,
> `server/src/routes/api/connect.ts`), web (`web/src/store/connect.ts`), Android (`mobile/lib/connect/`), security
> review done (§15). Scope decisions are in §1 and §14.

A "Spotify Connect"-style feature: several of one user's devices (web tab, Android app, later a
desktop app) see each other, show what is playing, and can **control** it and **hand playback over**
from one to another. Audio is only ever played by one device; the others are remotes.

---

## 1. Decisions already made

| # | Decision | Source |
|---|---|---|
| D1 | Only one device plays at a time (Spotify semantics). Starting playback elsewhere silences the previous one. | owner |
| D2 | A user only sees and controls **their own** devices. | owner |
| D3 | Works between **RiffPlayer's own clients** only (web, Android, later desktop). Third-party Subsonic clients can't take part. | owner |
| D4 | If the playing device disappears, a controller says "X unreachable" and offers **"Continue here"** (queue + last position move to the controller). | owner |
| D5 | No push notifications (no FCM): a phone whose app is fully closed can't be woken. Optional opt-in UnifiedPush may come much later. | principle 4, owner |
| D6 | A desktop app (Windows/macOS/Linux) is a **separate later phase**; a browser tab is a valid device until then. | owner |
| D7 | The live server is `https://riffplayer.bayrakmail.com`, behind **Cloudflare**. The design must work through it. | owner |

## 2. Scope

**In (Phase 1):** device list · transfer playback · remote play/pause/next/previous/seek · live
"now playing" mirrored on every device · controller doesn't play audio · resume last session.

**Phase 2 (built, §16):** remote volume · remote queue view/edit.

**Out, deliberately:** Jam / shared sessions between users, smart-speaker / Bluetooth hardware
protocols, synchronized multi-device playback, push wake-up of a closed app.

## 3. Constraints that shaped the design

1. **Auth is header-only.** `/api/v1` accepts `Authorization: Bearer <jwt>` (or Subsonic params).
   Browser `EventSource` and `WebSocket` cannot send headers, and putting a JWT in a URL leaks it
   into proxy/Cloudflare logs. → use `fetch()` streaming (can send headers) instead of `EventSource`.
2. **No new dependencies if avoidable.** `@fastify/websocket` would be a new server dependency and
   a new proxy concern; Server-Sent Events need none (a raw streaming reply).
3. **Cloudflare** proxies HTTP streams but may close or buffer idle/compressed ones. → heartbeat
   every 20 s, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, no compression on the stream.
   The idle behaviour must be **verified through the real domain**, not assumed (§11).
   *2026-10-03 finding:* a first probe through a Cloudflare **quick tunnel** delivered the response headers
   but no body chunks — that is a documented limitation of quick tunnels ("Quick Tunnels do not support
   Server-Sent Events"), so it says nothing about the real, proxied domain. Public reports say a proxied
   zone passes SSE if the origin answers within ~100 s and sends `X-Accel-Buffering: no`, but that some
   setups still buffer small chunks — hence the long-poll fallback in §5.1.
4. **CLAUDE.md:** schema changes after Phase 1 need the owner's OK, and Subsonic compatibility is a
   hard baseline. → **no database schema change** and **everything under `/api/v1`**; `/rest` is untouched.
5. **Mobile has no master volume control** (see `audio_handler.dart`), so volume stays out of Phase 1.
6. **Scrobbling must not double-count.** Only the device that actually plays logs plays.

## 4. Concepts

- **Device** — one running client instance: `{ deviceId, name, type: web|android|desktop }`.
  `deviceId` is a random UUID persisted on the device (localStorage / shared prefs). `name` is
  user-editable (default e.g. "Web · Firefox on Linux", "Pixel 8").
- **Active device** — the one device that holds the audio element/player right now. At most one.
- **Controller** — any other connected device; mirrors state and sends commands.
- **Session state** — what the active device reports: queue (ids), index, position, playing, repeat, shuffle.

## 5. Architecture

```
 Web tab ──┐                                   ┌── Web tab
 Android ──┼── fetch stream (SSE) ◀── events ──┤        (one per device)
 Desktop ──┘        │                           └
                    ▼
            Cloudflare (proxy)
                    ▼
        Fastify  /api/v1/connect/*
        ┌─────────────────────────────────────────┐
        │  ConnectHub (in memory, keyed by userId)│
        │   devices · activeDeviceId · state      │
        └─────────────────────────────────────────┘
        POST commands / state ◀── from clients
```

- **Server = relay + small in-memory registry.** No database table. A device registry and a "latest
  state" are cheap to rebuild: after a server restart every client reconnects within seconds and
  the active device re-reports its state.
- **Single process assumption.** The hub is in-process memory, which matches how RiffPlayer is
  deployed (one container). Documented; scaling out would need a shared bus (out of scope).
- **Persistence for resume** uses the **existing** `play_queue` table through the existing Subsonic
  `savePlayQueue`/`getPlayQueue` endpoints (no schema change).

### 5.1 Transport: SSE over `fetch`, commands over POST

- Down channel: `GET /api/v1/connect/stream` — `Content-Type: text/event-stream`, kept open.
  Client uses `fetch()` + `ReadableStream` (web) / `http.Client.send` streamed response (Dart) so it can send `Authorization`.
- Up channel: ordinary `POST`s. Simple, stateless, easy to rate-limit, works through any proxy.
- On (re)connect the server sends a **full snapshot** first, so there is no event replay / `Last-Event-ID` logic.
- Reconnect with exponential backoff 1 s → 30 s (+ jitter); also reconnect on tab becoming visible / network back.
- **Long-poll fallback (buffering-proof).** If, after connecting, a client does not receive the `hello`
  event within ~8 s, or receives nothing for ~45 s although heartbeats are due, it assumes something in
  the path buffers streams and switches to `GET /connect/poll?since=<seq>`: the server holds the request
  up to 25 s and answers as soon as there is an event (each event carries an incrementing `seq` per user).
  Slightly higher latency, works through any proxy. The client remembers the choice for the session and
  retries the stream on the next app start.

## 6. HTTP API (all under `/api/v1/connect`, all `apiAuth`)

| Method & path | Who | Purpose |
|---|---|---|
| `GET /stream?deviceId&name&type` | any device | Registers the device and opens the event stream. Closing the stream = device offline. |
| `GET /poll?deviceId&since` | any device | Long-poll fallback for `/stream` (§5.1): holds up to 25 s, returns events with `seq > since`. |
| `POST /state` | active device | Reports session state (see §6.2). |
| `POST /command` | controller | `{ commandId, type, positionMs? }` for `play|pause|next|previous|seek`. Forwarded to the active device. `202`, or `409 no_active_device`. |
| `POST /transfer` | any device | `{ toDeviceId, play }`. See §7. |
| `GET /queue` | any device | Full songs of the current queue (resolved server-side from ids). Used on transfer / continue-here. |
| `PATCH /device` | any device | Rename the calling device (`deviceId`, `name`). |

Query/body `deviceId` is **always checked to belong to the authenticated user's hub**; a command can
never reach another user's device (D2).

### 6.1 Events down the stream

| Event | Payload | When |
|---|---|---|
| `hello` | `{ serverTimeMs, you: deviceId }` | first message; lets clients compute clock offset |
| `snapshot` | `{ devices, activeDeviceId, state }` | right after `hello`, and after any reconnect |
| `devices` | `{ devices, activeDeviceId }` | a device joined/left/was renamed/became active |
| `state` | see below | the active device reported a change |
| `command` | `{ commandId, type, positionMs? }` | **only to the active device** |
| `load` | `{ queueVersion, index, positionMs, play }` | **only to the transfer target**; it then calls `GET /queue` |
| `revoked` | `{}` | the user's token was revoked (password changed) — stream closes |
| `: ping` | comment line | every 20 s heartbeat (also re-validates the token) |

### 6.2 Session state (what a controller shows)

```jsonc
{
  "activeDeviceId": "…",
  "playing": true,
  "song": { /* normal Song JSON, resolved server-side */ },
  "index": 3,
  "queueLength": 25,
  "queueVersion": 7,            // bumps only when the queue itself changes
  "positionMs": 83123,          // position at `positionAtMs`
  "positionAtMs": 1790975000000,// SERVER clock; controllers extrapolate while playing
  "repeat": "off|all|one",
  "shuffle": false
}
```

The active device uploads `{ queueIds?, index, positionMs, playing, repeat, shuffle }`:
`queueIds` only when the queue changed (keeps normal updates tiny); position is **not** sent every
second — controllers interpolate from `positionMs`/`positionAtMs`, and the active device re-reports
on play/pause/seek/track change and as a drift correction every ~10 s.

## 7. Flows

**Transfer (controller → another device):**
1. Controller `POST /transfer {toDeviceId}`.
2. Server asks the current active device (A) to stop: `command: pause` + marks it "yielding".
3. A posts its final state (position). If A doesn't answer within ~1.5 s, the server **extrapolates
   from the last known state** instead of waiting.
4. Server sets `activeDeviceId = B` and sends B `load`; B fetches `GET /queue`, loads the queue,
   seeks to `positionMs`, plays if `play`. Then B's state reports make it the source of truth.
5. A, now a controller, flips its UI into mirror mode.

**Start playing locally while another device is active (D1):** the device's first `state` with
`playing:true` makes it active; the server sends the previous active device `pause`.

**Active device vanishes (D4):** stream closes → 20 s grace (page reload, tunnel blip) → then
`devices` shows it `unreachable` and `state` keeps the last position frozen. A controller shows
**"X unreachable — Continue here"**: it `POST /transfer {toDeviceId: self}`; the server hands over the
last known queue/position (extrapolated only if the device was playing less than ~20 s ago, else frozen).

**Resume (feature 8):** every device calls `savePlayQueue` (existing endpoint) on pause/track change
and every ~15 s while playing. On start, if nothing is active and a saved queue exists, the UI offers
"Resume where you left off".

## 8. Client design

### Web (`web/src`)
- New `store/connect.ts` (zustand): `deviceId`, `deviceName`, `devices`, `activeDeviceId`,
  `remoteState`, `status` (connecting/online/offline); owns the stream and reconnect logic.
- **Mirror mode without touching every component:** `store/player.ts` already holds `currentSong`,
  `playing`, `currentTime`, `duration`. When this device is a controller, the connect layer writes
  the remote values into those same fields and `togglePlay/next/prev/seek` forward as commands instead
  of driving the local `<audio>`. So `PlayerBar` etc. keep working unchanged.
- Local audio events must not overwrite mirrored values while in remote mode (explicit `mode` flag).
- UI: a speaker icon in `PlayerBar` → popover listing "This device", other devices (active one marked,
  unreachable ones greyed), pick one = `transfer`. A small "Playing on <name>" line when remote.
- Keeps the device name editable in Settings.

### Android (`mobile/lib`)
- `ConnectService` (Riverpod) with the same stream/reconnect logic over a streamed `http` response;
  `deviceId` in shared prefs.
- Mirrors into `PlayerNotifier` the same way; remote `command`s call the existing `play/pause/next/previous/seek`.
- **Battery:** stays connected while playing (the audio foreground service already keeps the process
  alive) and while the app is in the foreground; after ~3 min paused in the background it disconnects
  and shows as offline. Reconnects on resume.
- Remote scrobbling off: a controller never calls `scrobble`.

### Scrobbling / play history
Only the active device scrobbles. On transfer the payload carries `alreadyCounted` so the new device
doesn't count the current track a second time (server-side `logPlay` also dedupes within one track length).

## 9. Security & abuse

- Per-user isolation: hub keyed by `userId`; every `deviceId`/`toDeviceId` verified inside that hub.
- Same auth as the rest of `/api/v1`; token (header only) **re-validated on every heartbeat**, so a password
  change (`token_version`) closes streams (`revoked`).
- Limits: ≤ 10 devices and ≤ 12 open streams per user; device name ≤ 40 chars, stripped of control chars;
  JSON body ≤ 256 KB; `queueIds` ≤ 5000; `@fastify/rate-limit` on `/command` and `/state`.
- Commands carry a `commandId` (idempotent) and expire after ~5 s, so a delayed command can't fire later.
- No telemetry, no third parties; nothing leaves the user's own server (principle 4).

## 10. Edge cases

| Case | Behaviour |
|---|---|
| Two devices press play at nearly the same time | Last `state` with `playing:true` wins; the other receives `pause`. |
| Seek storm (dragging a slider) | Controller debounces ~150 ms; active device applies the latest. |
| Clock skew | All positions use the **server clock** (`serverTimeMs` from `hello`), never the device clock. |
| Server restarts | Streams drop, clients reconnect, the active device re-posts its state; controllers show "reconnecting" meanwhile. |
| Web tab is the player, hidden & paused | The browser may freeze it → it looks unreachable. Playing tabs aren't frozen. Solved properly by the desktop app (D6). |
| Active device is on downloaded/offline tracks only | Works the same; a controller just shows state. |
| Controller loses network | Shows "offline"; commands are not queued; reconnect re-syncs from snapshot. |
| Track not in the library any more | `GET /queue` skips unknown ids; index is clamped. |
| Reverse proxy buffers the stream | Documented nginx/Caddy settings in README (`proxy_buffering off`, long `proxy_read_timeout`). |

## 11. Test plan

- **Server (vitest):** hub unit tests (join/leave, active election, grace period, transfer incl. the
  unresponsive-device path, command routing, per-user isolation, limits, revoked token); integration
  tests on a real listening Fastify instance consuming the stream with `fetch`.
- **Web:** store tests with a fake stream (mirror mode doesn't drive local audio; commands forwarded;
  reconnect/backoff; remote values override local events); component tests for the device picker.
- **Mobile:** `ConnectService` tests with a fake streamed response; `PlayerNotifier` remote-mode tests.
- **Manual, through the real domain:** (a) two browser tabs, (b) phone + PC, (c) **idle the stream for
  ≥ 5 minutes through Cloudflare** to confirm the 20 s heartbeat keeps it alive, (d) PC sleep → "Continue here".
- Mutation-check the important behaviours as in earlier work (transfer, isolation, revoke, grace period).

## 12. Delivery plan (each step shippable, commits pushed as we go)

| Step | Content |
|---|---|
| **P1a** ✔ | Server: `ConnectHub`, `/connect/*` endpoints, tests. |
| **P1b** ✔ | Web: `connect` store, mirror mode, device picker, tests. |
| **P1c** ✔ | Android: `ConnectNotifier`, mirror/remote mode, tests. |
| **P1d** ✔ | Resume (`savePlayQueue`/`getPlayQueue` wiring on both clients). |
| **P1e** ✔ | Docs (README + proxy notes), release `v0.2.0`. Real-domain verification of long-lived streams happens on the live server after the release. |

Because old clients ignore the new endpoints, every step is backward compatible with Subsonic clients
and with already-installed apps.

## 13. Risks / open points

1. **Cloudflare behaviour for long streams** is the biggest unknown. A quick-tunnel probe was
   inconclusive (unsupported there). Mitigations: heartbeat 20 s (< the ~100 s limit), anti-buffering
   headers, and the long-poll fallback (§5.1) so the feature works even if streams are buffered. Real-domain
   verification options: (a) a **named** Cloudflare tunnel on a throwaway hostname (needs the owner's
   Cloudflare login), or (b) verify on the real server once P1a is deployed there.
2. **Backgrounded Android** may still be throttled by OEM battery managers → documented; offline/online
   state makes it visible rather than silent.
3. **Browser tab freezing** limits the "PC as a remote target" story until the desktop app exists.
4. In-memory hub = single process (fine today).

## 14. Owner answers (2026-10-03)

1. Device names: default "Web · \<browser\> on \<OS\>" / phone model, editable in Settings — **approved**.
2. Starting playback on a device **automatically takes over** from the active one (Spotify behaviour) — **approved**.
3. Release naming: owner asked for a recommendation → **recommended `v0.2.0`**, cut once, after P1a–P1e are
   done and verified (no intermediate releases). Clients must treat a `404` from `/connect/*` (older server)
   as "feature unavailable" and simply hide the device picker, so a new app on an old server never breaks.

## 15. Security review (2026-10-03)

The hub, the routes and both clients were reviewed from an attacker's point of view; every finding has a regression
test that fails without its fix (mutation-checked).

| Area | Finding | Fix |
|---|---|---|
| Revocation | A stale connection's heartbeat revoked **all** of the user's streams, including ones opened after a password change. | Per-connection revocation (`revokeConnection`). |
| Revocation | A revoked stream kept receiving events until its next heartbeat (≤ 20 s). | Before every delivery (≤ once a second) the stream re-validates its token and then gets only `revoked`. |
| Wrong device | Commands went to "whoever plays when the request arrives"; a takeover in between made a "next" land on the wrong device. | Commands carry `targetDeviceId`; the server answers `409 target_changed`; both clients pass the device they saw playing and say so. |
| Dedupe | System command ids (`takeover-n`, `transfer-n`) came from a counter that restarts with the server, so a client's dedupe silently dropped the new "pause". | Random ids. |
| DoS | Full-queue read (up to 5000 lookups), renaming and (re)connecting were unthrottled; the latter two are broadcast to every device. 1 MB bodies on tiny endpoints; a client that never reads its stream grew server memory. | Per-user rate limits, 8 KB limit on small POSTs, backpressure limit (~1 MB) that drops a non-reading client, refused streams get a real HTTP 429. |
| Robustness | Write-after-end / socket errors could become uncaught exceptions; a request whose socket was already gone left a device registered; a long-poll client whose registration timed out never saw an event again; held polls could pile up. | `connect/sse.ts` (guarded writes, error listener, cleanup that also runs for an already-gone socket), re-registration restarts at seq 0, one held poll per device. |
| Input | Bidirectional-text controls in device names could disguise one device as another; absurd positions. | Stripped; positions capped at 7 days. |
| Isolation, authentication | Cross-user commands/transfers, forged or deleted-user tokens, wrong Subsonic credentials, hostile names injecting SSE fields. | Verified by tests; no defect found. |

Known and accepted: a user's own devices are trusted with each other (any of them can take over playback with its own
queue); song JSON in the state includes the server file path (same as other endpoints); a browser tab that plays music
must stay open (frozen background tabs look unreachable until the desktop app exists).


## 16. Phase 2 — remote volume and remote queue (2026-10-04)

Scope decisions (owner, 2026-10-04): Android volume is the **app's own player volume** (no new dependency, the phone's
hardware volume keys stay separate); queue support is **view + basic editing** (show, jump to a song, remove, reorder,
add as "next" / at the end, from another device too); released together as **v0.3.0**. No schema change; everything is
under `/api/v1/connect`, old clients ignore the new commands.

### Protocol additions

| Where | Addition |
|---|---|
| `POST /state` | `volume` (0..1, default 1) — the playing device's own player volume. Part of the public `state`. |
| `POST /command` types | `volume {volume}`, `queue_play {index, songId}`, `queue_remove {index, songId}`, `queue_move {index, to, songId}`, `queue_add {mode: next\|end, songIds[≤100]}` |
| `command` event | the same fields; a `queue_add` carries the **resolved `songs`** (not ids), unknown ids already dropped (all unknown → `400`) |
| `GET /queue` | also returns `positions[]`: the real queue position of each returned song |

* **The queue commands name the song they were aimed at (`songId`).** The playing device ignores a command whose
  `queue[index]` isn't that song, so an edit made against a stale view can never hit the wrong track.
* **Queue edits address real positions.** The library may have dropped ids from the queue (a deleted track), so the
  controller's list can be shorter than the real queue; `positions` maps one to the other.
* The playing device applies an edit and reports its new queue as usual → `queueVersion` bumps → controllers refetch.
* **Removing the song that is playing is refused** (it would stop the music); the UIs don't offer it.
* Each device keeps its own queue semantics: on the web a block "next" is inserted directly after the current song; on
  Android "Add to queue" means "after the current song and after what was queued before" and `queue_play` also drops
  what came before (the phone's own Up Next model).

### Controller side (web and Android alike)

* **Volume.** While another device plays, the volume slider (and the web's keyboard shortcuts and mute) shows and drives
  *that* device's volume; this device's own is untouched. The slider moves at once, the device hears it at most every
  150 ms plus the final value, and for 1.5 s after the user's last move state reports about the old value are ignored
  so the slider never jumps back. Android: a slider in the device picker.
* **Queue view.** `remoteQueue` is fetched only while a screen watches it (the Queue page), refetched when the device's
  `queueVersion` changes, and the highlighted song follows the device's `index` without a fetch. Edits are shown at
  once (optimistic) and then replaced by the device's report. A failing server is asked once per state event, never in a
  loop.
* **Adding.** "Play next" / "Add to queue" on a controller go to the playing device instead of the controller's own
  (empty) queue; songs added in quick succession (an album) travel as one command, in listening order; confirmation is
  a toast/snackbar only when the command was delivered.

### Player side

* `volume` is the user's volume times the track's ReplayGain (Android's handler used to overwrite any volume with the
  gain alone). Session-only on Android: a restart is back at full volume rather than silently quiet.
* Commands are validated before they touch the queue (type, bounds, `songId` match) and malformed fields are treated as
  absent — a bad command must never throw into the event stream.

### Tests

Server: parsing, relay, resolved songs, `positions`, `no_valid_songs`, route-level; web: store (volume throttle/hold,
queue fetch/follow/edit, batching, execution guards), `remoteQueue` helpers, `PlayerBar`, `QueuePage`; Android: models,
API, notifier (same cases as web), `RemoteQueueView`, queue screen, device picker, player notifier. Key behaviours
mutation-checked.
