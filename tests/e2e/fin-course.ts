// L'écran de fin d'une course, vu par les parcours (lot « fin », vague U ; src/ui/drive/FinCourseVue.tsx,
// fincourse.css) : un seul jeu de boutons en bas, trois au plus, le premier en rouge ; en paysage, le
// résultat et les boutons à gauche, la suite à droite qui défile seule, sans moitié d'écran vide ; en portrait,
// les boutons entiers sous le pouce, en haut comme défilé en bas. Servi à tests/e2e/carriere.spec.ts et
// tests/e2e/courses.spec.ts. Captures de revue à la demande : PMB_CAPTURES_FIN=<dossier>.

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

const CAPTURES_FIN = process.env.PMB_CAPTURES_FIN;

/** Capture de revue de l'écran de fin, à la demande (PMB_CAPTURES_FIN). */
export async function photoFin(page: Page, nom: string): Promise<void> {
  if (!CAPTURES_FIN) return;
  mkdirSync(CAPTURES_FIN, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURES_FIN, `${nom}.png`) });
}

/** La commande tient dans l'écran, offre 48 px au doigt, n'est rognée par aucune zone qui défile, et rien n'est posé dessus. */
export async function commandeEntiere(page: Page, commande: Locator, nom: string): Promise<void> {
  const boite = await commande.boundingBox();
  const vue = page.viewportSize();
  expect(boite, nom).not.toBeNull();
  if (!boite || !vue) return;
  expect(boite.height, `hauteur de « ${nom} »`).toBeGreaterThanOrEqual(48);
  expect(boite.width, `largeur de « ${nom} »`).toBeGreaterThanOrEqual(48);
  expect(boite.y, `« ${nom} » sous le haut`).toBeGreaterThanOrEqual(0);
  expect(boite.y + boite.height, `« ${nom} » au-dessus du bas`).toBeLessThanOrEqual(vue.height + 0.5);
  expect(boite.x, `« ${nom} » dans la largeur`).toBeGreaterThanOrEqual(-0.5);
  expect(boite.x + boite.width, `« ${nom} » dans la largeur`).toBeLessThanOrEqual(vue.width + 0.5);
  const rognee = await commande.evaluate((el) => {
    const r = el.getBoundingClientRect();
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (getComputedStyle(p).overflowY === 'visible') continue;
      const c = p.getBoundingClientRect();
      if (r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5) return `rognée par ${p.className || p.tagName}`;
    }
    for (const y of [r.top + 3, r.bottom - 3]) {
      for (const x of [r.left + 3, r.left + r.width / 2, r.right - 3]) {
        const dessus = document.elementFromPoint(x, y);
        if (!dessus || !el.contains(dessus)) return `couverte par ${dessus?.className || dessus?.tagName}`;
      }
    }
    // Le libellé tient dans le bouton (rien ne déborde).
    if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) return 'libellé qui déborde';
    return '';
  });
  expect(rognee, nom).toBe('');
}

/** Les boutons du bas de l'écran de fin (un seul jeu), dans l'ordre. */
export const actesDeFin = (page: Page) => page.locator('.fin-course .fin-course-actes').getByRole('button');

/** L'écran de fin : un seul jeu de boutons, ceux attendus, dans l'ordre, le premier en rouge ; aucun dans le bloc de la carrière. */
export async function boutonsDeFin(page: Page, noms: (string | RegExp)[]): Promise<void> {
  await expect(actesDeFin(page)).toHaveCount(noms.length);
  for (const [i, nom] of noms.entries()) await expect(actesDeFin(page).nth(i)).toHaveAccessibleName(nom);
  await expect(actesDeFin(page).first()).toHaveClass(/\bcta\b/);
  await expect(page.locator('.fin-course .btn.cta')).toHaveCount(1);
  await expect(page.locator('.carriere-fin').getByRole('button')).toHaveCount(0);
  await expect(page.locator('.fin-course').getByRole('button', { name: /^Rentrer au garage/ })).toHaveCount(1);
}

/**
 * Paysage : deux colonnes côte à côte, le résultat et les boutons à gauche, la suite à droite. En haut puis
 * défilée jusqu'en bas, la gauche reste pleine (le résultat en haut, les boutons en bas), les boutons entiers.
 */
export async function finEnDeuxColonnes(page: Page, nom: string): Promise<void> {
  const vue = page.viewportSize();
  if (!vue) throw new Error('taille de page inconnue');
  const fin = page.locator('.fin-course');
  const droite = fin.locator('.fin-course-suite');
  for (const etat of ['haut', 'bas'] as const) {
    if (etat === 'bas') await droite.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const p = await fin.boundingBox();
    const g = await fin.locator('.fin-course-resultat').boundingBox();
    const d = await droite.boundingBox();
    const a = await fin.locator('.fin-course-actes').boundingBox();
    if (!p || !g || !d || !a) throw new Error(`colonnes introuvables (${nom}, ${etat})`);
    const bas = (b: { y: number; height: number }) => b.y + b.height;
    expect(p.y, `panneau dans l'écran (${nom}, ${etat})`).toBeGreaterThanOrEqual(0);
    expect(bas(p), `panneau dans l'écran (${nom}, ${etat})`).toBeLessThanOrEqual(vue.height + 0.5);
    expect(g.x + g.width, `résultat à gauche de la suite (${nom}, ${etat})`).toBeLessThanOrEqual(d.x + 1);
    expect(a.x + a.width, `boutons à gauche de la suite (${nom}, ${etat})`).toBeLessThanOrEqual(d.x + 1);
    // La gauche pleine sur toute la hauteur du panneau : le résultat en haut, les boutons en bas, rien entre.
    expect(g.y, `résultat en haut (${nom}, ${etat})`).toBeLessThanOrEqual(p.y + 1);
    expect(a.y, `boutons sous le résultat (${nom}, ${etat})`).toBeGreaterThanOrEqual(bas(g) - 1);
    expect(a.y, `boutons contre le résultat (${nom}, ${etat})`).toBeLessThanOrEqual(bas(g) + 1);
    expect(bas(a), `boutons en bas (${nom}, ${etat})`).toBeGreaterThanOrEqual(bas(p) - 1);
    // La droite sur toute la hauteur du panneau.
    expect(d.y, `suite en haut (${nom}, ${etat})`).toBeLessThanOrEqual(p.y + 1);
    expect(bas(d), `suite jusqu'en bas (${nom}, ${etat})`).toBeGreaterThanOrEqual(bas(p) - 1);
    // Le titre du résultat reste lisible.
    await expect(fin.getByRole('heading', { name: 'Arrivée' })).toBeInViewport();
    const n = await actesDeFin(page).count();
    for (let i = 0; i < n; i += 1) await commandeEntiere(page, actesDeFin(page).nth(i), `bouton ${i + 1} de la fin (${nom}, ${etat})`);
    await photoFin(page, `${nom}-${etat}`);
  }
  await droite.evaluate((el) => el.scrollTo(0, 0));
}

/** Portrait : en haut, puis défilé jusqu'en bas ; les boutons restent entiers sous le pouce. */
export async function finEnPortrait(page: Page, nom: string): Promise<void> {
  const defile = page.locator('.fin-course .fin-course-defile');
  for (const etat of ['haut', 'bas'] as const) {
    if (etat === 'bas') await defile.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const n = await actesDeFin(page).count();
    for (let i = 0; i < n; i += 1) await commandeEntiere(page, actesDeFin(page).nth(i), `bouton ${i + 1} de la fin (${nom}, ${etat})`);
    await photoFin(page, `${nom}-${etat}`);
  }
  await defile.evaluate((el) => el.scrollTo(0, 0));
}
