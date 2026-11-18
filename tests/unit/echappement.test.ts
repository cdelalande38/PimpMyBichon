// La ligne d'échappement (vague T) : données (lignes, finitions, articles, repli sur l'origine), son
// (réglages compensés et bornés, courbe de saturation, chaîne de traitement construite sans aucune
// source, repli), retour de flammes (déclencheur, enveloppe, géométrie), manifestes (sorties au bout des
// tuyaux du modèle, nœuds présents, validation) et finition des sorties sur le modèle préparé.

import { existsSync, readFileSync } from 'node:fs';
import { Mesh, MeshStandardMaterial, Vector3, type Group, type Material } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import {
  brancherEchappement,
  choisirSonEchappement,
  courbeSaturation,
  echappementSon,
  egalisationMoyenne,
  NIVEAU_MAX_DB,
  reglageSon,
  reponseDb,
} from '../../src/audio/engine/echappement.ts';
import { ARTICLES_ECHAPPEMENT } from '../../src/data/articles/echappement.ts';
import { articleParId, A_VENDRE } from '../../src/data/boutique.ts';
import {
  articleFinition,
  articleLigne,
  FINITIONS_ECHAPPEMENT,
  finitionDe,
  LIGNES_ECHAPPEMENT,
  ligneDe,
  ligneParId,
  POSTE_ECHAPPEMENT,
} from '../../src/data/echappement.ts';
import { validateManifest, VEHICLES } from '../../src/data/vehicles.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { forceFlamme, geometrieFlammes, LEVER, suiviFlammesRepos, suivreFlammes } from '../../src/drive/scene/flammes.ts';
import { matieresSortie, MATIERE_SORTIE, poserFinition } from '../../src/scene/vehicle/echappement.ts';
import { findSynthesis } from '../../tools/lib/audio.mjs';

const libre = ligneParId('libre')!;
const regle = libre.flammes!;

describe('lignes et finitions : données', () => {
  it('l’origine d’abord, des identifiants uniques, la plus libre crache des flammes, elle seule', () => {
    expect(LIGNES_ECHAPPEMENT[0]?.id).toBe('origine');
    expect(new Set(LIGNES_ECHAPPEMENT.map((l) => l.id)).size).toBe(LIGNES_ECHAPPEMENT.length);
    expect(LIGNES_ECHAPPEMENT.filter((l) => l.flammes).map((l) => l.id)).toEqual(['libre']);
    for (const l of LIGNES_ECHAPPEMENT) {
      expect(Math.abs(l.son.niveau), l.id).toBeLessThanOrEqual(NIVEAU_MAX_DB);
      expect(l.description.length, l.id).toBeGreaterThan(20);
    }
  });

  it('sauvegarde : l’origine n’est pas écrite, une valeur inconnue retombe sur l’origine', () => {
    expect(ligneDe(undefined).id).toBe('origine');
    expect(ligneDe({ parts: {} }).id).toBe('origine');
    expect(ligneDe({ parts: { [POSTE_ECHAPPEMENT]: 'fusee' } }).id).toBe('origine');
    expect(ligneDe({ parts: { [POSTE_ECHAPPEMENT]: 'libre' } }).id).toBe('libre');
    expect(finitionDe(undefined).id).toBe('chrome');
    expect(finitionDe({ partPaints: { [POSTE_ECHAPPEMENT]: { finish: 'satine', color: '#17171a' } } }).id).toBe('noir');
    expect(finitionDe({ partPaints: { [POSTE_ECHAPPEMENT]: { finish: 'chrome-colore' } } }).id).toBe('bleui');
    expect(finitionDe({ partPaints: { [POSTE_ECHAPPEMENT]: { finish: 'mat' } } }).id).toBe('chrome');
  });

  it('boutique : chaque nouveauté a son article (60 à 400 $), l’origine et le chrome restent libres', () => {
    const attendus = [...LIGNES_ECHAPPEMENT.filter((l) => l.id !== 'origine').map((l) => articleLigne(l.id)), ...FINITIONS_ECHAPPEMENT.filter((f) => f.id !== 'chrome').map((f) => articleFinition(f.id))];
    expect(ARTICLES_ECHAPPEMENT.map((a) => a.id).sort()).toEqual([...attendus].sort());
    for (const article of ARTICLES_ECHAPPEMENT) {
      expect(article.id).toMatch(/^piece-echappement-/);
      expect(article.famille).toBe('piece');
      expect(article.prix).toBeGreaterThanOrEqual(60);
      expect(article.prix).toBeLessThanOrEqual(400);
      expect(articleParId(article.id)).toBe(article);
      expect(A_VENDRE).toContain(article);
    }
    expect(articleParId(articleLigne('origine'))).toBeUndefined();
    expect(articleParId(articleFinition('chrome'))).toBeUndefined();
  });
});

describe('son des lignes : traitement des prises', () => {
  it('l’origine laisse passer le son : égalisation plate, sans saturation, gain 1', () => {
    const r = reglageSon(ligneParId('origine')!.son);
    expect(r.pente).toBe(1);
    expect(r.sortie).toBeCloseTo(1, 2);
    expect(courbeSaturation(r.pente)).toBeNull();
    for (const f of [63, 250, 1000, 4000]) expect(Math.abs(reponseDb(ligneParId('origine')!.son, f))).toBeLessThan(0.1);
  });

  it('gain borné et compensé : sortie ≤ 0 dB, niveau au signal de référence à 0,5 dB de celui voulu', () => {
    for (const ligne of LIGNES_ECHAPPEMENT) {
      const r = reglageSon(ligne.son);
      expect(r.sortie, ligne.id).toBeGreaterThan(0);
      expect(r.sortie, ligne.id).toBeLessThanOrEqual(1);
      expect(Math.abs(r.ecartDb - ligne.son.niveau), ligne.id).toBeLessThan(0.5);
      expect(Math.abs(r.ecartDb), ligne.id).toBeLessThanOrEqual(NIVEAU_MAX_DB);
    }
  });

  it('caractères : la sport plus grave et plus ouverte, la libre plus rauque et plus forte, la feutrée étouffée', () => {
    const sport = ligneParId('sport')!.son;
    const feutree = ligneParId('feutree')!.son;
    expect(reponseDb(sport, 80)).toBeGreaterThan(3);
    expect(reponseDb(sport, 6000)).toBeGreaterThan(1.5);
    expect(reponseDb(libre.son, 1400)).toBeGreaterThan(4);
    expect(reglageSon(libre.son).pente).toBeGreaterThan(reglageSon(sport).pente);
    expect(libre.son.niveau).toBeGreaterThan(sport.niveau);
    expect(reponseDb(feutree, 4000)).toBeLessThan(-10);
    expect(feutree.niveau).toBeLessThan(0);
    // Ce que l'égalisation ajoute en moyenne est retiré par le gain de sortie.
    expect(egalisationMoyenne(sport)).toBeGreaterThan(0);
  });

  it('courbe de saturation : impaire, croissante, bornée à la pleine échelle', () => {
    const courbe = courbeSaturation(reglageSon(libre.son).pente)!;
    expect(courbe.length % 2).toBe(1);
    expect(courbe[0]).toBeCloseTo(-1, 5);
    expect(courbe[courbe.length - 1]).toBeCloseTo(1, 5);
    expect(courbe[(courbe.length - 1) / 2]).toBeCloseTo(0, 6);
    for (let i = 1; i < courbe.length; i += 1) {
      expect(courbe[i]!).toBeGreaterThanOrEqual(courbe[i - 1]!);
      expect(Math.abs(courbe[i]!)).toBeLessThanOrEqual(1 + 1e-6);
      expect(courbe[i]! + courbe[courbe.length - 1 - i]!).toBeCloseTo(0, 5);
    }
  });

  it('aucune synthèse dans le module (ni oscillateur, ni source, ni tampon fabriqué)', () => {
    const source = readFileSync(new URL('../../src/audio/engine/echappement.ts', import.meta.url), 'utf8');
    expect(source.split('\n').flatMap((line) => findSynthesis(line))).toEqual([]);
    expect(source).not.toMatch(/createBuffer|AudioBuffer|getChannelData|copyToChannel|Math\.random/);
  });
});

/** Un faux contexte audio : il note ce qu'on lui demande ; toute source créée serait une faute. */
function fauxContexte({ sansSaturation = false } = {}) {
  const appels: string[] = [];
  const liens: [string, string][] = [];
  const param = (value = 0) => ({ value, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() });
  const noeud = (nom: string, extra: Record<string, unknown> = {}) => {
    const n: Record<string, unknown> = {
      nom,
      ...extra,
      connect: (cible: { nom: string }) => {
        liens.push([nom, cible.nom]);
        return cible;
      },
    };
    return n;
  };
  let filtres = 0;
  const interdit = (nom: string) => () => {
    appels.push(nom);
    throw new Error(`${nom} interdit`);
  };
  const ctx = {
    currentTime: 1,
    createBiquadFilter: () => {
      appels.push('createBiquadFilter');
      filtres += 1;
      return noeud(`filtre${filtres}`, { type: 'peaking', frequency: param(), Q: param(), gain: param() });
    },
    createWaveShaper: () => {
      appels.push('createWaveShaper');
      if (sansSaturation) throw new Error('pas de WaveShaper');
      return noeud('saturation', { curve: null, oversample: 'none' });
    },
    createGain: () => {
      appels.push('createGain');
      return noeud('niveau', { gain: param(1) });
    },
    createBufferSource: interdit('createBufferSource'),
    createBuffer: interdit('createBuffer'),
    createConstantSource: interdit('createConstantSource'),
  };
  return { ctx, appels, liens, entree: noeud('bus'), sortie: noeud('limiteur') };
}

describe('chaîne de traitement du moteur', () => {
  it('construite de filtres, d’une courbe et d’un gain, sans aucune source ; suit la ligne choisie', () => {
    choisirSonEchappement('origine');
    const f = fauxContexte();
    const chaine = brancherEchappement(f.ctx as never, f.entree as never, f.sortie as never);
    expect(chaine.active).toBe(true);
    expect(chaine.ligne).toBe('origine');
    expect([...new Set(f.appels)].sort()).toEqual(['createBiquadFilter', 'createGain', 'createWaveShaper']);
    // Bus → quatre filtres → saturation → gain → limiteur, rien d'autre.
    expect(f.liens).toEqual([
      ['bus', 'filtre1'],
      ['filtre1', 'filtre2'],
      ['filtre2', 'filtre3'],
      ['filtre3', 'filtre4'],
      ['filtre4', 'saturation'],
      ['saturation', 'niveau'],
      ['niveau', 'limiteur'],
    ]);
    const tour = echappementSon.tour;
    choisirSonEchappement('libre');
    expect(echappementSon.tour).toBe(tour + 1);
    choisirSonEchappement('libre');
    expect(echappementSon.tour).toBe(tour + 1);
    chaine.suivre();
    expect(chaine.ligne).toBe('libre');
    choisirSonEchappement('inconnue');
    expect(echappementSon.ligne).toBe('origine');
    chaine.suivre();
    expect(chaine.ligne).toBe('origine');
  });

  it('repli : un nœud impossible à créer, le bus va au limiteur tel quel', () => {
    const f = fauxContexte({ sansSaturation: true });
    const chaine = brancherEchappement(f.ctx as never, f.entree as never, f.sortie as never);
    expect(chaine.active).toBe(false);
    expect(f.liens).toEqual([['bus', 'limiteur']]);
    expect(() => chaine.suivre()).not.toThrow();
    expect(f.appels).not.toContain('createBufferSource');
  });

  it('le lecteur branche la chaîne entre son bus et son limiteur, et la suit à chaque pas', () => {
    const lecteur = readFileSync(new URL('../../src/audio/engine/lecteur.ts', import.meta.url), 'utf8');
    expect(lecteur).toMatch(/brancherEchappement\(ctx, bus, limiter\)/);
    expect(lecteur).toMatch(/this\.exhaust\?\.suivre\(\)/);
  });
});

describe('retour de flammes : déclencheur', () => {
  const avancer = (s: ReturnType<typeof suiviFlammesRepos>, charge: number, regime: number, secondes: number, passage = false, alea = 0) => {
    let tir = false;
    for (let t = 0; t < secondes - 1e-9; t += 0.1) tir = suivreFlammes(s, charge, regime, passage, regle, 0.1, alea) || tir;
    return tir;
  };

  it('plein gaz à haut régime puis pied levé : un jet, une fois', () => {
    const s = suiviFlammesRepos();
    expect(avancer(s, 1, 0.85, 1)).toBe(false);
    expect(suivreFlammes(s, 0, 0.8, false, regle, 0.1, 0)).toBe(true);
    expect(s.tirs).toBe(1);
    expect(s.vie).toBeCloseTo(regle.duree, 6);
    // Le pied reste levé : pas de second jet.
    expect(avancer(s, 0, 0.6, 3)).toBe(false);
    expect(s.tirs).toBe(1);
  });

  it('rien à bas régime, rien au passage de rapport, rien si le pied se lève trop tard', () => {
    const bas = suiviFlammesRepos();
    avancer(bas, 1, regle.regimeMin - 0.1, 1);
    expect(suivreFlammes(bas, 0, 0.3, false, regle, 0.1, 0)).toBe(false);
    const passage = suiviFlammesRepos();
    avancer(passage, 1, 0.9, 1);
    expect(suivreFlammes(passage, 0.1, 0.9, true, regle, 0.1, 0)).toBe(false);
    const tard = suiviFlammesRepos();
    avancer(tard, 1, 0.9, 1);
    avancer(tard, 0.3, 0.7, LEVER.fenetre + 0.2);
    expect(suivreFlammes(tard, 0, 0.6, false, regle, 0.1, 0)).toBe(false);
  });

  it('délai entre deux jets, et le tirage au sort', () => {
    const s = suiviFlammesRepos();
    avancer(s, 1, 0.9, 0.5);
    expect(suivreFlammes(s, 0, 0.9, false, regle, 0.1, 0)).toBe(true);
    avancer(s, 1, 0.9, 0.3);
    expect(suivreFlammes(s, 0, 0.9, false, regle, 0.1, 0)).toBe(false);
    avancer(s, 1, 0.9, regle.attente);
    expect(suivreFlammes(s, 0, 0.9, false, regle, 0.1, 0)).toBe(true);
    const rare = suiviFlammesRepos();
    avancer(rare, 1, 0.9, 0.5);
    expect(suivreFlammes(rare, 0, 0.9, false, { ...regle, chance: 0.3 }, 0.1, 0.5)).toBe(false);
  });

  it('enveloppe : éteinte au repos et au bout, vive au début, jamais au-dessus de 1', () => {
    expect(forceFlamme(0, regle)).toBe(0);
    let max = 0;
    for (let vie = regle.duree; vie > 0; vie -= regle.duree / 50) {
      const f = forceFlamme(vie, regle);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      max = Math.max(max, f);
    }
    expect(max).toBeGreaterThan(0.5);
  });

  it('géométrie : un quad par sortie, un seul maillage', () => {
    const g = geometrieFlammes([
      { position: [-1, 0.3, 0.2], direction: [-2, 0, 0] },
      { position: [-1, 0.3, -0.2], direction: [-1, 0.1, 0], radius: 0.02 },
    ]);
    expect(g.getAttribute('position').count).toBe(8);
    expect(g.getIndex()?.count).toBe(12);
    // Sens direct à l'écran pour le quad bâti face à la caméra (sinon il serait éliminé comme face arrière).
    expect(Array.from(g.getIndex()!.array).slice(0, 6)).toEqual([0, 2, 1, 1, 2, 3]);
    expect(g.getAttribute('aDir').getX(0)).toBeCloseTo(-1, 6);
    expect(g.getAttribute('aRayon').getX(4)).toBeCloseTo(0.02, 6);
    g.dispose();
  });
});

// Module .tsx : import dynamique, la part utile de son interface écrite ici (comme roues-place.test.ts).
const VEHICLE_MODEL = '../../src/scene/vehicle/VehicleModel.tsx';
const { prepare, disposePrepared } = (await import(/* @vite-ignore */ VEHICLE_MODEL)) as {
  prepare: (source: Group, vehicle: VehicleManifest) => { root: Group };
  disposePrepared: (prepared: { root: Group }) => void;
};

describe('manifestes : sorties d’échappement', () => {
  it('section validée ; une section fausse est refusée avec son nom', () => {
    const bobber = VEHICLES.find((v) => v.id === 'bobber')!;
    expect(() => validateManifest(bobber, 'bobber')).not.toThrow();
    expect(() => validateManifest({ ...bobber, exhaust: { outlets: [] } }, 'bobber')).toThrow(/exhaust/);
    expect(() => validateManifest({ ...bobber, exhaust: { outlets: [{ position: [0, 0, 0], direction: [0, 0, 0] }] } }, 'bobber')).toThrow(/exhaust\.outlets n° 1/);
    expect(() => validateManifest({ ...bobber, exhaust: { outlets: [{ position: [0, 0], direction: [-1, 0, 0] }] } }, 'bobber')).toThrow(/exhaust\.outlets/);
    expect(() => validateManifest({ ...bobber, exhaust: { outlets: bobber.exhaust!.outlets, nodes: [''] } }, 'bobber')).toThrow(/exhaust\.nodes/);
  });

  // Les véhicules qui déclarent des sorties : chaque bouche est au bout d'un tuyau du modèle préparé
  // (le métal des nœuds déclarés, à 3 cm près), et ce métal prend la finition choisie.
  const avecSorties = VEHICLES.filter((v) => v.exhaust && existsSync(new URL(`../../public/assets/vehicles/${v.id}/${v.glb}`, import.meta.url)) && !v.adapt);
  it('au moins le bobber, la sportive et la Cox ont des sorties déclarées', () => {
    expect(avecSorties.map((v) => v.id).sort()).toEqual(expect.arrayContaining(['bobber', 'cox', 'sportive']));
  });

  for (const vehicle of avecSorties) {
    it(`${vehicle.id} : les bouches sont au bout des tuyaux, et le métal des sorties prend la finition`, async () => {
      const bytes = readFileSync(new URL(`../../public/assets/vehicles/${vehicle.id}/${vehicle.glb}`, import.meta.url));
      const source = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '')).scene;
      const prepared = prepare(source, vehicle);
      const root = prepared.root;
      root.updateMatrixWorld(true);
      const caisse = root.getObjectByName('caisse')!;
      const toCaisse = caisse.matrixWorld.clone().invert();
      const points: Vector3[] = [];
      root.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        const materials = (Array.isArray(object.material) ? object.material : [object.material]) as Material[];
        if (!materials.some((m) => m.name === MATIERE_SORTIE)) return;
        const position = object.geometry.getAttribute('position');
        const toLocal = toCaisse.clone().multiply(object.matrixWorld);
        for (let i = 0; i < position.count; i += 1) points.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(toLocal));
      });
      expect(points.length, 'métal des sorties séparé').toBeGreaterThan(0);
      for (const outlet of vehicle.exhaust!.outlets) {
        const bouche = new Vector3(...outlet.position);
        const near = Math.min(...points.map((p) => p.distanceTo(bouche)));
        expect(near, `bouche ${outlet.position.join(', ')}`).toBeLessThan((outlet.radius ?? 0.025) + 0.03);
        // Le jet part vers l'arrière.
        expect(outlet.direction[0]).toBeLessThan(0);
      }
      const materials = matieresSortie(root);
      expect(materials.length).toBeGreaterThan(0);
      const noir = FINITIONS_ECHAPPEMENT.find((f) => f.id === 'noir')!;
      poserFinition(materials, noir);
      for (const m of materials) {
        expect(m).toBeInstanceOf(MeshStandardMaterial);
        expect(`#${m.color.getHexString()}`).toBe(noir.rendu.color);
        expect(m.metalness).toBe(noir.rendu.metalness);
      }
      // Le reste du chrome du véhicule n'a pas bougé.
      const autres = new Set<MeshStandardMaterial>();
      root.traverse((object) => {
        if (object instanceof Mesh && (object.material as Material).name === 'chrome') autres.add(object.material as MeshStandardMaterial);
      });
      for (const m of autres) expect(m.metalness).toBe(1);
      disposePrepared(prepared);
    }, 60_000);
  }
});
