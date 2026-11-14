// Persistance locale : IndexedDB via idb-keyval (§ 5.9). Rien ne quitte le téléphone.
// Si IndexedDB est indisponible (navigation privée de certains navigateurs), l'app continue
// avec une mémoire vive : les réglages ne survivent pas à la fermeture, mais rien ne casse.

import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';

const DB_NAME = 'pimpmybichon';
const STORE_NAME = 'kv';

let store: UseStore | null = null;
const memory = new Map<string, string>();
/** Faux dès qu'IndexedDB a refusé une lecture ou une écriture : plus rien ne survit à la fermeture. */
let writable = true;

function db(): UseStore {
  store ??= createStore(DB_NAME, STORE_NAME);
  return store;
}

/** Stockage asynchrone pour le middleware `persist` de Zustand. */
export const idbStorage: StateStorage = {
  async getItem(name) {
    try {
      return (await get<string>(name, db())) ?? null;
    } catch {
      writable = false;
      return memory.get(name) ?? null;
    }
  },
  async setItem(name, value) {
    try {
      await set(name, value, db());
    } catch {
      writable = false;
      memory.set(name, value);
    }
  },
  async removeItem(name) {
    try {
      await del(name, db());
    } catch {
      memory.delete(name);
    }
  },
};

export interface StorageStatus {
  /** `null` : le navigateur ne sait pas répondre. */
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
  /** Faux si IndexedDB refuse d'écrire : les réglages ne survivront pas à la fermeture. */
  writable: boolean;
}

/**
 * Demande au navigateur de ne pas effacer les données de l'app quand la place manque.
 * Chrome décide seul, sans fenêtre : il accepte surtout une fois l'app installée.
 * On redemande donc à chaque lancement tant que ce n'est pas acquis.
 */
export async function askPersistentStorage(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function readStorageStatus(): Promise<StorageStatus> {
  const status: StorageStatus = { persisted: null, usage: null, quota: null, writable };
  try {
    if (navigator.storage?.persisted) status.persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      status.usage = estimate.usage ?? null;
      status.quota = estimate.quota ?? null;
    }
  } catch {
    // Navigateur sans API de stockage : on affiche « inconnu ».
  }
  return status;
}
