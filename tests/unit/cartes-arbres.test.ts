// Arbres des cartes (tools/maps/arbres.mjs) : le semis ne trahit plus la grille de 7 m des candidats
// (indice de Clark et Evans proche du hasard, plus bas que l'ancien semis), et le plafond par tronçon
// tire au sort au lieu de garder les premières lignes (plus de lisière droite).

import { describe, expect, it } from 'vitest';
import { hasard } from '../../tools/maps/geom2d.mjs';
import { clarkEvans, plafonner, semer } from '../../tools/maps/arbres.mjs';

/** Candidats tels que fetch.mjs les écrit : grille de 7 m, un point tiré au hasard par case. */
function candidats(n: number): number[] {
  const out: number[] = [];
  for (let gz = 0; gz < n; gz += 1) for (let gx = 0; gx < n; gx += 1) out.push((gx + hasard(gx, gz)) * 7, (gz + hasard(gz + 7919, gx)) * 7, 0);
  return out;
}

describe('arbres des cartes', () => {
  const c = candidats(110);
  const zone: [number, number, number, number] = [40, 40, 730, 730];

  it('ne laisse plus voir la grille des candidats', () => {
    // Ancien semis : les candidats gardés à 75 %, sans déplacement.
    const ancien: Array<{ x: number; z: number }> = [];
    for (let t = 0; t < c.length; t += 3) if (hasard(Math.round((c[t] ?? 0) * 10), Math.round((c[t + 1] ?? 0) * 10)) <= 0.75) ancien.push({ x: c[t] ?? 0, z: c[t + 1] ?? 0 });
    const nouveau = semer(c);
    expect(clarkEvans(ancien, zone)).toBeGreaterThan(1.15);
    expect(clarkEvans(nouveau, zone)).toBeLessThan(1.02);
    expect(clarkEvans(nouveau, zone)).toBeGreaterThan(0.7);
    // Bosquets et clairières : la densité varie d'un carré de 70 m à l'autre.
    const comptes = new Map<string, number>();
    for (const a of nouveau) comptes.set(`${Math.floor(a.x / 70)}|${Math.floor(a.z / 70)}`, (comptes.get(`${Math.floor(a.x / 70)}|${Math.floor(a.z / 70)}`) ?? 0) + 1);
    const v = [...comptes.values()];
    expect(Math.max(...v)).toBeGreaterThan(2 * Math.min(...v));
  });

  it('est déterministe', () => {
    expect(JSON.stringify(semer(c))).toBe(JSON.stringify(semer(c)));
  });

  it('plafonne sans lisière droite : le tirage couvre toute la zone', () => {
    const liste = semer(c);
    const garde = plafonner(liste, Math.round(liste.length / 3));
    expect(garde.length).toBe(Math.round(liste.length / 3));
    const nord = garde.filter((a) => a.z < 385).length / garde.length;
    expect(nord).toBeGreaterThan(0.42);
    expect(nord).toBeLessThan(0.58);
    expect(plafonner(liste, liste.length + 1)).toBe(liste);
  });
});
