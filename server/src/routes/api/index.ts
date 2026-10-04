import type { FastifyInstance } from 'fastify';
import { apiAuth } from './middleware.js';
import { authPlugin } from './auth.js';
import { mePlugin } from './me.js';
import { adminUsersPlugin } from './admin/users.js';
import { adminLibrariesPlugin } from './admin/libraries.js';
import { adminSettingsPlugin } from './admin/settings.js';
import { adminTracksPlugin } from './admin/tracks.js';
import { playlistsPlugin } from './playlists.js';
import { artistsPlugin } from './artists.js';
import { recommendationsPlugin } from './recommendations.js';
import { historyPlugin } from './history.js';
import { librarySidebarPlugin } from './librarySidebar.js';
import { systemViewsPlugin } from './systemViews.js';
import { connectPlugin } from './connect.js';
import { tracksPlugin } from './tracks.js';
import { sharePlugin } from './share.js';
import { radioPlugin } from './radio.js';

// ── Plugin ────────────────────────────────────────────────────────────────────
// Each area of the custom REST API lives in its own file (auth, me, admin/*,
// playlists, artists) — this just composes them under a single registration
// point. See routes/api/middleware.ts for the shared apiAuth/requireAdmin
// preHandlers every one of them uses.

export async function apiPlugin(app: FastifyInstance): Promise<void> {
  app.register(authPlugin);
  app.register(mePlugin);
  app.register(adminUsersPlugin);
  app.register(adminLibrariesPlugin);
  app.register(adminSettingsPlugin);
  app.register(adminTracksPlugin);
  app.register(playlistsPlugin);
  app.register(artistsPlugin);

  // Recommendations & Wrapped — all require auth, registered under /recommendations/*
  app.register(async (reco) => {
    reco.addHook('preHandler', apiAuth);
    reco.register(recommendationsPlugin);
  }, { prefix: '/recommendations' });

  // Track-level play history — all require auth, registered under /history/*
  app.register(async (hist) => {
    hist.addHook('preHandler', apiAuth);
    hist.register(historyPlugin);
  }, { prefix: '/history' });

  // Sidebar pin state + recency — all require auth, registered under /library-sidebar/*
  app.register(async (lib) => {
    lib.addHook('preHandler', apiAuth);
    lib.register(librarySidebarPlugin);
  }, { prefix: '/library-sidebar' });

  // RiffPlayer Connect (multi-device remote control) — all require auth, registered under /connect/*
  app.register(async (conn) => {
    conn.addHook('preHandler', apiAuth);
    conn.register(connectPlugin);
  }, { prefix: '/connect' });

  // Track details read from the file itself (credits) — all require auth, registered under /tracks/*
  app.register(async (tr) => {
    tr.addHook('preHandler', apiAuth);
    tr.register(tracksPlugin);
  }, { prefix: '/tracks' });

  // Song radio — all require auth, registered under /radio
  app.register(async (rd) => {
    rd.addHook('preHandler', apiAuth);
    rd.register(radioPlugin);
  }, { prefix: '/radio' });

  // Share pictures (song card, playlist pages), rendered on the server — all require auth, under /share/*
  app.register(async (sh) => {
    sh.addHook('preHandler', apiAuth);
    sh.register(sharePlugin);
  }, { prefix: '/share' });

  // Per-user system-view cover + description overrides — all require auth,
  // registered under /system-views/*
  app.register(async (sv) => {
    sv.addHook('preHandler', apiAuth);
    sv.register(systemViewsPlugin);
  }, { prefix: '/system-views' });
}
