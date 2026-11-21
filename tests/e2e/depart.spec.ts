// Départ arrêté de la sortie de nuit (src/drive/depart.ts) : l'aperçu roule sans feux ; un appui sur
// la route ramène le véhicule sur la ligne : feux rouge, rouge, vert ; le véhicule
// tenu sur la ligne pendant les feux, même accélérateur tenu à la main ; au vert il part et le chrono
// monte ; en pause le chrono se fige. L'arrivée et les tours se prouvent par les tests unitaires du
// cœur (tests/unit/drive-depart.test.ts) : le parcours ne roule pas des kilomètres en rendu logiciel.
//
// Délais larges : en rendu logiciel la scène tombe à une image par seconde, et le temps de sortie
// avance d'un dixième de seconde par image.

import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { attendreApercu, commencerCourse, preferBalade } from './helpers.ts';

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const attr = async (page: Page, name: string) => Number(await stage(page).getAttribute(name));

test.describe('départ arrêté', () => {
  test.setTimeout(480_000);

  test('feux, véhicule tenu même accélérateur tenu, chrono au vert, pause qui fige', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await preferBalade(page);
    await page.goto('./#/sortie');
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
    await expect(page.locator('.drive-chargement')).toHaveCount(0, { timeout: 30_000 });
    // L'aperçu : parti sans feux, le véhicule roule déjà ; ni feux ni chrono à l'écran.
    await attendreApercu(page);
    await expect(stage(page)).toHaveAttribute('data-depart', 'parti');
    await expect.poll(() => attr(page, 'data-s'), { timeout: 150_000 }).toBeGreaterThan(5);
    const feux = page.locator('.drive-feux');
    await expect(feux).toHaveCount(0);
    await expect(page.locator('.drive-chrono')).toHaveCount(0);
    // Un appui sur la route : retour sur la ligne, les feux, trois lampes sous le compte-tours.
    await commencerCourse(page);
    await expect(stage(page)).toHaveAttribute('data-depart', 'feux', { timeout: 60_000 });
    await expect(feux.locator('i')).toHaveCount(3);
    const s0 = await attr(page, 'data-s');

    // À la main, le manche poussé vers le haut et tenu : les gaz.
    const box = await page.locator('.drive-mid').boundingBox();
    if (!box) throw new Error('zone des gestes introuvable');
    const cdp = await page.context().newCDPSession(page);
    const x = box.x + box.width * 0.5;
    const y = box.y + box.height * 0.6;
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', py: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: py, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
    await touch('touchStart', y);
    for (let i = 1; i <= 5; i += 1) await touch('touchMove', y - 16 * i);
    await expect(page.locator('.drive-manche')).toHaveAttribute('data-actif', 'true');

    // Tant que les feux ne sont pas au vert : vitesse nulle, abscisse inchangée, chrono à zéro.
    let vus = 0;
    const rouges = new Set<number>();
    for (let k = 0; k < 600; k += 1) {
      const phase = await stage(page).getAttribute('data-depart');
      if (phase !== 'feux') break;
      vus += 1;
      expect(await attr(page, 'data-vitesse')).toBe(0);
      expect(await attr(page, 'data-s')).toBe(s0);
      expect(await attr(page, 'data-chrono')).toBe(0);
      rouges.add(await feux.locator('i[data-feu="rouge"]').count());
      await page.waitForTimeout(250);
    }
    expect(vus).toBeGreaterThan(1);
    // Les rouges s'allument l'un après l'autre (un relevé peut manquer un état bref, jamais les deux).
    expect([...rouges].some((n) => n > 0)).toBe(true);

    // Au vert : il part, le chrono monte.
    await expect(stage(page)).toHaveAttribute('data-depart', 'parti', { timeout: 150_000 });
    await expect.poll(() => attr(page, 'data-vitesse'), { timeout: 150_000 }).toBeGreaterThan(0);
    await expect.poll(() => attr(page, 'data-chrono'), { timeout: 150_000 }).toBeGreaterThan(5);
    // L'abscisse est publiée au mètre : au vert, le véhicule met un instant à en parcourir un.
    await expect.poll(() => attr(page, 'data-s'), { timeout: 150_000 }).toBeGreaterThan(s0);
    await expect(page.locator('.drive-chrono b')).toHaveText(/^\d+:\d\d\.\d$/);
    await touch('touchEnd', y);

    // Pause : le chrono se fige.
    await page.getByRole('button', { name: 'Pause' }).tap();
    await page.waitForTimeout(1500);
    const fige = await attr(page, 'data-chrono');
    const texte = await page.locator('.drive-chrono b').textContent();
    await page.waitForTimeout(3000);
    expect(await attr(page, 'data-chrono')).toBe(fige);
    expect(await page.locator('.drive-chrono b').textContent()).toBe(texte);
    await page.getByRole('button', { name: 'Reprendre' }).tap();
    await expect.poll(() => attr(page, 'data-chrono'), { timeout: 150_000 }).toBeGreaterThan(fige);
    // Les lampes se sont effacées une seconde après le vert.
    await expect(feux).toHaveAttribute('data-visible', 'non', { timeout: 150_000 });
    // Le chrono prend alors la place des feux, sous le compte-tours.
    await expect(page.locator('.drive-chrono')).toHaveAttribute('data-visible', 'oui', { timeout: 30_000 });
    expect(errors).toEqual([]);
  });
});
