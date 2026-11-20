// Fonds des écrans de chargement (vague W, tools/fonds/) : au lancement, le garage rendu par le jeu ; au
// chargement d'une sortie, le fond de la carte choisie, en paysage comme en portrait. Le texte reste
// lisible : chaque texte contre l'image sous sa boîte (texte effacé, 95e centile de luminance), 4,5
// pour 1 au moins. Sans l'image, l'écran d'aujourd'hui. Les écrans sont retenus le temps du relevé :
// modèles en attente au lancement, tronçons de la carte en attente dans la sortie.
// Captures de revue (chaque écran, 390 × 844 et 844 × 390) : PMB_CAPTURES_FONDS=<dossier>.
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import sharp from 'sharp';
import { cartesDuMenu, ENTREE_SORTIE, openApp, openEntry, pickMap } from './helpers.ts';

const CAPTURES = process.env.PMB_CAPTURES_FONDS;
const PORTRAIT = { width: 390, height: 844 };
const PAYSAGE = { width: 844, height: 390 };
const TEXTES = '.tuto-marque span, .tuto-marque b, .tuto-etapes li, .tuto-chargement-texte, .drive-chargement-sous, .drive-credits';
const CARTES = cartesDuMenu();
/** La carte déclare un fond (champ « fond » de son map.json). */
const aUnFond = (id: string) => Boolean((JSON.parse(readFileSync(resolve('public', 'assets', 'maps', id, 'map.json'), 'utf8')) as { fond?: unknown }).fond);

/** Luminance relative (WCAG 2) d'une couleur sRGB, composantes de 0 à 255. */
function luminance(r: number, g: number, b: number): number {
  const c = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

/** Contraste le plus faible d'un texte de l'écran sur l'image qui est dessous (texte effacé pour la lire). */
async function contrasteMin(page: Page, ecran: Locator): Promise<{ min: number; ou: string }> {
  const textes = await ecran.locator(TEXTES).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, color: getComputedStyle(el).color, nom: (el.textContent ?? '').slice(0, 32) };
    }),
  );
  const style = await page.addStyleTag({ content: `${TEXTES} { color: transparent !important; text-shadow: none !important } .tuto-etapes li::before, .tuto-barre { visibility: hidden !important }` });
  const png = await page.screenshot();
  await style.evaluate((el) => (el as Element).remove());
  const { width, height } = page.viewportSize() ?? PORTRAIT;
  let min = Infinity;
  let ou = '';
  for (const t of textes) {
    const left = Math.max(0, Math.floor(t.x));
    const top = Math.max(0, Math.floor(t.y));
    const w = Math.min(width, Math.ceil(t.x + t.w)) - left;
    const h = Math.min(height, Math.ceil(t.y + t.h)) - top;
    if (w < 2 || h < 2) continue;
    const { data, info } = await sharp(png).extract({ left, top, width: w, height: h }).raw().toBuffer({ resolveWithObject: true });
    const fond: number[] = [];
    for (let i = 0; i < data.length; i += info.channels) fond.push(luminance(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0));
    fond.sort((a, b) => a - b);
    const lb = fond[Math.floor(fond.length * 0.95)] ?? 0;
    const [r = 0, g = 0, b = 0] = (t.color.match(/\d+(\.\d+)?/g) ?? []).map(Number);
    const lt = luminance(r, g, b);
    const ratio = (Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05);
    if (ratio < min) {
      min = ratio;
      ou = `« ${t.nom} » : ${ratio.toFixed(2)} pour 1`;
    }
  }
  return { min, ou };
}

/** Le fond de l'écran est là, dans l'orientation de l'écran. */
async function fondAffiche(ecran: Locator, orientation: 'paysage' | 'portrait'): Promise<void> {
  const img = ecran.locator('.fond-chargement[data-vu] img');
  await expect(img).toBeAttached({ timeout: 60_000 });
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => `${el.complete} ${el.currentSrc}`), { timeout: 30_000 }).toMatch(new RegExp(`^true .*-${orientation}[.-]`));
  // Décodée et peinte : le relevé lit l'image, pas le fond uni d'avant.
  await img.evaluate((el: HTMLImageElement) => el.decode());
  await img.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/** Relève le contraste dans les deux orientations (et capture si demandé), puis revient en portrait. */
async function releverLesDeux(page: Page, ecran: Locator, nom: string): Promise<void> {
  for (const [orientation, size] of [['portrait', PORTRAIT], ['paysage', PAYSAGE]] as const) {
    await page.setViewportSize(size);
    await fondAffiche(ecran, orientation);
    if (CAPTURES) {
      mkdirSync(CAPTURES, { recursive: true });
      await page.screenshot({ path: resolve(CAPTURES, `${nom}-${size.width}x${size.height}.png`) });
    }
    const { min, ou } = await contrasteMin(page, ecran);
    expect(min, `${nom}, ${orientation} : ${ou}`).toBeGreaterThanOrEqual(4.5);
    test.info().annotations.push({ type: `contraste ${nom} ${orientation}`, description: ou });
    console.log(`contraste le plus faible, ${nom}, ${orientation} : ${ou}`);
  }
  await page.setViewportSize(PORTRAIT);
}

/** Le lancement reste sur son écran : les modèles n'arrivent pas, ses délais sont allongés. */
async function retenirLancement(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...rest: unknown[]) =>
      original(handler, delay === 3_000 || delay === 10_000 ? 600_000 : delay, ...rest)) as typeof window.setTimeout;
  });
  await page.route('**/*.glb', () => undefined);
}

test.describe('fonds des écrans de chargement', () => {
  // Sans service worker, les requêtes passent par la page : on peut retenir les modèles et les tronçons.
  test.use({ serviceWorkers: 'block' });

  test('au lancement : le garage rendu par le jeu, le texte lisible ; sans image, l’écran d’aujourd’hui', async ({ page }) => {
    test.setTimeout(240_000);
    await retenirLancement(page);
    await page.goto('./');
    const ecran = page.locator('.tuto-chargement');
    await releverLesDeux(page, ecran, 'lancement');

    await page.route('**/assets/fonds/**', (route) => route.abort());
    await page.reload();
    await expect(ecran).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Ouverture du garage' })).toBeVisible();
    await expect(ecran.locator('.fond-chargement')).toHaveCount(0, { timeout: 30_000 });
  });

  test('au chargement d’une sortie : le fond de chaque carte, le texte lisible ; sans image, l’écran d’aujourd’hui', async ({ page }) => {
    test.setTimeout(540_000);
    // La route se lit (le menu y prend les départs), les tronçons n'arrivent pas : le chargement reste.
    await page.route('**/assets/maps/*/chunks/**', () => undefined);
    const avecFond = CARTES.map((carte, index) => ({ carte, index })).filter(({ carte }) => aUnFond(carte.id));
    expect(avecFond.length, 'au moins une carte a un fond').toBeGreaterThan(0);
    await openApp(page);
    for (const { carte, index } of avecFond) {
      await openEntry(page, ENTREE_SORTIE);
      await pickMap(page, index);
      await page.locator('footer.dock').getByRole('button', { name: 'Jouer', exact: true }).tap();
      const ecran = page.locator('.drive-chargement');
      await expect(ecran.locator('.tuto-marque b')).toHaveText(carte.name);
      await releverLesDeux(page, ecran, carte.id);
      await page.goBack();
      await expect(ecran).toHaveCount(0, { timeout: 30_000 });
    }

    // Sans image : l'écran d'aujourd'hui, sur son fond uni.
    await page.route('**/assets/maps/*/fond-*', (route) => route.abort());
    // Nouveau document : l'image déjà affichée ne revient pas du cache de la page.
    await page.goto('about:blank');
    await page.goto('./#/sortie');
    const ecran = page.locator('.drive-chargement');
    await expect(ecran.getByRole('progressbar')).toBeVisible({ timeout: 30_000 });
    await expect(ecran.locator('.fond-chargement')).toHaveCount(0, { timeout: 30_000 });
  });
});
