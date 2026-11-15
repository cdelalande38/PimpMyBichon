// Planches du vrai mobilier du garage, tirées des fichiers de famille (src/data/garageProps/*.ts,
// chacun exporte un PROPS_<FAMILLE>) : aucun fichier à modifier quand un objet change ou s'ajoute.
//   <famille>  (salon, atelier…) : tous ses objets côte à côte, étiquette « nom · triangles » ;
//   <objet>    nom sans « placeholder_ », tirets pour les soulignés (canape-a, moto-sportive…) :
//              l'objet seul.
// Chaque objet est vu comme depuis la pièce : un objet à moins de 0,8 m d'un mur est tourné pour
// montrer la face qui regarde la pièce ; les autres gardent leur orientation dans le garage. Tous
// sont posés sur le sol du studio (les objets accrochés descendent). Pièces aux vraies matières
// (GARAGE_MATERIALS), œuvres posées (art) comprises.

import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { BACK, FRONT, GARAGE_MATERIALS, LEFT, RIGHT, type Prop } from '../../../data/garageBase.ts';
import { artSize, garageArt } from '../../../data/garageArt.ts';
import { shapeGeometry } from '../../../scene/garage/shapes.ts';
import { objet, type ModulePlanches, type PieceStudio } from '../registre.ts';

const modules = import.meta.glob<Record<string, unknown>>('../../../data/garageProps/*.ts', { eager: true });

/** Distance à un mur en deçà de laquelle un objet y est adossé. */
const ADOSSE = 0.8;
/** Écart entre objets et entre rangées de la planche d'une famille. */
const ECART = 0.4;
const ECART_RANGEES = 0.9;

/** Pièces d'un objet dans son repère (avant turn) : ses formes et ses œuvres. */
function piecesLocales(prop: Prop): PieceStudio[] {
  const pieces: PieceStudio[] = prop.parts.map((part) => ({
    forme: part,
    position: part.at,
    ...(part.rot ? { rotation: part.rot } : {}),
    couleur: GARAGE_MATERIALS[part.material].color,
    materiau: part.material,
    objet: prop.name,
  }));
  for (const slot of prop.art ?? []) {
    const item = garageArt(slot.art);
    const [w, h] = artSize(item, slot.region);
    const largeur = slot.width;
    const hauteur = (largeur * h) / w;
    pieces.push({
      forme: { box: [largeur, hauteur, 0.001] },
      position: slot.at,
      ...(slot.rot ? { rotation: slot.rot } : {}),
      couleur: item.waiting ?? '#808080',
      objet: prop.name,
      oeuvre: { art: slot.art, ...(slot.region ? { region: slot.region } : {}), largeur, hauteur },
    });
  }
  return pieces;
}

/** Boîte englobante de pièces posées (position, rotation). */
function boite(pieces: readonly PieceStudio[]): Box3 {
  const box = new Box3();
  for (const piece of pieces) {
    const matrix = new Matrix4().compose(
      new Vector3(...(piece.position ?? [0, 0, 0])),
      new Quaternion().setFromEuler(new Euler(...(piece.rotation ?? [0, 0, 0]))),
      new Vector3(1, 1, 1),
    );
    const geometry = shapeGeometry(piece.forme).applyMatrix4(matrix);
    geometry.computeBoundingBox();
    if (geometry.boundingBox) box.union(geometry.boundingBox);
    geometry.dispose();
  }
  return box;
}

/** Lacet qui tourne vers le spectateur (+z) la face d'un objet adossé qui regarde la pièce. */
function lacetDeVue(prop: Prop, locales: readonly PieceStudio[]): number {
  const centre = boite(locales).getCenter(new Vector3()).applyAxisAngle(new Vector3(0, 1, 0), prop.turn ?? 0);
  const x = prop.at[0] + centre.x;
  const z = prop.at[2] + centre.z;
  const murs: Array<[number, number, number]> = [
    [z - BACK, 0, 1],
    [FRONT - z, 0, -1],
    [x - LEFT, 1, 0],
    [RIGHT - x, -1, 0],
  ];
  const [distance, dx, dz] = murs.reduce((a, b) => (b[0] < a[0] ? b : a));
  return distance < ADOSSE ? Math.atan2(-dx, dz) : 0;
}

/** L'objet vu depuis la pièce, centré sur l'origine en x et z, posé sur le sol. */
function objetPose(prop: Prop): { pieces: PieceStudio[]; box: Box3 } {
  const locales = piecesLocales(prop);
  const tournees = objet([0, 0, 0], locales, (prop.turn ?? 0) + lacetDeVue(prop, locales));
  const box = boite(tournees);
  const centre = box.getCenter(new Vector3());
  const pieces = objet([-centre.x, -box.min.y, -centre.z], tournees);
  return { pieces, box: boite(pieces) };
}

/**
 * Objets côte à côte en rangées, les plus hauts au fond (ils ne cachent pas les autres) ; largeur
 * des rangées choisie pour une planche à peu près carrée.
 */
function rangees(props: readonly Prop[]): PieceStudio[] {
  const taille = (pose: { box: Box3 }) => pose.box.getSize(new Vector3());
  const poses = props.map(objetPose).sort((a, b) => taille(b).y - taille(a).y);
  const surface = poses.reduce((sum, pose) => sum + (taille(pose).x + ECART) * (taille(pose).z + ECART_RANGEES), 0);
  const RANGEE = Math.max(...poses.map((pose) => taille(pose).x), Math.sqrt(surface) * 1.2);
  const lignes: Array<Array<{ pieces: PieceStudio[]; box: Box3 }>> = [[]];
  let curseur = 0;
  for (const pose of poses) {
    const largeur = pose.box.max.x - pose.box.min.x;
    const ligne = lignes[lignes.length - 1]!;
    if (ligne.length > 0 && curseur + largeur > RANGEE) {
      lignes.push([pose]);
      curseur = largeur + ECART;
    } else {
      ligne.push(pose);
      curseur += largeur + ECART;
    }
  }
  const resultat: PieceStudio[] = [];
  let z = 0;
  for (const ligne of lignes) {
    const profondeur = Math.max(...ligne.map((pose) => pose.box.max.z - pose.box.min.z));
    const largeur = ligne.reduce((sum, pose) => sum + pose.box.max.x - pose.box.min.x, 0) + ECART * (ligne.length - 1);
    let x = -largeur / 2;
    for (const pose of ligne) {
      resultat.push(...objet([x - pose.box.min.x, 0, z + profondeur / 2], pose.pieces));
      x += pose.box.max.x - pose.box.min.x + ECART;
    }
    z += profondeur + ECART_RANGEES;
  }
  return resultat;
}

const planchesMobilier: ModulePlanches['planches'] = {};
for (const [chemin, module] of Object.entries(modules)) {
  const famille = /([a-z0-9-]+)\.ts$/.exec(chemin)?.[1];
  if (!famille) continue;
  const props = Object.entries(module)
    .filter(([nom, valeur]) => nom.startsWith('PROPS_') && Array.isArray(valeur))
    .flatMap(([, valeur]) => valeur as Prop[]);
  planchesMobilier[famille] = rangees(props);
  for (const prop of props) planchesMobilier[prop.name.replace(/^placeholder_/, '').replace(/_/g, '-')] = objetPose(prop).pieces;
}

export const planches = planchesMobilier;
