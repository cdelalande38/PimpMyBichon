import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openApp, waitForBench, waitForScene } from './helpers.ts';

// Menu agrandi : la poignée du dock fait monter le menu (60 % de l'écran au plus) et passe les
// options de l'onglet sur plusieurs lignes, sans défilement en largeur. Le véhicule reste au-dessus
// du dock (cadre posé par la scène), la préférence survit au rechargement, et le dock réduit
// retrouve sa géométrie d'origine. Dans la fiche moteur, les options passent à la ligne aussi.

const dock = (page: Page) => page.locator('footer.dock');
const tabs = (page: Page) => dock(page).getByRole('navigation', { name: 'Onglets de l’atelier' });
const handle = (page: Page) => dock(page).getByRole('button', { name: /^(Agrandir|Réduire) le menu$/ });
const TABS = ['Véhicule', 'Peinture', 'Ambiance'] as const;

async function shot(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'menu', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

/** Géométrie du dock : son haut, la rangée d'onglets, la rangée d'actions. */
async function dockGeometry(page: Page) {
  return dock(page).evaluate((footer) => {
    const top = (selector: string) => Math.round(footer.querySelector(selector)?.getBoundingClientRect().top ?? -1);
    return { dock: Math.round(footer.getBoundingClientRect().top), tabs: top('.dock-tabs-row'), acts: top('nav.acts') };
  });
}

/** Rangées de l'onglet courant (et onglets, actions) qui débordent en largeur : aucune attendue. */
async function overflowingRows(page: Page): Promise<string[]> {
  return dock(page).evaluate((footer) => {
    const rows = [...footer.querySelectorAll<HTMLElement>('.tabs, .chips, .acts, .dock-tab, .paint-bar, .paint-extra')];
    return rows
      .filter((row) => row.getClientRects().length > 0 && row.scrollWidth > row.clientWidth + 1)
      .map((row) => `${row.className} (${row.scrollWidth} > ${row.clientWidth})`);
  });
}

/** Chaque bouton visible du dock tient dans la largeur de l'écran et fait 48 px. */
async function expectButtonsInside(page: Page, width: number, label: string): Promise<void> {
  const buttons = dock(page).locator('button:visible');
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const box = await buttons.nth(i).boundingBox();
    if (!box) continue;
    const name = `${label} · bouton ${i}`;
    expect(box.height, `hauteur, ${name}`).toBeGreaterThanOrEqual(48);
    expect(box.width, `largeur, ${name}`).toBeGreaterThanOrEqual(48);
    expect(box.x, `bord gauche, ${name}`).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, `bord droit, ${name}`).toBeLessThanOrEqual(width + 1);
  }
}

/** Cadre du véhicule à l'écran, posé par la scène : haut et bas de sa boîte projetée. */
async function vehicleFrame(stage: Locator): Promise<{ top: number; bottom: number; shift: number } | null> {
  const raw = await stage.getAttribute('data-vehicule-ecran');
  const shift = Number(await stage.getAttribute('data-decalage'));
  if (!raw) return null;
  const [top, bottom] = raw.split(',').map(Number);
  return top === undefined || bottom === undefined ? null : { top, bottom, shift };
}

/** Le véhicule tient dans la partie libre, au-dessus du dock agrandi. */
async function expectVehicleAboveDock(page: Page): Promise<void> {
  const stage = page.locator('.stage');
  await expect
    .poll(
      async () => {
        const frame = await vehicleFrame(stage);
        const dockTop = (await dock(page).boundingBox())?.y ?? 0;
        if (!frame) return 'pas de cadre';
        if (frame.shift <= 0) return `pas de décalage (${frame.shift})`;
        if (frame.top < 0) return `haut coupé (${frame.top})`;
        if (frame.bottom > dockTop) return `bas sous le dock (${frame.bottom} > ${Math.round(dockTop)})`;
        return 'ok';
      },
      { message: 'véhicule au-dessus du dock agrandi', timeout: 15_000 },
    )
    .toBe('ok');
}

test.describe('menu agrandi', () => {
  test('la poignée agrandit le menu, les options passent à la ligne et le véhicule reste visible', async ({ page }) => {
    test.setTimeout(150_000);
    const { width, height } = page.viewportSize() ?? { width: 390, height: 844 };
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);

    // Compact d'abord : la géométrie d'origine, et le cadrage d'origine (aucun décalage).
    await expect(dock(page)).toHaveAttribute('data-taille', 'compact');
    await expect(handle(page)).toHaveAccessibleName('Agrandir le menu');
    const compact = await dockGeometry(page);
    const handleBox = await handle(page).boundingBox();
    expect(handleBox?.y ?? 0, 'poignée dans le tiers bas').toBeGreaterThanOrEqual((height * 2) / 3);
    await expect(page.locator('.stage')).toHaveAttribute('data-decalage', '0');
    await shot(page, '00-compact-vehicule');

    // Au pouce : le menu monte, sans dépasser 60 % de l'écran.
    await handle(page).tap();
    await expect(dock(page)).toHaveAttribute('data-taille', 'agrandi');
    await expect(handle(page)).toHaveAccessibleName('Réduire le menu');

    for (const tab of TABS) {
      await tabs(page).getByRole('button', { name: tab }).tap();
      const box = await dock(page).boundingBox();
      expect(box?.height ?? 0, `${tab} : 60 % de l'écran au plus`).toBeLessThanOrEqual(height * 0.6 + 1);
      expect(await overflowingRows(page), `${tab} : aucune rangée ne déborde en largeur`).toEqual([]);
      await expectButtonsInside(page, width, tab);
      if (tab === 'Véhicule') {
        // Toutes les puces du catalogue passent à la ligne, sans défiler en largeur. Au-delà de
        // deux rangées (cinq véhicules et plus), le contenu de l'onglet défile en hauteur : chaque
        // puce s'y montre alors en entier.
        const chips = dock(page).getByRole('group', { name: 'Véhicule' }).getByRole('button');
        const count = await chips.count();
        expect(count).toBeGreaterThan(1);
        for (let i = 0; i < count; i += 1) {
          await chips.nth(i).scrollIntoViewIfNeeded();
          await expect(chips.nth(i)).toBeInViewport({ ratio: 1 });
        }
      }
      if (tab === 'Peinture') {
        // Zones, couleurs et finitions ensemble : plus d'alternance Couleur / Finition.
        await expect(dock(page).getByRole('group', { name: 'Zones' })).toBeVisible();
        await expect(dock(page).getByRole('group', { name: 'Couleurs' })).toBeVisible();
        await expect(dock(page).getByRole('group', { name: 'Finitions' })).toBeAttached();
        await expect(dock(page).getByRole('navigation', { name: 'Peinture' })).toHaveCount(0);
        // Une finition se choisit directement, la scène suit.
        const candy = dock(page).getByRole('group', { name: 'Finitions' }).getByRole('button', { name: /^Candy/ });
        await candy.scrollIntoViewIfNeeded();
        await candy.tap();
        await expect(candy).toHaveAttribute('aria-pressed', 'true');
      }
      await expectVehicleAboveDock(page);
      // Capture : l'onglet vu depuis le haut de sa liste.
      await dock(page).locator('.dock-tab').evaluate((element) => element.scrollTo({ top: 0 }));
      await shot(page, `0${TABS.indexOf(tab) + 1}-agrandi-${tab === 'Véhicule' ? 'vehicule' : tab.toLowerCase()}`);
    }

    // La radio reste dans la rangée d'actions, à l'écran.
    await expect(dock(page).getByRole('navigation', { name: 'Atelier', exact: true }).getByRole('button', { name: /^Radio/ })).toBeInViewport({
      ratio: 1,
    });

    // Mode photo : le dock s'efface, la vue n'est plus décalée ; au retour, le recadrage revient.
    await page.getByRole('button', { name: 'Photo', exact: true }).tap();
    const bar = page.getByRole('contentinfo', { name: 'Mode photo' });
    await expect(bar).toBeVisible();
    await expect(page.locator('.stage')).toHaveAttribute('data-decalage', '0');
    await bar.getByRole('button', { name: 'Retour' }).tap();
    await expect(dock(page)).toHaveAttribute('data-taille', 'agrandi');
    await expectVehicleAboveDock(page);

    // La préférence est retenue d'une ouverture à l'autre.
    await page.waitForTimeout(400);
    await page.reload();
    await waitForBench(page);
    await expect(dock(page)).toHaveAttribute('data-taille', 'agrandi');
    await expect(handle(page)).toHaveAccessibleName('Réduire le menu');
    await expectVehicleAboveDock(page);

    // Au clavier : la poignée réduit le menu ; la géométrie et le cadrage d'origine reviennent.
    await handle(page).focus();
    await page.keyboard.press('Enter');
    await expect(dock(page)).toHaveAttribute('data-taille', 'compact');
    await expect(handle(page)).toHaveAccessibleName('Agrandir le menu');
    await expect.poll(() => dockGeometry(page)).toEqual(compact);
    await expect(page.locator('.stage')).toHaveAttribute('data-decalage', '0');
  });

  test('sur 360 × 780, le menu agrandi reste lisible et sans débord à toutes les tailles de texte', async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 360, height: 780 });
    await openApp(page);
    await handle(page).tap();
    await expect(dock(page)).toHaveAttribute('data-taille', 'agrandi');
    await page.waitForTimeout(400);
    for (const size of ['Normal', 'Grand', 'Très grand']) {
      await openApp(page, '#/reglages');
      const dialog = page.getByRole('dialog', { name: 'Réglages' });
      await dialog.getByRole('button', { name: 'Texte' }).click();
      await dialog.getByRole('button', { name: new RegExp(`^${size}`) }).click();
      await dialog.getByRole('button', { name: 'Retour à l’atelier' }).click();
      await expect(dialog).toBeHidden();
      await expect(dock(page)).toHaveAttribute('data-taille', 'agrandi');
      for (const tab of TABS) {
        await tabs(page).getByRole('button', { name: tab }).click();
        const box = await dock(page).boundingBox();
        expect(box?.height ?? 0, `${tab} (${size}) : 60 % de l'écran au plus`).toBeLessThanOrEqual(780 * 0.6 + 1);
        expect(await overflowingRows(page), `${tab} (${size}) : aucune rangée ne déborde en largeur`).toEqual([]);
        await expectButtonsInside(page, 360, `${tab} (${size})`);
      }
    }
    await shot(page, '10-agrandi-360-texte-tres-grand');
  });

  test('fiche moteur : les options passent à la ligne, « Origine » reste à l’écran au stage 3', async ({ page }) => {
    test.setTimeout(150_000);
    await openApp(page);
    await tabs(page).getByRole('button', { name: 'Véhicule' }).tap();
    await dock(page).getByRole('group', { name: 'Véhicule' }).locator('[data-vehicle="van"]').tap();
    await dock(page).getByRole('button', { name: 'Moteur', exact: true }).tap();
    const sheet = page.locator('dialog[open]');
    await expect(sheet).toBeVisible();
    const stage3 = sheet.getByRole('button', { name: /^Stage 3/ });
    await stage3.tap();
    await expect(stage3).toHaveAttribute('aria-pressed', 'true');
    const group = sheet.getByRole('group', { name: 'Reprogrammation' });
    await group.scrollIntoViewIfNeeded();
    await expect(group.getByRole('button', { name: /^Origine/ })).toBeInViewport({ ratio: 1 });
    await expect(stage3).toBeInViewport({ ratio: 1 });
    const overflowing = await sheet.evaluate((element) =>
      [...element.querySelectorAll<HTMLElement>('.engine-chips')].filter((row) => row.scrollWidth > row.clientWidth + 1).length,
    );
    expect(overflowing, 'aucune rangée d’options ne déborde en largeur').toBe(0);
    await shot(page, '20-moteur-van-stage-3');
  });
});
