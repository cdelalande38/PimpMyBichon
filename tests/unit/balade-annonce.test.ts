// Annonce « la course devient une balade » (src/ui/drive/baladeAnnonce.ts) : détectée à partir de l'état
// de départ seul, avec la vraie règle (SuiviCourse, src/drive/course.ts, qui n'a pas bougé).
import { describe, expect, it } from 'vitest';
import { armerDepart, createDepart, enCourse, type EtatDepart } from '../../src/drive/depart.ts';
import { SuiviCourse } from '../../src/drive/course.ts';
import { BALADE_MONTREE, createVuBalade, MESSAGE_BALADE, PREVENIR_BALADE, pasBalade } from '../../src/ui/drive/baladeAnnonce.ts';

const MOTION = { speed: 20, slip: 0, drift: 0 } as const;

/** Une course de `tours` tours, partie (le vert est passé), à l'abscisse 0. */
function courseEnRoute(tours: number): EtatDepart {
  return auVert(armerDepart(createDepart(), 0, true, false, tours));
}

/** Le vert est passé : la route roule (lancerDepart réarmerait sans les tours de la course). */
function auVert(etat: EtatDepart): EtatDepart {
  etat.phase = 'parti';
  etat.vert = true;
  return etat;
}

/** Une seconde de route : le suivi de la scène (avec ou sans pilote automatique), puis l'état avance. */
function seconde(etat: EtatDepart, suivi: SuiviCourse, auto: boolean): void {
  suivi.pas(etat, 1, { auto }, MOTION, 0, false);
  etat.chrono += 1000;
}

describe('annonce de la balade', () => {
  it('textes : la course est finie pour cette sortie, la balade, sans gain, sans fenêtre', () => {
    expect(MESSAGE_BALADE).toContain('course est finie');
    expect(MESSAGE_BALADE).toContain('balade');
    expect(MESSAGE_BALADE).toContain('sans gain');
    expect(PREVENIR_BALADE).toContain('balade');
    expect(PREVENIR_BALADE).toContain('sans gain');
    expect(BALADE_MONTREE).toBeGreaterThan(3);
    expect(BALADE_MONTREE).toBeLessThan(15);
  });

  it('à la main, rien ; au pilote automatique, une annonce une seule fois, effacée après BALADE_MONTREE s de route', () => {
    const etat = courseEnRoute(1);
    const suivi = new SuiviCourse();
    const vu = createVuBalade();
    expect(pasBalade(vu, etat)).toBe('rien');
    for (let i = 0; i < 3; i += 1) {
      seconde(etat, suivi, false);
      expect(pasBalade(vu, etat)).toBe('rien');
    }
    expect(enCourse(etat)).toBe(true);
    // Le pilote automatique prend le volant : la scène convertit la course (règle inchangée).
    seconde(etat, suivi, true);
    expect(enCourse(etat)).toBe(false);
    expect(pasBalade(vu, etat)).toBe('annoncer');
    expect(pasBalade(vu, etat)).toBe('rien');
    for (let i = 1; i < BALADE_MONTREE; i += 1) {
      seconde(etat, suivi, true);
      expect(pasBalade(vu, etat)).toBe('rien');
    }
    seconde(etat, suivi, true);
    expect(pasBalade(vu, etat)).toBe('effacer');
    expect(pasBalade(vu, etat)).toBe('rien');
    // Rendre le volant ne ressuscite pas la course, et ne ré-annonce rien.
    seconde(etat, suivi, false);
    expect(pasBalade(vu, etat)).toBe('rien');
  });

  it('une balade, l’aperçu et les feux n’annoncent rien ; un départ réarmé efface l’annonce', () => {
    const vu = createVuBalade();
    const balade = courseEnRoute(0);
    const suivi = new SuiviCourse();
    for (let i = 0; i < 3; i += 1) {
      seconde(balade, suivi, true);
      expect(pasBalade(vu, balade)).toBe('rien');
    }
    const apercu = auVert(armerDepart(createDepart(), 0, true, true, 3));
    expect(pasBalade(createVuBalade(), apercu)).toBe('rien');

    // Course en cours, pilote automatique pendant les feux : rien tant que la route ne roule pas.
    const etat = armerDepart(createDepart(), 0, true, false, 3);
    const vu2 = createVuBalade();
    etat.phase = 'feux';
    expect(pasBalade(vu2, etat)).toBe('rien');
    auVert(etat);
    seconde(etat, suivi, true);
    expect(pasBalade(vu2, etat)).toBe('annoncer');
    // « Repartir » : on repasse par l'attente, l'annonce est retirée, la course est de retour.
    armerDepart(etat, 0, true, false, 3);
    expect(pasBalade(vu2, etat)).toBe('effacer');
    expect(enCourse(etat)).toBe(true);
    expect(pasBalade(vu2, etat)).toBe('rien');
  });
});
