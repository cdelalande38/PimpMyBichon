// Custom · Carrosserie (vague U) : le kit carrosserie (lame avant, jupes, diffuseur) sur le système de
// pièces montées. L'entrée va en deux étapes (retour du 18 novembre 2026) : la liste des postes que le
// véhicule déclare, le véhicule entier à l'écran ; puis le poste choisi, seul, ses options à la place de
// la liste, la caméra du garage le cadre (data-cadrage de la scène), « Retour » rend la liste et la vue
// d'avant ; ce qui n'est pas acquis porte un cadenas
// et son prix, un appui ouvre le bloc d'achat (solde insuffisant, puis achat confirmé), la pièce se pose
// une fois payée, prend une couleur propre, et tout est gardé au rechargement. Une moto n'a pas de kit.
// Les captures de revue (garage, sortie de jour, vue rapprochée de chaque poste, sur les trois voitures)
// ne tournent qu'à la demande : PMB_CAPTURES_CARROSSERIE=<dossier>.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { attendreSurLaRoute, auSec, choisirCamera, ENTREE_SORTIE, openApp, openEntry, pickMap, quick, readBuilds, reloadSaved, tempsDeRoute, waitForBench, waitForScene, waitForStill } from './helpers.ts';

const CAPTURES = process.env.PMB_CAPTURES_CARROSSERIE;

async function photo(page: Page, nom: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
  if (!CAPTURES) return;
  mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURES, `${nom}.png`), ...(clip ? { clip } : {}) });
}

/** Écrit dans IndexedDB la sauvegarde du jeu et, au besoin, celle des builds, puis relance l'app qui les relit. */
async function poserSauvegarde(page: Page, saves: { jeu?: Record<string, unknown>; builds?: Record<string, unknown> }): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const transaction = open.result.transaction('kv', 'readwrite');
          const store = transaction.objectStore('kv');
          if (value.jeu) store.put(JSON.stringify({ state: value.jeu, version: 1 }), 'pmb-jeu');
          if (value.builds) store.put(JSON.stringify({ state: value.builds, version: 1 }), 'pmb-builds');
          transaction.oncomplete = () => done();
          transaction.onerror = () => fail(transaction.error);
        };
      }),
    saves,
  );
  await reloadSaved(page);
  await waitForScene(page);
}

const groupe = (page: Page) => page.locator('footer.dock [data-testid="pieces-groupe"]');
const panneau = (page: Page) => page.locator('footer.dock [data-testid="pieces"]');
const poste = (page: Page, id: string) => groupe(page).locator(`.pieces-poste[data-poste="${id}"]`);
const option = (page: Page, id: string) => panneau(page).locator(`[data-option="${id}"]`);
const scene = (page: Page) => page.locator('.stage');
const ici = (page: Page) => page.locator('footer.dock .dock-crumb-here');

/** Ouvre un poste de la liste : ses options remplacent la liste, le fil le nomme, la caméra le cadre. */
async function ouvrirPoste(page: Page, id: string, nom: string): Promise<void> {
  await poste(page, id).tap();
  await expect(groupe(page)).toHaveAttribute('data-etape', 'element');
  await expect(panneau(page)).toHaveAttribute('data-poste', id);
  await expect(groupe(page).locator('.pieces-poste')).toHaveCount(0);
  await expect(ici(page)).toHaveText(nom);
  await expect(scene(page)).toHaveAttribute('data-cadrage', `piece-${id}`);
}

/** « Retour » : la liste des postes, le dernier ouvert marqué, la vue d'avant. */
async function revenirALaListe(page: Page, id: string): Promise<void> {
  await page.locator('footer.dock').getByRole('button', { name: 'Retour', exact: true }).tap();
  await expect(groupe(page)).toHaveAttribute('data-etape', 'liste');
  await expect(poste(page, id)).toHaveAttribute('aria-pressed', 'true');
  await expect(panneau(page)).toHaveCount(0);
  await expect(scene(page)).not.toHaveAttribute('data-cadrage', /piece-/);
}

/** Toute commande de l'entrée offre 48 px au doigt. */
async function commandesA48(page: Page, auMoins = 6): Promise<void> {
  const largeur = page.viewportSize()?.width ?? 390;
  const commandes = page.locator('footer.dock .dock-tab').locator('button:visible, label:visible');
  const nombre = await commandes.count();
  expect(nombre).toBeGreaterThanOrEqual(auMoins);
  for (let i = 0; i < nombre; i += 1) {
    const commande = commandes.nth(i);
    const boite = await commande.boundingBox();
    if (!boite || boite.x + boite.width < 0 || boite.x > largeur) continue;
    const nom = ((await commande.getAttribute('aria-label')) ?? (await commande.innerText())).trim().replace(/\s+/g, ' ');
    expect(boite.height, `hauteur de « ${nom} »`).toBeGreaterThanOrEqual(47.5);
    expect(boite.width, `largeur de « ${nom} »`).toBeGreaterThanOrEqual(47.5);
  }
}

/** Taille du texte, par Atelier › Réglages › Texte. */
async function tailleDuTexte(page: Page, taille: 'Normal' | 'Grand' | 'Très grand'): Promise<void> {
  await quick(page).getByRole('button', { name: 'Atelier', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Réglages' });
  await dialog.getByRole('button', { name: 'Texte' }).click();
  await dialog.getByRole('button', { name: new RegExp(`^${taille}`) }).click();
  await dialog.getByRole('button', { name: 'Retour à l’atelier' }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Ce qui déborde du menu : une commande hors des rangées qui défilent (options, teintes, finitions) dont
 * un bord sort du menu, ou un élément qui fait défiler l'entrée en largeur (comme pour les ailerons).
 */
async function debords(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const menu = document.querySelector('footer.dock');
    const racine = document.querySelector('footer.dock [data-testid="pieces-groupe"]');
    if (!menu || !racine) return ['pas de panneau'];
    const box = menu.getBoundingClientRect();
    const out: string[] = [];
    for (const element of racine.querySelectorAll<HTMLElement>('button, label, p')) {
      if (element.closest('.chips, .pieces-swatches')) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.left < box.left - 1 || rect.right > box.right + 1) out.push(`${element.textContent?.trim().slice(0, 24)} (${Math.round(rect.left)}–${Math.round(rect.right)})`);
    }
    // Les rangées de puces débordent exprès jusqu'au bord de l'écran ; rien d'autre ne doit faire défiler l'entrée en largeur.
    const contenu = racine.closest('.dock-tab');
    if (contenu && contenu.scrollWidth > contenu.clientWidth + 1) {
      const bord = contenu.getBoundingClientRect().right;
      const fautifs = [...contenu.querySelectorAll<HTMLElement>('*')]
        .filter((element) => element.getBoundingClientRect().right > bord + 1 && !element.closest('.chips, .pieces-swatches'))
        .map((element) => `${element.tagName.toLowerCase()}.${[...element.classList].join('.')} → ${Math.round(element.getBoundingClientRect().right)}`);
      if (fautifs.length > 0) out.push(`le contenu défile en largeur (${contenu.scrollWidth} > ${contenu.clientWidth}) : ${fautifs.join(', ')}`);
    }
    return out;
  });
}

test.describe('Custom · Carrosserie', () => {
  test('postes cadrés, option verrouillée, solde insuffisant, achat, pose, couleur propre, gardé au rechargement ; pas de kit sur une moto', async ({ page }) => {
    test.setTimeout(360_000);
    await openApp(page);
    await waitForScene(page);
    // « Premier achat » déjà obtenu : l'achat ne fait gagner aucun haut fait, le solde se lit simplement.
    await poserSauvegarde(page, {
      jeu: { solde: 300, articles: {}, hautsFaits: { 'premier-achat': true }, cumuls: {} },
      builds: { current: 'cox', builds: {}, recents: [] },
    });
    await expect(scene(page)).toHaveAttribute('data-vehicle', 'cox');
    await waitForBench(page);

    // Étape « Élément » : les trois postes du kit de la Cox, puis son capot moteur (tests/e2e/capot.spec.ts), et rien d'autre ; le véhicule entier, rien de cadré.
    await openEntry(page, 'Carrosserie');
    await expect(groupe(page)).toHaveAttribute('data-etape', 'liste');
    await expect(groupe(page).locator('.pieces-poste')).toHaveText([/^Lame avant\s*Sans lame$/, /^Jupes\s*Sans jupes$/, /^Diffuseur\s*Sans diffuseur$/, /^Capot moteur\s*D’origine$/]);
    await expect(groupe(page).locator('.pieces-poste[aria-pressed="true"]')).toHaveCount(0);
    await expect(panneau(page)).toHaveCount(0);
    await expect(scene(page)).not.toHaveAttribute('data-cadrage', /piece-/);
    await commandesA48(page, 3);

    // La lame avant : ses options seules, cadrée par la caméra.
    await ouvrirPoste(page, 'lame', 'Lame avant');
    await expect(panneau(page)).toHaveAttribute('data-option', 'aucune');
    for (const id of ['discrete', 'sport', 'course']) await expect(option(page, id)).toHaveAttribute('data-verrou', 'ferme');
    await expect(option(page, 'course')).toHaveAccessibleName('Large de course, verrouillé : 280 dollars');
    await commandesA48(page, 5);

    // Retour à la liste, puis les jupes : cadrées de profil ; les larges coûtent 260 $.
    await revenirALaListe(page, 'lame');
    await ouvrirPoste(page, 'jupes', 'Jupes');
    await option(page, 'larges').tap();
    const confirmation = panneau(page).locator('.jeu-achat[data-etat="confirmation"]');
    await expect(confirmation).toContainText('Acheter les jupes larges pour 260 $ ? Il te restera 40 $.');
    await confirmation.getByRole('button', { name: 'Acheter', exact: true }).tap();
    await expect(panneau(page).getByRole('status')).toContainText('Payé : les jupes larges t’appartiennent, et c’est posé.');
    await expect(panneau(page)).toHaveAttribute('data-option', 'larges');
    await expect(page.getByRole('button', { name: /Ton solde : 40 dollars/ })).toBeVisible();

    // Les jupes sport : il manque 130 $.
    await option(page, 'sport').tap();
    const insuffisant = panneau(page).locator('.jeu-achat[data-etat="insuffisant"]');
    await expect(insuffisant).toContainText('Il te manque 130 $ pour les jupes sport');
    await insuffisant.getByRole('button', { name: 'Compris' }).tap();
    await expect(panneau(page)).toHaveAttribute('data-option', 'larges');

    // Couleur propre des jupes : orange, mate.
    const couleur = panneau(page).getByRole('group', { name: 'Couleur des jupes' });
    await expect(couleur.getByRole('button', { name: 'Comme la caisse' })).toHaveAttribute('aria-pressed', 'true');
    await couleur.getByRole('button', { name: 'Couleur propre' }).tap();
    await panneau(page).getByRole('group', { name: 'Couleur des jupes : teinte' }).getByRole('button', { name: 'Orange piste' }).tap();
    await panneau(page).getByRole('group', { name: 'Couleur des jupes : finition' }).getByRole('button', { name: 'Mat', exact: true }).tap();
    await expect.poll(async () => JSON.stringify((await readBuilds(page))?.builds.cox)).toContain('"jupes":"larges"');
    await expect
      .poll(async () => ((await readBuilds(page))?.builds.cox as { partPaints?: Record<string, unknown> } | undefined)?.partPaints?.jupes)
      .toEqual({ color: '#ff6a00', finish: 'mat' });

    // La liste dit ce qui est posé ; le diffuseur, cadré de l'arrière.
    await revenirALaListe(page, 'jupes');
    await expect(poste(page, 'jupes')).toContainText('Larges');
    await ouvrirPoste(page, 'diffuseur', 'Diffuseur');
    await expect(option(page, 'ailettes')).toHaveAttribute('data-verrou', 'ferme');

    // Rechargement : les jupes, leur couleur et l'achat sont gardés.
    await reloadSaved(page);
    await waitForScene(page);
    await waitForBench(page);
    await openEntry(page, 'Carrosserie');
    await expect(groupe(page)).toHaveAttribute('data-etape', 'liste');
    await expect(poste(page, 'jupes')).toContainText('Larges');
    await ouvrirPoste(page, 'jupes', 'Jupes');
    await expect(panneau(page)).toHaveAttribute('data-option', 'larges');
    await expect(panneau(page).getByRole('group', { name: 'Couleur des jupes' }).getByRole('button', { name: 'Couleur propre' })).toHaveAttribute('aria-pressed', 'true');
    await expect(option(page, 'larges')).not.toHaveAttribute('data-verrou', 'ferme');

    // En quittant l'entrée, la caméra revient à la vue d'avant.
    await openEntry(page, 'Peinture');
    await expect(scene(page)).not.toHaveAttribute('data-cadrage', /piece-/);

    // Une moto n'a pas de kit carrosserie : l'entrée le dit.
    await openEntry(page, 'Véhicule');
    await page.locator('footer.dock').getByRole('group', { name: 'Véhicule' }).locator('[data-vehicle="bobber"]').tap();
    await expect(scene(page)).toHaveAttribute('data-vehicle', 'bobber');
    await openEntry(page, 'Carrosserie');
    await expect(panneau(page)).toContainText('Le bobber n’a pas de kit carrosserie');
    await expect(panneau(page).getByRole('button')).toHaveCount(0);
  });
});

test.describe('Custom · Carrosserie, mise en page', () => {
  test('tient en 390 × 844, 360 × 780 et en paysage, en texte grand et très grand, aux deux étapes', async ({ page }) => {
    test.setTimeout(300_000);
    await openApp(page);
    await waitForScene(page);
    await poserSauvegarde(page, {
      jeu: { solde: 0, articles: { 'piece-jupes-larges': true }, hautsFaits: {}, cumuls: {} },
      builds: { current: 'van', builds: { van: { paints: {}, parts: { jupes: 'larges' }, partPaints: { jupes: { color: '#ff6a00' } } } }, recents: [] },
    });
    await waitForBench(page);
    for (const taille of ['Grand', 'Très grand'] as const) {
      await tailleDuTexte(page, taille);
      for (const ecran of [
        { width: 390, height: 844 },
        { width: 360, height: 780 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(ecran);
        await openEntry(page, 'Carrosserie');
        expect(await debords(page), `${taille}, ${ecran.width} × ${ecran.height}, liste`).toEqual([]);
        await commandesA48(page, 3);
        if (taille === 'Très grand') await photo(page, `3${ecran.width > ecran.height ? 1 : 0}-van-liste-tres-grand-${ecran.width}x${ecran.height}`);
        await ouvrirPoste(page, 'jupes', 'Jupes');
        await expect(panneau(page)).toHaveAttribute('data-option', 'larges');
        await expect(panneau(page).getByRole('group', { name: 'Couleur des jupes : teinte' })).toBeVisible();
        expect(await debords(page), `${taille}, ${ecran.width} × ${ecran.height}`).toEqual([]);
        await commandesA48(page);
        if (taille === 'Très grand') await photo(page, `3${ecran.width > ecran.height ? 1 : 0}-van-texte-tres-grand-${ecran.width}x${ecran.height}`);
      }
      await page.setViewportSize({ width: 390, height: 844 });
    }
  });
});

/** Le kit complet de chaque voiture pour les captures : options, couleur propre éventuelle. */
const KITS: ReadonlyArray<{ id: string; parts: Record<string, string>; partPaints?: Record<string, Record<string, string>> }> = [
  { id: 'cox', parts: { lame: 'sport', jupes: 'fines', diffuseur: 'simple' } },
  { id: 'van', parts: { lame: 'course', jupes: 'larges', diffuseur: 'ailettes' }, partPaints: { jupes: { color: '#111114', finish: 'mat' } } },
  { id: 'concept', parts: { lame: 'course', jupes: 'sport', diffuseur: 'ailettes' } },
];

function buildsAvec(id: string): Record<string, unknown> {
  const builds: Record<string, unknown> = {};
  for (const kit of KITS) builds[kit.id] = { paints: {}, parts: kit.parts, ...(kit.partPaints ? { partPaints: kit.partPaints } : {}) };
  return { current: id, builds, recents: [] };
}

/** Tourne la caméra du garage (glissé sur la scène) et attend l'image posée. */
async function tourner(page: Page, dx: number, dy: number): Promise<void> {
  const { width, height } = page.viewportSize() ?? { width: 390, height: 844 };
  const y = height * 0.3;
  await page.mouse.move(width * 0.5, y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) await page.mouse.move(width * 0.5 + (step * dx) / 12, y + (step * dy) / 12);
  await page.mouse.up();
  await waitForStill(page);
}

test.describe('Carrosserie : captures de revue', () => {
  test.skip(!CAPTURES, 'captures de revue : PMB_CAPTURES_CARROSSERIE=<dossier>');

  test('les deux étapes, en portrait et en paysage', async ({ page }) => {
    test.setTimeout(300_000);
    await openApp(page);
    await waitForScene(page);
    await poserSauvegarde(page, { jeu: { solde: 150, articles: { 'piece-jupes-larges': true }, hautsFaits: {}, cumuls: {} }, builds: buildsAvec('cox') });
    await waitForBench(page);
    const hauteurs: string[] = [];
    for (const ecran of [
      { width: 390, height: 844, nom: 'portrait' },
      { width: 844, height: 390, nom: 'paysage' },
    ]) {
      await page.setViewportSize(ecran);
      await openEntry(page, 'Carrosserie');
      await waitForStill(page);
      hauteurs.push(`${ecran.nom} liste ${Math.round((await page.locator('footer.dock').boundingBox())?.height ?? 0)}`);
      await photo(page, `etapes-${ecran.nom}-1-liste`);
      await ouvrirPoste(page, 'jupes', 'Jupes');
      await waitForStill(page);
      hauteurs.push(`${ecran.nom} poste ${Math.round((await page.locator('footer.dock').boundingBox())?.height ?? 0)}`);
      await photo(page, `etapes-${ecran.nom}-2-jupes`);
      await revenirALaListe(page, 'jupes');
    }
    console.log(`Hauteur du menu (px) : ${hauteurs.join(' ; ')}`);
  });

  test('au garage, le kit complet sur chacune des trois voitures, et chaque poste de près', async ({ page }) => {
    test.setTimeout(900_000);
    await openApp(page);
    await waitForScene(page);
    for (const [rang, kit] of KITS.entries()) {
      await poserSauvegarde(page, { builds: buildsAvec(kit.id) });
      await expect(scene(page)).toHaveAttribute('data-vehicle', kit.id);
      await waitForBench(page);
      await photo(page, `0${rang}-garage-${kit.id}`);
      // Chaque poste cadré par l'entrée, de près ; puis, tourné autour du cadre, trois quarts avant
      // (lame et jupe) et trois quarts arrière (diffuseur et jupe).
      await openEntry(page, 'Carrosserie');
      for (const id of ['lame', 'jupes', 'diffuseur']) {
        if (id !== 'lame') await page.locator('footer.dock').getByRole('button', { name: 'Retour', exact: true }).tap();
        await poste(page, id).tap();
        await expect(scene(page)).toHaveAttribute('data-cadrage', `piece-${id}`);
        await waitForStill(page);
        await photo(page, `2${rang}-${kit.id}-${id}`, { x: 0, y: 90, width: 390, height: 470 });
        if (id === 'lame') {
          await tourner(page, -110, -20);
          await photo(page, `1${rang}a-garage-${kit.id}-trois-quarts-avant`, { x: 0, y: 90, width: 390, height: 470 });
        }
        if (id === 'diffuseur') {
          await tourner(page, 110, -20);
          await photo(page, `1${rang}b-garage-${kit.id}-trois-quarts-arriere`, { x: 0, y: 90, width: 390, height: 470 });
        }
      }
      await openEntry(page, 'Peinture');
    }
  });

  for (const [rang, kit] of KITS.entries()) {
    test(`en sortie de jour, ${kit.id} et son kit, caméra de poursuite`, async ({ page }) => {
      test.setTimeout(480_000);
      await openApp(page);
      await waitForScene(page);
      await poserSauvegarde(page, { builds: buildsAvec(kit.id) });
      await waitForBench(page);
      await openEntry(page, ENTREE_SORTIE);
      await pickMap(page);
      await auSec(page);
      await page.locator('footer.dock').getByRole('group', { name: 'Moment' }).getByRole('button', { name: 'Jour', exact: true }).tap();
      await page.locator('footer.dock').getByRole('button', { name: 'Sortir', exact: true }).tap();
      await expect(page.locator('.drive-stage')).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
      await expect(page.locator('.drive-stage')).toHaveAttribute('data-moment', 'jour');
      await choisirCamera(page, 'Poursuite');
      const depart = await tempsDeRoute(page);
      await attendreSurLaRoute(page, 'quelques secondes de route', () => tempsDeRoute(page), (t) => t > depart + 4, { secondes: 30 });
      await photo(page, `4${rang}-sortie-jour-${kit.id}`);
    });
  }
});
