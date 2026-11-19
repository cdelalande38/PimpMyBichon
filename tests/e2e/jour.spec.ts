import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { attendreSurLaRoute, auSec, capture, ENTREE_SORTIE, fermerReglages, openApp, openEntry, ouvrirReglages, pickMap, rentrerAuGarage, waitForScene } from './helpers.ts';

// La sortie se roule aussi de jour (vague S, src/data/moments.ts) : le moment se choisit au menu à
// côté de la météo et dans les réglages (groupe « Route ») ; la scène le dit (data-moment) ; les
// matières du jour sont les mêmes programmes que celles de la nuit (ni erreur de nuanceur ni erreur
// de page en passant de l'un à l'autre, sous les trois météos) ; retour à la nuit.

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const numberAttr = async (page: Page, name: string) => Number(await stage(page).getAttribute(name));

test.describe('sortie de jour', () => {
  test.setTimeout(420_000);

  test('le jour au menu, la scène de jour, les matières compilées, retour à la nuit', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /shader|webglprogram|glsl|program/i.test(message.text())) errors.push(message.text().slice(0, 300));
    });
    await openApp(page);
    await waitForScene(page);
    await openEntry(page, ENTREE_SORTIE);
    const dock = page.locator('footer.dock');
    // Le moment n'apparaît qu'une carte touchée, à côté de la météo ; la nuit par défaut.
    await expect(dock.getByRole('group', { name: 'Moment' })).toHaveCount(0);
    await pickMap(page);
    await auSec(page);
    const moments = dock.getByRole('group', { name: 'Moment' });
    await expect(moments.getByRole('button', { name: 'Nuit', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const jour = moments.getByRole('button', { name: 'Jour', exact: true });
    // « Sec » : une lune la nuit, un soleil le jour (vague T).
    const sec = dock.getByRole('group', { name: 'Météo' }).getByRole('button', { name: 'Sec', exact: true });
    await expect(sec.locator('svg circle')).toHaveCount(0);
    await jour.tap();
    await expect(jour).toHaveAttribute('aria-pressed', 'true');
    await expect(sec.locator('svg circle')).toHaveCount(1);
    // 48 px au doigt.
    const box = await jour.boundingBox();
    expect(Math.min(box?.width ?? 0, box?.height ?? 0)).toBeGreaterThanOrEqual(47.5);
    await capture(page, 'jour-menu');
    await dock.getByRole('button', { name: 'Jouer', exact: true }).tap();

    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
    await expect(stage(page)).toHaveAttribute('data-moment', 'jour');
    await expect(stage(page)).toHaveAttribute('data-meteo', 'sec');
    // Quelques secondes de route de jour : décor, ciel, sonde, ombre portée.
    const s0 = await numberAttr(page, 'data-s');
    await attendreSurLaRoute(page, 'route de jour', () => numberAttr(page, 'data-s'), (s) => s > s0 + 20, { secondes: 20 });
    await capture(page, 'jour-route');

    // Réglages, groupe « Route » : le moment à côté de la météo ; les deux autres météos de jour, puis la nuit.
    const panneau = await ouvrirReglages(page);
    const route = panneau.getByRole('group', { name: 'Moment' });
    await expect(route.getByRole('button', { name: 'Jour', exact: true })).toHaveAttribute('aria-pressed', 'true');
    for (const nom of ['Pluie', 'Neige']) {
      await panneau.getByRole('group', { name: 'Météo' }).getByRole('button', { name: nom, exact: true }).tap();
      await expect(stage(page)).toHaveAttribute('data-meteo', nom.toLowerCase());
      await page.waitForTimeout(1_500);
    }
    await route.getByRole('button', { name: 'Nuit', exact: true }).tap();
    await expect(route.getByRole('button', { name: 'Nuit', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(stage(page)).toHaveAttribute('data-moment', 'nuit');
    await page.waitForTimeout(1_500);
    await fermerReglages(page);
    expect(errors).toEqual([]);
    await rentrerAuGarage(page);
  });
});
