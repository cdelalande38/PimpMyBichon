// Le mode carrière (vague U, 18 novembre 2026 ; src/data/carriere.ts, src/ui/carriere/) :
// - au garage, le bouton rond du prochain rendez-vous ; un appui ouvre le panneau de la carrière (PROVISOIRE :
//   déplié dans Atelier › Jeu, en attendant l'étape « Mode » du menu de la sortie) ; la fiche du premier
//   rendez-vous (zone, départ, météo, moment, format, objectif, prime, conseil) et « Sortir », entier,
//   en portrait comme en paysage ;
// - la sortie imposée : l'écran de route dit le rendez-vous et son objectif, les réglages ne laissent changer
//   ni la météo ni le moment ; la course finie ; l'écran de fin annonce le rendez-vous suivant, la prime
//   est dans les gains ; au garage, le rappel est passé au suivant, et le reste après un rechargement ;
// - l'échec (parcours long, PMB_CARRIERE_ECHEC=1) : un rendez-vous au bronze couru trop lentement, ce qui
//   manquait et de combien, « Retenter » repart aux feux, le rendez-vous reste le courant.
// Une course entière est trop longue en rendu logiciel : comme tests/e2e/courses.spec.ts, le parcours sert
// lui-même la route de la carte avec le départ du rendez-vous posé 120 m avant le bout (données servies au
// seul test ; l'app n'a aucune porte dérobée). La suite des rendez-vous est lue dans le fichier de données.
// Captures de revue à la demande : PMB_CAPTURES_CARRIERE=<dossier>.

import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { attendreSurLaRoute, commencerCourse, DELAI_ROUTE, fermerReglages, openApp, ouvrirReglages, reglerSortie, reloadSaved, rentrerAuGarage, tempsDeRoute, waitForScene } from './helpers.ts';

interface Rdv {
  id: string;
  titre: string;
  carte: string;
  depart: string;
  format: string;
  meteo: string;
  moment: string;
  objectif: string;
  prime: number;
}

const SUITE = (JSON.parse(readFileSync(resolve('public/assets/carriere/carriere.json'), 'utf8')) as { rendezVous: Rdv[] }).rendezVous;
const CAPTURES = process.env.PMB_CAPTURES_CARRIERE;
const PAYSAGE = { width: 844, height: 390 } as const;
const PORTRAIT = { width: 390, height: 844 } as const;

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const pastille = (page: Page) => page.getByRole('button', { name: /^Carrière : prochain rendez-vous/ });
const compte = (page: Page) => page.getByRole('dialog', { name: 'Ton compte' });

async function photo(page: Page, nom: string): Promise<void> {
  if (!CAPTURES) return;
  mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURES, `${nom}.png`) });
}

/** Écrit la sauvegarde du jeu dans IndexedDB, puis relance l'app qui la relit. */
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

/** Sert la route de la carte du rendez-vous avec son départ posé 120 m avant le bout. */
async function departPresDuBout(page: Page, rdv: Rdv): Promise<void> {
  await page.route(`**/assets/maps/${rdv.carte}/route.json`, async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as { length: number; starts: { id: string; at: number }[] };
    const depart = json.starts.find((start) => start.id === rdv.depart);
    if (depart) depart.at = json.length - 120;
    await route.fulfill({ response, json });
  });
}

/** La commande tient dans l'écran et offre 48 px au doigt. */
async function entiere(page: Page, commande: Locator, nom: string): Promise<void> {
  const boite = await commande.boundingBox();
  const vue = page.viewportSize();
  expect(boite, nom).not.toBeNull();
  if (!boite || !vue) return;
  expect(boite.height, `hauteur de « ${nom} »`).toBeGreaterThanOrEqual(48);
  expect(boite.width, `largeur de « ${nom} »`).toBeGreaterThanOrEqual(48);
  expect(boite.y, `« ${nom} » sous le haut`).toBeGreaterThanOrEqual(0);
  expect(boite.y + boite.height, `« ${nom} » au-dessus du bas`).toBeLessThanOrEqual(vue.height + 0.5);
  expect(boite.x + boite.width, `« ${nom} » dans la largeur`).toBeLessThanOrEqual(vue.width + 0.5);
  // Entière aussi dans les zones qui défilent autour d'elle (rien de rogné), et rien posé dessus.
  const rognee = await commande.evaluate((el) => {
    const r = el.getBoundingClientRect();
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (getComputedStyle(p).overflowY === 'visible') continue;
      const c = p.getBoundingClientRect();
      if (r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5) return `rognée par ${p.className || p.tagName}`;
    }
    for (const y of [r.top + 3, r.bottom - 3]) {
      const dessus = document.elementFromPoint(r.left + r.width / 2, y);
      if (!dessus || !el.contains(dessus)) return `couverte par ${dessus?.className || dessus?.tagName}`;
    }
    return '';
  });
  expect(rognee, nom).toBe('');
}

/** Le manche tenu vers le haut (direction assistée) : la route suit jusqu'au bout ; rend de quoi le lâcher. */
async function tenirLeGaz(page: Page): Promise<() => Promise<void>> {
  const zone = page.locator('.drive-mid');
  const box = await zone.boundingBox();
  if (!box) throw new Error('zone des gestes introuvable');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6 - 70, { steps: 4 });
  return () => page.mouse.up();
}

/** « Rentrer au garage préparer le véhicule », puis la confirmation éventuelle. */
async function rentrerPreparer(page: Page): Promise<void> {
  await page.locator('.carriere-fin').getByRole('button', { name: 'Rentrer au garage préparer le véhicule' }).tap();
  const question = page.getByRole('dialog', { name: 'Rentrer au garage ?' });
  const garage = page.getByRole('heading', { level: 1, name: 'PimpMyBichon' });
  await expect(question.or(garage)).toBeVisible();
  if (await question.isVisible()) await question.getByRole('button', { name: 'Rentrer', exact: true }).tap();
  await expect(stage(page)).toHaveCount(0);
}

test.describe('carrière : des rendez-vous imposés, annoncés à l’avance', () => {
  // La route servie par le parcours doit passer par le réseau de la page, pas par le service worker.
  test.use({ serviceWorkers: 'block' });

  test('premier rendez-vous : panneau, sortie imposée, course finie, annonce du suivant, rappel au garage gardé au rechargement', async ({ page }) => {
    test.setTimeout(600_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const [premier, second] = SUITE;
    if (!premier || !second) throw new Error('carrière vide');
    await departPresDuBout(page, premier);
    await openApp(page);
    await waitForScene(page);

    // Au garage : le bouton rond du prochain rendez-vous, dans la colonne des raccourcis, 48 px au doigt.
    await expect(pastille(page)).toHaveAccessibleName(new RegExp(`^Carrière : prochain rendez-vous 1 sur ${SUITE.length}, ${premier.titre}`));
    await entiere(page, pastille(page), 'bouton rond de la carrière');
    await photo(page, '01-garage-bouton-portrait');

    // Un appui ouvre la carrière (provisoire : Atelier › Jeu, panneau déplié).
    await pastille(page).tap();
    const panneau = compte(page).getByRole('region', { name: 'Carrière', exact: true });
    await expect(panneau).toBeVisible();
    const fiche = panneau.locator(`.carriere-fiche[data-rendez-vous="${premier.id}"]`);
    await expect(fiche).toContainText(`Rendez-vous 1 sur ${SUITE.length}`);
    await expect(fiche).toContainText(premier.titre);
    await expect(fiche.locator('.carriere-fiche-depart')).not.toHaveText(/…|indisponible/);
    await expect(fiche).toContainText(premier.meteo === 'sec' ? 'Au sec' : premier.meteo === 'pluie' ? 'Sous la pluie' : 'Sous la neige');
    await expect(fiche).toContainText(premier.moment === 'jour' ? 'De jour' : 'De nuit');
    await expect(fiche).toContainText(premier.format === 'tour1' ? 'Course 1 tour' : 'Course 3 tours');
    await expect(fiche).toContainText(premier.objectif === 'finir' ? 'Finir la course' : 'Le bronze au moins');
    await expect(fiche).toContainText(`${premier.prime} $`);
    await expect(fiche.locator('.carriere-fiche-conseil')).not.toBeEmpty();
    // Rien à choisir : ni météo, ni moment, ni format.
    await expect(panneau.getByRole('group')).toHaveCount(0);
    const sortir = panneau.getByRole('button', { name: 'Sortir', exact: true });
    await entiere(page, sortir, 'Sortir (portrait)');
    await photo(page, '02-panneau-portrait');

    // Paysage : « Sortir » reste entier, dans le panneau latéral et dans une colonne aussi étroite que le menu.
    await page.setViewportSize(PAYSAGE);
    // En tournant le téléphone, la zone qui défile change de hauteur : le rappel revient en haut, comme à l'ouverture.
    await compte(page).locator('.carriere-rappel').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await entiere(page, sortir, 'Sortir (paysage)');
    await entiere(page, compte(page).getByRole('button', { name: 'Replier' }), 'Replier (paysage)');
    await photo(page, '03-panneau-paysage');
    const etroit = await page.addStyleTag({ content: 'body .sheet { width: 16rem !important; }' });
    await compte(page).locator('.carriere-rappel').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await entiere(page, sortir, 'Sortir (colonne de 16 rem)');
    await entiere(page, compte(page).getByRole('button', { name: 'Replier' }), 'Replier (colonne de 16 rem)');
    await photo(page, '03b-panneau-colonne-etroite');
    await etroit.evaluate((el) => el.parentNode?.removeChild(el));
    await page.setViewportSize(PORTRAIT);

    // La sortie, tout imposé.
    await sortir.tap();
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
    const etiquette = page.locator('.drive-rendez-vous');
    await expect(etiquette).toContainText(`Rendez-vous 1 sur ${SUITE.length}`);
    await expect(etiquette).toContainText(premier.objectif === 'finir' ? 'Objectif : finir' : 'Objectif : bronze');
    const reglages = await ouvrirReglages(page);
    for (const groupe of ['Météo', 'Moment']) {
      const puces = reglages.getByRole('group', { name: groupe }).getByRole('button');
      await expect(puces.first()).toBeDisabled();
      await expect(reglages.getByRole('group', { name: groupe }).locator('[aria-pressed="true"]')).toHaveCount(1);
    }
    await expect(reglages.getByText(`imposé par le rendez-vous 1`)).toBeVisible();
    await fermerReglages(page);
    await reglerSortie(page, 'Direction', 'Assistée');

    // La course, jusqu'à la ligne.
    await commencerCourse(page, { parti: true });
    await expect(page.locator('.drive-chrono')).toHaveAttribute('data-tour', /Tour 1\//);
    const lacher = await tenirLeGaz(page);
    const fin = page.locator('.fin-course');
    await attendreSurLaRoute(page, 'écran de fin', () => fin.isVisible(), (vu) => vu, { secondes: 60, horloge: 480_000, intervalle: 500 });
    await lacher();
    const bloc = fin.locator('.carriere-fin');
    await expect(bloc).toHaveAttribute('data-verdict', 'reussi');
    await expect(bloc.getByRole('heading', { name: 'Rendez-vous 1 réussi' })).toBeVisible();
    await expect(fin.locator('.fin-course-gains')).toContainText('Prime du rendez-vous 1');
    await expect(fin.locator('.fin-course-gains')).toContainText(`+ ${premier.prime} $`);
    await expect(bloc).toContainText('Prochain rendez-vous');
    await expect(bloc.locator(`.carriere-fiche[data-rendez-vous="${second.id}"]`)).toContainText(second.titre);
    await expect(bloc.getByRole('button', { name: 'Retenter' })).toHaveCount(0);
    const rentrer = bloc.getByRole('button', { name: 'Rentrer au garage préparer le véhicule' });
    await rentrer.scrollIntoViewIfNeeded();
    await entiere(page, rentrer, 'Rentrer au garage préparer le véhicule');
    await bloc.scrollIntoViewIfNeeded();
    await photo(page, '04-fin-annonce-portrait');
    await page.setViewportSize(PAYSAGE);
    await bloc.scrollIntoViewIfNeeded();
    await photo(page, '05-fin-annonce-paysage');
    await page.setViewportSize(PORTRAIT);

    // Au garage : le rappel est passé au suivant, sans bandeau sur la scène.
    await rentrerPreparer(page);
    await expect(pastille(page)).toHaveAccessibleName(new RegExp(`prochain rendez-vous 2 sur ${SUITE.length}, ${second.titre}`));
    await page.getByRole('button', { name: /Ton solde/ }).tap();
    const rappel = compte(page).locator('.carriere-rappel');
    await expect(rappel).toContainText(`Prochain rendez-vous : 2 sur ${SUITE.length}, ${second.titre}`);
    await photo(page, '06-rappel-jeu-portrait');
    await page.setViewportSize(PAYSAGE);
    await photo(page, '07-rappel-jeu-paysage');
    await page.setViewportSize(PORTRAIT);
    await compte(page).getByRole('button', { name: 'Retour à l’atelier' }).tap();
    await expect(compte(page)).toHaveCount(0);

    // Rechargement : la progression est gardée.
    await reloadSaved(page);
    await waitForScene(page);
    await expect(pastille(page)).toHaveAccessibleName(new RegExp(`prochain rendez-vous 2 sur ${SUITE.length}`));
    await entiere(page, pastille(page), 'bouton rond de la carrière (portrait)');
    await page.setViewportSize(PAYSAGE);
    await entiere(page, pastille(page), 'bouton rond de la carrière (paysage)');
    await photo(page, '08-garage-bouton-paysage');
    expect(errors).toEqual([]);
  });

  test('objectif manqué : ce qui manquait et de combien, « Retenter » repart aux feux, le rendez-vous reste le courant', async ({ page }) => {
    // Il faut rester plus longtemps que le temps du bronze (plus d'une minute et demie de route) : long en
    // rendu logiciel. Hors de la passe courante et de la CI. Le 18 novembre 2026, sur un poste chargé par
    // plusieurs agents, la scène n'a avancé que de 22 s de route en 15 min : à lancer sur une machine calme.
    test.skip(!process.env.PMB_CARRIERE_ECHEC, 'parcours long : PMB_CARRIERE_ECHEC=1 pour le lancer');
    test.setTimeout(1_200_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Le premier rendez-vous au bronze, au sec, sur une route ouverte (le départ peut se rapprocher du bout).
    const index = SUITE.findIndex((r) => r.objectif === 'bronze' && r.meteo === 'sec' && r.format === 'tour1');
    const rdv = SUITE[index];
    if (!rdv) throw new Error('aucun rendez-vous au bronze, au sec, en un tour');
    const numero = index + 1;
    await departPresDuBout(page, rdv);
    await openApp(page);
    await waitForScene(page);
    const reussis = Object.fromEntries(SUITE.slice(0, index).map((r) => [r.id, { reussi: true, essais: 1, meilleurTemps: 60, medaille: null }]));
    await poserJeu(page, { solde: 500, articles: {}, hautsFaits: {}, cumuls: {}, carriere: { resultats: reussis } });
    await expect(pastille(page)).toHaveAccessibleName(new RegExp(`prochain rendez-vous ${numero} sur ${SUITE.length}`));
    await pastille(page).tap();
    await compte(page).getByRole('region', { name: 'Carrière', exact: true }).getByRole('button', { name: 'Sortir', exact: true }).tap();
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
    const objectif = (await page.locator('.drive-rendez-vous small').textContent()) ?? '';
    const lu = /sous (\d+):(\d\d\.\d)/.exec(objectif);
    expect(lu, objectif).not.toBeNull();
    const seuil = Number(lu?.[1]) * 60 + Number(lu?.[2]);
    await reglerSortie(page, 'Direction', 'Assistée');
    await commencerCourse(page, { parti: true });
    // Arrêté sur la ligne, le temps de dépasser le bronze ; puis jusqu'au bout.
    await attendreSurLaRoute(page, 'temps du bronze dépassé', () => tempsDeRoute(page), (t) => t > seuil + 3, { secondes: seuil + 30, horloge: 900_000, intervalle: 1000 });
    const lacher = await tenirLeGaz(page);
    const fin = page.locator('.fin-course');
    await attendreSurLaRoute(page, 'écran de fin', () => fin.isVisible(), (vu) => vu, { secondes: 60, horloge: 480_000, intervalle: 500 });
    await lacher();
    const bloc = fin.locator('.carriere-fin');
    await expect(bloc).toHaveAttribute('data-verdict', 'manque');
    await expect(bloc.getByRole('heading', { name: `Rendez-vous ${numero} manqué` })).toBeVisible();
    await expect(bloc).toContainText(/Il fallait le bronze, sous \d+:\d\d\.\d\. Tu as mis \d+:\d\d\.\d : \d+,\d s de trop\./);
    await expect(fin.locator('.fin-course-gains')).not.toContainText('Prime du rendez-vous');
    const retenter = bloc.getByRole('button', { name: 'Retenter' });
    await retenter.scrollIntoViewIfNeeded();
    await entiere(page, retenter, 'Retenter');
    await photo(page, '09-fin-manque-portrait');
    // Retenter : mêmes conditions imposées, retour sur la ligne, aux feux.
    await retenter.tap();
    await expect(fin).toHaveCount(0);
    await expect(stage(page)).toHaveAttribute('data-depart', /^(attente|feux)$/, { timeout: DELAI_ROUTE });
    await expect(page.locator('.drive-rendez-vous')).toContainText(`Rendez-vous ${numero} sur ${SUITE.length}`);
    // Rentrer : le rendez-vous reste le courant (rien de perdu).
    await rentrerAuGarage(page);
    await expect(stage(page)).toHaveCount(0);
    await expect(pastille(page)).toHaveAccessibleName(new RegExp(`prochain rendez-vous ${numero} sur ${SUITE.length}`));
    expect(errors).toEqual([]);
  });
});
