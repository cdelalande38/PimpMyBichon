import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { DOCK_MENU } from '../../src/data/dockMenu.ts';

/** Gabarit de référence (§ 19) : toute capture se fait dans ce format. */
export const VIEWPORT = { width: 390, height: 844 } as const;

/** Bande de l'écran où seule la scène 3D est visible (ni HUD, ni dock). */
const SCENE_BAND = {
  x: 0,
  y: Math.round(VIEWPORT.height * 0.22),
  width: VIEWPORT.width,
  height: Math.round(VIEWPORT.height * 0.33),
} as const;

/** Ouvre l'app sur un hash donné (vide : le garage). */
export async function openApp(page: Page, hash = ''): Promise<void> {
  await page.goto(`./${hash}`);
  await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeVisible();
}

/** Colonne de boutons ronds du haut de l'écran : Radio, Photo, Atelier. */
export function quick(page: Page) {
  return page.getByRole('navigation', { name: 'Raccourcis' });
}

/**
 * Ouvre le panneau « Atelier » (roue dentée) sur une rubrique : « Réglages » ou « Sous le capot ».
 * Le panneau porte alors le nom de la rubrique.
 */
export async function openAtelier(page: Page, rubrique: 'Réglages' | 'Sous le capot'): Promise<void> {
  await quick(page).getByRole('button', { name: 'Atelier', exact: true }).click();
  await page.getByRole('navigation', { name: 'Rubriques de l’atelier' }).getByRole('button', { name: rubrique, exact: true }).click();
  await expect(page.getByRole('dialog', { name: rubrique })).toBeVisible();
}

/** Dock : remonte aux sections par « Retour » (un seul niveau du menu à l'écran). */
export async function backToSections(page: Page): Promise<void> {
  const dock = page.locator('footer.dock');
  const sections = dock.getByRole('navigation', { name: 'Onglets de l’atelier' });
  const back = dock.getByRole('button', { name: 'Retour', exact: true });
  for (let i = 0; i < 5 && !(await sections.isVisible()); i += 1) {
    if (!(await back.isVisible())) break;
    await back.tap();
  }
  await expect(sections).toBeVisible();
}

/**
 * Ouvre une entrée du dock par son libellé (« Peinture », « Préparation », « Ambiance »,
 * « Véhicule ») : on remonte aux sections, on touche la section qui la porte
 * (src/data/dockMenu.ts), puis l'entrée si la section en montre plusieurs. On arrive en haut de
 * l'entrée, seule à l'écran sous la ligne de repère.
 */
export async function openEntry(page: Page, label: string): Promise<void> {
  const section = DOCK_MENU.find((item) => item.entries.some((entry) => entry.label === label));
  const entry = section?.entries.find((item) => item.label === label);
  if (!section || !entry) throw new Error(`entrée inconnue : ${label}`);
  const dock = page.locator('footer.dock');
  await backToSections(page);
  await dock.getByRole('navigation', { name: 'Onglets de l’atelier' }).getByRole('button', { name: section.label, exact: true }).tap();
  const entries = dock.getByRole('navigation', { name: `Entrées · ${section.label}` });
  const body = dock.locator(`.dock-tab[data-onglet="${entry.id}"]`);
  await expect(entries.or(body)).toBeVisible();
  if (await entries.isVisible()) await entries.getByRole('button', { name: label, exact: true }).tap();
  await expect(body).toBeVisible();
  await expect(dock.getByRole('navigation', { name: 'Onglets de l’atelier' })).toHaveCount(0);
}

export async function sceneBand(page: Page): Promise<Buffer> {
  return page.screenshot({ clip: SCENE_BAND });
}

/** Une scène rendue a du relief : un canvas vide ou uni a un écart-type quasi nul. */
async function sceneLooksRendered(page: Page): Promise<boolean> {
  const { channels } = await sharp(await sceneBand(page)).stats();
  return channels.slice(0, 3).some((channel) => channel.stdev > 6);
}

export async function waitForScene(page: Page): Promise<void> {
  await expect(page.locator('.stage canvas')).toBeVisible({ timeout: 30_000 });
  // Première image : à froid (premier parcours, nuanceurs à compiler en rendu logiciel), aussi
  // lente que le véhicule posé ; même délai que waitForBench.
  await expect.poll(() => sceneLooksRendered(page), { timeout: 120_000 }).toBe(true);
}

/** Le véhicule à l'écran est chargé et posé dans la scène (lent en rendu logiciel). */
export async function waitForBench(page: Page): Promise<void> {
  await expect(page.locator('.stage[data-bench="pret"]')).toBeAttached({ timeout: 120_000 });
  await waitForStill(page);
}

/** Sauvegarde des builds telle que le store la range (src/state/builds.ts, clé « pmb-builds »). */
export interface SavedBuilds {
  current: string | null;
  builds: Record<string, { paints: Record<string, { color?: string; finish?: string; linked?: boolean }> }>;
  recents: string[];
}

/** Lit la sauvegarde des builds dans IndexedDB (`null` : rien de sauvegardé). */
export async function readBuilds(page: Page): Promise<SavedBuilds | null> {
  return page.evaluate(
    () =>
      new Promise<SavedBuilds | null>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const read = open.result.transaction('kv', 'readonly').objectStore('kv').get('pmb-builds');
          read.onsuccess = () => {
            const raw = read.result as string | undefined;
            done(raw ? ((JSON.parse(raw) as { state: SavedBuilds }).state) : null);
          };
          read.onerror = () => fail(read.error);
        };
      }),
  );
}

/**
 * Peint des zones sans passer par l'interface de peinture (testée à part) : la sauvegarde des builds
 * est réécrite, puis l'app relancée, qui la relit au démarrage. Attend le véhicule posé.
 */
export async function paintAndReload(page: Page, vehicle: string, paints: SavedBuilds['builds'][string]['paints']): Promise<void> {
  const saved = (await readBuilds(page)) ?? { current: null, builds: {}, recents: [] };
  const next: SavedBuilds = {
    ...saved,
    builds: { ...saved.builds, [vehicle]: { paints: { ...saved.builds[vehicle]?.paints, ...paints } } },
  };
  await page.evaluate(
    (value) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const transaction = open.result.transaction('kv', 'readwrite');
          transaction.objectStore('kv').put(JSON.stringify({ state: value, version: 1 }), 'pmb-builds');
          transaction.oncomplete = () => done();
          transaction.onerror = () => fail(transaction.error);
        };
      }),
    next,
  );
  await reloadSaved(page);
  await waitForBench(page);
}

/** Attend que l'image ne bouge plus : chargement de textures et rendus à la demande terminés. */
export async function waitForStill(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const before = await sceneBand(page);
        await page.waitForTimeout(700);
        return changedRatio(before, await sceneBand(page));
      },
      { message: 'scène immobile', timeout: 90_000, intervals: [300] },
    )
    .toBeLessThan(0.0005);
}

/** Le précache est terminé : l'indicateur du HUD passe à « prêt ». */
export async function waitOfflineReady(page: Page): Promise<void> {
  await expect(page.locator('.pill[data-state="pret"]')).toBeVisible({ timeout: 45_000 });
}

/** Capture d'écran de revue, rangée dans captures/jalon-1/ (hors dépôt). */
export async function capture(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'jalon-1', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

/** Part des pixels qui diffèrent nettement entre deux captures de même taille (0 à 1). */
export async function changedRatio(a: Buffer, b: Buffer): Promise<number> {
  const [rawA, rawB] = await Promise.all(
    [a, b].map((png) => sharp(png).removeAlpha().raw().toBuffer()),
  );
  if (!rawA || !rawB || rawA.length !== rawB.length) return 1;
  let changed = 0;
  for (let i = 0; i < rawA.length; i += 3) {
    const delta =
      Math.abs((rawA[i] ?? 0) - (rawB[i] ?? 0)) +
      Math.abs((rawA[i + 1] ?? 0) - (rawB[i + 1] ?? 0)) +
      Math.abs((rawA[i + 2] ?? 0) - (rawB[i + 2] ?? 0));
    if (delta > 24) changed += 1;
  }
  return changed / (rawA.length / 3);
}

/**
 * Attend que tout ce que la page a commencé d'écrire dans IndexedDB soit sur le disque. Les
 * sauvegardes de l'app sont asynchrones et un rechargement les interrompt : sur une machine lente
 * (rendu logiciel partagé), un parcours qui recharge aussitôt après un geste perdait ce geste.
 * Une transaction en écriture ne démarre qu'après celles ouvertes avant elle sur les mêmes
 * magasins : en ouvrir une vide sur chaque base et attendre sa fin suffit. Deux tours, pour une
 * écriture qui en enchaînerait une autre.
 */
export async function settleStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let round = 0; round < 2; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const bases = await indexedDB.databases();
      await Promise.all(
        bases.map(
          (base) =>
            new Promise<void>((resolve) => {
              if (!base.name) {
                resolve();
                return;
              }
              const open = indexedDB.open(base.name);
              open.onerror = () => resolve();
              open.onblocked = () => resolve();
              open.onsuccess = () => {
                const database = open.result;
                const stores = Array.from(database.objectStoreNames);
                const done = () => {
                  database.close();
                  resolve();
                };
                if (stores.length === 0) {
                  done();
                  return;
                }
                const transaction = database.transaction(stores, 'readwrite');
                transaction.oncomplete = done;
                transaction.onerror = done;
                transaction.onabort = done;
              };
            }),
        ),
      );
    }
  });
}

/** Recharge la page une fois ses sauvegardes en cours terminées (voir `settleStorage`). */
export async function reloadSaved(page: Page): Promise<void> {
  await settleStorage(page);
  await page.reload();
}
