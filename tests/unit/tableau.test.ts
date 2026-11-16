// Tableau de bord vivant (src/scene/vehicle/tableau.ts) : angle de l'aiguille, bornes, vitesse affichée
// (même arrondi que le compteur de l'écran), cadence d'écriture de la toile (jamais deux fois la même
// valeur, dix fois par seconde au plus), validation de l'instrument dans le manifeste.

import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pilot } from '../../src/drive/contrat.ts';
import { validateManifest } from '../../src/data/vehicles.ts';
import type { CabinPanel, PanelInstrument } from '../../src/data/vehicleTypes.ts';
import {
  angleAiguille,
  BALAYAGE,
  CADENCE_MS,
  CELLULES,
  cellulesAllumees,
  fraction,
  kmhAffiche,
  LiveInstrument,
  maxDe,
  mesureDe,
  Rafraichisseur,
  regimeAffiche,
  segmentsDe,
  TableauVivant,
  VITESSE_MAX,
} from '../../src/scene/vehicle/tableau.ts';

const VEHICLES = new URL('../../public/assets/vehicles/', import.meta.url);

/** Pilote réduit à ce que le tableau lit : vitesse (m/s) et régime. */
function pilote(speed: number, rpm = 0, max = 8000, rouge = 6500): Pilot {
  return { motion: { speed }, train: { rpm, zones: { vert: 1500, orange: 5000, rouge, max } } } as unknown as Pilot;
}

describe('vitesse affichée', () => {
  it('suit la formule du compteur de l’écran (km/h arrondis, jamais négatifs)', () => {
    for (const speed of [0, 0.1, 0.139, 5, 13.89, 13.9, 27.77, 41.6, 69.44]) expect(kmhAffiche(speed)).toBe(Math.max(0, Math.round(speed * 3.6)));
    expect(kmhAffiche(13.9)).toBe(50);
    expect(kmhAffiche(-3)).toBe(0);
    expect(kmhAffiche(Number.NaN)).toBe(0);
    expect(kmhAffiche(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('lit la vitesse et le régime du pilote, zéro sans pilote ni moteur', () => {
    expect(mesureDe('vitesse', pilote(25))).toBe(90);
    expect(mesureDe('regime', pilote(25, 3200))).toBe(3200);
    expect(mesureDe('vitesse', null)).toBe(0);
    expect(mesureDe('regime', null)).toBe(0);
    expect(mesureDe('regime', { motion: { speed: 5 } } as unknown as Pilot)).toBe(0);
  });

  it('arrondit le régime de l’aiguille au pas et borne la barre', () => {
    expect(regimeAffiche(3224)).toBe(3200);
    expect(regimeAffiche(3226)).toBe(3250);
    expect(regimeAffiche(-10)).toBe(0);
    expect(cellulesAllumees(0, 8000)).toBe(0);
    expect(cellulesAllumees(8000, 8000)).toBe(CELLULES);
    expect(cellulesAllumees(12000, 8000)).toBe(CELLULES);
    expect(cellulesAllumees(4000, 8000)).toBe(CELLULES / 2);
    expect(cellulesAllumees(4000, 0)).toBe(0);
  });
});

describe('angle de l’aiguille', () => {
  it('balaie de −135° à +135° depuis le haut par défaut, et bute aux deux bouts', () => {
    expect(angleAiguille(0, 160)).toBe(BALAYAGE[0]);
    expect(angleAiguille(160, 160)).toBe(BALAYAGE[1]);
    expect(angleAiguille(80, 160)).toBeCloseTo(0, 9);
    expect(angleAiguille(40, 160)).toBeCloseTo(-67.5, 9);
    expect(angleAiguille(400, 160)).toBe(135);
    expect(angleAiguille(-20, 160)).toBe(-135);
    expect(angleAiguille(Number.NaN, 160)).toBe(-135);
    expect(angleAiguille(50, 0)).toBe(-135);
  });

  it('respecte un balayage du manifeste et le sens antihoraire', () => {
    expect(angleAiguille(0, 100, [-90, 180])).toBe(-90);
    expect(angleAiguille(50, 100, [-90, 180])).toBeCloseTo(45, 9);
    expect(angleAiguille(25, 100, [-135, 135], 'antihoraire')).toBeCloseTo(67.5, 9);
    expect(fraction(1.2, 1)).toBe(1);
  });

  it('prend la fin de plage du manifeste, sinon celle du moteur (régime) ou 240 km/h (vitesse)', () => {
    const regime: PanelInstrument = { mesure: 'regime' };
    expect(maxDe({ mesure: 'vitesse' }, 'vitesse', null)).toBe(VITESSE_MAX);
    expect(maxDe({ mesure: 'vitesse', max: 160 }, 'vitesse', null)).toBe(160);
    expect(maxDe(regime, 'regime', pilote(0, 0, 9000))).toBe(9000);
    expect(maxDe(regime, 'regime', null)).toBe(8000);
  });

  it('forme les chiffres à segments', () => {
    expect(segmentsDe(8)).toBe(0b1111111);
    expect(segmentsDe(1)).toBe(0b0000110);
    expect(segmentsDe(7)).toBe(0b0000111);
    expect(segmentsDe(11)).toBe(0);
  });
});

describe('cadence d’écriture', () => {
  it('ne réécrit jamais une valeur inchangée, ni plus de dix fois par seconde', () => {
    const cadence = new Rafraichisseur();
    expect(cadence.due(0, 0, 1000)).toBe(true); // première valeur
    expect(cadence.due(0, 0, 1500)).toBe(false); // inchangée
    expect(cadence.due(1, 0, 1000 + CADENCE_MS - 1)).toBe(false); // trop tôt : retenue, pas perdue
    expect(cadence.due(1, 0, 1000 + CADENCE_MS)).toBe(true);
    // Une valeur qui change à chaque image (60 par seconde) : au plus dix écritures par seconde.
    let writes = 0;
    for (let i = 0; i < 180; i += 1) if (cadence.due(i + 2, 0, 2000 + (i * 1000) / 60)) writes += 1;
    expect(writes).toBeLessThanOrEqual(30);
    expect(writes).toBeGreaterThanOrEqual(28);
  });
});

describe('toile de l’instrument', () => {
  /** Contexte 2D factice : accepte tout appel et toute affectation (la toile n'existe pas sous Node). */
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, name: string) => (name in target ? target[name] : () => undefined),
    set: (target, name: string, value) => {
      target[name] = value;
      return true;
    },
  });
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
  });
  afterEach(() => vi.unstubAllGlobals());

  const disque: CabinPanel & { instrument: PanelInstrument } = { shape: 'disque', center: [0, 0, 0], normal: [-1, 0, 0], size: [0.1, 0.1], color: '#f4f1ea', instrument: { mesure: 'vitesse', max: 160 } };
  const ecran: CabinPanel & { instrument: PanelInstrument } = { shape: 'rectangle', center: [0, 0, 0], normal: [-1, 0, 0], size: [0.36, 0.08], haut: 0.24, color: '#ff9a1a', instrument: { mesure: 'vitesse', affichage: 'chiffres', barre: 'regime' } };

  it('est dessinée une fois à zéro, puis ne bouge plus tant que rien ne change (garage : rien n’est redessiné)', () => {
    const live = new LiveInstrument(disque);
    const version = live.texture.version;
    expect(live.kmh).toBe(0);
    // Sans pilote (garage), aucune mise à jour n'est demandée ; même demandée, la valeur reste zéro.
    expect(live.update(null, 1000)).toBe(true); // premier appel : la toile de départ est reposée une fois
    const after = live.texture.version;
    expect(after).toBeGreaterThan(version);
    for (let t = 1200; t < 5000; t += 16) expect(live.update(null, t)).toBe(false);
    expect(live.texture.version).toBe(after);
  });

  it('réécrit la toile seulement quand la vitesse affichée change, dix fois par seconde au plus', () => {
    const live = new LiveInstrument(disque);
    live.update(pilote(0), 1000);
    const base = live.texture.version;
    // 50 km/h tenus pendant une seconde, à 60 images par seconde : une seule réécriture.
    let now = 1100;
    expect(live.update(pilote(13.89), now)).toBe(true);
    for (let i = 0; i < 60; i += 1) {
      now += 16;
      expect(live.update(pilote(13.89), now)).toBe(false);
    }
    expect(live.texture.version - base).toBe(1);
    expect(live.kmh).toBe(50);
    // Accélération continue : au plus dix écritures par seconde.
    const before = live.texture.version;
    for (let i = 0; i < 60; i += 1) {
      now += 1000 / 60;
      live.update(pilote(14 + i * 0.06), now);
    }
    expect(live.texture.version - before).toBeLessThanOrEqual(11);
    expect(live.texture.version - before).toBeGreaterThanOrEqual(8);
    expect(live.kmh).toBeGreaterThan(50);
  });

  it('un afficheur de chiffres suit la vitesse (arrondie comme l’écran) et la barre de régime', () => {
    const live = new LiveInstrument(ecran);
    live.update(pilote(0, 900), 1000);
    expect(live.update(pilote(27.78, 900), 1200)).toBe(true);
    expect(live.kmh).toBe(kmhAffiche(27.78));
    const v = live.texture.version;
    // Même vitesse, régime dans la même cellule : rien n'est réécrit.
    expect(live.update(pilote(27.78, 910), 1400)).toBe(false);
    expect(live.texture.version).toBe(v);
    // Le régime change de cellule : réécrit, la vitesse affichée reste celle de l'écran.
    expect(live.update(pilote(27.78, 4000), 1600)).toBe(true);
    expect(live.kmh).toBe(100);
    expect(live.rpm).toBe(4000);
  });
});

describe('tableau de la sortie', () => {
  const ctx = new Proxy({} as Record<string, unknown>, { get: (target, name: string) => (name in target ? target[name] : () => undefined), set: (target, name: string, value) => ((target[name] = value), true) });
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
  });
  afterEach(() => vi.unstubAllGlobals());
  const panneaux: CabinPanel[] = [
    { shape: 'disque', center: [1, 1, 0], normal: [-1, 0, 0], size: [0.1, 0.1], color: '#ffffff', instrument: { mesure: 'vitesse', max: 160 } },
    { shape: 'disque', center: [1, 1, 0.1], normal: [-1, 0, 0], size: [0.1, 0.1], color: '#ffffff' }, // sans instrument : pas de toile
  ];

  it('n’a rien à monter sans panneau à instrument', () => {
    expect(new TableauVivant([panneaux[1]!]).empty).toBe(true);
    expect(new TableauVivant([]).empty).toBe(true);
    expect(new TableauVivant(panneaux).empty).toBe(false);
  });

  it('ne vit qu’à la caméra embarquée et publie la vitesse affichée, celle du compteur', () => {
    const tableau = new TableauVivant(panneaux);
    const host = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
    host.dataset.camera = 'poursuite';
    tableau.frame(host, pilote(13.89), 1000);
    expect(tableau.group.visible).toBe(false);
    expect(host.dataset.tableau).toBeUndefined();
    host.dataset.camera = 'embarquee';
    tableau.frame(host, pilote(13.89), 1100);
    expect(tableau.group.visible).toBe(true);
    expect(host.dataset.tableau).toBe(String(kmhAffiche(13.89)));
    tableau.frame(host, pilote(27.78), 1300);
    expect(host.dataset.tableau).toBe('100');
    // On quitte l'embarquée : la valeur disparaît et plus rien n'est redessiné.
    host.dataset.camera = 'libre';
    tableau.frame(host, pilote(27.78), 1500);
    expect(tableau.group.visible).toBe(false);
    expect(host.dataset.tableau).toBeUndefined();
    tableau.pose(0.02, 0.01);
    expect(tableau.group.position.y).toBe(0.02);
    tableau.dispose();
  });
});

describe('manifeste : instrument d’un panneau', () => {
  const panel = (extra: Record<string, unknown>) => ({ shape: 'disque', center: [1, 1, 0], normal: [-1, 0, 0], size: [0.1, 0.1], color: '#ffffff', ...extra });
  const avec = (panels: unknown[]) => {
    const raw = JSON.parse(readFileSync(new URL('cox/vehicle.json', VEHICLES), 'utf8')) as Record<string, unknown>;
    raw.cabin = { panels };
    return () => validateManifest(raw, 'cox');
  };

  it('accepte vitesse et régime, avec plage, balayage, sens et barre', () => {
    expect(avec([panel({ instrument: { mesure: 'vitesse' } })])).not.toThrow();
    expect(avec([panel({ instrument: { mesure: 'regime', max: 9000, balayage: [-120, 120], sens: 'antihoraire' } })])).not.toThrow();
    expect(avec([panel({ shape: 'rectangle', size: [0.3, 0.07], haut: 0.2, instrument: { mesure: 'vitesse', affichage: 'chiffres', barre: 'regime' } })])).not.toThrow();
  });

  it('refuse une mesure inconnue, une plage ou un balayage faux, une aiguille hors d’un disque', () => {
    expect(avec([panel({ instrument: { mesure: 'carburant' } })])).toThrow(/mesure/);
    expect(avec([panel({ instrument: { mesure: 'vitesse', max: 0 } })])).toThrow(/max/);
    expect(avec([panel({ instrument: { mesure: 'vitesse', max: -10 } })])).toThrow(/max/);
    expect(avec([panel({ instrument: { mesure: 'vitesse', balayage: [10, 10] } })])).toThrow(/balayage/);
    expect(avec([panel({ instrument: { mesure: 'vitesse', balayage: [0, 500] } })])).toThrow(/balayage/);
    expect(avec([panel({ instrument: { mesure: 'vitesse', sens: 'gauche' } })])).toThrow(/sens/);
    expect(avec([panel({ instrument: { mesure: 'vitesse', barre: 'vitesse' } })])).toThrow(/barre/);
    expect(avec([panel({ instrument: 'vitesse' })])).toThrow(/instrument/);
    expect(avec([panel({ shape: 'rectangle', size: [0.3, 0.07], instrument: { mesure: 'vitesse', affichage: 'aiguille' } })])).toThrow(/disque/);
    expect(avec([panel({ haut: 0.1 })])).toThrow(/haut/);
  });

  it('les manifestes du dépôt déclarent leurs instruments, valides, sans identifiant de véhicule dans le code', () => {
    const found: Record<string, number> = {};
    for (const entry of readdirSync(VEHICLES, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const raw = JSON.parse(readFileSync(new URL(`${entry.name}/vehicle.json`, VEHICLES), 'utf8')) as { cabin?: { panels?: { instrument?: unknown }[] } };
      expect(() => validateManifest(raw, entry.name)).not.toThrow();
      found[entry.name] = (raw.cabin?.panels ?? []).filter((p) => p.instrument !== undefined).length;
    }
    // Le concept (écran numérique), le van (deux cadrans et un écran) et la Cox (son gros compteur) vivent.
    expect(found.concept).toBeGreaterThanOrEqual(1);
    expect(found.van).toBeGreaterThanOrEqual(2);
    expect(found.cox).toBeGreaterThanOrEqual(1);
    const source = readFileSync(new URL('../../src/scene/vehicle/tableau.ts', import.meta.url), 'utf8');
    for (const id of Object.keys(found)) expect(source).not.toMatch(new RegExp(`['"\`]${id}['"\`]`));
  });
});
