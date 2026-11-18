// Navigation du dock : un seul niveau du menu à la fois (sections, entrées d'une section, contenu
// d'une entrée), la ligne de repère (« Retour », fil, « Fermer le menu »), la pile des niveaux de la
// peinture (zones → zone, couleur ou finition → nuancier), la pastille « Personnaliser » qui rouvre
// le dock à l'accueil du menu, Échap et le focus au clavier, et le tiers bas aux deux tailles
// d'écran et aux trois tailles de texte, dock ouvert comme fermé. Captures : captures/navigation/.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ENTREE_SORTIE, openApp, openEntry, reloadSaved, waitForScene } from './helpers.ts';

const dock = (page: Page) => page.locator('footer.dock');
const tabs = (page: Page) => dock(page).getByRole('navigation', { name: 'Onglets de l’atelier' });
const back = (page: Page) => dock(page).getByRole('button', { name: 'Retour', exact: true });
const close = (page: Page) => dock(page).getByRole('button', { name: 'Fermer le menu' });
const reopen = (page: Page) => dock(page).getByRole('button', { name: 'Personnaliser' });
const crumbs = (page: Page) => dock(page).locator('.dock-crumbs');
const zones = (page: Page) => dock(page).getByRole('group', { name: 'Zones' }).getByRole('button');
const colors = (page: Page) => dock(page).getByRole('group', { name: 'Couleurs' });
const picker = (page: Page) => dock(page).getByRole('region', { name: /^Nuancier/ });

async function shot(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'navigation', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

/** Fil attendu : les morceaux, dans l'ordre. */
async function expectCrumbs(page: Page, parts: string[]): Promise<void> {
  await expect(crumbs(page).locator('.dock-crumb')).toHaveText(parts.map((part) => new RegExp(`^${part}$`, 'i')));
}

/** Toute commande visible du dock fait 48 px et se trouve dans le tiers bas. */
async function expectDockUnderThumb(page: Page, height: number, label: string): Promise<number> {
  const buttons = dock(page).locator('button:visible');
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    const name = ((await button.getAttribute('aria-label')) ?? (await button.innerText())).trim().replace(/\s+/g, ' ');
    const box = await button.boundingBox();
    if (!box) continue;
    expect(box.height, `hauteur de « ${name} » (${label})`).toBeGreaterThanOrEqual(48);
    expect(box.width, `largeur de « ${name} » (${label})`).toBeGreaterThanOrEqual(48);
    expect(box.y, `« ${name} » dans le tiers bas (${label})`).toBeGreaterThanOrEqual((height * 2) / 3);
  }
  return count;
}

/**
 * Hauteur touchable de chaque élément : on l'amène au centre de sa zone qui défile, puis on compte,
 * pixel par pixel sur une verticale au milieu, les points où elementFromPoint tombe sur lui.
 */
async function touchableHeights(page: Page, selector: string): Promise<Array<{ name: string; hits: number }>> {
  return page.evaluate(async (selector) => {
    const out: Array<{ name: string; hits: number }> = [];
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      element.scrollIntoView({ block: 'center', inline: 'center' });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      let hits = 0;
      for (let y = Math.floor(box.top); y < box.bottom; y += 1) {
        const hit = document.elementFromPoint(x, y);
        if (hit && element.contains(hit)) hits += 1;
      }
      out.push({ name: (element.textContent ?? '').trim().slice(0, 24), hits });
    }
    return out;
  }, selector);
}

/** Haut du dock, en pixels. */
const dockTop = (page: Page) => dock(page).evaluate((footer) => Math.round(footer.getBoundingClientRect().top));

test.describe('navigation du dock', () => {
  test('peinture : descendre jusqu’au nuancier, remonter niveau par niveau, fermer, rouvrir à l’accueil du menu, recharger', async ({ page }) => {
    test.setTimeout(150_000);
    await openApp(page);
    await waitForScene(page);

    // Tout en haut : les sections seules, le véhicule à l'écran dans la ligne de repère, pas de « Retour ».
    await expect(dock(page).locator('.dock-vehicle')).not.toBeEmpty();
    await expect(back(page)).toHaveCount(0);
    await expect(tabs(page)).toBeVisible();
    await expect(dock(page).getByRole('navigation', { name: /^Entrées/ })).toHaveCount(0);
    await shot(page, '00-sections');
    // « Custom » : ses entrées seules, les sections masquées ; le fil dit « Custom ».
    await tabs(page).getByRole('button', { name: 'Custom', exact: true }).tap();
    const entries = dock(page).getByRole('navigation', { name: 'Entrées · Custom' });
    await expect(entries).toBeVisible();
    await expect(tabs(page)).toHaveCount(0);
    await expect(back(page)).toBeVisible();
    await expectCrumbs(page, ['Custom']);
    await shot(page, '00b-custom-entrees');
    // « Peinture » : ses choix seuls, entrées et sections masquées ; le fil dit « Custom · Peinture ».
    await entries.getByRole('button', { name: 'Peinture', exact: true }).tap();
    await expectCrumbs(page, ['Custom', 'Peinture']);
    await expect(entries).toHaveCount(0);
    await expect(tabs(page)).toHaveCount(0);
    await expect(back(page)).toBeVisible();
    await expect(close(page)).toBeVisible();
    await expect(zones(page).first()).toBeVisible();
    await expect(colors(page)).toHaveCount(0);
    const zone = ((await zones(page).first().locator('b').textContent()) ?? '').trim();
    await shot(page, '01-peinture-zones');

    // Une zone : ses couleurs, et « Retour » apparaît.
    await zones(page).first().tap();
    await expect(back(page)).toBeVisible();
    await expectCrumbs(page, ['Custom', 'Peinture', zone, 'Couleur']);
    await expect(colors(page)).toBeVisible();
    await shot(page, '02-peinture-zone-couleur');

    // Le nuancier.
    await dock(page).getByRole('button', { name: 'Autre couleur' }).tap();
    await expect(picker(page)).toBeVisible();
    await expectCrumbs(page, ['Custom', 'Peinture', zone, 'Nuancier']);
    await shot(page, '03-peinture-nuancier');

    // Retour : du nuancier aux couleurs.
    await back(page).tap();
    await expect(picker(page)).toHaveCount(0);
    await expect(colors(page)).toBeVisible();
    await expectCrumbs(page, ['Custom', 'Peinture', zone, 'Couleur']);

    // Les finitions sont une autre vue du même niveau : « Retour » mène à la liste des zones,
    // puis aux entrées de Custom, puis aux sections.
    await dock(page).getByRole('navigation', { name: 'Peinture' }).getByRole('button', { name: 'Finition' }).tap();
    await expectCrumbs(page, ['Custom', 'Peinture', zone, 'Finition']);
    await back(page).tap();
    await expect(zones(page).first()).toBeVisible();
    await expectCrumbs(page, ['Custom', 'Peinture']);
    await back(page).tap();
    await expect(entries).toBeVisible();
    await expectCrumbs(page, ['Custom']);
    await back(page).tap();
    await expect(tabs(page)).toBeVisible();
    await expect(back(page)).toHaveCount(0);
    // Garage, deux entrées (Ambiance, Sortie) : ses entrées d'abord, puis le contenu ;
    // « Retour » remonte aux entrées, puis aux sections.
    await tabs(page).getByRole('button', { name: 'Garage', exact: true }).tap();
    const garageEntries = dock(page).getByRole('navigation', { name: 'Entrées · Garage' });
    await expect(garageEntries.getByRole('button')).toHaveText(['Ambiance', ENTREE_SORTIE]);
    await garageEntries.getByRole('button', { name: 'Ambiance', exact: true }).tap();
    await expect(dock(page).getByRole('group', { name: 'Ambiance' })).toBeVisible();
    await expectCrumbs(page, ['Garage', 'Ambiance']);
    await back(page).tap();
    await expect(garageEntries).toBeVisible();
    await back(page).tap();
    await expect(tabs(page)).toBeVisible();
    await openEntry(page, 'Peinture');

    // Fermer le menu : une seule pastille au pouce, le cadrage d'origine.
    await zones(page).first().tap();
    await expectCrumbs(page, ['Custom', 'Peinture', zone, 'Couleur']);
    await close(page).tap();
    await expect(dock(page)).toHaveAttribute('data-taille', 'ferme');
    await expect(reopen(page)).toBeVisible();
    await expect(tabs(page)).toHaveCount(0);
    await expect(page.locator('.stage')).toHaveAttribute('data-decalage', '0');
    await shot(page, '04-dock-ferme');

    // « Personnaliser » rouvre à l'accueil du menu (retour du 16 novembre 2026) : les sections, pas le
    // niveau où on l'avait fermé. L'entrée quittée se retrouve en un appui.
    await reopen(page).tap();
    await expect(dock(page)).toHaveAttribute('data-taille', 'compact');
    await expect(tabs(page)).toBeVisible();
    await expect(back(page)).toHaveCount(0);
    await expect(colors(page)).toHaveCount(0);
    await openEntry(page, 'Peinture');
    await expect(zones(page).first()).toBeVisible();

    // Rechargement : le dock fermé est retrouvé.
    await close(page).tap();
    await expect(reopen(page)).toBeVisible();
    await reloadSaved(page);
    await expect(reopen(page)).toBeVisible();
    await expect(dock(page)).toHaveAttribute('data-taille', 'ferme');
    await reopen(page).tap();
    await expect(tabs(page)).toBeVisible();
  });

  test('clavier : Échap remonte d’un niveau, puis ferme le menu ; le focus suit ; les boutons se nomment', async ({ page }) => {
    await openApp(page);
    await openEntry(page, 'Peinture');
    await zones(page).first().click();
    await dock(page).getByRole('button', { name: 'Autre couleur' }).click();
    await expect(picker(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveCount(0);
    await expect(colors(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(zones(page).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dock(page).getByRole('navigation', { name: 'Entrées · Custom' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tabs(page)).toBeVisible();
    await expect(back(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(reopen(page)).toBeVisible();
    // Au clavier, la pastille se trouve et rouvre le dock ; le focus reste dans le dock.
    const focusInDock = () => page.evaluate(() => Boolean(document.activeElement?.closest('footer.dock')));
    await reopen(page).focus();
    await page.keyboard.press('Enter');
    await expect(close(page)).toBeVisible();
    await expect.poll(focusInDock, { message: 'focus après « Personnaliser »' }).toBe(true);
    // « Retour » au clavier : le bouton disparaît avec son niveau, le focus passe au niveau suivant.
    await tabs(page).getByRole('button', { name: 'Custom', exact: true }).focus();
    await page.keyboard.press('Enter');
    await back(page).focus();
    await page.keyboard.press('Enter');
    await expect(tabs(page)).toBeVisible();
    await expect.poll(focusInDock, { message: 'focus après « Retour »' }).toBe(true);
    // « Fermer le menu » au clavier : le focus passe à « Personnaliser ».
    await close(page).focus();
    await page.keyboard.press('Enter');
    await expect(reopen(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(close(page)).toBeVisible();
    // Un panneau ouvert garde sa touche Échap : le dock ne bouge pas.
    await page.goto('./#/reglages');
    await expect(page.getByRole('dialog', { name: 'Réglages' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(close(page)).toBeVisible();
  });

  test('tiers bas et 48 px : deux tailles d’écran, trois tailles de texte, dock ouvert comme fermé', async ({ page }) => {
    test.setTimeout(240_000);
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 360, height: 780 },
    ]) {
      await page.setViewportSize(viewport);
      for (const size of ['Normal', 'Grand', 'Très grand']) {
        const label = `${viewport.width} × ${viewport.height}, ${size}`;
        await openApp(page, '#/reglages');
        const dialog = page.getByRole('dialog', { name: 'Réglages' });
        await dialog.getByRole('button', { name: 'Texte' }).click();
        await dialog.getByRole('button', { name: new RegExp(`^${size}`) }).click();
        await dialog.getByRole('button', { name: 'Retour à l’atelier' }).click();
        await expect(dialog).toBeHidden();
        if (await reopen(page).isVisible()) await reopen(page).click();

        // Ouvert, au plus profond de la peinture hors nuancier : une zone, ses couleurs.
        await openEntry(page, 'Peinture');
        await zones(page).first().click();
        await expect(back(page)).toBeVisible();
        expect(await expectDockUnderThumb(page, viewport.height, `${label}, ouvert`)).toBeGreaterThan(4);
        const top = await dockTop(page);

        // Étape Finition, puis une finition à paillette : le menu ne bouge pas, il reste dans le
        // tiers bas, plusieurs finitions se voient et chacune se touche sur 44 px au moins.
        await dock(page).getByRole('navigation', { name: 'Peinture' }).getByRole('button', { name: 'Finition' }).click();
        expect(await dockTop(page), `Finition : le menu reste où il est (${label})`).toBe(top);
        const finishes = dock(page).getByRole('group', { name: 'Finitions' });
        await finishes.getByRole('button', { name: /^Métallisé/ }).click();
        await expect(dock(page).locator('.paint-flake input')).toBeVisible();
        expect(await dockTop(page), `paillette : le menu reste où il est (${label})`).toBe(top);
        await expectDockUnderThumb(page, viewport.height, `${label}, finition à paillette`);
        await finishes.evaluate((row) => {
          row.scrollLeft = 0;
        });
        const seen = await finishes.evaluate((row) => {
          const box = row.getBoundingClientRect();
          return [...row.querySelectorAll('button')].filter((chip) => {
            const r = chip.getBoundingClientRect();
            return Math.min(r.right, box.right) - Math.max(r.left, box.left) >= r.width * 0.6;
          }).length;
        });
        if (size !== 'Très grand') expect(seen, `finitions visibles (${label})`).toBeGreaterThanOrEqual(2);
        for (const chip of await touchableHeights(page, 'footer.dock [aria-label="Finitions"] button')) {
          expect(chip.hits, `« ${chip.name} » touchable (${label})`).toBeGreaterThanOrEqual(44);
        }
        if (viewport.width === 390 && size === 'Normal') await shot(page, '07-finition-paillette-390');

        // Mécanique · Préparation : le dock reste dans le tiers bas, chaque option se touche sur 44 px.
        await openEntry(page, 'Préparation');
        expect(await dockTop(page), `Préparation dans le tiers bas (${label})`).toBeGreaterThanOrEqual((viewport.height * 2) / 3);
        const options = await touchableHeights(page, 'footer.dock .dock-tab[data-onglet="preparation"] .engine-chips button');
        expect(options.length).toBeGreaterThan(3);
        for (const option of options) expect(option.hits, `« ${option.name} » touchable (${label})`).toBeGreaterThanOrEqual(44);
        if (viewport.width === 390 && size === 'Normal') await shot(page, '08-preparation-390');

        // Fermé : la seule pastille, au pouce.
        await close(page).click();
        await expect(reopen(page)).toBeVisible();
        expect(await expectDockUnderThumb(page, viewport.height, `${label}, fermé`)).toBe(1);
      }
    }
    await shot(page, '05-ferme-360-texte-tres-grand');
  });

  test('défilement stable : choisir une option ne déplace jamais le menu ; « Retour » rend la position du niveau', async ({ page }) => {
    test.setTimeout(150_000);
    await openApp(page);
    await waitForScene(page);
    const body = dock(page).locator('.dock-tab');

    // Compact, rangée qui défile : la liste des zones, poussée au bout, puis une zone et « Retour ».
    await openEntry(page, 'Peinture');
    const zoneRow = dock(page).getByRole('group', { name: 'Zones' });
    const zoneLeft = await zoneRow.evaluate((row) => {
      row.scrollLeft = row.scrollWidth;
      return row.scrollLeft;
    });
    expect(zoneLeft, 'la rangée des zones défile en compact').toBeGreaterThan(0);
    const lastZone = zones(page).last();
    await lastZone.tap();
    await expect(back(page)).toBeVisible();
    await back(page).tap();
    await expect.poll(() => zoneRow.evaluate((row) => row.scrollLeft), { message: 'position des zones rendue au retour' }).toBe(zoneLeft);

    // Compact, finitions d'une zone : la rangée poussée au bout, une finition choisie, rien ne bouge.
    await zones(page).first().tap();
    await dock(page).getByRole('navigation', { name: 'Peinture' }).getByRole('button', { name: 'Finition' }).tap();
    const finishRow = dock(page).getByRole('group', { name: 'Finitions' });
    const finishLeft = await finishRow.evaluate((row) => {
      row.scrollLeft = row.scrollWidth;
      return row.scrollLeft;
    });
    expect(finishLeft, 'la rangée des finitions défile en compact').toBeGreaterThan(0);
    const lastFinish = finishRow.getByRole('button').last();
    await lastFinish.tap();
    await expect(lastFinish).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(300);
    expect(await finishRow.evaluate((row) => row.scrollLeft), 'finitions : position inchangée').toBe(finishLeft);

    // Garage · Ambiance, compact : une ambiance au bout de la rangée.
    await openEntry(page, 'Ambiance');
    const ambianceRow = dock(page).getByRole('group', { name: 'Ambiance' });
    const ambianceLeft = await ambianceRow.evaluate((row) => {
      row.scrollLeft = row.scrollWidth;
      return row.scrollLeft;
    });
    const lastAmbiance = ambianceRow.getByRole('button').last();
    await lastAmbiance.tap();
    await expect(lastAmbiance).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(300);
    expect(await ambianceRow.evaluate((row) => row.scrollLeft), 'ambiances : position inchangée').toBe(ambianceLeft);

    // Agrandi : couleurs et finitions d'une zone ; on descend jusqu'aux finitions, on en choisit une.
    // Seul sous la ligne de repère, le contenu tient en 390 × 844 : un écran plus bas le fait défiler.
    await page.setViewportSize({ width: 390, height: 640 });
    // La poignée ne paraît que là où agrandir montre plus : on l'attrape dans la peinture.
    await openEntry(page, 'Peinture');
    await dock(page).getByRole('button', { name: 'Agrandir le menu' }).tap();
    await expect(dock(page)).toHaveAttribute('data-taille', 'agrandi');
    await zones(page).first().tap();
    await expect(back(page)).toBeVisible();
    const candy = dock(page).getByRole('group', { name: 'Finitions' }).getByRole('button', { name: /^Candy/ });
    await candy.evaluate((element) => element.scrollIntoView({ block: 'end' }));
    const top = await body.evaluate((element) => element.scrollTop);
    expect(top, 'la zone de l’entrée défile en agrandi').toBeGreaterThan(0);
    await candy.tap();
    await expect(candy).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(300);
    expect(await body.evaluate((element) => element.scrollTop), 'agrandi : position inchangée après une finition').toBe(top);
    await shot(page, '06-agrandi-finition-choisie');

    // Agrandi, Mécanique · Préparation : un stage choisi en bas de la fiche ne remonte rien.
    await openEntry(page, 'Préparation');
    const stage = body.getByRole('button', { name: /^Stage 2/ });
    await stage.evaluate((element) => element.scrollIntoView({ block: 'end' }));
    const engineTop = await body.evaluate((element) => element.scrollTop);
    await stage.tap();
    await expect(stage).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(300);
    expect(await body.evaluate((element) => element.scrollTop), 'préparation : position inchangée').toBe(engineTop);
    await dock(page).getByRole('button', { name: 'Réduire le menu' }).tap();
  });

  test('dernières couleurs : la couleur touchée reste sous le doigt, l’ordre ne bouge pas', async ({ page }) => {
    test.setTimeout(150_000);
    await openApp(page);
    await waitForScene(page);
    // Douze dernières couleurs, hors palette, posées dans la sauvegarde des builds.
    const recents = Array.from({ length: 12 }, (_, i) => `#${(0x102030 + i * 0x0b0a09).toString(16).padStart(6, '0')}`);
    const current = await page.locator('.stage').getAttribute('data-vehicle');
    await page.evaluate(
      async ({ recents, current }) =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('pimpmybichon');
          open.onupgradeneeded = () => open.result.createObjectStore('kv');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const store = open.result.transaction('kv', 'readwrite').objectStore('kv');
            const read = store.get('pmb-builds');
            read.onsuccess = () => {
              const saved = typeof read.result === 'string' ? JSON.parse(read.result) : { state: { current, builds: {} }, version: 1 };
              saved.state.recents = recents;
              const write = store.put(JSON.stringify(saved), 'pmb-builds');
              write.onsuccess = () => {
                open.result.close();
                resolve();
              };
            };
          };
        }),
      { recents, current },
    );
    await reloadSaved(page);
    await waitForScene(page);
    await openEntry(page, 'Peinture');
    await zones(page).first().tap();
    const row = colors(page);
    await expect(row.getByRole('button', { name: /^Récente/ })).toHaveCount(12);
    const order = () => row.getByRole('button', { name: /^Récente/ }).evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')));
    const before = await order();
    // Rangée poussée au bout : on touche la dernière récente, puis l'avant-dernière.
    const left = await row.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      return element.scrollLeft;
    });
    for (const index of [11, 10]) {
      const target = row.getByRole('button', { name: /^Récente/ }).nth(index);
      const name = await target.getAttribute('aria-label');
      const box = await target.boundingBox();
      if (!box) throw new Error('récente hors écran');
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.touchscreen.tap(x, y);
      await expect(row.getByRole('button', { name: name ?? '' })).toHaveAttribute('aria-pressed', 'true');
      await page.waitForTimeout(300);
      expect(await row.evaluate((element) => element.scrollLeft), 'la rangée ne défile pas').toBe(left);
      const under = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), { x, y });
      expect(under, 'la couleur touchée reste sous le doigt').toBe(name);
      expect(await order(), 'l’ordre des dernières couleurs ne change pas').toEqual(before);
    }
  });
});

test.describe('étiquette du véhicule', () => {
  // Sans service worker, le modèle passe par la page : on peut le couper.
  test.use({ serviceWorkers: 'block' });

  test('modèle introuvable : l’étiquette ne recouvre aucun bouton, deux tailles d’écran, trois tailles de texte', async ({ page }) => {
    test.setTimeout(180_000);
    await page.route('**/assets/vehicles/van/body.glb', (route) => route.abort('internetdisconnected'));
    await openApp(page);
    await openEntry(page, 'Véhicule');
    await dock(page).getByRole('group', { name: 'Véhicule' }).locator('[data-vehicle="van"]').tap();
    await expect(page.locator('.stage')).toHaveAttribute('data-bench', 'erreur', { timeout: 30_000 });
    await expect(page.locator('.tag')).toContainText('introuvable, relance avec du réseau');
    for (const [width, height] of [
      [390, 844],
      [360, 780],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const size of ['normal', 'grand', 'tres-grand']) {
        await page.evaluate((value) => {
          document.documentElement.dataset.text = value;
        }, size);
        // L'étiquette et le « ? » se recalent (mesure au changement de taille) : on les attend.
        await expect
          .poll(
            async () =>
              page.evaluate(() => {
                const tag = document.querySelector('.mid > .tag')?.getBoundingClientRect();
                if (!tag) return ['pas d’étiquette'];
                return [...document.querySelectorAll<HTMLElement>('button')]
                  .filter((button) => button.getClientRects().length > 0)
                  .filter((button) => {
                    const box = button.getBoundingClientRect();
                    return box.left < tag.right && box.right > tag.left && box.top < tag.bottom && box.bottom > tag.top;
                  })
                  .map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '?');
              }),
            { message: `${width} × ${height}, texte ${size} : boutons sous l’étiquette` },
          )
          .toEqual([]);
        // Le « ? » reste dans l'écran, au-dessus de « Réessayer ».
        const aide = await page.getByRole('button', { name: 'Aide', exact: true }).boundingBox();
        const retry = await page.getByRole('button', { name: 'Réessayer', exact: true }).boundingBox();
        expect((aide?.y ?? 0) + (aide?.height ?? 0)).toBeLessThan(retry?.y ?? 0);
      }
    }
  });
});
