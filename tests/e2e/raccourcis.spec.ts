// Séparation de l'écran principal : en haut à droite, une colonne de boutons ronds à icône (Radio,
// Photo, Atelier) pour ce qui n'est pas de la personnalisation ; en bas, le dock ne porte plus que
// la personnalisation, en quatre onglets (Véhicule, Peinture, Moteur, Ambiance). Le panneau Atelier
// réunit « Réglages » et « Sous le capot ». Captures : captures/raccourcis/.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { backToSections, openApp, openAtelier, openEntry, quick, VIEWPORT, waitForScene } from './helpers.ts';

const dock = (page: Page) => page.locator('footer.dock');
const tabs = (page: Page) => dock(page).getByRole('navigation', { name: 'Onglets de l’atelier' });

async function shot(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'raccourcis', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

test.describe('raccourcis et dock de personnalisation', () => {
  test('colonne de boutons ronds en haut à droite, dock à quatre onglets sans rangée d’actions', async ({ page }) => {
    await openApp(page);
    await waitForScene(page);

    const column = quick(page);
    const names = ['Atelier', 'Photo', 'Radio'];
    for (const [index, name] of names.entries()) {
      const button = column.getByRole('button').nth(index);
      await expect(button).toHaveAccessibleName(new RegExp(`^${name}`));
      const box = await button.boundingBox();
      expect(box, name).not.toBeNull();
      if (!box) continue;
      // Ronds de 48 px, collés au bord droit, dans le haut de l'écran.
      expect(box.width, `largeur de ${name}`).toBeGreaterThanOrEqual(48);
      expect(box.height, `hauteur de ${name}`).toBeGreaterThanOrEqual(48);
      expect(box.x + box.width, `${name} au bord droit`).toBeGreaterThan(VIEWPORT.width - 40);
      expect(box.y, `${name} dans le haut de l’écran`).toBeLessThan(VIEWPORT.height / 3);
    }

    // Le dock : quatre sections (le véhicule de départ déclare un moteur), plus d'actions ; pas de
    // poignée aux sections, où agrandir ne montrerait rien de plus (src/ui/Dock.tsx).
    await expect(tabs(page).getByRole('button')).toHaveText(['Véhicule', 'Custom', 'Mécanique', 'Garage']);
    await expect(dock(page).getByRole('button', { name: /^(Agrandir|Réduire) le menu$/ })).toHaveCount(0);
    for (const name of ['Radio', 'Photo', 'Sous le capot', 'Réglages']) {
      await expect(dock(page).getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    // Les quatre sections tiennent sans défiler à 390 px.
    const overflow = await tabs(page).evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow, 'sections sans défilement').toBeLessThanOrEqual(1);
    await shot(page, '01-accueil');

    // « Custom » : seulement ses entrées, les sections masquées ; les entrées à venir, estompées, en
    // fin de rangée. « Peinture » ouvre ses choix, et masque à son tour les entrées.
    await tabs(page).getByRole('button', { name: 'Custom', exact: true }).tap();
    const entries = dock(page).getByRole('navigation', { name: 'Entrées · Custom' }).getByRole('button');
    await expect(entries).toHaveText([/^Peinture$/, /^Roues$/, /^Suspension$/, /^Intérieur$/, /^Stickers/, /^Carrosserie/, /^Phares/, /^Ailerons/]);
    await expect(entries.first()).toHaveAttribute('aria-current', 'true');
    await expect(entries.nth(1)).toBeEnabled();
    await expect(entries.nth(2)).toBeEnabled();
    await expect(entries.nth(3)).toBeEnabled();
    await expect(entries.nth(4)).toBeDisabled();
    await expect(entries.nth(4)).toHaveAccessibleName('Stickers, bientôt');
    await expect(tabs(page)).toHaveCount(0);
    await expect(dock(page).getByRole('group', { name: 'Zones' })).toHaveCount(0);
    await expect(dock(page).locator('.dock-crumb')).toHaveText(['Custom']);
    await shot(page, '01b-custom');
    await entries.first().tap();
    await expect(dock(page).getByRole('group', { name: 'Zones' })).toBeVisible();
    await expect(dock(page).getByRole('navigation', { name: /^Entrées/ })).toHaveCount(0);
    await expect(dock(page).locator('.dock-crumb')).toHaveText(['Custom', 'Peinture']);
    await shot(page, '01c-custom-peinture');
    // « Garage » : deux entrées (Ambiance, Sortie de nuit) ; le fil dit « Garage · Ambiance ».
    await backToSections(page);
    await tabs(page).getByRole('button', { name: 'Garage', exact: true }).tap();
    await expect(dock(page).getByRole('navigation', { name: 'Entrées · Garage' }).getByRole('button')).toHaveText(['Ambiance', 'Sortie de nuit']);
    await dock(page).getByRole('navigation', { name: 'Entrées · Garage' }).getByRole('button', { name: 'Ambiance', exact: true }).tap();
    await expect(dock(page).getByRole('group', { name: 'Ambiance' })).toBeVisible();
    await expect(dock(page).locator('.dock-crumb')).toHaveText(['Garage', 'Ambiance']);
    await backToSections(page);

    // À 360 px aussi.
    await page.setViewportSize({ width: 360, height: 780 });
    await expect
      .poll(() => tabs(page).evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(1);
  });

  test('« Atelier » ouvre un panneau à deux rubriques ; un seul « Retour » le ferme', async ({ page }) => {
    await openApp(page);
    await openAtelier(page, 'Réglages');
    await expect(page).toHaveURL(/#\/reglages$/);
    const rubriques = page.getByRole('navigation', { name: 'Rubriques de l’atelier' });
    await expect(rubriques.getByRole('button')).toHaveText(['Réglages', 'Sous le capot']);
    await shot(page, '02-atelier-reglages');

    await rubriques.getByRole('button', { name: 'Sous le capot' }).click();
    await expect(page).toHaveURL(/#\/capot$/);
    await expect(page.getByRole('dialog', { name: 'Sous le capot' })).toBeVisible();
    await shot(page, '03-atelier-capot');

    // Passer d'une rubrique à l'autre ne s'empile pas : le retour du navigateur ferme le panneau.
    await page.goBack();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page).not.toHaveURL(/#\//);

    // La roue dentée rouvre la dernière rubrique vue.
    await quick(page).getByRole('button', { name: 'Atelier', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Sous le capot' })).toBeVisible();
  });

  test('« Photo » entre en mode photo ; la colonne disparaît, et revient au retour', async ({ page }) => {
    await openApp(page);
    await waitForScene(page);
    await quick(page).getByRole('button', { name: 'Photo', exact: true }).click();
    const bar = page.getByRole('contentinfo', { name: 'Mode photo' });
    await expect(bar).toBeVisible();
    await expect(quick(page)).toHaveCount(0);
    await bar.getByRole('button', { name: 'Retour' }).click();
    await expect(quick(page).getByRole('button', { name: /^Radio/ })).toBeVisible();
  });

  test('« Mécanique · Préparation » : la fiche dans le dock, l’essentiel en compact, tout en agrandi', async ({ page }) => {
    test.setTimeout(120_000);
    await openApp(page);
    await waitForScene(page);
    await openEntry(page, 'Préparation');
    await expect(dock(page).locator('.dock-crumb')).toHaveText(['Mécanique', 'Préparation']);
    const tab = dock(page).locator('.dock-tab');
    await expect(tab.getByTestId('moteur-origine')).toBeVisible();
    await expect(tab.getByTestId('moteur-prepare')).toBeInViewport();
    // Compact : le dock reste dans le tiers bas, la fiche défile en hauteur dans sa zone.
    const top = await dock(page).evaluate((footer) => footer.getBoundingClientRect().top);
    expect(top, 'dock compact dans le tiers bas').toBeGreaterThanOrEqual((VIEWPORT.height * 2) / 3);
    const scrolls = await tab.evaluate((element) => element.scrollHeight > element.clientHeight + 1);
    expect(scrolls, 'la fiche défile dans sa zone').toBe(true);
    await shot(page, '04-moteur-compact');

    // Une option se choisit dans le dock, le chiffre suit.
    const first = tab.locator('.engine-slot').first().getByRole('button').nth(1);
    await first.scrollIntoViewIfNeeded();
    await first.tap();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(tab.getByTestId('moteur-gain')).not.toHaveText(/^\+\s*0\s*ch$/);

    await dock(page).getByRole('button', { name: 'Agrandir le menu' }).tap();
    await expect(dock(page)).toHaveAttribute('data-taille', 'agrandi');
    await expect(tab.getByText(/pas un passage au banc/)).toBeAttached();
    await tab.evaluate((element) => element.scrollTo({ top: 0 }));
    await shot(page, '05-moteur-agrandi');
    // On replie pour les parcours suivants (préférence retenue).
    await dock(page).getByRole('button', { name: 'Réduire le menu' }).tap();
  });
});
