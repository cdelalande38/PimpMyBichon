// Manette physique (API Gamepad) à la sortie de nuit : depuis l'aperçu, un bouton de face ou Start lance
// la course comme l'appui sur l'écran ; sous « Pilote automatique », un bouton rend le volant ;
// l'invitation le dit quand une manette est branchée. La manette est simulée : navigator.getGamepads est
// remplacé dans la page (avant tout script), la connexion annoncée par l'événement « gamepadconnected ».
// Délais larges : en rendu logiciel la scène avance d'un dixième de seconde par image.
// Captures : captures/vague-r-course/.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { attendreApercu, DELAI_ROUTE, fermerReglages, ouvrirReglages, preferBalade, reglagesSortie, rentrerAuGarage } from './helpers.ts';

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);

async function shot(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'vague-r-course', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

interface PadSimulee {
  brancher: () => void;
  debrancher: () => void;
  bouton: (index: number, presse: boolean) => void;
}

declare global {
  interface Window {
    __pad: PadSimulee;
  }
}

/** Manette de la page : aucune au départ ; `brancher` l'annonce, `bouton` presse ou relâche un bouton. */
async function installerManette(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let branchee = false;
    const boutons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => (branchee ? [{ connected: true, id: 'manette de test', index: 0, mapping: 'standard', timestamp: performance.now(), axes: [0, 0, 0, 0], buttons: boutons }] : [null, null, null, null]),
    });
    window.__pad = {
      brancher: () => {
        branchee = true;
        window.dispatchEvent(new Event('gamepadconnected'));
      },
      debrancher: () => {
        branchee = false;
        window.dispatchEvent(new Event('gamepaddisconnected'));
      },
      bouton: (index, presse) => {
        const b = boutons[index];
        if (!b) return;
        b.pressed = presse;
        b.value = presse ? 1 : 0;
      },
    };
  });
}

const bouton = (page: Page, index: number, presse: boolean) => page.evaluate(([i, p]) => window.__pad.bouton(i as number, p as boolean), [index, presse]);

test.describe('sortie de nuit : la manette physique', () => {
  test.setTimeout(600_000);

  test('un bouton lance la course, un autre rend le volant', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await installerManette(page);
    await preferBalade(page);
    await page.goto('./#/sortie');
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
    // Sans manette : l'invitation d'avant.
    await attendreApercu(page);
    await expect(page.locator('.drive-invite')).not.toHaveAttribute('data-manette', /.*/);
    const zone = page.locator('.drive-mid');
    await expect(zone).toHaveAttribute('data-conduite', 'auto');

    // Manette branchée : l'invitation le dit.
    await page.evaluate(() => window.__pad.brancher());
    await expect(page.locator('.drive-invite')).toHaveText('Touche l’écran ou un bouton de la manette pour commencer');
    await expect(page.locator('.drive-invite')).toHaveAttribute('data-manette', 'true');
    await page.waitForTimeout(800);
    await shot(page, '01-apercu-manette-branchee');

    // Réglages ouverts : un bouton ne lance rien.
    await ouvrirReglages(page);
    await bouton(page, 1, true);
    await page.waitForTimeout(1200);
    await bouton(page, 1, false);
    await expect(zone).toHaveAttribute('data-conduite', 'auto');
    await fermerReglages(page);

    // Un bouton tenu avant de revenir à l'écran ne compte pas, un appui neuf si : « A » (bouton 0), tenu
    // un peu après le départ, ne tire pas le NOS en passant.
    await bouton(page, 0, true);
    await expect(zone).toHaveAttribute('data-conduite', 'main', { timeout: DELAI_ROUTE });
    await expect(stage(page)).toHaveAttribute('data-depart', /^(attente|feux)$/, { timeout: DELAI_ROUTE });
    await expect(page.locator('.drive-invite')).toHaveCount(0);
    await page.waitForTimeout(1500);
    await expect(page.locator('.drive-nos')).toHaveAttribute('data-nos', 'pret');
    await bouton(page, 0, false);

    // « Pilote automatique » : le pilote reprend ; Start (bouton 9) rend le volant.
    await expect(stage(page)).toHaveAttribute('data-depart', 'parti', { timeout: DELAI_ROUTE });
    await (await ouvrirReglages(page)).getByRole('button', { name: 'Pilote automatique' }).tap();
    await expect(reglagesSortie(page)).toHaveCount(0);
    await expect(zone).toHaveAttribute('data-conduite', 'auto');
    await expect(page.locator('.drive-invite')).toHaveText('Touche l’écran ou un bouton de la manette pour reprendre la main');
    await shot(page, '02-pilote-manette-branchee');
    await bouton(page, 9, true);
    await expect(zone).toHaveAttribute('data-conduite', 'main', { timeout: DELAI_ROUTE });
    await bouton(page, 9, false);

    // Manette débranchée : l'invitation redevient celle de l'écran seul.
    await (await ouvrirReglages(page)).getByRole('button', { name: 'Pilote automatique' }).tap();
    await page.evaluate(() => window.__pad.debrancher());
    await expect(page.locator('.drive-invite')).toHaveText('Touche l’écran pour reprendre la main');

    await rentrerAuGarage(page);
    await expect(stage(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
