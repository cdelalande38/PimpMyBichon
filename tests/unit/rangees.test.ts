import { describe, expect, it } from 'vitest';
import { pasHorizontal, resteDeChaqueCote } from '../../src/ui/rangees.ts';

const rangee = (scrollLeft: number) => ({ scrollLeft, scrollWidth: 1000, clientWidth: 400 });

describe('rangées qui défilent : molette', () => {
  it('compte la place restante de chaque côté', () => {
    expect(resteDeChaqueCote(rangee(0))).toEqual({ gauche: 0, droite: 600 });
    expect(resteDeChaqueCote(rangee(600))).toEqual({ gauche: 600, droite: 0 });
  });

  it('convertit un cran vertical en défilement de côté', () => {
    expect(pasHorizontal(rangee(100), 0, 120)).toBe(120);
    expect(pasHorizontal(rangee(100), 0, -120)).toBe(-120);
  });

  it('rend la main à la page quand la rangée est au bout dans ce sens', () => {
    expect(pasHorizontal(rangee(600), 0, 120)).toBe(0);
    expect(pasHorizontal(rangee(0), 0, -120)).toBe(0);
  });

  it('laisse passer un geste déjà horizontal', () => {
    expect(pasHorizontal(rangee(100), 80, 10)).toBe(0);
  });
});
