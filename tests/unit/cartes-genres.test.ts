// Genres des façades (tools/maps/genres.mjs, src/drive/scene/abri.ts) et ombre du décor au soleil
// (src/drive/scene/decor.ts, materiaux.ts) : le genre tiré de la donnée, porté par le pied des murs
// et relu par l'app ; l'ombre du décor, de jour seulement.

import { ShaderLib, type WebGLProgramParametersWithUniforms } from 'three';
import { describe, expect, it } from 'vitest';
import { GENRES, genreBatiment, genreDuPied as genreOutil, piedCode } from '../../tools/maps/genres.mjs';
import { facadeAttribute, genreDuPied } from '../../src/drive/scene/abri.ts';
import { DecorKit, SUN_CASTER_LAYER, SUN_CASTER_ROLES, treeGeometry } from '../../src/drive/scene/decor.ts';
import { createNightUniforms, createRoleMaterials } from '../../src/drive/scene/materiaux.ts';

describe('genres des façades', () => {
  it('lit l’usage et la nature de la donnée, sinon la taille', () => {
    expect(genreBatiment({ u: 'Industriel', n: 'Indifférenciée' }, 8, 900)).toBe(GENRES.hangar);
    expect(genreBatiment({ u: 'Agricole', n: 'Indifférenciée' }, 6, 300)).toBe(GENRES.hangar);
    expect(genreBatiment({ u: 'Annexe', n: 'Indifférenciée' }, 3, 40)).toBe(GENRES.annexe);
    expect(genreBatiment({ u: 'Religieux', n: 'Eglise' }, 14, 300)).toBe(GENRES.edifice);
    expect(genreBatiment({ u: 'Indifférencié', n: 'Château' }, 12, 500)).toBe(GENRES.edifice);
    expect(genreBatiment({ u: 'Commercial et services', n: 'Indifférenciée' }, 7, 1200)).toBe(GENRES.hangar);
    expect(genreBatiment({ u: 'Indifférencié', n: 'Indifférenciée' }, 3.6, 30)).toBe(GENRES.annexe);
    // Un grand bâtiment bas sans usage connu reste ordinaire (à Miami, ce sont des immeubles bas).
    expect(genreBatiment({ u: 'Indifférencié', n: 'OSM' }, 6, 2000)).toBe(GENRES.ordinaire);
    expect(genreBatiment({ u: 'Résidentiel', n: 'Indifférenciée' }, 3, 40)).toBe(GENRES.ordinaire);
  });

  it('le pied des murs porte le genre, relevé de 1 à 20 cm, relu à l’identique par l’app', () => {
    for (const y of [-12.37, -0.04, 0, 3.999, 104.21, 961.55]) {
      for (let g = 0; g <= 4; g += 1) {
        const p = piedCode(y, g);
        expect(p).toBeGreaterThan(y);
        expect(p - y).toBeLessThanOrEqual(0.2 + 1e-9);
        // Stocké en 32 bits relativement à l'origine du tronçon, relu dans le repère de la carte.
        for (const origin of [0, 37.42, -512.6]) {
          const stored = Math.fround(p - origin) + origin;
          expect(genreDuPied(stored)).toBe(g);
          expect(genreOutil(stored)).toBe(g);
        }
      }
    }
  });

  it('l’attribut des façades garde la graine sous 1 et ajoute le genre en partie entière', () => {
    const pied = piedCode(99.8, GENRES.hangar);
    const f = facadeAttribute([0, pied, 0, 1, pied + 8, 0, 0, pied + 8, 0], [0, 0, 0]);
    expect(Math.floor(f[2] as number)).toBe(GENRES.hangar);
    expect((f[2] as number) % 1).toBeLessThan(1);
    expect(f[0]).toBeCloseTo(pied, 5);
  });
});

describe('ombre du décor au soleil', () => {
  it('le bâti, les ouvrages et les glissières portent ombre ; le sol la reçoit sans en porter', () => {
    for (const role of ['mur', 'toit', 'ouvrage', 'glissiere']) expect(SUN_CASTER_ROLES.has(role)).toBe(true);
    for (const role of ['chaussee', 'voie', 'terrain', 'accotement', 'eau', 'marquage']) expect(SUN_CASTER_ROLES.has(role)).toBe(false);
    expect(SUN_CASTER_LAYER).toBeGreaterThan(3);
    expect(SUN_CASTER_LAYER).toBeLessThan(32);
  });

  it('les matières lisent l’ombre de jour seulement : la nuit, rien ne change', () => {
    const uniforms = createNightUniforms();
    expect(uniforms.pmbSunOn.value).toBe(0);
    expect(uniforms.pmbSunMap.value).toBeNull();
    const roles = createRoleMaterials(uniforms);
    const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader } as unknown as WebGLProgramParametersWithUniforms;
    roles.get('chaussee')?.onBeforeCompile(shader, undefined as never);
    expect(shader.uniforms.pmbSunMap).toBe(uniforms.pmbSunMap);
    expect(shader.fragmentShader).toContain('if ( pmbSunOn * pmbJour <= 0.0 ) return 1.0;');
    expect(shader.fragmentShader).toContain('directLight.color *= pmbMoonKeep * pmbSunVis;');
    for (const m of roles.values()) m.dispose();
  });

  it('les arbres ont un fût (écorce) sous le feuillage, et la teinte du jour passe par pmbJour', () => {
    const g = treeGeometry();
    const trunk = g.getAttribute('pmbTrunk');
    expect(trunk).toBeDefined();
    const flags = new Set(Array.from(trunk.array as ArrayLike<number>));
    expect([...flags].sort()).toEqual([0, 1]);
    const tri = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    expect(tri).toBeLessThanOrEqual(18);
    g.dispose();
    const kit = new DecorKit(createNightUniforms(), 600);
    expect(kit.treeMaterial.defines?.PMB_FOLIAGE).toBe('');
    kit.dispose();
  });
});
