// Le moteur de l'adversaire du duel (src/drive/adversaire/son.ts) : écoute impossible hors d'un téléphone, on
// vérifie que le volume suit la distance, que le côté se place à gauche ou à droite, que les aigus s'éteignent
// derrière, et que rien ne joue hors du duel.
import { describe, expect, it } from 'vitest';
import { SON_ADVERSAIRE } from '../../src/data/adversaires.ts';
import { brancherSonAdversaire, placerSon, suivreApproche, type PlaceSon, type SuiviApproche } from '../../src/drive/adversaire/son.ts';
import { liveDuel } from '../../src/drive/adversaire/course.ts';

const r = SON_ADVERSAIRE;
const ici = (d: number, l: number, fermeture = 0): PlaceSon => placerSon(d, l, r, { gain: 0, pan: 0, coupure: 0, hauteur: 1 }, fermeture);

describe('le moteur de l’adversaire s’entend', () => {
  it('à sa hauteur, aussi fort que le moteur du joueur ; de moins en moins fort avec la distance, éteint au-delà de la portée', () => {
    expect(r.niveau).toBe(1);
    expect(ici(0, 3).gain).toBe(1);
    expect(ici(r.proche, 0).gain).toBe(1);
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

  it('la baisse avec la distance est marquée : moins du tiers du volume à 20 m, presque rien à 60 m', () => {
    expect(ici(20, 0).gain).toBeLessThan(0.33);
    expect(ici(60, 0).gain).toBeLessThan(0.06);
  });

  it('approche : plus fort et plus aigu quand il arrive, moins fort et plus grave quand il s’éloigne, sans dépasser le niveau', () => {
    const calme = ici(20, 0, 0);
    const arrive = ici(20, 0, r.vitesseRef);
    const part = ici(20, 0, -r.vitesseRef);
    expect(calme.hauteur).toBe(1);
    expect(arrive.gain).toBeGreaterThan(calme.gain);
    expect(part.gain).toBeLessThan(calme.gain);
    expect(arrive.hauteur).toBeCloseTo(1 + r.hauteur, 9);
    expect(part.hauteur).toBeCloseTo(1 - r.hauteur, 9);
    // L'effet est borné : une vitesse folle ne va pas plus loin que la vitesse de référence ; tout près, jamais au-delà du niveau.
    expect(ici(20, 0, 1000).hauteur).toBeCloseTo(arrive.hauteur, 9);
    expect(ici(0, 3, 1000).gain).toBe(r.niveau);
    expect(ici(0, 3, -r.vitesseRef).gain).toBeLessThan(r.niveau);
    // Valeur absurde : pas d'effet plutôt qu'un NaN.
    expect(ici(20, 0, Number.NaN).hauteur).toBe(1);
  });

  it('suivi de l’approche : vitesse lissée, sans saut au premier appel ni après un trou de mesure', () => {
    const suivi: SuiviApproche = { dist: Number.NaN, vitesse: 0 };
    expect(suivreApproche(suivi, 50, 0.1, r.lissage)).toBe(0);
    // 10 m/s de fermeture constante : la vitesse lissée monte vers 10 sans l'atteindre d'un coup.
    let v = 0;
    let dist = 50;
    for (let i = 0; i < 40; i += 1) {
      dist -= 1;
      const suivante = suivreApproche(suivi, dist, 0.1, r.lissage);
      expect(suivante).toBeGreaterThanOrEqual(v);
      expect(suivante).toBeLessThanOrEqual(10 + 1e-9);
      v = suivante;
    }
    expect(v).toBeGreaterThan(9.5);
    // Il s'éloigne : la vitesse redescend et devient négative, doucement.
    const apres = suivreApproche(suivi, dist + 1, 0.1, r.lissage);
    expect(apres).toBeLessThan(v);
    expect(apres).toBeGreaterThan(0);
    // Trou de mesure (pause d'une seconde) : on repart de zéro.
    expect(suivreApproche(suivi, dist + 100, 1, r.lissage)).toBe(0);
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
