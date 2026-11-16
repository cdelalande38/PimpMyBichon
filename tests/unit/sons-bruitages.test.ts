// Bruitages de route en sortie de nuit : données (src/data/bruitages.ts), règles pures
// (src/audio/sfx/regles.ts), lecture de l'index (src/audio/sfx/manifeste.ts), lecteur muet sans
// fichiers et sans requête répétée (src/audio/sfx/route.ts), réglages du panneau « Son »
// (src/state/mixage.ts).

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOUCLES_ROUTE, FAMILLE_ROUTE, PONCTUELS_ROUTE, type BoucleRoute } from '../../src/data/bruitages.ts';
import { parseSfxManifest, sfxFileUrl } from '../../src/audio/sfx/manifeste.ts';
import { COUPURE_OUVERTE, coupureBoucle, declenche, hauteurBoucle, niveauBoucle, ponctuelPart, type EtatRoute, type InstantRoute } from '../../src/audio/sfx/regles.ts';
import { instantRepos, LecteurBruitages } from '../../src/audio/sfx/route.ts';
import { MIXAGE_ORIGINE } from '../../src/drive/mixage.ts';
import { sanitizeMixage } from '../../src/state/mixage.ts';
import { EMPLACEMENTS_MOTEUR, famille } from '../../tools/sons/emplacements.mjs';

const boucle = (id: string) => BOUCLES_ROUTE.find((b) => b.emplacement === id) as BoucleRoute;
const etat = (o: Partial<EtatRoute> = {}): EtatRoute => ({ vitesseKmh: 80, pluie: 0, neige: 0, mouille: 0, abri: 0, nos: false, ...o });
const instant = (o: Partial<InstantRoute> = {}): InstantRoute => ({ ...instantRepos(), ...o });

describe('bruitages de route : données', () => {
  it('chaque emplacement joué existe dans la famille de fabrication', () => {
    const route = famille(FAMILLE_ROUTE);
    expect(route?.genre).toBe('bruitage');
    const ids = new Set(route?.emplacements.map((e) => e.id));
    const moteur = new Set(EMPLACEMENTS_MOTEUR.map((e) => e.id));
    for (const b of BOUCLES_ROUTE) {
      expect(ids.has(b.emplacement), b.emplacement).toBe(true);
      expect(route?.emplacements.find((e) => e.id === b.emplacement)?.genre).toBe('boucle');
    }
    for (const p of PONCTUELS_ROUTE) {
      // Un ponctuel « moteur » se replie sur la route : il existe des deux côtés.
      expect(ids.has(p.emplacement), p.emplacement).toBe(true);
      if (p.famille === 'moteur') expect(moteur.has(p.emplacement)).toBe(true);
    }
    expect(ids.has('nos')).toBe(true);
  });
});

describe('bruitages de route : boucles', () => {
  it('le roulement suit la vitesse, sec ou mouillé, étouffé sous la neige', () => {
    const sec = boucle('roulement-sec');
    const mouille = boucle('roulement-mouille');
    expect(niveauBoucle(sec, etat({ vitesseKmh: 0 }))).toBe(0);
    expect(niveauBoucle(sec, etat({ vitesseKmh: 40 }))).toBeLessThan(niveauBoucle(sec, etat({ vitesseKmh: 90 })));
    expect(hauteurBoucle(sec, etat({ vitesseKmh: 20 }))).toBeLessThan(hauteurBoucle(sec, etat({ vitesseKmh: 90 })));
    // Sous la pluie : le mouillé remplace le sec.
    expect(niveauBoucle(sec, etat({ mouille: 1, pluie: 1 }))).toBe(0);
    expect(niveauBoucle(mouille, etat({ mouille: 1, pluie: 1 }))).toBeGreaterThan(0.5);
    expect(niveauBoucle(mouille, etat())).toBe(0);
    // Sous la neige : on roule « sec », plus bas et étouffé.
    const neige = etat({ neige: 1, mouille: 1 });
    expect(niveauBoucle(mouille, neige)).toBe(0);
    expect(niveauBoucle(sec, neige)).toBeGreaterThan(0);
    expect(niveauBoucle(sec, neige)).toBeLessThan(niveauBoucle(sec, etat()));
    expect(coupureBoucle(sec, neige)).toBeLessThan(1000);
    expect(coupureBoucle(sec, etat())).toBe(COUPURE_OUVERTE);
  });

  it('le vent suit le carré de la vitesse', () => {
    const vent = boucle('vent');
    const a = niveauBoucle(vent, etat({ vitesseKmh: 15 + (130 - 15) / 2 }));
    const b = niveauBoucle(vent, etat({ vitesseKmh: 130 }));
    expect(a / b).toBeCloseTo(0.25, 5);
    expect(niveauBoucle(vent, etat({ vitesseKmh: 10 }))).toBe(0);
  });

  it('la pluie seulement quand il pleut et hors du tunnel ; le tunnel sous la voûte ; le NOS pendant la poussée', () => {
    expect(niveauBoucle(boucle('pluie'), etat())).toBe(0);
    expect(niveauBoucle(boucle('pluie'), etat({ pluie: 1 }))).toBeGreaterThan(0);
    expect(niveauBoucle(boucle('pluie'), etat({ pluie: 1, abri: 1 }))).toBe(0);
    expect(niveauBoucle(boucle('tunnel'), etat())).toBe(0);
    expect(niveauBoucle(boucle('tunnel'), etat({ abri: 1 }))).toBeGreaterThan(0);
    expect(niveauBoucle(boucle('nos'), etat())).toBe(0);
    expect(niveauBoucle(boucle('nos'), etat({ nos: true }))).toBeGreaterThan(0);
  });

  it('niveaux bornés de 0 à 1, même sur des mesures folles', () => {
    for (const b of BOUCLES_ROUTE) {
      const n = niveauBoucle(b, etat({ vitesseKmh: Number.NaN, pluie: 5, neige: -1, mouille: Infinity, abri: 2, nos: true }));
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
    }
  });
});

describe('bruitages de route : ponctuels', () => {
  const freinage = PONCTUELS_ROUTE.find((p) => p.emplacement === 'freinage')!;
  const rapport = PONCTUELS_ROUTE.find((p) => p.emplacement === 'rapport')!;
  const flamme = PONCTUELS_ROUTE.find((p) => p.emplacement === 'backfire')!;

  it('le rapport part au front montant du passage, une fois', () => {
    expect(declenche(rapport.declencheur, instant(), instant({ shifting: true }), 0.5)).toBe(true);
    expect(declenche(rapport.declencheur, instant({ shifting: true }), instant({ shifting: true }), 0.5)).toBe(false);
    expect(declenche(rapport.declencheur, instant({ shifting: true }), instant(), 0.5)).toBe(false);
  });

  it('le freinage part sur une forte décélération au-dessus d’une vitesse, pas au petit freinage ni à l’arrêt', () => {
    const fort = instant({ vitesseKmh: 80, accel: -7 });
    expect(declenche(freinage.declencheur, instant({ vitesseKmh: 80 }), fort, 0.5)).toBe(true);
    expect(declenche(freinage.declencheur, fort, fort, 0.5)).toBe(false);
    expect(declenche(freinage.declencheur, instant({ vitesseKmh: 80 }), instant({ vitesseKmh: 80, accel: -2 }), 0.5)).toBe(false);
    expect(declenche(freinage.declencheur, instant({ vitesseKmh: 10 }), instant({ vitesseKmh: 10, accel: -7 }), 0.5)).toBe(false);
  });

  it('le retour de flamme : lever de pied à haut régime, au hasard', () => {
    const avant = instant({ charge: 0.9, regime: 0.9 });
    const leve = instant({ charge: 0, regime: 0.85 });
    expect(declenche(flamme.declencheur, avant, leve, 0)).toBe(true);
    expect(declenche(flamme.declencheur, avant, leve, 0.99)).toBe(false);
    expect(declenche(flamme.declencheur, instant({ charge: 0.9, regime: 0.4 }), leve, 0)).toBe(false);
  });

  it('un délai minimal sépare deux départs', () => {
    expect(ponctuelPart(rapport, instant(), instant({ shifting: true }), 0, 0.5)).toBe(false);
    expect(ponctuelPart(rapport, instant(), instant({ shifting: true }), rapport.attente, 0.5)).toBe(true);
  });
});

describe('index des bruitages (sfx.json)', () => {
  it('lit le format de sons:build, écarte les entrées illisibles', () => {
    const parsed = parseSfxManifest({
      format: 'pmb-sfx-sons',
      version: 1,
      famille: 'route',
      boucles: [
        { emplacement: 'vent', fichier: 'vent.ogg', empreinte: 'abcdef0123', duree: 6, gain: 0, regime: null, boucle: [0, 6] },
        { emplacement: 'pluie', fichier: '../pluie.ogg', duree: 6, gain: 0, boucle: [0, 6] },
      ],
      ponctuels: [{ emplacement: 'rapport', fichier: 'rapport-1.ogg', duree: 0.4, gain: -2 }, { emplacement: 'rapport' }],
    });
    expect(parsed?.ecartees).toBe(2);
    expect(parsed?.manifest.boucles.map((b) => b.emplacement)).toEqual(['vent']);
    expect(parsed?.manifest.ponctuels.map((p) => p.fichier)).toEqual(['rapport-1.ogg']);
    expect(parseSfxManifest({ format: 'pmb-engine-sons', version: 1, famille: 'v8' })).toBeNull();
    // L'index versionné de la route est lisible (vide tant qu'aucun son n'est fabriqué) : une
    // requête qui aboutit à chaque session, jamais une 404.
    const versionne = parseSfxManifest(JSON.parse(readFileSync(new URL('../../public/assets/audio/sfx/route/sfx.json', import.meta.url), 'utf8')));
    expect(versionne?.manifest.famille).toBe(FAMILLE_ROUTE);
    expect(versionne?.ecartees).toBe(0);
    expect(sfxFileUrl('/PimpMyBichon/', 'route', 'vent.ogg', 'abcdef0123')).toBe('/PimpMyBichon/assets/audio/sfx/route/vent.ogg?v=abcdef0123');
  });
});

describe('lecteur des bruitages', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Contexte audio de façade : il compte ce qu'on lui demande, ne joue rien. */
  function faux() {
    const param = () => ({ value: 1, setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn() });
    const node = () => ({ gain: param(), connect: vi.fn((n: unknown) => n), disconnect: vi.fn() });
    const ctx = { currentTime: 0, state: 'running', createGain: vi.fn(node), createBufferSource: vi.fn(), createBiquadFilter: vi.fn(), decodeAudioData: vi.fn() };
    return { ctx: ctx as unknown as AudioContext, sortie: node() as unknown as AudioNode, brut: ctx };
  }

  it('sans index (404) : muet, sans erreur, une seule requête pour toute la session', async () => {
    const fetch = vi.fn(async (url: string) => new Response(`absent : ${url}`, { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    const parti: string[] = [];
    const lecteur = new LecteurBruitages((e) => parti.push(e), '/');
    const audio = faux();
    for (let i = 0; i < 5; i += 1) {
      lecteur.mettreAJour(audio, true, 0.7, etat(), instant({ shifting: i % 2 === 1 }), null);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    lecteur.couper();
    lecteur.mettreAJour(audio, true, 0.7, etat(), instant({ shifting: true }), null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('/assets/audio/sfx/route/sfx.json');
    expect(lecteur.contenu).toBeNull();
    expect(parti).toEqual([]);
    expect(audio.brut.createBufferSource).not.toHaveBeenCalled();
  });

  it('aucune synthèse : ni oscillateur, ni onde, ni tampon fabriqué', () => {
    for (const file of ['src/audio/sfx/route.ts', 'src/audio/sfx/regles.ts', 'src/audio/sfx/manifeste.ts', 'src/audio/sfx/meteo.ts', 'src/data/bruitages.ts']) {
      const text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      expect(text, file).not.toMatch(/createOscillator|createPeriodicWave|createConstantSource|createBuffer\s*\(|OscillatorNode|getChannelData/);
    }
  });
});

describe('réglages du panneau « Son »', () => {
  it('valeurs d’origine : radio 45, moteur 100, route 70', () => {
    expect(MIXAGE_ORIGINE).toEqual({ radio: 45, moteur: 100, route: 70 });
    expect(sanitizeMixage(undefined)).toEqual(MIXAGE_ORIGINE);
  });

  it('lecture tolérante : illisible → origine, hors bornes → bornée, arrondie', () => {
    expect(sanitizeMixage({ radio: 'fort', moteur: 140, route: -3 })).toEqual({ radio: 45, moteur: 100, route: 0 });
    expect(sanitizeMixage({ radio: 12.6, moteur: Number.NaN, route: 55 })).toEqual({ radio: 13, moteur: 100, route: 55 });
  });
});
