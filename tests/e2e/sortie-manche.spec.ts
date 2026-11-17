// Le manche virtuel ne perd pas le doigt (demande du 17 novembre 2026 : « on perd le focus du joystick
// virtuel parfois ») : tant que le doigt n'est pas levé, le manche le suit où qu'il aille sur l'écran
// (hors de la zone, sur le NOS, sur le haut de l'écran), un second doigt qui se pose et se lève ne le
// lui prend pas, une capture du pointeur perdue en route est reprise ; seul un pointercancel du
// navigateur le lâche, et il est compté (data-coupures, data-reprises sur l'élément du manche).
// Les doigts sont de vrais événements tactiles (protocole de débogage, Input.dispatchTouchEvent).
// Délais larges : en rendu logiciel la scène avance d'un dixième de seconde par image.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { commencerCourse, DELAI_ROUTE, rentrerAuGarage } from './helpers.ts';

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);

interface Doigt {
  id: number;
  x: number;
  y: number;
}

declare global {
  interface Window {
    __doigts: number[];
  }
}

/** Les doigts posés, et le protocole pour les poser, les bouger, les lever. */
function tactile(cdp: CDPSession) {
  const poses = new Map<number, Doigt>();
  const points = () => [...poses.values()].map((d) => ({ x: d.x, y: d.y, id: d.id }));
  return {
    async poser(doigt: Doigt) {
      poses.set(doigt.id, doigt);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points() });
    },
    async bouger(id: number, x: number, y: number) {
      const d = poses.get(id);
      if (!d) throw new Error(`doigt ${id} absent`);
      d.x = x;
      d.y = y;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points() });
    },
    async lever(id: number) {
      poses.delete(id);
      // Le protocole lit la liste des doigts posés : un doigt qui n'y est plus est levé (touchEnd les lève tous).
      if (poses.size === 0) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points() });
    },
    async annuler() {
      poses.clear();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    },
  };
}

async function centre(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} introuvable`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('sortie de nuit : le manche garde le doigt', () => {
  test.setTimeout(600_000);

  test('hors de la zone, sur le NOS, en haut, avec un second doigt, une capture perdue ; seul le pointercancel coupe', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('./#/sortie');
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
    await commencerCourse(page);
    const manche = page.locator('.drive-manche');
    await expect(manche).toHaveAttribute('data-coupures', '0');
    const lire = async (nom: string) => Number(await manche.getAttribute(`data-${nom}`));
    await page.evaluate(() => {
      window.__doigts = [];
      window.addEventListener('pointerdown', (event) => window.__doigts.push(event.pointerId), true);
    });
    const doigts = tactile(await page.context().newCDPSession(page));
    const zone = await page.locator('.drive-mid').boundingBox();
    if (!zone) throw new Error('zone des gestes introuvable');
    const base = { id: 1, x: zone.x + zone.width * 0.35, y: zone.y + zone.height * 0.62 };

    // 1. Le pouce se pose, pousse vers le haut : gaz, sans braquage.
    await doigts.poser({ ...base });
    await expect(manche).toHaveAttribute('data-actif', 'true');
    await doigts.bouger(1, base.x, base.y - 40);
    await expect.poll(() => lire('gaz')).toBeGreaterThan(0.3);
    expect(await lire('placement')).toBe(0);

    // 2. Le doigt sort de la zone, par le haut de l'écran, sur les boutons du haut : le manche le suit.
    const reglages = await centre(page, '.drive-reglages-btn');
    await doigts.bouger(1, reglages.x, reglages.y);
    // Loin de la base, le bouton reste dans son rayon : le vecteur donne du gaz, et du braquage à droite.
    await expect.poll(() => lire('gaz')).toBeGreaterThan(0.5);
    await expect.poll(() => lire('placement')).toBeGreaterThan(0);
    const placementHaut = await lire('placement');
    await expect(manche).toHaveAttribute('data-actif', 'true');
    const dial = await centre(page, '.drive-dial');
    await doigts.bouger(1, dial.x - 60, dial.y);
    await expect.poll(() => lire('placement')).toBeLessThan(placementHaut);
    await expect(manche).toHaveAttribute('data-actif', 'true');

    // 3. Sur le NOS puis hors de l'écran par le bas : le frein, toujours le même doigt.
    const nos = await centre(page, '.drive-nos');
    await doigts.bouger(1, nos.x, nos.y);
    await expect.poll(() => lire('frein')).toBeGreaterThan(0.3);
    await expect(manche).toHaveAttribute('data-actif', 'true');
    await doigts.bouger(1, nos.x, 843);
    await expect.poll(() => lire('frein')).toBeGreaterThan(0.3);
    await expect(manche).toHaveAttribute('data-actif', 'true');

    // 4. Retour vers le haut, puis un second doigt : dans la zone (ignoré), sur le NOS (il tire), levé.
    await doigts.bouger(1, base.x + 30, base.y - 60);
    await expect.poll(() => lire('gaz')).toBeGreaterThan(0.5);
    const gaz = await lire('gaz');
    const placement = await lire('placement');
    await doigts.poser({ id: 2, x: zone.x + zone.width * 0.7, y: zone.y + zone.height * 0.3 });
    await page.waitForTimeout(300);
    await doigts.lever(2);
    await doigts.poser({ id: 3, ...nos });
    await page.waitForTimeout(300);
    await doigts.lever(3);
    await page.waitForTimeout(300);
    await expect(manche).toHaveAttribute('data-actif', 'true');
    expect(await lire('gaz')).toBe(gaz);
    expect(await lire('placement')).toBe(placement);
    await doigts.bouger(1, base.x + 30, base.y - 100);
    await expect.poll(() => lire('gaz')).toBeGreaterThan(gaz);

    // 5. Une capture du pointeur perdue sans que le doigt se lève : reprise, le doigt mène toujours.
    await page.evaluate(() => {
      const id = window.__doigts[0];
      if (id !== undefined) document.querySelector('.drive-mid')?.releasePointerCapture(id);
    });
    // (Le navigateur annonce la capture perdue à l'événement suivant du doigt.)
    await doigts.bouger(1, base.x - 20, base.y - 20);
    await expect.poll(() => lire('reprises')).toBe(1);
    await doigts.bouger(1, base.x - 30, base.y - 20);
    await expect.poll(() => lire('placement')).toBeLessThan(0);
    await expect(manche).toHaveAttribute('data-actif', 'true');
    // Le haut de l'écran, après la reprise : le manche suit encore.
    await doigts.bouger(1, reglages.x, reglages.y);
    await expect.poll(() => lire('placement')).toBeGreaterThan(0);

    // Aucune coupure subie jusque-là ; le doigt se lève, le manche s'efface.
    expect(await lire('coupures')).toBe(0);
    await doigts.lever(1);
    await expect(manche).toHaveAttribute('data-actif', 'false');
    expect(await lire('gaz')).toBe(0);
    await page.screenshot({ path: resolve('captures', 'vague-r-course', '06-manche-apres-doigt.png') });

    // 6. Un pointercancel du navigateur lâche le manche, et il est compté.
    await doigts.poser({ ...base });
    await expect(manche).toHaveAttribute('data-actif', 'true');
    await doigts.bouger(1, base.x, base.y - 40);
    await expect.poll(() => lire('gaz')).toBeGreaterThan(0.3);
    await doigts.annuler();
    await expect(manche).toHaveAttribute('data-actif', 'false');
    expect(await lire('coupures')).toBe(1);
    expect(await lire('gaz')).toBe(0);
    // Un nouveau doigt reprend le manche aussitôt.
    await doigts.poser({ ...base });
    await expect(manche).toHaveAttribute('data-actif', 'true');
    await doigts.lever(1);

    await rentrerAuGarage(page);
    expect(errors).toEqual([]);
  });
});

mkdirSync(dirname(resolve('captures', 'vague-r-course', 'x')), { recursive: true });
