// Mécanique · Moteur (vague U) : l'établi. Ouvrir l'entrée sort le moteur de la Cox sur son support (le
// fichier ne se charge qu'à ce moment-là), cadré au-dessus du panneau ; la vue éclatée écarte les
// pièces ; on choisit une pièce, son traitement payant porte un cadenas et son prix, l'achat se fait sur
// place (solde suffisant, puis insuffisant), le traitement s'applique, la peinture (libre) aussi, tout
// est gardé au rechargement, et fermer l'entrée remet le véhicule. Un moteur sans modèle (le van) le dit.
// Les captures de revue (chaque famille : assemblée, éclatée, une pièce chromée, une pièce peinte) ne
// tournent qu'à la demande : PMB_CAPTURES_MOTEUR=<dossier>.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { backToSections, openApp, openEntry, quick, readBuilds, reloadSaved, waitForBench, waitForScene, waitForStill } from './helpers.ts';

const CAPTURES = process.env.PMB_CAPTURES_MOTEUR;

async function photo(page: Page, nom: string): Promise<void> {
  if (!CAPTURES) return;
  mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURES, `${nom}.png`) });
}

/** Écrit dans IndexedDB la sauvegarde du jeu et, au besoin, celle des builds, puis relance l'app qui les relit. */
async function poserSauvegarde(page: Page, saves: { jeu?: Record<string, unknown>; builds?: Record<string, unknown> }): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const transaction = open.result.transaction('kv', 'readwrite');
          const store = transaction.objectStore('kv');
          if (value.jeu) store.put(JSON.stringify({ state: value.jeu, version: 1 }), 'pmb-jeu');
          if (value.builds) store.put(JSON.stringify({ state: value.builds, version: 1 }), 'pmb-builds');
          transaction.oncomplete = () => done();
          transaction.onerror = () => fail(transaction.error);
        };
      }),
    saves,
  );
  await reloadSaved(page);
  await waitForScene(page);
}

function stage(page: Page) {
  return page.locator('.stage');
}

function panneau(page: Page) {
  return page.locator('footer.dock [data-testid="moteur"]');
}

function piece(page: Page, id: string) {
  return panneau(page).locator(`.moteur-piece[data-piece="${id}"]`);
}

function traitement(page: Page, id: string) {
  return panneau(page).locator(`.moteur-traitement[data-traitement="${id}"]`);
}

/** Toute commande visible du panneau offre 48 px au doigt (celles des rangées qui défilent hors champ exceptées). */
async function commandesA48(page: Page): Promise<void> {
  const largeur = page.viewportSize()?.width ?? 390;
  const commandes = panneau(page).locator('button:visible, label:visible, input[type="range"]:visible');
  const nombre = await commandes.count();
  expect(nombre).toBeGreaterThan(5);
  for (let i = 0; i < nombre; i += 1) {
    const commande = commandes.nth(i);
    const boite = await commande.boundingBox();
    if (!boite || boite.x + boite.width < 0 || boite.x > largeur) continue;
    const nom = ((await commande.getAttribute('aria-label')) ?? (await commande.innerText())).trim().replace(/\s+/g, ' ');
    expect(boite.height, `hauteur de « ${nom} »`).toBeGreaterThanOrEqual(47.5);
    if ((await commande.getAttribute('type')) !== 'range') expect(boite.width, `largeur de « ${nom} »`).toBeGreaterThanOrEqual(47.5);
  }
}

/** Le moteur (sa boîte projetée) tient à l'écran, au-dessus du dock. */
async function etabliAuDessusDuDock(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const raw = await stage(page).getAttribute('data-vehicule-ecran');
        const dockTop = (await page.locator('footer.dock').boundingBox())?.y ?? 0;
        if (!raw) return 'pas de cadre';
        const [top = -1, bottom = 1e9] = raw.split(',').map(Number);
        if (top < 0) return `haut coupé (${top})`;
        if (bottom > dockTop + 2) return `bas sous le dock (${bottom} > ${Math.round(dockTop)})`;
        return 'ok';
      },
      { message: 'établi au-dessus du dock', timeout: 30_000 },
    )
    .toBe('ok');
}

/** Taille du texte, par Atelier › Réglages › Texte. */
async function tailleDuTexte(page: Page, taille: 'Normal' | 'Grand' | 'Très grand'): Promise<void> {
  await quick(page).getByRole('button', { name: 'Atelier', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Réglages' });
  await dialog.getByRole('button', { name: 'Texte' }).click();
  await dialog.getByRole('button', { name: new RegExp(`^${taille}`) }).click();
  await dialog.getByRole('button', { name: 'Retour à l’atelier' }).click();
  await expect(dialog).toBeHidden();
}

const JEU = (solde: number) => ({ solde, articles: {}, hautsFaits: { 'premier-achat': true }, cumuls: {} });

test.describe('Mécanique · Moteur', () => {
  test('établi : moteur sorti, vue éclatée, pièce choisie, traitement verrouillé, achat, appliqué, gardé, retour au véhicule', async ({ page }) => {
    test.setTimeout(420_000);
    await openApp(page);
    await waitForScene(page);
    await poserSauvegarde(page, { jeu: JEU(300), builds: { current: 'cox', builds: {}, recents: [] } });
    await waitForBench(page);
    await expect(stage(page)).toHaveAttribute('data-vehicle', 'cox');

    // Rien n'est chargé tant que l'entrée n'est pas ouverte.
    const moteurs: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/assets/shared/engines/')) moteurs.push(request.url());
    });
    await page.waitForTimeout(500);
    expect(moteurs).toEqual([]);

    await openEntry(page, 'Moteur');
    await expect(stage(page)).toHaveAttribute('data-etabli', 'quatre-a-plat', { timeout: 120_000 });
    expect(moteurs.some((url) => url.endsWith('/assets/shared/engines/quatre-a-plat/moteur.glb'))).toBe(true);
    await expect(panneau(page)).toHaveAttribute('data-famille', 'quatre-a-plat');
    await expect(panneau(page).locator('.moteur-note')).toHaveText('4 cylindres à plat refroidi par air · modèle provisoire');
    await etabliAuDessusDuDock(page);
    await expect(stage(page)).toHaveAttribute('data-eclate', '0');
    // À l'ouverture, aucune pièce n'est encore touchée : rien ne s'allume.
    await expect(stage(page)).not.toHaveAttribute('data-etabli-piece', /.+/);
    await waitForStill(page);
    await photo(page, '01-cox-assemble');

    // Vue éclatée.
    await panneau(page).getByTestId('moteur-eclate').fill('80');
    await expect(stage(page)).toHaveAttribute('data-eclate', '80');
    await expect(panneau(page).locator('.moteur-eclate output')).toHaveText('80 %');
    await waitForStill(page);
    await photo(page, '02-cox-eclate');

    // Une pièce : les cache-culbuteurs, surlignés dans la scène ; brut de fonderie d'origine.
    await piece(page, 'cache_culbuteurs').tap();
    await expect(panneau(page)).toHaveAttribute('data-piece', 'cache_culbuteurs');
    await expect(stage(page)).toHaveAttribute('data-etabli-piece', 'cache_culbuteurs');
    await expect(panneau(page)).toHaveAttribute('data-traitement', 'brut');
    await expect(traitement(page, 'brut')).toHaveAttribute('aria-pressed', 'true');
    await expect(traitement(page, 'peinture')).not.toHaveAttribute('data-verrou', 'ferme');
    for (const id of ['chrome', 'poli', 'brosse', 'anodise', 'noir_satine']) await expect(traitement(page, id)).toHaveAttribute('data-verrou', 'ferme');
    await expect(traitement(page, 'chrome')).toHaveAccessibleName('Chrome, verrouillé : 260 dollars');
    await expect(traitement(page, 'chrome').locator('.moteur-prix .moteur-lock')).toBeVisible();
    await expect(traitement(page, 'chrome')).toContainText('260 $');
    await commandesA48(page);

    // Le chrome coûte 260 $, il y en a 300 : confirmation, achat, appliqué tout de suite.
    await traitement(page, 'chrome').tap();
    const confirmation = panneau(page).locator('.jeu-achat[data-etat="confirmation"]');
    await expect(confirmation).toContainText('Acheter le chrome pour 260 $');
    await confirmation.getByRole('button', { name: 'Acheter' }).tap();
    await expect(panneau(page)).toHaveAttribute('data-traitement', 'chrome');
    await expect(panneau(page).locator('.moteur-message')).toContainText('le chrome est à toi');
    await expect(traitement(page, 'chrome')).not.toHaveAttribute('data-verrou', 'ferme');
    await expect(piece(page, 'cache_culbuteurs')).toContainText('Chrome');

    // Le poli miroir coûte 160 $ : il en reste 40, il manque 120 $.
    await traitement(page, 'poli').tap();
    const insuffisant = panneau(page).locator('.jeu-achat[data-etat="insuffisant"]');
    await expect(insuffisant).toContainText('Il te manque 120 $ pour le poli miroir');
    await insuffisant.getByRole('button', { name: 'Compris' }).tap();
    await expect(insuffisant).toHaveCount(0);
    await expect(panneau(page)).toHaveAttribute('data-traitement', 'chrome');

    // La peinture haute température est libre : les tôles en rouge, puis une teinte de la palette.
    await piece(page, 'toles').tap();
    await traitement(page, 'peinture').tap();
    await expect(panneau(page)).toHaveAttribute('data-traitement', 'peinture');
    const teintes = panneau(page).locator('.moteur-swatches button');
    await teintes.nth(1).tap();
    await expect(teintes.nth(1)).toHaveAttribute('aria-pressed', 'true');

    // Le filtre à air s'échange : le boîtier d'origine est posé, les deux autres s'achètent.
    await piece(page, 'filtres').tap();
    await expect(panneau(page)).toHaveAttribute('data-option', 'boitier');
    await expect(panneau(page).locator('.moteur-option[data-option="cornets"]')).toHaveAttribute('data-verrou', 'ferme');
    await expect(panneau(page).locator('.moteur-option[data-option="coniques"]')).toHaveAccessibleName('Filtre conique, verrouillé : 80 dollars');
    await panneau(page).getByTestId('moteur-eclate').fill('0');
    await waitForStill(page);
    await photo(page, '03-cox-chrome-et-peinture');

    // Gardé dans la sauvegarde, sans champ nouveau : partPaints.moteur_<pièce>.
    await expect
      .poll(async () => {
        const saved = (await readBuilds(page))?.builds.cox as { partPaints?: Record<string, { finish?: string; color?: string }> } | undefined;
        return [saved?.partPaints?.moteur_cache_culbuteurs?.finish, saved?.partPaints?.moteur_toles?.finish];
      })
      .toEqual(['chrome', 'brillant']);

    // Rechargement : on revient à l'établi, rien n'a bougé.
    await reloadSaved(page);
    await waitForScene(page);
    await waitForBench(page);
    await openEntry(page, 'Moteur');
    await expect(stage(page)).toHaveAttribute('data-etabli', 'quatre-a-plat', { timeout: 120_000 });
    await expect(piece(page, 'cache_culbuteurs')).toContainText('Chrome');
    await expect(piece(page, 'toles')).toContainText('Peinture haute température');
    await piece(page, 'cache_culbuteurs').tap();
    await expect(panneau(page)).toHaveAttribute('data-traitement', 'chrome');
    await expect(traitement(page, 'chrome')).not.toHaveAttribute('data-verrou', 'ferme');

    // Fermer l'entrée remet le véhicule.
    await backToSections(page);
    await expect(stage(page)).not.toHaveAttribute('data-etabli', /.+/);
    await expect(stage(page)).toHaveAttribute('data-bench', 'pret');
    await expect(stage(page)).toHaveAttribute('data-vehicule-ecran', /^\d+,\d+$/);
    await waitForStill(page);
    await photo(page, '04-cox-retour-vehicule');
  });

  test('un moteur sans modèle le dit ; « D’origine » remet tout le moteur ; grand texte et paysage', async ({ page }) => {
    test.setTimeout(420_000);
    await openApp(page);
    await waitForScene(page);
    await poserSauvegarde(page, {
      jeu: JEU(0),
      builds: { current: 'van', builds: { cox: { paints: {}, parts: { moteur_filtres: 'coniques' }, partPaints: { moteur_carters: { finish: 'chrome' }, moteur_toles: { finish: 'brillant', color: '#00aa55' } } } }, recents: [] },
    });
    await waitForBench(page);

    // Le van : son moteur n'a pas encore de modèle, l'entrée le dit et le véhicule reste.
    await openEntry(page, 'Moteur');
    await expect(panneau(page).locator('.moteur-empty')).toContainText('Le van attend encore le modèle de son moteur');
    await expect(stage(page)).not.toHaveAttribute('data-etabli', /.+/);
    await expect(stage(page)).toHaveAttribute('data-vehicle', 'van');

    // La Cox, avec un moteur déjà traité : « D'origine » remet tout.
    await poserSauvegarde(page, {
      builds: { current: 'cox', builds: { cox: { paints: {}, parts: { moteur_filtres: 'coniques' }, partPaints: { moteur_carters: { finish: 'chrome' }, moteur_toles: { finish: 'brillant', color: '#00aa55' } } } }, recents: [] },
    });
    await waitForBench(page);
    await openEntry(page, 'Moteur');
    await expect(stage(page)).toHaveAttribute('data-etabli', 'quatre-a-plat', { timeout: 120_000 });
    await expect(panneau(page)).toHaveAttribute('data-traitement', 'chrome');
    const origine = panneau(page).getByRole('button', { name: 'D’origine' });
    await expect(origine).toBeEnabled();
    await origine.tap();
    await expect(panneau(page)).toHaveAttribute('data-traitement', 'brut');
    await expect(origine).toBeDisabled();
    await expect
      .poll(async () => {
        const saved = (await readBuilds(page))?.builds.cox as { parts?: Record<string, string>; partPaints?: Record<string, unknown> } | undefined;
        return [saved?.parts?.moteur_filtres ?? null, Object.keys(saved?.partPaints ?? {}).length];
      })
      .toEqual([null, 0]);

    // Très grand texte : toujours 48 px au doigt, l'établi toujours au-dessus du dock.
    await tailleDuTexte(page, 'Très grand');
    await openEntry(page, 'Moteur');
    await expect(stage(page)).toHaveAttribute('data-etabli', 'quatre-a-plat', { timeout: 120_000 });
    await commandesA48(page);
    await etabliAuDessusDuDock(page);
    await photo(page, '05-cox-tres-grand-texte');
    await tailleDuTexte(page, 'Normal');

    // Paysage : l'établi reste, le panneau garde ses commandes.
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(stage(page)).toHaveAttribute('data-etabli', 'quatre-a-plat');
    await expect(panneau(page)).toBeVisible();
    await commandesA48(page);
    await waitForStill(page);
    await photo(page, '06-cox-paysage');
  });

  test('captures de revue : chaque famille modelée, assemblée, éclatée, une pièce chromée, une pièce peinte', async ({ page }) => {
    test.skip(!CAPTURES, 'à la demande : PMB_CAPTURES_MOTEUR=<dossier>');
    test.setTimeout(600_000);
    // Véhicule, famille, pièce chromée, pièce peinte (les données du catalogue).
    const familles: Array<[string, string, string, string]> = [
      ['cox', 'quatre-a-plat', 'cache_culbuteurs', 'toles'],
      ['bobber', 'bicylindre-v', 'carter_distribution', 'carter_primaire'],
      ['sportive', 'quatre-en-ligne-moto', 'collecteur', 'cache_culbuteurs'],
      ['concept', 'v8', 'collecteur', 'cache_culbuteurs'],
    ];
    await openApp(page);
    await waitForScene(page);
    for (const [vehicule, famille, chromee, peinte] of familles) {
      await poserSauvegarde(page, {
        jeu: JEU(0),
        builds: { current: vehicule, builds: { [vehicule]: { paints: {}, partPaints: { [`moteur_${chromee}`]: { finish: 'chrome' }, [`moteur_${peinte}`]: { finish: 'brillant', color: '#c41e2a' } } } }, recents: [] },
      });
      await waitForBench(page);
      await openEntry(page, 'Moteur');
      await expect(stage(page)).toHaveAttribute('data-etabli', famille, { timeout: 120_000 });
      await waitForStill(page);
      await photo(page, `${famille}-1-assemble`);
      await panneau(page).getByTestId('moteur-eclate').fill('100');
      await waitForStill(page);
      await photo(page, `${famille}-2-eclate`);
      await panneau(page).getByTestId('moteur-eclate').fill('0');
      await piece(page, chromee).tap();
      await waitForStill(page);
      await photo(page, `${famille}-3-${chromee}-chrome`);
      await piece(page, peinte).tap();
      await waitForStill(page);
      await photo(page, `${famille}-4-${peinte}-peinte`);
    }
  });
});
