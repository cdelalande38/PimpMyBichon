// Vague i, rendu : ombre de contact (halo, plan élargi, une passe par pose) et paillettes vues de
// loin ou sur une pièce fine. Ce qui se vérifie sans carte graphique.

import { readFileSync } from 'node:fs';
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, Scene, ShaderChunk, ShaderLib, type Object3D, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { describe, expect, it } from 'vitest';
import { finish } from '../../src/data/finishes.ts';
import { applyPaint, createPaintMaterial, FLAKE_CROWD, paintUniforms, patchPaintShader } from '../../src/render/paint.ts';
import { shadowSize, VEHICLE_SHADOW, VehicleShadowRig } from '../../src/render/vehicleShadow.ts';

/** Rendu factice : cible liée et uniformes de flou au moment de chaque passe. */
function recorder() {
  let target: WebGLRenderTarget | null = null;
  const passes: Array<{ target: WebGLRenderTarget | null; h?: number; v?: number; strength?: number }> = [];
  const gl = {
    getRenderTarget: () => target,
    setRenderTarget: (next: WebGLRenderTarget | null) => {
      target = next;
    },
    getClearColor: (out: Color) => out.set(0x000000),
    getClearAlpha: () => 1,
    setClearColor: () => undefined,
    clear: () => undefined,
    render: (scene: Object3D) => {
      const uniforms = (scene as Mesh).material ? ((scene as Mesh).material as unknown as { uniforms?: Record<string, { value: unknown }> }).uniforms : undefined;
      passes.push({ target, h: uniforms?.h?.value as number, v: uniforms?.v?.value as number, strength: uniforms?.strength?.value as number });
    },
  };
  return { gl: gl as unknown as WebGLRenderer, passes };
}

function car(): { world: Scene; vehicle: Group } {
  const world = new Scene();
  const vehicle = new Group();
  const body = new Mesh(new BoxGeometry(4, 1, 2), new MeshStandardMaterial());
  body.position.y = 0.5;
  vehicle.add(body);
  world.add(vehicle);
  return { world, vehicle };
}

describe('ombre de contact : plan, halo, libération', () => {
  it('le plan laisse au moins `margin` autour du véhicule, et garde les facteurs de drei quand ils donnent plus', () => {
    // Moto : 2,2 × 0,8 m. Les facteurs de drei ne laissaient que 0,2 m sur le côté.
    const moto = shadowSize({ halfLength: 1.1, halfWidth: 0.4, height: 1.1 });
    expect((moto.depth - 0.8) / 2).toBeCloseTo(VEHICLE_SHADOW.margin);
    expect((moto.width - 2.2) / 2).toBeGreaterThanOrEqual(VEHICLE_SHADOW.margin - 1e-9);
    // Véhicule long : 2,5 × demi-longueur l'emporte, comme avant.
    const long = shadowSize({ halfLength: 3, halfWidth: 1, height: 2 });
    expect(long.width).toBe(3 * VEHICLE_SHADOW.spread[0]);
    // Le halo tient dans le plan : sa portée (deux flous, le second de moitié) reste sous le bord.
    expect(VEHICLE_SHADOW.halo.radius * 1.5).toBeLessThan(VEHICLE_SHADOW.margin + 1e-9);
  });

  it('halo : rayon en mètres ramené à chaque côté du plan, en basse résolution, puis réuni au cœur dans la cible du plan', () => {
    const size = shadowSize({ halfLength: 1.1, halfWidth: 0.4, height: 1.1 });
    const rig = new VehicleShadowRig(size);
    const { world, vehicle } = car();
    world.add(rig.root);
    const { gl, passes } = recorder();
    rig.render(gl, vehicle, world);
    // Profondeur, quatre flous du cœur, quatre du halo, réunion.
    expect(passes).toHaveLength(10);
    const { radius, resolution, strength } = VEHICLE_SHADOW.halo;
    const halo = passes.slice(5, 9);
    expect(halo[0]?.h).toBeCloseTo(radius / 4 / size.width);
    expect(halo[1]?.v).toBeCloseTo(radius / 4 / size.depth);
    expect(halo[2]?.h).toBeCloseTo(radius / 8 / size.width);
    expect(halo.every((pass) => pass.target?.width === resolution && pass.target.height === resolution)).toBe(true);
    const combine = passes[9]!;
    expect(combine.strength).toBe(strength);
    expect(combine.target?.width).toBe(VEHICLE_SHADOW.resolution);
    expect((rig.plane.material as unknown as { map: unknown }).map).toBe(combine.target?.texture);
    rig.dispose();
  });

  it('libérée au démontage : chaque cible, le plan et les quatre matériaux, une fois chacun', () => {
    const rig = new VehicleShadowRig(shadowSize({ halfLength: 2, halfWidth: 1, height: 1.4 }));
    const counts = new Map<string, number>();
    const internals = rig as unknown as Record<string, { addEventListener: (type: 'dispose', listener: () => void) => void }>;
    const keys = ['target', 'blurTarget', 'output', 'haloTarget', 'haloBlurTarget', 'geometry', 'depth', 'horizontal', 'vertical', 'combine', 'planeMaterial'];
    for (const key of keys) internals[key]!.addEventListener('dispose', () => counts.set(key, (counts.get(key) ?? 0) + 1));
    rig.dispose();
    expect([...counts.keys()].sort()).toEqual([...keys].sort());
    expect([...counts.values()].every((count) => count === 1)).toBe(true);
  });

  it('VehicleModel : une ombre par pose (rendue sur drapeau, une fois), remontée à chaque contexte rendu, libérée au démontage', () => {
    const source = readFileSync(new URL('../../src/scene/vehicle/VehicleModel.tsx', import.meta.url), 'utf8');
    const component = source.slice(source.indexOf('function VehicleShadow('), source.indexOf('/** Intervalle'));
    expect(component).toMatch(/if \(!pending\.current\) return;\s*pending\.current = false;\s*rig\.render\(/);
    expect(component).toMatch(/useEffect\(\(\) => \(\) => rig\.dispose\(\), \[rig\]\)/);
    // Nouvelle pose (autre véhicule, autre mesure, autres roues, autre assiette, ou une pièce montée
    // qui arrive ou part, src/scene/vehicle/pieces.ts) : le drapeau se relève.
    expect(component).toMatch(/useLayoutEffect\(\(\) => \{\s*pending\.current = true;[\s\S]*\}, \[gl, rig, caster, invalidate, stamp, pieces\]\)/);
    // Le capot moteur (src/scene/vehicle/capot.ts) qui s'ouvre, se pose vitré ou se dépose relève aussi le drapeau.
    expect(source).toMatch(/<VehicleShadow key=\{epoch\} caster=\{prepared\.root\}[^>]*stamp=\{stamp\} pieces=\{`\$\{pieces\}\|\$\{capot\.signature\}`\}/);
    expect(source).toMatch(/const pieces = usePieces\(prepared, vehicle, invalidate, bodyEnv/);
  });
});

describe('paillettes vues de loin et sur une pièce fine', () => {
  const shader = { vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader };
  patchPaintShader(shader);
  const fragment = shader.fragmentShader;

  it('seuil de foule déclaré une fois, à la valeur exportée', () => {
    expect(FLAKE_CROWD).toBe(16);
    expect(fragment).toContain(`#define PMB_FLAKE_CROWD ${FLAKE_CROWD.toFixed(1)}`);
    expect(fragment.match(/PMB_FLAKE_CROWD/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('la normale non perturbée de three existe avant les paillettes (courbure lue sur elle)', () => {
    expect(ShaderChunk.normal_fragment_begin).toMatch(/vec3 nonPerturbedNormal = normal;/);
    const begin = fragment.indexOf('#include <normal_fragment_begin>');
    const flakes = fragment.indexOf('fwidth( nonPerturbedNormal )');
    expect(begin).toBeGreaterThan(-1);
    expect(flakes).toBeGreaterThan(begin);
  });

  it('dans la foule ou sur une pièce fine, l’éclat garde sa proportion (un sur huit) au lieu de points isolés', () => {
    expect(fragment).toMatch(/pmbSparkCell = mix\( 0\.12, pmbSparkCell, pmbKeep \);/);
    // L'inclinaison retirée passe en rugosité : le reflet garde sa largeur moyenne.
    expect(fragment).toMatch(/pmbTilt \* \( 1\.0 - pmbKeep \)/);
  });

  it('réglages de paillettes inchangés : métallisé 0,35 mm, pailleté 3 mm, taille propre à une zone en millimètres', () => {
    expect(finish('metallise')).toMatchObject({ flake: 0.55, flakeSize: 0.35 });
    expect(finish('paillete')).toMatchObject({ flake: 1, flakeSize: 3 });
    const material = createPaintMaterial();
    applyPaint(material, '#0a3a46', finish('paillete'), { flake: 0.4 });
    expect(paintUniforms(material).flakeSize).toBeCloseTo(0.0004);
    applyPaint(material, '#0a3a46', finish('metallise'));
    expect(paintUniforms(material).flakeSize).toBeCloseTo(0.00035);
    material.dispose();
  });
});
