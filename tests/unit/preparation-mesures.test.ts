// Mesures de la préparation (vague U), hors du navigateur : temps d'une course simulée (conduite à la
// main appliquée, src/drive/simulationCourse.ts) selon le pneu, l'assiette et la puissance, sous chaque
// météo. Le bon choix doit faire gagner, le mauvais perdre, le véhicule d'origine ne pas bouger.
//
// Tableau complet (deux voitures et une moto, une carte sinueuse et une carte rapide, chaque pneu sous
// chaque météo, trois assiettes) : PMB_MESURES_PREPARATION=<fichier> npx vitest run preparation-mesures.

import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { METEOS } from '../../src/data/adherence.ts';
import { WHEEL_CATALOGUE } from '../../src/data/wheels.ts';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { createRail } from '../../src/drive/rail.ts';
import { buildDe, routeDe, tempsCourse, vehicule } from './preparation-outils.ts';
import { chiffres, rejouer } from './tremblote-outils.ts';

/** 150 m droits, puis trois quarts de cercle de 60 m de rayon (chaussée de 10 m). */
function virageEssai(): MapRoute {
  const rail: number[] = [];
  for (let x = 0; x < 150; x += 2) rail.push(x, 0, 0);
  for (let a = 0; a <= Math.PI * 1.5; a += 2 / 60) rail.push(150 + 60 * Math.sin(a), 0, 60 - 60 * Math.cos(a));
  const total = (rail.length / 3 - 1) * 2;
  return { format: 'pmb-carte', version: 1, id: 'essai', loop: false, length: total, step: 2, rail, sections: [{ from: 0, to: total, ground: 'sol', urban: false, lanes: 2, width: 10 }], chunks: [], starts: [], far: null };
}

/** Carte sinueuse (le circuit en ville, un tour) et carte rapide (la grande avenue). */
const CARTES = [
  { map: 'monaco-circuit', start: 'ligne-droite', nom: 'sinueuse' },
  { map: 'miami-beach', start: 'collins', nom: 'rapide' },
] as const;
const VEHICULES = ['cox', 'van', 'sportive'] as const;
const ASSIETTES = [
  { id: 'haute', value: -1 },
  { id: 'origine', value: 0 },
  { id: 'basse', value: 1 },
] as const;

const fichier = process.env.PMB_MESURES_PREPARATION;
const pret = CARTES.every((carte) => routeDe(carte.map) !== null);

describe.skipIf(!fichier || !pret)('tableau des temps (PMB_MESURES_PREPARATION)', () => {
  it('pneus × météo, assiettes × météo, puissance', { timeout: 1_800_000 }, () => {
    const lignes: string[] = [];
    const t0 = Date.now();
    for (const carte of CARTES) {
      for (const id of VEHICULES) {
        const origine: Record<string, number> = {};
        for (const meteo of METEOS) origine[meteo] = tempsCourse(id, undefined, carte.map, carte.start, meteo);
        for (const tire of WHEEL_CATALOGUE.tires) {
          const cells = METEOS.map((meteo) => {
            const t = tempsCourse(id, buildDe({ pneu: tire.id }), carte.map, carte.start, meteo);
            return `${t.toFixed(1)} s (${(((t - origine[meteo]!) / origine[meteo]!) * 100).toFixed(1)} %)`;
          });
          lignes.push(`| ${carte.nom} | ${id} | pneu ${tire.id} | ${cells.join(' | ')} |`);
        }
        for (const assiette of ASSIETTES) {
          const cells = METEOS.map((meteo) => {
            const t = tempsCourse(id, buildDe({ assiette: assiette.value }), carte.map, carte.start, meteo);
            return `${t.toFixed(1)} s (${(((t - origine[meteo]!) / origine[meteo]!) * 100).toFixed(1)} %)`;
          });
          lignes.push(`| ${carte.nom} | ${id} | assiette ${assiette.id} | ${cells.join(' | ')} |`);
        }
      }
    }
    // Puissance : la préparation moteur la plus forte face à l'origine, sous chaque météo.
    const puissances: ReadonlyArray<{ id: string; moteur: Record<string, string> }> = [
      { id: 'van', moteur: { reprog: 'stage3' } },
      { id: 'cox', moteur: { carbu: 'double-carbu' } },
      { id: 'concept', moteur: { reprog: 'stage3' } },
      { id: 'sportive', moteur: { reprog: 'stage3' } },
    ];
    for (const carte of CARTES) {
      for (const p of puissances) {
        const cells = METEOS.map((meteo) => {
          const o = tempsCourse(p.id, undefined, carte.map, carte.start, meteo);
          const t = tempsCourse(p.id, buildDe({ moteur: p.moteur }), carte.map, carte.start, meteo);
          return `${o.toFixed(1)} → ${t.toFixed(1)} s (${(((t - o) / o) * 100).toFixed(1)} %)`;
        });
        lignes.push(`| ${carte.nom} | ${p.id} | moteur ${Object.values(p.moteur).join(',')} | ${cells.join(' | ')} |`);
      }
    }
    // Stabilité (mesure de la vague R) : saut d'image à image, tendance retirée, origine → préparé.
    const stabilite: string[] = ['', '| stabilité (courbe de 60 m, cadence irrégulière) | cap (°) | roulis (°) | écran X (px) | écran Y (px) |', '|---|---|---|---|---|'];
    const courbe = createRail(virageEssai());
    for (const [id, joueur, meteo, prep] of [
      ['cox', 'auto', 'sec', { assiette: -1 }],
      ['cox', 'main', 'pluie', { pneu: 'piste', assiette: 1 }],
      ['van', 'main', 'neige', { pneu: 'tout_terrain', assiette: -1 }],
      ['sportive', 'main', 'neige', { pneu: 'piste', assiette: 1 }],
    ] as const) {
      const sc = { rail: courbe, vehicle: vehicule(id), camera: 'poursuite' as const, cadence: 'irreguliere' as const, joueur, from: 120, seconds: 12, relief: null, meteo };
      const a = chiffres(rejouer(sc));
      const b = chiffres(rejouer({ ...sc, build: buildDe(prep) }));
      stabilite.push(`| ${id} ${joueur} ${meteo} ${JSON.stringify(prep)} | ${a.cap} → ${b.cap} | ${a.roulis} → ${b.roulis} | ${a.ecranX} → ${b.ecranX} | ${a.ecranY} → ${b.ecranY} |`);
    }
    const texte = [`| carte | véhicule | choix | sec | pluie | neige |`, `|---|---|---|---|---|---|`, ...lignes, ...stabilite, '', `(${((Date.now() - t0) / 1000).toFixed(0)} s de calcul)`].join('\n');
    writeFileSync(fichier!, `${texte}\n`);
    expect(lignes.length).toBeGreaterThan(0);
  });
});
