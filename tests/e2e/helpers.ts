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
 * Libellé, dans le menu du bas (Garage), de l'entrée qui mène à la sortie (src/data/dockMenu.ts, id
 * `sortie`) : à passer à `openEntry`, jamais écrit en dur dans un parcours. Depuis la vague U (§ 5.5, mode
 * jour) elle s'appelle « Sortie » ; son bouton rond du coin du garage porte le même nom accessible.
 */
export const ENTREE_SORTIE = 'Sortie';

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
 * La sortie : elle s'ouvre sur l'aperçu (pilote automatique, réalisateur, presque rien à
 * l'écran) ; un appui sur la route lance la course à la main depuis la ligne (src/ui/drive/DriveScreen.tsx) ;
 * la petite icône du coin ouvre les réglages (src/ui/drive/Reglages.tsx).
 */
export const DELAI_ROUTE = 150_000;

/** L'aperçu roule : la route est prête et l'invitation « Touche l'écran pour commencer » est là. */
export async function attendreApercu(page: Page): Promise<void> {
  await expect(page.locator('.drive-invite')).toHaveText('Touche l’écran pour commencer', { timeout: DELAI_ROUTE });
}

/**
 * Commence la course depuis l'aperçu : un appui bref au milieu de la route. On repart de la ligne, aux
 * feux, à la main. `parti` : attend aussi le vert (« parti ») avant de rendre la main au parcours.
 */
export async function commencerCourse(page: Page, { parti = false }: { parti?: boolean } = {}): Promise<void> {
  await attendreApercu(page);
  const zone = page.locator('.drive-mid');
  const box = await zone.boundingBox();
  if (!box) throw new Error('zone des gestes introuvable');
  await zone.tap({ position: { x: box.width * 0.5, y: box.height * 0.4 } });
  await expect(zone).toHaveAttribute('data-conduite', 'main');
  await expect(page.locator('.drive-invite')).toHaveCount(0);
  // La scène a repris le départ arrêté (l'aperçu, lui, était « parti » sans feux).
  await expect(page.locator('.drive-stage')).toHaveAttribute('data-depart', /^(attente|feux)$/, { timeout: DELAI_ROUTE });
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
 * « Direction »), vérifie qu'il est allumé, puis referme le panneau (sauf `garder`).
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
 * Menu « Sortie », carte touchée : met la météo au sec. Pour les parcours qui ne parlent pas de
 * météo : la pluie (réglage par défaut) allonge les accélérations à la main d'un quart et ralentit le
 * pilote automatique en courbe (src/data/adherence.ts).
 */
export async function auSec(page: Page): Promise<void> {
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

/** Le menu de la sortie à l'écran (son étape dans data-etape : mode, zone, circuit, depart, reglages, carriere). */
export function entreeSortie(page: Page) {
  return page.locator('footer.dock .drive-entry');
}

/** Étape du menu de la sortie à l'écran. */
export async function etapeSortie(page: Page): Promise<string> {
  return (await entreeSortie(page).getAttribute('data-etape')) ?? '';
}

/** Menu de la sortie : « Retour » du dock, une étape plus haut. */
export async function etapePrecedente(page: Page): Promise<void> {
  const avant = await etapeSortie(page);
  await page.locator('footer.dock').getByRole('button', { name: 'Retour', exact: true }).tap();
  if (avant !== 'mode') await expect(entreeSortie(page)).not.toHaveAttribute('data-etape', avant);
}

/**
 * Menu « Sortie » ouvert, à n'importe quelle étape : mène aux réglages de la carte donnée par les étapes
 * (mode libre, lieu, circuit du lieu s'il en a plusieurs, départ), en touchant le départ `depart`, ou
 * celui déjà choisi (le premier par défaut). Sans dépendre de l'ordre des étapes à l'écran.
 */
export async function allerALaCarte(page: Page, carte: CarteDuMenu, { depart }: { depart?: string | RegExp } = {}): Promise<void> {
  const dock = page.locator('footer.dock');
  const entree = entreeSortie(page);
  await expect(entree).toBeVisible();
  for (let i = 0; i < 6; i += 1) {
    const etape = await etapeSortie(page);
    if (etape === 'mode' || etape === 'zone') break;
    await etapePrecedente(page);
  }
  if ((await etapeSortie(page)) === 'mode') await dock.getByRole('group', { name: 'Mode' }).getByRole('button', { name: /^Libre/ }).tap();
  await expect(entree).toHaveAttribute('data-etape', 'zone');
  await dock.getByRole('group', { name: 'Lieu' }).locator(`[data-zone="${carte.zone}"]`).tap();
  await expect(entree).toHaveAttribute('data-etape', /^(circuit|depart|reglages)$/);
  if ((await etapeSortie(page)) === 'circuit') await dock.getByRole('group', { name: 'Circuit' }).locator(`[data-carte="${carte.id}"]`).tap();
  await expect(entree).toHaveAttribute('data-etape', /^(depart|reglages)$/);
  if ((await etapeSortie(page)) === 'depart') {
    const departs = dock.getByRole('group', { name: 'Départ' });
    const reglages = dock.locator('.drive-entry[data-etape="reglages"]');
    // La route se charge (départs) ; une carte à un seul départ passe d'elle-même aux réglages.
    await expect(departs.getByRole('button').first().or(reglages)).toBeVisible({ timeout: 30_000 });
    if (!(await reglages.isVisible())) {
      const presse = departs.locator('[aria-pressed="true"]');
      const bouton = depart !== undefined ? departs.getByRole('button', { name: depart }) : (await presse.count()) > 0 ? presse : departs.getByRole('button').first();
      await bouton.tap();
    }
  }
  await expect(entree).toHaveAttribute('data-etape', 'reglages');
  await expect(dock.locator(`.drive-credits[data-credits="${carte.id}"]`)).toBeVisible();
}

/**
 * Menu « Sortie » : choisit une carte (la première du catalogue par défaut ; `index` : son rang dans
 * l'ordre du catalogue) par les étapes du menu, et arrive à ses réglages : moment, météo, format et
 * « Jouer » sont à l'écran. Le départ est celui déjà choisi, le premier par défaut (voir choisirDepart).
 */
export async function pickMap(page: Page, index = 0): Promise<void> {
  const carte = cartesDuMenu()[index];
  if (!carte) throw new Error(`pas de carte au rang ${index}`);
  await allerALaCarte(page, carte);
}

/** Menu « Sortie » : choisit la carte dont le nom (« Monaco, le circuit ») répond à `nom`, jusqu'à ses réglages. */
export async function choisirCarte(page: Page, nom: string | RegExp): Promise<void> {
  const carte = cartesDuMenu().find((item) => (typeof nom === 'string' ? item.name.includes(nom) : nom.test(item.name)));
  if (!carte) throw new Error(`pas de carte nommée ${String(nom)}`);
  await allerALaCarte(page, carte);
}

/**
 * Menu « Sortie », une carte choisie (réglages ou départs à l'écran) : touche le départ `nom` et revient
 * aux réglages.
 */
export async function choisirDepart(page: Page, nom: string | RegExp): Promise<void> {
  const dock = page.locator('footer.dock');
  if ((await etapeSortie(page)) === 'reglages') await etapePrecedente(page);
  await expect(entreeSortie(page)).toHaveAttribute('data-etape', 'depart');
  const bouton = dock.getByRole('group', { name: 'Départ' }).getByRole('button', { name: nom });
  await bouton.tap();
  await expect(entreeSortie(page)).toHaveAttribute('data-etape', 'reglages');
}
