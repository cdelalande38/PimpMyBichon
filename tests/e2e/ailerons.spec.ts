// Custom · Ailerons (vague T) : le premier poste des pièces montées. L'entrée s'ouvre sur les options du
// catalogue que le véhicule permet ; ce qui n'est pas acquis porte un cadenas et son prix, un appui ouvre
// le bloc d'achat (solde insuffisant, puis achat confirmé), l'aileron se pose une fois payé, prend une
// couleur propre, et tout est gardé au rechargement. Une moto n'a pas le poste. Les captures de revue
// (garage et sortie, un aileron sur chacune des trois voitures) ne tournent qu'à la demande :
// PMB_CAPTURES_AILERONS=<dossier>.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { attendreSurLaRoute, auSec, choisirCamera, openApp, openEntry, pickMap, quick, readBuilds, reloadSaved, tempsDeRoute, waitForBench, waitForScene, waitForStill } from './helpers.ts';

const CAPTURES = process.env.PMB_CAPTURES_AILERONS;

async function photo(page: Page, nom: string): Promise<void> {
  if (!CAPTURES) return;
  mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURES, `${nom}.png`) });
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

function panneau(page: Page) {
  return page.locator('footer.dock [data-testid="pieces"]');
}

function option(page: Page, id: string) {
  return panneau(page).locator(`[data-option="${id}"]`);
}

/**
 * Tourne la caméra du garage vers l'arrière du véhicule (glissé sur la scène), puis attend l'image posée.
 * `monte` : de combien de pixels le doigt descend pendant le glissé (la caméra monte d'autant).
 */
async function vueArriere(page: Page, monte = -48): Promise<void> {
  const { width, height } = page.viewportSize() ?? { width: 390, height: 844 };
  const y = height * 0.3;
  await page.mouse.move(width * 0.85, y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) await page.mouse.move(width * 0.85 - step * 21, y + (step * monte) / 12);
  await page.mouse.up();
  // Un peu plus près : la molette rapproche la caméra du garage.
  await page.mouse.move(width * 0.5, height * 0.4);
  await page.mouse.wheel(0, -500);
  await waitForStill(page);
}

/** Toute commande du panneau offre 48 px au doigt. */
async function commandesA48(page: Page): Promise<void> {
  const largeur = page.viewportSize()?.width ?? 390;
  const commandes = panneau(page).locator('button:visible, label:visible');
  const nombre = await commandes.count();
  expect(nombre).toBeGreaterThan(5);
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
 * un bord sort du menu, ou un élément qui fait défiler le contenu de l'entrée en largeur (les rangées de
 * puces, elles, débordent exprès jusqu'au bord de l'écran, comme dans toutes les entrées).
 */
async function debords(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const menu = document.querySelector('footer.dock');
    const pieces = document.querySelector('footer.dock [data-testid="pieces"]');
    if (!menu || !pieces) return ['pas de panneau'];
    const box = menu.getBoundingClientRect();
    const out: string[] = [];
    for (const element of pieces.querySelectorAll<HTMLElement>('button, label, p')) {
      if (element.closest('.chips, .pieces-swatches')) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.left < box.left - 1 || rect.right > box.right + 1) out.push(`${element.textContent?.trim().slice(0, 24)} (${Math.round(rect.left)}–${Math.round(rect.right)})`);
    }
    const contenu = pieces.closest('.dock-tab');
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

test.describe('Custom · Ailerons', () => {
  test('option verrouillée, solde insuffisant, achat, pose, couleur propre, gardé au rechargement ; pas de poste sur une moto', async ({ page }) => {
    test.setTimeout(300_000);
    await openApp(page);
    await waitForScene(page);
    // « Premier achat » déjà obtenu et aucun cumul : l'achat ne fait gagner aucun haut fait, le solde se lit simplement.
    await poserSauvegarde(page, { jeu: { solde: 300, articles: {}, hautsFaits: { 'premier-achat': true }, cumuls: {} } });
    await waitForBench(page);

    // Le concept, véhicule de départ : l'entrée n'est plus « bientôt ».
    await openEntry(page, 'Ailerons');
    await expect(panneau(page)).toHaveAttribute('data-option', 'aucun');
    await expect(option(page, 'aucun')).toHaveAttribute('aria-pressed', 'true');
    // Le concept n'accepte pas la queue de canard ; les quatre autres options sont à acheter.
    await expect(option(page, 'queue_de_canard')).toHaveCount(0);
    for (const id of ['becquet', 'bas', 'haut', 'demesure']) await expect(option(page, id)).toHaveAttribute('data-verrou', 'ferme');
    await expect(option(page, 'haut')).toHaveAccessibleName('Aileron haut, verrouillé : 240 dollars');
    await expect(option(page, 'haut').locator('.pieces-prix .pieces-lock')).toBeVisible();
    await expect(option(page, 'haut')).toContainText('240 $');
    await commandesA48(page);
    await photo(page, '01-concept-verrouille');

    // L'aileron démesuré coûte 360 $ : il manque 60 $.
    await option(page, 'demesure').tap();
    const insuffisant = panneau(page).locator('.jeu-achat[data-etat="insuffisant"]');
    await expect(insuffisant).toContainText('Il te manque 60 $ pour l’aileron démesuré');
    await insuffisant.getByRole('button', { name: 'Compris' }).tap();
    await expect(insuffisant).toHaveCount(0);
    await expect(panneau(page)).toHaveAttribute('data-option', 'aucun');

    // L'aileron haut : confirmation, achat, posé tout de suite.
    await option(page, 'haut').tap();
    const confirmation = panneau(page).locator('.jeu-achat[data-etat="confirmation"]');
    await expect(confirmation).toContainText('Acheter l’aileron haut pour 240 $ ? Il te restera 60 $.');
    await photo(page, '02-concept-achat');
    await confirmation.getByRole('button', { name: 'Acheter', exact: true }).tap();
    await expect(panneau(page).getByRole('status')).toContainText('Payé : l’aileron haut t’appartient, et c’est posé.');
    await expect(panneau(page)).toHaveAttribute('data-option', 'haut');
    await expect(option(page, 'haut')).toHaveAttribute('aria-pressed', 'true');
    await expect(option(page, 'haut')).not.toHaveAttribute('data-verrou', 'ferme');
    await expect(page.getByRole('button', { name: /Ton solde : 60 dollars/ })).toBeVisible();

    // Couleur propre : orange, finition mate ; puis la caisse, puis de nouveau la couleur propre.
    const couleur = panneau(page).getByRole('group', { name: 'Couleur de l’aileron' });
    await expect(couleur.getByRole('button', { name: 'Comme la caisse' })).toHaveAttribute('aria-pressed', 'true');
    await couleur.getByRole('button', { name: 'Couleur propre' }).tap();
    await panneau(page).getByRole('group', { name: 'Couleur de l’aileron : teinte' }).getByRole('button', { name: 'Orange piste' }).tap();
    await panneau(page).getByRole('group', { name: 'Couleur de l’aileron : finition' }).getByRole('button', { name: 'Mat', exact: true }).tap();
    await commandesA48(page);
    await expect.poll(async () => JSON.stringify((await readBuilds(page))?.builds.concept)).toContain('"aileron":"haut"');
    await expect
      .poll(async () => ((await readBuilds(page))?.builds.concept as { partPaints?: Record<string, unknown> } | undefined)?.partPaints?.aileron)
      .toEqual({ color: '#ff6a00', finish: 'mat' });
    await waitForStill(page);
    await photo(page, '03-concept-pose');

    // Rechargement : l'aileron, sa couleur et l'achat sont gardés.
    await reloadSaved(page);
    await waitForScene(page);
    await waitForBench(page);
    await openEntry(page, 'Ailerons');
    await expect(panneau(page)).toHaveAttribute('data-option', 'haut');
    await expect(panneau(page).getByRole('group', { name: 'Couleur de l’aileron' }).getByRole('button', { name: 'Couleur propre' })).toHaveAttribute('aria-pressed', 'true');
    await expect(option(page, 'haut')).not.toHaveAttribute('data-verrou', 'ferme');
    await expect(option(page, 'demesure')).toHaveAttribute('data-verrou', 'ferme');

    // « D'origine » : plus d'aileron, l'achat reste.
    await panneau(page).getByRole('button', { name: 'D’origine' }).tap();
    await expect(panneau(page)).toHaveAttribute('data-option', 'aucun');
    await expect(option(page, 'haut')).not.toHaveAttribute('data-verrou', 'ferme');

    // Une moto n'a pas d'aileron : l'entrée le dit.
    await openEntry(page, 'Véhicule');
    await page.locator('footer.dock').getByRole('group', { name: 'Véhicule' }).locator('[data-vehicle="bobber"]').tap();
    await expect(page.locator('.stage')).toHaveAttribute('data-vehicle', 'bobber');
    await openEntry(page, 'Ailerons');
    await expect(panneau(page)).toContainText('Le bobber n’a pas de place pour un aileron');
    await expect(panneau(page).getByRole('button')).toHaveCount(0);
  });
});

test.describe('Custom · Ailerons, mise en page', () => {
  test('tient en 390 × 844 et en paysage, en texte grand et très grand', async ({ page }) => {
    test.setTimeout(300_000);
    await openApp(page);
    await waitForScene(page);
    await poserSauvegarde(page, {
      jeu: { solde: 0, articles: { 'piece-aileron-demesure': true }, hautsFaits: {}, cumuls: {} },
      builds: { current: 'cox', builds: { cox: { paints: {}, parts: { aileron: 'demesure' }, partPaints: { aileron: { color: '#ff6a00' } } } }, recents: [] },
    });
    await waitForBench(page);
    for (const taille of ['Grand', 'Très grand'] as const) {
      await tailleDuTexte(page, taille);
      for (const ecran of [
        { width: 390, height: 844 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(ecran);
        await openEntry(page, 'Ailerons');
        await expect(panneau(page)).toHaveAttribute('data-option', 'demesure');
        await expect(panneau(page).getByRole('group', { name: 'Couleur de l’aileron : teinte' })).toBeVisible();
        expect(await debords(page), `${taille}, ${ecran.width} × ${ecran.height}`).toEqual([]);
        await commandesA48(page);
        if (taille === 'Très grand') await photo(page, `3${ecran.width > ecran.height ? 1 : 0}-cox-texte-tres-grand-${ecran.width}x${ecran.height}`);
      }
      await page.setViewportSize({ width: 390, height: 844 });
    }
  });
});

/** Un aileron par voiture pour les captures : option, couleur propre éventuelle. */
const POSES: ReadonlyArray<{ id: string; option: string; paint?: Record<string, string> }> = [
  { id: 'concept', option: 'haut' },
  { id: 'cox', option: 'demesure', paint: { color: '#ff6a00', finish: 'brillant' } },
  { id: 'van', option: 'queue_de_canard' },
];

function buildsAvec(id: string): Record<string, unknown> {
  const builds: Record<string, unknown> = {};
  for (const pose of POSES) builds[pose.id] = { paints: {}, parts: { aileron: pose.option }, ...(pose.paint ? { partPaints: { aileron: pose.paint } } : {}) };
  return { current: id, builds, recents: [] };
}

test.describe('Ailerons : captures de revue', () => {
  test.skip(!CAPTURES, 'captures de revue : PMB_CAPTURES_AILERONS=<dossier>');

  test('au garage, un aileron sur chacune des trois voitures', async ({ page }) => {
    test.setTimeout(420_000);
    await openApp(page);
    await waitForScene(page);
    for (const [rang, pose] of POSES.entries()) {
      await poserSauvegarde(page, { builds: buildsAvec(pose.id) });
      await expect(page.locator('.stage')).toHaveAttribute('data-vehicle', pose.id);
      await waitForBench(page);
      await vueArriere(page);
      await photo(page, `1${rang}-garage-${pose.id}-${pose.option}`);
    }
  });

  test('chaque option sur chaque voiture, de trois quarts arrière', async ({ page }) => {
    test.setTimeout(900_000);
    await openApp(page);
    await waitForScene(page);
    const tout = Object.fromEntries(['becquet', 'queue_de_canard', 'bas', 'haut', 'demesure'].map((id) => [`piece-aileron-${id}`, true]));
    for (const id of ['cox', 'van', 'concept']) {
      await poserSauvegarde(page, { jeu: { solde: 0, articles: tout, hautsFaits: {}, cumuls: {} }, builds: { current: id, builds: {}, recents: [] } });
      await expect(page.locator('.stage')).toHaveAttribute('data-vehicle', id);
      await waitForBench(page);
      await openEntry(page, 'Ailerons');
      await vueArriere(page, id === 'van' ? 24 : 0);
      const ids = await panneau(page).locator('[data-option]').evaluateAll((items) => items.map((item) => item.getAttribute('data-option') ?? ''));
      for (const optionId of ids.filter((item) => item !== 'aucun')) {
        await option(page, optionId).tap();
        await expect(panneau(page)).toHaveAttribute('data-option', optionId);
        await waitForStill(page);
        await photo(page, `4-${id}-${optionId}`);
      }
    }
  });

  for (const [rang, pose] of POSES.entries()) {
    test(`en sortie, ${pose.id} et son aileron, caméra de poursuite`, async ({ page }) => {
      test.setTimeout(480_000);
      await openApp(page);
      await waitForScene(page);
      await poserSauvegarde(page, { builds: buildsAvec(pose.id) });
      await waitForBench(page);
      await openEntry(page, 'Sortie de nuit');
      await pickMap(page);
      await auSec(page);
      await page.locator('footer.dock').getByRole('button', { name: 'Sortir', exact: true }).tap();
      await expect(page.locator('.drive-stage')).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
      await choisirCamera(page, 'Poursuite');
      const depart = await tempsDeRoute(page);
      await attendreSurLaRoute(page, 'quelques secondes de route', () => tempsDeRoute(page), (t) => t > depart + 4, { secondes: 30 });
      await photo(page, `2${rang}-sortie-${pose.id}-${pose.option}`);
    });
  }
});
