// Herbe sur la route (tools/maps/couverture.mjs, solSurChaussee ; défaut vu le 18 novembre 2026 sur
// le circuit de Monaco : l'herbe du terrain traversait la chaussée à l'entrée du tunnel et affleurait
// par plaques ailleurs) : le contrôle voit une plaque de terrain de 3 cm sur la chaussée ou sur le
// trottoir, une nappe sous la voûte d'un tunnel, et laisse le terrain qui recouvre la voûte ou qui
// passe sous la route. La garde de la fabrication (gardeChaussee) refuse sous un plafond ce qui
// traverse l'espace du tunnel, pas ce qui le recouvre ni ce qui le touche par un bord.

import { describe, expect, it } from 'vitest';
import { gardeChaussee, PLAFOND_TUNNEL, resumerSolSurChaussee, solSurChaussee, TOLERANCE_SOL } from '../../tools/maps/couverture.mjs';

/** Rectangle horizontal (deux triangles vus d'en haut) de x0 à x1 et de z0 à z1, à la hauteur y. */
function dalle(x0: number, x1: number, z0: number, z1: number, y: number): number[] {
  return [x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0];
}

const maillage = (role: string, positions: number[]) => ({ role, positions, index: null });

/** Rue droite de 100 m vers le sud (Z), 6 m de chaussée, trottoirs de 2,2 m relevés de 14 cm ; tunnel de 40 à 100 m. */
const route = {
  rail: Array.from({ length: 101 }, (_, i) => [0, 0, i]).flat(),
  step: 1,
  loop: false,
  length: 100,
  sections: [
    { from: 0, to: 40, ground: 'sol', width: 6, urban: true },
    { from: 40, to: 100, ground: 'tunnel', width: 6, urban: true },
  ],
};
const rue = [maillage('chaussee', dalle(-3, 3, 0, 100, 0)), maillage('accotement', [...dalle(-5.2, -3, 0, 100, 0.14), ...dalle(3, 5.2, 0, 100, 0.14)])];

describe('herbe au-dessus de la surface roulée', () => {
  it('rien sur une rue propre (terrain sous la chaussée, dessus du tunnel, relief lointain plus bas)', () => {
    const terrain = maillage('terrain', [...dalle(-30, 30, 0, 40.5, -0.2), ...dalle(-30, 30, 40.5, 100, 0.06 + 7.2)]);
    const r = solSurChaussee(route, [...rue, terrain], [maillage('terrain', dalle(-500, 500, -500, 500, -4))]);
    expect(r.points).toBeGreaterThan(100 * 20);
    expect(r.fautes).toEqual([]);
  });

  it('voit une plaque de 3 cm sur la chaussée et une autre sur le trottoir', () => {
    const terrain = maillage('terrain', [...dalle(-1, 1, 10, 12, 0.03), ...dalle(4, 5, 20, 22, 0.17)]);
    const r = solSurChaussee(route, [...rue, terrain]);
    const z = resumerSolSurChaussee(r.fautes);
    expect(z.chaussee).toBeGreaterThan(0);
    expect(z.bord).toBeGreaterThan(0);
    expect(z.parSol).toEqual({ sol: r.fautes.length });
    expect(z.zones).toEqual([10, 20]);
    expect(z.dyMax).toBeCloseTo(0.03, 3);
    // Sous la tolérance (le centimètre) : rien.
    const fin = maillage('terrain', dalle(-1, 1, 10, 12, TOLERANCE_SOL * 0.5));
    expect(solSurChaussee(route, [...rue, fin]).fautes).toEqual([]);
  });

  it('voit la nappe qui traverse le tunnel, pas le terrain qui recouvre la voûte', () => {
    const nappe = maillage('terrain', [-8, 0.5, 50, -8, 0.5, 56, 8, 4, 56, -8, 0.5, 50, 8, 4, 56, 8, 4, 50]);
    const r = solSurChaussee(route, [...rue, nappe]);
    const z = resumerSolSurChaussee(r.fautes);
    expect(z.parSol.tunnel).toBeGreaterThan(20);
    expect(z.dyMax).toBeLessThan(PLAFOND_TUNNEL);
    const dessus = maillage('terrain', dalle(-8, 8, 50, 56, PLAFOND_TUNNEL + 0.5));
    expect(solSurChaussee(route, [...rue, dessus]).fautes).toEqual([]);
  });
});

describe('garde sous la voûte', () => {
  // Emprise protégée d'un tunnel : chaussée de 6 m sur 20 m, à la hauteur 0.
  const g = gardeChaussee(dalle(-3, 3, 0, 20, 0));
  it('refuse ce qui traverse l’espace du tunnel', () => {
    expect(g.couvre([-8, 2, 5], [8, 2, 5], [0, 2, 15], 0, PLAFOND_TUNNEL)).toBe(true);
    // Incliné : de sous la chaussée à 3 m au-dessus.
    expect(g.couvre([-8, -1, 5], [8, 3, 5], [0, 1, 15], 0, PLAFOND_TUNNEL)).toBe(true);
  });
  it('garde le terrain qui recouvre la voûte, celui qui passe dessous, et celui qui touche l’emprise par un bord', () => {
    expect(g.couvre([-8, 7.2, 5], [8, 7.2, 5], [0, 7.2, 15], 0, PLAFOND_TUNNEL)).toBe(false);
    expect(g.couvre([-8, -0.5, 5], [8, -0.5, 5], [0, -0.5, 15], 0, PLAFOND_TUNNEL)).toBe(false);
    expect(g.couvre([3, 0, 2], [9, 7, 2], [3, 0, 8], 0, PLAFOND_TUNNEL)).toBe(false);
  });
  it('donne la hauteur de l’emprise, −Infinity hors d’elle', () => {
    expect(g.hauteur(0, 10)).toBeCloseTo(0, 6);
    expect(g.hauteur(10, 10)).toBe(-Infinity);
  });
});
