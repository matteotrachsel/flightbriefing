"use client";

/**
 * Client-side bridge to the service worker + IndexedDB.
 *
 * The service worker (public/sw.js) owns the canonical IndexedDB write path so
 * that briefings persist even if the page is closed mid-store. This module:
 *   - registers the worker,
 *   - hands the finalized briefing to it for offline storage,
 *   - asks it to pre-cache the corridor map tiles,
 *   - and provides a direct IndexedDB read path for the offline viewer.
 */

import type { Briefing, TileCoord } from "../types/briefing";
import { tileUrl } from "../services/geoUtils";

const IDB_NAME = "preflight-briefings";
const IDB_VERSION = 1;
const IDB_STORE = "briefings";

/* -------------------------------------------------------------------------- */
/* Service worker registration + messaging                                    */
/* -------------------------------------------------------------------------- */

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  return reg;
}

function postToSw(message: unknown): void {
  navigator.serviceWorker?.controller?.postMessage(message);
}

/**
 * Persist a briefing for full offline viewing and warm the tile cache along
 * the route corridor. Resolves once the worker confirms the store.
 */
export async function persistBriefing(
  briefing: Briefing,
  options: { precacheTiles?: boolean } = { precacheTiles: true }
): Promise<void> {
  await registerServiceWorker();

  await new Promise<void>((resolve) => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "BRIEFING_STORED" && e.data?.id === briefing.id) {
        navigator.serviceWorker.removeEventListener("message", onMessage);
        resolve();
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    postToSw({ type: "STORE_BRIEFING", payload: briefing });
    // Belt-and-braces: also write directly in case no controller yet.
    putBriefingDirect(briefing).catch(() => undefined);
    // Don't hang forever if the worker is slow to claim the page.
    setTimeout(resolve, 4000);
  });

  if (options.precacheTiles && briefing.cachedTiles?.length) {
    precacheCorridorTiles(briefing.cachedTiles);
  }
}

export function precacheCorridorTiles(tiles: TileCoord[]): void {
  const urls = tiles.map((t) => tileUrl(t));
  postToSw({ type: "PRECACHE_TILES", payload: urls });
}

/* -------------------------------------------------------------------------- */
/* Direct IndexedDB access (read path for the offline viewer)                 */
/* -------------------------------------------------------------------------- */

function openDb(): Promise<IDBDatabase> {
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

async function putBriefingDirect(briefing: Briefing): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(briefing);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getBriefing(id: string): Promise<Briefing | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(id);
    req.onsuccess = () => resolve(req.result as Briefing | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function listBriefings(): Promise<Briefing[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => resolve(req.result as Briefing[]);
    req.onerror = () => reject(req.error);
  });
}
