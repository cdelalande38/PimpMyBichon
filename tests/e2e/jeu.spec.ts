// Le jeu : le solde au garage, la rubrique « Jeu » de l'Atelier (boutique, hauts faits), l'achat d'un pack
// (confirmation, solde insuffisant), la sauvegarde. Un solde est posé dans la sauvegarde avant le lancement.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openApp, reloadSaved, waitForScene } from './helpers.ts';

/** Captures de revue de la vague S : hors dépôt versionné, dans captures/vague-s-economie/. */
const CAPTURES = process.env.PMB_CAPTURES_ECONOMIE ?? resolve('captures', 'vague-s-economie');

async function photo(page: Page, nom: string): Promise<void> {
  mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURES, `${nom}.png`) });
}

/** Écrit la sauvegarde du jeu dans IndexedDB, puis relance l'app qui la relit. */
async function poserSauvegarde(page: Page, etat: Record<string, unknown>): Promise<void> {
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

/** Toute commande du panneau offre 48 px au doigt. */
async function commandesA48(page: Page): Promise<void> {
  const boutons = page.locator('dialog[open] button:visible');
  const nombre = await boutons.count();
  expect(nombre).toBeGreaterThan(0);
  for (let i = 0; i < nombre; i += 1) {
    const bouton = boutons.nth(i);
    const nom = (await bouton.innerText()).trim().replace(/\s+/g, ' ');
    const boite = await bouton.boundingBox();
    expect(boite, `« ${nom} » mesurable`).not.toBeNull();
    if (!boite) continue;
    expect(boite.height, `hauteur de « ${nom} »`).toBeGreaterThanOrEqual(48);
    expect(boite.width, `largeur de « ${nom} »`).toBeGreaterThanOrEqual(48);
  }
}

test.describe('jeu : dollars, boutique, hauts faits', () => {
  test('le solde au garage, un achat avec confirmation, un solde insuffisant, tout gardé au rechargement', async ({ page }) => {
    await openApp(page);
    await waitForScene(page);
    await poserSauvegarde(page, { solde: 180, articles: {}, hautsFaits: { 'premiere-course': true }, cumuls: { courses: 4, distance: 9300 } });

    // Au garage : le solde, discret, à côté de la marque.
    const solde = page.getByRole('button', { name: /Ton solde : 180 dollars/ });
    await expect(solde).toBeVisible();
    await expect(solde).toHaveText('180 $');
    const caseSolde = await solde.boundingBox();
    expect(caseSolde?.width).toBeGreaterThan(30);
    await photo(page, '01-garage-solde');

    // Un appui sur le solde ouvre Atelier › Jeu.
    await solde.tap();
    const panneau = page.getByRole('dialog', { name: 'Ton compte' });
    await expect(panneau).toBeVisible();
    await expect(page).toHaveURL(/#\/jeu$/);
    await expect(panneau.getByRole('status', { name: /Ton solde : 180 dollars/ })).toBeVisible();
    await expect(panneau.getByText(/4.courses finies/)).toBeVisible();
    await expect(panneau.getByRole('navigation', { name: 'Rubriques de l’atelier' }).getByRole('button', { name: 'Jeu', exact: true })).toHaveAttribute('aria-current', 'true');

    // La boutique : le pack de départ est offert, les trois autres s'achètent.
    await expect(panneau.getByText('Offert')).toBeVisible();
    const flammes = panneau.getByRole('button', { name: /Acheter Pack Flammes : 150 dollars/ });
    const course = panneau.getByRole('button', { name: /Acheter Pack Course : 300 dollars/ });
    await expect(flammes).toBeVisible();
    await commandesA48(page);
    await photo(page, '02-jeu-boutique');

    // Solde insuffisant : expliqué sans jargon, rien n'est débité.
    await course.tap();
    const manque = panneau.getByRole('alert');
    await expect(manque).toContainText('Il te manque 120 $');
    await expect(manque).toContainText('Une course d’un tour rapporte au moins 40 $');
    await commandesA48(page);
    await manque.scrollIntoViewIfNeeded();
    await photo(page, '03-jeu-solde-insuffisant');
    await manque.getByRole('button', { name: 'Compris' }).tap();
    await expect(panneau.getByRole('alert')).toHaveCount(0);
    await expect(panneau.getByRole('status', { name: /180 dollars/ })).toBeVisible();

    // Confirmation d'achat, puis achat : 180 − 150 = 30, et « Premier achat » rapporte 25.
    await flammes.tap();
    const confirmation = panneau.getByRole('group', { name: 'Acheter Pack Flammes' });
    await expect(confirmation).toContainText('Acheter le Pack Flammes pour 150 $ ? Il te restera 30 $.');
    await commandesA48(page);
    await photo(page, '04-jeu-confirmation');
    await confirmation.getByRole('button', { name: 'Pas maintenant' }).tap();
    await expect(panneau.getByRole('status', { name: /180 dollars/ })).toBeVisible();
    await flammes.tap();
    await panneau.getByRole('group', { name: 'Acheter Pack Flammes' }).getByRole('button', { name: 'Acheter', exact: true }).tap();
    await expect(panneau.getByRole('status').filter({ hasText: 'Pack Flammes acheté' })).toContainText('Haut fait : Premier achat.');
    // Le haut fait s'annonce aussi par la pile de cartes du garage (moins de mouvement : d'emblée) et un son.
    const pile = page.locator('.notif-garage');
    await expect(pile).toBeVisible();
    await expect(pile.locator('.notif-carte')).toHaveCount(1);
    await expect(pile.locator('.notif-carte')).toContainText('Premier achat');
    await expect(pile.locator('.notif-carte')).toContainText('+ 25 $');
    await expect(pile).toHaveAttribute('data-sons-demandes', '1');
    await expect(pile).toHaveAttribute('data-son-dernier', 'gain');
    await expect(panneau.getByRole('status', { name: /Ton solde : 55 dollars/ })).toBeVisible();
    await expect(panneau.getByRole('button', { name: /Acheter Pack Flammes/ })).toHaveCount(0);
    await expect(panneau.getByText('Acquis')).toBeVisible();
    await photo(page, '05-jeu-achete');

    // Les hauts faits : obtenus et à faire, avec l'avancement des cumuls.
    await panneau.getByRole('navigation', { name: 'Rubriques du jeu' }).getByRole('button', { name: 'Hauts faits' }).tap();
    await expect(panneau.getByText(/2 sur \d+ obtenus/)).toBeVisible();
    await expect(panneau.locator('[data-haut-fait="premiere-course"]')).toContainText('Obtenu');
    await expect(panneau.locator('[data-haut-fait="premier-achat"]')).toContainText('Obtenu');
    await expect(panneau.locator('[data-haut-fait="dix-courses"]')).toContainText('4 sur 10');
    await expect(panneau.locator('[data-haut-fait="dix-kilometres"]')).toContainText('9,3 km sur 10 km');
    await commandesA48(page);
    await photo(page, '06-jeu-hauts-faits');

    // Gardé au rechargement : le solde, l'achat, le haut fait.
    await panneau.getByRole('button', { name: 'Retour à l’atelier' }).tap();
    await expect(page.getByRole('button', { name: /Ton solde : 55 dollars/ })).toBeVisible();
    await reloadSaved(page);
    await waitForScene(page);
    await expect(page.getByRole('button', { name: /Ton solde : 55 dollars/ })).toBeVisible();
    await page.getByRole('button', { name: /Ton solde/ }).tap();
    await expect(page.getByRole('dialog', { name: 'Ton compte' }).getByText('Acquis')).toBeVisible();
  });

  test.describe('avec du mouvement', () => {
    test.use({ reducedMotion: 'no-preference' });

    test('le premier achat s’annonce au garage : une carte de haut fait, son « gain », puis la pile s’efface', async ({ page }) => {
      await openApp(page);
      await waitForScene(page);
      await poserSauvegarde(page, { solde: 180, articles: {}, hautsFaits: { 'premiere-course': true }, cumuls: { courses: 4, distance: 9300 } });
      await page.getByRole('button', { name: /Ton solde : 180 dollars/ }).tap();
      const panneau = page.getByRole('dialog', { name: 'Ton compte' });
      await panneau.getByRole('button', { name: /Acheter Pack Flammes : 150 dollars/ }).tap();
      await panneau.getByRole('group', { name: 'Acheter Pack Flammes' }).getByRole('button', { name: 'Acheter', exact: true }).tap();
      const pile = page.locator('.notif-garage');
      // La carte arrive après le délai de la première notification (0,6 s), avec son son.
      await expect(pile.locator('.notif-carte')).toHaveCount(1);
      await expect(pile.locator('.notif-carte')).toContainText('Premier achat');
      await expect(pile.locator('.notif-carte')).toHaveAttribute('data-genre', 'haut-fait');
      await expect(pile).toHaveAttribute('data-sons-demandes', '1');
      await expect(pile).toHaveAttribute('data-son-dernier', 'gain');
      await photo(page, '11-garage-annonce-premier-achat');
      // Les doigts passent à travers la pile : le panneau reste utilisable.
      await expect(pile).toHaveCSS('pointer-events', 'none');
      // Elle s'efface seule, une seule annonce pour un seul haut fait.
      await expect(pile).toHaveAttribute('data-actif', 'non', { timeout: 30_000 });
      await expect(pile.locator('.notif-carte')).toHaveCount(0);
      await expect(pile).toHaveAttribute('data-sons-demandes', '1');
    });
  });

  test('un haut fait déjà obtenu s’affiche, un trophée reste à gagner, et le lien direct #/jeu marche', async ({ page }) => {
    await openApp(page);
    await waitForScene(page);
    await poserSauvegarde(page, {
      solde: 40,
      articles: { 'sticker-trophee-or': true },
      hautsFaits: { 'premiere-course': true, 'premier-or': true },
      cumuls: { courses: 12, or: 1 },
    });
    await page.goto('./#/jeu');
    const panneau = page.getByRole('dialog', { name: 'Ton compte' });
    await expect(panneau).toBeVisible();
    await expect(panneau.getByText('Gagné', { exact: true })).toHaveCount(1);
    await expect(panneau.getByText('À gagner', { exact: true }).first()).toBeVisible();
    await panneau.getByRole('navigation', { name: 'Rubriques du jeu' }).getByRole('button', { name: 'Hauts faits' }).tap();
    await expect(panneau.locator('[data-haut-fait="premier-or"]')).toContainText('Obtenu');
    await expect(panneau.locator('[data-haut-fait="premier-or"]')).toContainText('Trophée d’or');
    await expect(panneau.locator('[data-haut-fait="vingt-cinq-courses"]')).toContainText('12 sur 25');
    await expect(panneau.locator('[data-haut-fait]')).toHaveCount(await panneau.locator('li.jeu-ligne').count());
  });

  test('en paysage : le solde au garage et le panneau', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await openApp(page);
    await waitForScene(page);
    await poserSauvegarde(page, { solde: 1250, hautsFaits: { 'premiere-course': true }, cumuls: { courses: 2 } });
    const solde = page.getByRole('button', { name: /Ton solde : 1250 dollars/ });
    await expect(solde).toBeVisible();
    await photo(page, '07-garage-solde-paysage');
    await solde.tap();
    const panneau = page.getByRole('dialog', { name: 'Ton compte' });
    await expect(panneau).toBeVisible();
    await expect(panneau.getByText('Pack Flammes').first()).toBeVisible();
    await commandesA48(page);
    await photo(page, '08-jeu-paysage');
  });

  for (const taille of ['grand', 'tres-grand'] as const) {
    test(`texte ${taille} : le solde ne touche pas les boutons ronds, aucune commande sous 48 px, rien ne déborde`, async ({ page }) => {
      await openApp(page);
      await waitForScene(page);
      await poserSauvegarde(page, { solde: 12_345, hautsFaits: { 'premiere-course': true }, cumuls: { courses: 2 } });
      await page.evaluate((valeur) => {
        document.documentElement.dataset.text = valeur;
      }, taille);
      const solde = page.getByRole('button', { name: /Ton solde : 12345 dollars/ });
      await expect(solde).toBeVisible();
      const boite = await solde.boundingBox();
      const rond = await page.getByRole('navigation', { name: 'Raccourcis' }).getByRole('button').first().boundingBox();
      expect(boite && rond && boite.x + boite.width < rond.x - 2).toBe(true);
      if (taille === 'tres-grand') await photo(page, '09-garage-solde-tres-grand');
      await solde.tap();
      const panneau = page.getByRole('dialog', { name: 'Ton compte' });
      await expect(panneau).toBeVisible();
      await commandesA48(page);
      const deborde = await panneau.locator('.card-scroll').evaluate((element) => element.scrollWidth > element.clientWidth + 1);
      expect(deborde, 'défilement horizontal').toBe(false);
      await panneau.getByRole('button', { name: /Acheter Pack Flammes/ }).scrollIntoViewIfNeeded();
      await panneau.getByRole('button', { name: /Acheter Pack Flammes/ }).tap();
      await commandesA48(page);
      if (taille === 'tres-grand') await photo(page, '10-jeu-tres-grand');
    });
  }
});
