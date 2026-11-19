// Formats et médailles des courses (src/data/courses.ts) ; temps de référence versionnés
// (public/assets/maps/<id>/courses.json, `npm run courses:temps`) : chaque départ de chaque carte en a,
// les seuils se suivent, et la simulation (src/drive/simulationCourse.ts) les redonne encore (sinon :
// relancer l'outil après un changement de physique).

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatCouru, formatPossible, FORMATS, indulgence, INDULGENCE_METEO, lireFichierCourses, medailleDe, REFERENCES, seuilsMedailles, tempsReference, toursDuFormat } from '../../src/data/courses.ts';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { MAPS, validateRoute } from '../../src/data/maps.ts';
import { vehicleById } from '../../src/data/vehicles.ts';
import { performanceDe } from '../../src/drive/pilote.ts';
import { piloteDeSimulation, simulerCourse } from '../../src/drive/simulationCourse.ts';

describe('formats', () => {
  it('balade, 1 tour, 3 tours, drift ; 3 tours sur une boucle seulement, 1 tour à la place ailleurs', () => {
    expect(FORMATS.map((f) => f.id)).toEqual(['balade', 'tour1', 'tours3', 'drift']);
    expect(formatCouru('drift', false)).toBe('drift');
    expect(toursDuFormat('drift')).toBe(1);
    expect(formatPossible('tours3', false)).toBe(false);
    expect(formatPossible('tours3', true)).toBe(true);
    expect(formatCouru('tours3', false)).toBe('tour1');
    expect(formatCouru('tours3', true)).toBe('tours3');
    expect(formatCouru('balade', false)).toBe('balade');
    expect([toursDuFormat('balade'), toursDuFormat('tour1'), toursDuFormat('tours3')]).toEqual([0, 1, 3]);
  });
});

describe('médailles', () => {
  it('or sous argent sous bronze ; la météo allonge ; au-delà du bronze, rien', () => {
    const seuils = seuilsMedailles({ auto: 100, main: 60 });
    expect(seuils.or).toBeCloseTo(64.8, 6);
    expect(seuils.argent).toBeCloseTo(75, 6);
    expect(seuils.bronze).toBeCloseTo(100, 6);
    expect(medailleDe(64, seuils)).toBe('or');
    expect(medailleDe(70, seuils)).toBe('argent');
    expect(medailleDe(99.9, seuils)).toBe('bronze');
    expect(medailleDe(100.1, seuils)).toBeNull();
    expect(medailleDe(Number.NaN, seuils)).toBeNull();
    expect(medailleDe(50, null)).toBeNull();
    const pluie = seuilsMedailles({ auto: 100, main: 60 }, 1.2);
    expect(pluie.or).toBeCloseTo(64.8 * 1.2, 6);
    // Un pilote automatique presque aussi rapide que la main : le bronze reste au-dessus de l'argent.
    const serre = seuilsMedailles({ auto: 70, main: 66 });
    expect(serre.bronze).toBeGreaterThanOrEqual(serre.argent * 1.05 - 1e-9);
  });

  it('courses.json lu de façon tolérante', () => {
    expect(lireFichierCourses(null)).toBeNull();
    expect(lireFichierCourses({ format: 'autre', version: 1 })).toBeNull();
    const f = lireFichierCourses({ format: 'pmb-courses', version: 1, departs: { a: { tour1: { auto: 10, main: 5, vehicules: { v: { auto: 9, main: 4 }, w: { auto: -1 } } }, tours3: { auto: 'x' } } }, ecartsMeteo: { pluie: 1.2, neige: 9 } });
    expect(f?.departs.a?.tour1).toEqual({ auto: 10, main: 5, vehicules: { v: { auto: 9, main: 4 } } });
    expect(f?.departs.a?.tours3).toBeUndefined();
    expect(f?.ecartsMeteo).toEqual({ pluie: 1.2 });
    const refs = { c: f! };
    expect(tempsReference('c', 'a', 'tour1', 'v', refs)).toEqual({ auto: 9, main: 4 });
    expect(tempsReference('c', 'a', 'tour1', 'inconnu', refs)).toEqual({ auto: 10, main: 5 });
    expect(tempsReference('c', 'a', 'balade', 'v', refs)).toBeNull();
    expect(indulgence('c', 'pluie', refs)).toBe(1.2);
    expect(indulgence('c', 'neige', refs)).toBe(INDULGENCE_METEO.neige);
    expect(indulgence('c', 'sec', refs)).toBe(1);
  });
});

describe('temps de référence versionnés', () => {
  const built = MAPS.filter((map) => existsSync(`public/assets/maps/${map.id}/${map.route}`));
  const route = (id: string): MapRoute => {
    const map = MAPS.find((m) => m.id === id)!;
    return validateRoute(JSON.parse(readFileSync(`public/assets/maps/${id}/${map.route}`, 'utf8')), map);
  };

  it.skipIf(built.length === 0)('chaque départ de chaque carte a ses temps (3 tours sur les boucles seulement) ; la main bat le pilote automatique', () => {
    for (const map of built) {
      const r = route(map.id);
      for (const start of r.starts) {
        const t = REFERENCES[map.id]?.departs[start.id];
        expect(t?.tour1, `${map.id}/${start.id}`).toBeDefined();
        expect(Boolean(t?.tours3), `${map.id}/${start.id} : 3 tours`).toBe(r.loop);
        for (const ref of [t!.tour1!, ...(t!.tours3 ? [t!.tours3] : [])]) {
          expect(ref.main).toBeLessThan(ref.auto);
          for (const v of Object.values(ref.vehicules)) expect(v.main, map.id).toBeLessThan(v.auto);
        }
      }
    }
  });

  // Un départ court par carte (le dernier de la route), deux véhicules : la simulation d'aujourd'hui redonne
  // les temps versionnés à 0,5 % près. Sinon, la physique a changé : `npm run courses:temps`.
  it.skipIf(built.length === 0)('courses.json est à jour avec la simulation', { timeout: 120_000 }, () => {
    for (const map of built) {
      const r = route(map.id);
      const start = [...r.starts].sort((a, b) => b.at - a.at)[0]!;
      for (const id of ['concept', 'cox']) {
        const vehicle = vehicleById(id);
        const ref = REFERENCES[map.id]?.departs[start.id]?.tour1?.vehicules[id];
        if (!vehicle || !ref) continue;
        const pilot = piloteDeSimulation(r, performanceDe(vehicle));
        const auto = simulerCourse(pilot, { at: start.at, tours: 1, meteo: 'sec', conduite: 'auto' });
        const main = simulerCourse(pilot, { at: start.at, tours: 1, meteo: 'sec', conduite: 'main' });
        expect(auto.temps / ref.auto, `${map.id}/${start.id}/${id} auto`).toBeCloseTo(1, 2);
        expect(main.temps / ref.main, `${map.id}/${start.id}/${id} main`).toBeCloseTo(1, 2);
      }
    }
  });
});
