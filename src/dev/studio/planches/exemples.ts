// Planche « exemples » : trois objets composés pour éprouver le vocabulaire (canapé en coussins,
// roue, casque). Ce sont des essais du studio, pas des pièces du garage.

import type { Vec2, Vec3 } from '../../../data/garageShapes.ts';
import { objet, type ModulePlanches, type PieceStudio } from '../registre.ts';

const CUIR = { couleur: '#6b3a1e', rugosite: 0.4, metal: 0 };
const CHROME = { couleur: '#d8dbe0', rugosite: 0.12, metal: 1 };
const GOMME = { couleur: '#1b1a1d', rugosite: 0.62, metal: 0 };

// ——— Canapé : socle, pieds, trois assises, trois dossiers, deux accoudoirs (2,1 m de large) ———
const SOCLE_HAUT = 0.26;
const canape: PieceStudio[] = [
  { forme: { box: [2.1, 0.18, 0.86], bevel: 0.02 }, position: [0, 0.08 + 0.09, 0], ...CUIR },
  { forme: { box: [1.78, 0.5, 0.14], bevel: 0.03 }, position: [0, SOCLE_HAUT + 0.25, -0.36], ...CUIR },
  ...([-1, 1] as const).flatMap((sx) =>
    ([-1, 1] as const).map(
      (sz): PieceStudio => ({ forme: { cylinder: [0.025, 0.08], top: 0.018, bevel: 0.004 }, position: [sx * 0.95, 0.04, sz * 0.36], rotation: [Math.PI, 0, 0], ...CHROME }),
    ),
  ),
  ...[-0.59, 0, 0.59].map((x): PieceStudio => ({ forme: { cushion: [0.58, 0.16, 0.62], bevel: 0.045, puff: 0.02 }, position: [x, SOCLE_HAUT + 0.08, 0.1], ...CUIR })),
  ...[-0.59, 0, 0.59].map(
    (x): PieceStudio => ({ forme: { cushion: [0.58, 0.44, 0.16], bevel: 0.05, puff: 0.025 }, position: [x, SOCLE_HAUT + 0.16 + 0.2, -0.22], rotation: [-0.14, 0, 0], ...CUIR }),
  ),
  ...[-0.97, 0.97].map((x): PieceStudio => ({ forme: { cushion: [0.16, 0.36, 0.86], bevel: 0.06, puff: 0.012 }, position: [x, SOCLE_HAUT + 0.18 - 0.02, 0], ...CUIR })),
];

// ——— Roue : pneu en tore, jante tournée, cinq bâtons, écrous, cache-moyeu (axe x) ———
const RAYON_ROUE = 0.25 + 0.085;
const VOILE: Vec2[] = [
  [0, 0.075],
  [0.04, 0.075],
  [0.05, 0.062],
  [0.15, 0.045],
  [0.168, 0.052],
  [0.175, 0.04],
  [0.175, -0.07],
  [0, -0.07],
];
const tourne = (angle: number, rayon: number, x: number): Vec3 => [x, rayon * Math.cos(angle), rayon * Math.sin(angle)];
const roue: PieceStudio[] = [
  { forme: { torus: [0.25, 0.085], axis: 'x', detail: 1.5 }, ...GOMME },
  { forme: { lathe: VOILE, axis: 'x' }, couleur: '#9da2aa', rugosite: 0.3, metal: 0.9 },
  ...[-0.075, 0.075].map((x): PieceStudio => ({ forme: { torus: [0.172, 0.01], axis: 'x', detail: 2 }, position: [x, 0, 0], ...CHROME })),
  ...[0, 1, 2, 3, 4].map(
    (k): PieceStudio => ({
      forme: { box: [0.024, 0.12, 0.034], bevel: 0.008 },
      position: tourne((k * 2 * Math.PI) / 5, 0.1, 0.07),
      rotation: [(k * 2 * Math.PI) / 5, 0, 0],
      ...CHROME,
    }),
  ),
  ...[0, 1, 2, 3, 4].map(
    (k): PieceStudio => ({ forme: { cylinder: [0.008, 0.014], axis: 'x', bevel: 0.002 }, position: tourne(((k + 0.5) * 2 * Math.PI) / 5, 0.033, 0.08), ...CHROME }),
  ),
  { forme: { sphere: 0.03, scale: [0.6, 1, 1] }, position: [0.08, 0, 0], ...CHROME },
];

// ——— Casque : coque en ellipsoïde, visière bouclée en secteur, mentonnière en tore ouvert, bande ———
const ROUGE = { couleur: '#c41a1a', rugosite: 0.18, metal: 0 };
const ARC_VISIERE = 2.2;
const ARC_MENTON = 1.7;
/** Section de la visière : un arc de sphère épais de 6 mm, de −20° à +30° autour de l'équateur. */
const arcDeSphere = (rayon: number, degres: readonly number[]): Vec2[] =>
  degres.map((d) => [rayon * Math.cos((d * Math.PI) / 180), rayon * Math.sin((d * Math.PI) / 180)] as Vec2);
const ANGLES_VISIERE = [-20, -10, 0, 10, 20, 30];
const SECTION_VISIERE: Vec2[] = [...arcDeSphere(0.152, ANGLES_VISIERE), ...arcDeSphere(0.146, [...ANGLES_VISIERE].reverse())];
const casque: PieceStudio[] = [
  { forme: { sphere: 0.14, scale: [1, 1.08, 1], detail: 2 }, ...ROUGE },
  {
    forme: { lathe: [...SECTION_VISIERE, SECTION_VISIERE[0]!], arc: ARC_VISIERE },
    rotation: [0, -ARC_VISIERE / 2, 0],
    couleur: '#151820',
    rugosite: 0.05,
    metal: 0.4,
  },
  { forme: { torus: [0.128, 0.02], arc: ARC_MENTON, detail: 1.5 }, position: [0, -0.07, 0], rotation: [0, -ARC_MENTON / 2, 0], ...ROUGE },
  { forme: { torus: [0.148, 0.006], axis: 'x', arc: Math.PI * 0.8, detail: 2 }, rotation: [Math.PI, 0, 0], couleur: '#f0eee8', rugosite: 0.2, metal: 0 },
];

export const planches: ModulePlanches['planches'] = {
  exemples: [...objet([-1.2, 0, 0], canape), ...objet([0.55, RAYON_ROUE, 0.35], roue, -1), ...objet([1.25, 0.14 * 1.08, 0.5], casque, 0.9)],
};
