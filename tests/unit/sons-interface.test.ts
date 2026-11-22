// Lecteur des sons d'interface (src/audio/sfx/interface.ts) : index absent, emplacement vide, aucun son sans
// geste ni à curseur zéro, tirage des variantes sans répéter la même, une seule lecture de l'index, niveau
// du curseur « Route ». L'index versionné (public/assets/audio/sfx/interface/sfx.json) porte bien les
// emplacements que l'app demande. Aucun son n'est fabriqué : le lecteur ne sait que jouer des prises.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAMILLE_INTERFACE, SONS_INTERFACE } from '../../src/data/bruitages.ts';
import { LecteurInterface, type EvenementSon } from '../../src/audio/sfx/interface.ts';
import { parseSfxManifest } from '../../src/audio/sfx/manifeste.ts';
import { famille } from '../../tools/sons/emplacements.mjs';

const INDEX = {
  format: 'pmb-sfx-sons',
  version: 1,
  famille: 'interface',
  boucles: [],
  ponctuels: [
    { emplacement: 'gain', fichier: 'gain-1.ogg', empreinte: 'aaaa1111', duree: 1.5, gain: 0 },
    { emplacement: 'gain', fichier: 'gain-2.ogg', empreinte: 'aaaa2222', duree: 1.5, gain: -6 },
    { emplacement: 'gain', fichier: 'gain-3.ogg', empreinte: 'aaaa3333', duree: 1.5, gain: 0 },
    { emplacement: 'dollars', fichier: 'dollars-1.ogg', duree: 1, gain: 0 },
    { emplacement: 'clic', fichier: 'clic-1.ogg', duree: 0.1, gain: 0 },
  ],
};

interface Param {
  value: number;
}
interface Noeud {
  gain: Param;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

/** Contexte audio de façade : il compte ce qu'on lui demande, ne joue rien. */
function faux(etat: 'running' | 'suspended' = 'running') {
  const noeud = (): Noeud => ({ gain: { value: 1 }, connect: vi.fn((autre: unknown) => autre), disconnect: vi.fn() });
  const sources: { buffer: { nom: string }; start: ReturnType<typeof vi.fn>; gain?: Noeud }[] = [];
  const gains: Noeud[] = [];
  const ctx = {
    state: etat,
    currentTime: 0,
    createGain: vi.fn(() => {
      const n = noeud();
      gains.push(n);
      return n;
    }),
    createBufferSource: vi.fn(() => {
      const source = { buffer: { nom: '' }, start: vi.fn(), disconnect: vi.fn(), onended: null as unknown, connect: vi.fn() };
      source.connect = vi.fn((cible: Noeud) => {
        (source as { gain?: Noeud }).gain = cible;
        return cible;
      });
      sources.push(source);
      return source;
    }),
    decodeAudioData: vi.fn(async (octets: ArrayBuffer) => ({ nom: new TextDecoder().decode(octets), duration: 1 })),
    resume: vi.fn(async () => undefined),
  };
  return { ctx, sources, gains, sortie: { sortie: noeud() as unknown as AudioNode, ctx: ctx as unknown as AudioContext } };
}

function reponses(index: unknown | null) {
  return vi.fn(async (url: string) => {
    if (url.includes('sfx.json')) return index === null ? new Response('absent', { status: 404 }) : new Response(JSON.stringify(index));
    return new Response(new TextEncoder().encode(url.split('/').pop()?.split('?')[0] ?? ''));
  });
}

describe('sons d’interface : données', () => {
  it('chaque son demandé existe dans la famille de fabrication et dans l’index versionné', () => {
    const fabrication = famille(FAMILLE_INTERFACE);
    expect(fabrication?.genre).toBe('bruitage');
    const ids = new Set(fabrication?.emplacements.map((e) => e.id));
    const index = parseSfxManifest(JSON.parse(readFileSync(new URL('../../public/assets/audio/sfx/interface/sfx.json', import.meta.url), 'utf8')));
    expect(index?.manifest.famille).toBe(FAMILLE_INTERFACE);
    expect(index?.ecartees).toBe(0);
    for (const son of Object.values(SONS_INTERFACE)) {
      expect(ids.has(son.emplacement), son.emplacement).toBe(true);
      expect(index?.manifest.ponctuels.filter((p) => p.emplacement === son.emplacement).length, son.emplacement).toBeGreaterThanOrEqual(1);
    }
  });

  it('le lecteur ne synthétise rien', () => {
    const source = readFileSync(new URL('../../src/audio/sfx/interface.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/createOscillator|createBuffer\(|\.getChannelData|createConstantSource/);
  });
});

describe('lecteur des sons d’interface', () => {
  afterEach(() => vi.unstubAllGlobals());

  const lecteur = (audio: ReturnType<typeof faux>, options: { niveau?: number; geste?: boolean; hasard?: () => number; evenements?: EvenementSon[] } = {}) =>
    new LecteurInterface({
      base: '/',
      sortie: () => audio.sortie,
      niveau: () => options.niveau ?? 0.7,
      geste: () => options.geste ?? true,
      ...(options.hasard ? { hasard: options.hasard } : {}),
      surEvenement: (e) => options.evenements?.push(e),
    });

  it('sans index (404) : muet, sans erreur, une seule requête pour toute la session', async () => {
    const fetch = reponses(null);
    vi.stubGlobal('fetch', fetch);
    const audio = faux();
    const evenements: EvenementSon[] = [];
    const l = lecteur(audio, { evenements });
    for (let i = 0; i < 4; i += 1) expect(await l.jouer(i % 2 ? 'gain' : 'dollars')).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('/assets/audio/sfx/interface/sfx.json');
    expect(await l.contenu()).toBeNull();
    expect(audio.ctx.createBufferSource).not.toHaveBeenCalled();
    // Les demandes sont comptées (le parcours les lit), aucune n'est partie.
    expect(evenements.filter((e) => e.type === 'demande')).toHaveLength(4);
    expect(evenements.filter((e) => e.type === 'joue')).toHaveLength(0);
  });

  it('index illisible (JSON cassé) ou réseau tombé : muet, sans erreur', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{pas du json')));
    const l1 = lecteur(faux());
    await expect(l1.jouer('gain')).resolves.toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('hors ligne'))));
    const l2 = lecteur(faux());
    await expect(l2.jouer('gain')).resolves.toBe(false);
  });

  it('un emplacement sans fichier reste muet, l’autre joue', async () => {
    const seulementDollars = { ...INDEX, ponctuels: INDEX.ponctuels.filter((p) => p.emplacement === 'dollars') };
    vi.stubGlobal('fetch', reponses(seulementDollars));
    const audio = faux();
    const l = lecteur(audio);
    expect(await l.jouer('gain')).toBe(false);
    expect(audio.ctx.createBufferSource).not.toHaveBeenCalled();
    expect(await l.jouer('dollars')).toBe(true);
    expect(audio.sources).toHaveLength(1);
    expect(audio.sources[0]?.buffer.nom).toBe('dollars-1.ogg');
    expect(audio.sources[0]?.start).toHaveBeenCalledTimes(1);
  });

  it('aucun son avant un geste de l’utilisateur (et rien n’est téléchargé), ni curseur « Route » à zéro', async () => {
    const fetch = reponses(INDEX);
    vi.stubGlobal('fetch', fetch);
    const audio = faux();
    expect(await lecteur(audio, { geste: false }).jouer('gain')).toBe(false);
    expect(await lecteur(audio, { niveau: 0 }).jouer('gain')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(audio.ctx.createBufferSource).not.toHaveBeenCalled();
  });

  it('sans contexte audio (ni celui du moteur, ni geste pour en ouvrir un) : muet, sans erreur', async () => {
    vi.stubGlobal('fetch', reponses(INDEX));
    const l = new LecteurInterface({ base: '/', sortie: () => null, niveau: () => 1, geste: () => true });
    // Le contexte AudioContext n'existe pas dans cet environnement : rien ne part, rien ne casse.
    await expect(l.jouer('gain')).resolves.toBe(false);
  });

  it('avec les prises : le niveau du curseur et le gain de la prise, l’index et chaque fichier lus une seule fois', async () => {
    const fetch = reponses(INDEX);
    vi.stubGlobal('fetch', fetch);
    const audio = faux();
    const evenements: EvenementSon[] = [];
    // hasard à 0 : la première prise ; ensuite la précédente est écartée.
    const l = lecteur(audio, { niveau: 0.5, hasard: () => 0, evenements });
    expect(await l.jouer('gain')).toBe(true);
    expect(await l.contenu()).toEqual({ gain: 3, dollars: 1 });
    expect(audio.sources[0]?.buffer.nom).toBe('gain-1.ogg');
    // 0,5 × 10^((0 + gainDb)/20) pour la première prise : le coup de pouce de SONS_INTERFACE (+5 dB).
    const pouce = (db: number) => 10 ** ((db + SONS_INTERFACE.gain.gainDb) / 20);
    expect(SONS_INTERFACE.gain.gainDb).toBe(5);
    expect(audio.sources[0]?.gain?.gain.value).toBeCloseTo(0.5 * pouce(0), 5);
    expect(await l.jouer('gain')).toBe(true);
    expect(audio.sources[1]?.buffer.nom).toBe('gain-2.ogg');
    // La deuxième prise est à −6 dB, plus le coup de pouce.
    expect(audio.sources[1]?.gain?.gain.value).toBeCloseTo(0.5 * pouce(-6), 5);
    // Un emplacement que l'app ne demande pas (« clic ») n'est ni décodé ni demandé.
    const demandes = fetch.mock.calls.map((c) => String(c[0]));
    expect(demandes.filter((u) => u.includes('sfx.json'))).toHaveLength(1);
    expect(demandes.some((u) => u.includes('clic-1'))).toBe(false);
    expect(demandes.filter((u) => u.includes('gain-1.ogg'))).toHaveLength(1);
    expect(demandes[1]).toContain('?v=aaaa1111');
    expect(evenements.filter((e) => e.type === 'joue').map((e) => e.fichier)).toEqual(['gain-1.ogg', 'gain-2.ogg']);
    expect(audio.ctx.createGain).toHaveBeenCalled();
  });

  it('un contexte suspendu est repris avant de jouer', async () => {
    vi.stubGlobal('fetch', reponses(INDEX));
    const audio = faux('suspended');
    expect(await lecteur(audio).jouer('dollars')).toBe(true);
    expect(audio.ctx.resume).toHaveBeenCalledTimes(1);
    expect(audio.sources[0]?.start).toHaveBeenCalledTimes(1);
  });

  it('tirage : jamais deux fois de suite la même prise, toutes jouées avec le temps ; une seule prise : toujours elle', async () => {
    vi.stubGlobal('fetch', reponses(INDEX));
    const audio = faux();
    let k = 0;
    const l = lecteur(audio, { hasard: () => ((k++ * 0.37) % 1) });
    const vus: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      await l.jouer('gain');
      vus.push(audio.sources[i]?.buffer.nom ?? '');
    }
    for (let i = 1; i < vus.length; i += 1) expect(vus[i], `tirage ${i}`).not.toBe(vus[i - 1]);
    expect(new Set(vus)).toEqual(new Set(['gain-1.ogg', 'gain-2.ogg', 'gain-3.ogg']));
    // Des bornes du hasard : 0 et 0,999… restent dans la liste.
    for (const hasard of [0, 0.5, 0.999999, 1, -1, Number.NaN]) {
      const d = new LecteurInterface({ base: '/', hasard: () => hasard });
      const a = d.choisir('gain', 3);
      const b = d.choisir('gain', 3);
      expect([a, b].every((i) => i >= 0 && i < 3), `hasard ${hasard}`).toBe(true);
      expect(a).not.toBe(b);
    }
    const seul = new LecteurInterface({ base: '/', hasard: () => 0.9 });
    expect([seul.choisir('dollars', 1), seul.choisir('dollars', 1)]).toEqual([0, 0]);
  });
});
