// Le format « Drift » (vague V, demande du 18 novembre 2026 : « le bouton de freins devrait permettre de faire des
// drifts. Les drift donnent des points ») : choisi au menu de la sortie, à côté de la balade et des courses ; en
// paysage, un coup bref sur le bouton FREIN de la manette, manche braqué et GAZ tenu, fait glisser l'arrière : les
// points du drift en cours s'affichent, puis le score ; à l'arrivée, l'écran de fin donne le score à la place du
// temps, le meilleur drift ou la phrase qui dit comment faire, la médaille et les gains.
// Retour du 19 novembre 2026 : parti en direction assistée (sa préférence), le format roule en direction libre d'office
// (réglage grisé, préférence intacte au retour) ; une ligne dit le geste jusqu'au premier drift compté ; le compteur
// ne clignote pas (il changeait d'état à chaque image le long d'un trottoir).
// Une course entière est trop longue en rendu logiciel : comme tests/e2e/courses.spec.ts, le parcours sert lui-même
// la route de Miami Beach avec le départ « Vers la 41e rue » posé 320 m avant le bout (donnée de la carte changée
// dans le navigateur du test seulement ; le service worker est bloqué pour que la route servie passe par le réseau).
// Le coup de frein est tenu le temps de deux images de la page (la scène en voit au moins une, au plus deux : 0,2 s
// de route en rendu logiciel, sous la limite d'un coup bref). Appuis tactiles par le protocole du navigateur
// (plusieurs doigts à la fois). Captures de revue à la demande : PMB_CAPTURES_DRIFT=<dossier>.

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { boutonsDeFin, finEnDeuxColonnes, finEnPortrait } from './fin-course.ts';
import { attendreSurLaRoute, auSec, choisirCarte, choisirDepart, commencerCourse, DELAI_ROUTE, ENTREE_SORTIE, fermerReglages, openApp, openEntry, ouvrirReglages, reloadSaved, waitForScene } from './helpers.ts';

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const dock = (page: Page) => page.locator('footer.dock');
const kmh = async (page: Page) => Number(await stage(page).getAttribute('data-vitesse'));

const CAPTURES = process.env.PMB_CAPTURES_DRIFT;
async function shot(page: Page, name: string): Promise<void> {
  if (!CAPTURES) return;
  mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURES, `${name}.png`) });
}

/** Le véhicule du garage (le concept, une propulsion), posé dans la sauvegarde avant d'ouvrir l'app. */
async function poserVehicule(page: Page, id: string): Promise<void> {
  await page.goto('./');
  await page.evaluate(
    (id) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(JSON.stringify({ state: { current: id, builds: {}, recents: [] }, version: 1 }), 'pmb-builds');
          tx.oncomplete = () => {
            open.result.close();
            done();
          };
          tx.onerror = () => fail(tx.error);
        };
      }),
    id,
  );
}

interface Point {
  x: number;
  y: number;
  id: number;
}

/** Plusieurs doigts à la fois, par le protocole du navigateur (comme tests/e2e/sortie-pilotage.spec.ts). */
class Doigts {
  private points = new Map<number, Point>();
  private cdp: CDPSession;
  constructor(cdp: CDPSession) {
    this.cdp = cdp;
  }
  private list() {
    return [...this.points.values()].map(({ x, y, id }) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 }));
  }
  async poser(id: number, x: number, y: number): Promise<void> {
    this.points.set(id, { x, y, id });
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.list() });
  }
  async glisser(id: number, x: number, y: number, pas = 5): Promise<void> {
    const from = this.points.get(id);
    if (!from) throw new Error(`doigt ${id} absent`);
    for (let i = 1; i <= pas; i += 1) {
      this.points.set(id, { id, x: from.x + ((x - from.x) * i) / pas, y: from.y + ((y - from.y) * i) / pas });
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.list() });
    }
  }
  async lever(id: number): Promise<void> {
    const point = this.points.get(id);
    if (!point) return;
    this.points.delete(id);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ ...point, radiusX: 4, radiusY: 4, force: 1 }] });
  }
  async toutLever(): Promise<void> {
    this.points.clear();
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
}

async function centre(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} introuvable`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Relève, sur le compteur du drift, les points les plus hauts et les états vus (glisse, compte, perdu). */
async function suivreCompteur(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __drift: { points: number; etats: string[] } };
    w.__drift = { points: 0, etats: [] };
    const el = document.querySelector<HTMLElement>('.drive-drift');
    if (!el) return;
    new MutationObserver(() => {
      w.__drift.points = Math.max(w.__drift.points, Number(el.dataset.points) || 0);
      const etat = el.dataset.etat ?? '';
      if (!w.__drift.etats.includes(etat)) w.__drift.etats.push(etat);
    }).observe(el, { attributes: true, attributeFilter: ['data-points', 'data-etat'] });
  });
}
const compteur = (page: Page) => page.evaluate(() => (window as unknown as { __drift: { points: number; etats: string[] } }).__drift);

/**
 * Direction libre : le manche tenu par le doigt 1 (base en x0, y0) ramène la voiture dans l'axe, d'après le cap
 * (°, positif à gauche, glisse comprise) et l'écart à l'axe (m, positif à gauche) que publie la zone des gestes.
 */
async function redresser(page: Page, doigts: Doigts, x0: number, y0: number): Promise<void> {
  const zone = page.locator('.drive-mid');
  const cap = Number(await zone.getAttribute('data-cap')) || 0;
  const ecart = Number(await zone.getAttribute('data-ecart')) || 0;
  const braquage = Math.max(-1, Math.min(1, 0.04 * cap + 0.2 * ecart));
  // Inverse de la zone morte du manche (src/ui/drive/manche.ts : rayon 56 px, zone morte 0,16).
  const dx = Math.abs(braquage) < 0.05 ? 0 : Math.sign(braquage) * (0.16 + 0.84 * Math.abs(braquage)) * 56;
  await doigts.glisser(1, x0 + dx, y0, 1);
}

/** La direction assistée préférée, posée dans la sauvegarde de l'app ouverte (comme tests/e2e/entree-sortie.spec.ts), puis relue. */
async function preferer(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(JSON.stringify({ state: { direction: 'assistee' }, version: 2 }), 'pmb-sortie');
          tx.oncomplete = () => {
            open.result.close();
            done();
          };
          tx.onerror = () => fail(tx.error);
        };
      }),
  );
  await reloadSaved(page);
}

/** La direction préférée, lue dans la sauvegarde. */
const directionGardee = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('kv', 'readonly').objectStore('kv').get('pmb-sortie');
          get.onsuccess = () => {
            open.result.close();
            done((JSON.parse(String(get.result)) as { state: { direction: string } }).state.direction);
          };
          get.onerror = () => fail(get.error);
        };
      }),
  );

test.describe('format « Drift »', () => {
  test.use({ serviceWorkers: 'block' });

  test('en direction libre d’office, au bouton FREIN en paysage : la glisse part, les points s’affichent ; à l’arrivée, le score', async ({ page }) => {
    // En rendu logiciel de CI (une image par seconde), les 320 m de route passent les dix minutes : quinze.
    test.setTimeout(900_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/assets/maps/miami-beach/route.json', async (route) => {
      const response = await route.fetch();
      const json = (await response.json()) as { length: number; starts: { id: string; at: number }[] };
      const nord = json.starts.find((start) => start.id === 'nord');
      if (nord) nord.at = json.length - 320;
      await route.fulfill({ response, json });
    });
    await poserVehicule(page, 'concept');
    await openApp(page);
    await waitForScene(page);
    await preferer(page);
    await waitForScene(page);
    expect(await directionGardee(page)).toBe('assistee');
    await openEntry(page, ENTREE_SORTIE);
    await choisirCarte(page, 'Miami Beach', 'drift');
    await choisirDepart(page, /Vers la 41e rue/);
    // Le mode « Drift », une carte de l'écran « Jouer » (vague X) : pas de rangée de formats, « Jouer » le redit.
    await expect(dock(page).getByRole('group', { name: 'Format' })).toHaveCount(0);
    expect((await dock(page).getByRole('button', { name: 'Jouer', exact: true }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    await expect(dock(page).getByRole('button', { name: 'Jouer', exact: true })).toContainText('Drift');
    await shot(page, '01-menu-format-drift-390x844');
    if (CAPTURES) {
      await page.setViewportSize({ width: 844, height: 390 });
      await dock(page).getByRole('button', { name: 'Jouer', exact: true }).scrollIntoViewIfNeeded();
      await shot(page, '01b-menu-format-drift-844x390');
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await auSec(page);
    await dock(page).getByRole('button', { name: 'Jouer', exact: true }).tap();
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });

    // Téléphone couché : la manette (manche à gauche, GAZ, FREIN et NOS à droite). Sa préférence est l'assistée : au
    // drift, la direction est libre d'office, le choix grisé dit pourquoi.
    await page.setViewportSize({ width: 844, height: 390 });
    const panneau = await ouvrirReglages(page);
    const direction = panneau.getByRole('group', { name: 'Conduite assistée' });
    await expect(direction.getByRole('button', { name: 'Non', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(direction.getByRole('button', { name: 'Oui', exact: true })).toBeDisabled();
    await expect(panneau).toContainText('Au drift, pas de conduite assistée');
    await fermerReglages(page);
    await commencerCourse(page, { parti: true });
    const affichage = page.locator('.drive-drift');
    await expect(affichage).toHaveAttribute('data-score', '0');
    await expect(affichage).toHaveAttribute('data-etat', 'non');
    // La ligne qui dit le geste, au départ.
    await expect(affichage).toHaveAttribute('data-aide', 'oui');
    await expect(affichage.locator('.drive-drift-aide')).toBeVisible();
    await expect(affichage.locator('.drive-drift-aide')).toContainText('FREIN');
    await shot(page, '01c-ligne-d-aide-844x390');
    await suivreCompteur(page);

    const doigts = new Doigts(await page.context().newCDPSession(page));
    const gaz = await centre(page, '.drive-pave-gaz');
    const frein = await centre(page, '.drive-pave-btn:not(.drive-pave-gaz)');
    // GAZ tenu jusqu'à 50 km/h, le manche tenu pour rester dans l'axe (direction libre).
    const mid = await page.locator('.drive-mid').boundingBox();
    if (!mid) throw new Error('zone des gestes introuvable');
    const x0 = mid.x + 150;
    const y0 = mid.y + mid.height * 0.55;
    await doigts.poser(1, x0, y0);
    await doigts.poser(2, gaz.x, gaz.y);
    await attendreSurLaRoute(
      page,
      'vitesse',
      async () => {
        await redresser(page, doigts, x0, y0);
        return kmh(page);
      },
      (v) => v >= 50,
      { secondes: 20, horloge: 240_000 },
    );
    // Le manche poussé à droite, puis un coup bref sur FREIN : deux images de la page, et on relâche.
    await doigts.glisser(1, x0 + 50, y0, 2);
    await expect(page.locator('.drive-manche')).toHaveAttribute('data-actif', 'true');
    // Direction libre : les côtés du manche tournent (en assistée, ils placeraient).
    expect(Number(await page.locator('.drive-manche').getAttribute('data-placement'))).toBeGreaterThanOrEqual(0.5);
    await doigts.poser(3, frein.x, frein.y);
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    await doigts.lever(3);
    // La glisse part : les points du drift en cours à l'écran.
    await attendreSurLaRoute(page, 'points du drift', () => compteur(page), (c) => c.points > 0, { secondes: 3, horloge: 120_000, intervalle: 100 });
    await shot(page, '02-drift-en-cours-844x390');
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, '03-drift-en-cours-390x844');
    await page.setViewportSize({ width: 844, height: 390 });
    // Contre-braquer, puis tenir l'axe : la caisse se remet droite, le drift compte, le score monte.
    await attendreSurLaRoute(
      page,
      'score',
      async () => {
        await redresser(page, doigts, x0, y0);
        return Number(await affichage.getAttribute('data-score'));
      },
      (n) => n > 0,
      { secondes: 8, horloge: 240_000, intervalle: 100 },
    );
    expect((await compteur(page)).etats).toContain('glisse');
    // Le premier drift compté : la ligne d'aide s'efface.
    await expect(affichage).toHaveAttribute('data-aide', 'non');

    // GAZ tenu jusqu'au bout de la route : l'écran de fin, le score à la place du temps.
    const fin = page.locator('.fin-course');
    await attendreSurLaRoute(
      page,
      'écran de fin',
      async () => {
        if (await fin.isVisible()) return true;
        await redresser(page, doigts, x0, y0);
        return false;
      },
      (vu) => vu,
      { secondes: 60, horloge: 600_000, intervalle: 250 },
    );
    await doigts.toutLever();
    // Pas de clignotement : quelques changements d'affichage pour tout le parcours, pas un par image.
    expect(Number(await affichage.getAttribute('data-changements'))).toBeLessThanOrEqual(12);
    await expect(fin).toContainText('Drift');
    const score = Number(await fin.locator('.fin-course-temps').getAttribute('data-score'));
    expect(score).toBeGreaterThan(0);
    await expect(fin.locator('.fin-course-temps')).toHaveText(/^[\d\s ]+ points$/);
    await expect(fin.locator('.fin-course-record')).toContainText('Meilleur drift');
    await expect(fin.locator('.fin-course-gains')).toContainText('Parcours de drift fini');
    await expect(fin.locator('.fin-course-debloque')).toContainText('Premières glisses');
    await boutonsDeFin(page, ['Rejouer', 'Rentrer au garage']);
    await finEnDeuxColonnes(page, 'drift-844x390');
    await shot(page, '04-fin-drift-844x390');
    await page.setViewportSize({ width: 390, height: 844 });
    await finEnPortrait(page, 'drift-390x844');
    await shot(page, '05-fin-drift-390x844');
    await fin.getByRole('button', { name: 'Rentrer au garage' }).tap();
    await expect(stage(page)).toHaveCount(0, { timeout: DELAI_ROUTE });
    // Sa préférence n'a pas bougé : l'assistée revient hors du drift.
    expect(await directionGardee(page)).toBe('assistee');
    expect(errors).toEqual([]);
  });
});
