// Finitions de la sortie de jour (vague T) : ombre portée par le soleil qui suit la silhouette
// (src/render/sunShadow.ts), sa netteté par météo (src/data/moments.ts), caissons des enseignes
// éteintes de jour (src/drive/scene/decor.ts), ajouts de jour des matières pesés par pmbJour (la nuit
// reste exactement celle d'avant).
import { ShaderChunk, ShaderLib, Vector3, type WebGLProgramParametersWithUniforms } from 'three';
import { describe, expect, it } from 'vitest';
import { LOOKS } from '../../src/data/moments.ts';
import { MomentMelange } from '../../src/drive/scene/moment.ts';
import { DecorKit, SIGN_BOX } from '../../src/drive/scene/decor.ts';
import { SIGN_ATLAS, SIGN_ITEMS, SIGN_SIZE } from '../../src/drive/scene/enseignes.ts';
import { createNightUniforms, createRoleMaterials } from '../../src/drive/scene/materiaux.ts';
import { SOL_FACADE, SOL_HEAD, SOL_SURFACE } from '../../src/drive/scene/sol.ts';
import { SUN_SHADOW, aimSunShadow, heightMapLayout, shadowReach, shadowSun, SunShadow } from '../../src/render/sunShadow.ts';
import { WEATHERS } from '../../src/state/drive.ts';

const VOITURE = { halfLength: 2.25, halfWidth: 0.98, height: 1.25 };
const VAN = { halfLength: 2.6, halfWidth: 1.0, height: 2.6 };
const MOTO = { halfLength: 1.1, halfWidth: 0.42, height: 1.2 };

describe('ombre portée par le soleil : cartes de hauteur', () => {
  it('couvrent l’empreinte, 128 texels sur la longueur, la largeur au prorata (puissance de deux)', () => {
    for (const m of [VOITURE, VAN, MOTO]) {
      const l = heightMapLayout(m);
      expect(l.x0).toBeLessThan(-m.halfLength);
      expect(l.x1).toBeGreaterThan(m.halfLength);
      expect(l.z0).toBeLessThan(-m.halfWidth);
      expect(l.z1).toBeGreaterThan(m.halfWidth);
      expect(l.height).toBeGreaterThan(m.height);
      expect(l.width).toBe(SUN_SHADOW.texels);
      expect(Math.log2(l.depth) % 1).toBe(0);
      expect(l.depth).toBeGreaterThanOrEqual(32);
      expect(l.depth).toBeLessThanOrEqual(l.width);
      // Un texel fait moins de 5 cm dans les deux sens.
      expect((l.x1 - l.x0) / l.width).toBeLessThan(0.05);
      expect((l.z1 - l.z0) / l.depth).toBeLessThan(0.07);
    }
  });

  it('le plan d’ombre garde l’ombre entière d’un van sous le soleil de jour', () => {
    const [x, y, z] = LOOKS.jour.sec.astre.direction;
    const sun = shadowSun(x, y, z, 1, new Vector3());
    expect(shadowReach(VAN.height, sun)).toBeLessThan(SUN_SHADOW.reach);
  });
});

describe('ombre portée par le soleil : direction', () => {
  it('soleil franc : la direction donnée, unitaire', () => {
    const d = new Vector3(0.45, 0.72, 0.53).normalize();
    const out = shadowSun(d.x, d.y, d.z, 1, new Vector3());
    expect(out.length()).toBeCloseTo(1, 9);
    expect(out.distanceTo(d)).toBeLessThan(1e-9);
  });

  it('ciel couvert : tirée vers le zénith, ombre plus courte ; jamais verticale (pente bornée)', () => {
    const d = new Vector3(0.45, 0.72, 0.53).normalize();
    const franc = shadowSun(d.x, d.y, d.z, 1, new Vector3());
    const couvert = shadowSun(d.x, d.y, d.z, 0, new Vector3());
    expect(couvert.y).toBeGreaterThan(franc.y);
    expect(shadowReach(1.4, couvert)).toBeLessThan(shadowReach(1.4, franc) / 2);
    const zenith = shadowSun(0, 1, 0, 1, new Vector3());
    expect(zenith.y / Math.hypot(zenith.x, zenith.z)).toBeLessThanOrEqual(SUN_SHADOW.maxSlope + 1e-9);
    // Soleil sous l'horizon (valeur aberrante) : toujours au-dessus.
    expect(shadowSun(1, -0.5, 0, 1, new Vector3()).y).toBeGreaterThan(0);
  });

  it('pose la direction, la douceur et la levée sur la matière, sans rien allouer', () => {
    const shadow = new SunShadow(VOITURE);
    const sun = shadow.material.uniforms.uSun?.value as Vector3;
    shadow.mesh.position.y = SUN_SHADOW.planeY + 0.3;
    aimSunShadow(shadow, 0.45, 0.72, 0.53, 0.25);
    expect(shadow.material.uniforms.uSun?.value).toBe(sun);
    expect(sun.length()).toBeCloseTo(1, 9);
    expect(shadow.material.uniforms.uSoft?.value).toBeCloseTo(0.75, 9);
    expect(shadow.material.uniforms.uLift?.value).toBeCloseTo(0.3, 9);
    // Invisible tant que le moteur ne l'a pas montrée (la nuit).
    expect(shadow.mesh.visible).toBe(false);
    expect(shadow.material.fragmentShader).toContain('textureLod');
    shadow.dispose();
  });
});

describe('netteté de l’ombre selon le moment', () => {
  it('soleil franc au sec, ombre douce sous la pluie et la neige ; mêlée sans arrondi', () => {
    expect(LOOKS.jour.sec.ombreNette).toBe(1);
    expect([LOOKS.jour.pluie.ombreNette, LOOKS.jour.neige.ombreNette]).toEqual([0, 0]);
    for (const { id } of WEATHERS) expect(LOOKS.nuit[id].ombre).toBe(0);
    const melange = new MomentMelange(Object.fromEntries(['chaussee', 'voie', 'marquage', 'accotement', 'terrain', 'eau', 'mur', 'ouvrage', 'arbre', 'lointain'].map((m) => [m, '#000000'])) as never);
    melange.melanger(1, 0, 0);
    expect(melange.etat.ombreNette).toBe(1);
    melange.melanger(1, 1, 0);
    expect(melange.etat.ombreNette).toBe(0);
    melange.melanger(1, 0.5, 0);
    expect(melange.etat.ombreNette).toBeCloseTo(0.5, 12);
  });
});

describe('enseignes éteintes de jour', () => {
  it('caisson derrière les tubes, montré le jour seulement', () => {
    const kit = new DecorKit(createNightUniforms(), 600);
    expect(kit.signDayMaterial.visible).toBe(false);
    kit.poserJour(1);
    expect(kit.signDayMaterial.visible).toBe(true);
    kit.poserJour(0);
    expect(kit.signDayMaterial.visible).toBe(false);
    kit.signBox.computeBoundingBox();
    const box = kit.signBox.boundingBox;
    expect(box?.max.z).toBeCloseTo(SIGN_BOX.front, 6);
    expect(box?.max.z).toBeLessThan(0);
    expect(box?.max.x).toBeGreaterThan(SIGN_SIZE.width / 2);
    expect(SIGN_ATLAS.cols * SIGN_ATLAS.rows).toBeGreaterThanOrEqual(SIGN_ITEMS.length);
    kit.dispose();
  });

  it('les tubes éteints sont lus dans l’atlas des enseignes, sur la face avant du caisson', () => {
    const kit = new DecorKit(createNightUniforms(), 600);
    const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader } as unknown as WebGLProgramParametersWithUniforms;
    kit.signDayMaterial.onBeforeCompile(shader, undefined as never);
    expect(shader.vertexShader).toContain('attribute float aCell');
    expect(shader.vertexShader).toContain('vSignFront');
    expect(shader.fragmentShader).toContain('pmbSignAtlas');
    expect(shader.uniforms.pmbSignAtlas).toBe(kit.signAtlas);
    kit.dispose();
  });
});

describe('ajouts de jour des matières : pesés par pmbJour, nuls la nuit', () => {
  it('uniforme partagé, à 0 tant que le moment ne l’a pas posé', () => {
    expect(createNightUniforms().pmbJour.value).toBe(0);
  });

  it('herbe, enrobé, enduit : chaque ajout de jour passe par pmbJour', () => {
    expect(SOL_HEAD).toContain('pmbDayGrass');
    for (const chunk of [SOL_SURFACE, SOL_FACADE]) expect(chunk).toContain('pmbJour');
    // Aucun mélange de jour qui ne soit pesé : chaque appel de pmbDayGrass est sous pmbJour.
    for (const line of SOL_SURFACE.split('\n').filter((l) => l.includes('pmbDayGrass'))) expect(line).toContain('pmbJour');
  });

  it('les matières des rôles se compilent avec l’uniforme de jour', () => {
    const uniforms = createNightUniforms();
    const roles = createRoleMaterials(uniforms);
    const mur = roles.get('mur');
    expect(mur).toBeDefined();
    const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader } as unknown as WebGLProgramParametersWithUniforms;
    mur?.onBeforeCompile(shader, undefined as never);
    expect(shader.uniforms.pmbJour).toBe(uniforms.pmbJour);
    expect(shader.fragmentShader).toContain('uniform float pmbJour;');
    expect(shader.fragmentShader).toContain('pmbGlassR0');
    for (const m of roles.values()) m.dispose();
    expect(ShaderChunk.lights_fragment_begin.length).toBeGreaterThan(0);
  });
});
