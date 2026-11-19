// Custom › Néons (src/ui/neons/NeonsPanel.tsx, src/data/neons.ts) : la liste des zones puis les réglages
// d'une zone, l'achat sur place, la scène qui allume ses tubes et sa lueur au sol, au garage et en sortie
// de nuit ; les LED de l'habitacle (Intérieur) ; l'intérieur du concept. Captures de revue à la demande :
// PMB_CAPTURES_NEONS=<dossier>.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { attendreApercu, auSec, choisirCamera, ENTREE_SORTIE, openApp, openAtelier, openEntry, pickMap, quick, readBuilds, reglerSortie, reloadSaved, rentrerAuGarage, waitForBench, waitForScene, waitForStill } from './helpers.ts';

const CAPTURES = process.env.PMB_CAPTURES_NEONS;

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

/** Toutes les zones extérieures allumées, cyan devant et derrière, magenta sur les flancs (référence n° 2 du § 4). */
function neonsExterieurs(zones: readonly string[]): { parts: Record<string, string>; partPaints: Record<string, { color: string }> } {
  const couleur: Record<string, string> = { avant: '#18e4ff', flancs: '#ff2bd6', arriere: '#18e4ff', roues: '#a259ff', cadre: '#18e4ff', habitacle: '#a259ff' };
  return {
    parts: Object.fromEntries(zones.map((zone) => [`neon_${zone}`, 'fixe'])),
    partPaints: Object.fromEntries(zones.map((zone) => [`neon_${zone}`, { color: couleur[zone] ?? '#18e4ff' }])),
  };
}

function buildsAvec(vehicle: string, zones: readonly string[]): Record<string, unknown> {
  return { current: vehicle, builds: { [vehicle]: { paints: {}, ...neonsExterieurs(zones) } }, recents: [] };
}

/** Glisse le doigt sur la scène pour tourner la caméra (dx, dy en pixels), puis attend l'image posée. */
async function tourner(page: Page, dx: number, dy: number, zoom = 0): Promise<void> {
  const { width, height } = page.viewportSize() ?? { width: 390, height: 844 };
  const x = width * 0.5;
  const y = height * 0.3;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) await page.mouse.move(x + (step * dx) / 12, y + (step * dy) / 12);
  await page.mouse.up();
  if (zoom !== 0) {
    await page.mouse.move(width * 0.5, height * 0.4);
    await page.mouse.wheel(0, zoom);
  }
  await waitForStill(page);
}

const dock = (page: Page) => page.locator('footer.dock');
const garage = (page: Page) => page.locator('.stage');
/** « Premier achat » et « première course » déjà obtenus : leurs récompenses ne brouillent pas le solde. */
const JEU = (solde: number, articles: Record<string, true> = {}) => ({ solde, articles, hautsFaits: { 'premiere-course': true, 'premier-achat': true }, cumuls: { courses: 4, achats: 1 } });

/** Toute commande visible de l'élément offre 48 px au doigt. */
async function commandesA48(page: Page, testid: string): Promise<void> {
  const boutons = dock(page).locator(`[data-testid="${testid}"] button:visible, [data-testid="${testid}"] input:visible`);
  const nombre = await boutons.count();
  expect(nombre).toBeGreaterThan(0);
  for (let i = 0; i < nombre; i += 1) {
    const boite = await boutons.nth(i).boundingBox();
    expect(Math.min(boite?.width ?? 0, boite?.height ?? 0), `commande ${i}`).toBeGreaterThanOrEqual(47.5);
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
 * Ce qui déborde du menu (comme tests/e2e/ailerons.spec.ts) : une commande hors des rangées qui défilent
 * dont un bord sort du menu, ou un élément qui fait défiler le contenu de l'entrée en largeur.
 */
async function debords(page: Page, testid: string): Promise<string[]> {
  return page.evaluate((id) => {
    const menu = document.querySelector('footer.dock');
    const panneau = document.querySelector(`footer.dock [data-testid="${id}"]`);
    if (!menu || !panneau) return ['pas de panneau'];
    const box = menu.getBoundingClientRect();
    const out: string[] = [];
    for (const element of panneau.querySelectorAll<HTMLElement>('button, label, p')) {
      if (element.closest('.chips')) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.left < box.left - 1 || rect.right > box.right + 1) out.push(`${element.textContent?.trim().slice(0, 24)} (${Math.round(rect.left)}–${Math.round(rect.right)})`);
    }
    // Les rangées de puces débordent exprès jusqu'au bord de l'écran : seul ce qui est hors d'elles compte.
    const contenu = panneau.closest('.dock-tab');
    if (contenu && contenu.scrollWidth > contenu.clientWidth + 1) {
      const bord = contenu.getBoundingClientRect().right;
      const fautifs = [...contenu.querySelectorAll<HTMLElement>('*')]
        .filter((element) => element.getBoundingClientRect().right > bord + 1 && !element.closest('.chips'))
        .map((element) => `${element.tagName.toLowerCase()}.${[...element.classList].join('.')} → ${Math.round(element.getBoundingClientRect().right)}`);
      if (fautifs.length > 0) out.push(`le contenu défile en largeur (${contenu.scrollWidth} > ${contenu.clientWidth}) : ${fautifs.join(', ')}`);
    }
    return out;
  }, testid);
}

test.describe('néons', () => {
  test('au garage : l’avant libre, une zone achetée sur place, couleur, mode et intensité, gardés au rechargement', async ({ page }) => {
    test.setTimeout(420_000);
    await openApp(page);
    await waitForScene(page);
    await poserSauvegarde(page, { jeu: JEU(300), builds: { current: 'concept', builds: {}, recents: [] } });
    await waitForBench(page);
    await expect(garage(page)).toHaveAttribute('data-vehicle', 'concept');
    await expect(garage(page)).toHaveAttribute('data-neons', 'eteints');

    await openEntry(page, 'Néons');
    const liste = dock(page).getByTestId('neons');
    const zones = liste.getByRole('group', { name: 'Zones des néons' });
    await expect(zones.getByRole('button')).toHaveCount(5);
    await expect(zones.locator('[data-neon-zone="avant"]')).not.toHaveAttribute('data-verrou', 'ferme');
    await expect(zones.locator('[data-neon-zone="flancs"]')).toHaveAccessibleName('Flancs, à débloquer pour 180 $');
    await expect(liste.getByRole('button', { name: 'Tout éteindre' })).toBeDisabled();
    await commandesA48(page, 'neons');

    // L'avant : ses réglages remplacent la liste ; le fil dit la zone.
    await zones.locator('[data-neon-zone="avant"]').tap();
    const reglages = dock(page).getByTestId('neons-zone');
    await expect(reglages).toHaveAttribute('data-zone', 'avant');
    await expect(dock(page).locator('.dock-crumb')).toHaveText(['Custom', 'Néons', 'Avant']);
    await reglages.getByRole('button', { name: 'Allumé', exact: true }).tap();
    await expect(garage(page)).toHaveAttribute('data-neons', 'avant:fixe:#18e4ff:0.80');
    await expect(garage(page)).not.toHaveAttribute('data-neons-tubes', '0');
    await reglages.getByRole('button', { name: 'Magenta', exact: true }).tap();
    await reglages.getByRole('button', { name: 'Respiration', exact: true }).tap();
    await reglages.getByTestId('neons-intensite').fill('50');
    await expect(garage(page)).toHaveAttribute('data-neons', 'avant:respiration:#ff2bd6:0.50');
    await commandesA48(page, 'neons-zone');
    await photo(page, '20-reglages-avant');

    // Retour : la liste ; les flancs, verrouillés : l'achat sur place les allume.
    await dock(page).getByRole('button', { name: 'Retour', exact: true }).tap();
    await expect(zones.locator('[data-neon-zone="avant"]')).toHaveAttribute('data-allume', 'oui');
    await zones.locator('[data-neon-zone="flancs"]').tap();
    await reglages.getByRole('button', { name: /^Allumer · Flancs, à débloquer pour 180/ }).tap();
    const achat = reglages.getByRole('group', { name: 'Acheter Néons des flancs' });
    await expect(achat).toContainText('180 $');
    await achat.getByRole('button', { name: 'Acheter', exact: true }).tap();
    await expect(reglages.locator('.neons-message')).toContainText('C’est débloqué et allumé');
    await expect(garage(page)).toHaveAttribute('data-neons', /flancs:fixe:#ff2bd6:0\.80/);

    // Même couleur partout, puis rechargement : tout est gardé.
    await dock(page).getByRole('button', { name: 'Retour', exact: true }).tap();
    await liste.getByRole('button', { name: 'Tout en cyan' }).tap();
    await expect(garage(page)).toHaveAttribute('data-neons', 'avant:respiration:#18e4ff:0.50|flancs:fixe:#18e4ff:0.80');
    await reloadSaved(page);
    await waitForBench(page);
    await expect(garage(page)).toHaveAttribute('data-neons', 'avant:respiration:#18e4ff:0.50|flancs:fixe:#18e4ff:0.80');
    const builds = (await readBuilds(page)) as unknown as { builds: Record<string, { parts?: Record<string, string>; partPaints?: Record<string, { color: string }>; tune?: Record<string, number> }> };
    expect(builds.builds.concept?.parts).toMatchObject({ neon_avant: 'respiration', neon_flancs: 'fixe' });
    expect(builds.builds.concept?.tune).toEqual({ neon_avant: 0.5 });

    // Tout éteindre : plus rien d'écrit.
    await openEntry(page, 'Néons');
    await dock(page).getByTestId('neons').getByRole('button', { name: 'Tout éteindre' }).tap();
    await expect(garage(page)).toHaveAttribute('data-neons', 'eteints');
    await expect.poll(async () => JSON.stringify((await readBuilds(page))?.builds.concept ?? {})).not.toMatch(/neon_/);
  });

  test('les LED de l’habitacle dans Intérieur ; l’intérieur du concept : teintes, ciel et LED', async ({ page }) => {
    test.setTimeout(420_000);
    await openApp(page);
    await waitForScene(page);
    await poserSauvegarde(page, { jeu: JEU(0, { 'piece-neon-habitacle': true }), builds: { current: 'concept', builds: {}, recents: [] } });
    await waitForBench(page);
    await openEntry(page, 'Intérieur');
    const panneau = dock(page).getByTestId('habitacle');
    const volets = panneau.getByRole('group', { name: 'Volets de l’intérieur' });
    await expect(volets.getByRole('button')).toHaveText([/Teintes/, /Ciel/, /LED/]);
    await expect(page.locator('.stage')).toHaveAttribute('data-vue', 'interieur', { timeout: 30_000 });
    // Teintes : chaque zone de l'habitacle mène à Peinture.
    const teintes = panneau.getByRole('group', { name: 'Teintes de l’habitacle' });
    await expect(teintes.getByRole('button')).toHaveText([/Sellerie/, /Planche et contre-portes/, /Sièges, second ton/, /Tapis/]);
    // LED : les réglages de la zone habitacle des néons, au même poste.
    await volets.getByRole('button', { name: /LED/ }).tap();
    const reglages = panneau.getByTestId('neons-zone');
    await expect(reglages).toHaveAttribute('data-zone', 'habitacle');
    await reglages.getByRole('button', { name: 'Allumé', exact: true }).tap();
    await reglages.getByRole('button', { name: 'Vert', exact: true }).tap();
    await expect(garage(page)).toHaveAttribute('data-neons', 'habitacle:fixe:#3dff7a:0.80');
    await commandesA48(page, 'habitacle');
    // Ciel : allumé, il s'ajoute au concept.
    await volets.getByRole('button', { name: /Ciel/ }).tap();
    await panneau.locator('[data-ciel="allume"]').tap();
    await expect(panneau.locator('[data-ciel="allume"]')).toHaveAttribute('aria-pressed', 'true');
    await photo(page, '30-concept-interieur');
    // Dans Néons, la même zone est allumée.
    await openEntry(page, 'Néons');
    await expect(dock(page).getByTestId('neons').locator('[data-neon-zone="habitacle"]')).toHaveAttribute('data-allume', 'oui');
  });

  test('tient en 390 × 844 et en paysage, en texte grand et très grand : la liste et les réglages d’une zone', async ({ page }) => {
    test.setTimeout(420_000);
    await openApp(page);
    await waitForScene(page);
    await poserSauvegarde(page, { jeu: JEU(0), builds: buildsAvec('concept', ['avant']) });
    await waitForBench(page);
    for (const taille of ['Grand', 'Très grand'] as const) {
      await tailleDuTexte(page, taille);
      for (const ecran of [
        { width: 390, height: 844 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(ecran);
        await openEntry(page, 'Néons');
        const liste = dock(page).getByTestId('neons');
        await expect(liste.locator('[data-neon-zone="avant"]')).toHaveAttribute('data-allume', 'oui');
        expect(await debords(page, 'neons'), `liste, ${taille}, ${ecran.width} × ${ecran.height}`).toEqual([]);
        await commandesA48(page, 'neons');
        if (taille === 'Très grand') await photo(page, `4${ecran.width > ecran.height ? 1 : 0}-liste-texte-tres-grand`);
        await liste.locator('[data-neon-zone="avant"]').tap();
        await expect(dock(page).getByTestId('neons-zone')).toBeVisible();
        expect(await debords(page, 'neons-zone'), `réglages, ${taille}, ${ecran.width} × ${ecran.height}`).toEqual([]);
        await commandesA48(page, 'neons-zone');
        if (taille === 'Très grand') await photo(page, `4${ecran.width > ecran.height ? 3 : 2}-reglages-texte-tres-grand`);
      }
      await page.setViewportSize({ width: 390, height: 844 });
    }
  });
});

test.describe('néons : captures de revue', () => {
  test.skip(!CAPTURES, 'captures de revue : PMB_CAPTURES_NEONS=<dossier>');

  test('au garage, les cinq véhicules néons allumés ; le concept en paysage', async ({ page }) => {
    test.setTimeout(600_000);
    await openApp(page);
    await waitForScene(page);
    const poses: Array<[string, string[]]> = [
      ['concept', ['avant', 'flancs', 'arriere', 'roues']],
      ['cox', ['avant', 'flancs', 'arriere', 'roues']],
      ['van', ['avant', 'flancs', 'arriere', 'roues']],
      ['sportive', ['cadre', 'roues']],
      ['bobber', ['cadre', 'roues']],
    ];
    for (const [rang, [id, zones]] of poses.entries()) {
      await poserSauvegarde(page, { builds: buildsAvec(id, zones) });
      await expect(garage(page)).toHaveAttribute('data-vehicle', id);
      await waitForBench(page);
      await expect(garage(page)).not.toHaveAttribute('data-neons', 'eteints');
      await page.waitForTimeout(1_200);
      await waitForStill(page);
      await photo(page, `0${rang}-${id}-garage`);
    }
    await poserSauvegarde(page, { builds: buildsAvec('concept', ['avant', 'flancs', 'arriere', 'roues']) });
    await waitForBench(page);
    await tourner(page, 0, -70, 250);
    await photo(page, '05-concept-garage-ras-du-sol');
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(1_500);
    await waitForStill(page);
    await photo(page, '06-concept-garage-paysage');
  });

  test('LED d’habitacle en vue intérieure : le concept personnalisé, le van', async ({ page }) => {
    test.setTimeout(420_000);
    await openApp(page);
    await waitForScene(page);
    const concept = buildsAvec('concept', ['habitacle']);
    const build = (concept.builds as Record<string, Record<string, unknown>>).concept as Record<string, unknown>;
    build.paints = { planche: { color: '#2a2f8f', finish: 'satine' }, sellerie: { color: '#d8d2c4' } };
    build.parts = { ...(build.parts as object), ciel: 'allume' };
    build.partPaints = { ...(build.partPaints as object), ciel: { color: '#b04dff' } };
    await poserSauvegarde(page, { jeu: JEU(0, { 'piece-neon-habitacle': true }), builds: concept });
    await waitForBench(page);
    await openEntry(page, 'Intérieur');
    const panneau = dock(page).getByTestId('habitacle');
    await panneau.getByRole('group', { name: 'Volets de l’intérieur' }).getByRole('button', { name: /LED/ }).tap();
    await expect(garage(page)).toHaveAttribute('data-vue', 'interieur', { timeout: 30_000 });
    await page.waitForTimeout(2_500);
    await waitForStill(page);
    await photo(page, '30-concept-interieur-led');
    await panneau.getByRole('group', { name: 'Volets de l’intérieur' }).getByRole('button', { name: /Ciel/ }).tap();
    await page.waitForTimeout(2_500);
    // Les yeux levés vers le pavillon, au doigt.
    await tourner(page, 0, 160);
    await photo(page, '31-concept-interieur-ciel');
    await poserSauvegarde(page, { jeu: JEU(0, { 'piece-neon-habitacle': true }), builds: buildsAvec('van', ['habitacle']) });
    await waitForBench(page);
    await openEntry(page, 'Intérieur');
    await dock(page).getByTestId('habitacle').getByRole('group', { name: 'Volets de l’intérieur' }).getByRole('button', { name: /LED/ }).tap();
    await expect(garage(page)).toHaveAttribute('data-vue', 'interieur', { timeout: 30_000 });
    await page.waitForTimeout(2_500);
    await waitForStill(page);
    await photo(page, '32-van-interieur-led');
  });

  test('en sortie de nuit, le concept au sec puis sous la pluie', async ({ page }) => {
    test.setTimeout(600_000);
    await openApp(page);
    await waitForScene(page);
    await poserSauvegarde(page, { builds: buildsAvec('concept', ['avant', 'flancs', 'arriere', 'roues', 'habitacle']) });
    await waitForBench(page);
    await sortieDeNuit(page, 'concept');
  });

  test('en sortie de nuit, la Cox au sec puis sous la pluie', async ({ page }) => {
    test.setTimeout(600_000);
    await openApp(page);
    await waitForScene(page);
    await poserSauvegarde(page, { builds: buildsAvec('cox', ['avant', 'flancs', 'arriere', 'roues', 'habitacle']) });
    await waitForBench(page);
    await sortieDeNuit(page, 'cox');
  });

  test('mesures : coût au garage et en sortie de nuit, néons éteints puis allumés', async ({ page }) => {
    test.setTimeout(900_000);
    await page.addInitScript(COMPTEURS);
    await openApp(page);
    await waitForScene(page);
    const lignes: string[] = [];
    for (const [nom, zones] of [
      ['eteints', [] as string[]],
      ['allumes', ['avant', 'flancs', 'arriere', 'roues', 'habitacle']],
    ] as const) {
      await poserSauvegarde(page, { jeu: JEU(0), builds: buildsAvec('concept', zones) });
      await waitForBench(page);
      lignes.push(`garage ${nom} : ${await coutGarage(page)}`);
      await openEntry(page, ENTREE_SORTIE);
      await pickMap(page);
      await auSec(page);
      await dock(page).getByRole('button', { name: 'Sortir', exact: true }).tap();
      await expect(page.locator('.drive-stage')).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
      await attendreApercu(page);
      await choisirCamera(page, 'Poursuite');
      await page.waitForTimeout(3_000);
      const sec = await appelsParImage(page, 15_000);
      await reglerSortie(page, 'Météo', 'Pluie');
      await page.waitForTimeout(4_000);
      const pluie = await appelsParImage(page, 15_000);
      await photo(page, `15-concept-mesure-pluie-${nom}`);
      lignes.push(`sortie ${nom} : sec ${sec.parImage.toFixed(1)} appels par image (${sec.images} images en 15 s), pluie ${pluie.parImage.toFixed(1)} appels par image (${pluie.images} images en 15 s)`);
      await rentrerAuGarage(page);
      await waitForScene(page);
    }
    mkdirSync(CAPTURES as string, { recursive: true });
    writeFileSync(resolve(CAPTURES as string, 'mesures.txt'), `${lignes.join('\n')}\n`);
  });
});

/** Compte les appels de dessin WebGL et les images de la page (comme tests/e2e/mesure.spec.ts). */
const COMPTEURS = `
  window.__draws = 0;
  window.__frames = 0;
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const original = WebGL2RenderingContext.prototype[name];
    WebGL2RenderingContext.prototype[name] = function (...args) {
      window.__draws += 1;
      return original.apply(this, args);
    };
  }
  const tick = () => { window.__frames += 1; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);`;

/** Appels de dessin par image, sur `ms` millisecondes de sortie (rendu continu : une image par appel d'animation). */
async function appelsParImage(page: Page, ms: number): Promise<{ parImage: number; images: number }> {
  const lire = () => page.evaluate(() => {
    const w = window as unknown as { __draws: number; __frames: number };
    return [w.__draws, w.__frames] as const;
  });
  const [d0, f0] = await lire();
  await page.waitForTimeout(ms);
  const [d1, f1] = await lire();
  const images = Math.max(1, f1 - f0);
  return { parImage: (d1 - d0) / images, images };
}

/** Coût du garage (Sous le capot : appels et triangles de la dernière image, puis « Mesurer »). */
async function coutGarage(page: Page): Promise<string> {
  await openAtelier(page, 'Sous le capot');
  const dialog = page.getByRole('dialog', { name: 'Sous le capot' });
  const image = (await dialog.locator('[data-fact="image"]').innerText()).trim();
  await dialog.getByRole('button', { name: 'Mesurer' }).tap();
  await expect(dialog.getByText(/i\/s en moyenne/)).toBeVisible({ timeout: 60_000 });
  const mesure = (await dialog.getByText(/i\/s en moyenne/).innerText()).trim();
  await page.keyboard.press('Escape');
  return `${image} | ${mesure}`;
}

/** Sortie de nuit au sec, caméra de poursuite puis bord de route, puis la pluie. */
async function sortieDeNuit(page: Page, nom: string): Promise<void> {
  await openEntry(page, ENTREE_SORTIE);
  await pickMap(page);
  await auSec(page);
  await page.locator('footer.dock').getByRole('button', { name: 'Sortir', exact: true }).tap();
  const stage = page.locator('.drive-stage');
  await expect(stage).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
  await attendreApercu(page);
  await expect(stage).toHaveAttribute('data-neons', /avant:fixe/);
  await expect(stage).toHaveAttribute('data-neons-lueur', '100', { timeout: 30_000 });
  await choisirCamera(page, 'Poursuite');
  await page.waitForTimeout(6_000);
  await photo(page, `10-${nom}-nuit-sec-poursuite`);
  await choisirCamera(page, 'Bord de route');
  await page.waitForTimeout(8_000);
  await photo(page, `11-${nom}-nuit-sec-bord`);
  await reglerSortie(page, 'Météo', 'Pluie');
  await choisirCamera(page, 'Poursuite');
  await page.waitForTimeout(8_000);
  await photo(page, `12-${nom}-nuit-pluie-poursuite`);
  await choisirCamera(page, 'Bord de route');
  await page.waitForTimeout(8_000);
  await photo(page, `13-${nom}-nuit-pluie-bord`);
  // LED de l'habitacle, à la caméra embarquée.
  await choisirCamera(page, 'Embarquée');
  await page.waitForTimeout(6_000);
  await photo(page, `14-${nom}-nuit-pluie-embarquee`);
  await rentrerAuGarage(page);
}
