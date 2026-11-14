// Jalon 1, rendu cible : peinture multicouche, garage décrit en données, ambiances.
import { readFileSync } from 'node:fs';
import { ShaderLib } from 'three';
import { describe, expect, it } from 'vitest';
import { AMBIANCES } from '../../src/data/ambiances.ts';
import { FINISHES } from '../../src/data/finishes.ts';
import { colorOf, GARAGE, GARAGE_MATERIALS, type ColorKey } from '../../src/data/garage.ts';
import { CUT_ATTRIBUTE } from '../../src/render/cut.ts';
import { patchGarageShader, patchSurfaceShader } from '../../src/render/floor.ts';
import { CAMERA_LAYERS, PROBE_LAYERS, PROBE_ONLY_LAYER } from '../../src/render/layers.ts';
import { gradeColor, gradeLutData } from '../../src/render/lut.ts';
import { applyPaint, createPaintMaterial, paintUniforms, patchPaintShader } from '../../src/render/paint.ts';
import { QUALITY_PROFILES } from '../../src/render/quality.ts';

const HEX = /^#[0-9a-f]{6}$/i;

describe('peinture multicouche', () => {
  it('les repères du shader existent dans la version de three.js installée', () => {
    const shader = { vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader };
    expect(() => patchPaintShader(shader)).not.toThrow();
    expect(shader.fragmentShader).toContain('pmbFlake');
    expect(shader.fragmentShader).toContain('pmbCandyColor');
    expect(shader.vertexShader).toContain('vPmbWorld');
  });

  it('chaque finition passe par le même matériau, réglée par les données', () => {
    const material = createPaintMaterial();
    for (const item of FINISHES) {
      applyPaint(material, '#0a3a46', item);
      const uniforms = paintUniforms(material);
      expect(uniforms.flake, item.id).toBe(item.flake);
      expect(uniforms.candy, item.id).toBe(item.candy);
      expect(uniforms.flip, item.id).toBe(item.flip);
      expect(material.customProgramCacheKey(), item.id).toBe('pmb-peinture-1');
    }
  });

  it('candy, nacré et caméléon ont leur effet d’angle ; pailleté a des paillettes réglables', () => {
    const byId = Object.fromEntries(FINISHES.map((item) => [item.id, item]));
    expect(byId.candy?.candy).toBeGreaterThan(0);
    expect(byId.nacre?.iridescence).toBeGreaterThan(0);
    expect(byId.cameleon?.flip).toBeGreaterThan(0);
    expect(byId.paillete?.flake).toBeGreaterThan(0);
    expect(byId.paillete?.flakeSize).toBeGreaterThan(byId.metallise?.flakeSize ?? 0);
    expect(byId.mat?.clearcoat).toBe(0);
  });
});

describe('garage du § 4', () => {
  it('chaque source prend une couleur de chaque ambiance', () => {
    const keys = new Set<ColorKey>([
      ...GARAGE.spots.map((item) => item.color),
      ...GARAGE.strips.map((item) => item.color),
      ...GARAGE.halos.map((item) => item.color),
      ...GARAGE.signs.map((item) => item.color),
    ]);
    for (const ambiance of AMBIANCES) {
      for (const key of keys) expect(colorOf(ambiance, key), `${ambiance.id}.${key}`).toMatch(HEX);
    }
  });

  it('spots de la retombée par paires : bleu à gauche, blanc au centre, rouge à droite', () => {
    const wall = GARAGE.spots.filter((spot) => spot.wallHalo);
    expect(wall.map((spot) => spot.color)).toEqual(['spotLeft', 'spotLeft', 'spotCenter', 'spotCenter', 'spotRight', 'spotRight']);
    for (let i = 0; i < wall.length; i += 2) {
      expect(Math.abs((wall[i + 1]?.at[0] ?? 0) - (wall[i]?.at[0] ?? 0))).toBeCloseTo(0.4, 5);
    }
  });

  it('les volumes de substitut sont nommés placeholder_* et listés dans TODO_ASSETS.md', () => {
    const todo = readFileSync('TODO_ASSETS.md', 'utf8');
    const names = [...GARAGE.props.map((prop) => prop.name), ...GARAGE.panels.map((panel) => panel.name)];
    for (const name of names) {
      expect(name).toMatch(/^placeholder_[a-z0-9_]+$/);
      expect(todo, name).toContain(`\`${name}\``);
    }
  });

  it('les matériaux cités existent, les objets tiennent dans la pièce', () => {
    const { width, depth, height } = GARAGE.room;
    for (const prop of GARAGE.props) {
      for (const part of prop.parts) expect(GARAGE_MATERIALS, `${prop.name}.${part.material}`).toHaveProperty(part.material);
      expect(Math.abs(prop.at[0]), prop.name).toBeLessThanOrEqual(width / 2);
      expect(Math.abs(prop.at[2]), prop.name).toBeLessThanOrEqual(depth / 2);
      expect(prop.at[1], prop.name).toBeLessThan(height);
    }
  });
});

describe('étape B : niveaux de qualité, étalonnage, sol', () => {
  it('chaque niveau dit ce qu’il active ; l’économie garde la sonde et coupe reflet, brume, occlusion', () => {
    const { eco, standard, max } = QUALITY_PROFILES;
    expect(eco).toMatchObject({ reflection: 0, atmosphere: false, ao: false });
    expect(eco.probeSize).toBeGreaterThanOrEqual(256);
    expect(standard).toMatchObject({ reflection: 0.5, atmosphere: true, ao: false, smaa: true });
    // Étape C2 (revue de code n° 2) : plus de MSAA sur les cibles en demi-flottants ; SMAA seul.
    expect(standard.multisampling).toBe(0);
    expect(max).toMatchObject({ reflection: 1, atmosphere: true, ao: true, smaa: true, probeSize: 512 });
  });

  it('la table de correspondance est neutre sans réglage, et teinte les ombres sinon', () => {
    const neutral = { shadows: '#808080', highlights: '#808080', amount: 0, saturation: 1, contrast: 1 };
    const data = gradeLutData(neutral, 8);
    const step = 1 / 7;
    for (let i = 0; i < 8 ** 3; i += 1) {
      const r = (i % 8) * step;
      const g = (Math.floor(i / 8) % 8) * step;
      const b = Math.floor(i / 64) * step;
      expect(data[i * 4] ?? -1).toBeCloseTo(r, 5);
      expect(data[i * 4 + 1] ?? -1).toBeCloseTo(g, 5);
      expect(data[i * 4 + 2] ?? -1).toBeCloseTo(b, 5);
    }
    const bichon = AMBIANCES.find((item) => item.id === 'bichon');
    if (!bichon) throw new Error('ambiance Bichon absente');
    const [r, , b] = gradeColor(bichon.grade, 0.2, 0.2, 0.2);
    expect(b).toBeGreaterThan(r);
  });

  it('les repères du shader du sol existent dans la version de three.js installée', () => {
    const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
    expect(() => patchSurfaceShader(shader)).not.toThrow();
    expect(shader.fragmentShader).toContain('pmbHazeColor');
    expect(shader.fragmentShader).toContain('iblIrradiance *= pmbIblDiffuse');
    expect(shader.vertexShader).toContain('vPmbReflCoord');
  });

  it('le décor se prolonge, les rampes éclairent le véhicule posé nez à gauche', () => {
    const { width, depth } = GARAGE.room;
    expect(GARAGE.outside.extent).toBeGreaterThan(4 * Math.max(width, depth));
    expect(GARAGE.vehicle.turn).toBeCloseTo(Math.PI, 9);
    expect(GARAGE.lightBars.length).toBeGreaterThanOrEqual(3);
    expect(GARAGE.spots.filter((spot) => spot.beam).length).toBe(6);
    for (const ambiance of AMBIANCES) {
      expect(ambiance.night, ambiance.id).not.toBe('#000000');
      expect(ambiance.barGain, ambiance.id).toBeGreaterThan(1);
      expect(ambiance.exposure, ambiance.id).toBeGreaterThan(0);
    }
  });
});

describe('étape C1 : décor', () => {
  it('les rampes du plafond ne sont vues que de la sonde ; le haut de l’image reste calme', () => {
    expect(PROBE_LAYERS).toContain(PROBE_ONLY_LAYER);
    expect(CAMERA_LAYERS).not.toContain(PROBE_ONLY_LAYER);
  });

  it('les repères du shader du décor (coupe caméra, diffus de la sonde) existent dans three.js', () => {
    const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
    expect(() => patchGarageShader(shader, { standard: true, surface: false, additive: false })).not.toThrow();
    expect(shader.vertexShader).toContain(`attribute float ${CUT_ATTRIBUTE}`);
    expect(shader.fragmentShader).toContain('iblIrradiance *= pmbIblDiffuse');
  });

  it('pièce fermée : lambris de pin à gauche et à l’avant, rien de noir sur l’enveloppe', () => {
    expect(GARAGE.surfaces.left).toBe('pin');
    expect(GARAGE.surfaces.front).toBe('pin');
    for (const id of Object.values(GARAGE.surfaces)) expect(id).not.toMatch(/^noir/);
    expect(GARAGE.props.some((prop) => prop.parts.some((part) => part.material === 'osb'))).toBe(true);
  });

  it('coin salon dans l’angle avant-gauche, casier à quatre points bleus, rien dans la voiture', () => {
    const at = (name: string) => GARAGE.props.find((prop) => prop.name === name)?.at ?? [0, 0, 0];
    for (const name of ['placeholder_canape_a', 'placeholder_canape_b', 'placeholder_table_basse']) {
      expect(at(name)[0], name).toBeLessThan(0);
      expect(at(name)[2], name).toBeGreaterThan(0);
    }
    expect(at('placeholder_canape_a')[2]).toBeGreaterThan(GARAGE.room.depth / 2 - 0.6);
    expect(at('placeholder_canape_b')[0]).toBeLessThan(-GARAGE.room.width / 2 + 0.6);
    const casier = at('placeholder_casiers_casques');
    const dots = GARAGE.spots.filter((spot) => spot.color === 'left' && Math.abs(spot.at[2] - casier[2]) < 0.8 && spot.at[1] > casier[1]);
    expect(dots).toHaveLength(4);
    // Aucun meuble posé au sol n'a son centre dans le gabarit d'attente du véhicule.
    const body = GARAGE.vehicle.protect.waiting;
    for (const prop of GARAGE.props.filter((item) => item.at[1] === 0 && item.small !== true)) {
      const inside = Math.abs(prop.at[0]) < body.max[0] && Math.abs(prop.at[2]) < body.max[2];
      expect(inside, prop.name).toBe(false);
    }
  });

  it('« Atelier » reste un blanc neutre pour juger une teinte', () => {
    const atelier = AMBIANCES.find((item) => item.id === 'atelier');
    expect(atelier?.grade).toMatchObject({ amount: 0, saturation: 1, contrast: 1 });
    expect(atelier?.key).toBe('#ffffff');
  });
});
