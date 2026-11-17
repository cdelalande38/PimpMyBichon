// Annonce des virages (src/drive/virages.ts, src/ui/drive/MiniCarte.tsx) : pas de mini-carte dans
// l'aperçu ; en course, elle est là, dessinée, hors d'atteinte du doigt ; data-virage annonce le sens
// et la distance du prochain virage, et change quand on l'a passé. Les balises à chevrons (scène) et le cœur se
// prouvent par les tests unitaires (tests/unit/drive-virages.test.ts, drive-chevrons.test.ts).
// Captures : captures/vague-q-virages/parcours-*.png.
//
// Délais larges : en rendu logiciel la scène tombe à une image par seconde et le temps de sortie
// avance d'un dixième de seconde par image.

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { attendreApercu, commencerCourse, ouvrirReglages, reglagesSortie } from './helpers.ts';

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const carte = (page: Page) => page.locator('.minicarte');

async function photo(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'vague-q-virages', `parcours-${name}.png`);
  mkdirSync(resolve('captures', 'vague-q-virages'), { recursive: true });
  await page.screenshot({ path });
}

test.describe('annonce des virages', () => {
  // Délai large : en CI, le pilote automatique repart arrêté de la ligne et met plus de cinq minutes
  // d'horloge à passer le premier virage (CI du 17 novembre 2026 : 60 m en 300 s).
  test.setTimeout(1_080_000);

  test('la mini-carte est là en course, et data-virage change après un virage', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('./#/sortie');
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
    await expect(page.locator('.drive-chargement')).toHaveCount(0, { timeout: 30_000 });

    // Dans l'aperçu : l'écran est épuré, la mini-carte n'est pas montée.
    await attendreApercu(page);
    await expect(carte(page)).toHaveCount(0);

    // La course commence ; au vert, la mini-carte apparaît, dessinée.
    await commencerCourse(page, { parti: true });
    await expect(carte(page)).toHaveAttribute('data-visible', 'true', { timeout: 30_000 });
    await expect(carte(page)).toBeVisible();
    const box = await carte(page).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(110);
    expect(box?.width).toBeLessThanOrEqual(130);
    expect(box?.height).toBeGreaterThanOrEqual(110);
    expect(box?.height).toBeLessThanOrEqual(130);
    // Rien ne reçoit le doigt : elle ne gêne aucune commande.
    expect(await carte(page).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    await expect
      .poll(
        () =>
          page.locator('.minicarte canvas').evaluate((canvas: HTMLCanvasElement) => {
            const ctx = canvas.getContext('2d');
            if (!ctx) return 0;
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let pixels = 0;
            for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) pixels += 1;
            return pixels;
          }),
        { message: 'le tracé est dessiné', timeout: 30_000 },
      )
      .toBeGreaterThan(300);

    // Le prochain virage : sens et distance (arrondie à 10 m), ou « aucun ».
    await expect(carte(page)).toHaveAttribute('data-virage', /^(gauche|droite):\d+$/, { timeout: 30_000 });
    const premier = await carte(page).getAttribute('data-virage-index');
    const sens = (await carte(page).getAttribute('data-virage'))?.split(':')[0];
    expect(['gauche', 'droite']).toContain(sens);
    expect(Number(await carte(page).getAttribute('data-virage-cran'))).toBeGreaterThanOrEqual(1);
    await photo(page, 'minicarte');

    // Pilote automatique des réglages (la course continue) : la route avance, on passe le virage, le
    // prochain est un autre.
    await (await ouvrirReglages(page)).getByRole('button', { name: 'Pilote automatique' }).tap();
    await expect(reglagesSortie(page)).toHaveCount(0);
    await expect(carte(page)).toHaveAttribute('data-visible', 'true');
    await expect(carte(page)).not.toHaveAttribute('data-virage-index', premier ?? '', { timeout: 600_000 });
    await expect(carte(page)).toHaveAttribute('data-virage', /^(gauche|droite):\d+$|^aucun$/);
    await photo(page, 'apres-virage');
    expect(errors).toEqual([]);
  });
});
