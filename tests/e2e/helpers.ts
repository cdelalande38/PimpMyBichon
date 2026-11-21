import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
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

/**
 * Dock : remonte aux sections par « Retour » (un seul niveau du menu à l'écran). Jusqu'à dix niveaux :
 * le menu de la sortie en empile quatre sous son contenu (lieu, circuit, départ, réglages).
 */
export async function backToSections(page: Page): Promise<void> {
  const dock = page.locator('footer.dock');
  const sections = dock.getByRole('navigation', { name: 'Onglets de l’atelier' });
  const back = dock.getByRole('button', { name: 'Retour', exact: true });
  for (let i = 0; i < 10 && !(await sections.isVisible()); i += 1) {
    if (!(await back.isVisible())) break;
    await back.tap();
  }
  await expect(sections).toBeVisible();
}

/**
 * Libellé de l'écran « Jouer » (src/data/dockMenu.ts, entrée `sortie` de la section cachée `jouer`) : à passer
 * à `openEntry`, jamais écrit en dur dans un parcours. Depuis la vague X (21 novembre 2026), il n'est plus dans
 * le menu du bas : le bouton « Jouer » de l'en-tête du dock l'ouvre, à toute profondeur du menu.
 */
export const ENTREE_SORTIE = 'Jouer';

/**
 * Ouvre une entrée du dock par son libellé (« Peinture », « Préparation », « Ambiance »,
 * « Véhicule ») : on remonte aux sections, on touche la section qui la porte
 * (src/data/dockMenu.ts), puis l'entrée si la section en montre plusieurs. On arrive en haut de
 * l'entrée, seule à l'écran sous la ligne de repère. « Jouer » (ENTREE_SORTIE) : son bouton, aux sections.
 */
export async function openEntry(page: Page, label: string): Promise<void> {
  const section = DOCK_MENU.find((item) => item.entries.some((entry) => entry.label === label));
  const entry = section?.entries.find((item) => item.label === label);
  if (!section || !entry) throw new Error(`entrée inconnue : ${label}`);
  const dock = page.locator('footer.dock');
  await backToSections(page);
  if (section.cachee) {
    await dock.getByRole('button', { name: 'Jouer', exact: true }).tap();
    await expect(dock.locator(`.dock-tab[data-onglet="${entry.id}"]`)).toBeVisible();
    return;
  }
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
  // L'écran de chargement du lancement porte un fond rendu (vague W) : la bande lirait son image.
  if ((await page.locator('.tuto-chargement:not([data-fini])').count()) > 0) return false;
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
  // La pastille se tait quand tout va bien (elle reste dans la page, masquée) : on lit son état.
  await expect(page.locator('.pill[data-state="pret"]')).toHaveCount(1, { timeout: 45_000 });
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

/**
 * Garde la balade comme format préféré (la sauvegarde de la sortie, IndexedDB), puis recharge le garage : la
 * sortie ouverte ensuite (le lien « #/sortie » compris) s'ouvre sur l'aperçu, qui ne reste qu'en balade (vague X).
 */
export async function preferBalade(page: Page): Promise<void> {
  await page.goto('./');
  // Le garage monté : les sauvegardes sont relues et réécrites avant la nôtre.
  await waitForScene(page);
  await page.evaluate(
    () =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const transaction = open.result.transaction('kv', 'readwrite');
          transaction.objectStore('kv').put(JSON.stringify({ state: { format: 'balade' }, version: 2 }), 'pmb-sortie');
          transaction.oncomplete = () => done();
          transaction.onerror = () => fail(transaction.error);
        };
      }),
  );
  await reloadSaved(page);
}

/**
 * La sortie. Vague X (21 novembre 2026) : l'aperçu (pilote automatique, réalisateur, presque rien à l'écran)
 * ne reste qu'en BALADE ; une course, un duel ou un drift partent droit sur la grille, aux feux, à la main.
 * Un appui sur la route de l'aperçu lance la course à la main depuis la ligne (src/ui/drive/DriveScreen.tsx) ;
 * la petite icône du coin ouvre les réglages (src/ui/drive/Reglages.tsx).
 */
export const DELAI_ROUTE = 150_000;

/** L'aperçu roule (Balade) : la route est prête et l'invitation « Touche l'écran pour commencer » est là. */
export async function attendreApercu(page: Page): Promise<void> {
  await expect(page.locator('.drive-invite')).toHaveText('Touche l’écran pour commencer', { timeout: DELAI_ROUTE });
}

/**
 * La route est prête, quel que soit le mode : l'aperçu de la balade (invitation à toucher l'écran) ou la
 * grille d'une course, d'un duel, d'un drift (la conduite est à la main, le départ arrêté ou lancé).
 */
export async function attendreRoute(page: Page): Promise<void> {
  const invite = page.locator('.drive-invite');
  const main = page.locator('.drive-mid[data-conduite="main"]');
  await expect(invite.or(main)).toBeVisible({ timeout: DELAI_ROUTE });
}

/**
 * Commence la course : depuis l'aperçu de la balade, un appui bref au milieu de la route ; on repart de la
 * ligne, aux feux, à la main. Course, duel, drift : elle est déjà sur la grille, rien à toucher. `parti` :
 * attend aussi le vert (« parti ») avant de rendre la main au parcours.
 */
export async function commencerCourse(page: Page, { parti = false }: { parti?: boolean } = {}): Promise<void> {
  await attendreRoute(page);
  const zone = page.locator('.drive-mid');
  if (await page.locator('.drive-invite').isVisible()) {
    const box = await zone.boundingBox();
    if (!box) throw new Error('zone des gestes introuvable');
    await zone.tap({ position: { x: box.width * 0.5, y: box.height * 0.4 } });
  }
  await expect(zone).toHaveAttribute('data-conduite', 'main');
  await expect(page.locator('.drive-invite')).toHaveCount(0);
  // La scène a repris le départ arrêté (l'aperçu, lui, était « parti » sans feux).
  await expect(page.locator('.drive-stage')).toHaveAttribute('data-depart', /^(attente|feux|parti)$/, { timeout: DELAI_ROUTE });
  if (parti) await expect(page.locator('.drive-stage')).toHaveAttribute('data-depart', 'parti', { timeout: DELAI_ROUTE });
}

/** Le panneau des réglages de la sortie, ouvert ou non. */
export function reglagesSortie(page: Page) {
  return page.getByRole('dialog', { name: 'Réglages' });
}

/** Ouvre les réglages par la petite icône du coin ; rend le panneau. */
export async function ouvrirReglages(page: Page) {
  const panneau = reglagesSortie(page);
  if (!(await panneau.isVisible())) await page.getByRole('button', { name: 'Réglages de la sortie' }).tap();
  await expect(panneau).toBeVisible();
  return panneau;
}

/** Ferme les réglages par leur croix. */
export async function fermerReglages(page: Page): Promise<void> {
  const panneau = reglagesSortie(page);
  await panneau.getByRole('button', { name: 'Fermer les réglages' }).tap();
  await expect(panneau).toHaveCount(0);
}

/**
 * Dans les réglages, touche le choix `nom` du groupe `groupe` (« Caméra », « Météo », « Commande »,
 * « Conduite assistée »), vérifie qu'il est allumé, puis referme le panneau (sauf `garder`).
 */
export async function reglerSortie(page: Page, groupe: string, nom: string, { garder = false }: { garder?: boolean } = {}): Promise<void> {
  const panneau = await ouvrirReglages(page);
  const bouton = panneau.getByRole('group', { name: groupe }).getByRole('button', { name: nom, exact: true });
  await bouton.tap();
  await expect(bouton).toHaveAttribute('aria-pressed', 'true');
  if (!garder) await fermerReglages(page);
}

/** Choisit une caméra dans les réglages (le réalisateur s'arrête). */
export async function choisirCamera(page: Page, nom: string, options: { garder?: boolean } = {}): Promise<void> {
  await reglerSortie(page, 'Caméra', nom, options);
}

/**
 * « Rentrer au garage » : tant que la route charge, le retour du téléphone (l'écran de chargement n'a plus
 * de bouton depuis la vague U) ; celui de l'arrivée au bout d'un parcours, sinon celui des réglages. Tant que la route roule, il demande
 * d'abord « Rentrer au garage ? » (src/app/gardeSortie.ts) : on confirme par « Rentrer ». Route pas
 * encore prête, en erreur ou au bout : pas de question, le garage revient tout de suite.
 */
export async function rentrerAuGarage(page: Page): Promise<void> {
  const chargement = page.locator('.drive-veil[data-etat="chargement"]:not([data-fini])');
  const arrivee = page.locator('.drive-arrivee');
  const erreur = page.locator('.drive-veil[data-etat="erreur"]');
  if (await chargement.isVisible()) await page.goBack();
  else if (await arrivee.isVisible()) await arrivee.getByRole('button', { name: 'Rentrer au garage' }).tap();
  else if (await erreur.isVisible()) await erreur.getByRole('button', { name: 'Rentrer au garage' }).tap();
  else {
    const panneau = await ouvrirReglages(page);
    await panneau.getByRole('button', { name: 'Rentrer au garage' }).tap();
  }
  const question = page.getByRole('dialog', { name: 'Rentrer au garage ?' });
  const garage = page.getByRole('heading', { level: 1, name: 'PimpMyBichon' });
  await expect(question.or(garage)).toBeVisible();
  if (await question.isVisible()) await question.getByRole('button', { name: 'Rentrer', exact: true }).tap();
}

/**
 * Temps de route de la sortie, en secondes de SIMULATION : le chrono du départ (data-chrono, en
 * dixièmes), qui tourne roues parties (aperçu compris) et s'arrête en pause, aux feux et à l'arrivée.
 */
export async function tempsDeRoute(page: Page): Promise<number> {
  return Number((await page.locator('.drive-stage').getAttribute('data-chrono')) ?? 0) / 10;
}

/**
 * Attend que `lire()` rende une valeur que `ok` accepte. Le délai se compte en secondes de ROUTE
 * (`secondes`, temps de simulation lu sur data-chrono), pas d'horloge : en rendu logiciel, la CI tombe
 * par moments sous une image par seconde et la scène n'avance que d'un dixième de seconde par image ;
 * un délai d'horloge y mesure la machine, pas l'app (vague R : six parcours tombés ainsi). `horloge`
 * (ms) n'est qu'un garde-fou contre une scène figée ; il doit tenir dans le délai du parcours. Rend la
 * dernière valeur lue. Le relevé entre deux lectures (`intervalle`, ms) n'est pas une preuve.
 */
export async function attendreSurLaRoute<T>(
  page: Page,
  quoi: string,
  lire: () => Promise<T>,
  ok: (valeur: T) => boolean,
  { secondes, horloge = 360_000, intervalle = 250 }: { secondes: number; horloge?: number; intervalle?: number },
): Promise<T> {
  const depart = await tempsDeRoute(page);
  const debut = Date.now();
  let valeur = await lire();
  while (!ok(valeur)) {
    const route = (await tempsDeRoute(page)) - depart;
    if (route > secondes) throw new Error(`${quoi} : toujours ${JSON.stringify(valeur)} après ${route.toFixed(1)} s de route (délai : ${secondes} s de route)`);
    if (Date.now() - debut > horloge) {
      throw new Error(`${quoi} : toujours ${JSON.stringify(valeur)} après ${horloge / 1000} s d'horloge pour ${route.toFixed(1)} s de route seulement (scène figée ?)`);
    }
    await page.waitForTimeout(intervalle);
    valeur = await lire();
  }
  return valeur;
}

/**
 * Écran « Jouer », aux réglages : ouvre « Moment et météo » (repliés sur une ligne, « Nuit · Pluie ») ; sans effet
 * s'ils sont déjà ouverts.
 */
export async function ouvrirCiel(page: Page): Promise<void> {
  const resume = page.locator('footer.dock .entree-ciel-resume');
  if ((await resume.getAttribute('aria-expanded')) !== 'true') await resume.tap();
  await expect(page.locator('footer.dock').getByRole('group', { name: 'Météo' })).toBeVisible();
}

/**
 * Écran « Jouer », carte touchée : met la météo au sec. Pour les parcours qui ne parlent pas de
 * météo : la pluie (réglage par défaut) allonge les accélérations à la main d'un quart et ralentit le
 * pilote automatique en courbe (src/data/adherence.ts).
 */
export async function auSec(page: Page): Promise<void> {
  await ouvrirCiel(page);
  const sec = page.locator('footer.dock').getByRole('group', { name: 'Météo' }).getByRole('button', { name: 'Sec', exact: true });
  await sec.tap();
  await expect(sec).toHaveAttribute('aria-pressed', 'true');
}

/** Une carte du catalogue, lue dans son manifeste (public/assets/maps/<id>/map.json). */
export interface CarteDuMenu {
  id: string;
  name: string;
  order: number;
  /** Lieu de la carte (champ `zone` du manifeste ; sans lui, la carte fait un lieu à elle seule). */
  zone: string;
  /** Nom du lieu, et nom de la carte dans son lieu (« Monaco », « Le circuit »). */
  lieu: string;
  circuit: string;
}

/** Les cartes du catalogue, dans l'ordre du menu (rang, puis identifiant), comme src/data/maps.ts. */
export function cartesDuMenu(): CarteDuMenu[] {
  const dir = resolve('public', 'assets', 'maps');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(dir, entry.name, 'map.json')))
    .map((entry) => {
      const raw = JSON.parse(readFileSync(resolve(dir, entry.name, 'map.json'), 'utf8')) as { id: string; name: string; order: number; zone?: { id: string; label: string; circuit?: string } };
      return { id: raw.id, name: raw.name, order: raw.order, zone: raw.zone?.id ?? `carte-${raw.id}`, lieu: raw.zone?.label ?? raw.name, circuit: raw.zone?.circuit ?? raw.name };
    })
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** L'écran « Jouer » à l'écran (son étape dans data-etape : mode, zone, circuit, reglages, carriere). */
export function entreeSortie(page: Page) {
  return page.locator('footer.dock .drive-entry');
}

/** Étape de l'écran « Jouer » à l'écran. */
export async function etapeSortie(page: Page): Promise<string> {
  return (await entreeSortie(page).getAttribute('data-etape')) ?? '';
}

/** Écran « Jouer » : « Retour » du dock, une étape plus haut. */
export async function etapePrecedente(page: Page): Promise<void> {
  const avant = await etapeSortie(page);
  await page.locator('footer.dock').getByRole('button', { name: 'Retour', exact: true }).tap();
  if (avant !== 'mode') await expect(entreeSortie(page)).not.toHaveAttribute('data-etape', avant);
}

/** Les modes de l'écran « Jouer » (carte `data-mode`, src/data/modes.ts) que les parcours touchent. */
export type ModeJeu = 'course' | 'duel' | 'drift' | 'balade';

/** Écran « Jouer » ouvert, à n'importe quelle étape : remonte aux modes et touche la carte du mode donné. */
export async function choisirMode(page: Page, mode: ModeJeu): Promise<void> {
  const dock = page.locator('footer.dock');
  const entree = entreeSortie(page);
  await expect(entree).toBeVisible();
  for (let i = 0; i < 6 && (await etapeSortie(page)) !== 'mode'; i += 1) await etapePrecedente(page);
  await dock.getByRole('group', { name: 'Mode' }).locator(`[data-mode="${mode}"]`).tap();
  await expect(entree).toHaveAttribute('data-etape', 'zone');
}

/**
 * Écran « Jouer » ouvert, à n'importe quelle étape : mène aux réglages de la carte donnée par les étapes
 * (le mode `mode`, « course » par défaut, puis le lieu, le circuit du lieu s'il en a plusieurs), en touchant le
 * départ `depart` s'il est donné (la route en a plusieurs), sinon celui déjà choisi (le premier par défaut).
 * Sans dépendre de l'ordre des étapes à l'écran.
 */
export async function allerALaCarte(page: Page, carte: CarteDuMenu, { depart, mode = 'course' }: { depart?: string | RegExp; mode?: ModeJeu } = {}): Promise<void> {
  const dock = page.locator('footer.dock');
  const entree = entreeSortie(page);
  await choisirMode(page, mode);
  await dock.getByRole('group', { name: 'Lieu' }).locator(`[data-zone="${carte.zone}"]`).tap();
  await expect(entree).toHaveAttribute('data-etape', /^(circuit|reglages)$/);
  if ((await etapeSortie(page)) === 'circuit') await dock.getByRole('group', { name: 'Circuit' }).locator(`[data-carte="${carte.id}"]`).tap();
  await expect(entree).toHaveAttribute('data-etape', 'reglages');
  await expect(dock.locator(`.drive-credits[data-credits="${carte.id}"]`)).toBeVisible();
  if (depart !== undefined) await choisirDepart(page, depart);
}

/**
 * Écran « Jouer » : choisit une carte (la première du catalogue par défaut ; `index` : son rang dans
 * l'ordre du catalogue) par les étapes, dans le mode `mode` (« course » par défaut), et arrive à ses réglages :
 * « Jouer » est à l'écran. Le départ est celui déjà choisi, le premier par défaut (voir choisirDepart).
 */
export async function pickMap(page: Page, index = 0, mode: ModeJeu = 'course'): Promise<void> {
  const carte = cartesDuMenu()[index];
  if (!carte) throw new Error(`pas de carte au rang ${index}`);
  await allerALaCarte(page, carte, { mode });
}

/** Écran « Jouer » : choisit la carte dont le nom (« Monaco, le circuit ») répond à `nom`, jusqu'à ses réglages. */
export async function choisirCarte(page: Page, nom: string | RegExp, mode: ModeJeu = 'course'): Promise<void> {
  const carte = cartesDuMenu().find((item) => (typeof nom === 'string' ? item.name.includes(nom) : nom.test(item.name)));
  if (!carte) throw new Error(`pas de carte nommée ${String(nom)}`);
  await allerALaCarte(page, carte, { mode });
}

/**
 * Écran « Jouer », aux réglages d'une carte (la route chargée) : touche le départ `nom`. Le départ est une
 * rangée des réglages, sans étape à part ; une carte à un seul départ n'a pas cette rangée.
 */
export async function choisirDepart(page: Page, nom: string | RegExp): Promise<void> {
  const dock = page.locator('footer.dock');
  await expect(entreeSortie(page)).toHaveAttribute('data-etape', 'reglages');
  const bouton = dock.getByRole('group', { name: 'Départ' }).getByRole('button', { name: nom });
  await bouton.tap();
  await expect(bouton).toHaveAttribute('aria-pressed', 'true');
}

/**
 * Les options de la fiche de préparation, payantes depuis le 19 novembre 2026 (`articlePrep` de
 * src/data/enginePrep.ts, qu'un parcours ne peut pas importer : il passe par import.meta.glob de Vite).
 */
export const ARTICLES_PREPARATION: readonly string[] = ['reprog-stage1', 'reprog-stage2', 'reprog-stage3', 'carbu-gicleurs', 'carbu-gros-carbu', 'carbu-double-carbu', 'nitro-nitro-petit', 'nitro-nitro-moyen', 'nitro-nitro-gros'].map((id) => `piece-${id}`);

/**
 * Pose dans la sauvegarde du jeu les articles achetés `ids` (solde nul), puis recharge : pour les parcours
 * qui choisissent une option payante sans passer par la boutique (la fiche de préparation est payante
 * depuis le 19 novembre 2026).
 */
export async function poserArticles(page: Page, ids: readonly string[]): Promise<void> {
  const etat = { solde: 0, articles: Object.fromEntries(ids.map((id) => [id, true])), hautsFaits: { 'premiere-course': true }, cumuls: { courses: 4, distance: 9300 } };
  await page.evaluate(
    (value) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const transaction = open.result.transaction('kv', 'readwrite');
          transaction.objectStore('kv').put(JSON.stringify({ state: value, version: 1 }), 'pmb-jeu');
          transaction.oncomplete = () => done();
          transaction.onerror = () => fail(transaction.error);
        };
      }),
    etat,
  );
  await reloadSaved(page);
}
