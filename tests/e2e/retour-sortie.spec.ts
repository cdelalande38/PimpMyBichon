import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { openApp, openEntry, pickMap, waitForScene } from './helpers.ts';

// « Retour » en sortie de nuit : le geste retour du téléphone, le retour du navigateur et le bouton
// « Rentrer au garage » demandent d'abord « Rentrer au garage ? » tant que la route roule ; la sortie se
// met en pause le temps de la question. Pas de question pendant le chargement. Après « Rentrer », un
// retour de plus ne rouvre pas la sortie. Captures : captures/vague-p-retour/.

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const dialogue = (page: Page) => page.getByRole('dialog', { name: 'Rentrer au garage ?' });
const pause = (page: Page) => page.getByRole('button', { name: /^(Pause|Reprendre)$/ });
const garage = (page: Page) => page.getByRole('heading', { level: 1, name: 'PimpMyBichon' });

async function shot(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'vague-p-retour', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

async function sortieEnRoute(page: Page): Promise<void> {
  await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
  await expect(page.getByRole('contentinfo', { name: 'Commandes de la sortie' })).toBeVisible();
}

/** Le dialogue tient dans l'écran et ses boutons font 48 px au moins. */
async function expectDialogueLisible(page: Page, label: string): Promise<void> {
  const size = page.viewportSize();
  if (!size) throw new Error('taille de page inconnue');
  const card = await dialogue(page).boundingBox();
  if (!card) throw new Error(`dialogue introuvable (${label})`);
  expect(card.x, `bord gauche (${label})`).toBeGreaterThanOrEqual(0);
  expect(card.y, `haut (${label})`).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width, `bord droit (${label})`).toBeLessThanOrEqual(size.width);
  expect(card.y + card.height, `bas (${label})`).toBeLessThanOrEqual(size.height);
  for (const name of ['Rentrer', 'Rester sur la route']) {
    const box = await dialogue(page).getByRole('button', { name, exact: true }).boundingBox();
    if (!box) throw new Error(`« ${name} » introuvable (${label})`);
    expect(box.height, `hauteur de « ${name} » (${label})`).toBeGreaterThanOrEqual(48);
    expect(box.width, `largeur de « ${name} » (${label})`).toBeGreaterThanOrEqual(48);
  }
}

test.describe('retour en sortie de nuit', () => {
  // Rendu logiciel sur une machine partagée : la route met du temps à être prête.
  test.setTimeout(480_000);

  test('depuis le menu : le retour demande, on reste ou on rentre, sans entrée fantôme', async ({ page }) => {
    await openApp(page);
    await waitForScene(page);
    await openEntry(page, 'Sortie de nuit');
    await pickMap(page);
    await page.locator('footer.dock').getByRole('button', { name: 'Sortir', exact: true }).tap();
    await expect(page).toHaveURL(/#\/sortie$/);
    await sortieEnRoute(page);
    await expect(dialogue(page)).toHaveCount(0);
    await expect(pause(page)).toHaveAttribute('aria-pressed', 'false');

    // Retour du navigateur : la question, la route reste #/sortie, la sortie est en pause.
    await page.goBack();
    await expect(dialogue(page)).toBeVisible();
    await expect(page).toHaveURL(/#\/sortie$/);
    await expect(pause(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(dialogue(page).getByRole('button', { name: 'Rester sur la route' })).toBeFocused();
    await expectDialogueLisible(page, '390 × 844');
    await shot(page, 'dialogue-portrait');

    // Lisible en 360 × 780 et en paysage 844 × 390.
    await page.setViewportSize({ width: 360, height: 780 });
    await expectDialogueLisible(page, '360 × 780');
    await page.setViewportSize({ width: 844, height: 390 });
    await expectDialogueLisible(page, '844 × 390');
    await shot(page, 'dialogue-paysage');
    await page.setViewportSize({ width: 390, height: 844 });

    // « Rester sur la route » : la question se ferme, la sortie reprend.
    await dialogue(page).getByRole('button', { name: 'Rester sur la route' }).tap();
    await expect(dialogue(page)).toHaveCount(0);
    await expect(pause(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page).toHaveURL(/#\/sortie$/);

    // Un second retour pendant la question la ferme : on ne quitte que par « Rentrer ».
    await page.goBack();
    await expect(dialogue(page)).toBeVisible();
    await page.goBack();
    await expect(dialogue(page)).toHaveCount(0);
    await expect(page).toHaveURL(/#\/sortie$/);
    await expect(pause(page)).toHaveAttribute('aria-pressed', 'false');

    // Échap = rester ; le bouton « Rentrer au garage » de l'écran demande aussi.
    await page.getByRole('button', { name: 'Rentrer au garage' }).tap();
    await expect(dialogue(page)).toBeVisible();
    await expect(pause(page)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(dialogue(page)).toHaveCount(0);
    await expect(page).toHaveURL(/#\/sortie$/);
    await expect(pause(page)).toHaveAttribute('aria-pressed', 'false');

    // « Rentrer » : le garage, sans question de plus.
    await page.goBack();
    await expect(dialogue(page)).toBeVisible();
    await dialogue(page).getByRole('button', { name: 'Rentrer', exact: true }).tap();
    await expect(garage(page)).toBeVisible({ timeout: 30_000 });
    await expect(dialogue(page)).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe('');

    // Aucune entrée fantôme : un retour de plus quitte l'app du garage, il ne rouvre pas la sortie.
    await page.goBack();
    await expect(page).not.toHaveURL(/#\/sortie/);
    await expect(stage(page)).toHaveCount(0);
  });

  test('lien direct : le retour demande, après rechargement aussi, « Rentrer » remplace par le garage', async ({ page }) => {
    await page.goto('./#/sortie');
    await sortieEnRoute(page);

    await page.goBack();
    await expect(dialogue(page)).toBeVisible();
    await expect(page).toHaveURL(/#\/sortie$/);
    await dialogue(page).getByRole('button', { name: 'Rester sur la route' }).tap();
    await expect(dialogue(page)).toHaveCount(0);

    // Rechargement de la page en sortie : la garde est reposée.
    await page.reload();
    await sortieEnRoute(page);
    await page.goBack();
    await expect(dialogue(page)).toBeVisible();
    await expect(page).toHaveURL(/#\/sortie$/);

    await dialogue(page).getByRole('button', { name: 'Rentrer', exact: true }).tap();
    await expect(garage(page)).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).hash).toBe('');
    await page.goBack();
    await expect(page).not.toHaveURL(/#\/sortie/);
    await expect(stage(page)).toHaveCount(0);
  });

  test('pendant le chargement : le retour quitte sans question', async ({ page }) => {
    await openApp(page);
    await waitForScene(page);
    await openEntry(page, 'Sortie de nuit');
    await pickMap(page);
    await page.locator('footer.dock').getByRole('button', { name: 'Sortir', exact: true }).tap();
    await expect(page).toHaveURL(/#\/sortie$/);
    // L'écran de chargement de la carte est là, la route n'est pas encore prête.
    await expect(page.locator('.drive-chargement')).toBeVisible();
    await expect(stage(page)).not.toHaveAttribute('data-sortie', 'prete');

    await page.goBack();
    await expect(garage(page)).toBeVisible({ timeout: 30_000 });
    await expect(dialogue(page)).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe('');
  });
});
