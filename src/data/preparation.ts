// Préparer son véhicule pour la météo (demande du commanditaire, 18 novembre 2026 : « afin que le joueur
// puisse préparer son véhicule. Par exemple il adaptera la puissance les suspensions et les pneu en
// conséquence avant le début de la course »). Ce fichier lit, sans rien connaître d'aucun véhicule, ce que
// le build pose (pneu, largeur, assiette : src/data/wheels.ts) et en tire ce qui change sur la route
// (src/data/adherence.ts, `facteursPreparation`), plus les lignes courtes que l'atelier affiche sous
// chaque option (« Sec : +, pluie : −, neige : − − »). Tout vient des données : le comportement de
// chaque pneu est dans le catalogue des roues, l'effet de l'assiette dans `PREPARATION`.
// Le conseil d'avant course (`conseilPreparation`) est dans src/jeu/preparation.ts.

import { facteursPreparation, METEOS, PREPARATION_ORIGINE, type ParMeteo, type PreparationRoute } from './adherence.ts';
import type { Build, VehicleManifest } from './vehicleTypes.ts';
import { resolveWheels, RIDE_PRESETS, WHEEL_CATALOGUE, WHEEL_SLOTS, WHEEL_TUNE, type TireType, type WheelCatalogue } from './wheels.ts';
import type { Weather } from '../drive/contrat.ts';

/** Ce que la préparation lit d'un build (la sauvegarde ne reçoit aucun champ nouveau). */
export type BuildPreparation = Partial<Build>;

// ---------------------------------------------------------------------------------------------
// Articles (src/data/articles/preparation.ts) : les nouveautés se débloquent avec des dollars ; ce qui
// était libre (les quatre premiers pneus, les trois assiettes de toujours) le reste.

/** Article d'un pneu à débloquer : `piece-pneus-<id>` (convention de src/data/boutique.ts). */
export const articlePneu = (id: string): string => `piece-${WHEEL_SLOTS.tire}-${id}`;
/** Article d'un préréglage d'assiette à débloquer : `piece-assiette-<id>` (le poste est le curseur `assiette`). */
export const articleAssiette = (id: string): string => `piece-${WHEEL_TUNE.ride}-${id}`;
/** L'assiette rehaussée : débloque aussi le bas du curseur de hauteur (la montée). */
export const ARTICLE_REHAUSSE = articleAssiette('rehaussee');

// ---------------------------------------------------------------------------------------------
// Ce qui change sur la route.

/**
 * Préparation d'un véhicule pour la route : le pneu posé face à celui d'origine, l'écart de largeur à
 * l'origine (l'essieu qui pousse : l'avant d'une voiture, que l'arrière suit ; l'arrière d'une moto),
 * l'assiette. Un véhicule sans roues déclarées garde sa conduite d'origine ; un véhicule qui garde ses
 * roues (pas de `fit`) ne règle que son assiette.
 */
export function preparationDe(vehicle: Pick<VehicleManifest, 'kind'> & Partial<Pick<VehicleManifest, 'wheels'>>, build: BuildPreparation | undefined, catalogue: WheelCatalogue = WHEEL_CATALOGUE): PreparationRoute {
  if (!vehicle.wheels) return PREPARATION_ORIGINE;
  const wheels = resolveWheels({ kind: vehicle.kind, wheels: vehicle.wheels }, build, catalogue);
  if (!wheels) return PREPARATION_ORIGINE;
  const fit = vehicle.wheels.fit;
  const origine = fit ? (catalogue.tires.find((tire) => tire.id === fit.tire) ?? null) : null;
  const pneu = wheels.swap ? wheels.tire : null;
  let largeur = 0;
  if (fit && wheels.front && wheels.rear) {
    const bike = vehicle.kind === 'bike';
    const avant = bike ? (fit.rear ?? fit.front).width : fit.front.width;
    largeur = (bike ? wheels.rear.width : wheels.front.width) / Math.max(1, avant) - 1;
  }
  return facteursPreparation(pneu, origine, largeur, wheels.ride);
}

// ---------------------------------------------------------------------------------------------
// Lignes de l'atelier : une note par météo, de « + + » (le meilleur choix) à « − − ».

/** Une note : `++` (le meilleur, ou presque), `+`, `-`, `--`, ou `=` quand le choix ne change rien. */
export type Note = '++' | '+' | '-' | '--' | '=';
export type Notes = Readonly<Record<Weather, Note>>;

/**
 * Seuils des notes : part de la meilleure option de la même liste sous la même météo ; en deçà de
 * `egal` d'écart entre la meilleure et la moins bonne, toutes valent « = ».
 */
export const NOTES = { tresBien: 0.985, bien: 0.92, moins: 0.86, egal: 0.02 } as const;

function noter(values: readonly number[]): Note[] {
  const max = Math.max(...values);
  const min = Math.min(...values);
  return values.map((value) => {
    if (!(max > 0) || (max - min) / max < NOTES.egal) return '=';
    const part = value / max;
    if (part >= NOTES.tresBien) return '++';
    if (part >= NOTES.bien) return '+';
    if (part >= NOTES.moins) return '-';
    return '--';
  });
}

/** Notes de chaque option d'une liste, par météo, d'après sa tenue (une valeur par météo). */
function notesDe(tenues: readonly ParMeteo[]): Notes[] {
  const parMeteo = METEOS.map((meteo) => noter(tenues.map((tenue) => tenue[meteo])));
  return tenues.map((_, i) => ({ sec: parMeteo[0]![i]!, pluie: parMeteo[1]![i]!, neige: parMeteo[2]![i]! }));
}

/** Notes d'un pneu face aux autres pneus du catalogue. */
export function notesPneu(id: string, catalogue: WheelCatalogue = WHEEL_CATALOGUE): Notes | null {
  const i = catalogue.tires.findIndex((tire) => tire.id === id);
  return i < 0 ? null : (notesDe(catalogue.tires.map((tire) => tire.tenue))[i] ?? null);
}

/** Tenue d'une assiette (de −1, rehaussée, à 1, posée au sol), par météo, face à l'origine. */
export function tenueAssiette(value: number): ParMeteo {
  return facteursPreparation(null, null, 0, value).tenue;
}

/** Notes d'un préréglage d'assiette face aux autres. */
export function notesAssiette(id: string): Notes | null {
  const i = RIDE_PRESETS.findIndex((preset) => preset.id === id);
  return i < 0 ? null : (notesDe(RIDE_PRESETS.map((preset) => tenueAssiette(preset.value)))[i] ?? null);
}

/** Espace fine insécable : « − − » ne se coupe pas. */
const NNBSP = ' ';
const SIGNE: Readonly<Record<Note, string>> = { '++': `+${NNBSP}+`, '+': '+', '-': '−', '--': `−${NNBSP}−`, '=': '=' };
const MOT: Readonly<Record<Weather, string>> = { sec: 'Sec', pluie: 'pluie', neige: 'neige' };

/** « Sec : +, pluie : −, neige : − − » (deux-points précédés d'une espace fine insécable). */
export function ligneNotes(notes: Notes): string {
  return METEOS.map((meteo) => `${MOT[meteo]}${NNBSP}: ${SIGNE[notes[meteo]]}`).join(', ');
}

/** Ligne de terrain d'un pneu du catalogue (vide pour un pneu inconnu). */
export function lignePneu(id: string, catalogue: WheelCatalogue = WHEEL_CATALOGUE): string {
  const notes = notesPneu(id, catalogue);
  return notes ? ligneNotes(notes) : '';
}

/** Ligne de terrain d'un préréglage d'assiette (vide pour un préréglage inconnu). */
export function ligneAssiette(id: string): string {
  const notes = notesAssiette(id);
  return notes ? ligneNotes(notes) : '';
}

/** Pneu le mieux noté sous une météo, parmi ceux que `permis` laisse (tous par défaut). */
export function meilleurPneu(meteo: Weather, permis: (tire: TireType) => boolean = () => true, catalogue: WheelCatalogue = WHEEL_CATALOGUE): TireType | null {
  let best: TireType | null = null;
  for (const tire of catalogue.tires) if (permis(tire) && (!best || tire.tenue[meteo] > best.tenue[meteo])) best = tire;
  return best;
}
