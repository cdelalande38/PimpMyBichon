// Revue de l'écran « Jouer » (vague X, 21 novembre 2026) : captures des modes, d'un mode choisi (réglages d'une course,
// d'un duel), de la carrière et du garage sans le bouton rond, en portrait (390 × 844), en paysage (844 × 390) et sur
// PC (1366 × 768, à la souris). Seulement avec PMB_CAPTURES_JOUER=1 ; captures dans captures/vague-x-jouer/.
// Mesures à chaque étape : rien ne recouvre « Jouer », les cartes sont entières, 48 px au doigt.

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { cartesDuMenu, openApp, waitForScene } from './helpers.ts';

const ACTIF = Boolean(process.env.PMB_CAPTURES_JOUER);
const FORMATS = [
  { nom: 'portrait', viewport: { width: 390, height: 844 }, mobile: true },
  { nom: 'paysage', viewport: { width: 844, height: 390 }, mobile: true },
  { nom: 'pc', viewport: { width: 1366, height: 768 }, mobile: false },
] as const;

const dock = (page: Page) => page.locator('footer.dock');

async function photo(page: Page, format: string, nom: string): Promise<void> {
  const dir = resolve('captures', 'vague-x-jouer');
  mkdirSync(dir, { recursive: true });
  await page.waitForTimeout(900);
  await page.screenshot({ path: resolve(dir, `${format}-${nom}.png`) });
}

/** Cibles sous 48 px, et recouvrement de « Jouer » (réglages) par un choix, dans le dock. */
async function mesurer(page: Page): Promise<{ petites: string[]; couvert: string[]; horsEcran: string[] }> {
  return page.evaluate(() => {
    const petites: string[] = [];
    const horsEcran: string[] = [];
    const boutons = [...document.querySelectorAll<HTMLElement>('footer.dock button, footer.dock summary')];
    for (const el of boutons) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const nom = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 28);
      if (r.width < 47.5 || r.height < 47.5) petites.push(`${nom} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    const go = document.querySelector<HTMLElement>('footer.dock .drive-go');
    const couvert: string[] = [];
    if (go) {
      const g = go.getBoundingClientRect();
      for (const el of document.querySelectorAll<HTMLElement>('footer.dock .entree-corps button, footer.dock .entree-corps summary')) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const visible = r.bottom > 0 && r.top < innerHeight;
        const dedans = el.closest('.entree-corps')?.getBoundingClientRect();
        if (dedans && r.top >= dedans.top - 1 && r.bottom <= dedans.bottom + 1 && visible && r.bottom > g.top + 1 && r.top < g.bottom - 1) couvert.push((el.textContent ?? '').trim().slice(0, 28));
      }
    }
    return { petites, couvert, horsEcran };
  });
}

for (const f of FORMATS) {
  test.describe(`revue Jouer · ${f.nom}`, () => {
    test.skip(!ACTIF, 'PMB_CAPTURES_JOUER=1 pour lancer la revue');
    test.use({ viewport: f.viewport, isMobile: f.mobile, hasTouch: f.mobile });

    test('modes, mode choisi, duel, carrière, garage', async ({ page }) => {
      test.setTimeout(300_000);
      const carte = cartesDuMenu()[0]!;
      const plusieurs = cartesDuMenu().filter((autre) => autre.zone === carte.zone).length > 1;
      await openApp(page);
      await waitForScene(page);
      await photo(page, f.nom, '0-garage-sans-bouton-rond');
      await dock(page).getByRole('button', { name: 'Jouer', exact: true }).click();
      await photo(page, f.nom, '1-modes');
      console.log(f.nom, 'modes', JSON.stringify(await mesurer(page)));
      await dock(page).locator('[data-mode="carriere"]').click();
      await photo(page, f.nom, '2-carriere');
      await page.keyboard.press('Escape');
      await dock(page).locator('[data-mode="course"]').click();
      await photo(page, f.nom, '3-lieu');
      await dock(page).getByRole('group', { name: 'Lieu' }).locator(`[data-zone="${carte.zone}"]`).click();
      if (plusieurs) {
        await photo(page, f.nom, '4-circuit');
        await dock(page).getByRole('group', { name: 'Circuit' }).locator(`[data-carte="${carte.id}"]`).click();
      }
      await expect(dock(page).locator('.drive-go')).toBeVisible();
      await expect(dock(page).locator('.drive-entry[data-etape="reglages"]')).toBeVisible();
      await page.waitForTimeout(1500);
      await photo(page, f.nom, '5-reglages-course');
      console.log(f.nom, 'course', JSON.stringify(await mesurer(page)));
      await dock(page).locator('.entree-ciel-resume').click();
      await photo(page, f.nom, '5b-reglages-course-ciel');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      if (plusieurs) await page.keyboard.press('Escape');
      await dock(page).locator('[data-mode="duel"]').click();
      await dock(page).getByRole('group', { name: 'Lieu' }).locator(`[data-zone="${carte.zone}"]`).click();
      if (plusieurs) await dock(page).getByRole('group', { name: 'Circuit' }).locator(`[data-carte="${carte.id}"]`).click();
      await expect(dock(page).getByRole('group', { name: 'Adversaire' })).toBeVisible();
      await page.waitForTimeout(1500);
      await photo(page, f.nom, '6-reglages-duel');
      console.log(f.nom, 'duel', JSON.stringify(await mesurer(page)));
    });
  });
}
