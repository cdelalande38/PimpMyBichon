// Coût du duel (vague V), à la demande seulement : PMB_MESURE_DUEL=<fichier.json>. Sur la carte la plus lourde
// (la première du menu), au même endroit (départ arrêté, pendant les feux, les deux véhicules tenus sur la
// ligne, caméra de poursuite), relève par image les appels de dessin et les triangles de TOUTES les passes
// (sonde, reflet, ombres comprises : un crochet sur WebGL posé avant l'app) et la durée d'image, sans
// adversaire puis avec. En rendu logiciel, la durée d'image ne vaut que pour comparer les deux.

import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { auSec, commencerCourse, DELAI_ROUTE, ENTREE_SORTIE, openApp, openEntry, pickMap, rentrerAuGarage, waitForScene } from './helpers.ts';

const SORTIE = process.env.PMB_MESURE_DUEL;

interface Releve {
  calls: number;
  triangles: number;
  ms: number;
}

async function relever(page: Page, images: number): Promise<{ calls: number; triangles: number; ms: number; images: number }> {
  const liste = await page.evaluate(
    (n) =>
      new Promise<Releve[]>((done) => {
        const w = window as unknown as { __pmbImages: Releve[] };
        w.__pmbImages = [];
        const attendre = () => (w.__pmbImages.length >= n ? done(w.__pmbImages.slice(0, n)) : setTimeout(attendre, 100));
        attendre();
      }),
    images,
  );
  const med = (k: keyof Releve) => [...liste.map((r) => r[k])].sort((a, b) => a - b)[Math.floor(liste.length / 2)] ?? 0;
  return { calls: med('calls'), triangles: med('triangles'), ms: Math.round(med('ms')), images: liste.length };
}

async function sortieEnFeux(page: Page, duel: boolean): Promise<void> {
  await openEntry(page, ENTREE_SORTIE);
  await pickMap(page);
  await auSec(page);
  const formats = page.locator('footer.dock').getByRole('group', { name: 'Format' });
  await formats.locator(duel ? '[data-format="duel"]' : '[data-format="tour1"]').tap();
  if (duel) await page.locator('footer.dock').getByRole('group', { name: 'Adversaire' }).locator('[data-niveau="or"]').tap();
  await page.locator('footer.dock').getByRole('button', { name: 'Sortir', exact: true }).tap();
  await expect(page.locator(`.${DRIVE_STAGE_CLASS}`)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
  await commencerCourse(page);
  await expect(page.locator(`.${DRIVE_STAGE_CLASS}`)).toHaveAttribute('data-depart', 'feux', { timeout: DELAI_ROUTE });
}

test.describe('coût du duel', () => {
  test.skip(!SORTIE, 'à la demande : PMB_MESURE_DUEL=<fichier.json>');
  test.use({ serviceWorkers: 'block' });

  test('appels de dessin, triangles et durée d’image, sans puis avec l’adversaire', async ({ page }) => {
    test.setTimeout(600_000);
    await page.addInitScript(() => {
      const w = window as unknown as { __pmbImages: Releve[]; __pmbEnCours: Releve };
      w.__pmbImages = [];
      w.__pmbEnCours = { calls: 0, triangles: 0, ms: 0 };
      let avant = performance.now();
      const raf = window.requestAnimationFrame.bind(window);
      const image = () => {
        const now = performance.now();
        const r = w.__pmbEnCours;
        if (r.calls > 0) w.__pmbImages.push({ calls: r.calls, triangles: r.triangles, ms: now - avant });
        avant = now;
        w.__pmbEnCours = { calls: 0, triangles: 0, ms: 0 };
        raf(image);
      };
      raf(image);
      const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...args: number[]) => void>;
      const tri = (mode: number, count: number, inst = 1) => (mode === 4 ? count / 3 : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0) * inst;
      for (const [nom, compte] of [
        ['drawElements', (a: number[]) => tri(a[0]!, a[1]!)],
        ['drawArrays', (a: number[]) => tri(a[0]!, a[2]!)],
        ['drawElementsInstanced', (a: number[]) => tri(a[0]!, a[1]!, a[4]!)],
        ['drawArraysInstanced', (a: number[]) => tri(a[0]!, a[2]!, a[3]!)],
      ] as const) {
        const original = proto[nom]!;
        proto[nom] = function (this: unknown, ...args: number[]) {
          w.__pmbEnCours.calls += 1;
          w.__pmbEnCours.triangles += compte(args);
          return original.apply(this, args);
        };
      }
    });
    await openApp(page);
    await waitForScene(page);
    await sortieEnFeux(page, false);
    const sans = await relever(page, 12);
    await rentrerAuGarage(page);
    await sortieEnFeux(page, true);
    const avec = await relever(page, 12);
    writeFileSync(SORTIE!, JSON.stringify({ carte: 'première du menu', moment: 'défaut', sans, avec }, null, 2));
  });
});
