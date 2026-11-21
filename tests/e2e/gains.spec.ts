// Les gains de fin de course (vague U, 18 novembre 2026 ; src/ui/jeu/NotificationsGain.tsx,
// src/ui/drive/FinCourseVue.tsx, src/audio/sfx/interface.ts) : à la fin d'une course, chaque gain arrive à son
// tour en notification, avec son effet sonore ; un appui passe à l'écran complet ; « moins de mouvement » : tout
// est là d'emblée, un seul son ; la fin d'une balade dit qu'il n'y a pas de gain et relance en course.
// Sur une sauvegarde NEUVE : la première course finie donne « Premier tour de piste », quel que soit le temps.
//
// Même méthode que courses.spec.ts : une course entière est trop longue en rendu logiciel, le parcours sert la
// route de Miami Beach (page.route) avec le départ « Vers la 41e rue » posé 120 m avant le bout (la donnée de la
// carte change dans le navigateur du test seulement ; l'app n'a aucune porte dérobée) ; le service worker est
// bloqué pour que cette route passe par le réseau de la page. Le lecteur des sons est « espionné » par les
// témoins du voile (data-sons-demandes : sons demandés au lecteur, data-sons-joues : sons partis,
// data-son-dernier). Captures de revue derrière PMB_CAPTURES_GAINS (dossier de destination).

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { attendreSurLaRoute, auSec, choisirCarte, choisirDepart, commencerCourse, DELAI_ROUTE, ENTREE_SORTIE, openApp, openEntry, reglerSortie, waitForScene } from './helpers.ts';

const CAPTURES = process.env.PMB_CAPTURES_GAINS;
const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const dock = (page: Page) => page.locator('footer.dock');
const fin = (page: Page) => page.locator('.fin-course');
const voile = (page: Page) => page.locator('.fin-course-voile');
const PORTRAIT = { width: 390, height: 844 };
const PAYSAGE = { width: 844, height: 390 };

async function photo(page: Page, nom: string): Promise<void> {
  if (!CAPTURES) return;
  mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURES, `${nom}.png`) });
}

/** Sert la route de Miami Beach avec le départ « Vers la 41e rue » 120 m avant le bout. */
async function raccourcirLaRoute(page: Page): Promise<void> {
  await page.route('**/assets/maps/miami-beach/route.json', async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as { length: number; starts: { id: string; at: number }[] };
    const nord = json.starts.find((start) => start.id === 'nord');
    if (nord) nord.at = json.length - 120;
    await route.fulfill({ response, json });
  });
}

/** Sort sur Miami Beach, départ « Vers la 41e rue », au sec, dans le format voulu ; attend la route prête. */
async function sortir(page: Page, format: 'Balade' | 'Course 1 tour'): Promise<void> {
  await openApp(page);
  await waitForScene(page);
  await openEntry(page, ENTREE_SORTIE);
  // Le menu de la sortie va par étapes (lieu, circuit, départ, réglages) : tests/e2e/helpers.ts les passe.
  // Le format est le mode de l'écran « Jouer » (vague X) : la balade, ou la course d'un tour.
  await choisirCarte(page, 'Miami Beach', format === 'Balade' ? 'balade' : 'course');
  await choisirDepart(page, /Vers la 41e rue/);
  await auSec(page);
  await dock(page).getByRole('button', { name: 'Jouer', exact: true }).tap();
  await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
}

/** Mène la route à la main jusqu'au bout (direction assistée : le manche tenu vers le haut suffit) ; `attente` dit ce qu'on attend. */
async function rouler(page: Page, quoi: string, arrive: () => Promise<boolean>): Promise<void> {
  await reglerSortie(page, 'Conduite assistée', 'Oui');
  await commencerCourse(page, { parti: true });
  const zone = page.locator('.drive-mid');
  const box = await zone.boundingBox();
  if (!box) throw new Error('zone des gestes introuvable');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6 - 70, { steps: 4 });
  await attendreSurLaRoute(page, quoi, arrive, (vu) => vu, { secondes: 60, horloge: 480_000, intervalle: 500 });
  await page.mouse.up();
}

/** « Rentrer au garage » depuis l'écran de fin (le voile couvre les réglages) ; confirme la question si elle vient. */
async function rentrerDepuisLaFin(page: Page): Promise<void> {
  await fin(page).getByRole('button', { name: 'Rentrer au garage' }).tap();
  const question = page.getByRole('dialog', { name: 'Rentrer au garage ?' });
  const garage = page.getByRole('heading', { level: 1, name: 'PimpMyBichon' });
  await expect(question.or(garage)).toBeVisible();
  if (await question.isVisible()) await question.getByRole('button', { name: 'Rentrer', exact: true }).tap();
  await expect(garage).toBeVisible();
}

declare global {
  interface Window {
    __cartesVues: string[];
    __sauts: { cartes: number; demandes: number }[];
  }
}

/** Note, dans la page, chaque carte de notification au moment où elle paraît (un relevé par sondage en rate). */
async function noterLesCartes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cartesVues = [];
    const noter = () => {
      for (const carte of document.querySelectorAll('.fin-course .notif-carte')) {
        const titre = carte.querySelector('b')?.textContent ?? '';
        if (!window.__cartesVues.includes(titre)) window.__cartesVues.push(titre);
      }
    };
    new MutationObserver(noter).observe(document, { childList: true, subtree: true });
  });
}

/**
 * Dès que la PREMIÈRE carte paraît, touche l'écran (le résultat) dans la même minute de la page : le saut vers
 * l'écran complet est donc sûrement fait à une carte, quelle que soit la lenteur de la machine.
 */
async function toucherDesLaPremiereCarte(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__sauts = [];
    const observateur = new MutationObserver(() => {
      const cartes = document.querySelectorAll('.fin-course .notif-carte').length;
      const temps = document.querySelector<HTMLElement>('.fin-course .fin-course-temps');
      if (cartes === 0 || !temps || window.__sauts.length > 0) return;
      const demandes = Number(document.querySelector('.fin-course-voile')?.getAttribute('data-sons-demandes') ?? 0);
      window.__sauts.push({ cartes, demandes });
      temps.click();
    });
    observateur.observe(document, { childList: true, subtree: true });
  });
}

const nombre = async (cible: Locator, attribut: string): Promise<number> => Number((await cible.getAttribute(attribut)) ?? 'NaN');

/** Ce que l'écran complet compte : les lignes de gain (sans le total), les hauts faits et les objets. */
async function lignesDeLEcranComplet(page: Page): Promise<number> {
  const gains = await fin(page).locator('.fin-course-gains li:not(.fin-course-total)').count();
  const debloque = await fin(page).locator('.fin-course-debloque li').count();
  return gains + debloque;
}

test.describe('gains de fin de course', () => {
  // La route servie par le parcours doit passer par le réseau de la page, pas par le service worker.
  test.use({ serviceWorkers: 'block' });

  test.describe('avec du mouvement', () => {
    test.use({ reducedMotion: 'no-preference' });

    test('sauvegarde neuve : les gains arrivent un par un avec leur son, le total monte, puis l’écran complet', async ({ page }) => {
      test.setTimeout(900_000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await noterLesCartes(page);
      await raccourcirLaRoute(page);
      await sortir(page, 'Course 1 tour');
      await rouler(page, 'écran de fin', () => fin(page).isVisible());
      await expect(stage(page)).toHaveAttribute('data-depart', 'arrive');
      await expect(fin(page).getByRole('heading', { name: 'Arrivée' })).toBeVisible();

      // Le défilé : le bloc « Gains » est une liste qui s'allonge, jamais plus de cartes que de sons demandés.
      const liste = fin(page).locator('.notif-liste');
      await expect(liste).toBeVisible();
      await expect(fin(page).locator('.fin-course-defile')).toHaveAttribute('data-defilement', 'en-cours');
      await expect(liste).toHaveAttribute('role', 'log');
      await expect(fin(page).locator('.fin-course-gains')).toHaveCount(0);
      const cartes = fin(page).locator('.notif-carte');
      // La première carte est la prime de la course finie.
      await expect(cartes.first()).toContainText('Course d’un tour finie', { timeout: 30_000 });
      await expect(cartes.first()).toContainText(/\+\s*40\s\$/);
      await expect(cartes.first()).toHaveAttribute('data-genre', 'dollars');
      let milieu = false;
      let maxCartes = 0;
      let totalPrecedent = -1;
      // Le défilé est une minuterie de l'interface (pas du temps de route) : un délai d'horloge large suffit.
      const limite = Date.now() + 120_000;
      for (;;) {
        const n = await cartes.count();
        if (n > maxCartes) maxCartes = n;
        // Le total ne baisse jamais.
        const totalVu = fin(page).locator('.notif-total b');
        // Le total n'existe plus une fois l'écran complet : pas d'attente sur un élément parti.
        const lu = ((await totalVu.count()) > 0 ? ((await totalVu.textContent({ timeout: 2000 }).catch(() => null)) ?? '') : '').replace(/\D/g, '');
        const total = lu === '' ? totalPrecedent : Number(lu);
        expect(total).toBeGreaterThanOrEqual(totalPrecedent);
        totalPrecedent = total;
        const etat = await fin(page).locator('.fin-course-defile').getAttribute('data-defilement');
        // Une notification en cours : la capture de revue, dès que deux cartes sont là.
        if (!milieu && n >= 2 && etat === 'en-cours') {
          milieu = true;
          await photo(page, '01-portrait-notification-en-cours');
        }
        if (etat === 'fini') break;
        if (Date.now() > limite) throw new Error(`le défilé ne finit pas : ${n} cartes après 120 s`);
        await page.waitForTimeout(150);
      }
      expect(milieu, 'une capture en cours de défilé').toBe(true);

      // L'écran complet : tout se relit, et il n'y a eu ni plus ni moins de sons que de gains.
      await expect(fin(page).locator('.fin-course-gains')).toBeVisible();
      await expect(fin(page).locator('.fin-course-debloque')).toContainText('Premier tour de piste');
      await expect(fin(page).locator('.notif-liste')).toHaveCount(0);
      const lignes = await lignesDeLEcranComplet(page);
      expect(lignes).toBeGreaterThanOrEqual(2);
      // Chaque ligne de l'écran complet est passée par une carte, dans l'ordre (gains, hauts faits, objets).
      const titres = await fin(page).locator('.fin-course-gains li:not(.fin-course-total) > span, .fin-course-debloque li > span').allInnerTexts();
      const attendus = titres.map((t) => t.split('\n')[0]?.trim() ?? '');
      expect(await page.evaluate(() => window.__cartesVues), 'cartes vues pendant le défilé, dans l\'ordre').toEqual(attendus);
      expect(maxCartes).toBeGreaterThanOrEqual(1);
      const demandes = await nombre(voile(page), 'data-sons-demandes');
      expect(demandes, 'sons demandés au lecteur').toBe(lignes);
      // Les sons sont partis jusqu'au lecteur de la page (ogg décodés) quand le navigateur du test sait les jouer.
      const joues = await nombre(voile(page), 'data-sons-joues');
      console.log(`gains : ${lignes} gains affichés, ${demandes} sons demandés, ${joues} partis`);
      expect(joues).toBeGreaterThan(0);
      expect(joues).toBeLessThanOrEqual(demandes);
      await expect(voile(page)).toHaveAttribute('data-son-dernier', /^(gain|dollars)$/);
      // Rien ne bouge plus : pas de nouveau son une fois l'écran complet.
      await page.waitForTimeout(2500);
      expect(await nombre(voile(page), 'data-sons-demandes')).toBe(demandes);
      await photo(page, '02-portrait-ecran-complet');

      // Les boutons du bas sont à 48 px, et l'espace laissé sous les gains est net (la ligne du prochain rendez-vous).
      for (const nom of ['Rejouer', 'Rentrer au garage']) {
        const b = await fin(page).getByRole('button', { name: nom }).boundingBox();
        expect(b?.height ?? 0, nom).toBeGreaterThanOrEqual(48);
      }
      // Paysage : l'écran complet tient.
      await page.setViewportSize(PAYSAGE);
      await expect(fin(page).getByRole('button', { name: 'Rentrer au garage' })).toBeVisible();
      await photo(page, '03-paysage-ecran-complet');
      await page.setViewportSize(PORTRAIT);
      await rentrerDepuisLaFin(page);
      expect(errors).toEqual([]);
    });
  });

  test.describe('moins de mouvement', () => {
    test.use({ reducedMotion: 'reduce' });

    test('sauvegarde neuve : tout est là d’emblée, un seul son, une seule phrase pour le lecteur d’écran', async ({ page }) => {
      test.setTimeout(900_000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await raccourcirLaRoute(page);
      await sortir(page, 'Course 1 tour');
      await rouler(page, 'écran de fin', () => fin(page).isVisible());
      // Pas de défilé : l'écran complet d'emblée, la liste animée n'existe pas.
      await expect(fin(page).locator('.fin-course-gains')).toBeVisible();
      await expect(fin(page).locator('.fin-course-debloque')).toContainText('Premier tour de piste');
      await expect(fin(page).locator('.notif-liste')).toHaveCount(0);
      await expect(fin(page).locator('.fin-course-defile')).toHaveAttribute('data-defilement', 'fini');
      const lignes = await lignesDeLEcranComplet(page);
      expect(lignes).toBeGreaterThanOrEqual(2);
      // Un seul son pour tout le lot, `gain` puisqu'il y a un haut fait.
      await expect(voile(page)).toHaveAttribute('data-sons-demandes', '1');
      await expect(voile(page)).toHaveAttribute('data-son-dernier', 'gain');
      // La région vocale dit le lot une fois : le nombre de gains, le total, chaque titre.
      const vocal = fin(page).locator('.notif-vocal');
      await expect(vocal).toContainText(new RegExp(`^${lignes} gains, plus \\d+ dollars en tout\\.`));
      await expect(vocal).toContainText('Course d’un tour finie, plus 40 dollars.');
      await expect(vocal).toContainText('Haut fait : Premier tour de piste, plus 50 dollars.');
      await expect(vocal).toHaveAttribute('role', 'status');
      await expect(vocal).toHaveAttribute('aria-live', 'polite');
      // Rien ne se rejoue.
      await page.waitForTimeout(2500);
      await expect(voile(page)).toHaveAttribute('data-sons-demandes', '1');
      await photo(page, '04-portrait-moins-de-mouvement');
      await rentrerDepuisLaFin(page);
      expect(errors).toEqual([]);
    });
  });

  test.describe('le bout d’une balade', () => {
    test.use({ reducedMotion: 'no-preference' });

    test('balade menée au bout : ni gain ni haut fait, le dit, relance en course d’un tour ; un appui passe à l’écran complet', async ({ page }) => {
      test.setTimeout(1_200_000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await toucherDesLaPremiereCarte(page);
      await raccourcirLaRoute(page);
      await sortir(page, 'Balade');
      const arrivee = page.locator('.drive-arrivee');
      await rouler(page, 'panneau d’arrivée', () => arrivee.isVisible());
      await expect(stage(page)).toHaveAttribute('data-depart', 'arrive');
      // Le message clair, ni écran de fin ni gain ; un seul « Rentrer au garage », et le bouton qui relance en course.
      await expect(arrivee).toContainText('Balade : pour le plaisir, sans gain. Lance une course pour gagner des dollars et des hauts faits.');
      await expect(fin(page)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Rentrer au garage' })).toHaveCount(1);
      await expect(voile(page)).toHaveCount(0);
      for (const nom of ['Course d’un tour ici', 'Rentrer au garage']) {
        const b = await arrivee.getByRole('button', { name: nom }).boundingBox();
        expect(b?.height ?? 0, nom).toBeGreaterThanOrEqual(48);
      }
      await photo(page, '05-portrait-fin-de-balade');
      await page.setViewportSize(PAYSAGE);
      await expect(arrivee.getByRole('button', { name: 'Rentrer au garage' })).toBeVisible();
      await photo(page, '06-paysage-fin-de-balade');
      // « Course d'un tour ici » : même route, feux, à la main, « Tour 1/1 » (le format choisi devient 1 tour).
      await arrivee.getByRole('button', { name: 'Course d’un tour ici' }).tap();
      await expect(arrivee).toHaveCount(0);
      await expect(stage(page)).toHaveAttribute('data-depart', /^(attente|feux)$/, { timeout: DELAI_ROUTE });
      await expect(page.locator('.drive-mid')).toHaveAttribute('data-conduite', 'main');
      await expect(page.locator('.drive-chrono')).toHaveAttribute('data-tour', 'Tour 1/1', { timeout: DELAI_ROUTE });

      // La course finie sur une sauvegarde neuve : le défilé commence, un appui passe à l'écran complet.
      const zone = page.locator('.drive-mid');
      const box = await zone.boundingBox();
      if (!box) throw new Error('zone des gestes introuvable');
      await expect(stage(page)).toHaveAttribute('data-depart', 'parti', { timeout: DELAI_ROUTE });
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6 - 70, { steps: 4 });
      await attendreSurLaRoute(page, 'écran de fin', () => fin(page).isVisible(), (vu) => vu, { secondes: 60, horloge: 480_000, intervalle: 500 });
      await page.mouse.up();
      // Le saut s'est fait à la première carte (voir toucherDesLaPremiereCarte) : tout de suite l'écran complet, rien de perdu.
      const defile = fin(page).locator('.fin-course-defile');
      await expect(defile).toHaveAttribute('data-defilement', 'fini');
      const sauts = await page.evaluate(() => window.__sauts);
      expect(sauts).toHaveLength(1);
      expect(sauts[0]?.cartes).toBe(1);
      await expect(fin(page).locator('.fin-course-gains')).toBeVisible();
      await expect(fin(page).locator('.fin-course-debloque')).toContainText('Premier tour de piste');
      await expect(fin(page).locator('.notif-liste')).toHaveCount(0);
      await photo(page, '08-paysage-ecran-complet-apres-appui');
      const lignes = await lignesDeLEcranComplet(page);
      expect(lignes).toBeGreaterThanOrEqual(3);
      // Les cartes sautées sont muettes : seul le son de la première carte a été demandé.
      const demandes = await nombre(voile(page), 'data-sons-demandes');
      expect(demandes).toBe(1);
      await page.waitForTimeout(2500);
      expect(await nombre(voile(page), 'data-sons-demandes')).toBe(demandes);
      await page.setViewportSize(PORTRAIT);
      await rentrerDepuisLaFin(page);
      expect(errors).toEqual([]);
    });
  });
});
