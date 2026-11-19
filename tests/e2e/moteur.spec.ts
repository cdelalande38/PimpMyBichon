import { mkdirSync } from 'node:fs';
import { resolve as chemin } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { capture, openApp, openEntry, reloadSaved } from './helpers.ts';

// Captures de revue (fiche payante) : à la demande, PMB_CAPTURES_PREPA=<dossier>.
const CAPTURES = process.env.PMB_CAPTURES_PREPA;
async function photo(page: Page, nom: string): Promise<void> {
  if (!CAPTURES) return;
  mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: chemin(CAPTURES, `${nom}.png`) });
}

/** Le jeu d'un joueur qui a roulé : `solde` dollars, aucun article acquis (la fiche est payante). */
const jeu = (solde: number, articles: Record<string, true> = {}) => ({ solde, articles, hautsFaits: { 'premiere-course': true }, cumuls: { courses: 4, distance: 9300 } });

// Met le van à l'écran par la sauvegarde des builds (même base que l'app : idb-keyval), sans
// dépendre de l'écran du catalogue. `saves` : la sauvegarde du jeu et les choix du build, au besoin.
async function putVanOnScreen(page: Page, saves: { jeu?: Record<string, unknown>; parts?: Record<string, string> } = {}): Promise<void> {
  await page.evaluate(
    (saves) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          const builds = saves.parts ? { van: { paints: {}, parts: saves.parts } } : {};
          tx.objectStore('kv').put(JSON.stringify({ state: { current: 'van', builds, recents: [] }, version: 1 }), 'pmb-builds');
          if (saves.jeu) tx.objectStore('kv').put(JSON.stringify({ state: saves.jeu, version: 1 }), 'pmb-jeu');
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    saves,
  );
}

/** Hauteur touchable d'un élément amené au centre de sa zone (elementFromPoint, pixel par pixel). */
async function touchable(page: Page, selector: string): Promise<number[]> {
  return page.evaluate(async (selector) => {
    const out: number[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      element.scrollIntoView({ block: 'center' });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const box = element.getBoundingClientRect();
      let hits = 0;
      for (let y = Math.floor(box.top); y < box.bottom; y += 1) {
        const hit = document.elementFromPoint(box.left + box.width / 2, y);
        if (hit && element.contains(hit)) hits += 1;
      }
      out.push(hits);
    }
    return out;
  }, selector);
}

test.describe('fiche moteur', () => {
  test('dans le dock compact, le van passe de 102 ch à 175 ch au stage 3 une fois payé, et le retrouve au rechargement', async ({ page }) => {
    // Trois chargements de l'app en rendu logiciel : plus que le délai par défaut.
    test.setTimeout(150_000);
    await openApp(page);
    await putVanOnScreen(page, { jeu: jeu(400) });
    await reloadSaved(page);
    await openEntry(page, 'Préparation');

    // La fiche vit dans Mécanique · Préparation, seule sous la ligne de repère du dock compact.
    const dock = page.locator('footer.dock');
    await expect(dock).toHaveAttribute('data-taille', 'compact');
    const sheet = dock.locator('.dock-tab[data-onglet="preparation"]');
    const origin = sheet.getByTestId('moteur-origine');
    const gain = sheet.getByTestId('moteur-gain');
    const prepared = sheet.getByTestId('moteur-prepare');
    // 102 ch : la sauvegarde est relue, le van est bien à l'écran.
    await expect(origin).toHaveText(/^102\s*ch$/);
    await expect(gain).toHaveText(/^\+\s*0\s*ch$/);
    await expect(sheet.getByText('4 cylindres turbo diesel')).toBeVisible();
    // En tête de fiche, les commandes du son du moteur (tests/e2e/sons.spec.ts les fait tourner).
    await expect(sheet.locator('.engine-sound')).toHaveAttribute('data-sons', 'oui');
    await expect(sheet.locator('.engine-sound')).toHaveAttribute('data-moteur', 'coupe');
    // Moteur à injection : reprogrammation et nitro, pas de carburation.
    await expect(sheet.getByRole('heading', { name: 'Reprogrammation' })).toBeAttached();
    await expect(sheet.getByRole('heading', { name: 'Carburation' })).toHaveCount(0);
    // Le dock compact reste dans le tiers bas.
    const top = await dock.evaluate((footer) => footer.getBoundingClientRect().top);
    expect(top, 'dock compact dans le tiers bas').toBeGreaterThanOrEqual((844 * 2) / 3);

    // Chaque option se touche sur 44 px au moins : les chiffres collés en haut ne la recouvrent pas.
    const heights = await touchable(page, 'footer.dock .dock-tab[data-onglet="preparation"] .engine-chips button');
    expect(heights.length).toBeGreaterThanOrEqual(8);
    for (const height of heights) expect(height, 'option touchable').toBeGreaterThanOrEqual(44);

    // Payante : aucune option n'est acquise, chacune porte son cadenas et son prix ; l'origine reste libre.
    const stage3 = sheet.getByRole('button', { name: /^Stage 3/ });
    await expect(stage3).toHaveAccessibleName('Stage 3, verrouillé : 350 dollars');
    await expect(stage3).toHaveAttribute('aria-pressed', 'false');
    await expect(sheet.getByRole('button', { name: /^Origine/ }).first()).toHaveAttribute('aria-pressed', 'true');
    await photo(page, 'prepa-1-verrouillees');
    // Un appui n'achète rien : le bloc d'achat s'ouvre, 400 $ au solde suffisent, il en restera 50.
    await stage3.tap();
    await expect(stage3).toHaveAttribute('aria-pressed', 'false');
    await expect(stage3).toHaveAttribute('aria-expanded', 'true');
    const achat = sheet.getByRole('group', { name: 'Acheter Reprogrammation · Stage 3' });
    await expect(achat).toContainText('Il te restera 50 $');
    await expect(gain).toHaveText(/^\+\s*0\s*ch$/);
    for (const bouton of await achat.getByRole('button').all()) expect((await bouton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    await photo(page, 'prepa-2-achat');
    await achat.getByRole('button', { name: 'Acheter', exact: true }).tap();
    await expect(sheet.locator('.engine-message')).toContainText('Payé, c’est monté');
    await expect(stage3).toHaveAttribute('aria-pressed', 'true');
    await expect(stage3).toHaveAccessibleName(/^Stage 3/);
    await expect(sheet.locator('[data-non-acquis]')).toHaveCount(0);
    // Les chiffres, collés en haut de la fiche, suivent aussitôt.
    await expect(sheet.getByText('Reprogrammé', { exact: true })).toBeVisible();
    await expect(gain).toHaveText(/^\+\s*73\s*ch$/);
    await expect(prepared).toHaveText(/^175\s*ch$/);
    await expect(prepared).toBeInViewport();

    // Cibles de pouce : chaque puce et le bouton de retour font au moins 48 px.
    const buttons = sheet.locator('.engine button');
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(9);
    for (let i = 0; i < count; i += 1) {
      const box = await buttons.nth(i).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(48);
    }
    await capture(page, 'moteur-van-prepare');
    await photo(page, 'prepa-3-montee');

    // L'écriture dans IndexedDB est asynchrone : on lui laisse le temps de se poser.
    await page.waitForTimeout(500);
    await reloadSaved(page);
    await openEntry(page, 'Préparation');
    await expect(sheet.getByTestId('moteur-prepare')).toHaveText(/^175\s*ch$/);
    await expect(sheet.getByRole('button', { name: /^Stage 3/ })).toHaveAttribute('aria-pressed', 'true');
    // L'achat est gardé : l'autre option, elle, reste à payer, et le solde ne suffit plus.
    const stage1 = sheet.getByRole('button', { name: /^Stage 1/ });
    await expect(stage1).toHaveAccessibleName('Stage 1, verrouillé : 120 dollars');
    await stage1.tap();
    await expect(sheet.getByRole('alert')).toContainText(/Il te manque \d+\s*\$ pour/); // le premier achat rapporte un haut fait : le solde exact n'est pas le sujet
    await sheet.getByRole('button', { name: 'Compris' }).tap();
    await expect(stage3).toHaveAttribute('aria-pressed', 'true');

    const reset = sheet.getByRole('button', { name: 'Tout remettre d’origine' });
    await reset.tap();
    await expect(sheet.getByTestId('moteur-prepare')).toHaveText(/^102\s*ch$/);
    await expect(sheet.getByText(/pas un passage au banc/)).toBeVisible();
  });

  test('une sauvegarde d’avant, avec le stage 3 monté sans l’article, le garde monté et agissant', async ({ page }) => {
    test.setTimeout(150_000);
    await openApp(page);
    await putVanOnScreen(page, { jeu: jeu(0), parts: { reprog: 'stage3', nitro: 'nitro-gros' } });
    await reloadSaved(page);
    await openEntry(page, 'Préparation');
    const sheet = page.locator('footer.dock .dock-tab[data-onglet="preparation"]');
    // Rien n'est retiré : la puissance préparée et le nitro agissent toujours.
    await expect(sheet.getByTestId('moteur-prepare')).toHaveText(/^175\s*ch$/);
    await expect(sheet.getByTestId('moteur-nitro')).toContainText('150');
    // Montée, pas verrouillée : la puce est enfoncée, la fiche le dit en clair ; l'achat n'est pas demandé d'office.
    const stage3 = sheet.getByRole('button', { name: /^Stage 3/ });
    await expect(stage3).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.locator('[data-non-acquis]')).toHaveCount(2);
    await expect(sheet.getByRole('alert')).toHaveCount(0);
    await photo(page, 'prepa-4-heritee');
    // Seul le choix d'une autre option non payée demande l'achat ; l'origine reste libre.
    await sheet.getByRole('button', { name: /^Stage 2/ }).tap();
    await expect(sheet.getByRole('alert')).toContainText(/Il te manque 220\s*\$/);
    await expect(stage3).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByRole('button', { name: 'Compris' }).tap();
    await sheet.getByRole('button', { name: /^Origine/ }).first().tap();
    await expect(sheet.getByTestId('moteur-prepare')).toHaveText(/^102\s*ch$/);
    await expect(sheet.locator('[data-non-acquis]')).toHaveCount(1);
  });
});

test.describe('fiche moteur payante : captures de revue', () => {
  test.skip(!CAPTURES, 'captures de revue : PMB_CAPTURES_PREPA=<dossier>');

  for (const [nom, largeur, hauteur] of [['portrait', 390, 844], ['paysage', 844, 390]] as const) {
    test(`options verrouillées, bloc d’achat, option payée et montée (${nom})`, async ({ page }) => {
      test.setTimeout(150_000);
      await page.setViewportSize({ width: largeur, height: hauteur });
      await openApp(page);
      await putVanOnScreen(page, { jeu: jeu(400) });
      await reloadSaved(page);
      await openEntry(page, 'Préparation');
      const sheet = page.locator('footer.dock .dock-tab[data-onglet="preparation"]');
      const reprog = sheet.locator('.engine-slot').first();
      await reprog.scrollIntoViewIfNeeded();
      await reprog.evaluate((element) => element.scrollIntoView({ block: 'start' }));
      await photo(page, `${nom}-1-verrouillees`);
      await sheet.getByRole('button', { name: /^Stage 2/ }).tap();
      await expect(sheet.getByRole('group', { name: /^Acheter/ })).toBeVisible();
      await photo(page, `${nom}-2-achat`);
      await sheet.getByRole('group', { name: /^Acheter/ }).getByRole('button', { name: 'Acheter', exact: true }).tap();
      await expect(sheet.getByRole('button', { name: /^Stage 2/ })).toHaveAttribute('aria-pressed', 'true');
      await reprog.evaluate((element) => element.scrollIntoView({ block: 'start' }));
      await photo(page, `${nom}-3-montee`);
    });
  }
});
