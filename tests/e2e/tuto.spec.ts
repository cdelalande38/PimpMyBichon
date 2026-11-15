// Accueil d'un nouvel utilisateur : l'écran de chargement, le premier passage (tutoriel proposé une
// seule fois par écran), le bouton « ? » (Aide) et sa liste. Sous navigateur piloté, les tutos ne se
// proposent tout seuls qu'avec « ?tuto=1 » dans l'adresse (src/ui/tuto/ecran.ts) : les autres
// parcours, lancés sans ce paramètre, n'en voient jamais.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { TUTOS } from '../../src/data/tutos.ts';
import { openEntry, quick } from './helpers.ts';

const ACCUEIL = TUTOS.find((tuto) => tuto.id === 'accueil');

/** Capture de revue, rangée dans captures/vague-k-tuto/ (hors dépôt). */
async function capture(page: Page, name: string): Promise<void> {
  const dir = resolve('captures', 'vague-k-tuto');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`) });
}

/** L'écran de chargement est parti (scène prête, ou il a cédé la place). */
async function chargementParti(page: Page): Promise<void> {
  await expect(page.locator('.tuto-chargement')).toHaveCount(0, { timeout: 60_000 });
}

test.describe('écran de chargement', () => {
  // Sans service worker, le modèle du véhicule passe par la page : on peut le retenir.
  test.use({ serviceWorkers: 'block' });

  test('dit où on en est, ne prend aucun appui, et cède la place si le véhicule tarde trop', async ({ page }) => {
    test.setTimeout(150_000);
    // Le modèle n'arrive jamais : l'écran ne doit pas rester bloqué.
    await page.route('**/*.glb', () => undefined);
    await page.goto('./');
    const chargement = page.locator('.tuto-chargement');
    await expect(chargement).toBeVisible();
    const barre = page.getByRole('progressbar', { name: 'Ouverture du garage' });
    await expect(barre).toHaveAttribute('aria-valuetext', /, étape [123] sur 3$/);
    // L'atelier (le module de la scène) arrive bien avant que l'écran puisse partir.
    await expect(chargement.locator('li[data-etat="fait"]').first()).toBeAttached();
    // Capture au plus tôt : en rendu logiciel, l'écran peut céder la place avant la dernière étape.
    await capture(page, '01-chargement');

    // Il ne prend aucun appui : le bouton Atelier, dessous, répond.
    await quick(page).getByRole('button', { name: 'Atelier', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Rubriques de l’atelier' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation', { name: 'Rubriques de l’atelier' })).toHaveCount(0);

    // Il cède la place à ce que l'app affiche déjà : le véhicule « en route… ».
    await expect(chargement).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('.tag')).toContainText('en route');
  });

  test('une fois parti, il ne revient pas : « Réessayer » tout de suite après un modèle introuvable', async ({ page }) => {
    test.setTimeout(120_000);
    // « Dans les premières secondes » : en rendu logiciel, l'échec arrive après les délais de l'écran
    // (3 s après la première image, 10 s en tout), qui le font partir de toute façon. On les allonge
    // ici, pour que seul l'échec le fasse partir, comme sur un téléphone rapide.
    await page.addInitScript(() => {
      const original = window.setTimeout.bind(window);
      window.setTimeout = ((handler: TimerHandler, delay?: number, ...rest: unknown[]) =>
        original(handler, delay === 3_000 || delay === 10_000 ? 120_000 : delay, ...rest)) as typeof window.setTimeout;
    });
    // Le premier modèle tombe : le banc passe en erreur, l'écran part aussitôt. Les essais suivants
    // restent en route : le banc reste « en chargement ».
    let essais = 0;
    await page.route('**/*.glb', (route) => {
      essais += 1;
      return essais === 1 ? route.abort('internetdisconnected') : undefined;
    });
    await page.goto('./');
    await expect(page.locator('.stage')).toHaveAttribute('data-bench', 'erreur', { timeout: 30_000 });
    await chargementParti(page);
    // « Réessayer » tout de suite (dans les premières secondes) : l'écran de chargement reste parti.
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect(page.locator('.stage')).toHaveAttribute('data-bench', 'chargement');
    for (let i = 0; i < 20; i += 1) {
      await expect(page.locator('.tuto-chargement')).toHaveCount(0);
      await page.waitForTimeout(100);
    }
    await expect(page.locator('.tag')).toContainText('en route');
  });
});

test.describe('tutoriels', () => {
  test('l’accueil se propose au premier passage, se déroule, ne revient pas ; « ? » le rouvre et liste les autres ; Peinture propose le sien', async ({ page }) => {
    test.setTimeout(300_000);
    expect(ACCUEIL).toBeDefined();
    const etapes = ACCUEIL?.etapes.length ?? 0;

    await page.goto('./?tuto=1');
    // L'écran de chargement s'affiche, puis s'efface.
    await expect(page.locator('.tuto-chargement')).toBeVisible();
    await chargementParti(page);

    const accueil = page.getByRole('dialog', { name: 'Bienvenue au garage' });
    await expect(accueil).toBeVisible({ timeout: 20_000 });
    await expect(accueil.getByRole('button', { name: 'Suivant' })).toBeFocused();
    await expect(accueil.getByText(`Tuto · 1 sur ${etapes}`)).toBeVisible();
    // Proposé tout seul : pas de détour par la liste, on avance ou on passe.
    await expect(accueil.getByRole('button', { name: 'Tous les tutos' })).toHaveCount(0);
    await capture(page, '02-accueil-premiere');

    for (let rang = 2; rang <= etapes; rang += 1) {
      await accueil.getByRole('button', { name: 'Suivant' }).click();
      await expect(accueil.getByText(`Tuto · ${rang} sur ${etapes}`)).toBeVisible();
    }
    await expect(accueil.getByRole('button', { name: 'Passer' })).toHaveCount(0);
    await expect(accueil.getByRole('button', { name: 'C’est parti' })).toBeFocused();
    await capture(page, '03-accueil-derniere');
    await accueil.getByRole('button', { name: 'C’est parti' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Il ne revient pas au rechargement.
    await page.reload();
    await chargementParti(page);
    await page.waitForTimeout(2_500);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // « ? » rouvre le tutoriel de l'écran, et donne la liste de tous.
    const aide = page.getByRole('button', { name: 'Aide' });
    await expect(aide).toBeVisible();
    const box = await aide.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(48);
    expect(box?.height).toBeGreaterThanOrEqual(48);
    await capture(page, '04-bouton-aide');
    await aide.click();
    await expect(accueil).toBeVisible();
    await accueil.getByRole('button', { name: 'Tous les tutos' }).click();
    const liste = page.getByRole('dialog', { name: 'Tous les tutos' });
    await expect(liste).toBeVisible();
    await expect(liste.getByRole('listitem')).toHaveCount(TUTOS.length);
    for (const tuto of TUTOS) await expect(liste.getByRole('button', { name: tuto.titre })).toBeAttached();
    await capture(page, '05-liste');
    await liste.getByRole('button', { name: 'La radio' }).click();
    await expect(page.getByRole('dialog', { name: 'La radio' })).toBeVisible();
    // Échap le referme, comme « Passer », et le focus revient sur « ? ».
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(aide).toBeFocused();

    // La première ouverture de Custom · Peinture propose son tutoriel ; « Passer » le referme.
    await openEntry(page, 'Peinture');
    const peinture = page.getByRole('dialog', { name: 'La peinture' });
    await expect(peinture).toBeVisible({ timeout: 20_000 });
    await capture(page, '06-peinture');
    await peinture.getByRole('button', { name: 'Passer' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Le dock est resté où on l'avait mis.
    await expect(page.locator('footer.dock [aria-label="Zones"]')).toBeVisible();
  });

  test('sans le paramètre, rien ne se propose sous navigateur piloté ; « ? » marche toujours', async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto('./');
    await chargementParti(page);
    await page.waitForTimeout(2_000);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await openEntry(page, 'Peinture');
    await page.waitForTimeout(2_000);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Aide' }).click();
    const peinture = page.getByRole('dialog', { name: 'La peinture' });
    await expect(peinture).toBeVisible();
    await peinture.getByRole('button', { name: 'Passer' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('panneau ouvert : son en-tête offre « ? », qui rouvre le tuto du panneau par-dessus', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('./');
    await chargementParti(page);
    await quick(page).getByRole('button', { name: 'Atelier', exact: true }).click();
    const panneau = page.getByRole('dialog', { name: 'Réglages' });
    await expect(panneau).toBeVisible();
    const aide = panneau.getByRole('button', { name: 'Aide', exact: true });
    const box = await aide.boundingBox();
    expect(box?.width ?? 0, '« ? » du panneau : 48 px').toBeGreaterThanOrEqual(48);
    expect(box?.height ?? 0, '« ? » du panneau : 48 px').toBeGreaterThanOrEqual(48);
    // Le titre du panneau ne passe pas sous le bouton.
    const titre = await panneau.getByRole('heading', { level: 2 }).evaluate((h) => {
      const range = document.createRange();
      range.selectNodeContents(h);
      return range.getBoundingClientRect().right;
    });
    expect(titre, 'titre avant le « ? »').toBeLessThanOrEqual(box?.x ?? 0);
    await capture(page, '05-panneau-aide');
    await aide.click();
    const tuto = page.getByRole('dialog', { name: 'L’atelier' });
    await expect(tuto).toBeVisible();
    await tuto.getByRole('button', { name: 'Passer' }).click();
    await expect(tuto).toHaveCount(0);
    await expect(panneau).toBeVisible();
    await expect(aide).toBeFocused();
  });

  test('lisible aux trois tailles de texte, en 360 × 780 : la carte et ses boutons tiennent dans l’écran', async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('./');
    await chargementParti(page);
    const accueil = page.getByRole('dialog', { name: 'Bienvenue au garage' });
    for (const taille of ['normal', 'grand', 'tres-grand']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.text = value;
      }, taille);
      await page.getByRole('button', { name: 'Aide' }).click();
      await expect(accueil).toBeVisible();
      for (let rang = 1; rang <= (ACCUEIL?.etapes.length ?? 0); rang += 1) {
        const carte = accueil.locator('.tuto-carte');
        const cadre = await carte.boundingBox();
        expect(cadre, `${taille}, étape ${rang}`).not.toBeNull();
        if (cadre) {
          expect(cadre.y, `${taille}, étape ${rang} : haut`).toBeGreaterThanOrEqual(0);
          expect(cadre.y + cadre.height, `${taille}, étape ${rang} : bas`).toBeLessThanOrEqual(780);
          expect(cadre.x + cadre.width, `${taille}, étape ${rang} : largeur`).toBeLessThanOrEqual(360);
        }
        const principal = accueil.getByRole('button', { name: rang === ACCUEIL?.etapes.length ? 'C’est parti' : 'Suivant' });
        await expect(principal).toBeInViewport({ ratio: 1 });
        if (taille === 'tres-grand' && rang === 2) await capture(page, '07-accueil-tres-grand-360');
        await principal.click();
      }
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  });
});
