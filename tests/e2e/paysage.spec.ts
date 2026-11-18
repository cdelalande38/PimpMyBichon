import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { backToSections, openApp, openEntry, quick, waitForBench, waitForScene } from './helpers.ts';

// Le garage en paysage (844 × 390 et 780 × 360, téléphone tenu à deux mains) : le menu est une colonne
// à droite sur toute la hauteur (mêmes niveaux, même contenu que le dock du bas), les boutons ronds une
// colonne à gauche, le véhicule cadré entre les deux, les panneaux une feuille latérale. Rien ne se
// recouvre, toute commande fait 48 px, et tourner le téléphone ne perd ni le niveau du menu ni le panneau.
// Le portrait n'est pas rejoué ici : tous les autres parcours le gardent à l'œil.

interface Entry {
  id: string;
  order: number;
  glb: string;
  interiorView?: unknown;
}

const DIR = new URL('../../public/assets/vehicles/', import.meta.url);
const CATALOG: Entry[] = readdirSync(DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/vehicle.json`, DIR)))
  .map((entry) => JSON.parse(readFileSync(new URL(`${entry.name}/vehicle.json`, DIR), 'utf8')) as Entry)
  .filter((entry) => existsSync(new URL(`${entry.id}/${entry.glb}`, DIR)))
  .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));

const SCREENS = [
  { width: 844, height: 390 },
  { width: 780, height: 360 },
] as const;

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const dock = (page: Page) => page.locator('footer.dock');
const stage = (page: Page) => page.locator('.stage');
const sectionsNav = (page: Page) => dock(page).getByRole('navigation', { name: 'Onglets de l’atelier' });

async function rectOf(page: Page, selector: string): Promise<Rect> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`pas de boîte pour ${selector}`);
  return { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height };
}

const intersect = (a: Rect, b: Rect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
const show = (r: Rect) => `${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}`;

/** Cadre du véhicule à l'écran (boîte projetée, décalage de la vue compris), posé par la scène. */
async function frameOf(page: Page): Promise<Rect | null> {
  const across = await stage(page).getAttribute('data-vehicule-largeur');
  const down = await stage(page).getAttribute('data-vehicule-ecran');
  if (!across || !down) return null;
  const [left, right] = across.split(',').map(Number);
  const [top, bottom] = down.split(',').map(Number);
  if (left === undefined || right === undefined || top === undefined || bottom === undefined) return null;
  return { left, right, top, bottom };
}

/** Attend que le décalage de la vue (menu ouvert ou fermé) soit posé : le cadre ne bouge plus. */
async function settledFrame(page: Page): Promise<Rect> {
  let last = '';
  let frame: Rect | null = null;
  await expect
    .poll(
      async () => {
        frame = await frameOf(page);
        const key = JSON.stringify(frame);
        const same = frame !== null && key === last;
        last = key;
        return same;
      },
      { message: 'cadre du véhicule posé', timeout: 20_000, intervals: [350] },
    )
    .toBe(true);
  if (!frame) throw new Error('pas de cadre');
  return frame;
}

/** Boutons et liens visibles d'une zone plus petits que 48 px (au doigt), avec leur nom. */
async function smallTargets(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root) return ['zone absente'];
    const small: string[] = [];
    for (const element of root.querySelectorAll<HTMLElement>('button, a[href], input, select, [role="button"], [role="switch"]')) {
      if (element.closest('[inert]') || element.closest('[hidden]')) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      // Rangée défilante : seuls comptent les éléments à l'écran.
      if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) continue;
      if (rect.width < 47.5 || rect.height < 47.5) {
        small.push(`${(element.getAttribute('aria-label') ?? element.textContent ?? element.tagName).trim().slice(0, 30)} ${Math.round(rect.width)}×${Math.round(rect.height)}`);
      }
    }
    return small;
  }, scope);
}

/** Boutons du menu en colonne dont un bord sort de la colonne (un libellé ou une rangée qui déborde). */
async function outsideTheColumn(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const column = document.querySelector('.app > footer.dock');
    if (!column) return ['pas de menu'];
    const box = column.getBoundingClientRect();
    const out: string[] = [];
    for (const button of column.querySelectorAll<HTMLElement>('button')) {
      const rect = button.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.left < box.left - 1 || rect.right > box.right + 1) out.push(`${button.textContent?.trim().slice(0, 24)} (${Math.round(rect.left)}–${Math.round(rect.right)})`);
    }
    if (column.scrollWidth > column.clientWidth + 1) out.push(`la colonne défile en largeur (${column.scrollWidth} > ${column.clientWidth})`);
    return out;
  });
}

async function chooseVehicle(page: Page, id: string): Promise<void> {
  if ((await stage(page).getAttribute('data-vehicle')) === id) return;
  await openEntry(page, 'Véhicule');
  await dock(page).getByRole('group', { name: 'Véhicule' }).locator(`[data-vehicle="${id}"]`).tap();
  await expect(stage(page)).toHaveAttribute('data-vehicle', id);
  await waitForBench(page);
}

async function setTextSize(page: Page, size: 'Normal' | 'Grand' | 'Très grand'): Promise<void> {
  await quick(page).getByRole('button', { name: 'Atelier', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Réglages' });
  await dialog.getByRole('button', { name: 'Texte' }).click();
  await dialog.getByRole('button', { name: new RegExp(`^${size}`) }).click();
  await dialog.getByRole('button', { name: 'Retour à l’atelier' }).click();
  await expect(dialog).toBeHidden();
}

/** Rien ne se recouvre : le véhicule cadré, le menu, les boutons ronds, l'étiquette, la marque et le « ? ». */
async function expectNoOverlap(page: Page, label: string): Promise<void> {
  const frame = await settledFrame(page);
  const menu = await rectOf(page, '.app > footer.dock');
  const named: Array<[string, Rect]> = [
    ['menu', menu],
    ['marque', await rectOf(page, 'h1.brand')],
    ['étiquette', await rectOf(page, '.mid > .tag')],
    ['« ? »', await rectOf(page, '.tuto-aide')],
  ];
  const buttons = quick(page).getByRole('button');
  for (let i = 0; i < (await buttons.count()); i += 1) {
    const box = await buttons.nth(i).boundingBox();
    if (box) named.push([`bouton rond ${i + 1}`, { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height }]);
  }
  const all: Array<[string, Rect]> = [['véhicule', frame], ...named];
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const [nameA, a] = all[i] as [string, Rect];
      const [nameB, b] = all[j] as [string, Rect];
      expect(intersect(a, b), `${label} : ${nameA} (${show(a)}) recouvre ${nameB} (${show(b)})`).toBe(false);
    }
  }
  // Le véhicule tient dans l'image, sans être coupé.
  const { width, height } = page.viewportSize() ?? { width: 844, height: 390 };
  expect(frame.left, `${label} : véhicule coupé à gauche`).toBeGreaterThanOrEqual(0);
  expect(frame.right, `${label} : véhicule coupé à droite`).toBeLessThanOrEqual(width);
  expect(frame.top, `${label} : véhicule coupé en haut`).toBeGreaterThanOrEqual(0);
  expect(frame.bottom, `${label} : véhicule coupé en bas`).toBeLessThanOrEqual(height);
}

for (const screen of SCREENS) {
  test.describe(`garage en paysage, ${screen.width} × ${screen.height}`, () => {
    test.use({ viewport: screen });

    test('le menu est une colonne à droite sur toute la hauteur, avec ses sections, ses entrées et un contenu', async ({ page }) => {
      test.setTimeout(240_000);
      await openApp(page);
      await waitForScene(page);
      await waitForBench(page);

      // Une colonne collée au bord droit, sur toute la hauteur, d'au plus la moitié de la largeur.
      const column = await rectOf(page, '.app > footer.dock');
      expect(Math.abs(column.right - screen.width)).toBeLessThanOrEqual(1);
      expect(column.top).toBeLessThanOrEqual(1);
      expect(Math.abs(column.bottom - screen.height)).toBeLessThanOrEqual(1);
      expect(column.right - column.left).toBeLessThan(screen.width * 0.5);
      expect(column.right - column.left).toBeGreaterThan(250);

      // Sections : les quatre, l'une sous l'autre.
      await expect(sectionsNav(page)).toBeVisible();
      const names = ['Véhicule', 'Custom', 'Mécanique', 'Garage'];
      const tops: number[] = [];
      for (const name of names) {
        const box = await sectionsNav(page).getByRole('button', { name, exact: true }).boundingBox();
        expect(box, `section ${name}`).not.toBeNull();
        tops.push(box?.y ?? 0);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(47.5);
      }
      expect(tops).toEqual([...tops].sort((a, b) => a - b));
      expect(new Set(tops).size).toBe(names.length);
      // Pas de poignée « Agrandir le menu » : la colonne montre déjà tout en pleine page.
      await expect(dock(page).getByRole('button', { name: /^(Agrandir|Réduire) le menu$/ })).toHaveCount(0);
      expect(await smallTargets(page, 'footer.dock'), 'sections : cibles de 48 px').toEqual([]);
      expect(await smallTargets(page, 'nav.quick'), 'boutons ronds : 48 px').toEqual([]);
      expect(await outsideTheColumn(page)).toEqual([]);
      await expectNoOverlap(page, 'sections');

      // Entrées d'une section.
      await sectionsNav(page).getByRole('button', { name: 'Custom', exact: true }).tap();
      const entries = dock(page).getByRole('navigation', { name: 'Entrées · Custom' });
      await expect(entries).toBeVisible();
      await expect(entries.getByRole('button', { name: 'Peinture', exact: true })).toBeVisible();
      expect(await smallTargets(page, 'footer.dock'), 'entrées : cibles de 48 px').toEqual([]);
      expect(await outsideTheColumn(page)).toEqual([]);

      // Un contenu : la peinture, ses zones, puis une zone (couleurs et finitions ensemble).
      await openEntry(page, 'Peinture');
      const zones = dock(page).getByRole('group', { name: 'Zones' });
      await expect(zones).toBeVisible();
      await zones.getByRole('button').first().tap();
      await expect(dock(page).getByRole('group', { name: 'Couleurs' })).toBeVisible();
      expect(await smallTargets(page, 'footer.dock'), 'peinture : cibles de 48 px').toEqual([]);
      expect(await outsideTheColumn(page)).toEqual([]);
      // Retour : remonte d'un niveau, puis aux sections, comme au portrait.
      await backToSections(page);
      await expect(sectionsNav(page)).toBeVisible();

      // Menu fermé : le véhicule se recentre sur toute la largeur, la pastille revient sous le pouce droit.
      const open = await settledFrame(page);
      await dock(page).getByRole('button', { name: 'Fermer le menu' }).tap();
      const pill = dock(page).getByRole('button', { name: 'Personnaliser' });
      await expect(pill).toBeVisible();
      const pillBox = await pill.boundingBox();
      expect(pillBox?.height ?? 0).toBeGreaterThanOrEqual(47.5);
      expect((pillBox?.x ?? 0) + (pillBox?.width ?? 0)).toBeGreaterThan(screen.width * 0.8);
      expect((pillBox?.y ?? 0) + (pillBox?.height ?? 0)).toBeGreaterThan(screen.height * 0.8);
      await expect.poll(async () => Number(await stage(page).getAttribute('data-decalage-x')), { timeout: 15_000 }).toBe(0);
      const closed = await settledFrame(page);
      expect(Math.abs((closed.left + closed.right) / 2 - screen.width / 2), 'véhicule centré, menu fermé').toBeLessThan(screen.width * 0.05);
      expect(closed.right - closed.left, 'même taille menu fermé qu’ouvert').toBeCloseTo(open.right - open.left, -1);
      await pill.tap();
      await expect(sectionsNav(page)).toBeVisible();
      await expect.poll(async () => Number(await stage(page).getAttribute('data-decalage-x'))).toBeGreaterThan(0);
    });

    test('trois tailles de texte : rien ne déborde, rien ne se recouvre, 48 px partout', async ({ page }) => {
      test.setTimeout(300_000);
      await openApp(page);
      await waitForScene(page);
      await waitForBench(page);
      for (const size of ['Normal', 'Grand', 'Très grand'] as const) {
        await setTextSize(page, size);
        await backToSections(page);
        for (const section of ['Véhicule', 'Custom', 'Mécanique', 'Garage']) {
          await backToSections(page);
          await sectionsNav(page).getByRole('button', { name: section, exact: true }).tap();
          expect(await outsideTheColumn(page), `${section} (${size})`).toEqual([]);
          expect(await smallTargets(page, 'footer.dock'), `${section} (${size}) : 48 px`).toEqual([]);
        }
        await backToSections(page);
        expect(await smallTargets(page, 'nav.quick'), `boutons ronds (${size}) : 48 px`).toEqual([]);
        await expectNoOverlap(page, `texte ${size}`);
        // Les cinq boutons ronds tiennent à l'écran, en colonne.
        const buttons = quick(page).getByRole('button');
        const count = await buttons.count();
        expect(count).toBeGreaterThanOrEqual(4);
        const first = await buttons.first().boundingBox();
        const last = await buttons.last().boundingBox();
        expect(first?.y ?? -1).toBeGreaterThanOrEqual(0);
        expect((last?.y ?? 1e4) + (last?.height ?? 0)).toBeLessThanOrEqual(screen.height);
      }
    });

    test('un panneau s’ouvre en feuille latérale, la vue intérieure garde ses places au pouce, la photo sa barre basse', async ({ page }) => {
      test.setTimeout(300_000);
      await openApp(page);
      await waitForScene(page);
      await waitForBench(page);

      // Panneau : Atelier › Réglages, une feuille à droite sur toute la hauteur ; Sous le capot aussi.
      await quick(page).getByRole('button', { name: 'Atelier', exact: true }).tap();
      const dialog = page.getByRole('dialog', { name: 'Réglages' });
      await expect(dialog).toBeVisible();
      const sheet = await rectOf(page, 'dialog.sheet .card');
      expect(Math.abs(sheet.right - screen.width)).toBeLessThanOrEqual(1);
      expect(sheet.top).toBeLessThanOrEqual(1);
      expect(Math.abs(sheet.bottom - screen.height)).toBeLessThanOrEqual(1);
      expect(sheet.right - sheet.left).toBeLessThan(screen.width * 0.6);
      expect(sheet.right - sheet.left).toBeGreaterThan(screen.width * 0.35);
      expect(await smallTargets(page, 'dialog.sheet'), 'panneau : 48 px').toEqual([]);
      const back = await dialog.getByRole('button', { name: 'Retour à l’atelier' }).boundingBox();
      expect((back?.y ?? 0) + (back?.height ?? 0), 'Retour reste à l’écran').toBeLessThanOrEqual(screen.height);
      await page.getByRole('navigation', { name: 'Rubriques de l’atelier' }).getByRole('button', { name: 'Sous le capot', exact: true }).tap();
      const capot = page.getByRole('dialog', { name: 'Sous le capot' });
      await expect(capot).toBeVisible();
      for (const name of ['Retour à l’atelier', 'Mesurer', 'Comparer']) {
        const box = await capot.getByRole('button', { name }).boundingBox();
        expect(box, name).not.toBeNull();
        expect((box?.y ?? 0) + (box?.height ?? 0), `${name} reste à l’écran`).toBeLessThanOrEqual(screen.height);
        expect((box?.x ?? 0) + (box?.width ?? 0), `${name} reste à l’écran`).toBeLessThanOrEqual(screen.width);
      }
      await capot.getByRole('button', { name: 'Retour à l’atelier' }).tap();
      await expect(capot).toBeHidden();

      // Vue intérieure : le choix de la place en bas de la zone libre, ni sur le menu ni sur les boutons ronds.
      const withInterior = CATALOG.find((entry) => entry.interiorView);
      if (withInterior) {
        await chooseVehicle(page, withInterior.id);
        await quick(page).getByRole('button', { name: 'Intérieur', exact: true }).tap();
        await expect(stage(page)).toHaveAttribute('data-vue', 'interieur');
        const places = page.getByRole('group', { name: 'Ta place dans le véhicule' });
        await expect(places).toBeVisible();
        const group = await rectOf(page, '.places');
        expect(group.bottom).toBeLessThanOrEqual(screen.height);
        expect(group.top).toBeGreaterThan(screen.height * 0.5);
        expect(intersect(group, await rectOf(page, '.app > footer.dock')), 'places / menu').toBe(false);
        const buttons = quick(page).getByRole('button');
        for (let i = 0; i < (await buttons.count()); i += 1) {
          const box = await buttons.nth(i).boundingBox();
          if (box) expect(intersect(group, { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height }), `places / bouton rond ${i + 1}`).toBe(false);
        }
        expect(await smallTargets(page, '.places'), 'places : 48 px').toEqual([]);
        await quick(page).getByRole('button', { name: 'Sortir', exact: true }).tap();
        await expect(stage(page)).toHaveAttribute('data-vue', 'atelier');
      }

      // Mode photo : l'interface s'efface, une barre basse en une rangée, cadrages et boutons à 48 px.
      await quick(page).getByRole('button', { name: 'Photo', exact: true }).tap();
      const bar = page.locator('footer.photo-bar');
      await expect(bar).toBeVisible();
      const barRect = await rectOf(page, 'footer.photo-bar');
      expect(barRect.bottom).toBeLessThanOrEqual(screen.height + 1);
      expect(barRect.bottom - barRect.top, 'barre de photo : moins de la moitié de l’écran').toBeLessThan(screen.height * 0.5);
      expect(await smallTargets(page, 'footer.photo-bar'), 'photo : 48 px').toEqual([]);
      await expect(bar.getByRole('group', { name: 'Cadrages' }).getByRole('button')).toHaveCount(5);
      for (const name of ['Retour', 'Enregistrer']) {
        const box = await bar.getByRole('button', { name, exact: true }).boundingBox();
        expect((box?.x ?? 0) + (box?.width ?? 0), `${name} reste à l’écran`).toBeLessThanOrEqual(screen.width);
      }
      await bar.getByRole('button', { name: 'Retour', exact: true }).tap();
      await expect(sectionsNav(page)).toBeVisible();
    });
  });
}

test.describe('garage en paysage, tourner le téléphone', () => {
  test('portrait → paysage → portrait garde le niveau du menu, le panneau ouvert et la vue intérieure', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);
    await expect(dock(page)).toHaveAttribute('data-taille', 'compact');

    // Niveau du menu : la peinture, une zone.
    await openEntry(page, 'Peinture');
    const body = dock(page).locator('.dock-tab[data-onglet="peinture"]');
    await dock(page).getByRole('group', { name: 'Zones' }).getByRole('button').first().tap();
    await expect(dock(page).getByRole('group', { name: 'Couleurs' })).toBeVisible();
    const crumbs = (await dock(page).locator('.dock-crumbs').innerText()).replace(/\s+/g, ' ').trim();

    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('.app > footer.dock')).toHaveAttribute('data-taille', 'agrandi');
    expect(Math.abs((await rectOf(page, '.app > footer.dock')).right - 844)).toBeLessThanOrEqual(1);
    await expect(body).toBeVisible();
    await expect(dock(page).getByRole('group', { name: 'Couleurs' })).toBeVisible();
    expect((await dock(page).locator('.dock-crumbs').innerText()).replace(/\s+/g, ' ').trim()).toBe(crumbs);
    await expect(stage(page)).toHaveAttribute('data-vehicle', /.+/);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dock(page)).toHaveAttribute('data-taille', 'compact');
    await expect(body).toBeVisible();
    await expect(dock(page).getByRole('group', { name: 'Couleurs' })).toBeVisible();
    expect((await dock(page).locator('.dock-crumbs').innerText()).replace(/\s+/g, ' ').trim()).toBe(crumbs);

    // Panneau ouvert : il reste ouvert à la rotation, en bas puis sur le côté puis en bas.
    await quick(page).getByRole('button', { name: 'Atelier', exact: true }).tap();
    const dialog = page.getByRole('dialog', { name: 'Réglages' });
    await expect(dialog).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(dialog).toBeVisible();
    expect(Math.abs((await rectOf(page, 'dialog.sheet .card')).right - 844)).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toBeVisible();
    expect(Math.abs((await rectOf(page, 'dialog.sheet .card')).bottom - 844)).toBeLessThanOrEqual(1);
    await dialog.getByRole('button', { name: 'Retour à l’atelier' }).tap();
    await expect(dialog).toBeHidden();

    // Vue intérieure : elle reste la vue du moment.
    const withInterior = CATALOG.find((entry) => entry.interiorView);
    if (withInterior) {
      await chooseVehicle(page, withInterior.id);
      await quick(page).getByRole('button', { name: 'Intérieur', exact: true }).tap();
      await expect(stage(page)).toHaveAttribute('data-vue', 'interieur');
      await page.setViewportSize({ width: 844, height: 390 });
      await expect(stage(page)).toHaveAttribute('data-vue', 'interieur');
      await expect(page.getByRole('group', { name: 'Ta place dans le véhicule' })).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(stage(page)).toHaveAttribute('data-vue', 'interieur');
      await expect(page.getByRole('group', { name: 'Ta place dans le véhicule' })).toBeVisible();
      await quick(page).getByRole('button', { name: 'Sortir', exact: true }).tap();
    }
  });
});

test.describe('garage en paysage, cadrage par véhicule', () => {
  test.use({ viewport: SCREENS[0] });

  test('chaque véhicule est cadré entre les boutons ronds et le menu, sans être coupé ni recouvert', async ({ page }) => {
    test.setTimeout(480_000);
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);
    for (const entry of CATALOG) {
      await chooseVehicle(page, entry.id);
      const frame = await settledFrame(page);
      const menu = await rectOf(page, '.app > footer.dock');
      let railRight = 0;
      const buttons = quick(page).getByRole('button');
      for (let i = 0; i < (await buttons.count()); i += 1) {
        const box = await buttons.nth(i).boundingBox();
        railRight = Math.max(railRight, (box?.x ?? 0) + (box?.width ?? 0));
      }
      expect(frame.left, `${entry.id} : sur les boutons ronds`).toBeGreaterThanOrEqual(railRight);
      expect(frame.right, `${entry.id} : sous le menu`).toBeLessThanOrEqual(menu.left);
      const zone = menu.left - railRight;
      const share = (frame.right - frame.left) / zone;
      expect(share, `${entry.id} : ${Math.round(share * 100)} % de la zone libre`).toBeGreaterThan(0.6);
      expect(share).toBeLessThanOrEqual(0.9);
      expect(Math.abs((frame.left + frame.right) / 2 - (railRight + menu.left) / 2), `${entry.id} : centré dans la zone libre`).toBeLessThan(zone * 0.08);
      await expectNoOverlap(page, entry.id);
    }
  });
});

// Tourner le téléphone ne replace plus la caméra : la vue choisie au doigt (azimut, élévation, part du
// cadrage) est gardée, en atelier, après la vue intérieure et après le mode photo. La scène publie
// l'orbite dans data-orbite (azimut, élévation en degrés, part de la plage de zoom en %).

type Orbit = { azimuth: number; polar: number; share: number };

async function orbitOf(page: Page): Promise<Orbit | null> {
  const raw = await stage(page).getAttribute('data-orbite');
  if (!raw) return null;
  const [azimuth, polar, share] = raw.split(',').map(Number);
  if (azimuth === undefined || polar === undefined || share === undefined) return null;
  return { azimuth, polar, share };
}

/** Attend que l'orbite ne bouge plus (le rendu logiciel est lent) et la rend. */
async function settledOrbit(page: Page): Promise<Orbit> {
  // Trois lectures égales de suite, à 700 ms : en rendu logiciel sur une machine lente (la CI), une image
  // peut durer plus qu'un intervalle, et deux lectures égales ne prouvaient pas que la caméra était posée
  // (azimut lu en pleine transition, run du 18 novembre 2026).
  let last = '';
  let egales = 0;
  let orbit: Orbit | null = null;
  await expect
    .poll(
      async () => {
        orbit = await orbitOf(page);
        const key = JSON.stringify(orbit);
        egales = orbit !== null && key === last ? egales + 1 : 0;
        last = key;
        return egales;
      },
      { message: 'orbite posée', timeout: 60_000, intervals: [700] },
    )
    .toBeGreaterThanOrEqual(2);
  if (!orbit) throw new Error('pas d’orbite');
  return orbit;
}

/** Écart d'angle en degrés (azimut : sur le cercle). */
const gap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** Glissé au doigt dans la scène : tourne la vue, relève un peu la caméra. */
async function dragOrbit(page: Page, from: { x: number; y: number }, by: { dx: number; dy: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(from.x + (by.dx * step) / 10, from.y + (by.dy * step) / 10);
  await page.mouse.up();
}

function expectSameView(after: Orbit, before: Orbit, label: string): void {
  // 8° : la vue gardée se distingue sans peine d'une vue remise au départ (plus de 20° d'écart, vérifié
  // plus haut). Le report laisse 3° sur le poste et 4° sur la CI (18 novembre 2026) : cause non établie.
  expect(gap(after.azimuth, before.azimuth), `${label} : azimut`).toBeLessThanOrEqual(8);
  expect(Math.abs(after.polar - before.polar), `${label} : élévation`).toBeLessThanOrEqual(8);
}

test.describe('garage, tourner le téléphone garde la vue choisie au doigt', () => {
  test('atelier : portrait → paysage → portrait, même azimut, même élévation, véhicule entier dans la zone libre', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);
    const start = await settledOrbit(page);

    // Vue choisie au doigt, en portrait : tournée vers la droite, un peu relevée.
    await dragOrbit(page, { x: 120, y: 300 }, { dx: 150, dy: 40 });
    const chosen = await settledOrbit(page);
    expect(gap(chosen.azimuth, start.azimuth), 'le glissé a tourné la vue').toBeGreaterThan(20);

    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('.app > footer.dock')).toHaveAttribute('data-taille', 'agrandi');
    const sideways = await settledOrbit(page);
    expectSameView(sideways, chosen, 'paysage 844 × 390');
    // Le véhicule reste entier entre les boutons ronds et le menu.
    const frame = await settledFrame(page);
    const rail = await rectOf(page, 'nav.quick');
    const menu = await rectOf(page, '.app > footer.dock');
    expect(frame.left, 'à droite des boutons ronds').toBeGreaterThanOrEqual(rail.right - 2);
    expect(frame.right, 'à gauche du menu').toBeLessThanOrEqual(menu.left + 2);
    expect(frame.top, 'sous le haut de l’écran').toBeGreaterThanOrEqual(0);
    expect(frame.bottom, 'au-dessus du bas de l’écran').toBeLessThanOrEqual(390);

    // Une autre taille de paysage, puis le retour : toujours la même vue.
    await page.setViewportSize({ width: 780, height: 360 });
    expectSameView(await settledOrbit(page), chosen, 'paysage 780 × 360');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dock(page)).toHaveAttribute('data-taille', /compact|agrandi/);
    expectSameView(await settledOrbit(page), chosen, 'retour au portrait');
    const back = await settledFrame(page);
    expect(back.left).toBeGreaterThanOrEqual(-2);
    expect(back.right).toBeLessThanOrEqual(392);
  });

  test('vue intérieure puis mode photo : la vue d’atelier choisie est retrouvée après la rotation', async ({ page }) => {
    test.setTimeout(420_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);
    await dragOrbit(page, { x: 120, y: 300 }, { dx: -140, dy: -30 });
    const chosen = await settledOrbit(page);

    // Vue intérieure : on tourne le téléphone dedans, puis on sort en paysage.
    const withInterior = CATALOG.find((entry) => entry.interiorView);
    if (withInterior) {
      await chooseVehicle(page, withInterior.id);
      await dragOrbit(page, { x: 120, y: 300 }, { dx: -140, dy: -30 });
    }
    const beforeInterior = await settledOrbit(page);
    if (withInterior) {
      await quick(page).getByRole('button', { name: 'Intérieur', exact: true }).tap();
      await expect(stage(page)).toHaveAttribute('data-vue', 'interieur');
      await dragOrbit(page, { x: 100, y: 250 }, { dx: 120, dy: 20 });
      const gaze = await stage(page).getAttribute('data-regard');
      await page.setViewportSize({ width: 844, height: 390 });
      await expect(stage(page)).toHaveAttribute('data-vue', 'interieur');
      // Le regard au doigt est gardé (à quelques degrés près).
      await expect
        .poll(async () => {
          const [yaw, pitch] = ((await stage(page).getAttribute('data-regard')) ?? '').split(',').map(Number);
          const [yaw0, pitch0] = (gaze ?? '').split(',').map(Number);
          return Math.max(Math.abs((yaw ?? 999) - (yaw0 ?? 0)), Math.abs((pitch ?? 999) - (pitch0 ?? 0)));
        })
        .toBeLessThanOrEqual(4);
      await quick(page).getByRole('button', { name: 'Sortir', exact: true }).tap();
      await expect(stage(page)).toHaveAttribute('data-vue', 'atelier');
      expectSameView(await settledOrbit(page), beforeInterior, 'sortie de la vue intérieure en paysage');
      await page.setViewportSize({ width: 390, height: 844 });
      expectSameView(await settledOrbit(page), beforeInterior, 'retour au portrait');
    } else {
      expectSameView(beforeInterior, chosen, 'sans vue intérieure');
    }

    // Mode photo : entrée en paysage, retour à la vue choisie en sortant.
    await page.setViewportSize({ width: 844, height: 390 });
    expectSameView(await settledOrbit(page), beforeInterior, 'paysage avant la photo');
    await quick(page).getByRole('button', { name: 'Photo', exact: true }).tap();
    const bar = page.locator('footer.photo-bar');
    await expect(bar).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: 'Retour', exact: true }).tap();
    await expect(sectionsNav(page)).toBeVisible();
    expectSameView(await settledOrbit(page), beforeInterior, 'sortie du mode photo');
  });
});

// Ce qui n'avait jamais été regardé en paysage : la carte du tutoriel quand sa cible est en bas (le choix
// des places) et le message du cadenas de peinture. Dans la zone libre, ni sur le menu ni sur les boutons
// ronds, sans recouvrir la cible, boutons à 48 px, et tout reste à l'écran, même en texte très grand.
for (const screen of SCREENS) {
  test.describe(`garage en paysage, carte du tutoriel et message du cadenas, ${screen.width} × ${screen.height}`, () => {
    test.use({ viewport: { width: screen.width, height: screen.height } });

    for (const size of ['Normal', 'Très grand'] as const) {
      test(`la carte du choix des places ne recouvre pas les places (texte ${size.toLowerCase()})`, async ({ page }) => {
        test.setTimeout(300_000);
        await openApp(page);
        await waitForScene(page);
        await waitForBench(page);
        const withInterior = CATALOG.find((entry) => entry.interiorView);
        test.skip(!withInterior, 'aucun véhicule à vue intérieure');
        if (size !== 'Normal') await setTextSize(page, size);
        await quick(page).getByRole('button', { name: 'Intérieur', exact: true }).tap();
        await expect(stage(page)).toHaveAttribute('data-vue', 'interieur');
        await page.getByRole('button', { name: 'Aide' }).tap();
        const tuto = page.getByRole('dialog');
        await expect(tuto).toBeVisible();
        // Jusqu'à l'étape qui montre les places.
        for (let step = 0; step < 6 && !/place au pouce/i.test(await tuto.innerText()); step += 1) await tuto.getByRole('button', { name: /Suivant/ }).tap();
        await expect(tuto).toContainText('place au pouce');
        await expect(page.locator('.tuto-spot')).toBeVisible();
        // La cible (le halo), la carte, les boutons ronds et le menu : rien ne se recouvre.
        await expect.poll(async () => (await page.locator('.tuto-carte').first().boundingBox())?.y ?? 999).toBeLessThan(screen.height / 3);
        const spot = await rectOf(page, '.tuto-spot');
        const card = await rectOf(page, '.tuto-carte');
        const rail = await rectOf(page, 'nav.quick');
        const menu = await rectOf(page, '.app > footer.dock');
        expect(intersect(card, spot), `carte ${show(card)} / halo des places ${show(spot)}`).toBe(false);
        expect(card.left, 'carte à droite des boutons ronds').toBeGreaterThanOrEqual(rail.right - 1);
        expect(card.right, 'carte à gauche du menu').toBeLessThanOrEqual(menu.left + 1);
        expect(card.top).toBeGreaterThanOrEqual(0);
        expect(card.bottom).toBeLessThanOrEqual(screen.height);
        expect(await smallTargets(page, '.tuto-carte'), 'carte : 48 px').toEqual([]);
        // « Suivant » reste atteignable (au toucher), même quand le texte défile dans la carte.
        const next = tuto.getByRole('button', { name: /Suivant|C’est parti/ });
        const nextBox = await next.boundingBox();
        expect((nextBox?.y ?? 999) + (nextBox?.height ?? 0)).toBeLessThanOrEqual(screen.height);
        await tuto.getByRole('button', { name: /Passer|C’est parti/ }).first().tap();
      });
    }

    test('le message du cadenas de peinture se pose dans la zone libre, lisible, avec son bouton à 48 px', async ({ page }) => {
      test.setTimeout(300_000);
      await openApp(page);
      await waitForScene(page);
      await waitForBench(page);
      for (const size of ['Normal', 'Très grand'] as const) {
        if (size !== 'Normal') {
          await quick(page).getByRole('button', { name: 'Atelier', exact: true }).tap();
          const dialog = page.getByRole('dialog', { name: 'Réglages' });
          await dialog.getByRole('button', { name: 'Texte' }).click();
          await dialog.getByRole('button', { name: /^Très grand/ }).click();
          await dialog.getByRole('button', { name: 'Retour à l’atelier' }).click();
          await expect(dialog).toBeHidden();
        }
        await openEntry(page, 'Peinture');
        const paint = dock(page).locator('.paint');
        await expect(paint.locator('.paint-zone').first()).toBeVisible({ timeout: 120_000 });
        // La zone reste suivie (on n'ouvre son cadenas qu'à la fin) : le même appui montre le message aux deux tailles.
        await paint.locator('.paint-zone-pair').first().locator('.paint-zone').tap();
        await paint.getByRole('group', { name: 'Couleurs' }).getByRole('button', { name: 'Bleu nuit', exact: true }).tap({ force: true });
        const notice = page.locator('.paint-notice');
        await expect(notice).toContainText('Cette partie suit la carrosserie');
        const box = await rectOf(page, '.paint-notice');
        const rail = await rectOf(page, 'nav.quick');
        const menu = await rectOf(page, '.app > footer.dock');
        expect(box.left, `${size} : à droite des boutons ronds`).toBeGreaterThanOrEqual(rail.right - 1);
        expect(box.right, `${size} : à gauche du menu`).toBeLessThanOrEqual(menu.left + 1);
        expect(box.top, `${size} : le message reste à l'écran (haut)`).toBeGreaterThanOrEqual(0);
        expect(box.bottom, `${size} : le message reste à l'écran (bas)`).toBeLessThanOrEqual(screen.height);
        expect(box.bottom - box.top, `${size} : moins de la moitié de l'écran`).toBeLessThanOrEqual(screen.height * 0.5);
        expect(await smallTargets(page, '.paint-notice'), `${size} : 48 px`).toEqual([]);
        if (size === 'Très grand') {
          await notice.getByRole('button', { name: 'Ouvrir le cadenas', exact: true }).tap();
          await expect(notice).toHaveCount(0);
        }
      }
    });
  });
}
