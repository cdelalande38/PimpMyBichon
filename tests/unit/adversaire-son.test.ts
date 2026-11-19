// Le moteur de l'adversaire du duel (src/drive/adversaire/son.ts) : écoute impossible hors d'un téléphone, on
// vérifie que le volume suit la distance, que le côté se place à gauche ou à droite, que les aigus s'éteignent
// derrière, et que rien ne joue hors du duel.
import { describe, expect, it } from 'vitest';
import { SON_ADVERSAIRE } from '../../src/data/adversaires.ts';
import { brancherSonAdversaire, placerSon, type PlaceSon } from '../../src/drive/adversaire/son.ts';
import { liveDuel } from '../../src/drive/adversaire/course.ts';

const r = SON_ADVERSAIRE;
const ici = (d: number, l: number): PlaceSon => placerSon(d, l, r, { gain: 0, pan: 0, coupure: 0 });

describe('le moteur de l’adversaire s’entend', () => {
  it('plus faible que le moteur du joueur, de moins en moins fort avec la distance, éteint au-delà de la portée', () => {
    expect(r.niveau).toBeLessThan(1);
    const distances = [0, r.proche, 10, 20, 40, 80, r.portee * 0.99, r.portee, r.portee * 2];
    const gains = distances.map((d) => ici(d, 0).gain);
    expect(gains[0]).toBeLessThanOrEqual(r.niveau);
    for (let i = 1; i < gains.length; i += 1) expect(gains[i]!, `${distances[i]} m`).toBeLessThanOrEqual(gains[i - 1]!);
    expect(ici(20, 0).gain).toBeLessThan(ici(10, 0).gain * 0.6);
    expect(ici(r.portee, 0).gain).toBe(0);
    expect(ici(-r.portee * 2, 0).gain).toBe(0);
    // Même distance devant ou derrière : même volume.
    expect(ici(-30, 0).gain).toBeCloseTo(ici(30, 0).gain, 9);
  });

  it('à gauche, à droite : placé de son côté ; derrière : les aigus s’éteignent ; devant : rien de coupé', () => {
    expect(ici(0, 2.2).pan).toBeLessThan(-0.5);
    expect(ici(0, -2.2).pan).toBeGreaterThan(0.5);
    expect(Math.abs(ici(40, 0).pan)).toBeLessThan(1e-9);
    expect(ici(20, 0).coupure).toBe(20000);
    expect(ici(-20, 0).coupure).toBeCloseTo(r.derriere, 6);
    expect(ici(-20, 20).coupure).toBeGreaterThan(r.derriere);
    expect(ici(-20, 20).coupure).toBeLessThan(20000);
  });

  it('hors du duel : aucun lecteur, aucun contexte audio demandé', () => {
    let demandes = 0;
    const son = brancherSonAdversaire(() => {
      demandes += 1;
      return null;
    });
    liveDuel.current = null;
    son.maj(true, 1);
    son.maj(false, 1);
    son.couper();
    expect(demandes).toBe(0);
  });
});
