// Le format « Drift » (vague V, demande du 18 novembre 2026 : « le bouton de freins devrait permettre de faire des
// drifts. Les drift donnent des points ») : choisi au menu de la sortie, à côté de la balade et des courses ; en
// paysage, un coup bref sur le bouton FREIN de la manette, manche braqué et GAZ tenu, fait glisser l'arrière : les
// points du drift en cours s'affichent, puis le score ; à l'arrivée, l'écran de fin donne le score à la place du
// temps, le meilleur drift ou la phrase qui dit comment faire, la médaille et les gains.
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
import { attendreSurLaRoute, auSec, choisirCarte, choisirDepart, commencerCourse, DELAI_ROUTE, ENTREE_SORTIE, openApp, openEntry, reglerSortie, waitForScene } from './helpers.ts';

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const dock = (page: Page) => page.locator('footer.dock');
const format = (page: Page, nom: string) => dock(page).getByRole('group', { name: 'Format' }).getByRole('button', { name: new RegExp(`^${nom}`) });
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

test.describe('format « Drift »', () => {
  test.use({ serviceWorkers: 'block' });

  test('au bouton FREIN en paysage : la glisse part, les points s’affichent ; à l’arrivée, le score', async ({ page }) => {
    test.setTimeout(600_000);
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
    await openEntry(page, ENTREE_SORTIE);
    await choisirCarte(page, 'Miami Beach');
    await choisirDepart(page, /Vers la 41e rue/);
    // Le format « Drift », à côté de la balade et des courses : 48 px au doigt, redit sous « Sortir ».
    await format(page, 'Drift').tap();
    await expect(format(page, 'Drift')).toHaveAttribute('aria-pressed', 'true');
    expect((await format(page, 'Drift').boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    await expect(dock(page).getByRole('button', { name: 'Sortir', exact: true })).toContainText('Drift');
    await shot(page, '01-menu-format-drift-390x844');
    if (CAPTURES) {
      await page.setViewportSize({ width: 844, height: 390 });
      await format(page, 'Drift').scrollIntoViewIfNeeded();
      await shot(page, '01b-menu-format-drift-844x390');
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await auSec(page);
    await dock(page).getByRole('button', { name: 'Sortir', exact: true }).tap();
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });

    // Téléphone couché : la manette (manche à gauche, GAZ, FREIN et NOS à droite). Direction assistée : l'aide tient
    // la route et l'angle, le manche ne fait que donner le côté.
    await page.setViewportSize({ width: 844, height: 390 });
    await reglerSortie(page, 'Direction', 'Assistée');
    await commencerCourse(page, { parti: true });
    const affichage = page.locator('.drive-drift');
    await expect(affichage).toHaveAttribute('data-score', '0');
    await expect(affichage).toHaveAttribute('data-etat', 'non');
    await suivreCompteur(page);

    const doigts = new Doigts(await page.context().newCDPSession(page));
    const gaz = await centre(page, '.drive-pave-gaz');
    const frein = await centre(page, '.drive-pave-btn:not(.drive-pave-gaz)');
    // GAZ tenu jusqu'à 50 km/h.
    await doigts.poser(2, gaz.x, gaz.y);
    await attendreSurLaRoute(page, 'vitesse', () => kmh(page), (v) => v >= 50, { secondes: 20, horloge: 240_000 });
    // Le manche poussé à droite, puis un coup bref sur FREIN : deux images de la page, et on relâche.
    const mid = await page.locator('.drive-mid').boundingBox();
    if (!mid) throw new Error('zone des gestes introuvable');
    const x0 = mid.x + 150;
    const y0 = mid.y + mid.height * 0.55;
    await doigts.poser(1, x0, y0);
    await doigts.glisser(1, x0 + 80, y0);
    await expect(page.locator('.drive-manche')).toHaveAttribute('data-actif', 'true');
    await doigts.poser(3, frein.x, frein.y);
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    await doigts.lever(3);
    // La glisse part : les points du drift en cours à l'écran.
    await attendreSurLaRoute(page, 'points du drift', () => compteur(page), (c) => c.points > 0, { secondes: 3, horloge: 120_000, intervalle: 100 });
    await shot(page, '02-drift-en-cours-844x390');
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, '03-drift-en-cours-390x844');
    await page.setViewportSize({ width: 844, height: 390 });
    await doigts.lever(1);
    // Le drift compte : le score monte.
    await attendreSurLaRoute(page, 'score', async () => Number(await affichage.getAttribute('data-score')), (n) => n > 0, { secondes: 5, horloge: 180_000 });
    expect((await compteur(page)).etats).toContain('glisse');

    // GAZ tenu jusqu'au bout de la route : l'écran de fin, le score à la place du temps.
    const fin = page.locator('.fin-course');
    await attendreSurLaRoute(page, 'écran de fin', () => fin.isVisible(), (vu) => vu, { secondes: 60, horloge: 420_000, intervalle: 500 });
    await doigts.toutLever();
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
    expect(errors).toEqual([]);
  });
});
