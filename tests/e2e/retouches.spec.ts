// Retouches rapides de l'audit des menus (vague X, 21 novembre 2026) : docs/AUDIT_MENUS.md, § 7.1.
// A1 pastille d'état, A4 étiquette en double, B1 et B2 rangées (fondu, molette, flèches à la souris), B8 « Vue
// atelier », D1 rubrique « Jeu » en paysage, E2 Échap et P en course, E3 pas de « ? » en course, P1 clavier au
// garage. Les captures de revue (trois formats) : PMB_REVUE_RETOUCHES=1, voir retouches-revue.spec.ts.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { attendreApercu, commencerCourse, DELAI_ROUTE, openApp, preferBalade, quick, waitForBench } from './helpers.ts';

const dock = (page: Page) => page.locator('footer.dock');
const sections = (page: Page) => dock(page).getByRole('navigation', { name: 'Onglets de l’atelier' });
const fil = (page: Page) => dock(page).locator('.dock-crumbs');
const variable = (rangee: Locator, nom: string) => rangee.evaluate((element, propriete) => getComputedStyle(element).getPropertyValue(propriete).trim(), nom);

test.describe('retouches : PC, clavier et souris', () => {
  test.use({ viewport: { width: 1366, height: 768 }, isMobile: false, hasTouch: false });

  test('P1 : Entrée = Jouer, Échap = retour puis ferme, 1 à 4 = sections', { tag: '@essentiel' }, async ({ page }) => {
    await openApp(page);
    await expect(sections(page)).toBeVisible();

    // Entrée, depuis la page : « Jouer », le menu de la sortie.
    await page.keyboard.press('Enter');
    await expect(dock(page).locator('.dock-tab[data-onglet="sortie"]')).toBeVisible();
    // Échap remonte d'un niveau à la fois (contenu, entrées, sections), puis ferme le menu.
    for (let i = 0; i < 6 && !(await sections(page).isVisible()); i += 1) await page.keyboard.press('Escape');
    await expect(sections(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dock(page).getByRole('button', { name: 'Personnaliser' })).toBeVisible();

    // Un chiffre rouvre le menu sur sa section : 3 Mécanique, 2 Custom, 4 Garage, 1 Véhicule (ouvre direct le choix).
    await page.keyboard.press('Digit3');
    await expect(fil(page)).toContainText('Mécanique');
    await page.keyboard.press('Digit2');
    await expect(fil(page)).toContainText('Custom');
    await page.keyboard.press('Digit4');
    await expect(fil(page)).toContainText('Garage');
    await page.keyboard.press('Digit1');
    await expect(dock(page).getByRole('group', { name: 'Véhicule' })).toBeVisible();
  });

  test('P1 : Tab, depuis la page, tombe d’abord sur le menu et non sur les boutons ronds', async ({ page }) => {
    await openApp(page);
    await expect(sections(page)).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(dock(page).locator(':focus')).toHaveCount(1);
    await expect(quick(page).locator(':focus')).toHaveCount(0);
  });

  test('B2 : la molette fait défiler la rangée, des flèches paraissent à la souris, le fondu suit le défilement', { tag: '@essentiel' }, async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Digit1');
    const rangee = dock(page).getByRole('group', { name: 'Véhicule' });
    await expect(rangee).toBeVisible();
    expect(await rangee.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(40);

    // Au départ : rien à gauche, du contenu à droite, donc un fondu à droite seulement.
    await rangee.hover();
    const gauche = page.locator('.rangee-fleche[data-sens="gauche"]');
    const droite = page.locator('.rangee-fleche[data-sens="droite"]');
    await expect(droite).toBeVisible();
    await expect(gauche).toBeHidden();
    expect(await variable(rangee, '--fondu-g')).toBe('0px');
    expect(await variable(rangee, '--fondu-d')).toBe('32px');

    // Un coup de molette : la rangée défile de côté, la flèche de gauche paraît, le fondu de gauche aussi.
    await page.mouse.wheel(0, 240);
    await expect.poll(() => rangee.evaluate((element) => element.scrollLeft)).toBeGreaterThan(100);
    await expect(gauche).toBeVisible();
    expect(await variable(rangee, '--fondu-g')).toBe('32px');

    // La flèche de droite fait défiler ; ces boutons tiennent 48 px.
    const avant = await rangee.evaluate((element) => element.scrollLeft);
    const boite = await droite.boundingBox();
    expect(boite?.width).toBeGreaterThanOrEqual(48);
    expect(boite?.height).toBeGreaterThanOrEqual(48);
    await droite.click();
    await expect.poll(() => rangee.evaluate((element) => element.scrollLeft)).toBeGreaterThan(avant + 100);

    // Au bout : plus de flèche de droite, plus de fondu de droite.
    await rangee.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
    await expect(droite).toBeHidden();
    await expect.poll(() => variable(rangee, '--fondu-d')).toBe('0px');
    expect(await variable(rangee, '--fondu-g')).toBe('32px');

    // Souris ailleurs : les flèches s'effacent.
    await page.mouse.move(600, 300);
    await expect(gauche).toBeHidden();
  });
});

test.describe('retouches : téléphone', () => {
  test('B2 : au toucher, pas de flèches ; B1 : la rangée garde son fondu', { tag: '@essentiel' }, async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Digit1');
    const rangee = dock(page).getByRole('group', { name: 'Véhicule' });
    await expect(rangee).toBeVisible();
    await rangee.hover();
    await expect(page.locator('.rangee-fleche:visible')).toHaveCount(0);
    expect(await variable(rangee, '--fondu-d')).toBe('32px');
  });

  test('A4 : « Garage · <véhicule> » n’est plus écrit deux fois ; B8 : « Vue atelier »', async ({ page }) => {
    await openApp(page);
    await waitForBench(page);
    // Aux sections, le menu dit déjà « Au garage · <véhicule> » : plus d'étiquette en haut.
    await expect(dock(page).locator('.dock-vehicle')).toBeVisible();
    await expect(page.locator('.tag')).toHaveCount(0);
    // Descendu d'un niveau, ou menu fermé : l'étiquette dit où l'on est.
    await dock(page).getByRole('button', { name: 'Fermer le menu' }).tap();
    await expect(page.locator('.tag')).toHaveText(/^Garage · /);

    // Vue intérieure : « Vue atelier » (le bouton rond et la rangée des places) au lieu de « Sortir ».
    const volant = quick(page).getByRole('button', { name: 'Intérieur', exact: true });
    await volant.tap();
    await expect(quick(page).getByRole('button', { name: 'Vue atelier', exact: true })).toBeVisible();
    const places = page.getByRole('group', { name: 'Ta place dans le véhicule' });
    await expect(places.getByRole('button', { name: 'Vue atelier', exact: true })).toBeVisible();
    await expect(places.getByRole('button', { name: 'Sortir' })).toHaveCount(0);
  });

  test.describe('A1 : la pastille d’état', () => {
    // Service worker bloqué : « Cache hors ligne en panne », la pastille la plus large.
    test.use({ serviceWorkers: 'block' });
    const sansRecouvrement = async (page: Page) => {
      const pastille = page.locator('.pill:not([hidden])');
      await expect(pastille).toBeVisible();
      const p = await pastille.boundingBox();
      if (!p) throw new Error('pastille sans boîte');
      const voisins = [page.locator('.solde'), quick(page).getByRole('button')];
      for (const voisin of voisins) {
        for (const cible of await voisin.all()) {
          if (!(await cible.isVisible())) continue;
          const b = await cible.boundingBox();
          if (!b) continue;
          const recouvre = p.x < b.x + b.width && b.x < p.x + p.width && p.y < b.y + b.height && b.y < p.y + p.height;
          expect(recouvre, `la pastille recouvre ${await cible.evaluate((element) => element.className || element.tagName)}`).toBe(false);
        }
      }
    };

    test('en portrait, elle ne recouvre ni le solde ni un bouton rond', async ({ page }) => {
      await openApp(page);
      await sansRecouvrement(page);
    });

    test('en paysage, elle ne recouvre ni le solde ni le bouton Atelier', async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await openApp(page);
      await sansRecouvrement(page);
    });
  });

  test('D1 : en paysage, la rubrique « Jeu » de l’Atelier se voit et ne passe pas sous « Retour »', { tag: '@essentiel' }, async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await openApp(page);
    await quick(page).getByRole('button', { name: 'Atelier', exact: true }).tap();
    const panneau = page.getByRole('dialog');
    const rubriques = panneau.getByRole('navigation', { name: 'Rubriques de l’atelier' });
    await expect(rubriques).toBeVisible();
    const retour = await panneau.getByRole('button', { name: 'Retour à l’atelier' }).boundingBox();
    const zone = await rubriques.boundingBox();
    if (!retour || !zone) throw new Error('boîtes introuvables');
    for (const nom of ['Réglages', 'Sous le capot', 'Jeu']) {
      const b = await rubriques.getByRole('button', { name: nom, exact: true }).boundingBox();
      expect(b, nom).not.toBeNull();
      if (!b) continue;
      expect(b.x + b.width, `${nom} dans la rangée`).toBeLessThanOrEqual(zone.x + zone.width + 1);
      const recouvre = b.x < retour.x + retour.width && retour.x < b.x + b.width && b.y < retour.y + retour.height && retour.y < b.y + b.height;
      expect(recouvre, `${nom} sous « Retour »`).toBe(false);
    }
    await rubriques.getByRole('button', { name: 'Jeu', exact: true }).tap();
    await expect(panneau.getByRole('heading', { name: 'Ton compte' })).toBeVisible();
  });
});

test.describe('retouches : la route', () => {
  test.setTimeout(600_000);

  test('E2 : Échap et P mettent en pause et reprennent ; E3 : pas de « ? » en course', { tag: '@essentiel' }, async ({ page }) => {
    const stage = page.locator(`.${DRIVE_STAGE_CLASS}`);
    // L'aperçu ne reste qu'en balade (vague X) : on la pose, pour vérifier aussi la vitrine.
    await preferBalade(page);
    await page.goto('./#/sortie');
    await expect(stage).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
    await attendreApercu(page);
    // L'aperçu reste une vitrine : le « ? » y est, et Échap n'y met rien en pause.
    await expect(page.getByRole('button', { name: 'Aide', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0);

    await commencerCourse(page);
    // En course : plus de « ? ».
    await expect(page.getByRole('button', { name: 'Aide', exact: true })).toBeHidden();
    const pause = page.locator('.drive-pause');
    await expect(pause).toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.press('Escape');
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Aide', exact: true })).toBeHidden();
    await page.keyboard.press('KeyP');
    await expect(pause).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('KeyP');
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(pause).toHaveAttribute('aria-pressed', 'false');

    // Réglages ouverts : Échap les ferme (et rend la route), sans basculer la pause une seconde fois.
    await page.getByRole('button', { name: 'Réglages de la sortie' }).tap();
    const reglages = page.getByRole('dialog', { name: 'Réglages' });
    await expect(reglages).toBeVisible();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(reglages).toBeHidden();
    await expect(pause).toHaveAttribute('aria-pressed', 'false');
  });
});
