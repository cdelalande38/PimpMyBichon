// Persistance locale : IndexedDB via idb-keyval (§ 5.9). Rien ne quitte le téléphone.
// Si IndexedDB est indisponible (navigation privée de certains navigateurs), l'app continue
// avec une mémoire vive : les réglages ne survivent pas à la fermeture, mais rien ne casse.
//
// L'app peut être ouverte deux fois (deux onglets, un vieil onglet à côté de l'app installée).
// Chaque page garde ses stores en mémoire et le middleware `persist` de Zustand réécrit toute la
// sauvegarde d'un store à chaque changement : sans précaution, le moindre geste dans une page
// effacerait ce que l'autre vient d'enregistrer. Le stockage ci-dessous écrit donc, au lieu de la
// copie entière, ce que la page a changé depuis son dernier état connu, posé sur la sauvegarde du
// moment (le dernier qui écrit une même valeur gagne ; personne n'efface ce qu'il n'a pas touché).
// Il n'écrit rien quand rien ne change. Chaque écriture est annoncée aux autres pages, qui relisent
// la sauvegarde ; toute page la relit aussi quand elle redevient visible. Un store en profite en
// passant par `idbStorage`, et se tient à jour en s'inscrivant par `shareAcrossTabs(useStore)`.

import { createStore, del, get, promisifyRequest, type UseStore } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';

const DB_NAME = 'pimpmybichon';
const STORE_NAME = 'kv';
/** Canal par lequel une page annonce aux autres qu'elle a écrit une clé. */
const CHANNEL_NAME = 'pimpmybichon-sauvegarde';

let store: UseStore | null = null;
const memory = new Map<string, string>();
/** Faux dès qu'IndexedDB a refusé une lecture ou une écriture : plus rien ne survit à la fermeture. */
let writable = true;

function db(): UseStore {
  store ??= createStore(DB_NAME, STORE_NAME);
  return store;
}

/** Valeur JSON, telle que `persist` la sérialise (`{ state, version }`). */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isRecord(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sameJson(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameJson(item, b[index]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => key in b && sameJson(a[key], b[key]));
}

/**
 * Fusion à trois : ce que la page a changé entre `base` (son dernier état connu) et `local` (son
 * état du moment), posé sur `stored` (la sauvegarde, que d'autres pages ont pu changer). Les objets
 * se fusionnent clé par clé ; un tableau ou une valeur simple changé par la page la remplace en
 * entier ; une clé que la page a retirée disparaît. `undefined` : la clé n'existe plus.
 */
export function mergeChanges(base: Json | undefined, local: Json | undefined, stored: Json | undefined): Json | undefined {
  if (sameJson(local, base)) return stored;
  // Un objet que la page et une autre ont créé chacune de leur côté (un poste du build qui n'existait
  // pas : `parts`, `partPaints`…) se fusionne aussi clé par clé, comme s'il était parti vide.
  if (base === undefined && isRecord(local) && isRecord(stored)) return mergeChanges({}, local, stored);
  if (isRecord(base) && isRecord(local) && isRecord(stored)) {
    const merged: { [key: string]: Json } = {};
    for (const key of new Set([...Object.keys(stored), ...Object.keys(local)])) {
      const value = mergeChanges(base[key], local[key], stored[key]);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  return local;
}

function parse(raw: string | null): Json | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as Json;
  } catch {
    return null;
  }
}

/** Ce que le stockage sait faire d'une clé (IndexedDB en vrai, une table en mémoire dans les tests). */
export interface KeyValueBackend {
  get: (name: string) => Promise<string | null>;
  /**
   * Lit puis écrit d'un seul tenant (une transaction : une autre page ne s'intercale pas) ;
   * `compute` rend la nouvelle valeur, ou `null` pour ne rien écrire. Vrai si la valeur a été écrite.
   */
  update: (name: string, compute: (raw: string | null) => string | null) => Promise<boolean>;
  del: (name: string) => Promise<void>;
}

/** Ce qu'il faut d'un store `persist` de Zustand pour le relire. */
export interface RehydratableStore {
  persist: {
    getOptions: () => { name?: string };
    rehydrate: () => Promise<void> | void;
  };
}

export interface SharedStorage {
  storage: StateStorage;
  /** Inscrit un store : il relit la sauvegarde quand une autre page l'a changée. */
  share: (store: RehydratableStore) => void;
  /** Relit la sauvegarde d'une clé dans le store inscrit, si elle diffère de ce que la page en sait. */
  refresh: (name: string) => Promise<void>;
  /** Relit toutes les clés des stores inscrits (la page redevient visible). */
  refreshAll: () => Promise<void>;
}

interface PendingWrite {
  /** Dernier état connu avant le premier changement regroupé ici ; `undefined` : la clé n'a pas encore été lue. */
  base: Json | null | undefined;
  local: Json;
  done: Promise<void>;
}

/**
 * Stockage partagé entre pages. `announce` prévient les autres pages qu'une clé vient d'être écrite.
 * Les opérations d'une même clé passent l'une après l'autre ; des changements rapprochés (un curseur
 * qu'on fait glisser) se regroupent en une seule écriture.
 */
export function createSharedStorage(backend: KeyValueBackend, announce: (name: string) => void = () => undefined): SharedStorage {
  const queues = new Map<string, Promise<unknown>>();
  /**
   * Dernier état connu de chaque clé par cette page : ce que sa mémoire contient (le dernier état
   * confié à `setItem`), ou ce qu'elle vient de relire. `null` : rien n'était sauvegardé.
   */
  const known = new Map<string, Json | null>();
  const pending = new Map<string, PendingWrite>();
  /**
   * Relectures en cours : « attente » le temps de comparer la sauvegarde à ce que la page en sait,
   * « lecture » le temps que le store la relise, « application » le temps qu'il s'en serve.
   */
  const refreshing = new Map<string, 'attente' | 'lecture' | 'application'>();
  const again = new Set<string>();
  const shared = new Map<string, RehydratableStore>();

  function enqueue<T>(name: string, task: () => Promise<T>): Promise<T> {
    const run = (queues.get(name) ?? Promise.resolve()).then(task, task);
    const tail = run.catch(() => undefined);
    queues.set(name, tail);
    void tail.then(() => {
      if (queues.get(name) === tail) queues.delete(name);
    });
    return run;
  }

  async function write(name: string, change: PendingWrite): Promise<void> {
    pending.delete(name);
    const { base, local } = change;
    // Rien de sauvegardé n'a changé dans cette page (l'état du modèle, la mesure du dock…).
    if (base !== undefined && sameJson(base, local)) return;
    let next: Json | null = null;
    const wrote = await backend.update(name, (raw) => {
      const stored = parse(raw);
      if (base === undefined) {
        // Changement d'avant la première lecture : la relecture en cours remplace la mémoire.
        next = stored === null ? local : null;
      } else {
        next = base === null || stored === null ? local : (mergeChanges(base, local, stored) ?? local);
      }
      return next === null || sameJson(next, stored) ? null : JSON.stringify(next);
    });
    if (wrote) announce(name);
    // La sauvegarde porte ce qu'une autre page a écrit et que celle-ci ignore : elle le relit.
    if (next !== null && !sameJson(next, local)) void refresh(name);
  }

  const storage: StateStorage = {
    getItem(name) {
      return enqueue(name, async () => {
        const raw = await backend.get(name);
        known.set(name, parse(raw));
        if (refreshing.get(name) === 'lecture') refreshing.set(name, 'application');
        return raw;
      });
    },
    setItem(name, value) {
      const local = parse(value);
      if (local === null) return Promise.resolve();
      // Écho d'une relecture : la mémoire reprend la sauvegarde, il n'y a rien à écrire.
      if (refreshing.get(name) === 'application') {
        known.set(name, local);
        return Promise.resolve();
      }
      const base = known.has(name) ? known.get(name) : undefined;
      if (base !== undefined) known.set(name, local);
      const waiting = pending.get(name);
      if (waiting) {
        // Un changement d'avant la première lecture prend pour base ce qu'elle a lu.
        if (waiting.base === undefined) waiting.base = base;
        waiting.local = local;
        return waiting.done;
      }
      const change = { base, local } as PendingWrite;
      change.done = enqueue(name, () => write(name, change));
      pending.set(name, change);
      return change.done;
    },
    removeItem(name) {
      return enqueue(name, async () => {
        await backend.del(name);
        known.set(name, null);
        announce(name);
      });
    },
  };

  async function refresh(name: string): Promise<void> {
    const target = shared.get(name);
    if (!target) return;
    if (refreshing.has(name)) {
      again.add(name);
      return;
    }
    refreshing.set(name, 'attente');
    try {
      const stored = await enqueue(name, async () => parse(await backend.get(name)));
      if (known.has(name) && sameJson(stored, known.get(name) ?? null)) return;
      refreshing.set(name, 'lecture');
      await target.persist.rehydrate();
    } finally {
      refreshing.delete(name);
      // Une autre écriture annoncée pendant la relecture : on relit encore une fois.
      if (again.delete(name)) void refresh(name);
    }
  }

  return {
    storage,
    share(target) {
      const name = target.persist.getOptions().name;
      if (name) shared.set(name, target);
    },
    refresh,
    async refreshAll() {
      await Promise.all([...shared.keys()].map((name) => refresh(name)));
    },
  };
}

/** Lecture puis écriture dans une même transaction IndexedDB (sur le modèle d'`update` d'idb-keyval). */
function readThenWrite(kv: IDBObjectStore, name: string, compute: (raw: string | null) => string | null): Promise<boolean> {
  return new Promise<boolean>((done, fail) => {
    const read = kv.get(name);
    read.onerror = () => fail(read.error);
    read.onsuccess = () => {
      try {
        const next = compute(typeof read.result === 'string' ? read.result : null);
        if (next === null) {
          done(false);
          return;
        }
        kv.put(next, name);
        promisifyRequest(kv.transaction).then(() => done(true), fail);
      } catch (error) {
        fail(error);
      }
    };
  });
}

let channel: BroadcastChannel | null | undefined;

function tabsChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  channel = null;
  try {
    if (typeof BroadcastChannel === 'function') {
      channel = new BroadcastChannel(CHANNEL_NAME);
      // Sous Node (tests), le canal ne doit pas retenir le processus.
      (channel as BroadcastChannel & { unref?: () => void }).unref?.();
      channel.addEventListener('message', (event: MessageEvent<unknown>) => {
        const name = (event.data as { name?: unknown } | null)?.name;
        if (typeof name === 'string') void shared.refresh(name);
      });
    }
  } catch {
    channel = null;
  }
  return channel;
}

const shared = createSharedStorage(
  {
    async get(name) {
      try {
        return (await get<string>(name, db())) ?? null;
      } catch {
        writable = false;
        return memory.get(name) ?? null;
      }
    },
    async update(name, compute) {
      try {
        return await db()('readwrite', (kv) => readThenWrite(kv, name, compute));
      } catch {
        writable = false;
        const next = compute(memory.get(name) ?? null);
        if (next !== null) memory.set(name, next);
        return next !== null;
      }
    },
    async del(name) {
      try {
        await del(name, db());
      } catch {
        memory.delete(name);
      }
    },
  },
  (name) => tabsChannel()?.postMessage({ name }),
);

/** Stockage asynchrone pour le middleware `persist` de Zustand. */
export const idbStorage: StateStorage = shared.storage;

let watchingVisibility = false;

/**
 * Tient un store à jour de ce que les autres pages enregistrent : il relit la sauvegarde à chaque
 * écriture annoncée par une autre page, et quand la page redevient visible.
 */
export function shareAcrossTabs(target: RehydratableStore): void {
  shared.share(target);
  tabsChannel();
  if (watchingVisibility || typeof document === 'undefined') return;
  watchingVisibility = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void shared.refreshAll();
  });
}

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
