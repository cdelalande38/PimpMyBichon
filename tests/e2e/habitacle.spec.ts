import { expect, test, type Page } from '@playwright/test';
import { backToSections, changedRatio, openApp, openEntry, reloadSaved, waitForBench, waitForStill } from './helpers.ts';

// Habitacle (§ 5.4) : Custom · Intérieur. Ouvrir l'entrée fait entrer dans la vue intérieure ;
// volant, pommeau, sièges et ciel étoilé se voient tout de suite, entrent dans le build, survivent
// au rechargement ; « D'origine » remet tout ; quitter l'entrée ramène à l'atelier.

interface Saved {
  current: string | null;
  builds: Record<string, { paints: Record<string, unknown>; parts?: Record<string, string>; tune?: Record<string, number>; partPaints?: Record<string, { color?: string }> }>;
  recents: string[];
}

async function readSaved(page: Page): Promise<Saved | null> {
  return page.evaluate(
    () =>
      new Promise<Saved | null>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const read = open.result.transaction('kv', 'readonly').objectStore('kv').get('pmb-builds');
          read.onsuccess = () => {
            const raw = read.result as string | undefined;
            done(raw ? (JSON.parse(raw) as { state: Saved }).state : null);
          };
          read.onerror = () => fail(read.error);
        };
      }),
  );
}

async function writeSaved(page: Page, state: Saved): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(JSON.stringify({ state: value, version: 1 }), 'pmb-builds');
          tx.oncomplete = () => {
            open.result.close();
            done();
          };
          tx.onerror = () => fail(tx.error);
        };
      }),
    state,
  );
}

const dock = (page: Page) => page.locator('footer.dock');

/** L'image au-dessus du dock : là où l'habitacle se voit. */
async function view(page: Page): Promise<Buffer> {
  const top = (await dock(page).boundingBox())!.y;
  return page.screenshot({ clip: { x: 0, y: 70, width: 390, height: Math.floor(top - 80) } });
}

/** Touche une commande et vérifie que l'habitacle change à l'image. */
async function changes(page: Page, tap: () => Promise<void>, what: string, min = 0.002): Promise<void> {
  await waitForStill(page);
  const before = await view(page);
  await tap();
  await waitForStill(page);
  expect(await changedRatio(before, await view(page)), what).toBeGreaterThan(min);
}

test.describe('habitacle', () => {
  test('volant, pommeau, sièges et ciel : vus de l’intérieur, gardés au rechargement, « D’origine »', async ({ page }) => {
    test.setTimeout(300_000);
    await openApp(page);
    await writeSaved(page, { current: 'cox', builds: {}, recents: [] });
    await reloadSaved(page);
    await waitForBench(page);
    const stage = page.locator('.stage');
    await expect(stage).toHaveAttribute('data-vue', 'atelier');

    await openEntry(page, 'Intérieur');
    const body = dock(page).locator('.dock-tab[data-onglet="interieur"]');
    // Ouvrir l'entrée fait entrer dans la vue intérieure.
    await expect(stage).toHaveAttribute('data-vue', 'interieur', { timeout: 15_000 });
    await expect(dock(page)).toHaveAttribute('data-taille', 'compact');

    // Volant : le sport à trois branches d'origine, puis le tulipé ; la jante passe au rouge.
    const wheels = body.getByRole('group', { name: 'Dessin du volant' });
    await expect(wheels.locator('[data-volant="sport"]')).toHaveAttribute('aria-pressed', 'true');
    for (const id of ['deux_branches', 'sport', 'tulipe', 'bois', 'moyeu_large']) await expect(wheels.locator(`[data-volant="${id}"]`)).toBeAttached();
    const dockTop = (await dock(page).boundingBox())!.y;
    // Le haut du menu reste dans le tiers bas, chaque commande à 48 px au doigt.
    expect(dockTop).toBeGreaterThanOrEqual((844 * 2) / 3);
    for (const button of await body.locator('button').all()) if (await button.isVisible()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await changes(page, () => wheels.locator('[data-volant="tulipe"]').tap(), 'le volant change à l’image');
    await expect(wheels.locator('[data-volant="tulipe"]')).toHaveAttribute('aria-pressed', 'true');
    await changes(page, () => body.getByRole('group', { name: 'Couleur de la jante' }).getByRole('button', { name: 'Rouge', exact: true }).tap(), 'la jante change de couleur', 0.0005);
    expect((await dock(page).boundingBox())!.y, 'le menu ne bouge pas').toBeCloseTo(dockTop, 0);

    // Pommeau : le long cylindre.
    await body.getByRole('button', { name: 'Pommeau', exact: true }).tap();
    const knobs = body.getByRole('group', { name: 'Pommeau de levier' });
    await expect(knobs.locator('[data-pommeau="tete_de_mort"]')).toHaveAttribute('aria-pressed', 'true');
    await changes(page, () => knobs.locator('[data-pommeau="cylindre"]').tap(), 'le pommeau change à l’image', 0.0003);
    // Sa couleur : sur la Cox, celle de la zone « Pommeau » (os d'origine), ici passée au rouge.
    await changes(page, () => body.getByRole('group', { name: 'Couleur du pommeau' }).getByRole('button', { name: 'Rouge', exact: true }).tap(), 'le pommeau change de couleur', 0.0002);

    // Sièges : le baquet course.
    await body.getByRole('button', { name: 'Sièges', exact: true }).tap();
    const seats = body.getByRole('group', { name: 'Sièges avant' });
    await expect(seats.locator('[data-siege="bas"]')).toHaveAttribute('aria-pressed', 'true');
    await changes(page, () => seats.locator('[data-siege="baquet"]').tap(), 'les sièges changent à l’image');

    // Ciel : éteint d'origine sur la Cox, on l'allume.
    await body.getByRole('button', { name: 'Ciel', exact: true }).tap();
    await expect(body.locator('[data-ciel="eteint"]')).toHaveAttribute('aria-pressed', 'true');
    await changes(page, () => body.locator('[data-ciel="allume"]').tap(), 'le ciel s’allume', 0.0005);
    await body.locator('[data-densite="dense"]').tap();
    await expect(body.locator('[data-densite="dense"]')).toHaveAttribute('aria-pressed', 'true');
    expect((await dock(page).boundingBox())!.y, 'le menu ne bouge pas').toBeCloseTo(dockTop, 0);

    // Les choix entrent dans le build.
    await expect
      .poll(async () => (await readSaved(page))?.builds.cox?.parts)
      .toEqual({ volant: 'tulipe', pommeau: 'cylindre', sieges: 'baquet', ciel: 'allume' });
    const saved = await readSaved(page);
    expect(saved?.builds.cox?.partPaints?.volant?.color).toBe('#c81e1e');
    expect((saved?.builds.cox?.paints.pommeau as { color?: string } | undefined)?.color).toBe('#c81e1e');
    expect(saved?.builds.cox?.tune?.ciel_densite).toBe(2);

    // Quitter l'entrée ramène à l'atelier.
    await backToSections(page);
    await expect(stage).toHaveAttribute('data-vue', 'atelier', { timeout: 15_000 });

    // Rechargement : on retrouve les choix.
    await reloadSaved(page);
    await waitForBench(page);
    await openEntry(page, 'Intérieur');
    await expect(stage).toHaveAttribute('data-vue', 'interieur', { timeout: 15_000 });
    await expect(body.locator('[data-volant="tulipe"]')).toHaveAttribute('aria-pressed', 'true');
    await body.getByRole('button', { name: 'Sièges', exact: true }).tap();
    await expect(body.locator('[data-siege="baquet"]')).toHaveAttribute('aria-pressed', 'true');

    // « D'origine » : tout revient, la sauvegarde aussi.
    const reset = body.getByRole('button', { name: 'D’origine', exact: true });
    await expect(reset).toBeEnabled();
    await changes(page, () => reset.tap(), 'l’habitacle revient d’origine');
    await expect(body.locator('[data-siege="bas"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(reset).toBeDisabled();
    await expect.poll(async () => (await readSaved(page))?.builds.cox?.parts ?? {}).toEqual({});
  });

  test('une valeur inconnue dans la sauvegarde retombe sur l’origine, sans rien casser', async ({ page }) => {
    test.setTimeout(180_000);
    await openApp(page);
    await writeSaved(page, { current: 'van', builds: { van: { paints: {}, parts: { volant: 'volant_inconnu', sieges: 'trone', ciel: 'clignotant' }, tune: { ciel_densite: 9 } } }, recents: [] });
    await reloadSaved(page);
    await waitForBench(page);
    await openEntry(page, 'Intérieur');
    const body = dock(page).locator('.dock-tab[data-onglet="interieur"]');
    await expect(body.locator('[data-volant="moyeu_large"]')).toHaveAttribute('aria-pressed', 'true');
    await body.getByRole('button', { name: 'Ciel', exact: true }).tap();
    await expect(body.locator('[data-ciel="allume"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(body.locator('[data-densite="normal"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.stage')).toHaveAttribute('data-vue', 'interieur', { timeout: 15_000 });
  });
});
