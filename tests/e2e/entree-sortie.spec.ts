// L'écran « Jouer » (vague X, 21 novembre 2026 ; avant : le menu « Sortie » des vagues U et V) : les modes en
// cartes, puis le lieu, le circuit du lieu et les réglages de ce mode, une étape à la fois ; le titre d'étape
// remplace le fil ; « Retour » et Échap remontent d'UNE étape ; « Jouer » (le bouton du garage) est visible à
// toute profondeur du menu ; « Jouer » (aux réglages) est toujours entier, à 48 px au moins, sous le pouce, en
// portrait comme en paysage, en texte grand et très grand, et redit le mode choisi. « Continuer » reprend la
// dernière sortie. Captures de revue (chaque étape, 390 × 844, 844 × 390 et 1366 × 768) : PMB_CAPTURES_ENTREE=1,
// dans captures/vague-x-jouer/.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { attendreRoute, backToSections, cartesDuMenu, choisirMode, DELAI_ROUTE, ENTREE_SORTIE, entreeSortie, etapePrecedente, openApp, openEntry, ouvrirCiel, pickMap, quick, reloadSaved, waitForScene } from './helpers.ts';

const CAPTURES = Boolean(process.env.PMB_CAPTURES_ENTREE);
const dock = (page: Page) => page.locator('footer.dock');
const sortir = (page: Page) => dock(page).getByRole('button', { name: 'Jouer', exact: true });
const ici = (page: Page) => dock(page).locator('.dock-crumb-here');

async function shot(page: Page, name: string): Promise<void> {
  if (!CAPTURES) return;
  const path = resolve('captures', 'vague-x-jouer', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  // Le temps que la scène du garage se recadre sous le menu.
  await page.waitForTimeout(600);
  await page.screenshot({ path });
}

/** Les lieux du catalogue : un lieu à plusieurs circuits, un lieu à un seul. */
function lieux() {
  const cartes = cartesDuMenu();
  const parLieu = new Map<string, typeof cartes>();
  for (const carte of cartes) parLieu.set(carte.zone, [...(parLieu.get(carte.zone) ?? []), carte]);
  const plusieurs = [...parLieu.values()].find((list) => list.length > 1);
  const seul = [...parLieu.values()].find((list) => list.length === 1);
  if (!plusieurs || !seul) throw new Error('il faut un lieu à plusieurs circuits et un lieu à un seul');
  return { plusieurs, seul };
}

/**
 * « Jouer » est entier à l'écran et dans le menu, rien ne le recouvre (coins et centre), à 48 px au
 * moins, hors de toute rangée qui défile, et sous le pouce (en bas du menu).
 */
async function sortirEntier(page: Page, quoi: string): Promise<void> {
  const bouton = sortir(page);
  await expect(bouton, quoi).toBeVisible();
  const vue = page.viewportSize();
  const box = await bouton.boundingBox();
  const menu = await dock(page).boundingBox();
  if (!vue || !box || !menu) throw new Error(`${quoi} : pas de boîte`);
  expect(box.height, `${quoi} : hauteur`).toBeGreaterThanOrEqual(47.5);
  expect(box.width, `${quoi} : largeur`).toBeGreaterThanOrEqual(47.5);
  expect(box.x, `${quoi} : bord gauche`).toBeGreaterThanOrEqual(-0.5);
  expect(box.y, `${quoi} : bord haut`).toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width, `${quoi} : bord droit dans l'écran`).toBeLessThanOrEqual(vue.width + 0.5);
  expect(box.y + box.height, `${quoi} : bord bas dans l'écran`).toBeLessThanOrEqual(vue.height + 0.5);
  expect(box.x, `${quoi} : dans le menu`).toBeGreaterThanOrEqual(menu.x - 0.5);
  expect(box.x + box.width, `${quoi} : dans le menu`).toBeLessThanOrEqual(menu.x + menu.width + 0.5);
  // Sur toute la largeur du menu (moins ses marges), collé en bas : sous le pouce.
  expect(box.width, `${quoi} : toute la largeur du menu`).toBeGreaterThan(menu.width * 0.8);
  expect(menu.y + menu.height - (box.y + box.height), `${quoi} : collé en bas du menu`).toBeLessThan(40);
  // Un panneau qui finit de se refermer peut passer dessus un instant : on relit jusqu'à ce qu'il soit parti.
  const lire = () => bouton.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const points = [
      [rect.left + 3, rect.top + 3],
      [rect.right - 3, rect.top + 3],
      [rect.left + 3, rect.bottom - 3],
      [rect.right - 3, rect.bottom - 3],
      [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2],
    ];
    const recouvert = points
      .map(([x, y]) => [x ?? 0, y ?? 0, document.elementFromPoint(x ?? 0, y ?? 0)] as const)
      .filter(([, , top]) => !top || !(top === element || element.contains(top)))
      .map(([x, y, top]) => `${Math.round(x)},${Math.round(y)} : ${top ? `${top.tagName}.${String(top.className)}` : 'rien'}`);
    const rangee = element.closest('.chips, .entree-corps') !== null;
    const label = element.querySelector('span');
    const coupe = label ? label.scrollWidth > label.clientWidth + 1 || label.getBoundingClientRect().right > rect.right + 0.5 : true;
    return { recouvert, rangee, coupe };
  });
  await expect.poll(async () => (await lire()).recouvert, { message: `${quoi} : rien ne le recouvre`, timeout: 5_000 }).toEqual([]);
  const libre = await lire();
  expect(libre.rangee, `${quoi} : jamais dans ce qui défile`).toBe(false);
  expect(libre.coupe, `${quoi} : le mot n'est pas coupé`).toBe(false);
}

/** Toute commande visible du menu offre 48 px au doigt. */
async function commandesA48(page: Page, quoi: string): Promise<void> {
  const petites = await page.evaluate(() => {
    const out: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>('footer.dock button')) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) continue;
      if (rect.width < 47.5 || rect.height < 47.5) out.push(`${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 30)} ${Math.round(rect.width)}×${Math.round(rect.height)}`);
    }
    return out;
  });
  expect(petites, `${quoi} : 48 px`).toEqual([]);
}

async function setTextSize(page: Page, size: 'Normal' | 'Grand' | 'Très grand'): Promise<void> {
  await quick(page).getByRole('button', { name: 'Atelier', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Réglages' });
  await dialog.getByRole('button', { name: 'Texte' }).click();
  await dialog.getByRole('button', { name: new RegExp(`^${size}`) }).click();
  await dialog.getByRole('button', { name: 'Retour à l’atelier' }).click();
  await expect(dialog).toBeHidden();
}

const mode = (page: Page, id: string) => dock(page).getByRole('group', { name: 'Mode' }).locator(`[data-mode="${id}"]`);

test.describe('écran Jouer', () => {
  test.setTimeout(240_000);

  test('portrait : les modes en cartes, une étape à la fois, le titre, « Retour » d’une étape, « Jouer » entier et qui redit le mode', { tag: '@essentiel' }, async ({ page }) => {
    const { plusieurs, seul } = lieux();
    const multi = plusieurs[plusieurs.length - 1]!;
    await openApp(page);
    await waitForScene(page);
    await openEntry(page, ENTREE_SORTIE);
    const entree = entreeSortie(page);

    // 1. Les modes, seuls : une carte chacun, le rodéo sans carte, pas de « Continuer » sur une sauvegarde neuve.
    await expect(entree).toHaveAttribute('data-etape', 'mode');
    await expect(ici(page)).toHaveText('Jouer');
    await expect(dock(page).getByRole('group', { name: 'Mode' }).locator('[data-mode]')).toHaveCount(5);
    for (const id of ['carriere', 'course', 'duel', 'drift', 'balade']) await expect(mode(page, id)).toBeVisible();
    await expect(mode(page, 'rodeo')).toHaveCount(0);
    await expect(mode(page, 'continuer')).toHaveCount(0);
    await expect(dock(page).getByRole('group', { name: 'Lieu' })).toHaveCount(0);
    await expect(sortir(page)).toHaveCount(0);
    await commandesA48(page, 'modes');
    await shot(page, 'portrait-1-modes');

    // Carrière : son panneau (la fiche du prochain rendez-vous), et « Retour » ramène aux modes.
    await mode(page, 'carriere').tap();
    await expect(entree).toHaveAttribute('data-etape', 'carriere');
    await expect(ici(page)).toHaveText('Carrière');
    await expect(dock(page).getByRole('group', { name: 'Mode' })).toHaveCount(0);
    await shot(page, 'portrait-1b-carriere');
    await etapePrecedente(page);
    await expect(entree).toHaveAttribute('data-etape', 'mode');

    // 2. Le lieu : les lieux seulement.
    await mode(page, 'course').tap();
    await expect(entree).toHaveAttribute('data-etape', 'zone');
    await expect(ici(page)).toHaveText('Choisis ton lieu');
    await expect(dock(page).getByRole('group', { name: 'Mode' })).toHaveCount(0);
    const lieuxDuMenu = dock(page).getByRole('group', { name: 'Lieu' });
    await expect(lieuxDuMenu.getByRole('button')).toHaveCount(new Set(cartesDuMenu().map((carte) => carte.zone)).size);
    await expect(entree.locator('.entree-rappel')).toContainText('Course');
    await commandesA48(page, 'lieu');
    await shot(page, 'portrait-2-lieu');

    // 3. Le circuit d'un lieu qui en a plusieurs : ses circuits, et seulement eux ; plus de lieux.
    await lieuxDuMenu.locator(`[data-zone="${multi.zone}"]`).tap();
    await expect(entree).toHaveAttribute('data-etape', 'circuit');
    await expect(ici(page)).toHaveText('Choisis ton circuit');
    await expect(dock(page).getByRole('group', { name: 'Lieu' })).toHaveCount(0);
    const circuits = dock(page).getByRole('group', { name: 'Circuit' });
    await expect(circuits.getByRole('button')).toHaveCount(plusieurs.length);
    await expect(circuits.locator('svg.picto-carte')).toHaveCount(plusieurs.length);
    await expect(entree.locator('.entree-rappel')).toContainText(multi.lieu);
    await commandesA48(page, 'circuit');
    await shot(page, 'portrait-3-circuit');

    // « Retour » remonte d'une étape (le lieu), pas aux modes ; on redescend.
    await etapePrecedente(page);
    await expect(entree).toHaveAttribute('data-etape', 'zone');
    await lieuxDuMenu.locator(`[data-zone="${multi.zone}"]`).tap();
    await circuits.locator(`[data-carte="${multi.id}"]`).tap();

    // 4. Les réglages de la course, droit après le circuit (plus d'étape des départs) : le rappel en une ligne,
    // le format, le départ (la route en a plusieurs), moment et météo repliés, crédits repliés, « Jouer ».
    await expect(entree).toHaveAttribute('data-etape', 'reglages');
    await expect(ici(page)).toHaveText('Prépare ton départ');
    await expect(dock(page).getByRole('group', { name: 'Circuit' })).toHaveCount(0);
    const departs = dock(page).getByRole('group', { name: 'Départ' });
    await expect(departs.getByRole('button').nth(1)).toBeVisible({ timeout: 30_000 });
    const nomDepart = ((await departs.getByRole('button').nth(1).locator('b').textContent()) ?? '').trim();
    await departs.getByRole('button').nth(1).tap();
    await expect(departs.getByRole('button').nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(entree.locator('.entree-rappel')).toContainText(`${multi.lieu} › ${multi.circuit} › ${nomDepart}`);
    const formats = dock(page).getByRole('group', { name: 'Format' });
    await expect(formats.getByRole('button')).toHaveCount(2);
    await expect(formats.getByRole('button', { name: /^Course 1 tour/ })).toHaveAttribute('aria-pressed', 'true');
    // Moment et météo : une ligne (« Nuit · Pluie »), qui s'ouvre d'un appui.
    const resume = entree.locator('.entree-ciel-resume');
    await expect(resume).toContainText(/(Nuit|Jour) · (Sec|Pluie|Neige)/);
    await expect(dock(page).getByRole('group', { name: 'Météo' })).toBeHidden();
    await ouvrirCiel(page);
    await expect(dock(page).getByRole('group', { name: 'Moment' })).toBeVisible();
    await resume.tap();
    await expect(dock(page).getByRole('group', { name: 'Météo' })).toBeHidden();
    await expect(dock(page).locator(`.drive-credits[data-credits="${multi.id}"]`)).toContainText('Licence');
    // « Jouer » redit le mode et ce qu'il rapporte.
    await expect(sortir(page)).toContainText('Course 1 tour');
    await expect(sortir(page)).toContainText('dollars');
    await sortirEntier(page, 'portrait');
    await commandesA48(page, 'réglages');
    await shot(page, 'portrait-4-reglages');

    // Les réglages suivent le mode : la balade, le duel et le drift n'ont pas la rangée des formats.
    await etapePrecedente(page);
    await etapePrecedente(page);
    await etapePrecedente(page);
    await expect(entree).toHaveAttribute('data-etape', 'mode');
    for (const [id, dit] of [
      ['balade', 'sans gain'],
      ['drift', 'Drift'],
      ['duel', 'Duel'],
    ] as const) {
      await choisirMode(page, id);
      await dock(page).getByRole('group', { name: 'Lieu' }).locator(`[data-zone="${seul[0]!.zone}"]`).tap();
      await expect(entree).toHaveAttribute('data-etape', 'reglages');
      await expect(dock(page).getByRole('group', { name: 'Format' })).toHaveCount(0);
      await expect(sortir(page)).toContainText(dit);
      if (id === 'duel') await expect(dock(page).getByRole('group', { name: 'Adversaire' })).toBeVisible();
      else await expect(dock(page).getByRole('group', { name: 'Adversaire' })).toHaveCount(0);
      await sortirEntier(page, `portrait ${id}`);
    }

    // Un lieu à un seul circuit passe droit aux réglages.
    await expect(dock(page).getByRole('group', { name: 'Circuit' })).toHaveCount(0);
    await etapePrecedente(page);
    await expect(entree).toHaveAttribute('data-etape', 'zone');

    // Échap remonte d'une étape, comme « Retour ».
    await page.keyboard.press('Escape');
    await expect(entree).toHaveAttribute('data-etape', 'mode');

    // « Continuer » : la dernière sortie, un appui, droit aux réglages ; « Retour » remonte étape par étape.
    await pickMap(page, cartesDuMenu().findIndex((carte) => carte.id === multi.id));
    await backToSections(page);
    await openEntry(page, ENTREE_SORTIE);
    await expect(entree).toHaveAttribute('data-etape', 'mode');
    await expect(mode(page, 'continuer')).toContainText(`${multi.lieu} › ${multi.circuit}`);
    await shot(page, 'portrait-5-continuer');
    await mode(page, 'continuer').tap();
    await expect(entree).toHaveAttribute('data-etape', 'reglages');
    await expect(dock(page).locator(`.drive-credits[data-credits="${multi.id}"]`)).toBeAttached();
    await etapePrecedente(page);
    await expect(entree).toHaveAttribute('data-etape', 'circuit');
    await etapePrecedente(page);
    await expect(entree).toHaveAttribute('data-etape', 'zone');
  });

  test('« Jouer » est visible à toute profondeur du menu, le bouton rond de la carrière n’existe plus, Garage n’a plus « Sortie »', { tag: '@essentiel' }, async ({ page }) => {
    await openApp(page);
    await waitForScene(page);
    await expect(page.getByRole('button', { name: /^Carrière : prochain rendez-vous/ })).toHaveCount(0);
    await expect(quick(page).getByRole('button')).not.toHaveCount(0);
    const jouer = dock(page).getByRole('button', { name: 'Jouer', exact: true });
    // Aux sections, dans une section, dans un contenu, dans un sous-niveau (Peinture : une zone), menu fermé.
    await expect(jouer).toBeVisible();
    await openEntry(page, 'Peinture');
    await expect(jouer).toBeVisible();
    await dock(page).locator('.dock-tab[data-onglet="peinture"] button').first().tap();
    await expect(jouer).toBeVisible();
    const box = await jouer.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(47.5);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(47.5);
    // Il ne recouvre ni « Retour » ni la croix.
    for (const nom of ['Retour', 'Fermer le menu']) {
      const autre = await dock(page).getByRole('button', { name: nom, exact: true }).boundingBox();
      if (!box || !autre) throw new Error(`${nom} : pas de boîte`);
      expect(box.x + box.width <= autre.x + 0.5 || autre.x + autre.width <= box.x + 0.5 || box.y + box.height <= autre.y + 0.5 || autre.y + autre.height <= box.y + 0.5, `Jouer recouvre ${nom}`).toBe(true);
    }
    await jouer.tap();
    await expect(entreeSortie(page)).toHaveAttribute('data-etape', 'mode');
    await expect(dock(page).getByRole('button', { name: 'Jouer', exact: true })).toHaveCount(0);
    await shot(page, 'portrait-0-jouer-depuis-peinture');
    // Garage : l'ambiance seule, droit à son contenu (la sortie n'y est plus).
    await backToSections(page);
    await dock(page).getByRole('navigation', { name: 'Onglets de l’atelier' }).getByRole('button', { name: 'Garage', exact: true }).tap();
    await expect(dock(page).locator('.dock-tab[data-onglet="ambiance"]')).toBeVisible();
    await expect(dock(page).locator('.drive-entry')).toHaveCount(0);
    await expect(dock(page).getByRole('button', { name: 'Jouer', exact: true })).toBeVisible();
    await shot(page, 'portrait-0-garage-sans-bouton-rond');
    // Menu fermé : « Jouer » reste à côté de « Personnaliser ».
    await dock(page).getByRole('button', { name: 'Fermer le menu' }).tap();
    await expect(dock(page).getByRole('button', { name: 'Personnaliser' })).toBeVisible();
    await expect(dock(page).getByRole('button', { name: 'Jouer', exact: true })).toBeVisible();
  });

  test('une première course libre : quatre ou cinq appuis, et la grille tout de suite (plus d’aperçu)', { tag: '@essentiel' }, async ({ page }) => {
    test.setTimeout(360_000);
    const carte = cartesDuMenu()[0]!;
    const plusieurs = cartesDuMenu().filter((autre) => autre.zone === carte.zone).length > 1;
    await openApp(page);
    await waitForScene(page);
    let appuis = 0;
    await dock(page).getByRole('button', { name: 'Jouer', exact: true }).tap();
    appuis += 1;
    await mode(page, 'course').tap();
    appuis += 1;
    await dock(page).getByRole('group', { name: 'Lieu' }).locator(`[data-zone="${carte.zone}"]`).tap();
    appuis += 1;
    if (plusieurs) {
      await dock(page).getByRole('group', { name: 'Circuit' }).locator(`[data-carte="${carte.id}"]`).tap();
      appuis += 1;
    }
    await sortir(page).tap();
    appuis += 1;
    test.info().annotations.push({ type: 'appuis', description: `${appuis} appuis avant les feux (le rapport en comptait jusqu'à 7)` });
    expect(appuis).toBeLessThanOrEqual(5);
    await attendreRoute(page);
    // Pas d'aperçu : la conduite est déjà à la main, aux feux.
    await expect(page.locator('.drive-invite')).toHaveCount(0);
    await expect(page.locator('.drive-mid')).toHaveAttribute('data-conduite', 'main');
    await expect(page.locator('.drive-stage')).toHaveAttribute('data-depart', /^(attente|feux|parti)$/, { timeout: DELAI_ROUTE });
  });

  test('l’aperçu reste en balade, et seulement là', async ({ page }) => {
    test.setTimeout(360_000);
    await openApp(page);
    await waitForScene(page);
    await openEntry(page, ENTREE_SORTIE);
    await pickMap(page, 0, 'balade');
    await sortir(page).tap();
    await expect(page.locator('.drive-invite')).toHaveText('Touche l’écran pour commencer', { timeout: DELAI_ROUTE });
    await expect(page.locator('.drive-mid')).toHaveAttribute('data-conduite', 'auto');
  });

  test('« Entrée » lance depuis les réglages', async ({ page }) => {
    test.setTimeout(360_000);
    await openApp(page);
    await waitForScene(page);
    await openEntry(page, ENTREE_SORTIE);
    await pickMap(page);
    await page.keyboard.press('Enter');
    await expect(page.locator('.drive-stage')).toBeVisible({ timeout: DELAI_ROUTE });
  });

  test('la dernière sortie est gardée : « Continuer » reprend ses réglages', async ({ page }) => {
    const cartes = cartesDuMenu();
    const derniere = cartes[cartes.length - 1]!;
    await openApp(page);
    await waitForScene(page);
    await page.evaluate(
      (value) =>
        new Promise<void>((done, fail) => {
          const open = indexedDB.open('pimpmybichon');
          open.onupgradeneeded = () => open.result.createObjectStore('kv');
          open.onerror = () => fail(open.error);
          open.onsuccess = () => {
            const transaction = open.result.transaction('kv', 'readwrite');
            transaction.objectStore('kv').put(JSON.stringify({ state: value, version: 2 }), 'pmb-sortie');
            transaction.oncomplete = () => done();
            transaction.onerror = () => fail(transaction.error);
          };
        }),
      { weather: 'sec', format: 'balade', derniere: { map: derniere.id, start: null } },
    );
    await reloadSaved(page);
    await waitForScene(page);
    await openEntry(page, ENTREE_SORTIE);
    // L'écran s'ouvre sur les modes (plus de saut aux réglages) ; « Continuer » y mène d'un appui.
    await expect(entreeSortie(page)).toHaveAttribute('data-etape', 'mode');
    await mode(page, 'continuer').tap();
    await expect(entreeSortie(page)).toHaveAttribute('data-etape', 'reglages');
    await expect(dock(page).locator(`.drive-credits[data-credits="${derniere.id}"]`)).toBeAttached();
    // Un choix fait exprès en version 2 (la balade) est respecté.
    await expect(sortir(page)).toContainText('Balade');
  });

  for (const vue of [
    { width: 844, height: 390 },
    { width: 915, height: 412 },
  ]) {
    test.describe(`paysage ${vue.width} × ${vue.height}`, () => {
      test.use({ viewport: vue });

      test('chaque étape seule dans la colonne ; « Jouer » entier en texte normal, grand et très grand', { tag: '@essentiel' }, async ({ page }) => {
        test.setTimeout(360_000);
        const { plusieurs } = lieux();
        const multi = plusieurs[plusieurs.length - 1]!;
        const nom = `paysage-${vue.width}`;
        await openApp(page);
        await waitForScene(page);
        await openEntry(page, ENTREE_SORTIE);
        const entree = entreeSortie(page);
        await expect(entree).toHaveAttribute('data-etape', 'mode');
        await commandesA48(page, `${nom} modes`);
        if (vue.width === 844) await shot(page, `${nom}-1-modes`);
        await mode(page, 'course').tap();
        await expect(entree).toHaveAttribute('data-etape', 'zone');
        await commandesA48(page, `${nom} lieu`);
        if (vue.width === 844) await shot(page, `${nom}-2-lieu`);
        await dock(page).getByRole('group', { name: 'Lieu' }).locator(`[data-zone="${multi.zone}"]`).tap();
        await expect(entree).toHaveAttribute('data-etape', 'circuit');
        await expect(dock(page).getByRole('group', { name: 'Lieu' })).toHaveCount(0);
        if (vue.width === 844) await shot(page, `${nom}-3-circuit`);
        await dock(page).getByRole('group', { name: 'Circuit' }).locator(`[data-carte="${multi.id}"]`).tap();
        await expect(entree).toHaveAttribute('data-etape', 'reglages');
        await expect(dock(page).getByRole('group', { name: 'Départ' }).getByRole('button').first()).toBeVisible({ timeout: 30_000 });
        await sortirEntier(page, `${nom} texte normal`);
        await commandesA48(page, `${nom} réglages`);
        await shot(page, `${nom}-4-reglages`);
        for (const size of ['Grand', 'Très grand'] as const) {
          await setTextSize(page, size);
          await expect(entree).toHaveAttribute('data-etape', 'reglages');
          await sortirEntier(page, `${nom} texte ${size}`);
          await expect(sortir(page)).toContainText('Course 1 tour');
          if (size === 'Très grand') await shot(page, `${nom}-5-reglages-tres-grand`);
        }
      });
    });
  }

  test('portrait, texte très grand : « Jouer » entier aux réglages', async ({ page }) => {
    await openApp(page);
    await waitForScene(page);
    await setTextSize(page, 'Très grand');
    await openEntry(page, ENTREE_SORTIE);
    await pickMap(page);
    await sortirEntier(page, 'portrait très grand');
    await commandesA48(page, 'portrait très grand');
    await shot(page, 'portrait-5-reglages-tres-grand');
  });
});
