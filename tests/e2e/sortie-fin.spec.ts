// Fin de parcours de la sortie de nuit, sur Miami Beach, départ « Vers la 41e rue » (environ 1,2 km de route
// ouverte, la plus courte du catalogue) :
// - l'aperçu repart du départ par un fondu au noir (0,4 s pour sortir, 0,4 s pour revenir, la scène remet le
//   véhicule au départ pendant que l'écran est noir) au lieu d'une coupe ; sans mouvement, coupe franche ;
// - à l'arrivée, un seul « Rentrer au garage » à l'écran.
// Délais larges : en rendu logiciel la scène avance d'un dixième de seconde par image, et la route met des
// minutes à finir. Captures : captures/vague-r-course/.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { attendreApercu, choisirDepart, DELAI_ROUTE, ENTREE_SORTIE, openApp, openEntry, ouvrirReglages, pickMap, rentrerAuGarage, waitForScene } from './helpers.ts';

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const DEPART = 'Vers la 41e rue';
const CARTE = 3;

async function shot(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'vague-r-course', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

/** Sort sur Miami Beach, au dernier départ : il reste peu de route. */
async function sortirDuMenu(page: Page, mode: 'course' | 'balade' = 'course'): Promise<void> {
  await openApp(page);
  await waitForScene(page);
  await openEntry(page, ENTREE_SORTIE);
  await pickMap(page, CARTE, mode);
  const dock = page.locator('footer.dock');
  await choisirDepart(page, new RegExp(DEPART));
  await dock.getByRole('button', { name: 'Jouer', exact: true }).tap();
  await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
}

interface Trace {
  noir: boolean;
  opacite: string;
  duree: number;
}

declare global {
  interface Window {
    __fondu: Trace[];
  }
}

test.describe('sortie de nuit : le bout de la route', () => {
  test.setTimeout(1_800_000);
  // Route de 1,2 km : 15 à 20 minutes en rendu logiciel. Hors de la passe courante et de la CI.
  test.skip(!process.env.PMB_SORTIE_FIN, 'parcours long : PMB_SORTIE_FIN=1 pour le lancer');

  test.describe('avec du mouvement', () => {
    test.use({ reducedMotion: 'no-preference' });

    test('l’aperçu repart du départ par un fondu au noir', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await sortirDuMenu(page);
      // Les deux temps du fondu, relevés à la fin de chaque transition : (noir, opacité atteinte, durée).
      await page.evaluate(() => {
        window.__fondu = [];
        const el = document.querySelector('.drive-fondu');
        el?.addEventListener('transitionend', (event) => {
          if ((event as TransitionEvent).propertyName !== 'opacity') return;
          window.__fondu.push({ noir: el.hasAttribute('data-noir'), opacite: getComputedStyle(el).opacity, duree: (event as TransitionEvent).elapsedTime });
        });
      });
      const s0 = Number(await stage(page).getAttribute('data-s'));
      expect(s0).toBeGreaterThan(3000);
      let relevés = 0;
      await expect
        .poll(
          async () => {
            // Un point toutes les 20 s dans le journal : où en est la route (en rendu logiciel, très lente).
            if (relevés++ % 10 === 0) console.log(`s = ${await stage(page).getAttribute('data-s')} m, ${await stage(page).getAttribute('data-vitesse')} km/h`);
            return page.evaluate(() => window.__fondu.length);
          },
          { timeout: 1_500_000, intervals: [2000] },
        )
        .toBeGreaterThanOrEqual(2);
      const trace = await page.evaluate(() => window.__fondu);
      expect(trace[0]).toMatchObject({ noir: true, opacite: '1' });
      expect(trace[0]?.duree).toBeCloseTo(0.4, 1);
      expect(trace[1]).toMatchObject({ noir: false, opacite: '0' });
      expect(trace[1]?.duree).toBeCloseTo(0.4, 1);
      // Le véhicule est revenu au départ, le fondu ne laisse rien sur l'écran.
      expect(Number(await stage(page).getAttribute('data-s'))).toBeLessThan(3900);
      await expect(page.locator('.drive-fondu')).not.toHaveAttribute('data-noir', /.*/);
      await expect(page.locator('.drive-mid')).toHaveAttribute('data-conduite', 'auto');
      await expect(page.locator('.drive-invite')).toBeVisible();
      await rentrerAuGarage(page);
      expect(errors).toEqual([]);
    });
  });

  test.describe('sans mouvement', () => {
    test.use({ reducedMotion: 'reduce' });

    test('coupe franche, sans fondu', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await sortirDuMenu(page);
      // Aucun fondu au noir levé, nulle part, pendant toute la fin de route de l'aperçu.
      await page.evaluate(() => {
        window.__fondu = [];
        const el = document.querySelector('.drive-fondu');
        if (!el) return;
        new MutationObserver(() => {
          if (el.hasAttribute('data-noir')) window.__fondu.push({ noir: true, opacite: '', duree: 0 });
        }).observe(el, { attributes: true });
      });
      const vu = { fin: false };
      await expect
        .poll(
          async () => {
            const s = Number(await stage(page).getAttribute('data-s'));
            if (s > 4500) vu.fin = true;
            return vu.fin && s < 4000;
          },
          { timeout: 1_500_000, intervals: [1000] },
        )
        .toBe(true);
      expect(await page.evaluate(() => window.__fondu)).toEqual([]);
      await rentrerAuGarage(page);
      expect(errors).toEqual([]);
    });
  });

  // Mouvement réduit par défaut (playwright.config.ts) : la route ne fait pas de fondu, sans objet ici.
  test('à l’arrivée, un seul « Rentrer au garage »', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await sortirDuMenu(page, 'balade');
    // À la main depuis la ligne, puis le pilote automatique mène jusqu'à l'arrivée.
    await attendreApercu(page);
    await page.locator('.drive-mid').tap({ position: { x: 150, y: 200 } });
    await expect(page.locator('.drive-mid')).toHaveAttribute('data-conduite', 'main');
    await (await ouvrirReglages(page)).getByRole('button', { name: 'Pilote automatique' }).tap();
    await expect(stage(page)).toHaveAttribute('data-depart', 'arrive', { timeout: 1_500_000 });
    await expect(page.locator('.drive-arrivee')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rentrer au garage' })).toHaveCount(1);
    await expect(page.locator('.drive-arrivee').getByRole('button', { name: 'Rentrer au garage' })).toBeVisible();
    await shot(page, '04-arrivee');
    await rentrerAuGarage(page);
    await expect(stage(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
