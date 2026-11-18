// Mécanique · Échappement (vague T) : la ligne (origine libre, les autres à débloquer avec des dollars, sur
// place, cadenas et prix), l'écoute au garage, la finition des sorties (sur les modèles dont les sorties
// sont des pièces à part), la sauvegarde ; en sortie, la ligne libre crache des flammes au lever de pied
// après un passage plein gaz (lu sur data-flammes de la scène), vu de la poursuite sur une voiture et
// une moto. Captures : PMB_CAPTURES (dossier), sinon captures/echappement/. Délais comptés en secondes
// de route (rendu logiciel : un dixième de seconde par image).

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import {
  attendreSurLaRoute,
  auSec,
  choisirCamera,
  commencerCourse,
  DELAI_ROUTE,
  openApp,
  openEntry,
  pickMap,
  readBuilds,
  reglerSortie,
  reloadSaved,
  rentrerAuGarage,
  waitForBench,
  waitForScene,
} from './helpers.ts';

const DIR = process.env.PMB_CAPTURES ?? resolve('captures', 'echappement');
const dock = (page: Page) => page.locator('footer.dock');
const panneau = (page: Page) => dock(page).locator('.dock-tab[data-onglet="echappement"]');
const lignes = (page: Page) => panneau(page).getByRole('group', { name: 'Ligne d’échappement' });
const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);

async function photo(page: Page, name: string): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  await page.screenshot({ path: resolve(DIR, `${name}.png`) });
}

/** Écrit une clé de la sauvegarde (IndexedDB, format des stores) puis relance l'app, qui la relit. */
async function poserCle(page: Page, cle: string, etat: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ([key, value]) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const transaction = open.result.transaction('kv', 'readwrite');
          transaction.objectStore('kv').put(JSON.stringify({ state: value, version: 1 }), key as string);
          transaction.oncomplete = () => done();
          transaction.onerror = () => fail(transaction.error);
        };
      }),
    [cle, etat] as const,
  );
  await reloadSaved(page);
  await waitForScene(page);
}

/** Toute commande visible du panneau offre 48 px au doigt. */
async function commandesA48(zone: Locator, quoi: string): Promise<void> {
  const boutons = zone.locator('button:visible');
  const nombre = await boutons.count();
  expect(nombre, quoi).toBeGreaterThan(0);
  for (let i = 0; i < nombre; i += 1) {
    const boite = await boutons.nth(i).boundingBox();
    const nom = (await boutons.nth(i).innerText()).trim().replace(/\s+/g, ' ');
    expect(boite, `${quoi} : « ${nom} » mesurable`).not.toBeNull();
    expect(boite?.height ?? 0, `${quoi} : « ${nom} » haut de 48 px`).toBeGreaterThanOrEqual(47.5);
    expect(boite?.width ?? 0, `${quoi} : « ${nom} » large de 48 px`).toBeGreaterThanOrEqual(47.5);
  }
}

async function choisirVehicule(page: Page, vehicle: string): Promise<void> {
  await openEntry(page, 'Véhicule');
  await dock(page).getByRole('group', { name: 'Véhicule' }).locator(`[data-vehicle="${vehicle}"]`).tap();
  await expect(page.locator('.stage')).toHaveAttribute('data-vehicle', vehicle);
  await waitForBench(page);
}

async function tailleTexte(page: Page, taille: string): Promise<void> {
  await openApp(page, '#/reglages');
  const dialog = page.getByRole('dialog', { name: 'Réglages' });
  await dialog.getByRole('button', { name: 'Texte' }).click();
  await dialog.getByRole('button', { name: new RegExp(`^${taille}`) }).click();
  await dialog.getByRole('button', { name: 'Retour à l’atelier' }).click();
  await expect(dialog).toBeHidden();
}

test.describe('Mécanique · Échappement', () => {
  test('ligne verrouillée, achat sur place, sauvegarde ; finition des sorties ; 48 px, grand texte, paysage', async ({ page }) => {
    test.setTimeout(480_000);
    await openApp(page);
    await waitForScene(page);

    // Le véhicule de départ (le concept) : ses sorties ne sont pas des pièces à part, il le dit.
    await openEntry(page, 'Échappement');
    await expect(lignes(page).getByRole('button')).toHaveCount(4);
    await expect(lignes(page).getByRole('button', { name: /^Origine/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(panneau(page).locator('[data-finition="sans-sorties"]')).toBeVisible();
    await expect(panneau(page).getByRole('region', { name: 'Son du moteur' })).toBeVisible();

    // Solde nul : la ligne libre se voit avec son cadenas et son prix ; l'appui explique ce qui manque.
    const libre = lignes(page).getByRole('button', { name: 'Libre, verrouillée, 260 dollars' });
    await expect(libre).toHaveAttribute('data-verrou', 'ferme');
    await expect(libre.locator('svg[data-cadenas="ferme"]')).toBeVisible();
    await expect(libre).toContainText('260');
    await libre.tap();
    const manque = panneau(page).locator('.jeu-achat[data-etat="insuffisant"]');
    await expect(manque).toContainText('Il te manque');
    await expect(manque).toContainText('la ligne libre');
    await commandesA48(panneau(page), 'panneau, concept');
    await photo(page, '01-panneau-verrou');
    await manque.getByRole('button', { name: 'Compris' }).tap();
    await expect(manque).toHaveCount(0);

    // 300 $ : l'achat sur place monte la ligne ; le solde baisse ; la sauvegarde la garde.
    await poserCle(page, 'pmb-jeu', { solde: 300, articles: {}, hautsFaits: { 'premiere-course': true }, cumuls: { courses: 4, distance: 9300 } });
    await openEntry(page, 'Échappement');
    await lignes(page).getByRole('button', { name: /^Libre/ }).tap();
    const achat = panneau(page).getByRole('group', { name: 'Acheter Ligne libre' });
    await expect(achat).toContainText('260');
    await achat.getByRole('button', { name: 'Acheter', exact: true }).tap();
    await expect(panneau(page).locator('.ech-message[role="status"]')).toContainText('Ligne libre débloquée : elle est montée.');
    await expect(lignes(page).getByRole('button', { name: /^Libre/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(lignes(page).getByRole('button', { name: /^Libre/ })).not.toHaveAttribute('data-verrou', 'ferme');
    // 300 − 260, plus 25 $ du haut fait « Premier achat ».
    await expect(page.getByRole('button', { name: /Ton solde : 65 dollars/ })).toBeVisible();
    await expect(panneau(page).locator('[data-flammes="sans-sortie"]')).toBeVisible();
    await expect.poll(async () => ((await readBuilds(page))?.builds.concept as { parts?: Record<string, string> } | undefined)?.parts?.echappement).toBe('libre');
    // La sport reste verrouillée ; l'origine se remet d'un appui, gratuitement.
    await expect(lignes(page).getByRole('button', { name: 'Sport, verrouillée, 140 dollars' })).toBeVisible();
    await reloadSaved(page);
    await waitForScene(page);
    await openEntry(page, 'Échappement');
    await expect(lignes(page).getByRole('button', { name: /^Libre/ })).toHaveAttribute('aria-pressed', 'true');
    await photo(page, '02-libre-achetee');

    // Le bobber : ses sorties sont des pièces à part, la finition se choisit (le noir coûte 70 $, il en reste 65).
    await choisirVehicule(page, 'bobber');
    await openEntry(page, 'Échappement');
    await expect(lignes(page).getByRole('button', { name: /^Origine/ })).toHaveAttribute('aria-pressed', 'true');
    const finitions = panneau(page).getByRole('group', { name: 'Finition des sorties' });
    await expect(finitions.getByRole('button', { name: /^Chrome/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(finitions.getByRole('button', { name: 'Noir, verrouillée, 70 dollars' })).toBeVisible();
    await expect(finitions.getByRole('button', { name: 'Bleui, verrouillée, 110 dollars' })).toBeVisible();
    // La libre achetée vaut pour tous les véhicules.
    await lignes(page).getByRole('button', { name: /^Libre/ }).tap();
    await expect(lignes(page).getByRole('button', { name: /^Libre/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(panneau(page).locator('[data-flammes="oui"]')).toBeVisible();
    await commandesA48(panneau(page), 'panneau, bobber');
    await photo(page, '03-bobber-finitions');

    // Sorties noires achetées avec un solde reposé : la finition se pose.
    await poserCle(page, 'pmb-jeu', { solde: 200, articles: { 'piece-echappement-libre': true }, hautsFaits: { 'premiere-course': true }, cumuls: { courses: 4, distance: 9300 } });
    await waitForBench(page);
    await openEntry(page, 'Échappement');
    await panneau(page).getByRole('group', { name: 'Finition des sorties' }).getByRole('button', { name: /^Noir/ }).tap();
    await panneau(page).getByRole('group', { name: 'Acheter Sorties noires' }).getByRole('button', { name: 'Acheter', exact: true }).tap();
    await expect(panneau(page).getByRole('group', { name: 'Finition des sorties' }).getByRole('button', { name: /^Noir/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(panneau(page).locator('.echappement')).toHaveAttribute('data-finition', 'noir');
    // Le bobber montre son flanc droit, ses sorties : menu fermé, elles se voient noires.
    await dock(page).getByRole('button', { name: 'Fermer le menu' }).tap();
    await waitForBench(page);
    await photo(page, '04-bobber-sorties-noires');
    await dock(page).getByRole('button', { name: 'Personnaliser' }).tap();

    // Texte très grand, puis paysage : toujours 48 px au doigt.
    await tailleTexte(page, 'Très grand');
    await openEntry(page, 'Échappement');
    await commandesA48(panneau(page), 'texte très grand');
    await photo(page, '05-texte-tres-grand');
    await page.setViewportSize({ width: 844, height: 390 });
    await openEntry(page, 'Échappement');
    await commandesA48(panneau(page), 'paysage');
    await photo(page, '06-paysage');
  });
});

/**
 * Retient les images de la page dès que la scène dit qu'un jet brûle (data-flamme « oui ») : les appels
 * suivants à requestAnimationFrame sont mis de côté jusqu'à `__pmbReprendre()`. Pour la capture seulement.
 */
function figerAuJet(page: Page): Promise<void> {
  return page.evaluate(
    (selector) =>
      new Promise<void>((done, fail) => {
        const scene = document.querySelector(selector);
        const delai = window.setTimeout(() => fail(new Error('aucun jet de flammes en 90 s')), 90_000);
        if (!scene) throw new Error('scène introuvable');
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
          // L'image en cours se termine et se peint.
          window.setTimeout(done, 300);
        });
        observe.observe(scene, { attributes: true, attributeFilter: ['data-flamme'] });
      }),
    `.${DRIVE_STAGE_CLASS}`,
  );
}

/**
 * Sortie au sec avec la ligne libre : course à la main, pédales, plein gaz jusqu'à `regime` tr/min puis pied
 * levé : un jet de flammes (data-flammes), vu de la poursuite. Rend après la capture.
 */
async function flammesEnSortie(page: Page, vehicle: string, regime: number, capture: string): Promise<void> {
  await openApp(page);
  await waitForScene(page);
  await poserCle(page, 'pmb-builds', { current: vehicle, builds: { [vehicle]: { paints: {}, parts: { echappement: 'libre' } } }, recents: [vehicle] });
  await waitForBench(page);
  await openEntry(page, 'Sortie de nuit');
  await pickMap(page);
  await auSec(page);
  await dock(page).getByRole('button', { name: 'Sortir', exact: true }).tap();
  await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
  await expect(stage(page)).toHaveAttribute('data-echappement', 'libre');
  await expect(stage(page)).toHaveAttribute('data-sorties', '2');
  await expect(stage(page)).toHaveAttribute('data-flamme', 'non');
  await choisirCamera(page, 'Poursuite');
  await commencerCourse(page, { parti: true });
  await reglerSortie(page, 'Commande', 'Pédales');
  const tirsAvant = Number(await stage(page).getAttribute('data-flammes'));
  const gaz = await page.locator('.drive-pedal[data-pedale="gaz"]').boundingBox();
  if (!gaz) throw new Error('pédale de gaz introuvable');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: gaz.x + gaz.width / 2, y: gaz.y + gaz.height / 2, id: 1 }] });
  await expect(page.locator('.drive-pedal[data-pedale="gaz"]')).toHaveAttribute('data-appui', 'true');
  // Plein gaz jusqu'à un haut régime (70 % du rupteur de sa boîte, src/data/boites.ts), lu au compte-tours.
  await attendreSurLaRoute(page, 'plein gaz', async () => Number(await page.locator('.drive-dial').getAttribute('data-regime')), (tours) => tours >= regime, { secondes: 40, horloge: 240_000 });
  // Pied levé : le jet part, la scène le compte. Pour la capture, l'image où il brûle est retenue (les
  // images suivantes attendent, le temps de la prise) : un jet dure moins d'une demi-seconde de route.
  const fige = figerAuJet(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await fige;
  await photo(page, capture);
  await page.evaluate(() => (window as unknown as { __pmbReprendre?: () => void }).__pmbReprendre?.());
  await attendreSurLaRoute(page, 'retour de flammes', async () => Number(await stage(page).getAttribute('data-flammes')), (tirs) => tirs > tirsAvant, { secondes: 5, horloge: 120_000 });
  await cdp.detach();
}

test.describe('Retour de flammes en sortie', () => {
  test('la Cox, ligne libre : plein gaz puis pied levé, les sorties crachent', async ({ page }) => {
    test.setTimeout(540_000);
    // Rupteur de la Cox : 4 900 tr/min.
    await flammesEnSortie(page, 'cox', 3400, '07-flammes-cox-poursuite');
    // Une ligne sans flammes : rien ne crache (la scène le dit à l'ouverture).
    await rentrerAuGarage(page);
    await expect(stage(page)).toHaveCount(0);
  });

  test('la sportive, ligne libre : le jet sort des deux embouts sous la selle', async ({ page }) => {
    test.setTimeout(540_000);
    // Rupteur de la sportive : 14 000 tr/min (première jusqu'à 110 km/h environ).
    await flammesEnSortie(page, 'sportive', 9800, '08-flammes-sportive-poursuite');
    await rentrerAuGarage(page);
    await expect(stage(page)).toHaveCount(0);
  });
});
