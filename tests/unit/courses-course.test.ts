// Course de la sortie (vague S, 18 novembre 2026) : machine de course (src/drive/depart.ts : tours,
// arrivée au dernier tour, temps des tours), mesures de StatsCourse (src/drive/course.ts), résultat
// d'arrivée, records et bilan (src/state/drive.ts, terminerCourse).

import { beforeEach, describe, expect, it } from 'vitest';
import { cleRecord, formatCouru, toursDuFormat } from '../../src/data/courses.ts';
import { courseFinie, createMesures, MESURES, pasMesures, SuiviCourse } from '../../src/drive/course.ts';
import { armerDepart, createDepart, enCourse, pasDepart, texteTour } from '../../src/drive/depart.ts';
import { useDrive } from '../../src/state/drive.ts';

const BOUCLE = { length: 1000, loop: true };
const OUVERT = { length: 1000, loop: false };

/** Départ arrêté passé au vert à l'instant 0 (pas de feux à dérouler). */
function auVert(tours: number, parcours = BOUCLE, s = 0) {
  const etat = armerDepart(createDepart(), s, parcours.loop, false, tours);
  etat.phase = 'parti';
  etat.vert = true;
  etat.depuisVert = Infinity;
  return etat;
}

/** Roule à `v` m/s par pas de `dt` pendant `t` s ; rend l'abscisse finale. */
function rouler(etat: ReturnType<typeof createDepart>, t: number, v: number, dt = 0.1, parcours = BOUCLE, s0 = 0): number {
  let s = s0;
  for (let temps = 0; temps < t - 1e-9; temps += dt) {
    s += v * dt;
    const ici = parcours.loop ? s % parcours.length : Math.min(s, parcours.length);
    pasDepart(etat, dt, true, ici, parcours, !parcours.loop && s >= parcours.length);
  }
  return s;
}

describe('machine de course', () => {
  it('3 tours sur une boucle : un temps par tour, arrivée sur la ligne au dernier, chrono arrêté au passage', () => {
    const etat = auVert(3);
    expect(enCourse(etat)).toBe(true);
    expect(texteTour(etat)).toBe('Tour 1/3');
    // 20 m/s : 50 s par tour. Le passage tombe entre deux pas : interpolé.
    const s1 = rouler(etat, 50.05, 20);
    expect(etat.tours).toBe(1);
    expect(etat.tempsTours[0]).toBeCloseTo(50_000, 0);
    expect(etat.depuisTour).toBeGreaterThanOrEqual(0);
    expect(etat.depuisTour).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(texteTour(etat)).toBe('Tour 2/3');
    expect(etat.phase).toBe('parti');
    rouler(etat, 100.5, 20, 0.1, BOUCLE, s1);
    expect(etat.phase).toBe('arrive');
    expect(etat.tours).toBe(3);
    expect(etat.arrivee).toBeCloseTo(150_000, 0);
    expect(etat.chrono).toBe(etat.arrivee);
    expect(Array.from(etat.tempsTours.slice(0, 3)).map((t) => Math.round(t))).toEqual([50_000, 50_000, 50_000]);
    expect(texteTour(etat)).toBe('Tour 3/3');
    // Arrivé : le chrono ne bouge plus.
    rouler(etat, 5, 20, 0.1, BOUCLE, 3000);
    expect(etat.chrono).toBe(etat.arrivee);
  });

  it('1 tour sur une boucle : arrivée au premier passage ; départ d’ailleurs que 0, la ligne est celle du départ', () => {
    const etat = auVert(1, BOUCLE, 700);
    rouler(etat, 49.9, 20, 0.1, BOUCLE, 700);
    expect(etat.phase).toBe('parti');
    rouler(etat, 0.2, 20, 0.1, BOUCLE, 700 + 998);
    expect(etat.phase).toBe('arrive');
    expect(etat.arrivee / 1000).toBeCloseTo(50, 1);
  });

  it('route ouverte : un tour est le passage du départ à l’arrivée', () => {
    const etat = auVert(toursDuFormat(formatCouru('tours3', false)), OUVERT, 400);
    expect(etat.toursCourse).toBe(1);
    rouler(etat, 31, 20, 0.1, OUVERT, 400);
    expect(etat.phase).toBe('arrive');
    expect(etat.tours).toBe(1);
    expect(etat.tempsTours[0]).toBeCloseTo(30_000, 0);
  });

  it('balade et aperçu : pas de course, la boucle tourne sans fin comme avant', () => {
    const balade = auVert(0);
    expect(enCourse(balade)).toBe(false);
    rouler(balade, 200, 20);
    expect(balade.phase).toBe('parti');
    expect(balade.tours).toBe(4);
    const apercu = armerDepart(createDepart(), 0, true, true, 3);
    expect(apercu.toursCourse).toBe(0);
  });

  it('le pilote automatique au volant pendant une course la rend balade (ni arrivée, ni résultat)', () => {
    const etat = auVert(1);
    const suivi = new SuiviCourse();
    suivi.pas(etat, 0.1, { auto: true }, { speed: 20 }, 0, false);
    expect(enCourse(etat)).toBe(false);
    rouler(etat, 60, 20);
    expect(etat.phase).toBe('parti');
    expect(courseFinie(etat, suivi.mesures, { carte: 'c', depart: 'd', vehicule: 'v', format: 'tour1', meteo: 'sec', moment: 'nuit' })).toBeNull();
  });
});

describe('mesures de la course (StatsCourse)', () => {
  it('distance, vitesse la plus haute, glisse, chocs (un frottement continu n’en fait qu’un), NOS', () => {
    const m = createMesures();
    for (let i = 0; i < 10; i += 1) pasMesures(m, 0.1, { speed: 30 }, 0, false);
    expect(m.distance).toBeCloseTo(30, 6);
    expect(m.vitesseMax).toBeCloseTo(108, 6);
    // Glisse : pneus qui glissent, puis arrière qui décroche.
    pasMesures(m, 0.1, { speed: 20, slip: MESURES.glisse }, 0, false);
    pasMesures(m, 0.1, { speed: 20, drift: -MESURES.derive }, 0, false);
    pasMesures(m, 0.1, { speed: 20, slip: 0.1, drift: 0.01 }, 0, false);
    expect(m.glisse).toBeCloseTo(4, 6);
    // Un bord touché pendant 1 s : un choc ; relâché 0,2 s puis retouché : toujours un ; 0,6 s plus tard : deux.
    for (let i = 0; i < 10; i += 1) pasMesures(m, 0.1, { speed: 10 }, 1, false);
    pasMesures(m, 0.2, { speed: 10 }, 0, false);
    pasMesures(m, 0.1, { speed: 10 }, -1, false);
    expect(m.chocs).toBe(1);
    pasMesures(m, 0.6, { speed: 10 }, 0, false);
    pasMesures(m, 0.1, { speed: 10 }, 1, false);
    expect(m.chocs).toBe(2);
    // NOS : chaque allumage compte une fois.
    for (const on of [true, true, false, true, false, false]) pasMesures(m, 0.1, { speed: 10 }, 0, on);
    expect(m.nos).toBe(2);
    // Pas nul (pause) : rien ne bouge.
    const avant = { ...m };
    pasMesures(m, 0, { speed: 50 }, 1, true);
    expect(m).toEqual(avant);
  });

  it('le résultat de l’arrivée : temps, tours et mesures, en secondes', () => {
    const etat = auVert(3);
    const suivi = new SuiviCourse();
    let s = 0;
    for (let t = 0; t < 160 && etat.phase !== 'arrive'; t += 0.1) {
      s += 2;
      suivi.pas(etat, 0.1, { auto: false }, { speed: 20 }, 0, false);
      pasDepart(etat, 0.1, true, s % 1000, BOUCLE, false);
    }
    const finie = courseFinie(etat, suivi.mesures, { carte: 'c', depart: 'd', vehicule: 'v', format: 'tours3', meteo: 'pluie', moment: 'nuit' });
    expect(finie).not.toBeNull();
    expect(finie!.temps).toBeCloseTo(150, 1);
    expect(finie!.tours.map((t) => Math.round(t))).toEqual([50, 50, 50]);
    expect(finie!.stats.distance).toBeCloseTo(3000, -1);
    expect(finie!.stats.vitesseMax).toBeCloseTo(72, 6);
  });
});

describe('records et bilan à l’arrivée (src/state/drive.ts)', () => {
  beforeEach(() => useDrive.setState({ meilleurs: {}, fin: null, input: { auto: false, throttle: 1, brake: 0, lane: 0 } }));

  const course = (temps: number) => ({
    carte: 'carte-essai',
    depart: 'ligne',
    vehicule: 'v',
    format: 'tour1' as const,
    meteo: 'sec' as const,
    moment: 'nuit' as const,
    temps,
    tours: [temps],
    stats: { distance: 1000, vitesseMax: 100, glisse: 0, chocs: 0, nos: 0 },
  });

  it('premier temps, record battu, record gardé ; le bilan vient de cloturerCourse ; le pilote reprend le volant', () => {
    const cle = cleRecord('carte-essai', 'ligne', 'tour1');
    useDrive.getState().terminerCourse(course(90));
    let fin = useDrive.getState().fin;
    expect(fin?.resultat.ancienRecord).toBeNull();
    expect(fin?.resultat.medaille).toBeNull(); // pas de temps de référence pour cette carte
    // Le bilan vient de l'économie (src/jeu/bilan.ts) : une course finie rapporte, ligne par ligne.
    expect(fin?.gains.dollars).toBeGreaterThan(0);
    expect(fin?.gains.detail.reduce((somme, ligne) => somme + ligne.dollars, 0)).toBe(fin?.gains.dollars);
    expect(fin?.solde).toBeGreaterThanOrEqual(fin?.gains.dollars ?? 0);
    expect(useDrive.getState().meilleurs[cle]).toBe(90_000);
    expect(useDrive.getState().input.auto).toBe(true);
    useDrive.getState().terminerCourse(course(80.5));
    fin = useDrive.getState().fin;
    expect(fin?.resultat.ancienRecord).toBe(90);
    expect(useDrive.getState().meilleurs[cle]).toBe(80_500);
    useDrive.getState().terminerCourse(course(85));
    expect(useDrive.getState().fin?.resultat.ancienRecord).toBe(80.5);
    expect(useDrive.getState().meilleurs[cle]).toBe(80_500);
    // Rejouer : le bilan s'efface.
    useDrive.setState({ map: 'carte-essai' });
    useDrive.getState().commencer();
    expect(useDrive.getState().fin).toBeNull();
    useDrive.setState({ map: null });
  });

  it('le format choisi est gardé et relu de façon tolérante', () => {
    useDrive.getState().setFormat('tours3');
    expect(useDrive.getState().format).toBe('tours3');
    useDrive.getState().setFormat('n-importe' as never);
    expect(useDrive.getState().format).toBe('tours3');
    useDrive.getState().setFormat('balade');
  });
});
