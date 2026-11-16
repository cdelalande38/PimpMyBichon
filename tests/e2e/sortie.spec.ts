import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { capture, openApp, openEntry, waitForScene } from './helpers.ts';

// Sortie de nuit, lot 1 (§ 5.5) : on entre par le menu (Garage · Sortie de nuit), on roule, on change
// de caméra, on passe à la main, on rentre au garage. Le parcours ne lit que les attributs que la
// scène pose sur son élément racine (src/drive/contrat.ts) et l'interface de la sortie.
// Captures : captures/jalon-1/sortie-menu.png, sortie-route.png, sortie-main.png.

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const numberAttr = async (page: Page, name: string) => Number(await stage(page).getAttribute(name));
const bar = (page: Page) => page.getByRole('contentinfo', { name: 'Commandes de la sortie' });

test.describe('sortie de nuit', () => {
  // Rendu logiciel sur une machine partagée (CI) : la scène tourne à quelques images par seconde et
  // la route avance au ralenti. Les délais disent « ça avance », pas « ça avance vite ».
  test.setTimeout(300_000);

  test('du menu à la route, et retour au garage', async ({ page }) => {
    test.setTimeout(480_000);
    await openApp(page);
    await waitForScene(page);

    // Le menu : la carte (lue dans le catalogue), ses crédits, le départ, la météo, « Sortir ».
    await openEntry(page, 'Sortie de nuit');
    const dock = page.locator('footer.dock');
    const maps = dock.getByRole('group', { name: 'Carte' });
    await expect(maps.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
    await expect(dock.locator('.drive-credits')).toContainText('Licence Ouverte');
    const starts = dock.getByRole('group', { name: 'Départ' });
    await expect(starts.getByRole('button').first()).toBeVisible();
    await starts.getByRole('button').nth(1).tap();
    await expect(starts.getByRole('button').nth(1)).toHaveAttribute('aria-pressed', 'true');
    await dock.getByRole('group', { name: 'Météo' }).getByRole('button', { name: 'Pluie' }).tap();
    await capture(page, 'sortie-menu');
    await dock.getByRole('button', { name: 'Sortir', exact: true }).tap();

    // L'écran de la sortie : l'atelier s'efface, la scène de la route est prête.
    await expect(page).toHaveURL(/#\/sortie$/);
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
    await expect(page.locator('footer.dock')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toHaveCount(0);
    await expect(stage(page)).toHaveAttribute('data-meteo', 'pluie');

    // Pilote automatique : l'abscisse et la vitesse avancent sans toucher l'écran.
    const s0 = await numberAttr(page, 'data-s');
    await expect.poll(() => numberAttr(page, 'data-vitesse'), { timeout: 90_000 }).toBeGreaterThan(10);
    await expect.poll(() => numberAttr(page, 'data-s'), { timeout: 120_000 }).toBeGreaterThan(s0 + 20);
    await expect(page.locator('.drive-speed b')).not.toHaveText('0');
    await capture(page, 'sortie-route');

    // Caméra suivante : le réalisateur s'arrête, la caméra choisie est celle qu'on voit.
    await expect(bar(page).getByRole('button', { name: 'Réalisateur' })).toHaveAttribute('aria-pressed', 'true');
    await bar(page).getByRole('button', { name: 'Caméra suivante' }).tap();
    await expect(bar(page).getByRole('button', { name: 'Réalisateur' })).toHaveAttribute('aria-pressed', 'false');
    const camera = await stage(page).getAttribute('data-camera');
    await bar(page).getByRole('button', { name: 'Caméra suivante' }).tap();
    await expect(stage(page)).not.toHaveAttribute('data-camera', camera ?? '');

    // À la main : appui maintenu à gauche, on freine ; à droite, on repart.
    await bar(page).getByRole('button', { name: 'Conduite à la main' }).tap();
    await expect(bar(page).getByRole('button', { name: 'Pilote automatique' })).toBeVisible();
    const zone = page.locator('.drive-mid');
    const box = await zone.boundingBox();
    if (!box) throw new Error('zone des gestes introuvable');
    const before = await numberAttr(page, 'data-vitesse');
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
    await page.mouse.down();
    await expect.poll(() => numberAttr(page, 'data-vitesse'), { timeout: 60_000 }).toBeLessThan(Math.max(1, before - 10));
    await expect(page.locator('.drive-pedal[data-pedale="frein"]')).toHaveAttribute('data-appui', 'true');
    await page.mouse.up();
    const stopped = await numberAttr(page, 'data-vitesse');
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.6);
    await page.mouse.down();
    await expect.poll(() => numberAttr(page, 'data-vitesse'), { timeout: 60_000 }).toBeGreaterThan(stopped + 5);
    await capture(page, 'sortie-main');
    await page.mouse.up();

    // Rentrer au garage en un geste : l'atelier revient tel qu'on l'avait laissé.
    await bar(page).getByRole('button', { name: 'Rentrer au garage' }).tap();
    await expect(page).not.toHaveURL(/#\/sortie/);
    await expect(stage(page)).toHaveCount(0);
    await expect(page.locator('footer.dock')).toBeVisible();
    await expect(page.locator('footer.dock .dock-tab[data-onglet="sortie"]')).toBeVisible();
    await waitForScene(page);
  });

  test('lien direct vers la sortie : la première carte ; toutes les commandes offrent 48 px au doigt', async ({ page }) => {
    // Route lente à venir : l'écran de chargement le dit, crédits de la carte compris.
    let release = () => {};
    const held = new Promise<void>((done) => (release = done));
    await page.route('**/assets/maps/*/route.json', async (route) => {
      await held;
      await route.continue();
    });
    // L'atelier ne s'affiche pas : on n'attend pas son titre.
    await page.goto('./#/sortie');
    const veil = page.locator('.drive-veil[data-etat="chargement"]');
    await expect(veil).toBeVisible({ timeout: 30_000 });
    await expect(veil).toContainText('Licence Ouverte');
    await capture(page, 'sortie-chargement');
    release();
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
    await expect(veil).toHaveCount(0);
    const controls = page.locator('.app button:visible');
    const count = await controls.count();
    expect(count).toBeGreaterThan(5);
    for (let i = 0; i < count; i += 1) {
      const control = controls.nth(i);
      const label = ((await control.getAttribute('aria-label')) ?? (await control.innerText())).trim();
      const size = await control.boundingBox();
      expect(size?.height ?? 0, label).toBeGreaterThanOrEqual(48);
      expect(size?.width ?? 0, label).toBeGreaterThanOrEqual(48);
    }
  });

  test('les matières de nuit se compilent : ni erreur de nuanceur ni erreur de page, par les deux météos', async ({ page }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /shader|webglprogram|glsl|program/i.test(message.text())) errors.push(message.text().slice(0, 300));
    });
    await page.goto('./#/sortie');
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
    // Quelques secondes de route : enseignes, lumières lointaines, brume au sol, garde des caméras.
    await expect.poll(() => numberAttr(page, 'data-s'), { timeout: 120_000 }).toBeGreaterThan(20);
    // L'autre météo (celle du joueur est enregistrée : pluie par défaut).
    const before = await stage(page).getAttribute('data-meteo');
    await bar(page).getByRole('button', { name: /^Météo/ }).tap();
    await expect(stage(page)).toHaveAttribute('data-meteo', before === 'pluie' ? 'sec' : 'pluie');
    await page.waitForTimeout(2_000);
    expect(errors).toEqual([]);
  });

  test('route introuvable : un message clair, « Réessayer » et le retour au garage', async ({ page }) => {
    await page.route('**/assets/maps/*/route.json', (route) => route.abort());
    await page.goto('./#/sortie');
    await expect(stage(page)).toHaveAttribute('data-sortie', 'erreur', { timeout: 30_000 });
    await expect(page.getByRole('alert')).toContainText('La route ne veut pas s’ouvrir');
    await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible();
    await capture(page, 'sortie-erreur');
    await page.unroute('**/assets/maps/*/route.json');
    await page.getByRole('button', { name: 'Réessayer' }).tap();
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
    await bar(page).getByRole('button', { name: 'Rentrer au garage' }).tap();
    await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeVisible();
  });
});
