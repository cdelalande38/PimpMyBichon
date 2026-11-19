// NOS en course (src/data/nos.ts, src/drive/scene/nos.ts, src/ui/drive/NosEffet.tsx) : envoyé au bouton ou
// à la touche Espace, les dards bleus brûlent aux sorties d'échappement (data-nos-flamme sur la scène) et
// l'effet d'écran est posé (data-nos-effet), puis tout est retiré à la fin de la poussée. « Moins de
// mouvement » : l'effet d'écran se réduit à la teinte (aucun trait affiché).
// Captures de revue à la demande (844 × 390, poursuite ; avant, ~0,3 s, ~1,5 s, après la fin) :
// PMB_CAPTURES_NOS=<dossier> ; elles montrent aussi le concept (844 × 390) et le van (390 × 844) qui poussent.
// Coût à la demande, PMB_MESURE_NOS=<fichier.json> : appels de dessin (toutes passes, crochet sur WebGL posé
// avant l'app) et durée d'image, NOS au repos puis envoyé, la Cox de nuit à la poursuite. En rendu
// logiciel, la durée d'image ne vaut que pour comparer.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { attendreApercu, attendreSurLaRoute, commencerCourse, DELAI_ROUTE, openApp, reglerSortie, reloadSaved, tempsDeRoute, waitForScene } from './helpers.ts';

const CAPTURES = process.env.PMB_CAPTURES_NOS;
const MESURE = process.env.PMB_MESURE_NOS;
const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const kmh = async (page: Page) => Number(await stage(page).getAttribute('data-vitesse'));

async function capture(page: Page, nom: string): Promise<void> {
  if (CAPTURES) await page.screenshot({ path: resolve(CAPTURES, `${nom}.png`) });
}

async function poserVehicule(page: Page, id: string): Promise<void> {
  await page.evaluate(
    (vehicule) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(JSON.stringify({ state: { current: vehicule, builds: {}, recents: [] }, version: 1 }), 'pmb-builds');
          tx.oncomplete = () => done();
          tx.onerror = () => fail(tx.error);
        };
      }),
    id,
  );
}

interface Releve {
  calls: number;
  ms: number;
}

/** Médianes des `images` prochaines images (appels de dessin, durée). */
async function relever(page: Page, images: number): Promise<Releve & { images: number }> {
  const liste = await page.evaluate(
    (n) =>
      new Promise<Releve[]>((done) => {
        const w = window as unknown as { __pmbImages: Releve[] };
        w.__pmbImages = [];
        const attendre = () => (w.__pmbImages.length >= n ? done(w.__pmbImages.slice(0, n)) : setTimeout(attendre, 50));
        attendre();
      }),
    images,
  );
  const med = (k: keyof Releve) => [...liste.map((r) => r[k])].sort((a, b) => a - b)[Math.floor(liste.length / 2)] ?? 0;
  return { calls: med('calls'), ms: Math.round(med('ms')), images: liste.length };
}

/** Sortie en paysage (ou en portrait), au sec, `moment` choisi, partie à la main et lancée au-delà de 60 km/h. */
async function lancer(page: Page, vehicule: string, moment: 'Nuit' | 'Jour', { portrait = false }: { portrait?: boolean } = {}): Promise<void> {
  await page.setViewportSize(portrait ? { width: 390, height: 844 } : { width: 844, height: 390 });
  await openApp(page);
  await waitForScene(page);
  await poserVehicule(page, vehicule);
  await reloadSaved(page);
  await waitForScene(page);
  await page.goto('./#/sortie');
  await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
  await expect(stage(page)).toHaveAttribute('data-vehicule', vehicule);
  await attendreApercu(page);
  await reglerSortie(page, 'Météo', 'Sec', { garder: true });
  await reglerSortie(page, 'Moment', moment);
  await commencerCourse(page, { parti: true });
  await page.keyboard.down('ArrowUp');
  await attendreSurLaRoute(page, 'vitesse', () => kmh(page), (v) => v > 60, { secondes: 30 });
}

/** Envoie le NOS (bouton ou Espace), vérifie l'effet posé puis retiré ; captures en chemin. */
async function envoyer(page: Page, par: 'bouton' | 'espace', nom: string, { traits }: { traits: boolean }): Promise<void> {
  const effet = page.locator('.drive-nos-effet');
  await expect(stage(page)).toHaveAttribute('data-nos-flamme', 'non');
  await expect(effet).toBeHidden();
  await capture(page, `${nom}-1-avant`);
  if (par === 'bouton') await page.locator('.drive-nos:visible').first().tap();
  else await page.keyboard.press('Space');
  await expect(stage(page)).toHaveAttribute('data-nos-flamme', 'oui', { timeout: 60_000 });
  await expect(effet).toHaveAttribute('data-nos-effet', 'oui');
  const t0 = await tempsDeRoute(page);
  await capture(page, `${nom}-2-envoi`);
  await expect(effet.locator('.drive-nos-traits i').first()).toBeVisible({ visible: traits });
  await attendreSurLaRoute(page, 'NOS à 1,5 s', () => tempsDeRoute(page), (t) => t >= t0 + 1.4, { secondes: 10 });
  await capture(page, `${nom}-3-milieu`);
  await expect(page.locator('.drive-nos:visible').first()).toHaveAttribute('data-nos', 'envoye');
  await attendreSurLaRoute(page, 'fin du NOS', () => stage(page).getAttribute('data-nos-flamme'), (v) => v === 'non', { secondes: 10 });
  await capture(page, `${nom}-4-apres`);
  await expect(effet).toBeHidden();
}

test.describe('NOS : dards bleus et effet d’accélération', () => {
  test.setTimeout(600_000);

  test.describe('mouvement normal', () => {
    test.use({ reducedMotion: 'no-preference' });

    test('au bouton, de nuit : dards, effet posé puis retiré @nos', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await lancer(page, 'cox', 'Nuit');
      await envoyer(page, 'bouton', 'nuit-cox', { traits: true });
      expect(errors).toEqual([]);
    });

    test('à la touche Espace, de jour, à moto @nos', async ({ page }) => {
      test.skip(!CAPTURES, 'captures de revue : PMB_CAPTURES_NOS=<dossier>');
      await lancer(page, 'bobber', 'Jour');
      await envoyer(page, 'espace', 'jour-bobber', { traits: true });
    });
  });

  test.describe('le concept et le van crachent aussi', () => {
    test.use({ reducedMotion: 'no-preference' });
    test.skip(!CAPTURES, 'captures de revue : PMB_CAPTURES_NOS=<dossier>');

    test('le concept, de nuit, en paysage @nos', async ({ page }) => {
      await lancer(page, 'concept', 'Nuit');
      await expect(stage(page)).not.toHaveAttribute('data-sorties', '0');
      await envoyer(page, 'espace', 'nuit-concept', { traits: true });
    });

    test('le van, de nuit, en portrait @nos', async ({ page }) => {
      await lancer(page, 'van', 'Nuit', { portrait: true });
      await expect(stage(page)).not.toHaveAttribute('data-sorties', '0');
      await envoyer(page, 'bouton', 'nuit-van-portrait', { traits: true });
    });
  });

  test.describe('coût', () => {
    test.use({ reducedMotion: 'no-preference', serviceWorkers: 'block' });
    test.skip(!MESURE, 'à la demande : PMB_MESURE_NOS=<fichier.json>');

    test('appels de dessin et durée d’image, NOS au repos puis envoyé @nos', async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as unknown as { __pmbImages: Releve[]; __pmbEnCours: Releve };
        w.__pmbImages = [];
        w.__pmbEnCours = { calls: 0, ms: 0 };
        let avant = performance.now();
        const raf = window.requestAnimationFrame.bind(window);
        const image = () => {
          const now = performance.now();
          if (w.__pmbEnCours.calls > 0) w.__pmbImages.push({ calls: w.__pmbEnCours.calls, ms: now - avant });
          avant = now;
          w.__pmbEnCours = { calls: 0, ms: 0 };
          raf(image);
        };
        raf(image);
        const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...args: number[]) => void>;
        for (const nom of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
          const original = proto[nom]!;
          proto[nom] = function (this: unknown, ...args: number[]) {
            w.__pmbEnCours.calls += 1;
            return original.apply(this, args);
          };
        }
      });
      await lancer(page, 'cox', 'Nuit');
      const repos = await relever(page, 12);
      await page.keyboard.press('Space');
      await expect(stage(page)).toHaveAttribute('data-nos-flamme', 'oui', { timeout: 60_000 });
      const pousse = await relever(page, 12);
      await expect(stage(page)).toHaveAttribute('data-nos-flamme', 'oui');
      writeFileSync(MESURE!, JSON.stringify({ vehicule: 'cox', moment: 'nuit', camera: 'poursuite', repos, pousse }, null, 2));
    });
  });

  test('moins de mouvement : la teinte seulement, sans traits @nos', async ({ page }) => {
    await lancer(page, 'cox', 'Nuit');
    await envoyer(page, 'espace', 'reduit-cox', { traits: false });
  });
});
