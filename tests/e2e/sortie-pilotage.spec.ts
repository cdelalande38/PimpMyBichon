// Sortie de nuit, pilotage au doigt (§ 5.5 ; retours du commanditaire du 16 novembre 2026) : écran de
// chargement qui nomme la carte et s'efface quand la route est prête ; mode de conduite toujours
// lisible ; à la main, la barre s'abaisse, l'amorce dit où poser le pouce, le manche virtuel apparaît
// sous le pouce : vers le haut la vitesse et le compte-tours montent (zones, passages), vers le bas elle
// baisse, sur les côtés la direction ; deux doigts à la fois (manche et NOS, manche et pause) sans que
// l'un lâche l'autre ; les pédales restent au choix dans les commandes ; la languette rappelle la
// barre ; la radio se déploie sans quitter la route ; le nom de la carte en entier, le compte-tours
// agrandi ; en paysage (844 × 390), la manette : manche à gauche, GAZ, FREIN et NOS à droite, rien ne
// se recouvre, tout offre 48 px, le manche et le GAZ répondent en même temps. Appuis tactiles seulement
// (aucune souris) : de vrais événements tactiles, par le protocole du navigateur.
// Direction (vague P, demandes du 16 novembre 2026) : passer à la main met la poursuite et coupe le
// réalisateur, et rien ne les remet au retour en pilote automatique ; en direction libre (par défaut)
// le manche braque vraiment (le véhicule prend un cap, la caisse quitte sa place) ; en direction
// assistée, l'ancien comportement : le manche place le véhicule, qui revient ensuite sur sa trajectoire.
// Écart (m), cap (°) et glissement relevés sur la zone des gestes (data-ecart, data-cap, data-glisse).
// Captures : captures/vague-o-manette/, captures/vague-p-direction/.
// Déroulé (vague Q, demande du 17 novembre 2026) : la sortie s'ouvre sur l'aperçu (pilote automatique,
// réalisateur, presque rien à l'écran) ; un appui sur la route lance la course à la main depuis la
// ligne ; tout le reste (caméra, direction, commande, pilote automatique) passe par les réglages.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { attendreApercu, commencerCourse, fermerReglages, ouvrirReglages, reglagesSortie, reglerSortie } from './helpers.ts';

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const dial = (page: Page) => page.locator('.drive-dial');
/** Qui conduit : « main » ou « auto » (posé sur la zone des gestes). */
const conduite = (page: Page) => page.locator('.drive-mid');
const kmh = async (page: Page) => Number(await stage(page).getAttribute('data-vitesse'));

async function shot(page: Page, name: string, dir = 'vague-o-manette'): Promise<void> {
  const path = resolve('captures', dir, `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

const gestes = (page: Page) => page.locator('.drive-mid');
const ecart = async (page: Page) => Number(await gestes(page).getAttribute('data-ecart'));
const realisateur = (page: Page) => reglagesSortie(page).getByRole('button', { name: 'Réalisateur' });

/**
 * Relève sur la zone des gestes, à chaque changement, le cap le plus fort à gauche et à droite (°) et
 * l'écart le plus grand (m) depuis le dernier appel ; rend ceux de l'appel précédent.
 */
async function releves(page: Page): Promise<{ capMax: number; capMin: number; ecartMax: number; ecartMin: number }> {
  return page.evaluate(() => {
    const w = window as unknown as { __releves?: { capMax: number; capMin: number; ecartMax: number; ecartMin: number } };
    const el = document.querySelector<HTMLElement>('.drive-mid');
    const before = w.__releves ?? { capMax: 0, capMin: 0, ecartMax: -1e9, ecartMin: 1e9 };
    const r = { capMax: -1e9, capMin: 1e9, ecartMax: -1e9, ecartMin: 1e9 };
    w.__releves = r;
    if (el && !el.dataset.observe) {
      el.dataset.observe = 'oui';
      new MutationObserver(() => {
        const cur = w.__releves;
        if (!cur) return;
        const cap = Number(el.dataset.cap);
        const e = Number(el.dataset.ecart);
        if (Number.isFinite(cap)) {
          cur.capMax = Math.max(cur.capMax, cap);
          cur.capMin = Math.min(cur.capMin, cap);
        }
        if (Number.isFinite(e)) {
          cur.ecartMax = Math.max(cur.ecartMax, e);
          cur.ecartMin = Math.min(cur.ecartMin, e);
        }
      }).observe(el, { attributes: true, attributeFilter: ['data-cap', 'data-ecart'] });
    }
    return before;
  });
}

/** Met un véhicule à l'écran par la sauvegarde des builds (idb-keyval). */
async function putOnScreen(page: Page, id: string): Promise<void> {
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

type Point = { x: number; y: number; id: number };

/** Les doigts posés, envoyés tous ensemble à chaque changement (protocole du navigateur). */
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
  /** Glisse un doigt jusqu'en (x, y), en quelques pas. */
  async glisser(id: number, x: number, y: number, pas = 5): Promise<void> {
    const from = this.points.get(id);
    if (!from) throw new Error(`doigt ${id} absent`);
    for (let i = 1; i <= pas; i += 1) {
      this.points.set(id, { id, x: from.x + ((x - from.x) * i) / pas, y: from.y + ((y - from.y) * i) / pas });
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.list() });
    }
  }
  /** Lève un seul doigt (fin de contact pour lui seul) : les autres restent posés. */
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

/** Rien ne se recouvre, rien ne sort de l'écran, chaque commande offre 48 px. */
async function sansRecouvrement(page: Page, selectors: string[], width: number, commandes: string[] = []): Promise<void> {
  const boxes = await page.evaluate(
    (sels) =>
      sels.map((sel) => {
        const r = document.querySelector(sel)?.getBoundingClientRect();
        return r ? { sel, x: r.x, y: r.y, w: r.width, h: r.height } : { sel, x: 0, y: 0, w: 0, h: 0 };
      }),
    selectors,
  );
  for (const a of boxes) {
    expect(a.w, a.sel).toBeGreaterThan(0);
    expect(a.x, a.sel).toBeGreaterThanOrEqual(-0.5);
    expect(a.x + a.w, a.sel).toBeLessThanOrEqual(width + 0.5);
    if (commandes.includes(a.sel)) {
      expect(a.w, a.sel).toBeGreaterThanOrEqual(47.5);
      expect(a.h, a.sel).toBeGreaterThanOrEqual(47.5);
    }
    for (const b of boxes) {
      if (a === b) continue;
      const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
      expect(overlap, `${a.sel} / ${b.sel}`).toBe(false);
    }
  }
}

/** Le nom de la carte tient en entier (jamais coupé) et passe au-dessus du « ? » de l'aide. */
async function nomEntier(page: Page): Promise<void> {
  const mesure = await page.evaluate(() => {
    const name = document.querySelector<HTMLElement>('.drive-map');
    const where = document.querySelector('.drive-where')?.getBoundingClientRect();
    const aide = document.querySelector('.tuto-aide')?.getBoundingClientRect();
    return name && where ? { scroll: name.scrollWidth, client: name.clientWidth, bas: where.bottom, aide: aide?.top ?? 1e9, texte: name.textContent ?? '' } : null;
  });
  expect(mesure).not.toBeNull();
  if (!mesure) return;
  expect(mesure.scroll).toBeLessThanOrEqual(mesure.client + 1);
  expect(mesure.bas).toBeLessThanOrEqual(mesure.aide);
  expect(mesure.texte.length).toBeGreaterThan(3);
}

/** Garde le doigt `id` posé en (x, y) jusqu'à l'arrêt complet, puis le lève. */
async function jusquALArret(page: Page, doigts: Doigts, x: number, y: number, glisse = 0): Promise<void> {
  await doigts.poser(1, x, y);
  if (glisse) await doigts.glisser(1, x, y + glisse);
  await expect.poll(() => kmh(page), { timeout: 150_000 }).toBeLessThanOrEqual(0);
  await doigts.toutLever();
}

async function sortir(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await putOnScreen(page, 'concept');
  await page.goto('./#/sortie');
  await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
  await expect(page.locator('.drive-chargement')).toHaveCount(0, { timeout: 10_000 });
}

test.describe('sortie de nuit, pilotage au doigt', () => {
  // Délai large : sur les machines de la CI (rendu logiciel, une image par seconde), le premier parcours
  // dépasse dix minutes depuis qu'il passe par l'aperçu, les feux et les réglages (CI du 17 novembre 2026).
  test.setTimeout(1_500_000);

  test('chargement, aperçu, course à la main, manche, deux doigts, réglages, pédales au choix, compte-tours, NOS, radio, pilote', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('./');
    await putOnScreen(page, 'concept');

    // Chargement : plein écran, la carte nommée, « Rentrer au garage » atteignable ; parti une fois la route prête.
    await page.goto('./#/sortie');
    const loading = page.locator('.drive-chargement');
    await expect(loading).toBeVisible({ timeout: 30_000 });
    await expect(loading.locator('.tuto-marque b')).not.toBeEmpty();
    await expect(loading.getByRole('button', { name: 'Rentrer au garage' })).toBeVisible();
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
    await expect(loading).toHaveCount(0, { timeout: 10_000 });

    // L'aperçu : pilote automatique, presque rien à l'écran (le nom de la carte entier, la radio, les
    // réglages, l'invitation) ; ni compte-tours, ni pause, ni commandes.
    await attendreApercu(page);
    await expect(conduite(page)).toHaveAttribute('data-conduite', 'auto');
    await expect(dial(page)).toHaveCount(0);
    await expect(page.locator('.drive-pause')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'NOS' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Réglages de la sortie' })).toBeVisible();
    await nomEntier(page);
    // Pilote automatique au premier lancement : le réalisateur est mis d'office.
    await ouvrirReglages(page);
    await expect(realisateur(page)).toHaveAttribute('aria-pressed', 'true');
    await fermerReglages(page);
    // Un appui bref sur la route : la course, à la main ; la caméra passe en poursuite, le réalisateur se
    // coupe ; l'amorce dit où poser le pouce ; le compte-tours agrandi apparaît.
    const mid = page.locator('.drive-mid');
    await commencerCourse(page);
    await expect(stage(page)).toHaveAttribute('data-camera', 'poursuite');
    await expect(dial(page)).toBeVisible();
    expect((await dial(page).boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(140);
    await nomEntier(page);
    await page.locator('.drive-top').screenshot({ path: resolve('captures', 'vague-o-manette', '01-bandeau-390.png') });
    await ouvrirReglages(page);
    await expect(realisateur(page)).toHaveAttribute('aria-pressed', 'false');
    await fermerReglages(page);
    await expect(mid).toHaveAttribute('data-commande', 'manche');
    await expect(page.locator('.drive-amorce')).toBeVisible();
    await expect(page.locator('.drive-pedal')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'NOS' })).toBeVisible();
    const box = await mid.boundingBox();
    if (!box) throw new Error('zone des gestes introuvable');
    const cdp = await page.context().newCDPSession(page);
    const doigts = new Doigts(cdp);
    const manche = page.locator('.drive-manche');
    // Manche tiré vers le bas jusqu'à l'arrêt : l'amorce est là, à l'arrêt.
    await jusquALArret(page, doigts, box.x + box.width * 0.5, box.y + box.height * 0.4, 70);
    await expect(page.locator('.drive-amorce')).toBeVisible();
    await page.waitForTimeout(500);
    await shot(page, '02-main-arret-amorce');

    // Le manche : le pouce se pose, la base apparaît sous lui ; poussé vers le haut, la vitesse monte,
    // le compte-tours passe au vert, à l'orange, passe un rapport.
    const before = await kmh(page);
    const x0 = box.x + box.width * 0.5;
    const y0 = box.y + box.height * 0.6;
    await doigts.poser(1, x0, y0);
    await expect(manche).toHaveAttribute('data-actif', 'true');
    await expect(page.locator('.drive-amorce')).toHaveCount(0);
    await doigts.glisser(1, x0 + 4, y0 - 70);
    await expect(manche).toHaveAttribute('data-gaz', '1.00');
    await expect(manche).toHaveAttribute('data-frein', '0.00');
    await expect(conduite(page)).toHaveAttribute('data-conduite', 'main');
    await shot(page, '03-manche-haut');
    await expect(dial(page)).toHaveAttribute('data-zone', /vert|orange|rouge/, { timeout: 60_000 });
    await expect(dial(page)).toHaveAttribute('data-zone', 'orange', { timeout: 120_000 });
    const gear = Number(await dial(page).getAttribute('data-rapport'));
    await expect.poll(async () => Number(await dial(page).getAttribute('data-rapport')), { timeout: 120_000, intervals: [100] }).toBeGreaterThan(gear);
    await expect.poll(() => kmh(page), { timeout: 120_000 }).toBeGreaterThan(before + 30);
    await expect(Number(await dial(page).getAttribute('data-rapport'))).toBeGreaterThanOrEqual(2);

    // Deux doigts à la fois : le manche reste tenu pendant qu'un second doigt envoie le NOS.
    const nos = await centre(page, '.drive-nos');
    await doigts.poser(2, nos.x, nos.y);
    await expect(page.getByRole('button', { name: 'NOS' })).toHaveAttribute('data-nos', 'envoye', { timeout: 30_000 });
    await expect(dial(page)).toHaveAttribute('data-nos', 'true');
    await expect(manche).toHaveAttribute('data-actif', 'true');
    await expect(manche).toHaveAttribute('data-gaz', '1.00');
    await shot(page, '04-deux-doigts-manche-nos');
    await doigts.lever(2);
    // Le doigt du NOS levé : le manche tient toujours.
    await expect(manche).toHaveAttribute('data-actif', 'true');
    await expect(manche).toHaveAttribute('data-gaz', '1.00');
    await expect.poll(async () => Number(await page.getByRole('button', { name: 'NOS' }).getAttribute('data-reserve')), { timeout: 60_000 }).toBeLessThan(100);

    // Second doigt sur la pause : la sortie s'arrête, le manche reste tenu ; un autre appui la relance.
    const pause = await centre(page, '.drive-pause');
    await doigts.poser(3, pause.x, pause.y);
    await doigts.lever(3);
    await expect(page.locator('.drive-top').getByRole('button', { name: 'Reprendre' })).toBeVisible();
    await expect(manche).toHaveAttribute('data-actif', 'true');
    await doigts.poser(3, pause.x, pause.y);
    await doigts.lever(3);
    await expect(page.locator('.drive-top').getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect(manche).toHaveAttribute('data-gaz', '1.00');

    // Sur les côtés, la direction (libre, par défaut) : à gauche négatif, progressif ; le véhicule
    // braque vraiment, il prend un cap à gauche puis, de l'autre côté, à droite.
    await releves(page);
    await doigts.glisser(1, x0 - 70, y0 - 20);
    await expect.poll(async () => Number(await manche.getAttribute('data-placement'))).toBeLessThan(-0.8);
    await expect.poll(async () => (await releves(page)).capMax, { timeout: 120_000 }).toBeGreaterThanOrEqual(3);
    await shot(page, '05-manche-gauche');
    await shot(page, 'portrait-virage-gauche', 'vague-p-direction');
    await doigts.glisser(1, x0 + 70, y0 - 20);
    await expect.poll(async () => (await releves(page)).capMin, { timeout: 120_000 }).toBeLessThanOrEqual(-3);
    await doigts.glisser(1, x0, y0 - 40);
    // Lâché : le manche s'efface, ni gaz ni frein.
    await doigts.toutLever();
    await expect(manche).toHaveAttribute('data-actif', 'false');
    await expect(manche).toHaveAttribute('data-gaz', '0.00');

    // Pouce posé en bas à gauche, poussé vers le bas (et un peu à gauche) : le frein, la vitesse
    // baisse ; le mode reste juste.
    const fast = await kmh(page);
    const xb = box.x + 80;
    const yb = box.y + box.height - 110;
    await doigts.poser(1, xb, yb);
    await doigts.glisser(1, xb - 30, yb + 60);
    await expect.poll(async () => Number(await manche.getAttribute('data-frein'))).toBeGreaterThan(0.8);
    await expect.poll(async () => Number(await manche.getAttribute('data-placement'))).toBeLessThan(-0.2);
    await shot(page, '05b-manche-bas-gauche');
    await expect.poll(() => kmh(page), { timeout: 120_000 }).toBeLessThan(fast - 15);
    await expect(conduite(page)).toHaveAttribute('data-conduite', 'main');
    await doigts.toutLever();

    // Direction assistée, dans les réglages : l'ancien comportement. Manche à gauche, la place glisse à
    // gauche ; lâché sur le côté, elle tient puis revient sur la trajectoire. Puis retour à la direction libre.
    const reglages = await ouvrirReglages(page);
    await expect(reglages.getByRole('group', { name: 'Direction' }).getByRole('button', { name: 'Libre', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Les réglages ouverts mettent la course en pause.
    await expect(page.locator('.drive-pause')).toHaveAttribute('aria-pressed', 'true');
    await shot(page, 'portrait-reglages-direction', 'vague-p-direction');
    await reglerSortie(page, 'Direction', 'Assistée');
    await expect(page.locator('.drive-pause')).toHaveAttribute('aria-pressed', 'false');
    await doigts.poser(1, x0, y0);
    await doigts.glisser(1, x0, y0 - 50);
    await expect.poll(() => kmh(page), { timeout: 120_000 }).toBeGreaterThan(30);
    await releves(page);
    const avant = await ecart(page);
    await doigts.glisser(1, x0 - 70, y0 - 40);
    await expect.poll(async () => (await releves(page)).ecartMax, { timeout: 120_000 }).toBeGreaterThan(avant + 0.8);
    const loin = await ecart(page);
    await doigts.glisser(1, x0, y0 - 40);
    await expect.poll(() => ecart(page), { timeout: 150_000 }).toBeLessThan(loin - 0.8);
    await doigts.toutLever();
    await reglerSortie(page, 'Direction', 'Libre');

    // Les réglages rangent aussi « Rentrer au garage » ; les pédales, au choix, et le retour au manche.
    await ouvrirReglages(page);
    await expect(reglagesSortie(page).getByRole('button', { name: 'Rentrer au garage' })).toBeVisible();
    await reglerSortie(page, 'Commande', 'Pédales');
    await expect(mid).toHaveAttribute('data-commande', 'pedales');
    await expect(page.locator('.drive-pedal[data-pedale="gaz"]')).toBeVisible();
    await shot(page, '06-reglages-pedales');
    const gaz = await centre(page, '.drive-pedal[data-pedale="gaz"]');
    await doigts.poser(1, gaz.x, gaz.y);
    await expect(page.locator('.drive-pedal[data-pedale="gaz"]')).toHaveAttribute('data-appui', 'true');
    await doigts.toutLever();
    await expect(page.locator('.drive-pedal[data-pedale="gaz"]')).toHaveAttribute('data-appui', 'false');
    await reglerSortie(page, 'Commande', 'Manche');
    await expect(mid).toHaveAttribute('data-commande', 'manche');

    // La radio : le mini-lecteur se déploie sans quitter la route ni mettre en pause.
    await page.locator('.drive-top').getByRole('button', { name: /^Radio/ }).tap();
    await expect(page.locator('#radio-mini')).toBeVisible();
    await expect(page).toHaveURL(/#\/sortie$/);
    await expect(page.locator('.drive-top').getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    const aide = await page.locator('.tuto-aide').boundingBox();
    const mini = await page.locator('#radio-mini').boundingBox();
    if (aide && mini) expect(mini.y).toBeGreaterThanOrEqual(aide.y + aide.height);
    await page.locator('.drive-top .quick-btn').tap();
    await expect(page.locator('#radio-mini')).toBeHidden();

    // « Pilote automatique » des réglages : le pilote reprend où l'on est (le chrono continue), le
    // réalisateur revient (comme dans l'aperçu), plus de commandes ; un appui sur la route reprend la main.
    const chrono = Number(await stage(page).getAttribute('data-chrono'));
    await (await ouvrirReglages(page)).getByRole('button', { name: 'Pilote automatique' }).tap();
    await expect(reglagesSortie(page)).toHaveCount(0);
    await expect(conduite(page)).toHaveAttribute('data-conduite', 'auto');
    await expect(page.locator('.drive-invite')).toHaveText('Touche l’écran pour reprendre la main');
    await expect(page.locator('.drive-manche')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'NOS' })).toHaveCount(0);
    await expect(stage(page)).toHaveAttribute('data-depart', 'parti');
    await expect.poll(async () => Number(await stage(page).getAttribute('data-chrono')), { timeout: 150_000 }).toBeGreaterThan(chrono);
    await ouvrirReglages(page);
    await expect(realisateur(page)).toHaveAttribute('aria-pressed', 'true');
    await fermerReglages(page);
    // Petit téléphone, à la main, à l'arrêt (manche tiré vers le bas) : l'amorce revient, rien ne se
    // recouvre, le nom de la carte reste entier.
    await page.setViewportSize({ width: 360, height: 780 });
    const petit = await mid.boundingBox();
    if (!petit) throw new Error('zone des gestes introuvable');
    await mid.tap({ position: { x: petit.width / 2, y: petit.height * 0.4 } });
    await expect(conduite(page)).toHaveAttribute('data-conduite', 'main');
    await expect(stage(page)).toHaveAttribute('data-camera', 'poursuite');
    await jusquALArret(page, doigts, petit.x + petit.width / 2, petit.y + petit.height * 0.4, 70);
    await expect(page.locator('.drive-amorce')).toBeVisible();
    await page.waitForTimeout(500);
    await shot(page, '07-main-360');
    await nomEntier(page);
    await sansRecouvrement(
      page,
      ['.tuto-aide', '.drive-dial', '.drive-where', '.drive-top .quick-btn', '.drive-reglages-btn', '.drive-pause', '.drive-minicarte-place', '.drive-nos', '.drive-amorce'],
      360,
      ['.tuto-aide', '.drive-top .quick-btn', '.drive-reglages-btn', '.drive-pause', '.drive-nos'],
    );
    expect(errors).toEqual([]);
  });

  test('paysage : la manette, manche et GAZ en même temps, rien ne se recouvre', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    const errors: string[] = [];
    await sortir(page, errors);
    // L'aperçu en paysage : ni pavé ni compte-tours ; un appui lance la course, la manette apparaît.
    await attendreApercu(page);
    await expect(page.locator('.drive-pave')).toHaveCount(0);
    await expect(dial(page)).toHaveCount(0);
    await commencerCourse(page);
    await expect(dial(page)).toBeVisible();
    // En paysage, la manette : GAZ, FREIN et NOS à droite ; le choix des pédales n'a pas lieu d'être.
    await expect(page.getByRole('button', { name: 'Gaz', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Frein', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'NOS' })).toBeVisible();
    await expect(page.locator('.drive-mid')).toHaveAttribute('data-commande', 'manche');
    // À l'arrêt (FREIN tenu) : l'amorce dit où poser le pouce gauche.
    const cdp = await page.context().newCDPSession(page);
    const doigts = new Doigts(cdp);
    const frein = await centre(page, '.drive-pave-btn:not(.drive-pave-gaz)');
    await jusquALArret(page, doigts, frein.x, frein.y);
    await expect(page.locator('.drive-amorce')).toBeVisible();
    await page.waitForTimeout(500);
    await shot(page, '08-paysage-arret');
    await sansRecouvrement(
      page,
      ['.tuto-aide', '.drive-dial', '.drive-where', '.drive-top .quick-btn', '.drive-reglages-btn', '.drive-pause', '.drive-minicarte-place', '.drive-pave .drive-nos', '.drive-pave-gaz', '.drive-pave-btn:not(.drive-pave-gaz)', '.drive-amorce'],
      844,
      ['.tuto-aide', '.drive-top .quick-btn', '.drive-reglages-btn', '.drive-pause', '.drive-pave .drive-nos', '.drive-pave-gaz', '.drive-pave-btn:not(.drive-pave-gaz)'],
    );

    // Le manche sous le pouce gauche (placement) et le GAZ sous le pouce droit, en même temps.
    const mid = await page.locator('.drive-mid').boundingBox();
    if (!mid) throw new Error('zone des gestes introuvable');
    const x0 = mid.x + 150;
    const y0 = mid.y + mid.height * 0.55;
    await doigts.poser(1, x0, y0);
    await doigts.glisser(1, x0 + 60, y0);
    const gaz = await centre(page, '.drive-pave-gaz');
    const before = await kmh(page);
    await doigts.poser(2, gaz.x, gaz.y);
    await expect(page.getByRole('button', { name: 'Gaz', exact: true })).toHaveAttribute('data-appui', 'true');
    await expect(page.locator('.drive-manche')).toHaveAttribute('data-actif', 'true');
    await expect.poll(async () => Number(await page.locator('.drive-manche').getAttribute('data-placement'))).toBeGreaterThan(0.8);
    await expect.poll(() => kmh(page), { timeout: 120_000 }).toBeGreaterThan(before + 15);
    await shot(page, '09-paysage-roule');
    // Le pouce gauche levé : le GAZ tient toujours.
    await doigts.lever(1);
    await expect(page.locator('.drive-manche')).toHaveAttribute('data-actif', 'false');
    await expect(page.getByRole('button', { name: 'Gaz', exact: true })).toHaveAttribute('data-appui', 'true');
    await doigts.toutLever();
    await expect(page.getByRole('button', { name: 'Gaz', exact: true })).toHaveAttribute('data-appui', 'false');
    expect(errors).toEqual([]);
  });
});
