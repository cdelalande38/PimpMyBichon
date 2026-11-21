// Course et pilote automatique (vague U, demande du 18 novembre 2026) : si le pilote automatique prend le
// volant pendant une course, la course devient une balade (plus d'arrivée, de résultat ni de gain :
// src/drive/course.ts) et l'écran le dit :
// - avant : la commande « Pilote automatique » des réglages prévient (texte visible, sans fenêtre de
//   confirmation) ; hors course (balade), elle n'a rien à dire ;
// - au moment où ça arrive : une annonce sur la route (role="status"), qui s'efface seule ;
// - après : l'affichage de course (« Tour 1/1 ») laisse la place à celui de la balade, et la rentrée au
//   garage n'ouvre aucun écran de résultat.
// Délais comptés en secondes de route (tests/e2e/helpers.ts). Les captures de revue (le menu Garage avec
// « Sortie », l'écran d'entrée, l'annonce) ne tournent qu'à la demande : PMB_CAPTURES_BALADE=<dossier>.

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { BALADE_MONTREE, MESSAGE_BALADE, PREVENIR_BALADE } from '../../src/ui/drive/baladeAnnonce.ts';
import { attendreSurLaRoute, auSec, backToSections, commencerCourse, DELAI_ROUTE, ENTREE_SORTIE, openApp, openEntry, ouvrirReglages, pickMap, rentrerAuGarage, tempsDeRoute, waitForScene } from './helpers.ts';

const CAPTURES = process.env.PMB_CAPTURES_BALADE;

async function photo(page: Page, nom: string): Promise<void> {
  if (!CAPTURES) return;
  mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURES, `${nom}.png`) });
}

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const dock = (page: Page) => page.locator('footer.dock');
const annonce = (page: Page) => page.locator('.drive-balade-annonce');

/** Miami Beach (route ouverte), au sec, au format voulu : la route prête, à l'aperçu. */
async function partir(page: Page, nomFormat: string): Promise<void> {
  await openApp(page);
  await waitForScene(page);
  await openEntry(page, ENTREE_SORTIE);
  // Le format est le mode choisi sur l'écran « Jouer » (vague X) : la balade, ou la course d'un tour.
  await pickMap(page, 0, nomFormat === 'Balade' ? 'balade' : 'course');
  await expect(dock(page).getByRole('button', { name: 'Jouer', exact: true })).toContainText(nomFormat);
  await auSec(page);
  await dock(page).getByRole('button', { name: 'Jouer', exact: true }).tap();
  await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
}

test.describe('la course devient une balade quand le pilote automatique prend le volant', () => {
  test('course en 1 tour : la commande prévient, l’annonce vient et s’efface, pas de résultat', async ({ page }) => {
    test.setTimeout(600_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await partir(page, 'Course 1 tour');
    await commencerCourse(page, { parti: true });
    const chrono = page.locator('.drive-chrono');
    await expect(chrono).toHaveAttribute('data-tour', 'Tour 1/1', { timeout: DELAI_ROUTE });
    // Avant l'annonce : rien à l'écran, et un élément annoncé politement qui attend.
    await expect(annonce(page)).toHaveAttribute('role', 'status');
    await expect(annonce(page)).toHaveText('');

    // Avant : la commande dit ce qu'elle coûte, en clair et dans son nom accessible, sans fenêtre à confirmer.
    const panneau = await ouvrirReglages(page);
    const commande = panneau.getByRole('button', { name: 'Pilote automatique' });
    await expect(commande).toContainText(PREVENIR_BALADE);
    await expect(commande).toHaveAccessibleName(new RegExp(`^Pilote automatique\\s+${PREVENIR_BALADE}$`));
    expect((await commande.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    await photo(page, '03-commande-prevenue');
    await commande.tap();
    await expect(panneau).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    // Au moment où ça arrive : l'annonce, lisible, annoncée par le lecteur d'écran.
    await expect(annonce(page)).toHaveText(MESSAGE_BALADE, { timeout: DELAI_ROUTE });
    await expect(annonce(page)).toHaveAttribute('data-visible', 'oui');
    expect(MESSAGE_BALADE).toContain('balade');
    expect(MESSAGE_BALADE).toContain('sans gain');
    await photo(page, '04-annonce-balade');

    // Après : plus d'affichage de course (« Tour 1/1 »), le chrono de la balade continue de tourner.
    await expect(chrono).toHaveAttribute('data-tour', '');
    await expect(chrono).not.toContainText('/1');
    const avant = await tempsDeRoute(page);
    // L'annonce s'efface seule, après BALADE_MONTREE secondes de route.
    await attendreSurLaRoute(page, 'annonce de la balade', () => annonce(page).getAttribute('data-visible'), (v) => v === 'non', { secondes: BALADE_MONTREE + 8 });
    await expect(annonce(page)).toHaveText('');
    expect((await tempsDeRoute(page)) - avant).toBeGreaterThan(0);
    await expect(chrono).toHaveAttribute('data-tour', '');
    await expect(page.locator('.fin-course')).toHaveCount(0);

    // La rentrée au garage ne montre aucun écran de résultat de course.
    await rentrerAuGarage(page);
    await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeVisible();
    await expect(page.locator('.fin-course')).toHaveCount(0);
    await expect(stage(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('balade : la commande n’a rien à dire et rien n’est annoncé', async ({ page }) => {
    test.setTimeout(480_000);
    await partir(page, 'Balade');
    await commencerCourse(page, { parti: true });
    const panneau = await ouvrirReglages(page);
    const commande = panneau.getByRole('button', { name: 'Pilote automatique' });
    await expect(commande).toHaveAccessibleName('Pilote automatique');
    await expect(panneau.getByText(PREVENIR_BALADE)).toHaveCount(0);
    await commande.tap();
    await expect(panneau).toHaveCount(0);
    // Quelques secondes de route sans rien d'annoncé : une balade reste une balade.
    await attendreSurLaRoute(page, 'quelques secondes de balade', () => tempsDeRoute(page), (t) => t > 0, { secondes: 20 });
    const depart = await tempsDeRoute(page);
    await attendreSurLaRoute(page, 'trois secondes de plus', () => tempsDeRoute(page), (t) => t - depart >= 3, { secondes: 20 });
    await expect(annonce(page)).toHaveText('');
    await expect(annonce(page)).toHaveAttribute('data-visible', 'non');
    await rentrerAuGarage(page);
  });
});

test.describe('Sortie : captures de revue', () => {
  test.skip(!CAPTURES, 'captures de revue : PMB_CAPTURES_BALADE=<dossier>');

  test('le menu Garage avec « Sortie », puis l’écran d’entrée', async ({ page }) => {
    test.setTimeout(300_000);
    await openApp(page);
    await waitForScene(page);
    await backToSections(page);
    await dock(page).getByRole('navigation', { name: 'Onglets de l’atelier' }).getByRole('button', { name: 'Garage', exact: true }).tap();
    // Garage n'a plus que l'ambiance (vague X) : « Jouer » reste, lui, à une touche.
    await expect(dock(page).getByRole('button', { name: 'Jouer', exact: true })).toBeVisible();
    await photo(page, '01-menu-garage');
    await openEntry(page, ENTREE_SORTIE);
    await pickMap(page);
    await photo(page, '02-entree-sortie');
  });
});
