// La pièce cliquable : les pastilles des objets du décor (enceintes → radio, bloc moteur →
// Mécanique · Préparation), l'appui court sur le véhicule (Custom · Peinture, zone touchée), et ce
// qui ne doit rien déclencher : un glissement, le mode photo, un panneau ouvert.
// Captures : captures/piece/.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openApp, reloadSaved, waitForBench, waitForScene, waitForStill } from './helpers.ts';

const dock = (page: Page) => page.locator('footer.dock');
const pins = (page: Page) => page.locator('.piece-pin');
const tabs = (page: Page) => dock(page).getByRole('navigation', { name: 'Onglets de l’atelier' });

async function shot(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'piece', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

/** Centre du véhicule à l'écran : le milieu de sa boîte, projeté par la caméra de la scène. */
async function vehiclePoint(page: Page): Promise<{ x: number; y: number }> {
  // Le véhicule est au centre de la pièce ; la caméra le cadre au milieu de la bande de scène,
  // au-dessus du dock. On vise un peu au-dessus du milieu de l'espace libre.
  const top = (await dock(page).boundingBox())?.y ?? 600;
  return { x: 195, y: Math.round(top * 0.55) };
}

/**
 * Tourne autour du véhicule par glissements successifs jusqu'à voir la pastille demandée (dans la
 * vue de départ, la coupe caméra retire le salon : table basse et bloc moteur reviennent de l'autre
 * côté).
 */
async function orbitUntil(page: Page, name: string): Promise<void> {
  const pin = page.getByRole('button', { name, exact: true });
  const top = (await dock(page).boundingBox())?.y ?? 600;
  const y = Math.round(top * 0.5);
  for (let turn = 0; turn < 16; turn += 1) {
    if (await pin.isVisible()) return;
    await page.mouse.move(120, y);
    await page.mouse.down();
    await page.mouse.move(270, y, { steps: 8 });
    await page.mouse.up();
    await waitForStill(page);
  }
  await expect(pin).toBeVisible();
}

/**
 * Les pastilles sont des repères brefs (src/state/piece.ts) : effacées au repos, allumées quelques
 * secondes à la fin d'un geste sur la scène. Un court glissé vertical (plus de 10 px : ce n'est pas
 * un appui, et il ne fait presque pas tourner la vue) les rallume.
 */
async function reveal(page: Page): Promise<void> {
  const top = (await dock(page).boundingBox())?.y ?? 600;
  const y = Math.round(top * 0.5);
  await page.mouse.move(180, y);
  await page.mouse.down();
  await page.mouse.move(180, y + 14, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('.piece-overlay')).toHaveAttribute('data-visible', 'oui');
}

/**
 * Appui sur une pastille. Le repère ne reste allumé que quelques secondes : sur une machine lente
 * (rendu logiciel partagé), il peut s'être éteint avant que l'appui n'aboutisse. On rallume et on
 * recommence, au lieu d'attendre un repère qui ne reviendra pas.
 */
async function tapPin(page: Page, pin: Locator): Promise<void> {
  await expect(async () => {
    await reveal(page);
    await pin.click({ timeout: 4_000 });
  }).toPass({ timeout: 120_000 });
}

async function ready(page: Page): Promise<void> {
  await openApp(page);
  await waitForScene(page);
  await waitForBench(page);
  await expect(pins(page).first()).toBeVisible();
}

test.describe('pièce cliquable', () => {
  test.setTimeout(240_000);

  test('pastilles : enceintes → radio, bloc moteur → Mécanique · Préparation ; rien sous un panneau', async ({ page }) => {
    await ready(page);
    // Repères brefs : allumés à l'arrivée, ils s'effacent seuls et laissent voir le garage.
    const overlay = page.locator('.piece-overlay');
    await expect(overlay).toHaveAttribute('data-visible', 'non', { timeout: 20_000 });
    await shot(page, 'pastilles-au-repos');
    await reveal(page);
    await shot(page, 'pastilles');

    const radio = page.getByRole('button', { name: 'Ouvrir la radio', exact: true });
    await expect(radio).toBeVisible();
    // Atteignable au clavier : c'est un vrai bouton.
    await radio.focus();
    await expect(radio).toBeFocused();
    await tapPin(page, radio);
    await expect(page).toHaveURL(/#\/radio$/);
    await expect(page.getByRole('heading', { name: 'Radio', level: 2 })).toBeVisible();
    await shot(page, 'apres-enceintes');
    // Panneau ouvert : plus aucune pastille, la scène ne répond plus.
    await expect(pins(page)).toHaveCount(0);
    await page.goBack();
    await expect(page).not.toHaveURL(/#\/radio$/);

    await expect(pins(page).first()).toBeVisible();
    await orbitUntil(page, 'Préparer le moteur');
    await shot(page, 'pastilles-autre-cote');
    const engine = page.getByRole('button', { name: 'Préparer le moteur', exact: true });
    await tapPin(page, engine);
    // Un seul niveau du menu : la fiche de préparation, sections et entrées masquées.
    await expect(dock(page).locator('.dock-crumb')).toHaveText(['Mécanique', 'Préparation']);
    await expect(dock(page).locator('.dock-tab[data-onglet="preparation"]')).toBeVisible();
    await expect(tabs(page)).toHaveCount(0);
    await expect(dock(page).getByRole('navigation', { name: /^Entrées/ })).toHaveCount(0);
  });

  test('appui court sur le véhicule : la peinture, sur une zone ; un glissement ne déclenche rien', async ({ page }) => {
    await ready(page);
    const custom = tabs(page).getByRole('button', { name: 'Custom', exact: true });
    await expect(custom).not.toHaveAttribute('aria-current', 'true');
    const { x, y } = await vehiclePoint(page);

    // Glissement : l'orbite tourne, rien ne s'ouvre.
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(x + i * 12, y, { steps: 2 });
    await page.mouse.up();
    await waitForStill(page);
    await expect(custom).not.toHaveAttribute('aria-current', 'true');
    await expect(page).not.toHaveURL(/#\/[a-z]/);

    // Le glissement a tourné la vue : on revient au cadrage de départ avant de viser le véhicule.
    await reloadSaved(page);
    await ready(page);
    await page.touchscreen.tap(x, y);
    // Custom · Peinture, sur la zone touchée : le fil le dit, sections et entrées sont masquées.
    await expect(dock(page).locator('.dock-crumb').nth(0)).toHaveText('Custom');
    await expect(dock(page).locator('.dock-crumb').nth(1)).toHaveText('Peinture');
    await expect(dock(page).locator('.dock-tab[data-onglet="peinture"]')).toBeVisible();
    await expect(tabs(page)).toHaveCount(0);
    await expect(dock(page).getByRole('navigation', { name: /^Entrées/ })).toHaveCount(0);
    // Dans une zone : les étapes « Couleur » et « Finition » sont là.
    await expect(dock(page).locator('.paint').getByRole('navigation', { name: 'Peinture' })).toBeVisible();
    await shot(page, 'apres-vehicule');
  });

  test('mode photo et vue couverte : aucune pastille, aucun appui ne répond', async ({ page }) => {
    await ready(page);
    const { x, y } = await vehiclePoint(page);
    await page.getByRole('button', { name: 'Photo', exact: true }).click();
    await expect(page).toHaveURL(/#\/photo$/);
    await expect(pins(page)).toHaveCount(0);
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(400);
    await expect(page).toHaveURL(/#\/photo$/);
    await expect(pins(page)).toHaveCount(0);
    await page.goBack();
    await expect(pins(page).first()).toBeVisible();

    // Panneau « Atelier » ouvert : un appui sur ce qui reste de la scène ne fait rien.
    await page.getByRole('navigation', { name: 'Raccourcis' }).getByRole('button', { name: 'Atelier', exact: true }).click();
    await expect(pins(page)).toHaveCount(0);
    const custom = tabs(page).getByRole('button', { name: 'Custom', exact: true });
    await page.touchscreen.tap(x, 120);
    await page.waitForTimeout(400);
    await expect(custom).not.toHaveAttribute('aria-current', 'true');
  });
});
