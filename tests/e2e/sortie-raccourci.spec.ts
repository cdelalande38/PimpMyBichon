// La sortie se trouve du premier coup. Retour du 16 novembre 2026 : « je trouve pas le bouton pour y
// accéder », d'où un bouton rond dans la colonne de droite ; retour du 18 novembre 2026 : ce raccourci
// devient « Jouer », « au même niveau que le bouton configuration », parce que c'est désormais un des
// deux gestes de l'app. Menu replié : « Personnaliser » et « Jouer » côte à côte, en bas ; menu ouvert sur
// ses sections : « Jouer » dans sa barre. Il ouvre Garage › Sortie, à l'étape du mode.

import { expect, test } from '@playwright/test';
import { ENTREE_SORTIE, openApp, pickMap, quick, VIEWPORT, waitForScene } from './helpers.ts';

test('« Jouer », à côté de « Personnaliser », ouvre le menu de la sortie, prêt à sortir', { tag: '@essentiel' }, async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  const dock = page.locator('footer.dock');
  // Le raccourci rond « Sortie » a quitté la colonne de droite.
  await expect(quick(page).getByRole('button', { name: ENTREE_SORTIE, exact: true })).toHaveCount(0);

  // Menu ouvert sur ses sections : « Jouer » dans sa barre, 48 px au doigt.
  const enTete = dock.locator('.dock-head').getByRole('button', { name: 'Jouer', exact: true });
  await expect(enTete).toBeVisible();
  const tete = await enTete.boundingBox();
  expect(tete?.width ?? 0, 'largeur de « Jouer » (barre du menu)').toBeGreaterThanOrEqual(48);
  expect(tete?.height ?? 0, 'hauteur de « Jouer » (barre du menu)').toBeGreaterThanOrEqual(48);

  // Menu replié : les deux gestes au même rang, sans se toucher, entiers dans l'écran, dans le tiers bas.
  await dock.getByRole('button', { name: 'Fermer le menu' }).tap();
  const personnaliser = dock.getByRole('button', { name: 'Personnaliser', exact: true });
  const jouer = dock.getByRole('button', { name: 'Jouer', exact: true });
  await expect(personnaliser).toBeVisible();
  await expect(jouer).toBeVisible();
  const a = await personnaliser.boundingBox();
  const b = await jouer.boundingBox();
  expect(a, '« Personnaliser » mesurable').not.toBeNull();
  expect(b, '« Jouer » mesurable').not.toBeNull();
  if (!a || !b) return;
  for (const [nom, boite] of [['Personnaliser', a], ['Jouer', b]] as const) {
    expect(boite.height, `hauteur de « ${nom} »`).toBeGreaterThanOrEqual(48);
    expect(boite.x, `« ${nom} » dans l’écran, à gauche`).toBeGreaterThanOrEqual(0);
    expect(boite.x + boite.width, `« ${nom} » dans l’écran, à droite`).toBeLessThanOrEqual(VIEWPORT.width + 0.5);
    expect(boite.y, `« ${nom} » dans le tiers bas`).toBeGreaterThanOrEqual((VIEWPORT.height * 2) / 3);
  }
  expect(Math.abs(a.y - b.y), 'au même rang').toBeLessThan(2);
  expect(b.x, '« Jouer » à droite de « Personnaliser », sans le toucher').toBeGreaterThanOrEqual(a.x + a.width + 4);
  await page.screenshot({ path: 'test-results/jouer-menu-replie.png' });

  await jouer.tap();
  await expect(dock.locator('.dock-crumb-here')).toHaveText(ENTREE_SORTIE);
  // Le menu s'ouvre sur sa première étape, le mode (vague U : une étape à la fois).
  await expect(dock.getByRole('group', { name: 'Mode' })).toBeVisible();
  // « Jouer » n'apparaît qu'aux réglages, une carte choisie.
  await expect(dock.getByRole('button', { name: 'Jouer', exact: true })).toHaveCount(0);
  await pickMap(page);
  await expect(dock.getByRole('button', { name: 'Jouer', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/sortie-raccourci.png' });
});

test('en paysage, menu replié : « Personnaliser » et « Jouer » entiers, sans rien recouvrir', { tag: '@essentiel' }, async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openApp(page);
  await waitForScene(page);
  const dock = page.locator('footer.dock');
  await dock.getByRole('button', { name: 'Fermer le menu' }).tap();
  const personnaliser = dock.getByRole('button', { name: 'Personnaliser', exact: true });
  const jouer = dock.getByRole('button', { name: 'Jouer', exact: true });
  await expect(jouer).toBeVisible();
  const a = await personnaliser.boundingBox();
  const b = await jouer.boundingBox();
  if (!a || !b) throw new Error('boutons du menu replié introuvables');
  for (const [nom, boite] of [['Personnaliser', a], ['Jouer', b]] as const) {
    expect(boite.height, `hauteur de « ${nom} »`).toBeGreaterThanOrEqual(48);
    expect(boite.x, `« ${nom} » dans l’écran, à gauche`).toBeGreaterThanOrEqual(0);
    expect(boite.x + boite.width, `« ${nom} » dans l’écran, à droite`).toBeLessThanOrEqual(844.5);
    expect(boite.y + boite.height, `« ${nom} » dans l’écran, en bas`).toBeLessThanOrEqual(390.5);
  }
  // Ils ne se chevauchent pas, quelle que soit la façon dont ils se rangent.
  const separes = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
  expect(separes, '« Personnaliser » et « Jouer » ne se recouvrent pas').toBe(true);
  // Ni les boutons ronds du coin droit.
  for (const rond of await quick(page).getByRole('button').all()) {
    const r = await rond.boundingBox();
    if (!r) continue;
    for (const boite of [a, b]) {
      const libre = r.x + r.width <= boite.x || boite.x + boite.width <= r.x || r.y + r.height <= boite.y || boite.y + boite.height <= r.y;
      expect(libre, 'un bouton rond ne recouvre pas le bas de l’écran').toBe(true);
    }
  }
  await page.screenshot({ path: 'test-results/jouer-menu-replie-paysage.png' });
});
