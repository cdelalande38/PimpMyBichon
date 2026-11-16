// Boîte de vitesses fictive de la sortie de nuit (src/drive/boite.ts, src/data/boites.ts) : régime
// d'après la vitesse, passages de rapport, frein, arrêt, et régime ramené à ce que les sons jouent.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOITE_PAR_DEFAUT, BOITES, boiteDe, type BoiteSpec } from '../../src/data/boites.ts';
import { CHARGE_PASSAGE, etatInitial, pasBoite, regimeJoue, regimeRoues, seuilPassage, type EtatBoite, type SortieBoite } from '../../src/drive/boite.ts';

const familles = JSON.parse(readFileSync(new URL('../../src/audio/engine/familles.json', import.meta.url), 'utf8')) as {
  familles: Record<string, { genre: string }>;
};

const DT = 0.25;

/** Fait rouler la boîte : vitesse(t) en km/h, charge et frein constants ; rend chaque sortie. */
function rouler(boite: BoiteSpec, ralenti: number, duree: number, vitesse: (t: number) => number, charge: number, frein = false, depart?: EtatBoite): SortieBoite[] {
  let etat = depart ?? etatInitial(ralenti);
  const sorties: SortieBoite[] = [];
  for (let t = DT; t <= duree + 1e-9; t += DT) {
    const sortie = pasBoite(etat, { vitesseKmh: vitesse(t), charge, frein }, boite, ralenti, DT);
    sorties.push(sortie);
    etat = sortie;
  }
  return sorties;
}

describe('boîtes (données)', () => {
  it('une boîte par famille de moteur fabriquée, sans identifiant de véhicule', () => {
    const moteurs = Object.entries(familles.familles)
      .filter(([, item]) => item.genre === 'moteur')
      .map(([id]) => id);
    expect(moteurs.length).toBeGreaterThan(0);
    for (const id of moteurs) expect(BOITES[id], id).toBeDefined();
    for (const id of Object.keys(BOITES)) expect(Object.keys(familles.familles), id).toContain(id);
    expect(boiteDe('famille-inconnue')).toBe(BOITE_PAR_DEFAUT);
    expect(boiteDe(null)).toBe(BOITE_PAR_DEFAUT);
  });

  for (const [id, boite] of [...Object.entries(BOITES), ['défaut', BOITE_PAR_DEFAUT] as const]) {
    it(`${id} : rapports de plus en plus longs, seuils dans l'ordre, passage à plein gaz au-dessus du rétrogradage`, () => {
      expect(boite.kmhPar1000.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < boite.kmhPar1000.length; i += 1) expect(boite.kmhPar1000[i]!).toBeGreaterThan(boite.kmhPar1000[i - 1]!);
      expect(boite.retrograde).toBeLessThan(boite.passageCroisiere);
      expect(boite.passageCroisiere).toBeLessThan(boite.passagePleinGaz);
      expect(boite.passagePleinGaz).toBeLessThan(boite.rupteur);
      expect(boite.dureePassage).toBeGreaterThan(0);
      expect(boite.dureePassage).toBeLessThan(1);
      for (let i = 0; i < boite.kmhPar1000.length - 1; i += 1) {
        const apres = (boite.passagePleinGaz * boite.kmhPar1000[i]!) / boite.kmhPar1000[i + 1]!;
        expect(apres, `rapport ${i + 2}`).toBeGreaterThan(boite.retrograde);
      }
    });
  }
});

describe('boîte : montée, passages, frein, arrêt', () => {
  const boite = BOITES['diesel-turbo']!;
  const ralenti = 850;

  it('à l’arrêt : premier rapport, ralenti ; un coup d’accélérateur fait à peine monter', () => {
    const arret = rouler(boite, ralenti, 3, () => 0, 0);
    const fin = arret[arret.length - 1]!;
    expect(fin.rapport).toBe(1);
    expect(fin.regime).toBeCloseTo(ralenti, 0);
    const gaz = rouler(boite, ralenti, 3, () => 0, 1);
    expect(gaz[gaz.length - 1]!.regime).toBeGreaterThan(ralenti);
    expect(gaz[gaz.length - 1]!.regime).toBeLessThan(boite.embrayage);
  });

  it('montée à plein gaz : le régime monte, les rapports passent un à un, le régime tombe à chaque passage', () => {
    const sorties = rouler(boite, ralenti, 30, (t) => Math.min(130, t * 3 * 3.6), 1);
    let passages = 0;
    for (let i = 1; i < sorties.length; i += 1) {
      const avant = sorties[i - 1]!;
      const apres = sorties[i]!;
      expect(apres.rapport - avant.rapport).toBeGreaterThanOrEqual(0);
      expect(apres.rapport - avant.rapport).toBeLessThanOrEqual(1);
      expect(apres.regime).toBeLessThanOrEqual(boite.rupteur);
      expect(apres.regime).toBeGreaterThanOrEqual(ralenti - 1);
      if (apres.rapport > avant.rapport) {
        passages += 1;
        // Le passage lève le pied, puis le régime rejoint le rapport suivant, plus bas.
        expect(apres.charge).toBeLessThanOrEqual(CHARGE_PASSAGE);
        expect(apres.passage).toBeGreaterThan(0);
        const suite = sorties[i + 1]!;
        expect(suite.regime).toBeLessThan(apres.regime);
      }
    }
    expect(passages).toBe(boite.kmhPar1000.length - 1);
    expect(sorties[sorties.length - 1]!.rapport).toBe(boite.kmhPar1000.length);
    // Hors passage (ni commencé ni en cours à ce pas), la charge suit l'accélérateur.
    const embraye = sorties.filter((s, i) => i > 0 && s.passage === 0 && sorties[i - 1]!.passage === 0 && s.rapport === sorties[i - 1]!.rapport);
    expect(embraye.length).toBeGreaterThan(10);
    expect(embraye.every((s) => s.charge === 1)).toBe(true);
  });

  it('en croisière, on passe plus tôt qu’à plein gaz', () => {
    expect(seuilPassage(boite, 0.2)).toBeLessThan(seuilPassage(boite, 1));
    const rapportA = (charge: number) => rouler(boite, ralenti, 20, (t) => Math.min(60, t * 2 * 3.6), charge).at(-1)!.rapport;
    expect(rapportA(0.2)).toBeGreaterThan(rapportA(1));
  });

  it('régime à vitesse stable : celui des roues sur le rapport engagé, sans pompage', () => {
    for (let kmh = 5; kmh <= 120; kmh += 5) {
      const sorties = rouler(boite, ralenti, 20, () => kmh, 0.3);
      const tail = sorties.slice(-20);
      const rapports = new Set(tail.map((s) => s.rapport));
      expect(rapports.size, `${kmh} km/h`).toBe(1);
      const fin = tail[tail.length - 1]!;
      const roues = regimeRoues(kmh, boite, fin.rapport);
      // Au premier rapport, sous le régime d'embrayage, l'embrayage patine un peu (charge 0,3).
      const patine = fin.rapport === 1 && roues < boite.embrayage ? ralenti + (boite.embrayage - ralenti) * 0.3 : 0;
      expect(fin.regime, `${kmh} km/h`).toBeCloseTo(Math.min(boite.rupteur, Math.max(ralenti, roues, patine)), 0);
    }
  });

  it('au frein : charge nulle, on rétrograde en ralentissant, jamais sous le ralenti', () => {
    const lance = rouler(boite, ralenti, 40, () => 100, 0.3).at(-1)!;
    expect(lance.rapport).toBe(boite.kmhPar1000.length);
    const freinage = rouler(boite, ralenti, 12, (t) => Math.max(0, 100 - t * 6 * 3.6), 1, true, lance);
    expect(freinage.every((s) => s.charge === 0)).toBe(true);
    expect(freinage.every((s) => s.regime >= ralenti - 1)).toBe(true);
    for (let i = 1; i < freinage.length; i += 1) expect(freinage[i]!.rapport).toBeLessThanOrEqual(freinage[i - 1]!.rapport);
    const fin = freinage.at(-1)!;
    expect(fin.rapport).toBe(1);
    expect(fin.regime).toBeCloseTo(ralenti, -1);
  });

  it('départ arrêté : l’embrayage patine, le régime monte vers le régime d’embrayage selon la charge', () => {
    const doux = pasBoite(etatInitial(ralenti), { vitesseKmh: 3, charge: 0.2, frein: false }, boite, ralenti, 1);
    const fort = pasBoite(etatInitial(ralenti), { vitesseKmh: 3, charge: 1, frein: false }, boite, ralenti, 1);
    expect(fort.regime).toBeGreaterThan(doux.regime);
    expect(fort.regime).toBeLessThanOrEqual(boite.embrayage + 1);
    expect(fort.regime).toBeGreaterThan(regimeRoues(3, boite, 1));
  });

  it('entrées absurdes : pas de NaN, bornes tenues', () => {
    const sortie = pasBoite({ rapport: 99, regime: Number.NaN, passage: -1 }, { vitesseKmh: Number.NaN, charge: Number.POSITIVE_INFINITY, frein: false }, boite, ralenti, Number.NaN);
    expect(Number.isFinite(sortie.regime)).toBe(true);
    expect(sortie.rapport).toBe(1);
    const vite = pasBoite({ rapport: 99, regime: 1000, passage: 0 }, { vitesseKmh: 400, charge: 1, frein: false }, boite, ralenti, 0.25);
    expect(vite.rapport).toBe(boite.kmhPar1000.length);
    expect(vite.regime).toBeLessThanOrEqual(boite.rupteur);
  });
});

describe('régime joué par les sons', () => {
  const plage = { min: 1350, max: 6625 };

  it('tel quel s’il tient dans la plage des boucles', () => {
    expect(regimeJoue(3000, 1350, 6000, plage)).toBe(3000);
    expect(regimeJoue(9000, 1350, 6000, plage)).toBe(plage.max);
    expect(regimeJoue(500, 1350, 6000, plage)).toBe(plage.min);
  });

  it('ramené sur la plage des sons quand le moteur réel tourne plus haut, en gardant l’ordre', () => {
    const rupteur = 13000;
    expect(regimeJoue(1350, 1350, rupteur, plage)).toBe(plage.min);
    expect(regimeJoue(rupteur, 1350, rupteur, plage)).toBe(plage.max);
    let avant = -Infinity;
    for (let r = 1350; r <= rupteur; r += 250) {
      const joue = regimeJoue(r, 1350, rupteur, plage);
      expect(joue).toBeGreaterThan(avant);
      expect(joue).toBeLessThanOrEqual(plage.max);
      avant = joue;
    }
  });

  it('sans plage connue (sons pas encore chargés) : le régime réel', () => {
    expect(regimeJoue(4200, 900, 4500, null)).toBe(4200);
  });
});
