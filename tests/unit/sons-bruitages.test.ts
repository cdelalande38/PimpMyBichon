// Bruitages de route en sortie de nuit : données (src/data/bruitages.ts), règles pures
// (src/audio/sfx/regles.ts), lecture de l'index (src/audio/sfx/manifeste.ts), lecteur muet sans
// fichiers et sans requête répétée (src/audio/sfx/route.ts), réglages du panneau « Son »
// (src/state/mixage.ts).

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOUCLES_ROUTE, ESTIMATION_GLISSE, FAMILLE_ROUTE, PONCTUELS_ROUTE, type BoucleRoute, type Glisse } from '../../src/data/bruitages.ts';
import { PILOT } from '../../src/drive/pilote.ts';
import { parseSfxManifest, sfxFileUrl } from '../../src/audio/sfx/manifeste.ts';
import { COUPURE_OUVERTE, coupureBoucle, declenche, glisseMesuree, hauteurBoucle, niveauBoucle, ponctuelPart, suiviGlisseRepos, suivreGlisse, type EtatRoute, type InstantRoute } from '../../src/audio/sfx/regles.ts';
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

describe('bruitages de route : dérapage long (les pneus qui glissent)', () => {
  const derapage = boucle('derapage-long');
  const g = derapage.glisse as Glisse;

  /** Avance un suivi de `n` pas de `dt` secondes sur une glisse brute et une vitesse constantes. */
  const tenir = (suivi: ReturnType<typeof suiviGlisseRepos>, brute: number, kmh: number, n: number, dt = 0.1) => {
    let v = suivi.valeur;
    for (let i = 0; i < n; i += 1) v = suivreGlisse(suivi, brute, kmh, dt, g);
    return v;
  };

  it('est une boucle déclarée, décrite par des données', () => {
    expect(g.seuil).toBeGreaterThan(0);
    expect(g.seuil).toBeLessThan(1);
    expect(g.hysteresis).toBeGreaterThan(0);
    expect(g.vitesseMin).toBe(20);
    expect(famille(FAMILLE_ROUTE)?.emplacements.find((e) => e.id === 'derapage-long')?.genre).toBe('boucle');
  });

  it('muet quand les pneus tiennent, qui monte avec la glisse', () => {
    expect(niveauBoucle(derapage, etat({ glisse: 0 }))).toBe(0);
    expect(niveauBoucle(derapage, etat())).toBe(0);
    const peu = niveauBoucle(derapage, etat({ glisse: 0.3 }));
    const franc = niveauBoucle(derapage, etat({ glisse: 1 }));
    expect(peu).toBeGreaterThan(0);
    expect(franc).toBeGreaterThan(peu);
    expect(hauteurBoucle(derapage, etat({ glisse: 1 }))).toBeGreaterThan(hauteurBoucle(derapage, etat({ glisse: 0.2 })));
    // Ni le niveau ni la hauteur ne suivent la vitesse : seule la glisse compte (le seuil de vitesse est celui du suivi).
    expect(niveauBoucle(derapage, etat({ glisse: 1, vitesseKmh: 40 }))).toBe(niveauBoucle(derapage, etat({ glisse: 1, vitesseKmh: 120 })));
  });

  it('plus sourd et plus bas sur le mouillé, presque rien sur la neige', () => {
    const sec = niveauBoucle(derapage, etat({ glisse: 1 }));
    const mouille = niveauBoucle(derapage, etat({ glisse: 1, mouille: 1 }));
    expect(mouille).toBeLessThan(sec);
    expect(mouille).toBeGreaterThan(0.5 * sec);
    expect(coupureBoucle(derapage, etat({ mouille: 1 }))).toBeLessThan(coupureBoucle(derapage, etat()));
    expect(coupureBoucle(derapage, etat())).toBe(COUPURE_OUVERTE);
    // Sous la neige la chaussée est « mouillée » aussi : c'est la neige qui commande (presque rien, étouffé).
    const neige = niveauBoucle(derapage, etat({ glisse: 1, neige: 1, mouille: 1 }));
    expect(neige).toBeLessThan(0.15 * sec);
    expect(coupureBoucle(derapage, etat({ neige: 1, mouille: 1 }))).toBeLessThanOrEqual(coupureBoucle(derapage, etat({ mouille: 1 })));
    // Une boucle sans mouillé déclaré ne change pas de ton sur la route mouillée.
    expect(coupureBoucle(boucle('vent'), etat({ mouille: 1 }))).toBe(COUPURE_OUVERTE);
  });

  it('coupé en tunnel comme hors tunnel : le même niveau, la même coupure', () => {
    for (const m of [{ glisse: 1 }, { glisse: 0.6, mouille: 1 }, { glisse: 1, neige: 1 }]) {
      expect(niveauBoucle(derapage, etat({ ...m, abri: 1 }))).toBe(niveauBoucle(derapage, etat({ ...m, abri: 0 })));
      expect(coupureBoucle(derapage, etat({ ...m, abri: 1 }))).toBe(coupureBoucle(derapage, etat({ ...m, abri: 0 })));
    }
    expect(derapage.abri).toBeUndefined();
  });

  it('rien sous 20 km/h, même en glissant franchement', () => {
    const suivi = suiviGlisseRepos();
    expect(tenir(suivi, 1, 19.9, 50)).toBe(0);
    expect(suivi.actif).toBe(false);
    expect(tenir(suivi, 1, 20, 20)).toBeGreaterThan(0.9);
    // En ralentissant sous 20 km/h, le crissement s'éteint (relâchement doux).
    expect(tenir(suivi, 1, 10, 100)).toBeLessThan(0.01);
    expect(suivi.actif).toBe(false);
  });

  it('hystérésis : une glisse qui oscille autour du seuil ne mitraille pas', () => {
    const suivi = suiviGlisseRepos();
    const bas = g.seuil - g.hysteresis;
    let bascules = 0;
    // Elle franchit le seuil une fois, puis oscille entre juste au-dessus et juste au-dessous du seuil
    // (mais au-dessus du seuil bas) : le suivi reste allumé, sans bascule.
    tenir(suivi, g.seuil + 0.02, 60, 5);
    expect(suivi.actif).toBe(true);
    let avant = suivi.actif;
    for (let i = 0; i < 100; i += 1) {
      suivreGlisse(suivi, i % 2 === 0 ? g.seuil + 0.02 : g.seuil - 0.02, 60, 0.1, g);
      if (suivi.actif !== avant) bascules += 1;
      avant = suivi.actif;
    }
    expect(bascules).toBe(0);
    // Elle ne s'éteint qu'en dessous du seuil bas ; elle ne se rallume qu'au seuil haut.
    tenir(suivi, bas - 0.01, 60, 3);
    expect(suivi.actif).toBe(false);
    tenir(suivi, g.seuil - 0.01, 60, 3);
    expect(suivi.actif).toBe(false);
    tenir(suivi, g.seuil, 60, 1);
    expect(suivi.actif).toBe(true);
  });

  it('attaque et relâchement doux : le niveau monte et retombe sans saut', () => {
    const suivi = suiviGlisseRepos();
    const montee: number[] = [];
    for (let i = 0; i < 20; i += 1) montee.push(suivreGlisse(suivi, 1, 80, 0.1, g));
    for (let i = 1; i < montee.length; i += 1) expect(montee[i]!).toBeGreaterThanOrEqual(montee[i - 1]!);
    expect(montee[0]!).toBeLessThan(0.6);
    expect(montee[19]!).toBeGreaterThan(0.95);
    const descente: number[] = [];
    for (let i = 0; i < 20; i += 1) descente.push(suivreGlisse(suivi, 0, 80, 0.1, g));
    for (let i = 1; i < descente.length; i += 1) expect(descente[i]!).toBeLessThanOrEqual(descente[i - 1]!);
    // Le relâchement est plus lent que l'attaque.
    expect(descente[0]!).toBeGreaterThan(0.7);
    expect(descente[19]!).toBeLessThan(0.05);
    // Pas de temps nul ou fou : aucune erreur, aucun saut.
    const v = suivi.valeur;
    expect(suivreGlisse(suivi, 1, 80, 0, g)).toBe(v);
    expect(Number.isFinite(suivreGlisse(suivi, Number.NaN, Number.NaN, Number.NaN, g))).toBe(true);
  });

  it('la glisse publiée par le pilote prime ; à défaut, estimée d’après l’accélération latérale et l’adhérence', () => {
    const marche = (kmh: number, cote: number) => ({ vitesse: kmh / 3.6, braquage: cote, grip: 5, genre: 'car' as const });
    // Publiée : elle prime, même à 0 quand l'estimation dirait autre chose, bornée de 0 à 1.
    expect(glisseMesuree({ ...marche(100, 0.3), slip: 0 })).toBe(0);
    expect(glisseMesuree({ ...marche(10, 0), slip: 0.4 })).toBe(0.4);
    expect(glisseMesuree({ ...marche(10, 0), slip: 7 })).toBe(1);
    // Estimée : en ligne droite, ou en virage sous la marge d'adhérence, rien.
    expect(glisseMesuree(marche(100, 0))).toBe(0);
    const E = ESTIMATION_GLISSE;
    const kmhPourRapport = (rapport: number, braquage: number) => 3.6 * Math.sqrt((rapport * 5 * E.empattement.car) / Math.tan(braquage));
    expect(glisseMesuree(marche(kmhPourRapport(E.marge - 0.05, 0.1), 0.1))).toBe(0);
    expect(glisseMesuree(marche(kmhPourRapport(E.marge + E.plage / 2, 0.1), 0.1))).toBeCloseTo(0.5, 5);
    expect(glisseMesuree(marche(kmhPourRapport(E.marge + E.plage + 0.3, 0.1), 0.1))).toBe(1);
    // Symétrique à gauche et à droite ; l'adhérence rapporte : plus d'adhérence, moins de glisse.
    expect(glisseMesuree(marche(90, -0.15))).toBe(glisseMesuree(marche(90, 0.15)));
    expect(glisseMesuree({ ...marche(50, 0.1), grip: 8 })).toBeLessThan(glisseMesuree({ ...marche(50, 0.1), grip: 6 }));
    expect(glisseMesuree({ ...marche(50, 0.1), grip: 6 })).toBeLessThan(1);
    // Mesures absentes ou folles : zéro, sans erreur.
    expect(glisseMesuree({ vitesse: 30, genre: 'car' })).toBe(0);
    expect(glisseMesuree({ vitesse: Number.NaN, braquage: 0.2, genre: 'bike' })).toBe(0);
    expect(glisseMesuree({ vitesse: 30, braquage: 0.2, genre: 'bike', slip: Number.NaN })).toBeGreaterThanOrEqual(0);
  });

  it('les empattements de l’estimation sont ceux du pilote', () => {
    expect(ESTIMATION_GLISSE.empattement).toEqual(PILOT.steer.wheelbase);
    expect(ESTIMATION_GLISSE.gripDefaut).toBe(PILOT.manual.lateral);
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

  it('le retour de flamme : le claquement part avec chaque jet de flammes de la scène, jamais sans', () => {
    // La scène décide (ligne d'échappement qui le permet, lever de pied à haut régime : src/drive/scene/flammes.ts).
    expect(flamme.declencheur).toEqual({ type: 'flamme' });
    expect(declenche(flamme.declencheur, instant({ flammes: 2 }), instant({ flammes: 3 }), 0.99)).toBe(true);
    expect(declenche(flamme.declencheur, instant({ flammes: 3 }), instant({ flammes: 3 }), 0)).toBe(false);
    // Un lever de pied à haut régime sans jet (ligne d'origine) ne claque pas.
    expect(declenche(flamme.declencheur, instant({ charge: 0.9, regime: 0.9 }), instant({ charge: 0, regime: 0.85 }), 0)).toBe(false);
  });

  it('le coup d’envoi du NOS part une seule fois par poussée, au front montant', () => {
    const depart = PONCTUELS_ROUTE.find((p) => p.emplacement === 'nos-depart')!;
    expect(depart.famille).toBe('route');
    expect(declenche(depart.declencheur, instant({ nos: false }), instant({ nos: true }), 0.5)).toBe(true);
    expect(declenche(depart.declencheur, instant({ nos: true }), instant({ nos: true }), 0.5)).toBe(false);
    expect(declenche(depart.declencheur, instant({ nos: true }), instant({ nos: false }), 0.5)).toBe(false);
    expect(declenche(depart.declencheur, instant(), instant(), 0.5)).toBe(false);
    // Une poussée entière (tenue sur de nombreux instants) : un seul départ.
    const suite = [false, false, true, true, true, true, false, false, true, true];
    let departs = 0;
    for (let i = 1; i < suite.length; i += 1) if (declenche(depart.declencheur, instant({ nos: suite[i - 1] }), instant({ nos: suite[i] }), 0.5)) departs += 1;
    expect(departs).toBe(2);
    // Deux appuis trop rapprochés ne font qu'un coup.
    expect(ponctuelPart(depart, instant(), instant({ nos: true }), 0.1, 0.5)).toBe(false);
    expect(ponctuelPart(depart, instant(), instant({ nos: true }), depart.attente, 0.5)).toBe(true);
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

  it('avec des prises : nos-depart une fois par poussée, la boucle de glisse monte avec la glisse puis retombe', async () => {
    const index = {
      format: 'pmb-sfx-sons',
      version: 1,
      famille: 'route',
      boucles: [
        { emplacement: 'derapage-long', fichier: 'derapage-long.ogg', duree: 4, gain: 0, boucle: [0, 4] },
        { emplacement: 'nos', fichier: 'nos.ogg', duree: 4, gain: 0, boucle: [0, 4] },
      ],
      ponctuels: [{ emplacement: 'nos-depart', fichier: 'nos-depart-1.ogg', duree: 0.8, gain: 0 }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.endsWith('sfx.json') ? new Response(JSON.stringify(index)) : new Response(new TextEncoder().encode(url.split('/').pop()?.split('?')[0] ?? ''))) ),
    );
    interface Param {
      value: number;
      setTargetAtTime: ReturnType<typeof vi.fn>;
      cancelScheduledValues: ReturnType<typeof vi.fn>;
      setValueAtTime: ReturnType<typeof vi.fn>;
    }
    const param = (): Param => ({ value: 1, setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn() });
    type Noeud = { gain: Param; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; cible?: Noeud };
    const noeud = (): Noeud => {
      const n: Noeud = { gain: param(), connect: vi.fn((autre: Noeud) => { n.cible = autre; return autre; }), disconnect: vi.fn() };
      return n;
    };
    const sources: { buffer: { nom: string }; start: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; cible?: unknown; playbackRate: Param }[] = [];
    const ctx = {
      currentTime: 0,
      state: 'running',
      createGain: vi.fn(noeud),
      createBiquadFilter: vi.fn(() => Object.assign(noeud(), { frequency: param(), type: 'lowpass' })),
      createBufferSource: vi.fn(() => {
        const source = { buffer: { nom: '' }, loop: false, loopStart: 0, loopEnd: 0, playbackRate: param(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), onended: null as unknown, cible: undefined as unknown, connect: vi.fn() };
        source.connect = vi.fn((autre: unknown) => { source.cible = autre; return autre; });
        sources.push(source);
        return source;
      }),
      decodeAudioData: vi.fn(async (octets: ArrayBuffer) => ({ nom: new TextDecoder().decode(octets), duration: 4 })),
    };
    const audio = { ctx: ctx as unknown as AudioContext, sortie: noeud() as unknown as AudioNode };
    const parti: string[] = [];
    const lecteur = new LecteurBruitages((e) => parti.push(e), '/');
    const pas = async (e: Partial<EtatRoute>) => {
      lecteur.mettreAJour(audio, true, 1, etat(e), instant({ vitesseKmh: e.vitesseKmh ?? 80 }), null);
      ctx.currentTime += 0.1;
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    await pas({}); // charge l'index et décode
    await new Promise((resolve) => setTimeout(resolve, 20));
    await pas({});
    expect(lecteur.contenu).toEqual({ boucles: 2, ponctuels: 1 });
    // Le gain de la boucle de glisse : source → filtre → gain.
    const glisse = sources.find((s) => s.buffer.nom === 'derapage-long.ogg');
    expect(glisse).toBeDefined();
    const gainGlisse = ((glisse!.cible as Noeud).cible as Noeud).gain;
    const dernier = () => (gainGlisse.setTargetAtTime.mock.calls.at(-1) as number[])[0] as number;
    for (let i = 0; i < 5; i += 1) await pas({});
    expect(dernier()).toBe(0);
    for (let i = 0; i < 15; i += 1) await pas({ glisse: 1 });
    expect(dernier()).toBeGreaterThan(0.6);
    expect(glisse!.playbackRate.setTargetAtTime.mock.calls.at(-1)?.[0]).toBeGreaterThan(1);
    for (let i = 0; i < 40; i += 1) await pas({ glisse: 0 });
    expect(dernier()).toBeLessThan(0.02);
    // Le NOS : un seul coup d'envoi tant que la poussée dure, un autre à la poussée suivante.
    expect(parti).toEqual([]);
    for (let i = 0; i < 6; i += 1) await pas({ nos: true });
    expect(parti).toEqual(['nos-depart']);
    for (let i = 0; i < 20; i += 1) await pas({ nos: false });
    for (let i = 0; i < 4; i += 1) await pas({ nos: true });
    expect(parti).toEqual(['nos-depart', 'nos-depart']);
    expect(sources.filter((s) => s.buffer.nom === 'nos-depart-1.ogg')).toHaveLength(2);
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
