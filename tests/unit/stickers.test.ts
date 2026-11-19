// Stickers (§ 5.3, jalon 4, premier lot) : bibliothèque et verrous, géométrie de pose, symétrie des
// flancs, sauvegarde avec le build, zones de livrée des manifestes, shader de la livrée.
import 'fake-indexeddb/auto';
import { readdirSync, readFileSync } from 'node:fs';
import { BoxGeometry, Group, Matrix4, Mesh, MeshPhysicalMaterial, ShaderLib, Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { ARTICLES, articleParId } from '../../src/data/boutique.ts';
import { HAUTS_FAITS } from '../../src/data/hautsFaits.ts';
import { PAINT_COLORS } from '../../src/data/paintColors.ts';
import { lockHint, motifsOf, STICKER_MOTIFS, STICKER_PACKS, stickerById, stickerUnlocked, type StickerMotif } from '../../src/data/stickers.ts';
import {
  addLayer,
  duplicateLayer,
  editableZones,
  layerCorners,
  MAX_LAYERS,
  maxSize,
  mirrorLayer,
  moveLayer,
  projectionMatrix,
  projectPoint,
  removeLayer,
  sanitizeStickers,
  contrastRatio,
  setMirror,
  startColor,
  STICKER_COLOR_DARK,
  STICKER_COLOR_LIGHT,
  STICKER_MIN_CONTRAST,
  updateLayer,
  zoneFrame,
  zoneLayers,
  zonePaintColor,
  type BuildStickers,
  type LiveryZone,
  type StickerLayer,
} from '../../src/data/stickersCalques.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { patchPaintShader } from '../../src/render/paint.ts';
import { createLiveryRig, liveryLayout, liveryState, LIVERY_CELL_MAX, patchLiveryShader } from '../../src/scene/vehicle/livree.ts';
import { sanitizeBuilds, useBuilds } from '../../src/state/builds.ts';
import { handleGesture } from '../../src/ui/stickers/gestes.ts';

const MOTIFS_DIR = new URL('../../src/data/stickers/', import.meta.url);
const VEHICLES = new URL('../../public/assets/vehicles/', import.meta.url);

const FLANKS: LiveryZone[] = [
  { id: 'flanc_gauche', label: 'Flanc gauche', paints: ['carrosserie'], face: '-z', center: [0, 0.6, -0.4], size: [4, 1, 0.8] },
  { id: 'flanc_droit', label: 'Flanc droit', paints: ['carrosserie'], face: '+z', center: [0, 0.6, 0.4], size: [4, 1, 0.8], mirrorOf: 'flanc_gauche' },
  { id: 'capot', label: 'Capot', paints: ['capot'], face: '+y', center: [1.4, 0.9, 0], size: [1.2, 1, 0.8] },
];

const layer = (patch: Partial<StickerLayer> = {}): StickerLayer => ({ motif: 'numero-rond-7', x: 0.3, y: 0.5, size: 0.3, rotation: 20, flip: false, color: '#ff6a00', opacity: 1, ...patch });

describe('bibliothèque', () => {
  it('six packs aux identifiants convenus, au moins 80 motifs, des trophées hors pack', () => {
    expect(STICKER_PACKS.map((pack) => pack.id)).toEqual(['depart', 'flammes', 'course', 'atelier', 'rue', 'tapis']);
    expect(motifsOf('depart').length).toBeGreaterThanOrEqual(8);
    for (const pack of ['flammes', 'course', 'atelier', 'rue', 'tapis'] as const) expect(motifsOf(pack).length).toBeGreaterThanOrEqual(5);
    // Cahier des charges, § 5.3 : au moins 80 motifs au lancement.
    expect(STICKER_MOTIFS.length).toBeGreaterThanOrEqual(80);
    // Un trophée par article de haut fait (l'économie : `sticker-…`) : les huit de la vague S, les six de la vague U, les trois du drift (vague V).
    expect(motifsOf(null).map((motif) => motif.id)).toEqual([
      ...['or', 'series', 'propre', 'vitesse', 'glisse', 'neige', 'route', 'cartes'].map((name) => `trophee-${name}`),
      'eclair-triangle',
      'eclair-pluie',
      'aile-seule',
      'tribal-lame',
      'drapeaux-croises',
      'etincelles',
      'graffiti-fleche',
      'graffiti-gaz',
      'etoile-laurier',
    ]);
    expect(new Set(STICKER_MOTIFS.map((motif) => motif.id)).size).toBe(STICKER_MOTIFS.length);
  });

  it('chaque motif a son dessin : une seule teinte, sans texte ni image, au ratio annoncé', () => {
    const files = readdirSync(MOTIFS_DIR).filter((name) => name.endsWith('.svg'));
    expect(files.sort()).toEqual(STICKER_MOTIFS.map((motif) => `${motif.id}.svg`).sort());
    for (const motif of STICKER_MOTIFS) {
      const svg = readFileSync(new URL(`${motif.id}.svg`, MOTIFS_DIR), 'utf8');
      expect(svg, motif.id).not.toMatch(/<(text|image|script|style|use|a)\b/);
      expect(svg, motif.id).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
      for (const color of svg.matchAll(/(?:fill|stroke|stop-color)="([^"]+)"/g)) expect(['currentColor', 'none'].includes(color[1]!) || color[1]!.startsWith('url(#'), `${motif.id} : ${color[1]}`).toBe(true);
      const box = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
      expect(Number(box?.[1]) / Number(box?.[2]), motif.id).toBe(motif.ratio);
      expect(svg.length, motif.id).toBeLessThanOrEqual(12 * 1024);
    }
  });

  it('verrous : le pack Départ est offert ; un autre motif se pose si son pack ou lui-même est possédé', () => {
    const rien = () => false;
    const depart = motifsOf('depart')[0]!;
    const flamme = motifsOf('flammes')[0]!;
    const trophee = motifsOf(null)[0]!;
    expect(stickerUnlocked(depart, rien)).toBe(true);
    expect(stickerUnlocked(flamme, rien)).toBe(false);
    expect(stickerUnlocked(trophee, rien)).toBe(false);
    expect(stickerUnlocked(flamme, (article) => article === 'pack-flammes')).toBe(true);
    expect(stickerUnlocked(trophee, (article) => article === `sticker-${trophee.id}`)).toBe(true);
    expect(stickerUnlocked(flamme, (article) => article === 'pack-course')).toBe(false);
    expect(lockHint(flamme)).toContain('pack Flammes');
    expect(lockHint(trophee)).toContain('haut fait');
  });
});

describe('géométrie de pose', () => {
  it('le repère de chaque face regarde de dehors : droite × haut = normale sortante', () => {
    for (const face of ['+x', '-x', '+y', '-y', '+z', '-z'] as const) {
      const { right, up, normal } = zoneFrame(face);
      const cross = new Vector3(...right).cross(new Vector3(...up));
      expect(cross.toArray().map((value) => Math.round(value) + 0)).toEqual([...normal].map((value) => value + 0));
    }
  });

  it('flanc gauche vu de dehors : l’avant à gauche, le haut en haut, la caisse dans la profondeur', () => {
    const zone = FLANKS[0]!;
    const [xFront] = projectPoint(zone, [1.9, 0.6, -0.8]);
    const [xRear] = projectPoint(zone, [-1.9, 0.6, -0.8]);
    expect(xFront).toBeLessThan(0.1);
    expect(xRear).toBeGreaterThan(0.9);
    expect(projectPoint(zone, [0, 1.05, -0.8])[1]).toBeGreaterThan(0.9);
    // Le flanc droit est hors du cadre gauche (profondeur hors de [0, 1], du côté du dedans).
    expect(projectPoint(zone, [0, 0.6, 0.8])[2]).toBeLessThan(0);
    // Le flanc droit voit l'avant à droite.
    expect(projectPoint(FLANKS[1]!, [1.9, 0.6, 0.8])[0]).toBeGreaterThan(0.9);
  });

  it('la matrice du shader donne la même projection que le calcul direct', () => {
    for (const zone of FLANKS) {
      const matrix = new Matrix4().fromArray(projectionMatrix(zone));
      for (const point of [[0.3, 0.7, -0.6], [1.2, 1.1, 0.2], [-1.5, 0.2, 0.75]] as const) {
        const viaMatrix = new Vector3(...point).applyMatrix4(matrix).toArray();
        projectPoint(zone, point).forEach((value, index) => expect(viaMatrix[index]).toBeCloseTo(value, 9));
      }
    }
  });

  it('un motif posé tient dans sa zone ; taille, position et opacité restent bornées', () => {
    const motif = stickerById('flammes-classiques-long')!;
    const capot = FLANKS[2]!;
    const placed = addLayer([], capot, motif, '#ffffff')!;
    for (const [x, y] of layerCorners(capot, placed[0]!, motif.ratio)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
    const pushed = updateLayer(placed, 0, { x: 3, y: -1, size: 9, rotation: 270, opacity: 0 }, capot)[0]!;
    expect(pushed).toMatchObject({ x: 1, y: 0, rotation: -90, opacity: 0.2 });
    expect(pushed.size).toBeCloseTo(maxSize(capot, motif.ratio), 9);
  });

  it('seize calques au plus ; dupliquer, monter, descendre et supprimer', () => {
    const motif = stickerById('etoile-cinq-branches')!;
    let layers: StickerLayer[] = [];
    for (let i = 0; i < MAX_LAYERS; i += 1) layers = addLayer(layers, FLANKS[0]!, motif, '#ffffff')!;
    expect(addLayer(layers, FLANKS[0]!, motif, '#ffffff')).toBeNull();
    expect(duplicateLayer(layers, 0)).toBeNull();
    const two = [layer({ motif: 'a' }), layer({ motif: 'b' })];
    expect(duplicateLayer(two, 0)!.map((item) => item.motif)).toEqual(['a', 'a', 'b']);
    expect(moveLayer(two, 0, 1)).toMatchObject({ index: 1, layers: [{ motif: 'b' }, { motif: 'a' }] });
    expect(moveLayer(two, 1, 1).index).toBe(1);
    expect(removeLayer(two, 0).map((item) => item.motif)).toEqual(['b']);
  });

  it('poignée : un quart de tour dans le sens inverse des aiguilles, distance doublée', () => {
    // Écran : y vers le bas. De la droite du centre vers le haut du centre.
    const change = handleGesture({ rotation: 10, size: 0.2 }, { x: 30, y: 0 }, { x: 0, y: -60 });
    expect(change.rotation).toBeCloseTo(100, 9);
    expect(change.size).toBeCloseTo(0.4, 9);
  });
});

describe('symétrie des flancs', () => {
  it('le reflet garde la place le long du véhicule, inverse la rotation, retourne le motif sauf un lettrage', () => {
    const flamme = { texte: false } as Pick<StickerMotif, 'texte'>;
    const numero = { texte: true } as Pick<StickerMotif, 'texte'>;
    expect(mirrorLayer(layer(), flamme)).toMatchObject({ x: 0.7, y: 0.5, rotation: -20, flip: true });
    expect(mirrorLayer(layer(), numero)).toMatchObject({ x: 0.7, rotation: -20, flip: false });
  });

  it('mise par défaut : le flanc droit montre le reflet du gauche et ne se choisit pas à part', () => {
    const stickers: BuildStickers = { layers: { flanc_gauche: [layer()] } };
    expect(zoneLayers(FLANKS, stickers, 'flanc_droit')).toEqual([mirrorLayer(layer())]);
    expect(editableZones(FLANKS, stickers).map((zone) => zone.id)).toEqual(['flanc_gauche', 'capot']);
  });

  it('coupée, le flanc droit garde ce qu’il montrait ; remise, il reprend le reflet', () => {
    const on: BuildStickers = { layers: { flanc_gauche: [layer()] } };
    const off = setMirror(FLANKS, on, false);
    expect(off.mirror).toBe(false);
    expect(off.layers.flanc_droit).toEqual([mirrorLayer(layer())]);
    expect(editableZones(FLANKS, off).map((zone) => zone.id)).toEqual(['flanc_gauche', 'flanc_droit', 'capot']);
    const changed: BuildStickers = { ...off, layers: { ...off.layers, flanc_droit: [layer({ x: 0.1 })] } };
    expect(zoneLayers(FLANKS, changed, 'flanc_droit')[0]?.x).toBe(0.1);
    const back = setMirror(FLANKS, changed, true);
    expect(back.mirror).toBeUndefined();
    expect(back.layers.flanc_droit).toBeUndefined();
    expect(zoneLayers(FLANKS, back, 'flanc_droit')[0]?.x).toBeCloseTo(0.7, 9);
  });
});

describe('sauvegarde', () => {
  beforeEach(() => useBuilds.setState({ current: null, builds: {}, recents: [] }));

  it('lecture tolérante : valeurs bornées, calques illisibles écartés, seize par zone au plus', () => {
    const raw = {
      layers: {
        flanc_gauche: [{ motif: 'numero-rond-7', x: 4, y: -2, size: -1, rotation: 900, flip: 'oui', color: 'F60', opacity: 7 }, { motif: '../../x' }, 12],
        'zone invalide': [layer()],
        capot: Array.from({ length: 30 }, () => layer()),
      },
      mirror: 'non',
    };
    const kept = sanitizeStickers(raw)!;
    expect(kept.layers.flanc_gauche).toEqual([{ motif: 'numero-rond-7', x: 1, y: 0, size: 0.04, rotation: -180, flip: false, color: '#ff6600', opacity: 1 }]);
    expect(kept.layers['zone invalide']).toBeUndefined();
    expect(kept.layers.capot).toHaveLength(MAX_LAYERS);
    expect(kept.mirror).toBeUndefined();
    expect(sanitizeStickers({ layers: {} })).toBeUndefined();
    expect(sanitizeStickers({ layers: {}, mirror: false })).toEqual({ layers: {}, mirror: false });
  });

  it('les stickers vivent dans le build du véhicule et se relisent tels quels', () => {
    const stickers: BuildStickers = { layers: { flanc_gauche: [layer()], capot: [layer({ motif: 'etoile-cinq-branches', flip: true })] }, mirror: false };
    useBuilds.getState().setStickers('cox', stickers);
    const saved = JSON.parse(JSON.stringify({ current: 'cox', builds: useBuilds.getState().builds, recents: [] })) as unknown;
    expect(sanitizeBuilds(saved).builds.cox?.stickers).toEqual(stickers);
    // Un build qui n'a que des stickers est gardé ; tout retiré, il disparaît.
    expect(sanitizeBuilds(saved).builds.cox?.paints).toEqual({});
    useBuilds.getState().setStickers('cox', { layers: {} });
    expect(useBuilds.getState().builds.cox?.stickers).toBeUndefined();
  });
});

describe('zones de livrée des manifestes', () => {
  const vehicles = readdirSync(VEHICLES, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const entry of vehicles) {
    it(`${entry.name} : chaque cadre vise des zones de peinture du véhicule, une face, une taille, un jumeau existant`, () => {
      const manifest = JSON.parse(readFileSync(new URL(`${entry.name}/vehicle.json`, VEHICLES), 'utf8')) as VehicleManifest;
      const livery = manifest.livery ?? [];
      expect(livery.length, 'au moins une zone de livrée').toBeGreaterThan(0);
      const paintZones = new Set(manifest.zones.map((zone) => zone.id));
      for (const zone of livery) {
        expect(zone.paints.length).toBeGreaterThan(0);
        for (const paint of zone.paints) expect(paintZones.has(paint), `${zone.id} → ${paint}`).toBe(true);
        expect(['+x', '-x', '+y', '-y', '+z', '-z']).toContain(zone.face);
        expect(zone.center).toHaveLength(3);
        zone.size.forEach((value) => expect(value).toBeGreaterThan(0));
        if (zone.mirrorOf) expect(livery.some((item) => item.id === zone.mirrorOf && item.face !== zone.face)).toBe(true);
      }
      expect(new Set(livery.map((zone) => zone.id)).size).toBe(livery.length);
      // Une moto se décore au réservoir ; une voiture, à ses flancs.
      if (manifest.kind === 'bike') expect(livery.some((zone) => zone.paints.includes('reservoir'))).toBe(true);
      else expect(livery.some((zone) => zone.id === 'flanc_gauche') && livery.some((zone) => zone.mirrorOf === 'flanc_gauche')).toBe(true);
    });
  }
});

describe('rendu de la livrée', () => {
  it('les repères du shader existent dans la peinture de three.js, après ceux de la peinture', () => {
    const shader = { vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader };
    patchPaintShader(shader);
    patchLiveryShader(shader, 2);
    expect(shader.fragmentShader).toContain('#define PMB_LIV_N 2');
    expect(shader.fragmentShader.indexOf('pmbLivA = pmbAcc.a')).toBeLessThan(shader.fragmentShader.indexOf('metalnessFactor = mix( metalnessFactor, 0.0, pmbLivA )'));
    expect(shader.vertexShader).toContain('vPmbLivPos');
  });

  it('atlas : une cellule par cadre, sans chevauchement, 1 024 px au plus par côté', () => {
    const layout = liveryLayout(FLANKS);
    expect(layout.cells).toHaveLength(FLANKS.length);
    for (const cell of layout.cells) {
      expect(Math.max(cell.width, cell.height)).toBeLessThanOrEqual(LIVERY_CELL_MAX);
      expect(cell.x + cell.width).toBeLessThanOrEqual(layout.width);
    }
    for (const [i, a] of layout.cells.entries())
      for (const b of layout.cells.slice(i + 1)) {
        const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(apart, `${a.zone.id} / ${b.zone.id}`).toBe(true);
      }
    // Flanc de 4 m : 1 024 px, soit 4 mm par pixel.
    expect(layout.cells[0]!.width).toBe(1024);
    // Mémoire de l'atlas avec ses mipmaps.
    expect(Math.round((layout.width * layout.height * 4 * 4) / 3 / 1e6)).toBeLessThanOrEqual(4);
  });

  it('sans sticker : rien à dessiner, aucun matériau touché', () => {
    expect(liveryState(FLANKS, undefined).signature).toBe('');
    expect(liveryState(FLANKS, { layers: { flanc_gauche: [layer()] } }).layers[1]).toEqual([mirrorLayer(layer())]);
    const body = new Group();
    const material = new MeshPhysicalMaterial();
    const mesh = new Mesh(new BoxGeometry(), material);
    mesh.position.set(0.5, 0, 0);
    body.add(mesh);
    const manifest = { livery: FLANKS } as unknown as VehicleManifest;
    const rig = createLiveryRig(manifest, body, new Map([['carrosserie', material]]))!;
    expect(rig.materials).toHaveLength(1);
    expect(rig.materials[0]?.zones).toEqual([0, 1]);
    expect(rig.materials[0]?.meshToVehicle.elements[12]).toBeCloseTo(0.5, 9);
    expect(rig.texture).toBeNull();
    expect(material.customProgramCacheKey()).toBe(rig.materials[0]?.original.cacheKey.call(material));
    expect(createLiveryRig({ livery: [] } as unknown as VehicleManifest, body, new Map())).toBeNull();
  });
});

describe('rangement des 82 motifs : libre, pack à acheter ou récompense', () => {
  it('chaque motif est offert, dans un pack à vendre, ou la récompense d’un seul haut fait', () => {
    for (const motif of STICKER_MOTIFS) {
      if (motif.pack === 'depart') continue;
      if (motif.pack !== null) {
        const pack = articleParId(`pack-${motif.pack}`);
        expect(pack?.prix, `${motif.id} : pack ${motif.pack}`).toBeGreaterThan(0);
        continue;
      }
      const article = `sticker-${motif.id}`;
      expect(articleParId(article), `${motif.id} : article`).toBeDefined();
      expect(HAUTS_FAITS.filter((def) => def.recompense.articles?.includes(article)).length, `${motif.id} : haut fait`).toBe(1);
    }
  });

  it('les packs à vendre restent dans la fourchette des prix (150 à 500 $) et chaque article offert par un haut fait existe', () => {
    for (const pack of STICKER_PACKS.filter((item) => !item.gratuit)) {
      const prix = articleParId(`pack-${pack.id}`)?.prix ?? 0;
      expect(prix, pack.id).toBeGreaterThanOrEqual(150);
      expect(prix, pack.id).toBeLessThanOrEqual(500);
    }
    for (const def of HAUTS_FAITS) for (const article of def.recompense.articles ?? []) expect(ARTICLES.some((item) => item.id === article), `${def.id} → ${article}`).toBe(true);
    // Les prix existants ne bougent pas.
    expect(['pack-flammes', 'pack-course', 'pack-atelier'].map((id) => articleParId(id)?.prix)).toEqual([150, 300, 500]);
  });

  it('au moins quatre motifs de plus sont offerts, et six récompenses de plus se gagnent avec des hauts faits qui ne donnaient que des dollars', () => {
    expect(motifsOf('depart').length).toBeGreaterThanOrEqual(14);
    expect(motifsOf(null).length).toBe(17);
    const sansArticle = ['vitesse-160', 'sous-la-pluie', 'dix-kilometres', 'nos-vingt', 'carriere-bouclee', 'cinq-records'];
    for (const id of sansArticle) expect(HAUTS_FAITS.find((def) => def.id === id)?.recompense.articles?.length, id).toBe(1);
  });

  it('chaque libellé est unique et en français soigné (majuscule, pas de trait d’union en tête)', () => {
    const labels = STICKER_MOTIFS.map((motif) => motif.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label, label).toMatch(/^\p{Lu}/u);
  });
});

describe('couleur de départ d’un sticker', () => {
  const noir = '#0b0b0e';
  const blanc = '#f0efe9';

  it('blanc cassé sur une peinture sombre, noir sur une peinture claire', () => {
    expect(startColor(noir)).toBe(STICKER_COLOR_LIGHT);
    expect(startColor('#0a3a46')).toBe(STICKER_COLOR_LIGHT);
    expect(startColor('#b0121c')).toBe(STICKER_COLOR_LIGHT);
    expect(startColor(blanc)).toBe(STICKER_COLOR_DARK);
    expect(startColor('#e6dcc0')).toBe(STICKER_COLOR_DARK);
    expect(startColor('#ff6a00')).toBe(STICKER_COLOR_DARK);
  });

  it('sur chaque peinture de la palette, le départ se détache d’au moins 4 pour 1', () => {
    for (const color of PAINT_COLORS) expect(contrastRatio(startColor(color.hex), color.hex), color.id).toBeGreaterThanOrEqual(4);
  });

  it('la couleur du calque qu’on règle est gardée tant qu’elle se voit, remplacée sinon', () => {
    expect(startColor('#0a3a46', '#ff6a00')).toBe('#ff6a00');
    expect(startColor(blanc, STICKER_COLOR_LIGHT)).toBe(STICKER_COLOR_DARK);
    expect(contrastRatio(STICKER_COLOR_LIGHT, blanc)).toBeLessThan(STICKER_MIN_CONTRAST);
    expect(startColor(noir, '#0b0b0e')).toBe(STICKER_COLOR_LIGHT);
  });

  it('sans peinture connue : la couleur du calque réglé, ou le blanc cassé ; une couleur illisible est ignorée', () => {
    expect(startColor(undefined)).toBe(STICKER_COLOR_LIGHT);
    expect(startColor(undefined, '#ff0000')).toBe('#ff0000');
    expect(startColor(blanc, 'pas une couleur')).toBe(STICKER_COLOR_DARK);
  });

  it('la peinture d’une zone est celle de la première zone de peinture que le build résout', () => {
    const paints = { capot: { color: '#112233' }, carrosserie: { color: '#ffffff' } };
    expect(zonePaintColor({ paints: ['inconnue', 'carrosserie', 'capot'] }, paints)).toBe('#ffffff');
    expect(zonePaintColor({ paints: ['capot'] }, paints)).toBe('#112233');
    expect(zonePaintColor({ paints: ['inconnue'] }, paints)).toBeUndefined();
  });
});
