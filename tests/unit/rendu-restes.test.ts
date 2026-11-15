// Restes du rendu du jalon 1 : ressources du modèle préparé, préchauffage de la peinture dans
// l'état des passes réelles, exposition stable, générateur de préfiltrage gardé, reflet du sol
// sans allocation par image ; ombre du véhicule qui ne voit que lui, sonde capturée avant toute
// image, témoins de peinture amorcés hors des images (revue d).
import { readFileSync } from 'node:fs';
import {
  Color,
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
import { VEHICLES } from '../../src/data/vehicles.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { FINISHES } from '../../src/data/finishes.ts';
import { CAMERA_LAYERS, PROBE_ONLY_LAYER } from '../../src/render/layers.ts';
import { primeCutDither, programsReady, type CutDitherProgram } from '../../src/render/cutDither.ts';
import { paintWitnessPrograms, paintWitnesses, programVariants, warmPaintPrograms } from '../../src/render/paint.ts';
import { PlanarReflection } from '../../src/render/planarReflection.ts';
import { shadowCasters, shadowSize, VEHICLE_SHADOW, VehicleShadowRig } from '../../src/render/vehicleShadow.ts';

// Les modules .tsx échappent au typage des tests (tsconfig.node.json n'a pas de jsx) : import
// dynamique, et la part utile de leur interface écrite ici.
interface PreparedLike {
  root: Group;
  paints: MeshPhysicalMaterial[];
  owned: { geometries: BufferGeometry[]; materials: Array<{ name: string; addEventListener: (type: 'dispose', listener: () => void) => void }> };
}
interface BenchCarModule {
  prepare: (source: Group, vehicle: VehicleManifest) => PreparedLike;
  disposePrepared: (prepared: PreparedLike) => void;
}
interface ExposureLike {
  exposure: number;
  getFragmentShader: () => string | null;
  addEventListener: (type: 'change', listener: () => void) => void;
}
type PrecompileSeen = (gl: WebGLRenderer, root: Object3D, scene: Scene, camera: Camera, target: WebGLRenderTarget) => Set<unknown>;
type AfterPriming = (programs: readonly CutDitherProgram[], done: () => void) => () => void;
const BENCH_CAR = '../../src/scene/vehicle/VehicleModel.tsx';
/** Le modèle de banc d'essai, devenu « Le concept » du catalogue (vague 0). */
const BENCH_MODEL = VEHICLES.find((vehicle) => vehicle.wave === 0) as VehicleManifest;
const POST_CHAIN = '../../src/render/PostChain.tsx';
const PROBE = '../../src/render/ReflectionProbe.tsx';
const { prepare, disposePrepared } = (await import(/* @vite-ignore */ BENCH_CAR)) as BenchCarModule;
const { ExposureEffect } = (await import(/* @vite-ignore */ POST_CHAIN)) as { ExposureEffect: new () => ExposureLike };
const { precompileSeen, afterPriming } = (await import(/* @vite-ignore */ PROBE)) as { precompileSeen: PrecompileSeen; afterPriming: AfterPriming };

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

  it('les programmes des témoins, une fois créés, sont rendus pour être amorcés hors des images (revue d, m4)', () => {
    const { scene } = loadedModel();
    const prepared = prepare(scene, BENCH_MODEL);
    const witnesses = paintWitnesses(prepared.root, prepared.paints);
    // Programmes de three vus par la table des propriétés : partagés par clé (deux témoins, un programme).
    const used: string[] = [];
    const program = (name: string, ready = true): CutDitherProgram => ({
      isReady: () => ready,
      getUniforms: () => {
        used.push(name);
        return {};
      },
    });
    const shared = program('vernis');
    const table = new Map<unknown, { currentProgram?: CutDitherProgram }>();
    witnesses.materials.forEach((material, i) => table.set(material, { currentProgram: i === 0 ? program('mat') : shared }));
    const gl = { properties: { get: (material: unknown) => table.get(material) } };
    const programs = paintWitnessPrograms(gl as unknown as WebGLRenderer, witnesses);
    expect(programs).toHaveLength(2);
    expect(programsReady(programs)).toBe(true);
    expect(primeCutDither(programs, 0)).toBe(2);
    expect(used.sort()).toEqual(['mat', 'vernis']);
    // Un témoin jamais compilé (aucun programme) n'est pas compté.
    table.set(witnesses.materials[0], {});
    expect(paintWitnessPrograms(gl as unknown as WebGLRenderer, witnesses)).toEqual([shared]);
  });

  it('BenchCar amorce les programmes des témoins après les avoir créés, par tranches', () => {
    const source = readFileSync(new URL(BENCH_CAR, import.meta.url), 'utf8');
    const warm = source.indexOf('warmPaintPrograms(gl, witnesses');
    expect(warm).toBeGreaterThan(0);
    expect(source.indexOf('paintWitnessPrograms(gl, witnesses)', warm)).toBeGreaterThan(warm);
    expect(source).toMatch(/primeCutDither\(programs, primed, PAINT_PRIME_SLICE_MS\)/);
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
        return new Set([(object as Mesh).material]);
      },
    };
    const materials = precompileSeen(gl as unknown as WebGLRenderer, scene, scene, camera, target);
    expect(compiled.map(([object]) => object)).toEqual([seen]);
    // Matériaux compilés, rendus : la sonde en tire les programmes à amorcer avant de se poser.
    expect([...materials]).toEqual([seen.material]);
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

describe('sonde de réflexion au démarrage (revue d, m2)', () => {
  it('capture en effet de mise en page : aucune image ne part avant elle', () => {
    const source = readFileSync(new URL(PROBE, import.meta.url), 'utf8');
    const effect = source.indexOf('capture(gl, scene, pmrem');
    expect(effect).toBeGreaterThan(0);
    expect(source.lastIndexOf('useLayoutEffect(', effect)).toBeGreaterThan(source.lastIndexOf('useEffect(', effect));
  });
});

describe('nouvelle sonde posée une fois ses programmes prêts et amorcés (revue d, M1)', () => {
  it('attend la compilation, amorce chaque programme une fois, hors des images, puis pose', () => {
    vi.useFakeTimers();
    try {
      let ready = false;
      const used: number[] = [];
      const programs: CutDitherProgram[] = [0, 1, 2].map((i) => ({
        isReady: () => ready,
        getUniforms: () => {
          used.push(i);
          return {};
        },
      }));
      const done = vi.fn();
      afterPriming(programs, done);
      vi.advanceTimersByTime(500);
      expect(used).toEqual([]);
      expect(done).not.toHaveBeenCalled();
      ready = true;
      vi.advanceTimersByTime(500);
      expect(used).toEqual([0, 1, 2]);
      expect(done).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(500);
      expect(done).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('annulée (autre changement entre-temps) : rien n’est posé', () => {
    vi.useFakeTimers();
    try {
      const done = vi.fn();
      const cancel = afterPriming([{ isReady: () => true, getUniforms: () => ({}) }], done);
      cancel();
      vi.advanceTimersByTime(500);
      expect(done).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('la sonde garde l’ancienne tant que la nouvelle n’est pas posée ; posée, elle compte un calcul de plus', () => {
    const source = readFileSync(new URL(PROBE, import.meta.url), 'utf8');
    // Programmes lancés avec la nouvelle sonde le temps de la compilation, puis l'ancienne remise.
    expect(source).toMatch(/scene\.environment = next\.texture;\s*try \{\s*return precompileSeen\(/);
    expect(source).toMatch(/finally \{\s*scene\.environment = previous\.texture;/);
    expect(source).toMatch(/const materials = precompileUnder\(gl, scene, viewer, warm, target, previous\);/);
    expect(source).toMatch(/afterPriming\(pending, \(\) => \{/);
    // Sans KHR_parallel_shader_compile (rendu logiciel, e2e), pas d'attente : posée tout de suite.
    expect(source).toMatch(/if \(!precompile \|\| previous === null \|\| restored \|\| !parallel\) \{\s*put\(\);/);
    // Une sonde remplacée en cours d'amorçage laisse ses programmes à amorcer à la prochaine qui les reprend.
    expect(source).toMatch(/programsOf\(gl, materials\)\.filter\(\(program\) => unprimed\.has\(program\)\)/);
    // Le compteur que la photo surveille (elle repart à zéro) avance quand la sonde est posée.
    const put = source.slice(source.indexOf('const put = () => {'), source.indexOf('const previous = installed.current;\n    if'));
    expect(put).toMatch(/installProbe\(scene, installed, target\)/);
    expect(put).toMatch(/updates: \(state\.probe\?\.updates \?\? 0\) \+ 1/);
  });
});

/** Véhicule et meuble factices dans une pièce : le véhicule tourné, le meuble dans le plan d'ombre. */
function roomWithVehicle() {
  const world = new Scene();
  const turned = new Group();
  turned.rotation.y = -Math.PI / 2;
  const vehicle = new Group();
  const body = new Mesh(new BoxGeometry(4, 1, 2), new MeshPhysicalMaterial());
  body.position.y = 0.5;
  body.renderOrder = -2;
  const glass = new Mesh(new BoxGeometry(1, 0.4, 1.6), new MeshPhysicalMaterial({ transparent: true }));
  glass.position.set(0.3, 1.2, 0);
  const hidden = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  hidden.visible = false;
  vehicle.add(body, glass, hidden);
  turned.add(vehicle);
  // Le quad, à 1,5 m du véhicule : dans le plan d'ombre (5 × 3 m), sous sa hauteur.
  const quad = new Mesh(new BoxGeometry(1, 0.8, 1), new MeshStandardMaterial());
  quad.position.set(-2.3, 0.4, 0);
  world.add(turned, quad);
  return { world, vehicle, body, glass, hidden, quad };
}

/** Rendu factice : ce qui est dessiné, dans quelle cible, et l'état d'effacement. */
function fakeRenderer() {
  let target: WebGLRenderTarget | null = null;
  const clear = { color: new Color(0x123456), alpha: 1 };
  const calls: Array<{ kind: string; target: WebGLRenderTarget | null; scene?: Object3D; alpha?: number }> = [];
  const gl = {
    getRenderTarget: () => target,
    setRenderTarget: (next: WebGLRenderTarget | null) => {
      target = next;
    },
    getClearColor: (out: Color) => out.copy(clear.color),
    getClearAlpha: () => clear.alpha,
    setClearColor: (color: Color | number, alpha = 1) => {
      clear.color = new Color(color);
      clear.alpha = alpha;
    },
    clear: () => calls.push({ kind: 'clear', target, alpha: clear.alpha }),
    render: (scene: Object3D) => calls.push({ kind: 'render', target, scene }),
    compile: (scene: Object3D) => {
      calls.push({ kind: 'compile', target, scene });
      return new Set();
    },
  };
  return { gl, calls, clear, bound: () => target };
}

describe('ombre du véhicule (revue d, D1 et m5)', () => {
  it('ne reprend que les pièces visibles du véhicule, à leur place dans la pièce, jamais le mobilier', () => {
    const { world, vehicle, body, glass, quad } = roomWithVehicle();
    world.updateMatrixWorld();
    const rig = new VehicleShadowRig(shadowSize({ halfLength: 2, halfWidth: 1, height: 1.4 }));
    const casters = shadowCasters(vehicle, (rig as unknown as { depth: never }).depth);
    expect(casters.overrideMaterial).not.toBeNull();
    const proxies = casters.children as Mesh[];
    expect(proxies.map((proxy) => proxy.geometry)).toEqual([body.geometry, glass.geometry]);
    expect(proxies.map((proxy) => proxy.material)).toEqual([body.material, glass.material]);
    expect(proxies.map((proxy) => proxy.renderOrder)).toEqual([-2, 0]);
    expect(proxies.some((proxy) => proxy.geometry === quad.geometry)).toBe(false);
    casters.updateMatrixWorld();
    proxies.forEach((proxy, i) => expect(proxy.matrixWorld.equals([body, glass][i]!.matrixWorld)).toBe(true));
    rig.dispose();
  });

  it('rendue dans une cible vidée (transparente), sans le mobilier, puis deux flous ; état du rendu rendu tel quel', () => {
    const { world, vehicle, quad } = roomWithVehicle();
    const rig = new VehicleShadowRig(shadowSize({ halfLength: 2, halfWidth: 1, height: 1.4 }));
    world.add(rig.root);
    const { gl, calls, clear, bound } = fakeRenderer();
    rig.render(gl as unknown as WebGLRenderer, vehicle, world);
    const [first, depth, ...blurs] = calls;
    expect(first).toMatchObject({ kind: 'clear', alpha: 0 });
    expect(depth?.kind).toBe('render');
    expect(depth?.target).toBe(first?.target);
    const drawn: Object3D[] = [];
    depth?.scene?.traverse((object) => drawn.push(object));
    expect(drawn).not.toContain(quad);
    expect(drawn.filter((object) => object instanceof Mesh)).toHaveLength(2);
    // Deux flous (horizontal puis vertical), deux fois : drei, `smooth`.
    expect(blurs).toHaveLength(4);
    expect(blurs.every((call) => call.kind === 'render')).toBe(true);
    expect(blurs[3]?.target).toBe(first?.target);
    expect(bound()).toBeNull();
    expect(clear.alpha).toBe(1);
    expect(clear.color.getHex()).toBe(0x123456);
    // Deux rendus de suite : même suite d'appels (rien ne dépend de l'instant ni du décor).
    const count = calls.length;
    rig.render(gl as unknown as WebGLRenderer, vehicle, world);
    expect(calls.slice(count).map((call) => call.kind)).toEqual(calls.slice(0, count).map((call) => call.kind));
    rig.dispose();
  });

  it('même plan, même flou et même opacité que l’ancien appel à ContactShadows', () => {
    expect(VEHICLE_SHADOW).toMatchObject({ spread: [2.5, 3], blur: 2.2, opacity: 0.8, resolution: 512, smooth: true });
    const size = shadowSize({ halfLength: 2.2, halfWidth: 0.9, height: 1.45 });
    expect(size).toEqual({ width: 2.2 * 2.5, depth: 0.9 * 3, far: 1.45 });
    const rig = new VehicleShadowRig(size);
    expect(rig.root.rotation.x).toBeCloseTo(Math.PI / 2);
    expect([rig.camera.left, rig.camera.right, rig.camera.top, rig.camera.bottom, rig.camera.near, rig.camera.far]).toEqual([
      -size.width / 2,
      size.width / 2,
      size.depth / 2,
      -size.depth / 2,
      0,
      size.far,
    ]);
    const material = rig.plane.material as unknown as { transparent: boolean; opacity: number; depthWrite: boolean };
    expect(material).toMatchObject({ transparent: true, opacity: 0.8, depthWrite: false });
    // Profondeur testée : la surface la plus proche du sol, quel que soit l'ordre de dessin.
    const depth = (rig as unknown as { depth: { depthTest: boolean; depthWrite: boolean } }).depth;
    expect(depth).toMatchObject({ depthTest: true, depthWrite: true });
    rig.dispose();
  });

  it('libère ses deux cibles, son plan et ses matériaux au démontage', () => {
    const rig = new VehicleShadowRig(shadowSize({ halfLength: 2, halfWidth: 1, height: 1.4 }));
    const internals = rig as unknown as Record<string, { addEventListener: (type: 'dispose', listener: () => void) => void }>;
    const owned = ['target', 'blurTarget', 'geometry', 'depth', 'horizontal', 'vertical', 'planeMaterial'].map((key) => internals[key]!);
    const disposed = watchDispose(owned);
    rig.dispose();
    expect(disposed.size).toBe(owned.length);
  });

  it('BenchCar ne passe plus par ContactShadows de drei (toute la scène, jamais libéré)', () => {
    const source = readFileSync(new URL(BENCH_CAR, import.meta.url), 'utf8');
    expect(source).not.toMatch(/ContactShadows/);
    expect(source).toMatch(/new VehicleShadowRig\(/);
  });
});
