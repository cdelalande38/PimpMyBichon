import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { backToSections, changedRatio, openApp, openEntry, readBuilds, reloadSaved, waitForBench, waitForScene, type SavedBuilds } from './helpers.ts';

// Stickers (§ 5.3, jalon 4) : choisir une zone, poser un motif de la bibliothèque, le déplacer au
// doigt, le colorer, recharger : il est toujours là. Pendant la pose, la caméra du garage montre la
// zone choisie en grand au-dessus du panneau (data-cadrage, data-zone-ecran, data-cadrage-libre), la
// rotation lente s'arrête ; en quittant les stickers, la caméra revient à sa vue d'avant. Un pack pas
// encore acheté se débloque sur place, un trophée pas encore gagné dit comment le gagner. Captures de
// revue : PMB_CAPTURES (dossier), sinon captures/stickers/.

const dock = (page: Page) => page.locator('footer.dock');
const stage = (page: Page) => page.locator('.stage');
const dir = process.env.PMB_CAPTURES ?? resolve('captures', 'stickers');

interface SavedLayer {
  motif: string;
  x: number;
  y: number;
  color: string;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

async function savedLayers(page: Page, vehicle: string, zone: string): Promise<SavedLayer[]> {
  const saved = (await readBuilds(page)) as { builds: Record<string, { stickers?: { layers: Record<string, SavedLayer[]> } }> } | null;
  return saved?.builds[vehicle]?.stickers?.layers[zone] ?? [];
}

async function rectOf(page: Page, name: 'zoneEcran' | 'cadrageLibre'): Promise<Rect> {
  const raw = await stage(page).evaluate((element, key) => (element as HTMLElement).dataset[key] ?? '', name);
  const [left, top, right, bottom] = raw.split(',').map(Number);
  if (![left, top, right, bottom].every((value) => Number.isFinite(value))) throw new Error(`${name} absent : « ${raw} »`);
  return { left: left!, top: top!, right: right!, bottom: bottom! };
}

/** Attend la zone cadrée (la transition finie) et vérifie qu'elle tient, en grand, dans la partie libre. */
async function expectFramed(page: Page, zone: string): Promise<{ frame: Rect; free: Rect }> {
  await expect(stage(page)).toHaveAttribute('data-cadrage', zone, { timeout: 30_000 });
  let frame: Rect | null = null;
  let free: Rect | null = null;
  await expect
    .poll(
      async () => {
        frame = await rectOf(page, 'zoneEcran').catch(() => null);
        free = await rectOf(page, 'cadrageLibre').catch(() => null);
        const top = await dock(page).evaluate((element) => Math.round(element.getBoundingClientRect().top));
        return frame !== null && free !== null && Math.abs(free.bottom - top) <= 8;
      },
      { message: `${zone} cadrée au-dessus du panneau`, timeout: 30_000, intervals: [300] },
    )
    .toBe(true);
  const f = frame as unknown as Rect;
  const l = free as unknown as Rect;
  expect(f.left, `${zone} : à gauche de la partie libre`).toBeGreaterThanOrEqual(l.left - 2);
  expect(f.right, `${zone} : à droite`).toBeLessThanOrEqual(l.right + 2);
  expect(f.top, `${zone} : en haut`).toBeGreaterThanOrEqual(l.top - 2);
  expect(f.bottom, `${zone} : sous le panneau`).toBeLessThanOrEqual(l.bottom + 2);
  // En grand : la zone seule (sans sa marge) remplit plus du tiers de la partie libre dans un sens au moins.
  const fill = Math.max((f.right - f.left) / (l.right - l.left), (f.bottom - f.top) / (l.bottom - l.top));
  expect(fill, `${zone} : ${Math.round(fill * 100)} % de la partie libre`).toBeGreaterThan(0.36);
  return { frame: f, free: l };
}

async function chooseVehicle(page: Page, id: string): Promise<void> {
  if ((await stage(page).getAttribute('data-vehicle')) === id) return;
  await openEntry(page, 'Véhicule');
  await dock(page).getByRole('group', { name: 'Véhicule' }).locator(`[data-vehicle="${id}"]`).tap();
  await expect(stage(page)).toHaveAttribute('data-vehicle', id);
  await waitForBench(page);
}

/** Sauvegarde du jeu posée avant l'ouverture (comme tests/e2e/jeu.spec.ts), puis rechargée. */
async function poserJeu(page: Page, etat: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const transaction = open.result.transaction('kv', 'readwrite');
          transaction.objectStore('kv').put(JSON.stringify({ state: value, version: 1 }), 'pmb-jeu');
          transaction.oncomplete = () => done();
          transaction.onerror = () => fail(transaction.error);
        };
      }),
    etat,
  );
  await reloadSaved(page);
  await waitForScene(page);
}

const images = (page: Page) => page.evaluate(() => (globalThis as { __pmbImagesGarage?: number }).__pmbImagesGarage ?? 0);

/** Attend que le garage ne dessine plus rien (rendu à la demande au repos). */
async function quiet(page: Page): Promise<void> {
  // Deux fenêtres de suite sans image ni déplacement de caméra : sur une machine chargée, en rendu
  // logiciel, une seule image peut prendre plusieurs secondes, et une fenêtre vide ne prouve rien.
  let calmes = 0;
  await expect
    .poll(
      async () => {
        const a = await images(page);
        const camera = await stage(page).getAttribute('data-camera');
        await page.waitForTimeout(3000);
        const calme = (await images(page)) - a === 0 && (await stage(page).getAttribute('data-camera')) === camera;
        calmes = calme ? calmes + 1 : 0;
        return calmes;
      },
      { message: 'rendu au repos', timeout: 120_000, intervals: [200] },
    )
    .toBeGreaterThanOrEqual(2);
}

/** Les véhicules du catalogue qui ont leur modèle (substituts produits par npm run vehicles:build). */
const DIR = new URL('../../public/assets/vehicles/', import.meta.url);
const VEHICLES: string[] = readdirSync(DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/vehicle.json`, DIR)))
  .map((entry) => JSON.parse(readFileSync(new URL(`${entry.name}/vehicle.json`, DIR), 'utf8')) as { id: string; glb: string })
  .filter((entry) => existsSync(new URL(`${entry.id}/${entry.glb}`, DIR)))
  .map((entry) => entry.id);

test('stickers : la zone cadrée, poser, déplacer, colorer, revenir à la vue d’avant, recharger', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(dir, { recursive: true });
  // Sauvegarde neuve : le pack Flammes n'est ni acheté, ni gagné (src/data/boutique.ts) ; solde nul.
  await openApp(page);
  await waitForBench(page);
  const vehicle = await stage(page).getAttribute('data-vehicle');
  expect(vehicle).toBeTruthy();
  const camera = await stage(page).getAttribute('data-camera');
  const before = (await stage(page).getAttribute('data-vehicule-largeur'))?.split(',').map(Number) ?? [];

  // L'entrée ouvre la première zone (les flancs, en symétrie) : la caméra la cadre au-dessus du panneau.
  await openEntry(page, 'Stickers');
  const zones = dock(page).getByRole('group', { name: 'Zones de stickers' });
  await expect(zones).toBeVisible();
  const panel = dock(page).locator('.stickers');
  const zone = await panel.getAttribute('data-zone');
  expect(zone).toBeTruthy();
  await expect(zones.getByRole('button', { name: /Symétrie/ })).toHaveAttribute('aria-pressed', 'true');
  const { frame } = await expectFramed(page, zone!);
  // Plus grand qu'avant : de profil, le flanc est plus large que tout le véhicule de trois quarts.
  expect(frame.right - frame.left, 'flanc plus large que le véhicule de départ').toBeGreaterThan(((before[1] ?? 0) - (before[0] ?? 0)) * 1.04);
  await page.screenshot({ path: resolve(dir, '01-zones.png') });

  // Bibliothèque : le pack Flammes, non acheté, se débloque sur place ; sans dollars, le bloc d'achat dit ce qui manque.
  await dock(page).getByRole('button', { name: 'Ajouter un sticker' }).tap();
  const library = dock(page).locator('[data-bibliotheque]');
  await expect(library).toBeVisible();
  await library.getByRole('group', { name: 'Packs de stickers' }).getByRole('button', { name: 'Flammes' }).tap();
  const offer = library.locator('.stk-offer');
  await expect(offer).toContainText('Pack Flammes');
  const locked = library.locator('.stk-tile[data-verrou="ferme"]').first();
  await expect(locked).toBeVisible();
  await locked.tap();
  const achat = dock(page).locator('.jeu-achat');
  await expect(achat).toHaveAttribute('data-etat', 'insuffisant');
  await expect(achat).toContainText('Il te manque');
  await expect(achat).toContainText('Pack Flammes');
  await page.screenshot({ path: resolve(dir, '02-bibliotheque-achat.png') });
  await achat.getByRole('button', { name: 'Compris' }).tap();
  await expect(achat).toHaveCount(0);
  // Trophées : un par haut fait, chacun dit comment le gagner.
  await library.getByRole('group', { name: 'Packs de stickers' }).getByRole('button', { name: 'Trophées' }).tap();
  const trophees = library.getByRole('list', { name: 'Trophées' });
  await expect(trophees.locator('.stk-trophee').first()).toContainText('Pour le gagner :');
  await expect(trophees.locator('[data-motif="trophee-or"]')).toContainText('médaille d’or');
  for (const button of await library.locator('button:visible').all()) {
    const box = await button.boundingBox();
    expect(Math.round(box?.height ?? 0), `${await button.innerText()} : 48 px au doigt`).toBeGreaterThanOrEqual(48);
  }

  // Pack Départ, offert : le rond n° 7 se pose au centre, choisi, avec sa poignée.
  await library.getByRole('group', { name: 'Packs de stickers' }).getByRole('button', { name: 'Départ' }).tap();
  await library.locator('[data-motif="numero-rond-7"]').tap();
  const layer = dock(page).locator('.stk-layer[data-calque="0"]');
  await expect(layer).toHaveAttribute('aria-pressed', 'true');
  await expect(dock(page).locator('[data-poignee]')).toBeVisible();
  await expect.poll(async () => (await savedLayers(page, vehicle!, zone!)).length).toBe(1);
  // Le panneau a grandi (gestes, couleurs) : la zone se recadre au-dessus de lui.
  await expectFramed(page, zone!);

  // Déplacé au doigt (glissé), puis coloré : la caisse suit pendant le geste, le rendu se réveille.
  const box = await layer.boundingBox();
  if (!box) throw new Error('sticker introuvable');
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const still = await images(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) await page.mouse.move(start.x + step * 12, start.y - step * 2);
  await expect.poll(async () => (await images(page)) - still, { message: 'images dessinées pendant le glissé' }).toBeGreaterThan(0);
  await page.mouse.up();
  await expect.poll(async () => (await savedLayers(page, vehicle!, zone!))[0]?.x ?? 0).toBeGreaterThan(0.55);
  await dock(page).getByRole('group', { name: 'Couleur du sticker' }).getByRole('button', { name: 'Orange piste' }).tap();
  await expect.poll(async () => (await savedLayers(page, vehicle!, zone!))[0]?.color).toBe('#ff6a00');
  await expect(stage(page)).toHaveAttribute('data-bench', 'pret');
  // Puis il se tait : plus aucune image tant que rien ne bouge (ni rotation lente, ni transition).
  await quiet(page);
  await page.screenshot({ path: resolve(dir, '03-pose-flanc.png') });

  // En quittant les stickers, la caméra revient à sa vue d'avant.
  await backToSections(page);
  await expect(stage(page)).not.toHaveAttribute('data-cadrage', /.+/);
  await expect(stage(page)).toHaveAttribute('data-camera', camera!);

  // Rechargé : le sticker est toujours là, à sa place et de sa couleur.
  const kept = (await savedLayers(page, vehicle!, zone!))[0];
  await reloadSaved(page);
  await waitForBench(page);
  const after = await savedLayers(page, vehicle!, zone!);
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({ motif: 'numero-rond-7', color: '#ff6a00' });
  expect(after[0]?.x).toBeCloseTo(kept?.x ?? 0, 5);
  await openEntry(page, 'Stickers');
  await expect(dock(page).locator('.stk-layer[data-calque="0"]')).toBeVisible();

  // Tous les gestes se voient sans faire défiler de côté (« Supprimer » était hors de l'écran), et
  // « Supprimer » retire le sticker.
  await dock(page).locator('.stk-layer[data-calque="0"]').tap();
  const gestes = dock(page).getByRole('group', { name: 'Gestes sur le sticker' });
  await gestes.scrollIntoViewIfNeeded();
  for (const nom of ['Retourner', 'Dupliquer', 'Devant', 'Derrière', 'Supprimer', 'Curseurs']) {
    await expect(gestes.getByRole('button', { name: nom, exact: true })).toBeInViewport({ ratio: 1 });
  }
  await page.screenshot({ path: resolve(dir, '04-gestes.png') });
  await gestes.getByRole('button', { name: 'Supprimer', exact: true }).tap();
  await expect.poll(async () => (await savedLayers(page, vehicle!, zone!)).length).toBe(0);
});

test('stickers : chaque zone d’une voiture et d’une moto cadrée, pack acheté sur place, trophée gagné', async ({ page }) => {
  test.setTimeout(420_000);
  mkdirSync(dir, { recursive: true });
  await openApp(page);
  await waitForScene(page);
  // 200 $ en poche, le trophée d'or déjà gagné.
  await poserJeu(page, { solde: 200, articles: { 'sticker-trophee-or': true }, hautsFaits: { 'premier-or': true }, cumuls: { courses: 3, or: 1 } });
  await waitForBench(page);

  let shot = 4;
  for (const id of ['cox', 'bobber']) {
    await chooseVehicle(page, id);
    await openEntry(page, 'Stickers');
    const zones = dock(page).getByRole('group', { name: 'Zones de stickers' });
    const labels = (await zones.getByRole('button').allInnerTexts()).map((text) => text.split('\n')[0]!.trim()).filter((text) => !/Symétrie/i.test(text));
    expect(labels.length).toBeGreaterThan(1);
    for (const label of labels) {
      await zones.getByRole('button', { name: label, exact: true }).tap();
      const zone = await dock(page).locator('.stickers').getAttribute('data-zone');
      await expectFramed(page, zone!);
      await page.screenshot({ path: resolve(dir, `${String(shot).padStart(2, '0')}-${id}-${zone}.png`) });
      shot += 1;
    }
    if (id === 'cox') {
      // Symétrie coupée : le flanc droit se cadre de son côté, l'autre côté de la pièce.
      await zones.getByRole('button', { name: /Flancs/ }).tap();
      await expectFramed(page, 'flanc_gauche');
      const left = Number((await stage(page).getAttribute('data-orbite'))?.split(',')[0]);
      await zones.getByRole('button', { name: /Symétrie/ }).tap();
      await zones.getByRole('button', { name: 'Flanc droit', exact: true }).tap();
      await expectFramed(page, 'flanc_droit');
      const right = Number((await stage(page).getAttribute('data-orbite'))?.split(',')[0]);
      expect(Math.abs(((left - right + 540) % 360) - 180), 'flancs vus de part et d’autre').toBeGreaterThan(150);
      await zones.getByRole('button', { name: /Symétrie/ }).tap();

      // Pack Flammes acheté sur place : ses motifs se posent aussitôt.
      await dock(page).getByRole('button', { name: 'Ajouter un sticker' }).tap();
      const library = dock(page).locator('[data-bibliotheque]');
      await library.getByRole('group', { name: 'Packs de stickers' }).getByRole('button', { name: 'Flammes' }).tap();
      await library.locator('.stk-offer').tap();
      const achat = dock(page).locator('.jeu-achat');
      await expect(achat).toHaveAttribute('data-etat', 'confirmation');
      await achat.getByRole('button', { name: 'Acheter' }).tap();
      await expect(dock(page).locator('.stk-notice')).toContainText('Pack Flammes débloqué');
      await expect(library.locator('.stk-tile[data-verrou="ferme"]')).toHaveCount(0);
      await expect(library.locator('.stk-offer')).toHaveCount(0);
      // Le trophée d'or, gagné, se pose ; les autres disent comment les gagner.
      await library.getByRole('group', { name: 'Packs de stickers' }).getByRole('button', { name: 'Trophées' }).tap();
      await expect(library.locator('[data-motif="trophee-or"]')).not.toHaveAttribute('data-verrou', /.*/);
      await expect(library.locator('.stk-trophee[data-verrou="ferme"]').first()).toContainText('Pour le gagner :');
      await page.screenshot({ path: resolve(dir, `${String(shot).padStart(2, '0')}-trophees.png`) });
      shot += 1;
      await library.locator('[data-motif="trophee-or"]').tap();
      await expect(dock(page).locator('.stk-layer').first()).toBeVisible();
    }
  }
});

/** Colonne des boutons ronds à droite (portrait) : son bord gauche et son bas. */
async function rail(page: Page): Promise<{ left: number; bottom: number }> {
  return page.locator('header.hud nav.quick').evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, bottom: box.bottom };
  });
}

test('stickers : en portrait, la colonne des boutons ronds ne recouvre aucune zone cadrée, sur chaque véhicule', async ({ page }) => {
  test.setTimeout(600_000);
  await openApp(page);
  await waitForBench(page);
  const mesures: string[] = [];
  for (const id of VEHICLES) {
    await chooseVehicle(page, id);
    await openEntry(page, 'Stickers');
    const zones = dock(page).getByRole('group', { name: 'Zones de stickers' });
    const labels = (await zones.getByRole('button').allInnerTexts()).map((text) => text.split('\n')[0]!.trim()).filter((text) => !/Symétrie/i.test(text));
    for (const label of labels) {
      await zones.getByRole('button', { name: label, exact: true }).tap();
      const zone = await dock(page).locator('.stickers').getAttribute('data-zone');
      const { frame } = await expectFramed(page, zone!);
      const column = await rail(page);
      mesures.push(`${id}/${zone} : zone ${Math.round(frame.left)}-${Math.round(frame.right)} × ${Math.round(frame.top)}-${Math.round(frame.bottom)}, colonne à partir de x = ${Math.round(column.left)} jusqu'à y = ${Math.round(column.bottom)}`);
      // Ni sous la colonne (à droite d'elle et à sa hauteur), ni à moins de quelques pixels d'elle.
      const sous = frame.right > column.left - 6 && frame.top < column.bottom + 6;
      expect(sous, mesures.at(-1)).toBe(false);
    }
    await backToSections(page);
  }
  console.log(mesures.join('\n'));
});

/** Réécrit la sauvegarde des builds avec le build d'un véhicule modifié (les autres champs sont gardés), puis relance l'app. */
async function ecrireBuild(page: Page, vehicle: string, change: (build: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const saved = ((await readBuilds(page)) ?? { current: null, builds: {}, recents: [] }) as SavedBuilds;
  const next = { ...saved, current: vehicle, builds: { ...saved.builds, [vehicle]: change({ paints: {}, ...saved.builds[vehicle] }) } };
  await page.evaluate(
    (value) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const transaction = open.result.transaction('kv', 'readwrite');
          transaction.objectStore('kv').put(JSON.stringify({ state: value, version: 1 }), 'pmb-builds');
          transaction.oncomplete = () => done();
          transaction.onerror = () => fail(transaction.error);
        };
      }),
    next,
  );
  await reloadSaved(page);
  await waitForBench(page);
}

/** Pose un motif par la bibliothèque (pack Départ, offert) et rend la couleur que le calque reçoit. */
async function poserEtLireCouleur(page: Page, vehicle: string, zone: string): Promise<string> {
  const avant = (await savedLayers(page, vehicle, zone)).length;
  await dock(page).getByRole('button', { name: 'Ajouter un sticker' }).tap();
  await dock(page).locator('[data-bibliotheque] [data-motif="numero-rond-7"]').tap();
  await expect.poll(async () => (await savedLayers(page, vehicle, zone)).length).toBe(avant + 1);
  return (await savedLayers(page, vehicle, zone)).at(-1)!.color;
}

test('stickers : la couleur de départ se détache de la peinture (blanc sur le sombre, noir sur le clair), les stickers déjà posés ne changent pas', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(dir, { recursive: true });
  await openApp(page);
  await waitForBench(page);
  // Le van d'origine est blanc : un sticker blanc ne s'y verrait pas, il part en noir.
  await chooseVehicle(page, 'van');
  await openEntry(page, 'Stickers');
  const zone = (await dock(page).locator('.stickers').getAttribute('data-zone'))!;
  expect(await poserEtLireCouleur(page, 'van', zone)).toBe('#0b0b0e');
  await backToSections(page);
  // Le même van repeint en noir : le prochain sticker part en blanc, le premier reste noir.
  await ecrireBuild(page, 'van', (build) => ({ ...build, paints: { ...(build.paints as object), carrosserie: { color: '#0b0b0e' } } }));
  await openEntry(page, 'Stickers');
  expect(await poserEtLireCouleur(page, 'van', zone)).toBe('#f4f1ea');
  const posees = await savedLayers(page, 'van', zone);
  expect(posees.map((item) => item.color)).toEqual(['#0b0b0e', '#f4f1ea']);
  await page.screenshot({ path: resolve(dir, 'couleur-depart-van-noir.png') });
});

interface SeedLayer {
  motif: string;
  x: number;
  y: number;
  size: number;
  rotation?: number;
  flip?: boolean;
  color?: string;
}

/** Écrit des calques dans la sauvegarde d'un véhicule (sans passer par l'interface), puis relance l'app. */
async function poserCalques(page: Page, vehicle: string, layers: Record<string, SeedLayer[]>): Promise<void> {
  const stickers = {
    layers: Object.fromEntries(Object.entries(layers).map(([zone, list]) => [zone, list.map((item) => ({ rotation: 0, flip: false, color: '#f4f1ea', opacity: 1, ...item }))])),
    mirror: false,
  };
  await ecrireBuild(page, vehicle, (build) => ({ ...build, stickers }));
}

// Captures de revue de la vague U (à la demande : PMB_CAPTURES_STICKERS = dossier de sortie) : des motifs
// posés sur chaque véhicule, la bibliothèque aux sept onglets, le garde-boue avant du bobber.
// PMB_REVUE_VEHICULES=bobber,van : ne refaire que ces véhicules.
const revue = process.env.PMB_CAPTURES_STICKERS;
test('stickers : captures de revue de la vague U (sur demande)', async ({ page }) => {
  test.skip(!revue, 'captures de revue : définir PMB_CAPTURES_STICKERS');
  test.setTimeout(900_000);
  const sortie = revue!;
  mkdirSync(sortie, { recursive: true });
  const orange = '#ff6a00';
  const seulement = process.env.PMB_REVUE_VEHICULES?.split(',');
  const voulu = (id: string) => !seulement || seulement.includes(id);
  const cadrer = async (zone: string, label: string, nom: string) => {
    await openEntry(page, 'Stickers');
    const zones = dock(page).getByRole('group', { name: 'Zones de stickers' });
    await zones.getByRole('button', { name: label }).first().tap();
    await expectFramed(page, zone);
    await quiet(page);
    await page.screenshot({ path: resolve(sortie, nom) });
  };
  await openApp(page);
  await waitForScene(page);
  await poserJeu(page, { solde: 5000, articles: { 'pack-flammes': true, 'pack-course': true, 'pack-atelier': true, 'pack-rue': true, 'pack-tapis': true }, hautsFaits: {}, cumuls: {} });
  await waitForBench(page);

  if (voulu('cox')) {
    await chooseVehicle(page, 'cox');
    await poserCalques(page, 'cox', {
      flanc_gauche: [
        { motif: 'bande-fleche-rallye', x: 0.5, y: 0.16, size: 0.2 },
        { motif: 'sponsor-joint-claque', x: 0.2, y: 0.58, size: 0.34, color: orange },
        { motif: 'numero-hexagone-36', x: 0.5, y: 0.6, size: 0.56 },
        { motif: 'drapeaux-croises', x: 0.8, y: 0.6, size: 0.5 },
      ],
    });
    await cadrer('flanc_gauche', 'Flanc gauche', 'pose-cox-flanc.png');
  }

  if (voulu('van')) {
    await chooseVehicle(page, 'van');
    await poserCalques(page, 'van', {
      flanc_gauche: [
        { motif: 'soleil-retro', x: 0.2, y: 0.55, size: 0.9, color: orange },
        { motif: 'vagues-bandeau', x: 0.55, y: 0.18, size: 0.3, color: '#132a72' },
        { motif: 'sponsor-ecrou-fou', x: 0.62, y: 0.6, size: 0.48, color: '#0b0b0e' },
        { motif: 'des-paire', x: 0.88, y: 0.6, size: 0.5, color: '#b0121c' },
      ],
    });
    await cadrer('flanc_gauche', 'Flanc gauche', 'pose-van-flanc.png');
  }

  if (voulu('bobber')) {
    await chooseVehicle(page, 'bobber');
    await poserCalques(page, 'bobber', {
      garde_boue_avant: [{ motif: 'etincelles', x: 0.5, y: 0.55, size: 0.12, color: orange }],
      garde_boue: [{ motif: 'cartes-enseignes', x: 0.5, y: 0.5, size: 0.14, color: orange }],
      reservoir_gauche: [{ motif: 'carte-as-pique', x: 0.5, y: 0.5, size: 0.24, color: '#f4f1ea' }],
    });
    await cadrer('garde_boue_avant', 'Garde-boue avant', 'pose-bobber-garde-boue-avant.png');
    await cadrer('garde_boue', 'Garde-boue arrière', 'pose-bobber-garde-boue-arriere.png');
  }

  if (voulu('sportive')) {
    await chooseVehicle(page, 'sportive');
    await poserCalques(page, 'sportive', {
      reservoir: [{ motif: 'engrenage', x: 0.5, y: 0.5, size: 0.3, color: '#0b0b0e' }],
      flanc_gauche: [{ motif: 'numero-carre-5', x: 0.55, y: 0.5, size: 0.34, color: '#0b0b0e' }],
    });
    await cadrer('flanc_gauche', 'Flanc gauche', 'pose-sportive-flanc.png');
  }

  // Tous les motifs de la vague U posés sur les flancs du van (blanc, seize par zone) : lisibles de près, en
  // grande densité (PMB_DSF=2 pour les voir de plus près). Seul 'planche' dans PMB_REVUE_VEHICULES les refait.
  if (seulement?.includes('planche')) {
    const nouveaux = (process.env.PMB_NOUVEAUX_MOTIFS ?? '').split(' ').filter(Boolean);
    const ratios = new Map<string, number>(JSON.parse(process.env.PMB_RATIOS_MOTIFS ?? '[]') as [string, number][]);
    const cellule = (motif: string, index: number): SeedLayer => {
      const colonne = index % 8;
      const rang = Math.floor(index / 8);
      const ratio = ratios.get(motif) ?? 1;
      return { motif, x: (colonne + 0.5) / 8, y: rang === 0 ? 0.72 : 0.28, size: Math.min(0.58 / ratio, 0.6), color: '#0b0b0e' };
    };
    await chooseVehicle(page, 'van');
    await poserCalques(page, 'van', {
      flanc_gauche: nouveaux.slice(0, 16).map(cellule),
      flanc_droit: nouveaux.slice(16, 32).map(cellule),
      face_avant: nouveaux.slice(32).map((motif, index) => ({ ...cellule(motif, index), y: 0.5, x: (index + 0.5) / Math.max(nouveaux.length - 32, 1) })),
    });
    for (const [zone, label, nom] of [['flanc_gauche', 'Flanc gauche', 'planche-van-gauche.png'], ['flanc_droit', 'Flanc droit', 'planche-van-droite.png']] as const) {
      await openEntry(page, 'Stickers');
      await dock(page).getByRole('group', { name: 'Zones de stickers' }).getByRole('button', { name: label, exact: true }).tap();
      const { frame } = await expectFramed(page, zone);
      await quiet(page);
      await page.screenshot({ path: resolve(sortie, nom), clip: { x: Math.max(0, frame.left - 6), y: Math.max(0, frame.top - 6), width: Math.min(390, frame.right - frame.left + 12), height: frame.bottom - frame.top + 12 } });
      await backToSections(page);
    }
  }

  // Bibliothèque : l'onglet Atelier (vingt motifs), puis les trophées.
  await openEntry(page, 'Stickers');
  await dock(page).getByRole('button', { name: 'Ajouter un sticker' }).tap();
  const bibliotheque = dock(page).locator('[data-bibliotheque]');
  await bibliotheque.getByRole('group', { name: 'Packs de stickers' }).getByRole('button', { name: 'Atelier' }).tap();
  await page.screenshot({ path: resolve(sortie, 'bibliotheque-atelier.png') });
  await bibliotheque.getByRole('group', { name: 'Packs de stickers' }).getByRole('button', { name: 'Trophées' }).tap();
  await page.screenshot({ path: resolve(sortie, 'bibliotheque-trophees.png') });
});

test.describe('stickers en paysage', () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test('le panneau à droite, la zone cadrée à sa gauche ; la vue d’atelier revient en sortant', async ({ page }) => {
    test.setTimeout(240_000);
    mkdirSync(dir, { recursive: true });
    await openApp(page);
    await waitForBench(page);
    const camera = await stage(page).getAttribute('data-camera');
    await openEntry(page, 'Stickers');
    const zone = await dock(page).locator('.stickers').getAttribute('data-zone');
    await expect(stage(page)).toHaveAttribute('data-cadrage', zone!, { timeout: 30_000 });
    let frame: Rect | null = null;
    await expect
      .poll(async () => {
        frame = await rectOf(page, 'zoneEcran').catch(() => null);
        return frame !== null;
      })
      .toBe(true);
    const menu = await dock(page).evaluate((element) => element.getBoundingClientRect().left);
    const f = frame as unknown as Rect;
    expect(f.right, 'à gauche du menu').toBeLessThanOrEqual(menu + 2);
    expect(f.left).toBeGreaterThanOrEqual(0);
    expect((f.right - f.left) / menu, 'en grand dans la partie gauche').toBeGreaterThan(0.6);
    await page.screenshot({ path: resolve(dir, '11-paysage.png') });
    await backToSections(page);
    await expect(stage(page)).not.toHaveAttribute('data-cadrage', /.+/);
    await expect(stage(page)).toHaveAttribute('data-camera', camera!);
  });
});

test('stickers : sur chaque véhicule, la caisse suit le sticker déplacé, tourné, agrandi, puis le rendu se tait', async ({ page }) => {
  test.setTimeout(600_000);
  expect(VEHICLES.length).toBeGreaterThanOrEqual(5);
  await openApp(page);
  await waitForBench(page);
  for (const id of VEHICLES) {
    await chooseVehicle(page, id);
    await openEntry(page, 'Stickers');
    const zone = await dock(page).locator('.stickers').getAttribute('data-zone');
    await dock(page).getByRole('button', { name: 'Ajouter un sticker' }).tap();
    await dock(page).locator('[data-bibliotheque] [data-motif="numero-rond-7"]').tap();
    const layer = dock(page).locator('.stk-layer').last();
    await expect(layer).toHaveAttribute('aria-pressed', 'true');
    // Une couleur qui tranche (le blanc de départ ne se voit pas sur un van blanc).
    await dock(page).getByRole('group', { name: 'Couleur du sticker' }).getByRole('button', { name: 'Orange piste' }).tap();
    const { frame } = await expectFramed(page, zone!);
    const clip = { x: Math.max(0, frame.left - 4), y: Math.max(0, frame.top - 4), width: frame.right - frame.left + 8, height: frame.bottom - frame.top + 8 };
    await quiet(page);
    const before = await page.screenshot({ clip });

    // Déplacer : la caisse change pendant le glissé (le rendu se réveille), puis se tait.
    const box = await layer.boundingBox();
    if (!box) throw new Error(`${id} : sticker introuvable`);
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const asleep = await images(page);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= 5; step += 1) await page.mouse.move(start.x - step * 8, start.y + step * 2);
    await expect.poll(async () => (await images(page)) - asleep, { message: `${id} : images pendant le glissé` }).toBeGreaterThan(0);
    await page.mouse.up();
    await quiet(page);
    const moved = await page.screenshot({ clip });
    expect(await changedRatio(before, moved), `${id} › ${zone} : la caisse suit le déplacement`).toBeGreaterThan(0.002);

    // Tourner et agrandir à la poignée.
    const handle = dock(page).locator('[data-poignee]');
    const grip = await handle.boundingBox();
    if (!grip) throw new Error(`${id} : poignée introuvable`);
    const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 5; step += 1) await page.mouse.move(from.x + step * 5, from.y + step * 7);
    await page.mouse.up();
    await quiet(page);
    const turned = await page.screenshot({ clip });
    expect(await changedRatio(moved, turned), `${id} › ${zone} : la caisse suit la poignée`).toBeGreaterThan(0.002);
    await backToSections(page);
    await expect(stage(page)).not.toHaveAttribute('data-cadrage', /.+/);
  }
});

test('stickers, avec le mouvement : la rotation lente s’arrête, la caméra glisse jusqu’à la zone, puis revient à la vue d’avant', async ({ page }) => {
  test.setTimeout(240_000);
  await openApp(page);
  await waitForBench(page);
  // Rotation lente permise (les parcours tournent d'ordinaire en mouvement réduit).
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const first = await stage(page).getAttribute('data-camera');
  await expect.poll(() => stage(page).getAttribute('data-camera'), { message: 'rotation lente', timeout: 30_000 }).not.toBe(first);
  // Journal de la scène : chaque pose de caméra et chaque étape du cadrage, dans l'ordre.
  await stage(page).evaluate((element) => {
    const log: string[] = [];
    (window as unknown as { __journal: string[] }).__journal = log;
    new MutationObserver((records) => {
      for (const record of records) {
        const value = element.getAttribute(record.attributeName ?? '');
        log.push(`${record.attributeName}=${value ?? ''}`);
      }
    }).observe(element, { attributes: true, attributeFilter: ['data-camera', 'data-cadrage'] });
  });
  const journal = () => page.evaluate(() => (window as unknown as { __journal: string[] }).__journal.slice());

  await openEntry(page, 'Stickers');
  const zone = await dock(page).locator('.stickers').getAttribute('data-zone');
  await expectFramed(page, zone!);
  // Arrivée en douceur (une transition), puis plus rien ne bouge : ni rotation, ni image.
  const entering = await journal();
  const start = entering.indexOf('data-cadrage=transition');
  expect(start, 'transition d’entrée').toBeGreaterThan(0);
  expect(entering.slice(start).filter((line) => line.startsWith('data-camera=')).length, 'la caméra se déplace').toBeGreaterThan(0);
  const opened = entering.slice(0, start).filter((line) => line.startsWith('data-camera=')).pop()!.slice('data-camera='.length);
  await quiet(page);
  const held = await stage(page).getAttribute('data-camera');
  await page.waitForTimeout(1500);
  await expect(stage(page)).toHaveAttribute('data-camera', held!);

  // Retour : la caméra glisse jusqu'à la vue laissée en ouvrant les stickers, puis la rotation reprend.
  await backToSections(page);
  await expect(stage(page)).not.toHaveAttribute('data-cadrage', /.+/, { timeout: 30_000 });
  const leaving = await journal();
  const back = leaving.lastIndexOf('data-cadrage=transition');
  const end = leaving.indexOf('data-cadrage=', back + 1);
  expect(back).toBeGreaterThan(start);
  const returned = leaving.slice(end).find((line) => line.startsWith('data-camera='))!.slice('data-camera='.length);
  const [a, b] = [opened, returned].map((value) => value.split(',').map(Number));
  for (let i = 0; i < 3; i += 1) expect(Math.abs(a![i]! - b![i]!), `vue d’avant, axe ${i} (${opened} → ${returned})`).toBeLessThanOrEqual(10);
  await expect.poll(() => stage(page).getAttribute('data-camera'), { message: 'la rotation reprend', timeout: 30_000 }).not.toBe(returned);
});
