// Vague U, lot « finitions » : ce que les lots phares et échappement ont laissé. Au garage : la caméra
// cadre l'avant pendant le réglage des phares, l'arrière pour les feux (voiture et moto, portrait et
// paysage, orbite au doigt libre) ; le fil du dock garde « Échappement » entier en très grand texte et
// en paysage ; une option payante posée sans être acquise reste en place et le panneau le dit ; l'ombre
// de contact se refait au changement de pièce montée ; la ligne libre crache au garage au lâcher d'un
// coup de gaz tenu, l'arrière cadré au-dessus du menu. Captures de revue à la demande seulement (PMB_CAPTURES_FINITIONS : un dossier), avec
// les vues de la sortie (pluie sous un éclairage coloré, flammes de nuit et de jour, planche de bord).

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import {
  attendreRoute,
  attendreSurLaRoute,
  auSec,
  backToSections,
  changedRatio,
  choisirCamera,
  commencerCourse,
  DELAI_ROUTE,
  ENTREE_SORTIE,
  openApp,
  openEntry,
  pickMap,
  reglerSortie,
  reloadSaved,
  rentrerAuGarage,
  sceneBand,
  waitForBench,
  waitForScene,
} from './helpers.ts';

const CAPTURES = process.env.PMB_CAPTURES_FINITIONS;
const dock = (page: Page) => page.locator('footer.dock');
const garage = (page: Page) => page.locator('.stage');
const sortie = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);

async function photo(page: Page, nom: string): Promise<void> {
  if (!CAPTURES) return;
  mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURES, `${nom}.png`) });
}

/** Écrit une clé de la sauvegarde (IndexedDB, format des stores persistés). */
async function ecrire(page: Page, cle: string, etat: unknown): Promise<void> {
  await page.evaluate(
    ({ cle, etat }) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const transaction = open.result.transaction('kv', 'readwrite');
          transaction.objectStore('kv').put(JSON.stringify({ state: etat, version: 1 }), cle);
          transaction.oncomplete = () => done();
          transaction.onerror = () => fail(transaction.error);
        };
      }),
    { cle, etat },
  );
}

/** Pose un véhicule à l'écran, son build et l'état du jeu, puis relance l'app sur eux. */
async function poser(page: Page, vehicle: string, build: Record<string, unknown>, jeu: Record<string, unknown> = { solde: 0, articles: {}, hautsFaits: { 'premier-achat': true }, cumuls: { courses: 1, achats: 1 } }): Promise<void> {
  await ecrire(page, 'pmb-builds', { current: vehicle, builds: { [vehicle]: { paints: {}, ...build } }, recents: [vehicle] });
  await ecrire(page, 'pmb-jeu', jeu);
  await reloadSaved(page);
  await waitForBench(page);
}

/** L'image ne bouge plus : deux fenêtres calmes de suite (une image peut prendre plusieurs secondes). */
async function calme(page: Page): Promise<void> {
  let calmes = 0;
  await expect
    .poll(
      async () => {
        const before = await sceneBand(page);
        await page.waitForTimeout(700);
        calmes = (await changedRatio(before, await sceneBand(page))) < 0.0005 ? calmes + 1 : 0;
        return calmes;
      },
      { message: 'scène immobile deux fois de suite', timeout: 120_000, intervals: [300] },
    )
    .toBeGreaterThanOrEqual(2);
}

/** Azimut de l'orbite du garage (degrés, data-orbite), une fois posé. */
async function azimut(page: Page): Promise<number> {
  let dernier = '';
  let valeur = Number.NaN;
  await expect
    .poll(
      async () => {
        const brut = (await garage(page).getAttribute('data-orbite')) ?? '';
        const pose = brut !== '' && brut === dernier;
        dernier = brut;
        valeur = Number(brut.split(',')[0]);
        return pose;
      },
      { message: 'orbite posée', timeout: 30_000, intervals: [400] },
    )
    .toBe(true);
  return valeur;
}

const ecart = (a: number, b: number) => ((a - b + 540) % 360) - 180;

/** Glissé horizontal au doigt dans la scène (la caméra tourne autour du véhicule). */
async function glisser(page: Page, dx: number, y = 300): Promise<void> {
  const depart = { x: 195, y };
  await page.mouse.move(depart.x, depart.y);
  await page.mouse.down();
  for (let pas = 1; pas <= 10; pas += 1) await page.mouse.move(depart.x + (dx * pas) / 10, depart.y);
  await page.mouse.up();
}

/** La zone cadrée tient dans la partie libre de l'écran (attributs de la scène, src/scene/useZoneFraming.ts). */
async function cadreDansLibre(page: Page): Promise<void> {
  await expect(garage(page)).toHaveAttribute('data-zone-ecran', /\d/);
  const zone = ((await garage(page).getAttribute('data-zone-ecran')) ?? '').split(',').map(Number);
  const libre = ((await garage(page).getAttribute('data-cadrage-libre')) ?? '').split(',').map(Number);
  const [l, t, r, b] = zone as [number, number, number, number];
  const [fl, ft, fr, fb] = libre as [number, number, number, number];
  const tol = 4;
  expect(l, 'zone dans la partie libre (gauche)').toBeGreaterThanOrEqual(fl - tol);
  expect(r, 'zone dans la partie libre (droite)').toBeLessThanOrEqual(fr + tol);
  expect(t, 'zone dans la partie libre (haut)').toBeGreaterThanOrEqual(ft - tol);
  expect(b, 'zone dans la partie libre (bas)').toBeLessThanOrEqual(fb + tol);
}

async function tailleTexte(page: Page, taille: string): Promise<void> {
  await openApp(page, '#/reglages');
  const dialog = page.getByRole('dialog', { name: 'Réglages' });
  await dialog.getByRole('button', { name: 'Texte' }).click();
  await dialog.getByRole('button', { name: new RegExp(`^${taille}`) }).click();
  await dialog.getByRole('button', { name: 'Retour à l’atelier' }).click();
  await expect(dialog).toBeHidden();
}

/** L'étape du fil est entière (rien de coupé par une ellipse) et « Retour » garde 48 px et son nom. */
async function filEntier(page: Page, attendu: string, quoi: string): Promise<void> {
  const ici = dock(page).locator('.dock-crumb-here');
  await expect(ici).toHaveText(attendu);
  // Entier deux fois de suite, à une seconde d'écart : le menu a fini de se poser (poignée comprise).
  let entiers = 0;
  await expect
    .poll(
      async () => {
        await page.waitForTimeout(1_000);
        // Mesure fine (au dixième de pixel) : l'ellipse mange deux lettres pour un débord de quelques dixièmes.
        const entier = await ici.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const texte = range.getBoundingClientRect();
          const boite = element.getBoundingClientRect();
          return texte.width <= boite.width + 0.25 && element.scrollHeight <= element.clientHeight + 1;
        });
        entiers = entier ? entiers + 1 : 0;
        return entiers;
      },
      { message: `${quoi} : « ${attendu} » entier`, timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(2);
  const retour = dock(page).getByRole('button', { name: 'Retour', exact: true });
  const boite = await retour.boundingBox();
  expect(Math.min(boite?.width ?? 0, boite?.height ?? 0), `${quoi} : « Retour » à 48 px`).toBeGreaterThanOrEqual(47.5);
  const tete = dock(page).locator('.dock-head');
  expect(await tete.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), `${quoi} : la ligne de repère ne déborde pas`).toBe(true);
}

test.describe('finitions au garage', () => {
  test('phares : l’avant cadré pour la lumière, l’arrière pour les feux, voiture et moto, portrait et paysage', async ({ page }) => {
    test.setTimeout(420_000);
    await openApp(page);
    await waitForScene(page);
    await poser(page, 'cox', {});
    await openEntry(page, 'Phares');
    await expect(garage(page)).toHaveAttribute('data-cadrage', 'phares-avant', { timeout: 30_000 });
    await cadreDansLibre(page);
    await calme(page);
    await photo(page, '01-cox-phares-avant');
    await dock(page).getByTestId('phares').getByRole('button', { name: 'Feux', exact: true }).tap();
    await expect(garage(page)).toHaveAttribute('data-cadrage', 'phares-arriere', { timeout: 30_000 });
    await cadreDansLibre(page);
    await calme(page);
    await photo(page, '02-cox-feux-arriere');

    // L'orbite au doigt reste libre : la vue tourne, le cadrage reste demandé.
    const avant = await azimut(page);
    await glisser(page, 120, 250);
    expect(Math.abs(ecart(await azimut(page), avant)), 'la vue a tourné au doigt').toBeGreaterThan(5);
    await expect(garage(page)).toHaveAttribute('data-cadrage', 'phares-arriere');

    // Paysage : cadré entre les boutons ronds et le menu.
    await page.setViewportSize({ width: 844, height: 390 });
    await dock(page).getByTestId('phares').getByRole('button', { name: 'Lumière', exact: true }).tap();
    await expect(garage(page)).toHaveAttribute('data-cadrage', 'phares-avant', { timeout: 30_000 });
    await cadreDansLibre(page);
    await calme(page);
    await photo(page, '03-cox-phares-avant-paysage');
    await page.setViewportSize({ width: 390, height: 844 });

    // Une moto : même règle, aucun cas particulier.
    await ecrire(page, 'pmb-builds', { current: 'bobber', builds: {}, recents: ['bobber'] });
    await reloadSaved(page);
    await waitForBench(page);
    await openEntry(page, 'Phares');
    await expect(garage(page)).toHaveAttribute('data-cadrage', 'phares-avant', { timeout: 30_000 });
    await cadreDansLibre(page);
    await calme(page);
    await photo(page, '04-bobber-phares-avant');
    await dock(page).getByTestId('phares').getByRole('button', { name: 'Feux', exact: true }).tap();
    await expect(garage(page)).toHaveAttribute('data-cadrage', 'phares-arriere', { timeout: 30_000 });
    await cadreDansLibre(page);
    await calme(page);
    await photo(page, '05-bobber-feux-arriere');

    // Le panneau fermé, la caméra revient à la vue d'atelier.
    await backToSections(page);
    await expect(garage(page)).not.toHaveAttribute('data-cadrage', /./, { timeout: 30_000 });
  });

  test('fil du dock : une entrée longue reste entière en très grand texte, en portrait et en paysage', async ({ page }) => {
    test.setTimeout(240_000);
    await openApp(page);
    await waitForScene(page);
    // Texte normal : l'étape tient sur sa ligne, avec son chemin. « Retour » et « Jouer » (là à toute profondeur
    // depuis la vague X) peuvent se réduire à leur pictogramme ; le dernier cran, deux lignes, n'est pas utile.
    await openEntry(page, 'Échappement');
    await filEntier(page, 'Échappement', 'texte normal');
    await expect(dock(page).locator('.dock-head')).not.toHaveAttribute('data-fil', 'deux-lignes');

    await tailleTexte(page, 'Très grand');
    await openEntry(page, 'Échappement');
    await filEntier(page, 'Échappement', 'très grand, portrait');
    await photo(page, '06-fil-tres-grand-portrait');
    await openEntry(page, 'Préparation');
    await filEntier(page, 'Préparation', 'très grand, portrait');
    await page.setViewportSize({ width: 844, height: 390 });
    await openEntry(page, 'Échappement');
    await filEntier(page, 'Échappement', 'très grand, paysage');
    await photo(page, '07-fil-tres-grand-paysage');
  });

  test('option payante posée sans être acquise : elle reste en place, le panneau le dit, l’achat la rend à toi', async ({ page }) => {
    test.setTimeout(300_000);
    await openApp(page);
    await waitForScene(page);
    // Jeu remis à zéro après des achats : rien d'acquis, mais le build garde ce qui était posé.
    await poser(page, 'cox', { parts: { phares: 'violet', feux: 'fumes', echappement: 'libre', aileron: 'haut' } }, { solde: 500, articles: {}, hautsFaits: { 'premier-achat': true }, cumuls: { courses: 1, achats: 1 } });
    await expect(garage(page)).toHaveAttribute('data-phares', 'violet');

    await openEntry(page, 'Phares');
    const phares = dock(page).getByTestId('phares');
    const violet = phares.locator('[data-phares="violet"]');
    await expect(violet).toHaveAttribute('aria-pressed', 'true');
    await expect(violet).toHaveAttribute('data-verrou', 'ferme');
    await expect(violet).toHaveAccessibleName(/^Violet, en place sans achat, à débloquer pour 160/);
    await expect(phares.locator('[data-non-acquis]')).toContainText('« Violet » reste en place sans achat');
    await photo(page, '08-phares-violet-sans-achat');
    // Un appui ouvre l'achat ; acheté, la ligne disparaît.
    await violet.tap();
    await phares.getByRole('group', { name: 'Acheter Phares violets' }).getByRole('button', { name: 'Acheter', exact: true }).tap();
    await expect(phares.locator('[data-non-acquis]')).toHaveCount(0);
    await expect(garage(page)).toHaveAttribute('data-phares', 'violet');
    // Feux : même règle.
    await phares.getByRole('button', { name: 'Feux', exact: true }).tap();
    await expect(phares.locator('[data-non-acquis]')).toContainText('« Fumés »');

    await openEntry(page, 'Échappement');
    const ech = dock(page).locator('.dock-tab[data-onglet="echappement"]');
    await expect(ech.locator('button[data-ligne="libre"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(ech.locator('[data-non-acquis]')).toContainText('« Libre »');

    await openEntry(page, 'Ailerons');
    const ail = dock(page).getByTestId('pieces');
    await expect(ail).toHaveAttribute('data-option', 'haut');
    await expect(ail.locator('[data-non-acquis]')).toHaveCount(1);
    // Changer d'option la fait tomber : l'origine est libre, rien n'est retiré d'office avant.
    await ail.locator('button[data-option="aucun"]').tap();
    await expect(ail).toHaveAttribute('data-option', 'aucun');
    await expect(ail.locator('[data-non-acquis]')).toHaveCount(0);
  });

  test('ombre de contact : refaite quand une pièce montée change, avec la pièce posée', async ({ page }) => {
    test.setTimeout(300_000);
    await openApp(page);
    await waitForScene(page);
    await poser(page, 'cox', {}, { solde: 0, articles: { 'piece-aileron-haut': true }, hautsFaits: { 'premier-achat': true }, cumuls: { courses: 1, achats: 1 } });
    type Trace = { rendus: number; pieces: string } | undefined;
    const trace = () => page.evaluate(() => (window as unknown as { __pmbOmbreContact?: { rendus: number; pieces: string } }).__pmbOmbreContact as Trace);
    await expect.poll(async () => (await trace())?.rendus ?? 0, { timeout: 60_000 }).toBeGreaterThan(0);
    const avant = (await trace())?.rendus ?? 0;
    await openEntry(page, 'Ailerons');
    await dock(page).getByTestId('pieces').locator('button[data-option="haut"]').tap();
    await expect.poll(async () => (await trace())?.pieces ?? '', { message: 'ombre refaite avec l’aileron posé', timeout: 90_000 }).toContain('aileron:haut');
    expect((await trace())?.rendus ?? 0).toBeGreaterThan(avant);
    const pose = (await trace())?.rendus ?? 0;
    await dock(page).getByTestId('pieces').locator('button[data-option="aucun"]').tap();
    await expect.poll(async () => (await trace())?.pieces ?? 'x', { message: 'ombre refaite sans aileron', timeout: 90_000 }).not.toContain('aileron:');
    expect((await trace())?.rendus ?? 0).toBeGreaterThan(pose);
  });

  test('échappement libre : au garage, un coup de gaz tenu puis lâché fait cracher les sorties', async ({ page }) => {
    test.setTimeout(300_000);
    await openApp(page);
    await waitForScene(page);
    await poser(page, 'cox', { parts: { echappement: 'libre' } }, { solde: 0, articles: { 'piece-echappement-libre': true }, hautsFaits: { 'premier-achat': true }, cumuls: { courses: 1, achats: 1 } });
    await openEntry(page, 'Échappement');
    const ech = dock(page).locator('.dock-tab[data-onglet="echappement"]');
    await expect(ech.locator('[data-non-acquis]')).toHaveCount(0);
    const moteur = ech.locator('.engine-sound');
    await ech.getByRole('button', { name: 'Démarrer' }).tap();
    await expect(moteur).toHaveAttribute('data-moteur', 'ralenti', { timeout: 30_000 });
    // L'arrière, ses sorties, cadrés au-dessus du menu.
    await expect(garage(page)).toHaveAttribute('data-cadrage', 'echappement-arriere', { timeout: 30_000 });
    await calme(page);
    const gaz = await ech.getByRole('button', { name: 'Coup de gaz' }).boundingBox();
    if (!gaz) throw new Error('coup de gaz introuvable');
    // Un coup de gaz trop bref : rien.
    await page.mouse.move(gaz.x + gaz.width / 2, gaz.y + gaz.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(1_500);
    await expect(garage(page)).not.toHaveAttribute('data-flammes-garage', /./);
    // Tenu, puis lâché : un jet (l'image où il brûle est retenue le temps de la capture).
    await page.mouse.down();
    await page.waitForTimeout(1_200);
    const fige = page.evaluate(
      () =>
        new Promise<void>((done, fail) => {
          const scene = document.querySelector('.stage');
          if (!scene) throw new Error('scène introuvable');
          const delai = window.setTimeout(() => fail(new Error('aucun jet au garage en 60 s')), 60_000);
          const fenetre = window as unknown as { __pmbReprendre?: () => void };
          const observe = new MutationObserver(() => {
            if (scene.getAttribute('data-flamme-garage') !== 'oui') return;
            observe.disconnect();
            window.clearTimeout(delai);
            const raf = window.requestAnimationFrame;
            const retenus: FrameRequestCallback[] = [];
            window.requestAnimationFrame = (rappel) => {
              retenus.push(rappel);
              return 0;
            };
            fenetre.__pmbReprendre = () => {
              window.requestAnimationFrame = raf;
              for (const rappel of retenus.splice(0)) raf(rappel);
            };
            window.setTimeout(done, 300);
          });
          observe.observe(scene, { attributes: true, attributeFilter: ['data-flamme-garage'] });
        }),
    );
    await page.mouse.up();
    await fige;
    await photo(page, '09-flammes-garage-cox');
    await page.evaluate(() => (window as unknown as { __pmbReprendre?: () => void }).__pmbReprendre?.());
    await expect(garage(page)).toHaveAttribute('data-flammes-garage', '1');
    await expect(garage(page)).toHaveAttribute('data-flamme-garage', 'non', { timeout: 30_000 });
    await ech.getByRole('button', { name: 'Couper' }).tap();
  });
});

// ———————————————————————————————————————————————————————————————————————————————
// Vues de revue (à la demande) : planche de bord, pluie sous un éclairage coloré, flammes de nuit et de jour.

test.describe('vues de revue des finitions', () => {
  test.skip(!CAPTURES, 'captures de revue : PMB_CAPTURES_FINITIONS=<dossier>');

  test('planche de bord de la Cox, feux fumés : ses accents rouges gardent leur lueur', async ({ page }) => {
    test.setTimeout(240_000);
    await openApp(page);
    await waitForScene(page);
    await poser(page, 'cox', { parts: { feux: 'fumes' } });
    await expect(garage(page)).toHaveAttribute('data-feux', 'fumes');
    await openEntry(page, 'Intérieur');
    await expect(garage(page)).toHaveAttribute('data-vue', 'interieur', { timeout: 15_000 });
    await calme(page);
    await photo(page, '10-cox-planche-feux-fumes');
  });

  test('pluie de nuit sous un éclairage violet, vue de la poursuite', async ({ page }) => {
    test.setTimeout(540_000);
    await openApp(page);
    await waitForScene(page);
    await poser(page, 'cox', { parts: { phares: 'violet' } });
    await openEntry(page, ENTREE_SORTIE);
    await pickMap(page);
    await dock(page).getByRole('button', { name: 'Jouer', exact: true }).tap();
    await expect(sortie(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
    await expect(sortie(page)).toHaveAttribute('data-meteo', 'pluie');
    await expect(sortie(page)).toHaveAttribute('data-phares', 'violet');
    await attendreRoute(page);
    await choisirCamera(page, 'Poursuite');
    await page.waitForTimeout(4_000);
    await photo(page, '11-pluie-violette-poursuite');
    await choisirCamera(page, 'Avant');
    await page.waitForTimeout(4_000);
    await photo(page, '12-pluie-violette-avant');
    await rentrerAuGarage(page);
  });

  for (const moment of ['nuit', 'jour'] as const) {
    test(`flammes de ${moment} vues de la poursuite (Cox, ligne libre)`, async ({ page }) => {
      test.setTimeout(540_000);
      await openApp(page);
      await waitForScene(page);
      await poser(page, 'cox', { parts: { echappement: 'libre' } });
      await openEntry(page, ENTREE_SORTIE);
      await pickMap(page);
      await auSec(page);
      if (moment === 'jour') await dock(page).getByRole('group', { name: 'Moment' }).getByRole('button', { name: 'Jour', exact: true }).tap();
      await dock(page).getByRole('button', { name: 'Jouer', exact: true }).tap();
      await expect(sortie(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
      await expect(sortie(page)).toHaveAttribute('data-moment', moment);
      await choisirCamera(page, 'Poursuite');
      await commencerCourse(page, { parti: true });
      await reglerSortie(page, 'Commande', 'Pédales');
      const gaz = await page.locator('.drive-pedal[data-pedale="gaz"]').boundingBox();
      if (!gaz) throw new Error('pédale de gaz introuvable');
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: gaz.x + gaz.width / 2, y: gaz.y + gaz.height / 2, id: 1 }] });
      await attendreSurLaRoute(page, 'plein gaz', async () => Number(await page.locator('.drive-dial').getAttribute('data-regime')), (tours) => tours >= 3400, { secondes: 40, horloge: 240_000 });
      const fige = page.evaluate(
        (selector) =>
          new Promise<void>((done, fail) => {
            const scene = document.querySelector(selector);
            if (!scene) throw new Error('scène introuvable');
            const delai = window.setTimeout(() => fail(new Error('aucun jet en 90 s')), 90_000);
            const fenetre = window as unknown as { __pmbReprendre?: () => void };
            const observe = new MutationObserver(() => {
              if (scene.getAttribute('data-flamme') !== 'oui') return;
              observe.disconnect();
              window.clearTimeout(delai);
              const raf = window.requestAnimationFrame;
              const retenus: FrameRequestCallback[] = [];
              window.requestAnimationFrame = (rappel) => {
                retenus.push(rappel);
                return 0;
              };
              fenetre.__pmbReprendre = () => {
                window.requestAnimationFrame = raf;
                for (const rappel of retenus.splice(0)) raf(rappel);
              };
              window.setTimeout(done, 300);
            });
            observe.observe(scene, { attributes: true, attributeFilter: ['data-flamme'] });
          }),
        `.${DRIVE_STAGE_CLASS}`,
      );
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await fige;
      await photo(page, `${moment === 'nuit' ? '13' : '14'}-flammes-${moment}-poursuite`);
      await page.evaluate(() => (window as unknown as { __pmbReprendre?: () => void }).__pmbReprendre?.());
      await cdp.detach();
      await rentrerAuGarage(page);
    });
  }
});
