// Préparer son véhicule pour la météo (vague U) : le comportement des pneus dans le catalogue des roues,
// l'assiette, la largeur, ce que la conduite en lit (src/data/preparation.ts, src/data/adherence.ts,
// src/drive/pilote.ts), les lignes de l'atelier, les articles et le conseil d'avant course
// (src/jeu/preparation.ts). Le véhicule d'origine n'y change rien.

import { describe, expect, it } from 'vitest';
import { ADHERENCE_METEO, facteursPreparation, METEOS, MOTRICITE, PREPARATION, PREPARATION_ORIGINE } from '../../src/data/adherence.ts';
import { articleParId, PIECES } from '../../src/data/boutique.ts';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { ARTICLE_REHAUSSE, articleAssiette, articlePneu, ligneAssiette, lignePneu, meilleurPneu, notesAssiette, notesPneu, preparationDe } from '../../src/data/preparation.ts';
import type { Build } from '../../src/data/vehicleTypes.ts';
import { VEHICLES } from '../../src/data/vehicles.ts';
import { resolveWheels, RIDE_PRESETS, RIDE_RISE, validateCatalogue, WHEEL_CATALOGUE, WHEEL_TUNE } from '../../src/data/wheels.ts';
import type { DriveInput, Weather } from '../../src/drive/contrat.ts';
import { createPilot, motriciteDe, performanceDe } from '../../src/drive/pilote.ts';
import { createRail } from '../../src/drive/rail.ts';
import { conseilPreparation } from '../../src/jeu/preparation.ts';
import { buildDe, routeDe, tempsCourse, vehicule } from './preparation-outils.ts';
import { chiffres, rejouer } from './tremblote-outils.ts';

const NNBSP = ' ';

describe('pneus : comportement en données', () => {
  it('chaque pneu porte sa tenue par météo et sa motricité ; le catalogue refuse un pneu sans elles', () => {
    for (const tire of WHEEL_CATALOGUE.tires) {
      for (const meteo of METEOS) expect(tire.tenue[meteo], `${tire.id} ${meteo}`).toBeGreaterThanOrEqual(0.5);
      expect(tire.motricite).toBeGreaterThan(0.8);
      expect(tire.nom, tire.id).toBeTruthy();
    }
    const raw = JSON.parse(JSON.stringify(WHEEL_CATALOGUE)) as { tires: Array<Record<string, unknown>> };
    delete raw.tires[0]!.tenue;
    expect(() => validateCatalogue(raw)).toThrow(/tenue/);
  });

  it('écarts francs mais jouables : face au pneu d’origine de chaque véhicule, 15 % au plus, et au moins 5 % pour le meilleur choix', () => {
    for (const vehicle of VEHICLES) {
      const fit = vehicle.wheels?.fit;
      if (!fit) continue;
      const origine = WHEEL_CATALOGUE.tires.find((tire) => tire.id === fit.tire)!;
      for (const meteo of METEOS) {
        const ratios = WHEEL_CATALOGUE.tires.map((tire) => tire.tenue[meteo] / origine.tenue[meteo]);
        for (const r of ratios) {
          expect(r, `${vehicle.id} ${meteo}`).toBeLessThanOrEqual(1 + PREPARATION.ecartPneu + 1e-9);
          expect(r, `${vehicle.id} ${meteo}`).toBeGreaterThanOrEqual(1 - PREPARATION.ecartPneu - 1e-9);
        }
        expect(Math.max(...ratios), `${vehicle.id} ${meteo}`).toBeGreaterThanOrEqual(1.05);
      }
    }
  });

  it('le slick est le meilleur au sec et le pire sous la pluie ; le tout-terrain tient la pluie et la neige, pas le sec', () => {
    expect(meilleurPneu('sec')?.id).toBe('piste');
    expect(meilleurPneu('pluie')?.id).toBe('tout_terrain');
    expect(meilleurPneu('neige')?.id).toBe('tout_terrain');
    const pire = (meteo: Weather) => [...WHEEL_CATALOGUE.tires].sort((a, b) => a.tenue[meteo] - b.tenue[meteo])[0]!.id;
    expect(pire('sec')).toBe('tout_terrain');
    expect(pire('pluie')).toBe('piste');
    expect(pire('neige')).toBe('piste');
  });
});

describe('préparation : ce que la route en lit', () => {
  it('le véhicule d’origine ne change rien, quel que soit le véhicule', () => {
    for (const vehicle of VEHICLES) {
      const prep = preparationDe(vehicle, undefined);
      expect(prep, vehicle.id).toEqual(PREPARATION_ORIGINE);
      expect(performanceDe(vehicle).preparation, vehicle.id).toEqual(PREPARATION_ORIGINE);
    }
  });

  it('pneu, largeur et assiette se composent ; la largeur compte un peu (3 % au plus)', () => {
    const cox = vehicule('cox');
    const slick = preparationDe(cox, buildDe({ pneu: 'piste' }));
    expect(slick.tenue.sec).toBeCloseTo(1 / 0.92, 6);
    expect(slick.tenue.pluie).toBeCloseTo(0.77 / 0.88, 6);
    expect(slick.motricite.sec).toBeCloseTo((1 / 0.92) * 1.06, 6);
    const large = preparationDe(cox, buildDe({ largeur: cox.wheels!.fit!.width![1] }));
    const etroit = preparationDe(cox, buildDe({ largeur: cox.wheels!.fit!.width![0] }));
    expect(large.tenue.sec).toBeGreaterThan(1);
    expect(large.tenue.sec).toBeLessThanOrEqual(1 + PREPARATION.largeur.max + 1e-9);
    expect(large.tenue.pluie).toBeLessThan(1);
    expect(etroit.tenue.neige).toBeGreaterThan(1);
    expect(etroit.tenue.sec).toBeGreaterThanOrEqual(1 - PREPARATION.largeur.max - 1e-9);
    const bas = preparationDe(cox, buildDe({ assiette: 1 }));
    const haut = preparationDe(cox, buildDe({ assiette: -1 }));
    expect(bas.tenue.sec).toBeCloseTo(1 + PREPARATION.assiette.basse.tenue.sec, 6);
    expect(bas.tenue.neige).toBeCloseTo(1 + PREPARATION.assiette.basse.tenue.neige, 6);
    expect(bas.roulis).toBeCloseTo(PREPARATION.assiette.basse.roulis, 6);
    expect(haut.tenue.neige).toBeGreaterThan(1);
    expect(haut.tenue.sec).toBeLessThan(1);
    expect(haut.roulis).toBeGreaterThan(1);
    const tout = facteursPreparation(WHEEL_CATALOGUE.tires[4]!, WHEEL_CATALOGUE.tires[0]!, 0, 1);
    expect(tout.tenue.sec).toBeCloseTo((1 / 0.92) * 1.06, 6);
  });

  it('un véhicule qui garde ses roues ne règle que son assiette', () => {
    const concept = vehicule('concept');
    expect(concept.wheels?.fit).toBeUndefined();
    expect(preparationDe(concept, buildDe({ pneu: 'piste' }))).toEqual(PREPARATION_ORIGINE);
    expect(preparationDe(concept, buildDe({ assiette: 1 })).tenue.sec).toBeGreaterThan(1);
  });

  it('assiette rehaussée : la caisse monte (de RIDE_RISE au plus), les roues ne bougent pas', () => {
    for (const vehicle of VEHICLES) {
      if (!vehicle.wheels) continue;
      const haut = resolveWheels(vehicle, { tune: { [WHEEL_TUNE.ride]: -1 } })!;
      const origine = resolveWheels(vehicle, undefined)!;
      const rise = RIDE_RISE[vehicle.kind === 'bike' ? 'bike' : 'car'];
      expect(haut.ride).toBe(-1);
      expect(haut.drop).toBeCloseTo(-rise, 6);
      expect(haut.lift.front - origine.lift.front).toBeCloseTo(rise, 6);
      expect(haut.front?.outer).toBe(origine.front?.outer);
      expect(resolveWheels(vehicle, { tune: { [WHEEL_TUNE.ride]: -7 } })!.ride).toBe(-1);
    }
  });

  it('le pilote lit la préparation : adhérence et motricité selon la météo, roulis selon l’assiette', () => {
    const cox = vehicule('cox');
    const origine = performanceDe(cox);
    const slick = performanceDe(cox, buildDe({ pneu: 'piste' }));
    expect(motriciteDe(slick, 'pluie')).toBeLessThan(motriciteDe(origine, 'pluie'));
    expect(motriciteDe(slick, 'sec')).toBeGreaterThan(motriciteDe(origine, 'sec'));
    const route = droite(400);
    const p0 = createPilot(createRail(route), origine);
    const p1 = createPilot(createRail(route), slick);
    for (const meteo of METEOS) {
      p0.setWeather(meteo);
      p1.setWeather(meteo);
      expect(p0.adherence, meteo).toBeCloseTo(ADHERENCE_METEO[meteo].adherence, 9);
    }
    p1.setWeather('sec');
    expect(p1.adherence).toBeCloseTo(1 / 0.92, 6);
    p1.setWeather('pluie');
    expect(p1.adherence).toBeCloseTo(0.7 * (0.77 / 0.88), 6);
    // Roulis : posée au sol, elle vire plus à plat ; rehaussée, elle roule plus.
    const roulis = (build: Build | undefined) => {
      const pilot = createPilot(createRail(virage()), performanceDe(cox, build));
      pilot.setWeather('sec');
      let max = 0;
      for (let i = 0; i < 60 * 20; i += 1) max = Math.max(max, Math.abs(pilot.step(1 / 60, AUTO, 'car').roll));
      return max;
    };
    const r0 = roulis(undefined);
    expect(roulis(buildDe({ assiette: 1 }))).toBeLessThan(r0 * 0.75);
    expect(roulis(buildDe({ assiette: -1 }))).toBeGreaterThan(r0 * 1.2);
  });

  it('le pilote automatique lève le pied sur de mauvais pneus, jamais plus vite sur de bons', () => {
    const van = vehicule('van');
    const rail = createRail(virage());
    const profil = (build?: Build) => {
      const pilot = createPilot(rail, performanceDe(van, build));
      pilot.setWeather('pluie');
      return pilot.profile.auto.reduce((a, b) => a + b, 0);
    };
    expect(profil(buildDe({ pneu: 'piste' }))).toBeLessThan(profil());
    expect(profil(buildDe({ pneu: 'tout_terrain' }))).toBeCloseTo(profil(), 9);
  });
});

describe('puissance : sur la neige, des chevaux en plus patinent et coûtent', () => {
  it('la poussée perdue croît avec l’excès sur la motricité, sans s’arrêter au patinage plein', () => {
    expect(MOTRICITE.perteMax).toBeGreaterThan(MOTRICITE.perte);
    const van = vehicule('van');
    const temps50 = (build: Build | undefined, meteo: Weather) => {
      const pilot = createPilot(createRail(droite(3000)), performanceDe(van, build));
      pilot.setWeather(meteo);
      let t = 0;
      for (; t < 60 && pilot.motion.speed < 50 / 3.6; t += 1 / 60) pilot.step(1 / 60, PLEIN_GAZ, 'car');
      return t;
    };
    const stage3 = buildDe({ moteur: { reprog: 'stage3' } });
    // Au sec, la préparation moteur fait gagner ; sur la neige, plein gaz, elle fait perdre.
    expect(temps50(stage3, 'sec')).toBeLessThan(temps50(undefined, 'sec'));
    expect(temps50(stage3, 'neige')).toBeGreaterThan(temps50(undefined, 'neige') * 1.05);
  });
});

describe('atelier : lignes de terrain et articles', () => {
  it('une ligne par pneu et par assiette, tirée des mêmes données', () => {
    expect(lignePneu('piste')).toBe(`Sec${NNBSP}: +${NNBSP}+, pluie${NNBSP}: −${NNBSP}−, neige${NNBSP}: −${NNBSP}−`);
    expect(lignePneu('tout_terrain')).toBe(`Sec${NNBSP}: −${NNBSP}−, pluie${NNBSP}: +${NNBSP}+, neige${NNBSP}: +${NNBSP}+`);
    expect(notesPneu('route')).toEqual({ sec: '+', pluie: '+', neige: '-' });
    expect(lignePneu('inconnu')).toBe('');
    expect(notesAssiette('au_sol')).toEqual({ sec: '++', pluie: '=', neige: '--' });
    expect(notesAssiette('rehaussee')).toEqual({ sec: '-', pluie: '=', neige: '++' });
    expect(notesAssiette('origine')).toEqual({ sec: '+', pluie: '=', neige: '+' });
    for (const preset of RIDE_PRESETS) expect(ligneAssiette(preset.id), preset.id).toMatch(new RegExp(`^Sec${NNBSP}: .+, pluie${NNBSP}: .+, neige${NNBSP}: .+$`));
  });

  it('les nouveautés se débloquent (60 à 400 $), ce qui était libre le reste', () => {
    const slick = articleParId(articlePneu('piste'));
    const rehausse = articleParId(ARTICLE_REHAUSSE);
    for (const article of [slick, rehausse]) {
      expect(article?.famille).toBe('piece');
      expect(article?.prix).toBeGreaterThanOrEqual(60);
      expect(article?.prix).toBeLessThanOrEqual(400);
      expect(PIECES).toContain(article);
    }
    for (const id of ['route', 'flanc_blanc', 'lettrage', 'tout_terrain']) expect(articleParId(articlePneu(id)), id).toBeUndefined();
    for (const id of ['origine', 'rabaissee', 'au_sol']) expect(articleParId(articleAssiette(id)), id).toBeUndefined();
  });
});

describe('conseilPreparation(build, vehicule, meteo)', () => {

  it('deux ou trois phrases tutoyées, sans marque, pour chaque véhicule et chaque météo', () => {
    for (const vehicle of VEHICLES) {
      for (const meteo of METEOS) {
        for (const build of [undefined, buildDe({ pneu: 'piste', assiette: 1, moteur: { reprog: 'stage3' } })]) {
          const phrases = conseilPreparation(build, vehicle, meteo);
          expect(phrases.length, `${vehicle.id} ${meteo}`).toBeGreaterThanOrEqual(1);
          expect(phrases.length).toBeLessThanOrEqual(3);
          for (const phrase of phrases) {
            expect(phrase).toMatch(/^[A-ZÀ-Ý].*[.!]$/);
            expect(phrase).not.toMatch(/\bvous\b|\bvotre\b/i);
          }
        }
      }
    }
  });

  it('dit quoi changer : pneus de route sous la pluie, slicks sur la neige, caisse posée au sol sur la neige', () => {
    const cox = vehicule('cox');
    const pluie = conseilPreparation(undefined, cox, 'pluie');
    expect(pluie[0]).toBe('Tes pneus de route vont glisser sous la pluie : passe aux pneus tout-terrain, ils tiennent 8 % de mieux.');
    const neige = conseilPreparation(buildDe({ pneu: 'piste', assiette: 1 }), cox, 'neige');
    expect(neige[0]).toMatch(/^Tes slicks vont patiner sur la neige : passe aux pneus tout-terrain/);
    expect(neige[1]).toMatch(/racler la neige/);
    const sec = conseilPreparation(buildDe({ pneu: 'tout_terrain' }), cox, 'sec');
    expect(sec[0]).toMatch(/^Tes pneus tout-terrain vont manquer d’accroche au sec : passe aux slicks/);
    expect(sec[1]).toMatch(/^Au sec, une assiette posée au sol vire plus à plat/);
    // Le slick pas encore acheté : le meilleur pneu libre, puis l'idéal « à débloquer ».
    const rien = (id: string) => !id.startsWith('piece-');
    expect(conseilPreparation(buildDe({ pneu: 'route' }), cox, 'sec', { possede: rien })[0]).toMatch(/à débloquer dans Roues/);
    expect(conseilPreparation(buildDe({ pneu: 'tout_terrain' }), cox, 'neige')[0]).toBe('Tes pneus tout-terrain sont un bon choix sur la neige.');
  });

  it('dit d’adapter la puissance sur la neige : la préparation moteur du van, les chevaux du concept', () => {
    const van = conseilPreparation(buildDe({ pneu: 'tout_terrain', moteur: { reprog: 'stage3' } }), vehicule('van'), 'neige');
    expect(van.some((p) => /préparation moteur vont faire patiner les roues : reviens à l’origine/.test(p))).toBe(true);
    expect(conseilPreparation(buildDe({ pneu: 'tout_terrain' }), vehicule('van'), 'neige').some((p) => /patiner les roues|dose/.test(p))).toBe(false);
    expect(conseilPreparation(undefined, vehicule('concept'), 'neige').some((p) => /dose l’accélérateur/.test(p))).toBe(true);
    expect(conseilPreparation(undefined, vehicule('concept'), 'sec').some((p) => /dose/.test(p))).toBe(false);
  });
});

// Course simulée (conduite à la main appliquée) : la grande avenue (départ Collins), la Cox.
const CARTE = { map: 'miami-beach', start: 'collins' } as const;
describe.skipIf(routeDe(CARTE.map) === null)('au chrono : le bon choix fait gagner, le mauvais perdre', () => {
  it('pneus et assiette selon la météo (Cox, Miami, départ Collins)', { timeout: 120_000 }, () => {
    const t = (meteo: Weather, build?: Build) => tempsCourse('cox', build, CARTE.map, CARTE.start, meteo);
    const origine = { sec: t('sec'), pluie: t('pluie'), neige: t('neige') };
    expect(t('sec', buildDe({ pneu: 'piste' }))).toBeLessThan(origine.sec * 0.995);
    expect(t('pluie', buildDe({ pneu: 'piste' }))).toBeGreaterThan(origine.pluie * 1.01);
    expect(t('neige', buildDe({ pneu: 'tout_terrain' }))).toBeLessThan(origine.neige * 0.99);
    expect(t('sec', buildDe({ pneu: 'tout_terrain' }))).toBeGreaterThan(origine.sec * 1.005);
    expect(t('neige', buildDe({ assiette: 1 }))).toBeGreaterThan(origine.neige * 1.01);
    expect(t('neige', buildDe({ assiette: -1 }))).toBeLessThan(origine.neige);
    // Le pire de tout reste conduisible : il finit la course.
    expect(Number.isFinite(t('neige', buildDe({ pneu: 'piste', assiette: 1, largeur: 225 })))).toBe(true);
  });
});

// La tremblote corrigée en vague R ne revient pas : pose rejouée image par image (cadence irrégulière,
// tests/unit/tremblote-outils.ts) avec les préparations les plus fortes, à la main et en pilote automatique.
describe('stabilité : la pose ne tremble pas plus avec une préparation extrême', () => {
  const courbe = createRail(virage());
  it.each([
    ['cox', 'auto', 'sec', { assiette: -1 }],
    ['cox', 'main', 'pluie', { pneu: 'piste', assiette: 1 }],
    ['van', 'main', 'neige', { pneu: 'tout_terrain', assiette: -1 }],
    ['sportive', 'main', 'neige', { pneu: 'piste', assiette: 1 }],
  ] as const)('%s, %s, %s', (id, joueur, meteo, prep) => {
    const vehicle = vehicule(id);
    const sc = { rail: courbe, vehicle, camera: 'poursuite' as const, cadence: 'irreguliere' as const, joueur, from: 120, seconds: 12, relief: null, meteo };
    const avant = chiffres(rejouer(sc));
    const apres = chiffres(rejouer({ ...sc, build: buildDe(prep) }));
    // Saut d'image à image, tendance retirée (degrés ; pixels à l'écran) : les bornes de la vague R.
    expect(apres.cap, 'cap').toBeLessThan(Math.max(0.3, (avant.cap ?? 0) * 1.5));
    expect(apres.roulis, 'roulis').toBeLessThan(Math.max(0.3, (avant.roulis ?? 0) * 1.5));
    expect(apres.ecranX, 'écran X').toBeLessThan(Math.max(1, (avant.ecranX ?? 0) * 1.5));
    expect(apres.ecranY, 'écran Y').toBeLessThan(Math.max(1, (avant.ecranY ?? 0) * 1.5));
  });
});

// ---------------------------------------------------------------------------------------------

const AUTO: DriveInput = { auto: true, throttle: 0, brake: 0, lane: 0 };
const PLEIN_GAZ: DriveInput = { auto: false, throttle: 1, brake: 0, lane: 0, assist: true };

function route(rail: number[], step: number, width: number): MapRoute {
  const total = (rail.length / 3 - 1) * step;
  return {
    format: 'pmb-carte',
    version: 1,
    id: 'essai',
    loop: false,
    length: total,
    step,
    rail,
    sections: [{ from: 0, to: total, ground: 'sol', urban: false, lanes: 2, width }],
    chunks: [],
    starts: [],
    far: null,
  };
}

/** Une ligne droite de `length` m, chaussée large. */
function droite(length: number): MapRoute {
  const rail: number[] = [];
  for (let x = 0; x <= length; x += 2) rail.push(x, 0, 0);
  return route(rail, 2, 12);
}

/** 150 m droits, puis un long virage de 60 m de rayon. */
function virage(): MapRoute {
  const rail: number[] = [];
  for (let x = 0; x < 150; x += 2) rail.push(x, 0, 0);
  for (let a = 0; a <= Math.PI * 1.5; a += 2 / 60) rail.push(150 + 60 * Math.sin(a), 0, 60 - 60 * Math.cos(a));
  return route(rail, 2, 10);
}
