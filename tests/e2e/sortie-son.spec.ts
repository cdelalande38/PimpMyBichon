import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { commencerCourse, fermerReglages, openApp, openEntry, ouvrirReglages, pickMap, reglagesSortie, reloadSaved, rentrerAuGarage } from './helpers.ts';

// Son du moteur en sortie de nuit (§ 5.5, § 9) : au départ le moteur démarre et tourne, le régime
// publié monte avec la vitesse et passe des rapports, le bouton « Moteur » coupe et remet (choix
// gardé d'une sortie à l'autre), la pause et le retour au garage coupent ; ouverte sans geste, la
// sortie reste muette jusqu'au premier appui. Le bouton « Son du moteur » et les curseurs du son sont
// dans les réglages de la sortie (src/ui/drive/Reglages.tsx) ; l'état se lit dans data-moteur,
// data-regime, data-rapport et data-niveau du témoin caché `.drive-son-etat` (src/ui/drive/Mixage.tsx),
// le mélange dans ses data-radio, data-moteur-niveau, data-route, data-bruitage et data-bruitages ; on
// vérifie l'état du lecteur et les requêtes, pas le son entendu.

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
/** Témoin caché du son de la sortie (src/ui/drive/Mixage.tsx, SonEtat) : état du moteur et mélange. */
const engine = (page: Page) => page.locator('.drive-son-etat');
/** « Son du moteur », dans les réglages de la sortie. */
const engineButton = (page: Page) => reglagesSortie(page).getByRole('button', { name: /^Son du moteur/ });
const numberAttr = async (page: Page, name: string) => Number(await engine(page).getAttribute(name));

/** Met un véhicule à l'écran par la sauvegarde des builds (idb-keyval), sans passer par le catalogue. */
async function putOnScreen(page: Page, id: string): Promise<void> {
  await page.evaluate(
    (id) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(JSON.stringify({ state: { current: id, builds: {}, recents: [] }, version: 1 }), 'pmb-builds');
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    id,
  );
}

/** Erreurs de la page (console et exceptions), pour finir sans aucune. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Requêtes de sons de moteur (chemin sous assets/audio/engines/). */
function watchSounds(page: Page): string[] {
  const sounds: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes('/assets/audio/engines/')) sounds.push(url.pathname.split('/assets/audio/engines/')[1] ?? '');
  });
  return sounds;
}

async function shot(page: Page, name: string, dossier = 'vague-n-sonsortie'): Promise<void> {
  const path = resolve('captures', dossier, `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

async function goOut(page: Page): Promise<void> {
  await openEntry(page, 'Sortie de nuit');
  await pickMap(page);
  await page.locator('footer.dock').getByRole('button', { name: 'Sortir', exact: true }).tap();
  await expect(page).toHaveURL(/#\/sortie$/);
  await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 90_000 });
}

test.describe('son du moteur en sortie', () => {
  test('démarre au départ, suit la vitesse, se coupe et se remet ; pause et garage coupent', async ({ page }) => {
    test.setTimeout(420_000);
    const errors = watchErrors(page);
    const sounds = watchSounds(page);
    await openApp(page);
    await putOnScreen(page, 'sportive');
    await reloadSaved(page);
    await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeVisible();
    expect(sounds).toEqual([]);

    await goOut(page);
    // Le bouton est dans les réglages (l'aperçu roule derrière), assez grand pour le doigt.
    const button = engineButton(page);
    const temoin = engine(page);
    await ouvrirReglages(page);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    expect(box && Math.min(box.width, box.height)).toBeGreaterThanOrEqual(48);
    await fermerReglages(page);
    // Départ : le démarreur, puis le moteur tourne ; les sons de la famille du véhicule sont demandés.
    await expect(temoin).toHaveAttribute('data-moteur', /demarre|tourne/, { timeout: 30_000 });
    await expect(temoin).toHaveAttribute('data-moteur', 'tourne', { timeout: 30_000 });
    expect(sounds.some((path) => path.startsWith('quatre-en-ligne-moto/'))).toBe(true);
    expect(sounds.every((path) => path.startsWith('quatre-en-ligne-moto/'))).toBe(true);

    // Le régime publié suit la vitesse : il monte avec elle et des rapports passent.
    const samples: { kmh: number; regime: number; rapport: number }[] = [];
    await expect
      .poll(
        async () => {
          samples.push({
            kmh: Number(await stage(page).getAttribute('data-vitesse')),
            regime: await numberAttr(page, 'data-regime'),
            rapport: await numberAttr(page, 'data-rapport'),
          });
          return Math.max(...samples.map((sample) => sample.rapport));
        },
        // La deuxième passe vers 4 s de route ; en rendu logiciel la scène avance d'un dixième de seconde par image.
        { timeout: 150_000, intervals: [250] },
      )
      .toBeGreaterThanOrEqual(2);
    const slow = samples.filter((sample) => sample.kmh < 8);
    const fast = samples.filter((sample) => sample.kmh >= 8);
    expect(fast.length).toBeGreaterThan(0);
    expect(Math.max(...samples.map((sample) => sample.regime))).toBeGreaterThan(Math.min(...samples.map((sample) => sample.regime)) + 500);
    if (slow.length > 0) expect(Math.min(...slow.map((sample) => sample.regime))).toBeLessThan(Math.max(...fast.map((sample) => sample.regime)));
    await shot(page, 'sortie-moteur-tourne');

    // Le bouton coupe, puis remet (sans démarreur : le véhicule roule déjà). Dans l'aperçu, les
    // réglages ouverts n'arrêtent pas la route.
    await ouvrirReglages(page);
    await button.tap();
    await expect(temoin).toHaveAttribute('data-moteur', 'muet');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(temoin).toHaveAttribute('data-regime', '0');
    await shot(page, 'sortie-moteur-coupe');
    await button.tap();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(temoin).toHaveAttribute('data-moteur', 'tourne', { timeout: 30_000 });
    // Ralenti d'image : le moteur tourne toujours (le volume baisse, pas la hauteur).
    const ralenti = reglagesSortie(page).getByRole('button', { name: 'Ralenti' });
    const plein = await numberAttr(page, 'data-niveau');
    expect(plein).toBeGreaterThan(0);
    await ralenti.tap();
    await expect(ralenti).toHaveAttribute('aria-pressed', 'true');
    await expect(temoin).toHaveAttribute('data-moteur', 'tourne');
    await expect.poll(() => numberAttr(page, 'data-niveau')).toBeLessThan(plein);
    await ralenti.tap();
    await expect(ralenti).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => numberAttr(page, 'data-niveau')).toBe(plein);
    await fermerReglages(page);
    // La course : pause, coupé ; reprise, il tourne de nouveau.
    await commencerCourse(page);
    const top = page.locator('.drive-top');
    await top.getByRole('button', { name: 'Pause' }).tap();
    await expect(temoin).toHaveAttribute('data-moteur', 'coupe');
    await top.getByRole('button', { name: 'Reprendre' }).tap();
    await expect(temoin).toHaveAttribute('data-moteur', 'tourne', { timeout: 30_000 });
    // Les réglages ouverts en course la mettent en pause : coupé, puis il repart à la fermeture.
    await ouvrirReglages(page);
    await expect(temoin).toHaveAttribute('data-moteur', 'coupe');
    await fermerReglages(page);
    await expect(temoin).toHaveAttribute('data-moteur', 'tourne', { timeout: 30_000 });
    // Coupé à la main, puis retour au garage : le moteur est coupé au garage.
    await ouvrirReglages(page);
    await button.tap();
    await expect(temoin).toHaveAttribute('data-moteur', 'muet');
    await rentrerAuGarage(page);
    await expect(stage(page)).toHaveCount(0);
    await openEntry(page, 'Préparation');
    await expect(page.locator('footer.dock .engine-sound')).toHaveAttribute('data-moteur', 'coupe');

    // Le choix est gardé d'une sortie à l'autre : on repart moteur coupé, on le remet.
    await goOut(page);
    await expect(engine(page)).toHaveAttribute('data-moteur', 'muet');
    await ouvrirReglages(page);
    await expect(engineButton(page)).toHaveAttribute('aria-pressed', 'false');
    await engineButton(page).tap();
    await expect(engine(page)).toHaveAttribute('data-moteur', 'tourne', { timeout: 30_000 });
    await rentrerAuGarage(page);
    await expect(stage(page)).toHaveCount(0);
    await openEntry(page, 'Préparation');
    await expect(page.locator('footer.dock .engine-sound')).toHaveAttribute('data-moteur', 'coupe');

    expect(errors).toEqual([]);
  });

  test('ouverte sans geste, la sortie reste muette jusqu’au premier appui', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    const sounds = watchSounds(page);
    await page.goto('./#/sortie');
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 90_000 });
    await expect(engine(page)).toHaveAttribute('data-moteur', 'attente');
    // Rien n'est demandé ni joué avant le geste.
    await page.waitForTimeout(1000);
    await expect(engine(page)).toHaveAttribute('data-moteur', 'attente');
    expect(sounds).toEqual([]);

    // Premier appui sur la route : le moteur démarre.
    await page.locator('.drive-mid').tap({ position: { x: 100, y: 120 } });
    // Ce premier appui lance aussi la course, à la main.
    await expect(page.locator('.drive-mid')).toHaveAttribute('data-conduite', 'main');
    await expect(engine(page)).toHaveAttribute('data-moteur', /demarre|tourne/, { timeout: 30_000 });
    await expect(engine(page)).toHaveAttribute('data-moteur', 'tourne', { timeout: 30_000 });
    expect(sounds.length).toBeGreaterThan(0);
    await shot(page, 'sortie-ouverte-directe');
    expect(errors).toEqual([]);
  });

  test.describe('mélange et bruitages', () => {
    // Le service worker servirait les sons lui-même : on le bloque pour servir l'index d'essai.
    test.use({ serviceWorkers: 'block' });

    test('la radio baisse moteur tournant et remonte en pause ; les curseurs agissent ; le rapport part au passage', async ({ page }) => {
      test.setTimeout(420_000);
      const errors = watchErrors(page);
      // Index de bruitages d'essai : le seul rapport, avec pour fichier une prise réelle du dépôt
      // (la coupure d'un moteur). Rien n'est fabriqué.
      const prise = readFileSync(resolve('public/assets/audio/engines/quatre-en-ligne-moto/stop.ogg'));
      const sfx: string[] = [];
      await page.route('**/assets/audio/sfx/route/**', async (route) => {
        const path = new URL(route.request().url()).pathname.split('/assets/audio/sfx/route/')[1] ?? '';
        sfx.push(path);
        if (path === 'sfx.json') {
          await route.fulfill({
            json: {
              format: 'pmb-sfx-sons',
              version: 1,
              famille: 'route',
              provisoire: true,
              boucles: [],
              ponctuels: [{ emplacement: 'rapport', fichier: 'rapport-1.ogg', empreinte: 'e55a1', duree: 1, gain: -6, credit: 0 }],
              credits: [{ auteur: 'essai', licence: 'CC0-1.0', source: 'essai', citer: false }],
            },
          });
          return;
        }
        await route.fulfill({ body: prise, contentType: 'audio/ogg' });
      });
      await openApp(page);
      await putOnScreen(page, 'sportive');
      await reloadSaved(page);
      await goOut(page);
      const mix = engine(page);
      const radioFacteur = async () => Number(await mix.getAttribute('data-radio'));

      // Le moteur tourne : la radio passe derrière (45 % de son volume), le moteur à plein.
      await expect(engine(page)).toHaveAttribute('data-moteur', 'tourne', { timeout: 60_000 });
      await expect.poll(radioFacteur).toBeCloseTo(0.45, 2);
      await expect(engine(page)).toHaveAttribute('data-niveau', '1.00');
      await expect(mix).toHaveAttribute('data-route', '0.70');

      // Un bruitage de rapport part au passage de rapport ; l'index n'est demandé qu'une fois.
      await expect.poll(async () => Number(await mix.getAttribute('data-bruitages')), { timeout: 150_000, intervals: [250] }).toBeGreaterThan(0);
      await expect(mix).toHaveAttribute('data-bruitage', 'rapport');
      expect(sfx.filter((path) => path === 'sfx.json')).toHaveLength(1);
      expect(sfx.some((path) => path.startsWith('rapport-1.ogg'))).toBe(true);

      // Les réglages, rubrique « Son » : trois curseurs au doigt, aux valeurs d'origine (dans l'aperçu,
      // la route continue derrière).
      await ouvrirReglages(page);
      const panneau = reglagesSortie(page).getByRole('group', { name: 'Son de la sortie' });
      await expect(panneau).toBeVisible();
      const curseur = (nom: string) => panneau.getByRole('slider', { name: nom, exact: true });
      await expect(curseur('Radio')).toHaveValue('45');
      await expect(curseur('Moteur')).toHaveValue('100');
      await expect(curseur('Route')).toHaveValue('70');
      for (const nom of ['Radio', 'Moteur', 'Route']) {
        const box = await curseur(nom).boundingBox();
        expect(box && box.height, nom).toBeGreaterThanOrEqual(48);
      }
      const cadre = await panneau.boundingBox();
      expect(cadre && cadre.x).toBeGreaterThanOrEqual(0);
      expect(cadre && cadre.x + cadre.width).toBeLessThanOrEqual(390);
      await shot(page, 'son-origine-390', 'vague-o-sonsroute');

      // Les curseurs agissent tout de suite.
      await curseur('Radio').fill('20');
      await expect.poll(radioFacteur).toBeCloseTo(0.2, 2);
      await curseur('Moteur').fill('50');
      await expect(engine(page)).toHaveAttribute('data-niveau', '0.50');
      await expect(mix).toHaveAttribute('data-moteur-niveau', '0.50');
      await curseur('Route').fill('30');
      await expect(mix).toHaveAttribute('data-route', '0.30');
      await shot(page, 'son-deplaces-390', 'vague-o-sonsroute');

      // Petit téléphone : le panneau tient dans la largeur.
      await fermerReglages(page);
      await page.setViewportSize({ width: 360, height: 780 });
      await ouvrirReglages(page);
      await panneau.scrollIntoViewIfNeeded();
      const petit = await panneau.boundingBox();
      expect(petit && petit.x).toBeGreaterThanOrEqual(0);
      expect(petit && petit.x + petit.width).toBeLessThanOrEqual(360);
      await shot(page, 'son-deplaces-360', 'vague-o-sonsroute');
      await panneau.getByRole('button', { name: 'Valeurs d’origine' }).tap();
      await expect(curseur('Radio')).toHaveValue('45');
      await expect.poll(radioFacteur).toBeCloseTo(0.45, 2);
      await shot(page, 'son-origine-360', 'vague-o-sonsroute');
      await fermerReglages(page);
      await expect(panneau).toHaveCount(0);
      // Un appui à côté (au-dessus du panneau) le ferme aussi, sans lancer la course.
      await ouvrirReglages(page);
      await expect(panneau).toBeVisible();
      await page.touchscreen.tap(180, 40);
      await expect(reglagesSortie(page)).toHaveCount(0);
      await expect(page.locator('.drive-mid')).toHaveAttribute('data-conduite', 'auto');
      // La course : pause, la radio reprend son volume ; reprise, elle repasse derrière.
      await commencerCourse(page);
      const top = page.locator('.drive-top');
      await top.getByRole('button', { name: 'Pause' }).tap();
      await expect.poll(radioFacteur).toBe(1);
      await top.getByRole('button', { name: 'Reprendre' }).tap();
      await expect(engine(page)).toHaveAttribute('data-moteur', 'tourne', { timeout: 30_000 });
      await expect.poll(radioFacteur).toBeCloseTo(0.45, 2);

      // Au garage, la radio reprend son volume ; les réglages sont gardés d'une sortie à l'autre.
      await ouvrirReglages(page);
      await curseur('Route').fill('55');
      await rentrerAuGarage(page);
      await expect(stage(page)).toHaveCount(0);
      await goOut(page);
      await ouvrirReglages(page);
      await expect(curseur('Route')).toHaveValue('55');

      expect(errors).toEqual([]);
    });

    test('à la main, un appui sur le NOS fait partir « nos-depart » une seule fois par poussée', async ({ page }) => {
      test.setTimeout(420_000);
      const errors = watchErrors(page);
      // Index d'essai : le seul coup d'envoi du NOS, avec pour fichier une prise réelle du dépôt
      // (la coupure d'un moteur). Rien n'est fabriqué, aucune boucle : seul ce ponctuel peut partir.
      const prise = readFileSync(resolve('public/assets/audio/engines/quatre-en-ligne-moto/stop.ogg'));
      await page.route('**/assets/audio/sfx/route/**', async (route) => {
        const path = new URL(route.request().url()).pathname.split('/assets/audio/sfx/route/')[1] ?? '';
        if (path === 'sfx.json') {
          await route.fulfill({
            json: {
              format: 'pmb-sfx-sons',
              version: 1,
              famille: 'route',
              provisoire: true,
              boucles: [],
              ponctuels: [{ emplacement: 'nos-depart', fichier: 'nos-depart-1.ogg', empreinte: 'e55a2', duree: 1, gain: -6, credit: 0 }],
              credits: [{ auteur: 'essai', licence: 'CC0-1.0', source: 'essai', citer: false }],
            },
          });
          return;
        }
        await route.fulfill({ body: prise, contentType: 'audio/ogg' });
      });
      await openApp(page);
      await putOnScreen(page, 'sportive');
      await reloadSaved(page);
      await goOut(page);
      const mix = engine(page);
      const nos = page.getByRole('button', { name: 'NOS' });
      const bruitages = async () => Number(await mix.getAttribute('data-bruitages'));
      await expect(engine(page)).toHaveAttribute('data-moteur', 'tourne', { timeout: 60_000 });
      await expect(mix).toHaveAttribute('data-bruitages', '0');

      // À la main : le NOS n'est envoyé qu'à la main. Un appui : le coup d'envoi part, une fois.
      await commencerCourse(page);
      await expect(nos).toBeVisible();
      // Le départ est donné aux feux : un appui pendant les feux rouges ne compte pas (le véhicule est
      // tenu sur la ligne). En rendu logiciel les feux durent une demi-minute : on attend le vert.
      await expect(stage(page)).toHaveAttribute('data-depart', 'parti', { timeout: 150_000 });
      await nos.tap();
      await expect(nos).toHaveAttribute('data-nos', 'envoye', { timeout: 120_000 });
      await expect.poll(bruitages, { timeout: 120_000, intervals: [250] }).toBe(1);
      await expect(mix).toHaveAttribute('data-bruitage', 'nos-depart');
      // Tant que la poussée dure, aucun autre coup ; une fois finie, toujours un seul.
      await expect(page.locator('.drive-dial')).toHaveAttribute('data-nos', 'true', { timeout: 30_000 });
      expect(await bruitages()).toBe(1);
      await expect(page.locator('.drive-dial')).toHaveAttribute('data-nos', 'false', { timeout: 150_000 });
      expect(await bruitages()).toBe(1);
      await shot(page, 'nos-depart-390', 'vague-p-derapage');

      // Une nouvelle poussée : un nouveau coup d'envoi.
      await expect(nos).toHaveAttribute('data-nos', /pret|envoye/, { timeout: 150_000 });
      await nos.tap();
      await expect.poll(bruitages, { timeout: 150_000, intervals: [250] }).toBe(2);
      expect(errors).toEqual([]);
    });
  });
});
