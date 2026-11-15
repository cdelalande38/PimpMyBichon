import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { changedRatio, openApp, openEntry, sceneBand, waitForScene, waitForStill } from './helpers.ts';

// Jalon 3 (§ 5.2) : l'onglet « Peinture » du dock. Zone, couleur saisie en hexadécimal,
// finition, zone détachée de la carrosserie : tout est retrouvé après rechargement. Le cadenas :
// fermé, la zone suit la carrosserie et ses choix sont verrouillés ; un appui l'explique.

const VIEW_HEIGHT = 844;
const dock = (page: Page) => page.locator('footer.dock');
const paint = (page: Page) => page.locator('footer.dock .paint');
// Puces de zone seules (chaque zone de carrosserie autre que la maîtresse porte aussi son cadenas).
const zones = (page: Page) => paint(page).getByRole('group', { name: 'Zones' }).locator('.paint-zone');
/** Cadenas de la zone choisie (dock compact). */
const lock = (page: Page) => paint(page).locator('.paint-lockbtn');
/** Ligne du cadenas de la zone choisie (dock agrandi), collée en haut. */
const lockLine = (page: Page) => paint(page).locator('.paint-lockline');
// Région annoncée du message (l'« output » de la paillette porte aussi le rôle « status »).
const notice = (page: Page) => paint(page).locator('.paint-notice-live');
const color = (page: Page, name: string) => paint(page).getByRole('group', { name: 'Couleurs' }).getByRole('button', { name, exact: true });

async function shot(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'peinture', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

async function step(page: Page, name: 'Couleur' | 'Finition'): Promise<void> {
  const tab = paint(page).getByRole('navigation', { name: 'Peinture' }).getByRole('button', { name });
  await tab.tap();
  await expect(tab).toHaveAttribute('aria-current', 'true');
}

function finishChip(page: Page, label: string): Locator {
  return paint(page)
    .getByRole('group', { name: 'Finitions' })
    .getByRole('button')
    .filter({ has: page.locator('b', { hasText: new RegExp(`^${label}$`) }) });
}

/** L'entrée « Peinture » de la section « Custom » du dock (l'atelier s'ouvre sur les sections). */
async function openPaintTab(page: Page): Promise<void> {
  await openEntry(page, 'Peinture');
}

/** Remonte à la liste des zones (« Retour » de la ligne de repère du dock), si on n'y est pas. */
async function backToZones(page: Page): Promise<void> {
  const back = page.locator('footer.dock').getByRole('button', { name: 'Retour', exact: true });
  for (let i = 0; i < 2 && !(await zones(page).first().isVisible()); i += 1) await back.tap();
  await expect(zones(page).first()).toBeVisible();
}

/** Première zone qui porte un cadenas (zone de carrosserie autre que la maîtresse). */
async function linkableZone(page: Page): Promise<number> {
  await backToZones(page);
  const count = await zones(page).count();
  for (let index = 1; index < count; index += 1) {
    await zones(page).nth(index).tap();
    if (await lock(page).isVisible()) return index;
    await backToZones(page);
  }
  throw new Error('aucune zone à cadenas sur ce véhicule');
}

test.describe('peinture', () => {
  test.setTimeout(300_000);

  test('zone, couleur hexadécimale, finition et zone détachée sont retrouvées après rechargement', async ({
    page,
  }) => {
    await openApp(page);
    await waitForScene(page);
    await openPaintTab(page);
    await expect(zones(page).first()).toBeVisible({ timeout: 120_000 });
    await waitForStill(page);

    // Le dock reste dans le tiers bas : le véhicule se voit pendant qu'on peint.
    const paintBox = await paint(page).boundingBox();
    expect(paintBox?.y ?? 0).toBeGreaterThanOrEqual((VIEW_HEIGHT * 2) / 3 - 40);
    // Zone maîtresse en tête, choisie d'office.
    await expect(zones(page).first()).toHaveAttribute('aria-pressed', 'true');
    await shot(page, '01-zones');
    // La zone maîtresse : on descend dans ses couleurs.
    await zones(page).first().tap();

    // Couleur saisie au nuancier, en hexadécimal.
    const before = await sceneBand(page);
    await paint(page).getByRole('button', { name: 'Autre couleur' }).tap();
    const picker = paint(page).getByRole('region', { name: /^Nuancier/ });
    await expect(picker).toBeVisible();
    const pickerBox = await picker.boundingBox();
    expect(pickerBox?.y ?? 0, 'le nuancier ne dépasse pas la moitié de l’écran').toBeGreaterThanOrEqual(VIEW_HEIGHT / 2);
    await expect(picker.getByRole('slider', { name: 'Teinte' })).toBeVisible();
    await expect(picker.getByRole('slider', { name: 'Saturation et luminosité' })).toBeVisible();
    const hex = picker.getByRole('textbox', { name: 'Code hexadécimal' });
    await hex.fill('FF3FA4');
    await hex.press('Enter');
    await expect(hex).toHaveValue('#ff3fa4');
    await waitForStill(page);
    expect(await changedRatio(before, await sceneBand(page)), 'la couleur saisie change l’image').toBeGreaterThan(0.01);
    await shot(page, '04-nuancier');

    // Au clavier, la teinte bouge et l'aperçu suit.
    const hue = picker.getByRole('slider', { name: 'Teinte' });
    await hue.focus();
    const hueBefore = Number(await hue.getAttribute('aria-valuenow'));
    await hue.press('ArrowRight');
    await expect(hue).toHaveAttribute('aria-valuenow', String(hueBefore + 5));
    await expect(hex).not.toHaveValue('#ff3fa4');
    await hex.fill('#ff3fa4');
    await hex.press('Enter');
    await picker.getByRole('button', { name: 'C’est bon' }).tap();
    await expect(picker).toBeHidden();

    // La couleur (hors palette) entre dans les dernières couleurs, pressée.
    const recent = paint(page).getByRole('button', { name: 'Récente #ff3fa4' });
    await expect(recent).toHaveAttribute('aria-pressed', 'true');
    await shot(page, '02-couleurs');

    // Finition à paillettes, et sa taille.
    await step(page, 'Finition');
    await finishChip(page, 'Pailleté').tap();
    await expect(finishChip(page, 'Pailleté')).toHaveAttribute('aria-pressed', 'true');
    const flake = paint(page).getByRole('slider', { name: /Paillette/ });
    await flake.fill('1.5');
    await expect(paint(page).locator('.paint-flake output')).toHaveText('1,5 mm');
    await shot(page, '03-finitions');

    // Une zone de carrosserie liée se détache au cadenas, puis prend sa propre couleur.
    await step(page, 'Couleur');
    const detached = await linkableZone(page);
    await expect(lock(page)).toHaveAttribute('data-cadenas', 'ferme');
    await lock(page).tap();
    await expect(lock(page)).toHaveAttribute('data-cadenas', 'ouvert');
    const navy = paint(page).getByRole('button', { name: 'Bleu nuit', exact: true });
    await navy.tap();
    await expect(navy).toHaveAttribute('aria-pressed', 'true');
    await shot(page, '05-zone-detachee');

    // Rechargement : la sauvegarde est relue.
    await page.reload();
    await waitForScene(page);
    await openPaintTab(page);
    await expect(zones(page).first()).toBeVisible({ timeout: 120_000 });
    await zones(page).first().tap();
    await expect(paint(page).getByRole('button', { name: 'Récente #ff3fa4' })).toHaveAttribute('aria-pressed', 'true');
    await step(page, 'Finition');
    await expect(finishChip(page, 'Pailleté')).toHaveAttribute('aria-pressed', 'true');
    await expect(paint(page).locator('.paint-flake output')).toHaveText('1,5 mm');
    await step(page, 'Couleur');
    await backToZones(page);
    await zones(page).nth(detached).tap();
    await expect(lock(page)).toHaveAttribute('data-cadenas', 'ouvert');
    await expect(paint(page).getByRole('button', { name: 'Bleu nuit', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
  test('cadenas : zone verrouillée, message au toucher, ouverture sans changer l’image, rappel en vue, refermeture retrouvée', async ({
    page,
  }) => {
    await openApp(page);
    await waitForScene(page);
    await openPaintTab(page);
    await expect(zones(page).first()).toBeVisible({ timeout: 120_000 });

    // Liste des zones : la zone maîtresse n'a pas de cadenas, une zone de carrosserie suivie en a un, fermé.
    const firstLock = paint(page).locator('.paint-zone-pair').first();
    await expect(paint(page).locator('.paint-zone-pair').filter({ has: zones(page).first() })).toHaveCount(0);
    const zoneLock = firstLock.locator('.paint-lock');
    await expect(zoneLock).toHaveAttribute('data-cadenas', 'ferme');
    await expect(zoneLock).toHaveAccessibleName(/suit la carrosserie, ouvrir le cadenas$/);
    const lockBox = await zoneLock.boundingBox();
    expect(lockBox?.height ?? 0).toBeGreaterThanOrEqual(48);
    expect(lockBox?.width ?? 0).toBeGreaterThanOrEqual(48);
    const zoneName = ((await firstLock.locator('.paint-zone b').textContent()) ?? '').trim();
    await firstLock.locator('.paint-zone').tap();

    // Zone verrouillée (compact) : rappel sous les choix, choix grisés qui montrent la carrosserie.
    await expect(lock(page)).toHaveAttribute('data-cadenas', 'ferme');
    await expect(lock(page)).toHaveAccessibleName(`${zoneName} : suit la carrosserie, ouvrir le cadenas`);
    const reminder = paint(page).locator('.paint-reminder');
    await expect(reminder).toHaveText('Suit la carrosserie');
    const navy = color(page, 'Bleu nuit');
    await expect(navy).toHaveAttribute('aria-disabled', 'true');
    await expect(paint(page).getByRole('button', { name: 'Autre couleur' })).toHaveAttribute('aria-disabled', 'true');
    const worn = paint(page).getByRole('group', { name: 'Couleurs' }).locator('[aria-pressed="true"]');
    await expect(worn).toHaveCount(1);
    const wornName = await worn.getAttribute('aria-label');
    expect(wornName, 'la zone montre la peinture de la carrosserie').not.toBe('Bleu nuit');
    // Le rappel n'emmène pas le dock hors du tiers bas ; tout bouton fait 48 px.
    const reminderBox = await reminder.boundingBox();
    expect(reminderBox?.y ?? 0).toBeGreaterThanOrEqual((VIEW_HEIGHT * 2) / 3);
    for (const button of await dock(page).locator('button:visible').all()) {
      const box = await button.boundingBox();
      if (!box) continue;
      expect(box.height).toBeGreaterThanOrEqual(48);
      expect(box.y).toBeGreaterThanOrEqual((VIEW_HEIGHT * 2) / 3);
    }
    await waitForStill(page);
    await shot(page, '06-cadenas-compact-verrouille');

    // Un appui sur une peinture verrouillée : rien ne change, le message s'affiche (annoncé).
    const before = await sceneBand(page);
    await navy.tap({ force: true });
    await expect(notice(page)).toContainText('Cette partie suit la carrosserie. Ouvre son cadenas pour lui donner sa propre peinture.');
    await expect(navy).toHaveAttribute('aria-pressed', 'false');
    await expect(worn).toHaveAttribute('aria-label', wornName ?? '');
    await shot(page, '07-cadenas-message');
    await step(page, 'Finition');
    await finishChip(page, 'Candy').tap({ force: true });
    await expect(finishChip(page, 'Candy')).toHaveAttribute('aria-pressed', 'false');
    await expect(notice(page)).toContainText('Cette partie suit la carrosserie');
    await step(page, 'Couleur');

    // « Ouvrir le cadenas » (dans le message) : les choix deviennent actifs, l'image ne bouge pas.
    await notice(page).getByRole('button', { name: 'Ouvrir le cadenas', exact: true }).tap();
    await expect(notice(page).getByRole('button')).toHaveCount(0);
    await expect(lock(page)).toHaveAttribute('data-cadenas', 'ouvert');
    await expect(reminder).toHaveText('Peinture à part');
    await expect(navy).not.toHaveAttribute('aria-disabled', 'true');
    await expect(worn).toHaveAttribute('aria-label', wornName ?? '');
    await waitForStill(page);
    expect(await changedRatio(before, await sceneBand(page)), 'ouvrir le cadenas garde l’image').toBeLessThan(0.01);
    await navy.tap();
    await expect(navy).toHaveAttribute('aria-pressed', 'true');
    await waitForStill(page);
    await shot(page, '09-cadenas-deverrouille');

    // Refermer une zone qui a sa propre peinture : rien ne change avant confirmation. Une question
    // dans le menu nomme la zone et la carrosserie ; « Garder sa peinture » est le choix par défaut.
    const confirm = paint(page).getByRole('alertdialog');
    const keep = confirm.getByRole('button', { name: 'Garder sa peinture' });
    await lock(page).tap();
    await expect(confirm).toContainText(`Refermer le cadenas de « ${zoneName} » ? Cette partie reprendra la peinture de la carrosserie et perdra la sienne.`);
    await expect(keep).toBeFocused();
    for (const button of await confirm.getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(box?.height ?? 0, 'boutons de la question : 48 px').toBeGreaterThanOrEqual(48);
    }
    await shot(page, '10-cadenas-question');
    await keep.tap();
    await expect(confirm).toHaveCount(0);
    await expect(lock(page)).toHaveAttribute('data-cadenas', 'ouvert');
    await expect(navy).toHaveAttribute('aria-pressed', 'true');
    // Échap vaut « garder », et ne fait pas remonter le menu.
    await lock(page).tap();
    await expect(keep).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(confirm).toHaveCount(0);
    await expect(lock(page)).toHaveAttribute('data-cadenas', 'ouvert');
    await expect(navy).toHaveAttribute('aria-pressed', 'true');
    // Confirmer : la zone revient à la carrosserie, ses choix se verrouillent de nouveau.
    await lock(page).tap();
    await confirm.getByRole('button', { name: 'Refermer le cadenas' }).tap();
    await expect(confirm).toHaveCount(0);
    await expect(lock(page)).toHaveAttribute('data-cadenas', 'ferme');
    await expect(color(page, wornName ?? '')).toHaveAttribute('aria-pressed', 'true');
    await expect(navy).toHaveAttribute('aria-disabled', 'true');
    // Ouvrir puis refermer sans rien changer : rien à perdre, donc pas de question.
    await lock(page).tap();
    await expect(lock(page)).toHaveAttribute('data-cadenas', 'ouvert');
    await lock(page).tap();
    await expect(confirm).toHaveCount(0);
    await expect(lock(page)).toHaveAttribute('data-cadenas', 'ferme');

    // Dock agrandi : la ligne du cadenas reste en vue quand on fait défiler les peintures.
    await dock(page).getByRole('button', { name: 'Agrandir le menu' }).tap();
    await expect(dock(page)).toHaveAttribute('data-taille', 'agrandi');
    await expect(lockLine(page)).toContainText('Suit la carrosserie');
    const body = dock(page).locator('.dock-tab');
    const top = await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return element.scrollTop;
    });
    expect(top, 'la zone de l’entrée défile en agrandi').toBeGreaterThan(0);
    const [lineBox, bodyBox] = await Promise.all([lockLine(page).boundingBox(), body.boundingBox()]);
    expect(lineBox?.y ?? 0, 'le rappel reste en haut de la zone qui défile').toBeGreaterThanOrEqual((bodyBox?.y ?? 0) - 4);
    expect(lineBox?.y ?? 0).toBeLessThan((bodyBox?.y ?? 0) + 16);
    await page.waitForTimeout(300);
    await shot(page, '08-cadenas-agrandi-defile');
    // Un appui verrouillé tout en bas (dernière finition, en vue) ne fait rien défiler.
    await paint(page).getByRole('group', { name: 'Finitions' }).getByRole('button').last().tap({ force: true });
    await expect(notice(page)).toContainText('Cette partie suit la carrosserie');
    await page.waitForTimeout(300);
    expect(await body.evaluate((element) => element.scrollTop), 'agrandi : position inchangée').toBe(top);

    // Rechargement : la zone est retrouvée refermée, avec la peinture de la carrosserie.
    await page.reload();
    await waitForScene(page);
    await openPaintTab(page);
    await expect(paint(page).locator('.paint-zone-pair').first().locator('.paint-lock')).toHaveAttribute('data-cadenas', 'ferme', {
      timeout: 120_000,
    });
  });

  test('cadenas d’une moto : le rappel, le message et le nom accessible parlent du réservoir', async ({ page }) => {
    test.setTimeout(150_000);
    await openApp(page);
    await waitForScene(page);
    await openEntry(page, 'Véhicule');
    await dock(page).getByRole('group', { name: 'Véhicule' }).locator('[data-vehicle="bobber"]').tap();
    await expect(page.locator('.stage')).toHaveAttribute('data-vehicle', 'bobber');
    await openPaintTab(page);
    // Zone maîtresse du bobber : le réservoir, en tête et sans cadenas.
    await expect(zones(page).first().locator('b')).toHaveText('Réservoir');
    const pair = paint(page).locator('.paint-zone-pair').first();
    const zoneLock = pair.locator('.paint-lock');
    await expect(zoneLock).toHaveAccessibleName('Garde-boue : suit le réservoir, ouvrir le cadenas');
    await expect(zoneLock).toHaveAttribute('title', 'Suit le réservoir');
    await pair.locator('.paint-zone').tap();
    await expect(lock(page)).toHaveAccessibleName('Garde-boue : suit le réservoir, ouvrir le cadenas');
    await expect(paint(page).locator('.paint-reminder')).toHaveText('Suit le réservoir');
    await color(page, 'Bleu nuit').tap({ force: true });
    await expect(notice(page)).toContainText('Cette partie suit le réservoir. Ouvre son cadenas pour lui donner sa propre peinture.');
    await expect(dock(page)).not.toContainText('carrosserie');
    await shot(page, '11-cadenas-bobber');
  });

  test('cadenas en 360 × 780, texte très grand : le rappel garde le dock dans le tiers bas', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 360, height: 780 });
    await openApp(page, '#/reglages');
    const dialog = page.getByRole('dialog', { name: 'Réglages' });
    await dialog.getByRole('button', { name: 'Texte' }).click();
    await dialog.getByRole('button', { name: /^Très grand/ }).click();
    await dialog.getByRole('button', { name: 'Retour à l’atelier' }).click();
    await expect(dialog).toBeHidden();
    await openPaintTab(page);
    await paint(page).locator('.paint-zone-pair').first().locator('.paint-zone').click();
    await expect(paint(page).locator('.paint-reminder')).toBeVisible();
    for (const button of await dock(page).locator('button:visible').all()) {
      const box = await button.boundingBox();
      if (!box) continue;
      const name = (await button.getAttribute('aria-label')) ?? (await button.innerText());
      expect(box.height, `hauteur de « ${name} »`).toBeGreaterThanOrEqual(48);
      expect(box.width, `largeur de « ${name} »`).toBeGreaterThanOrEqual(48);
      expect(box.y, `« ${name} » dans le tiers bas`).toBeGreaterThanOrEqual((780 * 2) / 3);
    }
  });
});
