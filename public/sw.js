/* eslint-disable no-undef */
/**
 * Service Worker for the Pre-Flight Briefing PWA.
 *
 * Strategy:
 *   - App shell (HTML/JS/CSS): StaleWhileRevalidate so the UI loads instantly
 *     and updates in the background.
 *   - OSM map tiles: CacheFirst with a bounded expiring cache. Tiles along the
 *     route corridor are explicitly pre-cached on demand (PRECACHE_TILES msg).
 *   - Aviation API calls (/api/*): NetworkFirst with a short timeout so we get
 *     fresh data online but fall back to the last good response offline.
 *   - The finalized briefing JSON is persisted to IndexedDB (store: "briefings")
 *     via a postMessage from the page (STORE_BRIEFING msg), independent of HTTP
 *     caching, so the full briefing is viewable with no network at all.
 *
 * Workbox is loaded from the official CDN. In a production build you would
 * instead bundle it (e.g. workbox-webpack-plugin / next-pwa) and inject a
 * precache manifest. The runtime routing below is build-tool agnostic.
 */

importScripts(
  "https://storage.googleapis.com/workbox-cdn/releases/7.0.0/workbox-sw.js"
);

const TILE_CACHE = "osm-tiles-v1";
const SHELL_CACHE = "app-shell-v1";
const API_CACHE = "aviation-api-v1";

const IDB_NAME = "preflight-briefings";
const IDB_VERSION = 1;
const IDB_STORE = "briefings";

self.skipWaiting();
workbox.core.clientsClaim();

/* -------------------------------------------------------------------------- */
/* Caching routes                                                             */
/* -------------------------------------------------------------------------- */

// Page navigations (HTML): NetworkFirst so online users always get the latest
// UI, with a fast timeout that falls back to the cached shell when offline.
workbox.routing.registerRoute(
  ({ request }) => request.mode === "navigate",
  new workbox.strategies.NetworkFirst({
    cacheName: SHELL_CACHE,
    networkTimeoutSeconds: 4,
    plugins: [
      new workbox.cacheableResponse.CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

// Hashed static assets (JS/CSS/workers) are immutable per build → cache-first
// via StaleWhileRevalidate is safe and fast.
workbox.routing.registerRoute(
  ({ request }) =>
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "worker",
  new workbox.strategies.StaleWhileRevalidate({ cacheName: SHELL_CACHE })
);

// Raster basemap tiles (CARTO dark + OSM fallback).
workbox.routing.registerRoute(
  ({ url }) =>
    /basemaps\.cartocdn\.com/.test(url.hostname) ||
    /tile\.openstreetmap\.org/.test(url.hostname),
  new workbox.strategies.CacheFirst({
    cacheName: TILE_CACHE,
    plugins: [
      new workbox.cacheableResponse.CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new workbox.expiration.ExpirationPlugin({
        maxEntries: 6000,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// Aviation data API (our own BFF). Fresh when possible, cached when not.
workbox.routing.registerRoute(
  ({ url }) => url.pathname.startsWith("/api/"),
  new workbox.strategies.NetworkFirst({
    cacheName: API_CACHE,
    networkTimeoutSeconds: 6,
    plugins: [
      new workbox.cacheableResponse.CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new workbox.expiration.ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 6 * 60 * 60, // 6 hours
      }),
    ],
  })
);

/* -------------------------------------------------------------------------- */
/* IndexedDB helpers (no external deps; usable inside the worker)             */
/* -------------------------------------------------------------------------- */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putBriefing(briefing) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(briefing);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/* -------------------------------------------------------------------------- */
/* Corridor tile pre-caching                                                  */
/* -------------------------------------------------------------------------- */

async function precacheTiles(urls) {
  const cache = await caches.open(TILE_CACHE);
  // Fetch sequentially-ish in small batches to be polite to the tile server.
  const BATCH = 12;
  for (let i = 0; i < urls.length; i += BATCH) {
    const slice = urls.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (url) => {
        try {
          const existing = await cache.match(url);
          if (existing) return;
          const res = await fetch(url, { mode: "no-cors" });
          await cache.put(url, res.clone());
        } catch {
          /* a missing tile must not abort the whole pre-cache */
        }
      })
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Message bridge from the page                                               */
/* -------------------------------------------------------------------------- */

self.addEventListener("message", (event) => {
  const { type, payload } = event.data || {};
  if (!type) return;

  switch (type) {
    case "STORE_BRIEFING":
      event.waitUntil(
        putBriefing(payload).then(() =>
          event.source?.postMessage({
            type: "BRIEFING_STORED",
            id: payload?.id,
          })
        )
      );
      break;

    case "PRECACHE_TILES":
      // payload: string[] of tile URLs (built by geoUtils.tilesForCorridor).
      event.waitUntil(
        precacheTiles(payload || []).then(() =>
          event.source?.postMessage({
            type: "TILES_CACHED",
            count: (payload || []).length,
          })
        )
      );
      break;

    case "SKIP_WAITING":
      self.skipWaiting();
      break;

    default:
      break;
  }
});
