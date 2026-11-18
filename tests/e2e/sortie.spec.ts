import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { attendreApercu, attendreSurLaRoute, capture, choisirCamera, commencerCourse, ENTREE_SORTIE, entreeSortie, etapeSortie, fermerReglages, openApp, openEntry, ouvrirReglages, rentrerAuGarage, waitForScene } from './helpers.ts';

// Sortie de nuit, lot 1 (§ 5.5) : on entre par le menu (Garage · Sortie), on roule, on change
// de caméra, on passe à la main, on rentre au garage. Le parcours ne lit que les attributs que la
// scène pose sur son élément racine (src/drive/contrat.ts) et l'interface de la sortie.
// Captures : captures/jalon-1/sortie-menu.png, sortie-route.png, sortie-main.png.

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const numberAttr = async (page: Page, name: string) => Number(await stage(page).getAttribute(name));

test.describe('sortie de nuit', () => {
  // Rendu logiciel sur une machine partagée (CI) : la scène tourne à quelques images par seconde et
  // la route avance au ralenti. Les délais disent « ça avance », pas « ça avance vite ».
  test.setTimeout(300_000);

  test('du menu à la route, et retour au garage', async ({ page }) => {
    test.setTimeout(480_000);
    await openApp(page);
    await waitForScene(page);

    // Le menu, par étapes (vague U) : le mode, le lieu (lu dans le catalogue), son circuit, le départ,
    // puis les réglages : crédits, météo, « Sortir ». Chaque étape remplace la précédente.
    await openEntry(page, ENTREE_SORTIE);
    const dock = page.locator('footer.dock');
    // Rien n'est choisi à l'ouverture : le mode seul ; ni lieux, ni départs, ni météo, ni « Sortir ».
    await expect(entreeSortie(page)).toHaveAttribute('data-etape', 'mode');
    const lieux = dock.getByRole('group', { name: 'Lieu' });
    const starts = dock.getByRole('group', { name: 'Départ' });
    await expect(lieux).toHaveCount(0);
    await expect(starts).toHaveCount(0);
    await expect(dock.getByRole('group', { name: 'Météo' })).toHaveCount(0);
    await expect(dock.getByRole('button', { name: 'Sortir', exact: true })).toHaveCount(0);
    await dock.getByRole('group', { name: 'Mode' }).getByRole('button', { name: /^Libre/ }).tap();
    await expect(lieux.getByRole('button').first()).toBeVisible();
    await expect(lieux.locator('[aria-pressed="true"]')).toHaveCount(0);
    await capture(page, 'sortie-menu-cartes');
    await lieux.getByRole('button').first().tap();
    await expect(lieux).toHaveCount(0);
    if ((await etapeSortie(page)) === 'circuit') await dock.getByRole('group', { name: 'Circuit' }).getByRole('button').first().tap();
    await expect(starts.getByRole('button').first()).toBeVisible();
    const second = ((await starts.getByRole('button').nth(1).locator('b').textContent()) ?? '').trim();
    await starts.getByRole('button').nth(1).tap();
    await expect(starts).toHaveCount(0);
    await expect(entreeSortie(page).locator('.entree-rappel')).toContainText(second);
    await expect(dock.locator('.drive-credits')).toContainText('Licence Ouverte');
    await dock.getByRole('group', { name: 'Météo' }).getByRole('button', { name: 'Pluie' }).tap();
    await capture(page, 'sortie-menu');
    await dock.getByRole('button', { name: 'Sortir', exact: true }).tap();

    // L'écran de la sortie : l'atelier s'efface, la scène de la route est prête.
    await expect(page).toHaveURL(/#\/sortie$/);
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
    await expect(page.locator('footer.dock')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toHaveCount(0);
    await expect(stage(page)).toHaveAttribute('data-meteo', 'pluie');

    // Pilote automatique : l'abscisse et la vitesse avancent sans toucher l'écran.
    // Délais en secondes de route (temps de simulation), pas d'horloge : la CI tombe par moments sous
    // une image par seconde. Au pas de 0,1 s, sous la pluie, 10 km/h en moins d'une seconde, 20 m en 4 s.
    const s0 = await numberAttr(page, 'data-s');
    await attendreSurLaRoute(page, 'aperçu lancé', () => numberAttr(page, 'data-vitesse'), (v) => v > 10, { secondes: 10 });
    await attendreSurLaRoute(page, 'aperçu qui avance', () => numberAttr(page, 'data-s'), (s) => s > s0 + 20, { secondes: 20 });
    await attendreApercu(page);
    await capture(page, 'sortie-route');

    // Caméra suivante : le réalisateur s'arrête, la caméra choisie est celle qu'on voit.
    let panneau = await ouvrirReglages(page);
    await expect(panneau.getByRole('button', { name: 'Réalisateur' })).toHaveAttribute('aria-pressed', 'true');
    await fermerReglages(page);
    await choisirCamera(page, 'Rasante');
    panneau = await ouvrirReglages(page);
    await expect(panneau.getByRole('button', { name: 'Réalisateur' })).toHaveAttribute('aria-pressed', 'false');
    await fermerReglages(page);
    const camera = await stage(page).getAttribute('data-camera');
    await choisirCamera(page, 'Avant');
    await expect(stage(page)).not.toHaveAttribute('data-camera', camera ?? '');

    // Un appui sur la route : la course, depuis la ligne, à la main, poursuite.
    await commencerCourse(page, { parti: true });
    await expect(stage(page)).toHaveAttribute('data-camera', 'poursuite');
    await expect(page.locator('.drive-speed b')).toBeVisible();
    const zone = page.locator('.drive-mid');
    const box = await zone.boundingBox();
    if (!box) throw new Error('zone des gestes introuvable');
    const cx = box.x + box.width * 0.5;
    const cy = box.y + box.height * 0.5;
    // Manche vers le haut : les gaz ; on lance le véhicule.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 70, { steps: 4 });
    // Sous la pluie, plein gaz depuis la ligne : 25 km/h en 1,3 s de route ; 10 km/h perdus au frein à
    // fond en 1,2 s ; 5 km/h repris en 1,1 s (tests/unit/drive-temps-route.test.ts).
    await attendreSurLaRoute(page, 'gaz à fond', () => numberAttr(page, 'data-vitesse'), (v) => v > 25, { secondes: 8 });
    await expect(page.locator('.drive-speed b')).not.toHaveText('0');
    await page.mouse.up();
    // Manche vers le bas : le frein, à fond.
    const before = await numberAttr(page, 'data-vitesse');
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 70, { steps: 4 });
    await attendreSurLaRoute(page, 'frein à fond', () => numberAttr(page, 'data-vitesse'), (v) => v < Math.max(1, before - 10), { secondes: 6 });
    await expect(page.locator('.drive-manche')).toHaveAttribute('data-frein', '1.00');
    await page.mouse.up();
    const stopped = await numberAttr(page, 'data-vitesse');
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 70, { steps: 4 });
    await attendreSurLaRoute(page, 'gaz repris', () => numberAttr(page, 'data-vitesse'), (v) => v > stopped + 5, { secondes: 6 });
    await capture(page, 'sortie-main');
    await page.mouse.up();

    // Rentrer au garage en deux gestes à la main (la languette rappelle la barre) : l'atelier revient
    // tel qu'on l'avait laissé.
    await rentrerAuGarage(page);
    await expect(page).not.toHaveURL(/#\/sortie/);
    await expect(stage(page)).toHaveCount(0);
    await expect(page.locator('footer.dock')).toBeVisible();
    await expect(page.locator('footer.dock .dock-tab[data-onglet="sortie"]')).toBeVisible();
    await waitForScene(page);
  });

  test('lien direct vers la sortie : la première carte ; toutes les commandes offrent 48 px au doigt', async ({ page }) => {
    // Route lente à venir : l'écran de chargement le dit, crédits de la carte compris.
    let release = () => {};
    const held = new Promise<void>((done) => (release = done));
    await page.route('**/assets/maps/*/route.json', async (route) => {
      await held;
      await route.continue();
    });
    // L'atelier ne s'affiche pas : on n'attend pas son titre.
    await page.goto('./#/sortie');
    const veil = page.locator('.drive-veil[data-etat="chargement"]');
    await expect(veil).toBeVisible({ timeout: 30_000 });
    await expect(veil).toContainText('Licence Ouverte');
    // Écran de chargement plein : la carte nommée, ses étapes, « Rentrer au garage » atteignable.
    await expect(veil.locator('.tuto-marque b')).not.toBeEmpty();
    await expect(veil.locator('.tuto-etapes li')).toHaveCount(4);
    await expect(veil.getByRole('button', { name: 'Rentrer au garage' })).toBeVisible();
    await capture(page, 'sortie-chargement');
    release();
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
    await expect(veil).toHaveCount(0);
    await attendreApercu(page);
    // L'aperçu, puis les réglages ouverts : chaque bouton visible offre 48 px au doigt.
    const tailles = async () => {
      const controls = page.locator('.app button:visible');
      const count = await controls.count();
      for (let i = 0; i < count; i += 1) {
        const control = controls.nth(i);
        const label = ((await control.getAttribute('aria-label')) ?? (await control.innerText())).trim();
        const size = await control.boundingBox();
        expect(size?.height ?? 0, label).toBeGreaterThanOrEqual(48);
        expect(size?.width ?? 0, label).toBeGreaterThanOrEqual(48);
      }
      return count;
    };
    expect(await tailles()).toBeGreaterThanOrEqual(2);
    await ouvrirReglages(page);
    expect(await tailles()).toBeGreaterThan(15);
    await fermerReglages(page);
    await commencerCourse(page);
    expect(await tailles()).toBeGreaterThanOrEqual(4);
  });

  test('les matières de nuit se compilent : ni erreur de nuanceur ni erreur de page, par les trois météos, puis de jour', async ({ page }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /shader|webglprogram|glsl|program/i.test(message.text())) errors.push(message.text().slice(0, 300));
    });
    await page.goto('./#/sortie');
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
    // Quelques secondes de route : enseignes, lumières lointaines, brume au sol, garde des caméras.
    await expect.poll(() => numberAttr(page, 'data-s'), { timeout: 120_000 }).toBeGreaterThan(20);
    // Les deux autres météos, par le bouton qui passe de l'une à l'autre (celle du joueur est
    // enregistrée : pluie par défaut).
    const seen = new Set([await stage(page).getAttribute('data-meteo')]);
    // Les réglages ouverts dans l'aperçu : la route continue derrière, chaque météo s'y compile.
    const panneau = await ouvrirReglages(page);
    for (const nom of ['Sec', 'Pluie', 'Neige']) {
      const before = (await stage(page).getAttribute('data-meteo')) ?? '';
      const bouton = panneau.getByRole('group', { name: 'Météo' }).getByRole('button', { name: nom, exact: true });
      if ((await bouton.getAttribute('aria-pressed')) === 'true') continue;
      await bouton.tap();
      await expect(stage(page)).not.toHaveAttribute('data-meteo', before);
      seen.add(await stage(page).getAttribute('data-meteo'));
      await page.waitForTimeout(2_000);
    }
    expect([...seen].sort()).toEqual(['neige', 'pluie', 'sec']);
    // Le jour (vague S) : mêmes programmes que la nuit, sous la dernière météo ; puis retour à la nuit.
    for (const [nom, moment] of [['Jour', 'jour'], ['Nuit', 'nuit']] as const) {
      await panneau.getByRole('group', { name: 'Moment' }).getByRole('button', { name: nom, exact: true }).tap();
      await expect(stage(page)).toHaveAttribute('data-moment', moment);
      await page.waitForTimeout(2_000);
    }
    expect(errors).toEqual([]);
  });

  test('route introuvable : un message clair, « Réessayer » et le retour au garage', async ({ page }) => {
    await page.route('**/assets/maps/*/route.json', (route) => route.abort());
    await page.goto('./#/sortie');
    await expect(stage(page)).toHaveAttribute('data-sortie', 'erreur', { timeout: 30_000 });
    await expect(page.getByRole('alert')).toContainText('La route ne veut pas s’ouvrir');
    await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible();
    await expect(page.locator('.drive-veil[data-etat="erreur"]').getByRole('button', { name: 'Rentrer au garage' })).toBeVisible();
    await capture(page, 'sortie-erreur');
    await page.unroute('**/assets/maps/*/route.json');
    await page.getByRole('button', { name: 'Réessayer' }).tap();
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
    // « Réessayer » rouvre sur l'aperçu.
    await attendreApercu(page);
    await rentrerAuGarage(page);
    await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeVisible();
  });
});
