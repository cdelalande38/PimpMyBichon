// Mécanique · Moteur (vague U) : l'établi, en deux étapes (retour du 18 novembre 2026 : « séparer la
// sélection des éléments des actions à mener dessus »). Ouvrir l'entrée sort le moteur de la Cox sur son
// support (le fichier ne se charge qu'à ce moment-là), cadré au-dessus du panneau ; l'étape « Pièce »
// donne la vue éclatée, la liste et le total du moteur ; toucher une pièce l'allume, la cadre de près et
// passe à ses actions, en volets (finition, optimisation, échange) ; ce qui est payant porte un cadenas
// et son prix, l'achat se fait sur place (solde suffisant, puis insuffisant) ; « Retour » rend la liste,
// la pièce encore allumée ; le niveau d'optimisation compte dans la fiche de Préparation ; tout est
// gardé au rechargement, et fermer l'entrée remet le véhicule. Un moteur sans modèle (le van) le dit.
// Les captures de revue ne tournent qu'à la demande : PMB_CAPTURES_MOTEUR=<dossier>.
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

const stage = (page: Page) => page.locator('.stage');
const panneau = (page: Page) => page.locator('footer.dock [data-testid="moteur"]');
const piece = (page: Page, id: string) => panneau(page).locator(`.moteur-piece[data-piece="${id}"]`);
const traitement = (page: Page, id: string) => panneau(page).locator(`.moteur-traitement[data-traitement="${id}"]`);
const niveau = (page: Page, id: string) => panneau(page).locator(`.moteur-niveau[data-niveau="${id}"]`);
const volet = (page: Page, id: string) => panneau(page).locator(`.moteur-volet[data-volet="${id}"]`);
const ici = (page: Page) => page.locator('footer.dock .dock-crumb-here');
const retour = (page: Page) => page.locator('footer.dock').getByRole('button', { name: 'Retour', exact: true });

/** Ouvre une pièce de la liste : ses actions remplacent la liste, le fil la nomme, la scène l'allume. */
async function ouvrirPiece(page: Page, id: string, nom: string): Promise<void> {
  await piece(page, id).tap();
  await expect(panneau(page)).toHaveAttribute('data-etape', 'actions');
  await expect(panneau(page)).toHaveAttribute('data-piece', id);
  await expect(ici(page)).toHaveText(nom);
  await expect(stage(page)).toHaveAttribute('data-etabli-piece', id);
}

/** « Retour » : la liste revient, la pièce encore allumée, la caméra rend le moteur entier. */
async function revenirALaListe(page: Page, id: string): Promise<void> {
  await retour(page).tap();
  await expect(panneau(page)).toHaveAttribute('data-etape', 'piece');
  await expect(piece(page, id)).toHaveAttribute('aria-pressed', 'true');
  await expect(stage(page)).toHaveAttribute('data-etabli-piece', id);
  await expect(stage(page)).not.toHaveAttribute('data-cadrage', /^moteur-/);
}

/** Toute commande visible du panneau offre 48 px au doigt (celles des rangées qui défilent hors champ exceptées). */
async function commandesA48(page: Page): Promise<void> {
  const largeur = page.viewportSize()?.width ?? 390;
  const commandes = panneau(page).locator('button:visible, label:visible, input[type="range"]:visible');
  const nombre = await commandes.count();
  expect(nombre).toBeGreaterThan(2);
  for (let i = 0; i < nombre; i += 1) {
    const commande = commandes.nth(i);
    const boite = await commande.boundingBox();
    if (!boite || boite.x + boite.width < 0 || boite.x > largeur) continue;
    const nom = ((await commande.getAttribute('aria-label')) ?? (await commande.innerText())).trim().replace(/\s+/g, ' ');
    expect(boite.height, `hauteur de « ${nom} »`).toBeGreaterThanOrEqual(47.5);
    if ((await commande.getAttribute('type')) !== 'range') expect(boite.width, `largeur de « ${nom} »`).toBeGreaterThanOrEqual(47.5);
  }
}

/** Rien du panneau ne sort du menu en largeur, hors des rangées qui défilent exprès. */
async function debords(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const menu = document.querySelector('footer.dock');
    const racine = document.querySelector('footer.dock [data-testid="moteur"]');
    if (!menu || !racine) return ['pas de panneau'];
    const box = menu.getBoundingClientRect();
    const out: string[] = [];
    for (const element of racine.querySelectorAll<HTMLElement>('button, label, p')) {
      if (element.closest('.chips, .moteur-swatches')) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.left < box.left - 1 || rect.right > box.right + 1) out.push(`${element.textContent?.trim().slice(0, 24)} (${Math.round(rect.left)}–${Math.round(rect.right)})`);
    }
    return out;
  });
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

/** La pièce cadrée de près tient dans la partie libre de l'écran (au-dessus du menu, ou à sa gauche en paysage). */
async function pieceCadree(page: Page, id: string): Promise<void> {
  await expect(stage(page)).toHaveAttribute('data-cadrage', new RegExp(`^moteur-${id}`), { timeout: 30_000 });
  await expect
    .poll(async () => {
      const zone = (await stage(page).getAttribute('data-zone-ecran'))?.split(',').map(Number);
      const libre = (await stage(page).getAttribute('data-cadrage-libre'))?.split(',').map(Number);
      if (!zone || !libre) return 'pas de cadre';
      const [left = 0, top = 0, right = 0, bottom = 0] = zone;
      const [l = 0, t = 0, r = 0, b = 0] = libre;
      return left >= l - 4 && right <= r + 4 && top >= t - 4 && bottom <= b + 4 ? 'ok' : `${zone.join(',')} hors de ${libre.join(',')}`;
    })
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

const JEU = (solde: number, articles: Record<string, boolean> = {}) => ({ solde, articles, hautsFaits: { 'premier-achat': true }, cumuls: {} });

test.describe('Mécanique · Moteur', () => {
  test('établi : la pièce, puis ses actions ; traitement et niveau achetés sur place ; retour à la liste ; gardé ; compté dans la Préparation', async ({ page }) => {
    test.setTimeout(480_000);
    await openApp(page);
    await waitForScene(page);
    await poserSauvegarde(page, { jeu: JEU(450), builds: { current: 'cox', builds: {}, recents: [] } });
    await waitForBench(page);
    await expect(stage(page)).toHaveAttribute('data-vehicle', 'cox');

    // Rien n'est chargé tant que l'entrée n'est pas ouverte.
    const moteurs: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/assets/shared/engines/')) moteurs.push(request.url());
    });
    await page.waitForTimeout(500);
    expect(moteurs).toEqual([]);

    // Étape « Pièce » : la vue éclatée, la liste, le total ; rien d'allumé, rien de cadré de près.
    await openEntry(page, 'Moteur');
    await expect(stage(page)).toHaveAttribute('data-etabli', 'quatre-a-plat', { timeout: 120_000 });
    expect(moteurs.some((url) => url.endsWith('/assets/shared/engines/quatre-a-plat/moteur.glb'))).toBe(true);
    await expect(panneau(page)).toHaveAttribute('data-etape', 'piece');
    await expect(panneau(page)).toHaveAttribute('data-famille', 'quatre-a-plat');
    await expect(panneau(page).locator('.moteur-note')).toContainText('4 cylindres à plat refroidi par air · modèle provisoire');
    await expect(panneau(page).getByTestId('moteur-total')).toHaveText(/^Optimisé : \+\s0\s% sur \+\s15\s%$/);
    await expect(panneau(page).locator('.moteur-traitement, .moteur-niveau, .moteur-volet')).toHaveCount(0);
    await expect(piece(page, 'culasses').locator('.moteur-piece-niveau')).toHaveText('Optimisable');
    await expect(piece(page, 'carters').locator('.moteur-piece-niveau')).toHaveCount(0);
    await etabliAuDessusDuDock(page);
    await expect(stage(page)).toHaveAttribute('data-eclate', '0');
    await expect(stage(page)).not.toHaveAttribute('data-etabli-piece', /.+/);
    await commandesA48(page);

    // Vue éclatée.
    await panneau(page).getByTestId('moteur-eclate').fill('80');
    await expect(stage(page)).toHaveAttribute('data-eclate', '80');
    await expect(panneau(page).locator('.moteur-eclate output')).toHaveText('80 %');

    // Les cache-culbuteurs : leurs actions remplacent la liste ; une seule rubrique, la finition.
    await ouvrirPiece(page, 'cache_culbuteurs', 'Cache-culbuteurs');
    await expect(page.locator('footer.dock .dock-crumbs-path')).toContainText('Mécanique');
    await expect(panneau(page).getByTestId('moteur-eclate')).toHaveCount(0);
    await expect(panneau(page).locator('.moteur-piece')).toHaveCount(0);
    await expect(panneau(page).locator('.moteur-volet')).toHaveCount(0);
    await expect(panneau(page).locator('.moteur-rubrique')).toHaveText('Finition');
    await pieceCadree(page, 'cache_culbuteurs');
    await expect(panneau(page)).toHaveAttribute('data-traitement', 'brut');
    await expect(traitement(page, 'brut')).toHaveAttribute('aria-pressed', 'true');
    await expect(traitement(page, 'peinture')).not.toHaveAttribute('data-verrou', 'ferme');
    for (const id of ['chrome', 'poli', 'brosse', 'anodise', 'noir_satine']) await expect(traitement(page, id)).toHaveAttribute('data-verrou', 'ferme');
    await expect(traitement(page, 'chrome')).toHaveAccessibleName('Chrome, verrouillé : 260 dollars');
    await expect(traitement(page, 'chrome')).toContainText('260 $');
    await commandesA48(page);

    // Le chrome coûte 260 $, il y en a 450 : confirmation, achat, appliqué tout de suite.
    await traitement(page, 'chrome').tap();
    const confirmation = panneau(page).locator('.jeu-achat[data-etat="confirmation"]');
    await expect(confirmation).toContainText('Acheter le chrome pour 260 $');
    await confirmation.getByRole('button', { name: 'Acheter' }).tap();
    await expect(panneau(page)).toHaveAttribute('data-traitement', 'chrome');
    await expect(panneau(page).locator('.moteur-message')).toContainText('le chrome est à toi');
    await expect(traitement(page, 'chrome')).not.toHaveAttribute('data-verrou', 'ferme');

    // Retour : la liste, les cache-culbuteurs encore allumés, et chromés.
    await revenirALaListe(page, 'cache_culbuteurs');
    await expect(piece(page, 'cache_culbuteurs')).toContainText('Chrome');
    await expect(panneau(page).getByTestId('moteur-eclate')).toHaveValue('80');

    // Les culasses : finition, optimisation ; on choisit l'optimisation. Le gain se lit avant l'achat.
    await ouvrirPiece(page, 'culasses', 'Culasses');
    await expect(panneau(page).locator('.moteur-volet')).toHaveCount(2);
    await volet(page, 'optimisation').tap();
    await expect(panneau(page)).toHaveAttribute('data-volet', 'optimisation');
    await expect(panneau(page).locator('.moteur-traitement')).toHaveCount(0);
    await expect(niveau(page, 'origine')).toHaveAttribute('aria-pressed', 'true');
    await expect(niveau(page, 'sport')).toHaveAccessibleName('Sièges repris, + 2 % · + 1 ch, verrouillé : 150 dollars');
    await expect(niveau(page, 'course')).toHaveAccessibleName('Grosses soupapes, + 4 % · + 2 ch, verrouillé : 300 dollars');
    await expect(niveau(page, 'course').locator('.moteur-gain')).toBeVisible();
    await expect(panneau(page).locator('.moteur-effet')).toContainText('Un niveau acheté vaut pour tous tes moteurs');
    await commandesA48(page);

    await niveau(page, 'sport').tap();
    await expect(confirmation).toContainText('Acheter les sièges repris pour 150 $ ? Il te restera 40 $.');
    await confirmation.getByRole('button', { name: 'Acheter' }).tap();
    await expect(panneau(page)).toHaveAttribute('data-niveau', 'sport');
    await expect(panneau(page).locator('.moteur-message')).toContainText('sièges repris');
    await expect(panneau(page).locator('.moteur-effet')).toContainText('Sièges repris : Conduits polis');
    await expect(volet(page, 'optimisation')).toContainText('+ 2 %');

    // Les grosses soupapes coûtent 300 $ : il en reste 40, il manque 260 $.
    await niveau(page, 'course').tap();
    const insuffisant = panneau(page).locator('.jeu-achat[data-etat="insuffisant"]');
    await expect(insuffisant).toContainText('Il te manque 260 $ pour les grosses soupapes');
    await insuffisant.getByRole('button', { name: 'Compris' }).tap();
    await expect(insuffisant).toHaveCount(0);
    await expect(panneau(page)).toHaveAttribute('data-niveau', 'sport');

    // Retour : la liste rappelle le niveau, le total du moteur a monté.
    await revenirALaListe(page, 'culasses');
    await expect(piece(page, 'culasses').locator('.moteur-piece-niveau')).toHaveText('Sièges repris · + 2 %');
    await expect(panneau(page).getByTestId('moteur-total')).toHaveText(/^Optimisé : \+\s2\s% · \+\s1\sch sur \+\s15\s%$/);

    // La peinture haute température est libre : les tôles en rouge, puis une teinte de la palette.
    await ouvrirPiece(page, 'toles', 'Tôles de refroidissement');
    await traitement(page, 'peinture').tap();
    await expect(panneau(page)).toHaveAttribute('data-traitement', 'peinture');
    const teintes = panneau(page).locator('.moteur-swatches button');
    await teintes.nth(1).tap();
    await expect(teintes.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await revenirALaListe(page, 'toles');

    // Le filtre à air : trois volets ; l'échange garde le boîtier d'origine, les deux autres s'achètent.
    await ouvrirPiece(page, 'filtres', 'Filtre à air');
    await expect(panneau(page).locator('.moteur-volet')).toHaveCount(3);
    // Le volet choisi reste d'une pièce à l'autre : l'optimisation.
    await expect(panneau(page)).toHaveAttribute('data-volet', 'optimisation');
    await expect(niveau(page, 'sport')).toHaveAccessibleName('Haut débit, + 2 % · + 1 ch, verrouillé : 70 dollars');
    await volet(page, 'echange').tap();
    await expect(panneau(page)).toHaveAttribute('data-option', 'boitier');
    await expect(panneau(page).locator('.moteur-option[data-option="cornets"]')).toHaveAttribute('data-verrou', 'ferme');
    await expect(panneau(page).locator('.moteur-option[data-option="coniques"]')).toHaveAccessibleName('Filtre conique, verrouillé : 80 dollars');
    await revenirALaListe(page, 'filtres');

    // Gardé dans la sauvegarde, sans champ nouveau : partPaints.moteur_<pièce>, parts.moteur_<pièce>_niveau.
    await expect
      .poll(async () => {
        const saved = (await readBuilds(page))?.builds.cox as { parts?: Record<string, string>; partPaints?: Record<string, { finish?: string; color?: string }> } | undefined;
        return [saved?.partPaints?.moteur_cache_culbuteurs?.finish, saved?.partPaints?.moteur_toles?.finish, saved?.parts?.moteur_culasses_niveau];
      })
      .toEqual(['chrome', 'brillant', 'sport']);

    // La fiche de Préparation compte le niveau : 50 ch + 2 % = 51 ch.
    await openEntry(page, 'Préparation');
    const fiche = page.locator('footer.dock .engine');
    await expect(fiche.getByTestId('moteur-prepare')).toHaveText(/^51\s*ch$/);
    await expect(fiche.getByTestId('moteur-pieces')).toContainText('+ 2 %');

    // Rechargement : on revient à l'établi, rien n'a bougé.
    await reloadSaved(page);
    await waitForScene(page);
    await waitForBench(page);
    await openEntry(page, 'Moteur');
    await expect(stage(page)).toHaveAttribute('data-etabli', 'quatre-a-plat', { timeout: 120_000 });
    await expect(panneau(page)).toHaveAttribute('data-etape', 'piece');
    await expect(piece(page, 'cache_culbuteurs')).toContainText('Chrome');
    await expect(piece(page, 'toles')).toContainText('Peinture haute température');
    await expect(piece(page, 'culasses')).toContainText('Sièges repris');
    await ouvrirPiece(page, 'cache_culbuteurs', 'Cache-culbuteurs');
    await expect(panneau(page)).toHaveAttribute('data-traitement', 'chrome');
    await expect(traitement(page, 'chrome')).not.toHaveAttribute('data-verrou', 'ferme');

    // Fermer l'entrée remet le véhicule.
    await backToSections(page);
    await expect(stage(page)).not.toHaveAttribute('data-etabli', /.+/);
    await expect(stage(page)).not.toHaveAttribute('data-cadrage', /^moteur-/);
    await expect(stage(page)).toHaveAttribute('data-bench', 'pret');
    await expect(stage(page)).toHaveAttribute('data-vehicule-ecran', /^\d+,\d+$/);
  });

  test('un moteur sans modèle le dit ; « D’origine » remet tout le moteur ; grand texte, 360 px et paysage, aux deux étapes', async ({ page }) => {
    test.setTimeout(480_000);
    await openApp(page);
    await waitForScene(page);
    const traite = { cox: { paints: {}, parts: { moteur_filtres: 'coniques', moteur_culasses_niveau: 'course', moteur_filtres_niveau: 'sport' }, partPaints: { moteur_carters: { finish: 'chrome' }, moteur_toles: { finish: 'brillant', color: '#00aa55' } } } };
    await poserSauvegarde(page, { jeu: JEU(0), builds: { current: 'van', builds: traite, recents: [] } });
    await waitForBench(page);

    // Le van : son moteur n'a pas encore de modèle, l'entrée le dit et le véhicule reste.
    await openEntry(page, 'Moteur');
    await expect(panneau(page).locator('.moteur-empty')).toContainText('Le van attend encore le modèle de son moteur');
    await expect(stage(page)).not.toHaveAttribute('data-etabli', /.+/);
    await expect(stage(page)).toHaveAttribute('data-vehicle', 'van');

    // La Cox, avec un moteur déjà traité et optimisé : « D'origine » remet tout.
    await poserSauvegarde(page, { builds: { current: 'cox', builds: traite, recents: [] } });
    await waitForBench(page);
    await openEntry(page, 'Moteur');
    await expect(stage(page)).toHaveAttribute('data-etabli', 'quatre-a-plat', { timeout: 120_000 });
    await expect(panneau(page).getByTestId('moteur-total')).toContainText('+ 6 %');
    const origine = panneau(page).getByRole('button', { name: 'D’origine' });
    await expect(origine).toBeEnabled();
    await origine.tap();
    await expect(origine).toBeDisabled();
    await expect(panneau(page).getByTestId('moteur-total')).toContainText('+ 0 %');
    await expect
      .poll(async () => {
        const saved = (await readBuilds(page))?.builds.cox as { parts?: Record<string, string>; partPaints?: Record<string, unknown> } | undefined;
        return [Object.keys(saved?.parts ?? {}).length, Object.keys(saved?.partPaints ?? {}).length];
      })
      .toEqual([0, 0]);

    // Très grand texte, puis 360 × 780, puis paysage : 48 px au doigt, rien ne déborde, aux deux étapes.
    await tailleDuTexte(page, 'Très grand');
    for (const ecran of [
      { width: 390, height: 844 },
      { width: 360, height: 780 },
      { width: 844, height: 390 },
    ]) {
      const nom = `${ecran.width} × ${ecran.height}`;
      await page.setViewportSize(ecran);
      await openEntry(page, 'Moteur');
      await expect(stage(page)).toHaveAttribute('data-etabli', 'quatre-a-plat', { timeout: 120_000 });
      await commandesA48(page);
      expect(await debords(page), `${nom}, pièce`).toEqual([]);
      if (ecran.width < ecran.height) await etabliAuDessusDuDock(page);
      await ouvrirPiece(page, 'filtres', 'Filtre à air');
      for (const id of ['finition', 'optimisation', 'echange']) {
        await volet(page, id).tap();
        await commandesA48(page);
        expect(await debords(page), `${nom}, ${id}`).toEqual([]);
      }
      await pieceCadree(page, 'filtres');
      await revenirALaListe(page, 'filtres');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await tailleDuTexte(page, 'Normal');
  });

  test('captures de revue : chaque étape, en portrait et en paysage ; chaque famille, une pièce cadrée', async ({ page }) => {
    test.skip(!CAPTURES, 'à la demande : PMB_CAPTURES_MOTEUR=<dossier>');
    test.setTimeout(900_000);
    await openApp(page);
    await waitForScene(page);
    // Le concept : les quatre écrans de l'entrée, en portrait puis en paysage (la hauteur du menu est relevée).
    await poserSauvegarde(page, {
      jeu: JEU(300, { 'piece-moteur-traitement-chrome': true, 'piece-moteur-optimisation-admission-sport': true }),
      builds: { current: 'concept', builds: { concept: { paints: {}, parts: { moteur_collecteur_niveau: 'sport' }, partPaints: { moteur_cache_culbuteurs: { finish: 'brillant', color: '#c41e2a' } } } }, recents: [] },
    });
    await waitForBench(page);
    const hauteurs: string[] = [];
    const hauteur = async (nom: string) => hauteurs.push(`${nom} ${Math.round((await page.locator('footer.dock').boundingBox())?.height ?? 0)}`);
    for (const ecran of [
      { width: 390, height: 844, nom: 'portrait' },
      { width: 844, height: 390, nom: 'paysage' },
    ]) {
      await page.setViewportSize(ecran);
      await openEntry(page, 'Moteur');
      await expect(stage(page)).toHaveAttribute('data-etabli', 'v8', { timeout: 120_000 });
      await panneau(page).getByTestId('moteur-eclate').fill('60');
      await waitForStill(page);
      await hauteur(`${ecran.nom} pièce`);
      await photo(page, `${ecran.nom}-1-piece`);
      await ouvrirPiece(page, 'collecteur', 'Collecteur d’admission');
      await volet(page, 'finition').tap();
      await pieceCadree(page, 'collecteur');
      await waitForStill(page);
      await hauteur(`${ecran.nom} finition`);
      await photo(page, `${ecran.nom}-2-finition`);
      await volet(page, 'optimisation').tap();
      await niveau(page, 'course').tap();
      await waitForStill(page);
      await hauteur(`${ecran.nom} optimisation`);
      await photo(page, `${ecran.nom}-3-optimisation`);
      await revenirALaListe(page, 'collecteur');
      await ouvrirPiece(page, 'filtres', 'Filtre à air');
      await volet(page, 'echange').tap();
      await pieceCadree(page, 'filtres');
      await waitForStill(page);
      await hauteur(`${ecran.nom} échange`);
      await photo(page, `${ecran.nom}-4-echange`);
      await revenirALaListe(page, 'filtres');
      await waitForStill(page);
      await photo(page, `${ecran.nom}-5-retour`);
    }
    console.log(`Hauteur du menu (px) : ${hauteurs.join(' ; ')}`);
    await page.setViewportSize({ width: 390, height: 844 });
    // Chaque famille : des pièces cadrées de près ; part de la partie libre qu'elles occupent (largeur × hauteur).
    const parts: string[] = [];
    for (const [vehicule, famille, pieces] of [
      ['cox', 'quatre-a-plat', [['carburateur', 'Carburateur'], ['culasses', 'Culasses'], ['poulies', 'Poulies']]],
      ['bobber', 'bicylindre-v', [['culasses', 'Culasses'], ['carter_primaire', 'Carter primaire']]],
      ['sportive', 'quatre-en-ligne-moto', [['collecteur', 'Collecteur d’échappement'], ['bobines', 'Bobines']]],
      ['concept', 'v8', [['echappement', 'Collecteurs d’échappement'], ['carter_huile', 'Carter d’huile'], ['poulies', 'Poulies']]],
    ] as const) {
      await poserSauvegarde(page, { jeu: JEU(0), builds: { current: vehicule, builds: {}, recents: [] } });
      await waitForBench(page);
      await openEntry(page, 'Moteur');
      await expect(stage(page)).toHaveAttribute('data-etabli', famille, { timeout: 120_000 });
      for (const [id, nom] of pieces) {
        await ouvrirPiece(page, id, nom);
        await pieceCadree(page, id);
        await waitForStill(page);
        const [left = 0, top = 0, right = 0, bottom = 0] = ((await stage(page).getAttribute('data-zone-ecran')) ?? '').split(',').map(Number);
        const [l = 0, t = 0, r = 1, b = 1] = ((await stage(page).getAttribute('data-cadrage-libre')) ?? '').split(',').map(Number);
        parts.push(`${famille} ${id} ${Math.round(((right - left) / (r - l)) * 100)} × ${Math.round(((bottom - top) / (b - t)) * 100)} %`);
        if (id === pieces[0][0]) await photo(page, `${famille}-${id}-cadre`);
        await revenirALaListe(page, id);
      }
    }
    console.log(`Pièces cadrées : ${parts.join(' ; ')}`);
  });
});
