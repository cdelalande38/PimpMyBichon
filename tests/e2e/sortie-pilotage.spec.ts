// Sortie de nuit, pilotage au doigt (§ 5.5 ; retours du commanditaire du 16 novembre 2026) : écran de
// chargement qui nomme la carte et s'efface quand la route est prête ; mode de conduite toujours
// lisible ; à la main, la barre s'abaisse, l'amorce dit où poser le pouce, le manche virtuel apparaît
// sous le pouce : vers le haut la vitesse et le compte-tours montent (zones, passages), vers le bas elle
// baisse, sur les côtés le placement ; deux doigts à la fois (manche et NOS, manche et pause) sans que
// l'un lâche l'autre ; les pédales restent au choix dans les commandes ; la languette rappelle la
// barre ; la radio se déploie sans quitter la route ; le nom de la carte en entier, le compte-tours
// agrandi ; en paysage (844 × 390), la manette : manche à gauche, GAZ, FREIN et NOS à droite, rien ne
// se recouvre, tout offre 48 px, le manche et le GAZ répondent en même temps. Appuis tactiles seulement
// (aucune souris) : de vrais événements tactiles, par le protocole du navigateur.
// Captures : captures/vague-o-manette/.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const bar = (page: Page) => page.getByRole('contentinfo', { name: 'Commandes de la sortie' });
const dial = (page: Page) => page.locator('.drive-dial');
const mode = (page: Page) => page.getByRole('switch', { name: 'Conduite à la main' });
const kmh = async (page: Page) => Number(await stage(page).getAttribute('data-vitesse'));

async function shot(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'vague-o-manette', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
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
  test.setTimeout(600_000);

  test('chargement, mode lisible, manche, deux doigts, pédales au choix, compte-tours, NOS, languette, radio', async ({ page }) => {
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

    // Pilote automatique : le mode se lit, la barre est levée ; le nom de la carte en entier, le compte-tours agrandi.
    await expect(mode(page)).toHaveAttribute('aria-checked', 'false');
    await expect(mode(page)).toContainText('Pilote auto');
    await expect(bar(page)).toHaveAttribute('data-replie', 'false');
    await expect(bar(page).getByRole('button', { name: 'Rentrer au garage' })).toBeVisible();
    await expect(dial(page)).toBeVisible();
    expect((await dial(page).boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(140);
    await nomEntier(page);
    await page.locator('.drive-top').screenshot({ path: resolve('captures', 'vague-o-manette', '01-bandeau-390.png') });

    // Un appui bref sur la route, en pilote automatique : on propose de reprendre la main.
    const mid = page.locator('.drive-mid');
    await mid.tap({ position: { x: 195, y: 200 } });
    await expect(page.getByText('Reprendre la main ?')).toBeVisible();

    // À la main, au doigt : le mode change à l'écran, la barre s'abaisse, l'amorce dit où poser le pouce.
    await mode(page).tap();
    await expect(mode(page)).toHaveAttribute('aria-checked', 'true');
    await expect(mode(page)).toContainText('À la main');
    await expect(bar(page)).toHaveAttribute('data-replie', 'true');
    await expect(bar(page).getByRole('button', { name: 'Rentrer au garage' })).toBeHidden();
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
    await expect(mode(page)).toContainText('À la main');
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
    const pause = await centre(page, '.drive-top-droite > .drive-round');
    await doigts.poser(3, pause.x, pause.y);
    await doigts.lever(3);
    await expect(page.locator('.drive-top').getByRole('button', { name: 'Reprendre' })).toBeVisible();
    await expect(manche).toHaveAttribute('data-actif', 'true');
    await doigts.poser(3, pause.x, pause.y);
    await doigts.lever(3);
    await expect(page.locator('.drive-top').getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect(manche).toHaveAttribute('data-gaz', '1.00');

    // Sur les côtés, le placement : à gauche négatif, progressif.
    await doigts.glisser(1, x0 - 70, y0 - 20);
    await expect.poll(async () => Number(await manche.getAttribute('data-placement'))).toBeLessThan(-0.8);
    await shot(page, '05-manche-gauche');
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
    await expect(mode(page)).toContainText('À la main');
    await doigts.toutLever();

    // La languette rappelle la barre (et « Rentrer au garage ») ; les pédales, au choix, et le retour au manche.
    await page.getByRole('button', { name: 'Afficher les commandes' }).tap();
    await expect(bar(page)).toHaveAttribute('data-replie', 'false');
    await expect(bar(page).getByRole('button', { name: 'Rentrer au garage' })).toBeVisible();
    await page.getByRole('button', { name: 'Commande : Manche' }).tap();
    await expect(page.getByRole('button', { name: 'Commande : Pédales' })).toBeVisible();
    await expect(mid).toHaveAttribute('data-commande', 'pedales');
    await expect(page.locator('.drive-pedal[data-pedale="gaz"]')).toBeVisible();
    await shot(page, '06-barre-pedales');
    await page.getByRole('button', { name: 'Replier les commandes' }).tap();
    await expect(bar(page)).toHaveAttribute('data-replie', 'true');
    const gaz = await centre(page, '.drive-pedal[data-pedale="gaz"]');
    await doigts.poser(1, gaz.x, gaz.y);
    await expect(page.locator('.drive-pedal[data-pedale="gaz"]')).toHaveAttribute('data-appui', 'true');
    await doigts.toutLever();
    await expect(page.locator('.drive-pedal[data-pedale="gaz"]')).toHaveAttribute('data-appui', 'false');
    await page.getByRole('button', { name: 'Afficher les commandes' }).tap();
    await page.getByRole('button', { name: 'Commande : Pédales' }).tap();
    await expect(mid).toHaveAttribute('data-commande', 'manche');
    await page.getByRole('button', { name: 'Replier les commandes' }).tap();

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

    // Retour au pilote automatique : la barre remonte d'elle-même.
    await mode(page).tap();
    await expect(mode(page)).toContainText('Pilote auto');
    await expect(bar(page)).toHaveAttribute('data-replie', 'false');

    // Petit téléphone, à la main, à l'arrêt (manche tiré vers le bas) : l'amorce revient, rien ne se
    // recouvre, le nom de la carte reste entier.
    await page.setViewportSize({ width: 360, height: 780 });
    await mode(page).tap();
    const petit = await mid.boundingBox();
    if (!petit) throw new Error('zone des gestes introuvable');
    await jusquALArret(page, doigts, petit.x + petit.width / 2, petit.y + petit.height * 0.4, 70);
    await expect(page.locator('.drive-amorce')).toBeVisible();
    await page.waitForTimeout(500);
    await shot(page, '07-main-360');
    await nomEntier(page);
    await sansRecouvrement(
      page,
      ['.tuto-aide', '.drive-dial', '.drive-where', '.drive-top .quick-btn', '.drive-round', '.drive-mode', '.drive-tab', '.drive-nos', '.drive-amorce'],
      360,
      ['.tuto-aide', '.drive-top .quick-btn', '.drive-round', '.drive-mode', '.drive-tab', '.drive-nos'],
    );
    expect(errors).toEqual([]);
  });

  test('paysage : la manette, manche et GAZ en même temps, rien ne se recouvre', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    const errors: string[] = [];
    await sortir(page, errors);
    await mode(page).tap();
    await expect(mode(page)).toContainText('À la main');
    await expect(bar(page)).toHaveAttribute('data-replie', 'true');
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
      ['.tuto-aide', '.drive-dial', '.drive-where', '.drive-top .quick-btn', '.drive-round', '.drive-mode', '.drive-tab', '.drive-pave .drive-nos', '.drive-pave-gaz', '.drive-pave-btn:not(.drive-pave-gaz)', '.drive-amorce'],
      844,
      ['.tuto-aide', '.drive-top .quick-btn', '.drive-round', '.drive-mode', '.drive-tab', '.drive-pave .drive-nos', '.drive-pave-gaz', '.drive-pave-btn:not(.drive-pave-gaz)'],
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
