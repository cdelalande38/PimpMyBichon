// Restes du rendu du jalon 1 : ressources du modèle préparé, préchauffage de la peinture dans
// l'état des passes réelles, exposition stable, générateur de préfiltrage gardé, reflet du sol
// sans allocation par image.
import {
  BoxGeometry,
  BufferGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Texture,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BENCH_MODEL, type BenchModel } from '../../src/data/bench.ts';
import { FINISHES } from '../../src/data/finishes.ts';
import { CAMERA_LAYERS, PROBE_ONLY_LAYER } from '../../src/render/layers.ts';
import { paintWitnesses, programVariants, warmPaintPrograms } from '../../src/render/paint.ts';
import { PlanarReflection } from '../../src/render/planarReflection.ts';

// Les modules .tsx échappent au typage des tests (tsconfig.node.json n'a pas de jsx) : import
// dynamique, et la part utile de leur interface écrite ici.
interface PreparedLike {
  root: Group;
  paints: MeshPhysicalMaterial[];
  owned: { geometries: BufferGeometry[]; materials: Array<{ name: string; addEventListener: (type: 'dispose', listener: () => void) => void }> };
}
interface BenchCarModule {
  prepare: (source: Group, model: BenchModel) => PreparedLike;
  disposePrepared: (prepared: PreparedLike) => void;
}
interface ExposureLike {
  exposure: number;
  getFragmentShader: () => string | null;
  addEventListener: (type: 'change', listener: () => void) => void;
}
type PrecompileSeen = (gl: WebGLRenderer, root: Object3D, scene: Scene, camera: Camera, target: WebGLRenderTarget) => void;
const BENCH_CAR = '../../src/scene/bench/BenchCar.tsx';
const POST_CHAIN = '../../src/render/PostChain.tsx';
const PROBE = '../../src/render/ReflectionProbe.tsx';
const { prepare, disposePrepared } = (await import(/* @vite-ignore */ BENCH_CAR)) as BenchCarModule;
const { ExposureEffect } = (await import(/* @vite-ignore */ POST_CHAIN)) as { ExposureEffect: new () => ExposureLike };
const { precompileSeen } = (await import(/* @vite-ignore */ PROBE)) as { precompileSeen: PrecompileSeen };

/** Modèle chargé factice : ce que le cache de chargement (useLoader) garde et partage. */
function loadedModel() {
  const normalMap = new Texture();
  const logo = new Texture();
  const paint1 = new MeshPhysicalMaterial({ name: 'Paint 1 Carmine', normalMap });
  const paint2 = new MeshPhysicalMaterial({ name: 'Paint 2 Carmine' });
  const license = new MeshStandardMaterial({ name: 'License', map: logo });
  const glass = new MeshPhysicalMaterial({ name: 'Glass' });
  const geometries = [new BoxGeometry(4, 1, 2), new BoxGeometry(4, 1, 2), new BoxGeometry(1, 1, 1), new BoxGeometry(1, 1, 1), new BoxGeometry(2, 1, 1)];
  const scene = new Group();
  const [a, b, c, d, e] = geometries as unknown as [BufferGeometry, BufferGeometry, BufferGeometry, BufferGeometry, BufferGeometry];
  scene.add(new Mesh(a, paint1), new Mesh(b, paint1), new Mesh(c, paint2), new Mesh(d, license), new Mesh(e, glass));
  const shared = { geometries, materials: [paint1, paint2, license, glass], textures: [normalMap, logo] };
  return { scene, shared };
}

function watchDispose(items: ReadonlyArray<{ addEventListener: (type: 'dispose', listener: () => void) => void }>): Set<unknown> {
  const disposed = new Set<unknown>();
  for (const item of items) item.addEventListener('dispose', () => disposed.add(item));
  return disposed;
}

describe('ressources du modèle préparé (revue n° 12)', () => {
  it('libère géométries fusionnées et matériaux créés, jamais ce que le cache partage', () => {
    const { scene, shared } = loadedModel();
    const prepared = prepare(scene, BENCH_MODEL);
    // Deux pièces de la même peinture se fusionnent ; deux zones peintes ; la plaque unie.
    expect(prepared.owned.geometries).toHaveLength(1);
    expect(prepared.paints).toHaveLength(2);
    expect(prepared.owned.materials).toEqual(expect.arrayContaining(prepared.paints));
    expect(prepared.owned.materials.some((material) => material.name === 'placeholder_banc_plaque')).toBe(true);

    const keep = watchDispose([...shared.geometries, ...shared.materials, ...shared.textures]);
    const owned = watchDispose([...prepared.owned.geometries, ...prepared.owned.materials]);
    disposePrepared(prepared);
    expect(owned.size).toBe(prepared.owned.geometries.length + prepared.owned.materials.length);
    expect(keep.size).toBe(0);
    // La carte de normales reprise par la peinture reste au modèle chargé.
    expect(prepared.paints[0]?.normalMap).toBe(shared.textures[0]);
  });

  it('un second modèle préparé depuis le même cache ne dépend pas du premier, libéré', () => {
    const { scene } = loadedModel();
    const first = prepare(scene, BENCH_MODEL);
    disposePrepared(first);
    const second = prepare(scene, BENCH_MODEL);
    expect(second.paints).toHaveLength(2);
    for (const paint of second.paints) expect(first.paints).not.toContain(paint);
    expect(second.owned.geometries[0]).not.toBe(first.owned.geometries[0]);
  });
});

describe('préchauffage de la peinture', () => {
  it('un témoin par variante et par zone, sur la géométrie d’une pièce de la zone', () => {
    const { scene } = loadedModel();
    const prepared = prepare(scene, BENCH_MODEL);
    const witnesses = paintWitnesses(prepared.root, prepared.paints);
    const variants = programVariants(FINISHES);
    expect(variants.length).toBeGreaterThanOrEqual(3);
    expect(witnesses.materials).toHaveLength(variants.length * prepared.paints.length);
    // Chaque zone garde sa carte de normales (elle entre dans la clé du programme).
    expect(witnesses.materials.filter((material: MeshPhysicalMaterial) => material.normalMap !== null)).toHaveLength(variants.length);
    const combos = new Set(witnesses.materials.map((material: MeshPhysicalMaterial) => `${material.clearcoat > 0}-${material.iridescence > 0}`));
    expect(combos.size).toBe(variants.length);

    const geometries = witnesses.group.children.map((child) => (child as Mesh).geometry);
    const borrowed = watchDispose(geometries);
    const materials = watchDispose(witnesses.materials);
    witnesses.dispose();
    expect(materials.size).toBe(witnesses.materials.length);
    expect(borrowed.size).toBe(0);
  });

  it('compile avec une cible de rendu liée (clé « linéaire, sans tone mapping »), puis rend la cible d’avant', () => {
    const { scene } = loadedModel();
    const prepared = prepare(scene, BENCH_MODEL);
    const witnesses = paintWitnesses(prepared.root, prepared.paints);
    const target = new WebGLRenderTarget(1, 1);
    let bound: WebGLRenderTarget | null = null;
    const seen: Array<WebGLRenderTarget | null> = [];
    const gl = {
      getRenderTarget: () => bound,
      setRenderTarget: (next: WebGLRenderTarget | null) => {
        bound = next;
      },
      compile: vi.fn(() => {
        seen.push(bound);
        return new Set();
      }),
    };
    warmPaintPrograms(gl as unknown as WebGLRenderer, witnesses, new Group() as never, {} as never, target);
    expect(gl.compile).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([target]);
    expect(bound).toBeNull();

    // Même si la compilation échoue, la cible d'avant revient.
    gl.compile.mockImplementationOnce(() => {
      throw new Error('échec');
    });
    expect(() => warmPaintPrograms(gl as unknown as WebGLRenderer, witnesses, new Group() as never, {} as never, target)).toThrow();
    expect(bound).toBeNull();
  });
});

describe('chaîne d’image et sonde : pas de recompilation à chaque ambiance (revue n° 6)', () => {
  it('l’exposition se règle par son uniforme, sans changer le nuanceur ni signaler de changement', () => {
    const effect = new ExposureEffect();
    const shader = effect.getFragmentShader();
    expect(shader).toContain('exposure');
    const changed = vi.fn();
    effect.addEventListener('change', changed);
    effect.exposure = 0.85;
    expect(effect.exposure).toBe(0.85);
    expect(effect.getFragmentShader()).toBe(shader);
    expect(changed).not.toHaveBeenCalled();
  });

  it('le générateur de préfiltrage, gardé, a bien le cube source que la sonde libère (three installé)', () => {
    // src/render/ReflectionProbe.tsx libère après chaque capture ce champ privé de three 0.187 :
    // s'il disparaît (mise à jour de three), la mémoire du cube source resterait prise.
    const pmrem = new PMREMGenerator({} as WebGLRenderer);
    expect(Object.hasOwn(pmrem, '_sourceTarget')).toBe(true);
    expect((pmrem as unknown as { _sourceTarget: unknown })._sourceTarget).toBeNull();
    for (const name of ['_cubemapMaterial', '_ggxMaterial', '_integrationMaterial']) expect(Object.hasOwn(pmrem, name), name).toBe(true);
  });
});

describe('compilations lancées d’avance (démarrage, ambiance)', () => {
  it('seulement ce que la caméra verra : objets visibles, de ses calques ; cible liée, puis rendue', () => {
    const scene = new Scene();
    const geometry = new BoxGeometry();
    const seen = new Mesh(geometry, new MeshStandardMaterial());
    const hidden = new Mesh(geometry, new MeshStandardMaterial());
    hidden.visible = false;
    const probeOnly = new Mesh(geometry, new MeshStandardMaterial());
    probeOnly.layers.set(PROBE_ONLY_LAYER);
    const closed = new Group();
    closed.visible = false;
    const inside = new Mesh(geometry, new MeshStandardMaterial());
    closed.add(inside);
    scene.add(seen, hidden, probeOnly, closed);

    const camera = new PerspectiveCamera();
    for (const layer of CAMERA_LAYERS) camera.layers.enable(layer);
    const target = new WebGLRenderTarget(1, 1);
    let bound: WebGLRenderTarget | null = null;
    const compiled: Array<[Object3D, WebGLRenderTarget | null]> = [];
    const gl = {
      getRenderTarget: () => bound,
      setRenderTarget: (next: WebGLRenderTarget | null) => {
        bound = next;
      },
      compile: (object: Object3D) => {
        compiled.push([object, bound]);
        return new Set();
      },
    };
    precompileSeen(gl as unknown as WebGLRenderer, scene, scene, camera, target);
    expect(compiled.map(([object]) => object)).toEqual([seen]);
    expect(compiled.every(([, at]) => at === target)).toBe(true);
    expect(bound).toBeNull();
  });
});

describe('reflet du sol (revue n° 4 du lot)', () => {
  it('aucune allocation par image : ni `new` ni itérateur dans la mise à jour', () => {
    const proto = PlanarReflection.prototype as unknown as Record<string, () => void>;
    for (const name of ['update', 'mirror', 'blur']) {
      const source = String(proto[name]);
      expect(source, name).not.toMatch(/\bnew\s/);
      expect(source, name).not.toMatch(/for\s*\([^)]*\bof\b/);
    }
  });
});
