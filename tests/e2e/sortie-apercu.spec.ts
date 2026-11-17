// Aperçu de la sortie de nuit (vague Q, demande du 17 novembre 2026) : la sortie s'ouvre sur la route
// en pilote automatique, avec le réalisateur ; à l'écran, presque rien (le nom de la carte, la radio, la
// petite icône des réglages, « Touche l'écran pour commencer ») ; un appui sur la route lance la course
// à la main depuis la ligne, aux feux, avec l'offre « Mode manette » en portrait ; les réglages rangent
// tout le reste, mettent la course en pause (pas l'aperçu), et tiennent en 390 × 844, 360 × 780 et
// 844 × 390, cibles de 48 px. « Repartir » relance les feux, « Pilote automatique » rend le volant sans
// perdre le parcours. L'arrivée (panneau « Arrivée », « Repartir ») n'est pas parcourue ici : il
// faudrait rouler plus d'un kilomètre, des minutes en rendu logiciel ; son cœur est prouvé par
// tests/unit/drive-depart.test.ts.
// Délais larges : en rendu logiciel la scène avance d'un dixième de seconde par image.
// Captures : captures/vague-q-attente/ (vague Q), captures/vague-r-course/ (vague R : boutons du haut en paysage, texte très grand).

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { attendreApercu, commencerCourse, DELAI_ROUTE, fermerReglages, ouvrirReglages, reglagesSortie, rentrerAuGarage } from './helpers.ts';

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const attr = async (page: Page, name: string) => Number(await stage(page).getAttribute(name));

async function shot(page: Page, name: string, dossier = 'vague-q-attente'): Promise<void> {
  const path = resolve('captures', dossier, `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

/** Rien ne se recouvre, rien ne sort de l'écran, chaque commande offre 48 px. */
async function sansRecouvrement(page: Page, selectors: string[], commandes: string[]): Promise<void> {
  const size = page.viewportSize();
  if (!size) throw new Error('taille de page inconnue');
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
    expect(a.x + a.w, a.sel).toBeLessThanOrEqual(size.width + 0.5);
    expect(a.y + a.h, a.sel).toBeLessThanOrEqual(size.height + 0.5);
    if (commandes.includes(a.sel)) {
      expect(a.w, `${a.sel} ${JSON.stringify(a)}`).toBeGreaterThanOrEqual(47.5);
      expect(a.h, `${a.sel} ${JSON.stringify(a)}`).toBeGreaterThanOrEqual(47.5);
    }
    for (const b of boxes) {
      if (a === b) continue;
      const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
      expect(overlap, `${a.sel} / ${b.sel}`).toBe(false);
    }
  }
}

const BOUTONS_HAUT = '.tuto-aide, .drive-top .quick-btn, .drive-reglages-btn, .drive-pause';

/**
 * Chaque bouton du haut de l'écran (« ? », radio, réglages, pause) offre 48 px au doigt, en largeur comme
 * en hauteur, aux trois tailles de texte : plusieurs mesures étalées sur une demi-seconde (l'échec rare
 * du premier passage, 47,5 px, venait d'une mesure prise pendant que la mise en page bougeait).
 */
async function boutonsDuHaut48(page: Page, attendus: number, contexte: string): Promise<void> {
  for (const texte of ['normal', 'grand', 'tres-grand']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.text = value;
    }, texte);
    for (let essai = 0; essai < 5; essai += 1) {
      await page.waitForTimeout(100);
      const boites = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => {
        const r = el.getBoundingClientRect();
        return { nom: el.getAttribute('aria-label') ?? el.className, w: r.width, h: r.height };
      }), BOUTONS_HAUT);
      expect(boites.length, `${contexte}, texte ${texte}`).toBe(attendus);
      for (const b of boites) {
        expect(b.w, `${contexte}, texte ${texte} : ${b.nom} largeur`).toBeGreaterThanOrEqual(48);
        expect(b.h, `${contexte}, texte ${texte} : ${b.nom} hauteur`).toBeGreaterThanOrEqual(48);
      }
    }
  }
}

/** L'aperçu : presque rien à l'écran, le véhicule roule déjà (départ lancé, sans feux). */
async function verifierApercu(page: Page): Promise<void> {
  await attendreApercu(page);
  await expect(page.locator('.drive-mid')).toHaveAttribute('data-conduite', 'auto');
  await expect(page.locator('.drive-map')).not.toBeEmpty();
  await expect(page.getByRole('button', { name: 'Réglages de la sortie' })).toBeVisible();
  await expect(page.locator('.drive-top').getByRole('button', { name: /^Radio/ })).toBeVisible();
  for (const sel of ['.drive-dial', '.drive-feux', '.drive-chrono', '.drive-pause', '.drive-progress', '.drive-nos', '.drive-pave', '.drive-manche', '.drive-amorce', '.drive-pedals', '.drive-minicarte-place', '.drive-offre-manette']) {
    await expect(page.locator(sel), sel).toHaveCount(0);
  }
  // Les seuls boutons à l'écran : l'aide « ? », la radio, les réglages.
  const autres = await page.locator('.app button:visible').evaluateAll(
    (els) => els.filter((el) => !el.matches('.tuto-aide, .drive-reglages-btn, .drive-top .quick-btn')).map((el) => el.getAttribute('aria-label') ?? el.textContent ?? ''),
  );
  expect(autres).toEqual([]);
  await expect(stage(page)).toHaveAttribute('data-depart', 'parti');
  await expect.poll(() => attr(page, 'data-vitesse'), { timeout: DELAI_ROUTE }).toBeGreaterThan(5);
  await sansRecouvrement(page, ['.tuto-aide', '.drive-where', '.drive-top .quick-btn', '.drive-reglages-btn', '.drive-invite'], ['.tuto-aide', '.drive-top .quick-btn', '.drive-reglages-btn']);
}

/** Les réglages ouverts : tout tient dans l'écran, chaque bouton offre 48 px. */
async function reglagesLisibles(page: Page): Promise<void> {
  const size = page.viewportSize();
  if (!size) throw new Error('taille de page inconnue');
  const panneau = reglagesSortie(page);
  const cadre = await panneau.boundingBox();
  if (!cadre) throw new Error('réglages introuvables');
  expect(cadre.x).toBeGreaterThanOrEqual(-0.5);
  expect(cadre.y).toBeGreaterThanOrEqual(-0.5);
  expect(cadre.x + cadre.width).toBeLessThanOrEqual(size.width + 0.5);
  expect(cadre.y + cadre.height).toBeLessThanOrEqual(size.height + 0.5);
  const boutons = panneau.getByRole('button');
  const n = await boutons.count();
  expect(n).toBeGreaterThan(15);
  for (let i = 0; i < n; i += 1) {
    const bouton = boutons.nth(i);
    const nom = ((await bouton.getAttribute('aria-label')) ?? (await bouton.innerText())).trim();
    const box = await bouton.boundingBox();
    expect(box?.width ?? 0, nom).toBeGreaterThanOrEqual(48);
    expect(box?.height ?? 0, nom).toBeGreaterThanOrEqual(48);
    expect((box?.x ?? 0) + (box?.width ?? 0), nom).toBeLessThanOrEqual(size.width + 0.5);
  }
  for (const nom of ['Radio', 'Moteur', 'Route']) {
    const box = await panneau.getByRole('slider', { name: nom, exact: true }).boundingBox();
    expect(box?.height ?? 0, nom).toBeGreaterThanOrEqual(48);
  }
}

/** Les réglages rangent tout ce qui était dans la barre. */
async function reglagesComplets(page: Page, { paysage }: { paysage: boolean }): Promise<void> {
  const panneau = reglagesSortie(page);
  await expect(panneau.getByRole('group', { name: 'Caméra' }).getByRole('button')).toHaveCount(6);
  await expect(panneau.getByRole('group', { name: 'Météo' }).getByRole('button')).toHaveCount(3);
  await expect(panneau.getByRole('group', { name: 'Direction' }).getByRole('button')).toHaveCount(2);
  await expect(panneau.getByRole('group', { name: 'Commande' })).toHaveCount(paysage ? 0 : 1);
  for (const nom of ['Réalisateur', 'Ralenti', 'Son du moteur', 'Rentrer au garage']) await expect(panneau.getByRole('button', { name: nom, exact: true }), nom).toBeVisible();
  await expect(panneau.getByRole('group', { name: 'Son de la sortie' }).getByRole('slider')).toHaveCount(3);
}

test.describe('sortie de nuit : l’aperçu, puis la course', () => {
  test.setTimeout(600_000);

  test('portrait : aperçu épuré, réglages rangés, un appui lance les feux à la main, Repartir, Pilote automatique', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('./#/sortie');
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
    await verifierApercu(page);
    await page.waitForTimeout(1500);
    await shot(page, '01-apercu-portrait');

    // Les réglages dans l'aperçu : tout y est, la route continue derrière (pas de pause).
    await ouvrirReglages(page);
    await reglagesComplets(page, { paysage: false });
    await expect(reglagesSortie(page).getByRole('button', { name: 'Réalisateur' })).toHaveAttribute('aria-pressed', 'true');
    await expect(reglagesSortie(page).getByRole('button', { name: 'Commencer la course' })).toBeVisible();
    await expect(reglagesSortie(page).getByRole('button', { name: 'Repartir' })).toHaveCount(0);
    await expect(reglagesSortie(page).getByRole('button', { name: 'Pilote automatique' })).toHaveCount(0);
    const s0 = await attr(page, 'data-s');
    await expect.poll(() => attr(page, 'data-s'), { timeout: DELAI_ROUTE }).toBeGreaterThan(s0 + 2);
    await reglagesLisibles(page);
    await shot(page, '05-reglages-portrait');
    await fermerReglages(page);
    await page.setViewportSize({ width: 360, height: 780 });
    await ouvrirReglages(page);
    await reglagesLisibles(page);
    await shot(page, '06-reglages-360');
    await fermerReglages(page);
    await page.setViewportSize({ width: 390, height: 844 });

    // Un appui sur la route : la ligne, les feux, à la main, la poursuite ; l'offre « Mode manette ».
    await commencerCourse(page);
    await expect(stage(page)).toHaveAttribute('data-camera', 'poursuite');
    await expect(page.locator('.drive-dial')).toBeVisible();
    await expect(page.locator('.drive-pause')).toBeVisible();
    await expect(page.locator('.drive-minicarte-place')).toHaveCount(1);
    await expect(stage(page)).toHaveAttribute('data-depart', 'feux', { timeout: DELAI_ROUTE });
    const offre = page.getByRole('button', { name: /Mode manette/ });
    await expect(offre).toBeVisible();
    const boite = await offre.boundingBox();
    expect(boite?.height ?? 0).toBeGreaterThanOrEqual(48);
    // Dans l'écran, au milieu, au-dessus de l'amorce du manche.
    expect(boite?.y ?? -1).toBeGreaterThan(0);
    expect((boite?.y ?? 1e9) + (boite?.height ?? 0)).toBeLessThan(844 / 2 + 60);
    await expect(offre).toBeInViewport();
    await expect(page.locator('.drive-feux i[data-feu="rouge"]').first()).toBeVisible({ timeout: DELAI_ROUTE });
    await shot(page, '03-feux-manette');
    // Au vert, l'offre s'efface ; le chrono part.
    await expect(stage(page)).toHaveAttribute('data-depart', 'parti', { timeout: DELAI_ROUTE });
    await expect(offre).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'NOS' })).toBeVisible();
    await expect(page.locator('.drive-amorce')).toBeVisible();
    await sansRecouvrement(
      page,
      ['.tuto-aide', '.drive-dial', '.drive-where', '.drive-top .quick-btn', '.drive-reglages-btn', '.drive-pause', '.drive-minicarte-place', '.drive-nos', '.drive-amorce'],
      ['.tuto-aide', '.drive-top .quick-btn', '.drive-reglages-btn', '.drive-pause', '.drive-nos'],
    );
    await shot(page, '04-course-portrait');

    // En course, les réglages mettent en pause, et « Repartir » relance les feux à la main.
    const panneau = await ouvrirReglages(page);
    await expect(page.locator('.drive-pause')).toHaveAttribute('aria-pressed', 'true');
    await expect(panneau.getByRole('button', { name: 'Commencer la course' })).toHaveCount(0);
    await expect(panneau.getByRole('button', { name: 'Pilote automatique' })).toBeVisible();
    const fige = await attr(page, 'data-chrono');
    await page.waitForTimeout(2000);
    expect(await attr(page, 'data-chrono')).toBe(fige);
    await panneau.getByRole('button', { name: 'Repartir' }).tap();
    await expect(reglagesSortie(page)).toHaveCount(0);
    await expect(page.locator('.drive-pause')).toHaveAttribute('aria-pressed', 'false');
    await expect(stage(page)).toHaveAttribute('data-depart', /^(attente|feux)$/, { timeout: DELAI_ROUTE });
    await expect(page.locator('.drive-mid')).toHaveAttribute('data-conduite', 'main');
    await expect(stage(page)).toHaveAttribute('data-depart', 'parti', { timeout: DELAI_ROUTE });

    // « Pilote automatique » : le pilote reprend où l'on est, le chrono continue ; un appui reprend la main.
    await (await ouvrirReglages(page)).getByRole('button', { name: 'Pilote automatique' }).tap();
    await expect(page.locator('.drive-mid')).toHaveAttribute('data-conduite', 'auto');
    await expect(page.locator('.drive-invite')).toHaveText('Touche l’écran pour reprendre la main');
    await expect(stage(page)).toHaveAttribute('data-depart', 'parti');
    const chrono = await attr(page, 'data-chrono');
    await expect.poll(() => attr(page, 'data-chrono'), { timeout: DELAI_ROUTE }).toBeGreaterThan(chrono);
    const mid = await page.locator('.drive-mid').boundingBox();
    if (!mid) throw new Error('zone des gestes introuvable');
    await page.locator('.drive-mid').tap({ position: { x: mid.width / 2, y: mid.height * 0.4 } });
    await expect(page.locator('.drive-mid')).toHaveAttribute('data-conduite', 'main');
    await expect(stage(page)).toHaveAttribute('data-depart', 'parti');

    await rentrerAuGarage(page);
    await expect(stage(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('paysage : aperçu épuré, réglages sur le côté, un appui lance la course, la manette', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('./#/sortie');
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
    await verifierApercu(page);
    await page.waitForTimeout(1500);
    await shot(page, '02-apercu-paysage');

    await ouvrirReglages(page);
    await reglagesComplets(page, { paysage: true });
    await reglagesLisibles(page);
    await shot(page, '07-reglages-paysage');
    await fermerReglages(page);

    await commencerCourse(page, { parti: true });
    await expect(page.getByRole('button', { name: /Mode manette/ })).toHaveCount(0);
    for (const nom of ['Gaz', 'Frein', 'NOS']) await expect(page.getByRole('button', { name: nom, exact: true })).toBeVisible();
    await expect(page.locator('.drive-amorce')).toBeVisible();
    await sansRecouvrement(
      page,
      ['.tuto-aide', '.drive-dial', '.drive-where', '.drive-top .quick-btn', '.drive-reglages-btn', '.drive-pause', '.drive-minicarte-place', '.drive-pave .drive-nos', '.drive-pave-gaz', '.drive-pave-btn:not(.drive-pave-gaz)', '.drive-amorce'],
      ['.tuto-aide', '.drive-top .quick-btn', '.drive-reglages-btn', '.drive-pause', '.drive-pave .drive-nos', '.drive-pave-gaz', '.drive-pave-btn:not(.drive-pave-gaz)'],
    );
    await shot(page, '08-course-paysage');
    await rentrerAuGarage(page);
    await expect(stage(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('paysage, texte très grand : chaque bouton du haut offre 48 px', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('./#/sortie');
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
    await attendreApercu(page);
    // Aperçu : l'aide, la radio, les réglages ; course : la pause en plus.
    await boutonsDuHaut48(page, 3, 'aperçu paysage');
    await commencerCourse(page);
    await boutonsDuHaut48(page, 4, 'course paysage');
    await page.evaluate(() => {
      document.documentElement.dataset.text = 'tres-grand';
    });
    await page.waitForTimeout(500);
    await shot(page, '03-haut-paysage-texte-tres-grand', 'vague-r-course');
    await rentrerAuGarage(page);
    expect(errors).toEqual([]);
  });
});
