// Le menu de la sortie par étapes (vague U, retour du 18 novembre 2026, fait deux fois, téléphone en
// paysage à l'appui) : chaque étape remplace la précédente (mode, lieu, circuit du lieu, départ,
// réglages), le fil dit où l'on est, « Retour » remonte d'UNE étape, ce qui est choisi se relit en une
// ligne ; « Sortir » est toujours entier, à 48 px au moins, sous le pouce, en portrait comme en paysage,
// en texte grand et très grand, et redit le format choisi. Rouvrir l'entrée ramène aux réglages.
// Captures de revue (chaque étape, 390 × 844 et 844 × 390) : PMB_CAPTURES_ENTREE=1, dans
// captures/vague-u-entree/.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { backToSections, cartesDuMenu, ENTREE_SORTIE, entreeSortie, etapePrecedente, openApp, openEntry, pickMap, quick, reloadSaved, waitForScene } from './helpers.ts';

const CAPTURES = Boolean(process.env.PMB_CAPTURES_ENTREE);
const dock = (page: Page) => page.locator('footer.dock');
const sortir = (page: Page) => dock(page).getByRole('button', { name: 'Sortir', exact: true });
const ici = (page: Page) => dock(page).locator('.dock-crumb-here');

async function shot(page: Page, name: string): Promise<void> {
  if (!CAPTURES) return;
  const path = resolve('captures', 'vague-u-entree', `${name}.png`);
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
 * « Sortir » est entier à l'écran et dans le menu, rien ne le recouvre (coins et centre), à 48 px au
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

/** Fil du dock : le chemin, puis l'étape où l'on est. */
async function fil(page: Page): Promise<string> {
  return ((await dock(page).locator('.dock-crumbs').innerText()) ?? '').replace(/\s+/g, ' ').trim();
}

test.describe('menu de la sortie par étapes', () => {
  test.setTimeout(240_000);

  test('portrait : une étape à la fois, le fil, « Retour » d’une étape, « Sortir » entier et qui redit le format', { tag: '@essentiel' }, async ({ page }) => {
    const { plusieurs, seul } = lieux();
    const multi = plusieurs[plusieurs.length - 1]!;
    await openApp(page);
    await waitForScene(page);
    await openEntry(page, ENTREE_SORTIE);
    const entree = entreeSortie(page);

    // 1. Le mode, seul.
    await expect(entree).toHaveAttribute('data-etape', 'mode');
    await expect(ici(page)).toHaveText(ENTREE_SORTIE);
    await expect(dock(page).getByRole('group', { name: 'Mode' }).getByRole('button')).toHaveCount(2);
    await expect(dock(page).getByRole('group', { name: 'Lieu' })).toHaveCount(0);
    await expect(sortir(page)).toHaveCount(0);
    await commandesA48(page, 'mode');
    await shot(page, 'portrait-1-mode');

    // Carrière : son panneau, et « Retour » ramène au mode.
    await dock(page).getByRole('group', { name: 'Mode' }).getByRole('button', { name: /^Carrière/ }).tap();
    await expect(entree).toHaveAttribute('data-etape', 'carriere');
    await expect(ici(page)).toHaveText('Carrière');
    await expect(dock(page).getByRole('group', { name: 'Mode' })).toHaveCount(0);
    await shot(page, 'portrait-1b-carriere');
    await etapePrecedente(page);
    await expect(entree).toHaveAttribute('data-etape', 'mode');

    // 2. Le lieu : les lieux seulement.
    await dock(page).getByRole('group', { name: 'Mode' }).getByRole('button', { name: /^Libre/ }).tap();
    await expect(entree).toHaveAttribute('data-etape', 'zone');
    await expect(ici(page)).toHaveText('Libre');
    await expect(dock(page).getByRole('group', { name: 'Mode' })).toHaveCount(0);
    const lieuxDuMenu = dock(page).getByRole('group', { name: 'Lieu' });
    await expect(lieuxDuMenu.getByRole('button')).toHaveCount(new Set(cartesDuMenu().map((carte) => carte.zone)).size);
    await expect(entree.locator('.entree-rappel')).toContainText('Libre');
    await commandesA48(page, 'lieu');
    await shot(page, 'portrait-2-lieu');

    // 3. Le circuit d'un lieu qui en a plusieurs : ses circuits, et seulement eux ; plus de lieux.
    await lieuxDuMenu.locator(`[data-zone="${multi.zone}"]`).tap();
    await expect(entree).toHaveAttribute('data-etape', 'circuit');
    await expect(ici(page)).toHaveText(multi.lieu);
    await expect(dock(page).getByRole('group', { name: 'Lieu' })).toHaveCount(0);
    const circuits = dock(page).getByRole('group', { name: 'Circuit' });
    await expect(circuits.getByRole('button')).toHaveCount(plusieurs.length);
    await expect(circuits.locator('svg.picto-carte')).toHaveCount(plusieurs.length);
    await expect(entree.locator('.entree-rappel')).toContainText(multi.lieu);
    await commandesA48(page, 'circuit');
    await shot(page, 'portrait-3-circuit');

    // 4. Les départs du circuit choisi, et seulement eux.
    await circuits.locator(`[data-carte="${multi.id}"]`).tap();
    await expect(entree).toHaveAttribute('data-etape', 'depart');
    await expect(ici(page)).toHaveText(multi.circuit);
    expect(await fil(page)).toContain(multi.lieu);
    await expect(dock(page).getByRole('group', { name: 'Circuit' })).toHaveCount(0);
    const departs = dock(page).getByRole('group', { name: 'Départ' });
    await expect(departs.getByRole('button').nth(1)).toBeVisible();
    await expect(entree.locator('.entree-rappel')).toContainText(`${multi.lieu} › ${multi.circuit}`);
    await commandesA48(page, 'départ');
    await shot(page, 'portrait-4-depart');

    // « Retour » remonte d'une étape (le circuit), pas au menu ; on redescend.
    await etapePrecedente(page);
    await expect(entree).toHaveAttribute('data-etape', 'circuit');
    await circuits.locator(`[data-carte="${multi.id}"]`).tap();
    await expect(entree).toHaveAttribute('data-etape', 'depart');
    const nomDepart = ((await departs.getByRole('button').nth(1).locator('b').textContent()) ?? '').trim();
    await departs.getByRole('button').nth(1).tap();

    // 5. Les réglages : rappel en une ligne, moment, météo, format, crédits, « Sortir ».
    await expect(entree).toHaveAttribute('data-etape', 'reglages');
    await expect(ici(page)).toHaveText(nomDepart);
    await expect(dock(page).getByRole('group', { name: 'Départ' })).toHaveCount(0);
    await expect(entree.locator('.entree-rappel')).toContainText(`${multi.lieu} › ${multi.circuit} › ${nomDepart}`);
    for (const groupe of ['Moment', 'Météo', 'Format']) await expect(dock(page).getByRole('group', { name: groupe })).toBeAttached();
    await expect(dock(page).locator(`.drive-credits[data-credits="${multi.id}"]`)).toBeAttached();
    // Le format d'une sauvegarde neuve : la course d'un tour ; « Sortir » le redit, avec ce qu'il rapporte.
    const formats = dock(page).getByRole('group', { name: 'Format' });
    await expect(formats.getByRole('button', { name: /^Course 1 tour/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(sortir(page)).toContainText('Course 1 tour');
    await expect(sortir(page)).toContainText('dollars');
    await sortirEntier(page, 'portrait');
    await commandesA48(page, 'réglages');
    await shot(page, 'portrait-5-reglages');
    await formats.getByRole('button', { name: /^Balade/ }).tap();
    await expect(sortir(page)).toContainText('Balade');
    await expect(sortir(page)).toContainText('sans gain');
    await formats.getByRole('button', { name: /^Course 1 tour/ }).tap();

    // « Retour » d'une étape à chaque appui : départ, circuit, lieu, mode.
    for (const etape of ['depart', 'circuit', 'zone', 'mode']) {
      await etapePrecedente(page);
      await expect(entree).toHaveAttribute('data-etape', etape);
    }

    // Un lieu à un seul circuit passe droit à ses départs.
    await dock(page).getByRole('group', { name: 'Mode' }).getByRole('button', { name: /^Libre/ }).tap();
    await dock(page).getByRole('group', { name: 'Lieu' }).locator(`[data-zone="${seul[0]!.zone}"]`).tap();
    await expect(entree).toHaveAttribute('data-etape', 'depart');
    await expect(dock(page).getByRole('group', { name: 'Circuit' })).toHaveCount(0);
    await etapePrecedente(page);
    await expect(entree).toHaveAttribute('data-etape', 'zone');

    // Rouvrir l'entrée : droit aux réglages du dernier choix, « Changer de circuit » ramène aux lieux.
    await pickMap(page, cartesDuMenu().findIndex((carte) => carte.id === multi.id));
    await backToSections(page);
    await openEntry(page, ENTREE_SORTIE);
    await expect(entree).toHaveAttribute('data-etape', 'reglages');
    await expect(dock(page).locator(`.drive-credits[data-credits="${multi.id}"]`)).toBeAttached();
    await etapePrecedente(page);
    await expect(entree).toHaveAttribute('data-etape', 'depart');
    await departs.locator('[aria-pressed="true"]').tap();
    await dock(page).getByRole('button', { name: 'Changer de circuit' }).tap();
    await expect(entree).toHaveAttribute('data-etape', 'zone');
  });

  test('la dernière sortie est gardée : au lancement, l’entrée rouvre ses réglages', async ({ page }) => {
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

      test('chaque étape seule dans la colonne ; « Sortir » entier en texte normal, grand et très grand', { tag: '@essentiel' }, async ({ page }) => {
        test.setTimeout(360_000);
        const { plusieurs } = lieux();
        const multi = plusieurs[plusieurs.length - 1]!;
        const nom = `paysage-${vue.width}`;
        await openApp(page);
        await waitForScene(page);
        await openEntry(page, ENTREE_SORTIE);
        const entree = entreeSortie(page);
        await expect(entree).toHaveAttribute('data-etape', 'mode');
        await commandesA48(page, `${nom} mode`);
        if (vue.width === 844) await shot(page, `${nom}-1-mode`);
        await dock(page).getByRole('group', { name: 'Mode' }).getByRole('button', { name: /^Libre/ }).tap();
        await expect(entree).toHaveAttribute('data-etape', 'zone');
        await commandesA48(page, `${nom} lieu`);
        if (vue.width === 844) await shot(page, `${nom}-2-lieu`);
        await dock(page).getByRole('group', { name: 'Lieu' }).locator(`[data-zone="${multi.zone}"]`).tap();
        await expect(entree).toHaveAttribute('data-etape', 'circuit');
        await expect(dock(page).getByRole('group', { name: 'Lieu' })).toHaveCount(0);
        if (vue.width === 844) await shot(page, `${nom}-3-circuit`);
        await dock(page).getByRole('group', { name: 'Circuit' }).locator(`[data-carte="${multi.id}"]`).tap();
        await expect(entree).toHaveAttribute('data-etape', 'depart');
        await expect(dock(page).getByRole('group', { name: 'Départ' }).getByRole('button').first()).toBeVisible();
        await commandesA48(page, `${nom} départ`);
        if (vue.width === 844) await shot(page, `${nom}-4-depart`);
        await dock(page).getByRole('group', { name: 'Départ' }).getByRole('button').first().tap();
        await expect(entree).toHaveAttribute('data-etape', 'reglages');
        await sortirEntier(page, `${nom} texte normal`);
        await commandesA48(page, `${nom} réglages`);
        await shot(page, `${nom}-5-reglages`);
        for (const size of ['Grand', 'Très grand'] as const) {
          await setTextSize(page, size);
          await expect(entree).toHaveAttribute('data-etape', 'reglages');
          await sortirEntier(page, `${nom} texte ${size}`);
          await expect(sortir(page)).toContainText('Course 1 tour');
          if (size === 'Très grand') await shot(page, `${nom}-6-reglages-tres-grand`);
        }
      });
    });
  }

  test('portrait, texte très grand : « Sortir » entier aux réglages', async ({ page }) => {
    await openApp(page);
    await waitForScene(page);
    await setTextSize(page, 'Très grand');
    await openEntry(page, ENTREE_SORTIE);
    await pickMap(page);
    await sortirEntier(page, 'portrait très grand');
    await commandesA48(page, 'portrait très grand');
    await shot(page, 'portrait-6-reglages-tres-grand');
  });
});
