import { describe, expect, it } from 'vitest';
import { isSheetRoute, parseHash, routeToHash, SHARE_CODE, type Route } from '../../src/app/router.ts';

const CODE = 'PMB2.eJyrVkrLz1eyUkpKLFKqBQAdegQ0';

describe('parseHash', () => {
  it('ouvre le garage quand il n’y a pas de hash', () => {
    for (const hash of ['', '#', '#/', '#//']) {
      expect(parseHash(hash)).toEqual({ name: 'garage' });
    }
  });

  it('reconnaît les pages de l’app', () => {
    expect(parseHash('#/reglages')).toEqual({ name: 'reglages' });
    expect(parseHash('#/capot')).toEqual({ name: 'capot' });
    expect(parseHash('#/commande')).toEqual({ name: 'commande' });
    expect(parseHash('/commande')).toEqual({ name: 'commande' });
    expect(parseHash('#/radio')).toEqual({ name: 'radio' });
    // La fiche moteur vit dans le dock (Mécanique · Préparation) : plus de panneau à cette adresse.
    expect(parseHash('#/moteur')).toEqual({ name: 'garage' });
  });

  it('tolère une barre finale et des paramètres collés', () => {
    expect(parseHash('#/commande/')).toEqual({ name: 'commande' });
    expect(parseHash('#/reglages?source=lien')).toEqual({ name: 'reglages' });
  });

  it('retombe sur le garage pour tout hash inconnu', () => {
    for (const hash of ['#/garage-secret', '#x', '#/reglages/avances', '#b', '#d']) {
      expect(parseHash(hash)).toEqual({ name: 'garage' });
    }
  });

  it('ne confond pas un hash avec une propriété d’objet', () => {
    for (const hash of ['#__proto__', '#constructor', '#/toString', '#/__proto__']) {
      expect(parseHash(hash)).toEqual({ name: 'garage' });
    }
  });

  it('lit un lien de build et un lien de défi', () => {
    expect(parseHash(`#b=${CODE}`)).toEqual({ name: 'build', code: CODE });
    expect(parseHash(`#d=${CODE}`)).toEqual({ name: 'defi', code: CODE });
  });

  it('nettoie ce qu’une messagerie ajoute autour du code', () => {
    expect(parseHash(`#b=${encodeURIComponent(CODE)}`)).toEqual({ name: 'build', code: CODE });
    expect(parseHash(`#b=${CODE}.`)).toEqual({ name: 'build', code: CODE });
    expect(parseHash(`#b=${CODE}%20`)).toEqual({ name: 'build', code: CODE });
    expect(parseHash(`#d=${CODE} »`)).toEqual({ name: 'defi', code: CODE });
  });

  it('déclare illisible un code qui n’a pas la bonne forme', () => {
    const bad = [
      '#b=',
      '#b=PMB1.abc',
      '#b=PMB2.',
      '#b=PMB2.abc def',
      '#b=<script>alert(1)</script>',
      `#b=${encodeURIComponent('<img src=x onerror=alert(1)>')}`,
      '#b=%E0%A4%A',
      `#b=PMB2.${'a'.repeat(8001)}`,
    ];
    for (const hash of bad) {
      expect(parseHash(hash), hash).toEqual({ name: 'illisible', kind: 'build' });
    }
    expect(parseHash('#d=n-importe-quoi')).toEqual({ name: 'illisible', kind: 'defi' });
  });

  it('borne la longueur d’un code accepté', () => {
    const longest = `PMB2.${'a'.repeat(8000)}`;
    expect(SHARE_CODE.test(longest)).toBe(true);
    expect(parseHash(`#b=${longest}`)).toEqual({ name: 'build', code: longest });
  });
});

describe('routeToHash', () => {
  it('fait l’aller-retour avec parseHash', () => {
    const routes: Route[] = [
      { name: 'garage' },
      { name: 'reglages' },
      { name: 'capot' },
      { name: 'commande' },
      { name: 'radio' },
      { name: 'build', code: CODE },
      { name: 'defi', code: CODE },
    ];
    for (const route of routes) {
      expect(parseHash(routeToHash(route))).toEqual(route);
    }
  });

  it('ne garde pas un lien illisible dans l’adresse', () => {
    expect(routeToHash({ name: 'illisible', kind: 'build' })).toBe('');
  });
});

describe('isSheetRoute', () => {
  it('distingue le garage des panneaux', () => {
    expect(isSheetRoute({ name: 'garage' })).toBe(false);
    expect(isSheetRoute({ name: 'reglages' })).toBe(true);
    expect(isSheetRoute({ name: 'radio' })).toBe(true);
    expect(isSheetRoute({ name: 'illisible', kind: 'defi' })).toBe(true);
  });
});
