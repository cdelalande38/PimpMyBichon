// Pilotage au clavier (src/ui/drive/clavier.ts) : la table des touches par leur place, ce qui est tenu,
// le braquage qui monte et revient en douceur, et le tout-lâché.
import { describe, expect, it } from 'vitest';
import { actionDe, appuyer, avancerClavier, CLAVIER, etatClavierVide, relacher, tient, TOUCHES, TOUCHES_LANCEMENT, TOUCHES_PAUSE, toutRelacher } from '../../src/ui/drive/clavier.ts';
import type { LectureManche } from '../../src/ui/drive/manche.ts';

const lecture = (): LectureManche => ({ throttle: 0, brake: 0, steer: 0 });

describe('clavier de la sortie', () => {
  it('les flèches et le pavé de gauche, par leur place : Z Q S D en français, W A S D en anglais', () => {
    expect(actionDe('ArrowUp')).toBe('gaz');
    expect(actionDe('KeyW')).toBe('gaz');
    expect(actionDe('ArrowDown')).toBe('frein');
    expect(actionDe('KeyS')).toBe('frein');
    expect(actionDe('ArrowLeft')).toBe('gauche');
    expect(actionDe('KeyA')).toBe('gauche');
    expect(actionDe('ArrowRight')).toBe('droite');
    expect(actionDe('KeyD')).toBe('droite');
    expect(actionDe('Space')).toBe('nos');
    expect(actionDe('ShiftLeft')).toBe('nos');
    expect(actionDe('KeyP')).toBeNull();
    expect(actionDe('toString')).toBeNull();
    // Chaque action a au moins deux touches ; on lance avec Entrée, Espace ou les gaz.
    for (const action of ['gaz', 'frein', 'gauche', 'droite', 'nos'] as const) expect(Object.values(TOUCHES).filter((a) => a === action).length).toBeGreaterThanOrEqual(2);
    expect(TOUCHES_LANCEMENT).toEqual(expect.arrayContaining(['Enter', 'Space', 'ArrowUp']));
  });

  it('Échap et P mettent en pause, et ne conduisent ni ne lancent rien', () => {
    expect(TOUCHES_PAUSE).toEqual(['Escape', 'KeyP']);
    for (const code of TOUCHES_PAUSE) {
      expect(actionDe(code)).toBeNull();
      expect(TOUCHES_LANCEMENT).not.toContain(code);
    }
  });

  it('une touche tenue ne compte qu’une fois ; deux touches pour la même action : il faut lâcher les deux', () => {
    const etat = etatClavierVide();
    expect(appuyer(etat, 'ArrowUp')).toBe('gaz');
    expect(appuyer(etat, 'ArrowUp')).toBeNull();
    expect(appuyer(etat, 'KeyW')).toBe('gaz');
    expect(appuyer(etat, 'KeyP')).toBeNull();
    expect(tient(etat, 'gaz')).toBe(true);
    relacher(etat, 'ArrowUp');
    expect(tient(etat, 'gaz')).toBe(true);
    relacher(etat, 'KeyW');
    expect(tient(etat, 'gaz')).toBe(false);
  });

  it('gaz et frein : tout ou rien ; rien de tenu, rien de donné', () => {
    const etat = etatClavierVide();
    const out = lecture();
    expect(avancerClavier(etat, 0.016, out)).toBe(false);
    expect(out).toEqual({ throttle: 0, brake: 0, steer: 0 });
    appuyer(etat, 'ArrowUp');
    expect(avancerClavier(etat, 0.016, out)).toBe(true);
    expect(out.throttle).toBe(1);
    expect(out.brake).toBe(0);
    appuyer(etat, 'KeyS');
    avancerClavier(etat, 0.016, out);
    expect(out.brake).toBe(1);
  });

  it('le braquage monte en douceur jusqu’à la butée, sans la dépasser, et revient plus vite à l’axe', () => {
    const etat = etatClavierVide();
    const out = lecture();
    appuyer(etat, 'ArrowRight');
    avancerClavier(etat, 0.1, out);
    expect(out.steer).toBeCloseTo(CLAVIER.braquage * 0.1, 5);
    let images = 1;
    while (out.steer < 1 && images < 100) {
      avancerClavier(etat, 0.016, out);
      images += 1;
    }
    expect(out.steer).toBe(1);
    // De l'axe à la butée : un tiers de seconde environ, pas un coup de volant.
    const duree = 0.1 + (images - 1) * 0.016;
    expect(duree).toBeGreaterThan(0.2);
    expect(duree).toBeLessThan(0.5);
    avancerClavier(etat, 1, out);
    expect(out.steer).toBe(1);
    // Lâchée : retour à l'axe, plus vite, et le clavier « donne » tant qu'il n'y est pas.
    relacher(etat, 'ArrowRight');
    expect(avancerClavier(etat, 0.05, out)).toBe(true);
    expect(out.steer).toBeCloseTo(1 - CLAVIER.retour * 0.05, 5);
    let retour = 0;
    while (avancerClavier(etat, 0.016, out) && retour < 100) retour += 1;
    expect(out.steer).toBe(0);
    expect(retour * 0.016).toBeLessThan(0.3);
  });

  it('gauche est négatif, droite positif ; les deux ensemble : tout droit ; inverser repasse par l’axe', () => {
    const etat = etatClavierVide();
    const out = lecture();
    appuyer(etat, 'KeyA');
    for (let i = 0; i < 40; i += 1) avancerClavier(etat, 0.016, out);
    expect(out.steer).toBe(-1);
    appuyer(etat, 'KeyD');
    for (let i = 0; i < 40; i += 1) avancerClavier(etat, 0.016, out);
    expect(out.steer).toBe(0);
    relacher(etat, 'KeyA');
    avancerClavier(etat, 0.016, out);
    expect(out.steer).toBeGreaterThan(0);
    for (let i = 0; i < 40; i += 1) avancerClavier(etat, 0.016, out);
    expect(out.steer).toBe(1);
  });

  it('un pas de temps absurde ne casse rien ; tout lâcher remet l’axe', () => {
    const etat = etatClavierVide();
    const out = lecture();
    appuyer(etat, 'ArrowLeft');
    avancerClavier(etat, Number.NaN, out);
    expect(out.steer).toBe(0);
    avancerClavier(etat, -1, out);
    expect(out.steer).toBe(0);
    avancerClavier(etat, 50, out);
    expect(out.steer).toBeGreaterThanOrEqual(-1);
    expect(out.steer).toBeLessThan(0);
    toutRelacher(etat);
    expect(etat.tenues.size).toBe(0);
    expect(avancerClavier(etat, 0.016, out)).toBe(false);
    expect(out).toEqual({ throttle: 0, brake: 0, steer: 0 });
  });
});
