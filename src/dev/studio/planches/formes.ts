// Planche « formes » : toutes les formes du vocabulaire et leurs variantes, rangées en grille.
// Matières surtout brillantes : un reflet trahit aussitôt une facette ou une couture de normales.

import type { Vec2 } from '../../../data/garageShapes.ts';
import { roundedRectContour } from '../../../scene/garage/shapes.ts';
import { grille, type ModulePlanches, type PieceStudio } from '../registre.ts';

const LAQUE = { rugosite: 0.22, metal: 0 };
const SATIN = { rugosite: 0.45, metal: 0 };
const CHROME = { couleur: '#d8dbe0', rugosite: 0.12, metal: 1 };

const PIED_DE_LAMPE: Vec2[] = [
  [0, 0],
  [0.14, 0],
  [0.14, 0.014],
  [0.05, 0.06],
  [0.03, 0.075],
  [0.03, 0.5],
  [0.045, 0.52],
  [0, 0.53],
];

const EQUERRE: Vec2[] = [
  [-0.3, -0.25],
  [0.3, -0.25],
  [0.3, -0.05],
  [-0.1, -0.05],
  [-0.1, 0.25],
  [-0.3, 0.25],
];

const FORMES: PieceStudio[] = [
  { etiquette: 'pavé d’origine', forme: { box: [0.5, 0.5, 0.5] }, couleur: '#c8372d', ...LAQUE },
  { etiquette: 'pavé arrondi 5 mm', forme: { box: [0.5, 0.5, 0.5], bevel: 0.005 }, couleur: '#c8372d', ...LAQUE },
  { etiquette: 'pavé arrondi 15 mm', forme: { box: [0.5, 0.5, 0.5], bevel: 0.015 }, couleur: '#c8372d', ...LAQUE },
  { etiquette: 'pavé arrondi 4 cm', forme: { box: [0.5, 0.5, 0.5], bevel: 0.04 }, couleur: '#c8372d', ...LAQUE },
  { etiquette: 'plateau 1,2 cm', forme: { box: [0.7, 0.03, 0.45], bevel: 0.012 }, couleur: '#2b2b30', rugosite: 0.25, metal: 0.1 },
  { etiquette: 'cylindre d’origine', forme: { cylinder: [0.22, 0.45] }, couleur: '#2f6fd6', ...LAQUE },
  { etiquette: 'tabouret (cône, 8 mm)', forme: { cylinder: [0.2, 0.06], top: 0.18, bevel: 0.008 }, couleur: '#2f6fd6', ...LAQUE },
  { etiquette: 'cylindre arrondi 3 cm, en x', forme: { cylinder: [0.18, 0.5], axis: 'x', bevel: 0.03 }, couleur: '#2f6fd6', ...LAQUE },
  { etiquette: 'cône', forme: { cylinder: [0.2, 0.45], top: 0 }, ...CHROME },
  { etiquette: 'sphère d’origine', forme: { sphere: 0.22 }, couleur: '#e0b020', ...LAQUE },
  { etiquette: 'ellipsoïde', forme: { sphere: 0.2, scale: [1, 0.7, 1.3] }, couleur: '#e0b020', ...LAQUE },
  { etiquette: 'capsule en x', forme: { capsule: [0.06, 0.6], axis: 'x' }, ...CHROME },
  { etiquette: 'capsule debout', forme: { capsule: [0.12, 0.5] }, couleur: '#1f9e6e', ...LAQUE },
  { etiquette: 'tore (pneu), en x', forme: { torus: [0.24, 0.09], axis: 'x' }, couleur: '#1b1a1d', rugosite: 0.6, metal: 0 },
  { etiquette: 'tore ouvert 270°', forme: { torus: [0.22, 0.04], arc: Math.PI * 1.5 }, ...CHROME },
  { etiquette: 'coussin d’assise', forme: { cushion: [0.6, 0.16, 0.6], bevel: 0.05, puff: 0.025 }, couleur: '#6b3a1e', rugosite: 0.4, metal: 0 },
  { etiquette: 'coussin de dossier', forme: { cushion: [0.55, 0.45, 0.16] }, couleur: '#121014', rugosite: 0.32, metal: 0 },
  { etiquette: 'pied de lampe (profil)', forme: { lathe: PIED_DE_LAMPE }, ...CHROME },
  { etiquette: 'abat-jour (profil ouvert)', forme: { lathe: [[0.2, 0], [0.12, 0.25]] }, couleur: '#efe2c8', ...SATIN },
  { etiquette: 'demi-dôme (secteur)', forme: { lathe: [[0, 0], [0.24, 0], [0.24, 0.04], [0.12, 0.2], [0, 0.22]], arc: Math.PI }, couleur: '#7a45c8', ...LAQUE },
  { etiquette: 'bague (profil bouclé)', forme: { lathe: [[0.16, 0], [0.22, 0], [0.22, 0.05], [0.16, 0.05], [0.16, 0]] }, couleur: '#7a45c8', ...LAQUE },
  { etiquette: 'écran extrudé, coins ronds', forme: { extrude: roundedRectContour(0.7, 0.42, 0.03), depth: 0.04, bevel: 0.01 }, couleur: '#141316', rugosite: 0.15, metal: 0 },
  { etiquette: 'cadre percé', forme: { extrude: roundedRectContour(0.6, 0.45, 0.02), depth: 0.05, bevel: 0.006, holes: [roundedRectContour(0.48, 0.33, 0.01)] }, couleur: '#b88a55', rugosite: 0.5, metal: 0 },
  { etiquette: 'équerre arrondie, à plat', forme: { extrude: EQUERRE, depth: 0.06, bevel: 0.02, axis: 'y' }, couleur: '#c8372d', ...LAQUE },
  { etiquette: 'tube à coudes vifs', forme: { tube: [[-0.25, 0, 0], [-0.25, 0.45, 0], [0.25, 0.45, 0], [0.25, 0.2, 0]], radius: 0.02 }, ...CHROME },
  { etiquette: 'tube à coudes ronds', forme: { tube: [[-0.25, 0, 0], [-0.25, 0.45, 0], [0.25, 0.45, 0], [0.25, 0.45, 0.3]], radius: 0.02, smooth: true }, ...CHROME },
  { etiquette: 'boucle fermée', forme: { tube: [[-0.25, 0, -0.2], [0.25, 0, -0.2], [0.25, 0, 0.2], [-0.25, 0, 0.2]], radius: 0.025, smooth: true, closed: true }, couleur: '#e85a10', ...LAQUE },
  { etiquette: 'sphère, detail 0,5', forme: { sphere: 0.18, detail: 0.5 }, couleur: '#e0b020', ...LAQUE },
  { etiquette: 'tore ouvert, detail 2', forme: { torus: [0.22, 0.04], arc: Math.PI * 1.5, detail: 2 }, ...CHROME },
  { etiquette: 'sphère, detail 2', forme: { sphere: 0.22, detail: 2 }, couleur: '#e0b020', ...LAQUE },
];

export const planches: ModulePlanches['planches'] = {
  formes: grille(FORMES, 6, 0.95),
};
