import { expect, test, type Page } from '@playwright/test';
import { capture, changedRatio, openApp, openEntry, sceneBand, waitForBench, waitForStill } from './helpers.ts';

// Roues et assiette (§ 5.4) : Custom · Roues (jantes, pneus, cotes) et Custom · Suspension. Les
// choix entrent dans le build du véhicule, se voient tout de suite, survivent au rechargement et à
// deux onglets ; une valeur inconnue retombe sur l'origine.

interface Saved {
  current: string | null;
  builds: Record<string, { paints: Record<string, unknown>; parts?: Record<string, string>; tune?: Record<string, number>; partPaints?: Record<string, { color?: string }> }>;
  recents: string[];
}

async function readBuilds(page: Page): Promise<Saved | null> {
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

async function writeBuilds(page: Page, state: Saved): Promise<void> {
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

test.describe('roues et assiette', () => {
  test('jante, pneu, cote et assiette : vus tout de suite, gardés au rechargement, sans bouger le menu', async ({ page }) => {
    test.setTimeout(240_000);
    await openApp(page);
    await writeBuilds(page, { current: 'cox', builds: {}, recents: [] });
    await page.reload();
    await waitForBench(page);
    await openEntry(page, 'Roues');
    const body = dock(page).locator('.dock-tab[data-onglet="roues"]');
    await expect(dock(page)).toHaveAttribute('data-taille', 'compact');

    // Jantes : la jante d'origine est cochée ; une autre se monte aussitôt.
    const rims = body.getByRole('group', { name: 'Dessin des jantes' });
    await expect(rims.locator('[data-jante="huit_branches"]')).toHaveAttribute('aria-pressed', 'true');
    for (const id of ['tole', 'huit_branches', 'flasque', 'cinq_batons', 'rayons_fils', 'deport_profond']) await expect(rims.locator(`[data-jante="${id}"]`)).toBeAttached();
    const dockTop = (await dock(page).boundingBox())!.y;
    const before = await sceneBand(page);
    await rims.locator('[data-jante="deport_profond"]').tap();
    await expect(rims.locator('[data-jante="deport_profond"]')).toHaveAttribute('aria-pressed', 'true');
    await waitForStill(page);
    expect(await changedRatio(before, await sceneBand(page)), 'la jante change à l’image').toBeGreaterThan(0.002);
    expect((await dock(page).boundingBox())!.y, 'le menu ne bouge pas').toBeCloseTo(dockTop, 0);
    // Le menu reste dans le tiers bas, chaque commande à 48 px au doigt.
    expect(dockTop).toBeGreaterThanOrEqual((844 * 2) / 3);
    for (const button of await body.locator('button').all()) if (await button.isVisible()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);

    // Pneus : flanc blanc et sa couleur.
    await body.getByRole('button', { name: 'Pneus', exact: true }).tap();
    await body.locator('[data-pneu="flanc_blanc"]').tap();
    await body.getByRole('button', { name: 'Rouge', exact: true }).tap();
    await expect(body.getByRole('button', { name: 'Rouge', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await capture(page, 'roues-cox-flanc-rouge');

    // Cotes : 18 pouces.
    await body.getByRole('button', { name: 'Cotes', exact: true }).tap();
    await body.getByTestId('roues-diametre').fill('18');
    await expect(body.getByTestId('roues-cote')).toContainText('R18');

    // Suspension : posée au sol.
    await openEntry(page, 'Suspension');
    const ride = dock(page).locator('.dock-tab[data-onglet="suspension"]');
    await ride.locator('[data-assiette="au_sol"]').tap();
    await expect(ride.locator('[data-assiette="au_sol"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(ride.getByTestId('suspension-descente')).toContainText('cm');
    await waitForStill(page);
    await capture(page, 'roues-cox-au-sol');

    await expect
      .poll(async () => (await readBuilds(page))?.builds.cox)
      .toMatchObject({ parts: { jantes: 'deport_profond', pneus: 'flanc_blanc' }, tune: { jante: 18, assiette: 1 }, partPaints: { pneus: { color: '#ff2d3f' } } });

    // Rechargement : tout est là.
    await page.reload();
    await waitForBench(page);
    await openEntry(page, 'Roues');
    await expect(body.locator('[data-jante="deport_profond"]')).toHaveAttribute('aria-pressed', 'true');
    await body.getByRole('button', { name: 'Cotes', exact: true }).tap();
    await expect(body.getByTestId('roues-diametre')).toHaveValue('18');
    await openEntry(page, 'Suspension');
    await expect(ride.locator('[data-assiette="au_sol"]')).toHaveAttribute('aria-pressed', 'true');

    // « Origine » : la hauteur d'usine revient.
    await ride.locator('[data-assiette="origine"]').tap();
    await expect(ride.locator('[data-assiette="origine"]')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await readBuilds(page))?.builds.cox?.tune?.assiette).toBeUndefined();
  });

  test('la couleur des jantes reste dans Peinture : le raccourci y mène, sur la zone des jantes', async ({ page }) => {
    test.setTimeout(150_000);
    await openApp(page);
    await writeBuilds(page, { current: 'van', builds: {}, recents: [] });
    await page.reload();
    await openEntry(page, 'Roues');
    const body = dock(page).locator('.dock-tab[data-onglet="roues"]');
    await expect(body).toContainText('Peinture');
    await body.getByRole('button', { name: /Peindre · Jantes/ }).tap();
    await expect(dock(page).locator('.dock-tab[data-onglet="peinture"]')).toBeVisible();
    await expect(dock(page)).toContainText('Jantes');
  });

  test('une jante ou un pneu inconnus retombent sur l’origine ; le concept garde ses roues et règle son assiette', async ({ page }) => {
    test.setTimeout(150_000);
    await openApp(page);
    await writeBuilds(page, {
      current: 'bobber',
      builds: { bobber: { paints: {}, parts: { jantes: 'jante_disparue', pneus: 'slick' }, tune: { jante: 99 } }, concept: { paints: {}, tune: { assiette: 1 } } },
      recents: [],
    });
    await page.reload();
    await openEntry(page, 'Roues');
    const body = dock(page).locator('.dock-tab[data-onglet="roues"]');
    await expect(body.locator('[data-jante="moto_rayons"]')).toHaveAttribute('aria-pressed', 'true');
    await body.getByRole('button', { name: 'Pneus', exact: true }).tap();
    await expect(body.locator('[data-pneu="route"]')).toHaveAttribute('aria-pressed', 'true');
    await body.getByRole('button', { name: 'Cotes', exact: true }).tap();
    await expect(body.getByTestId('roues-diametre')).toHaveValue('19');
    // Moto : largeur du pneu arrière, une cote parmi d'autres (un seul curseur à l'écran).
    await body.locator('[data-cote="pneu_arriere"]').tap();
    await expect(body.getByTestId('roues-arriere')).toBeVisible();
    await expect(body.getByTestId('roues-diametre')).toHaveCount(0);

    await writeBuilds(page, { ...(await readBuilds(page))!, current: 'concept' });
    await page.reload();
    await waitForBench(page);
    await openEntry(page, 'Roues');
    await expect(dock(page).locator('.dock-tab[data-onglet="roues"]')).toContainText('garde ses roues');
    await openEntry(page, 'Suspension');
    await expect(dock(page).locator('[data-assiette="au_sol"]')).toHaveAttribute('aria-pressed', 'true');
    await capture(page, 'roues-concept-au-sol');
  });

  test('deux onglets : les roues de l’un et l’assiette de l’autre restent toutes deux', async ({ context, page: a }) => {
    test.setTimeout(240_000);
    await openApp(a);
    await writeBuilds(a, { current: 'van', builds: {}, recents: [] });
    await a.reload();
    const b = await context.newPage();
    await openApp(b);

    await openEntry(a, 'Roues');
    await dock(a).locator('[data-jante="rayons_fils"]').tap();
    await expect.poll(async () => (await readBuilds(a))?.builds.van?.parts?.jantes).toBe('rayons_fils');

    await b.bringToFront();
    await openEntry(b, 'Suspension');
    await dock(b).locator('[data-assiette="rabaissee"]').tap();
    await expect.poll(async () => (await readBuilds(b))?.builds.van?.tune?.assiette).toBe(0.5);

    const saved = (await readBuilds(b))!;
    expect(saved.builds.van).toMatchObject({ parts: { jantes: 'rayons_fils' }, tune: { assiette: 0.5 } });
    // B voit la jante posée par A, A l'assiette posée par B.
    await openEntry(b, 'Roues');
    await expect(dock(b).locator('[data-jante="rayons_fils"]')).toHaveAttribute('aria-pressed', 'true');
    await a.bringToFront();
    await openEntry(a, 'Suspension');
    await expect(dock(a).locator('[data-assiette="rabaissee"]')).toHaveAttribute('aria-pressed', 'true');
  });
});
