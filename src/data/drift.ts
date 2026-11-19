// Le format « Drift » de la sortie (demande du 18 novembre 2026 : « Les drift donnent des points ») : ce que
// vaut un drift, et les paliers des médailles. Le calcul est dans src/jeu/drift.ts ; la glisse elle-même (le
// coup de frein, l'angle tenu au gaz) dans src/data/adherence.ts (`DRIFT`) et src/drive/pilote.ts.
//
// Un drift : la caisse en travers d'au moins `angleMin`, à `vitesseMin` au moins. Il rapporte, chaque
// seconde, `parSeconde` points à `angleRef` et `vitesseRef`, en proportion de l'angle (compté jusqu'à
// `angleMax`) et de la vitesse (jusqu'à `vitesseMax`) : l'angle, la vitesse et la durée comptent. Il finit
// quand la caisse reste droite `tolerance` s ; plus court que `dureeMin`, il ne compte pas. Un drift qui
// commence moins de `enchainement` s après le précédent (ou qui change de côté sans se remettre droit)
// monte le multiplicateur d'un cran, jusqu'à `multMax`. Rester au bord (`bordMax` s de contact cumulé : un
// frôlement ne coûte que les points de l'instant), ou partir en tête-à-queue (au-delà de `toupie`), perd le
// drift en cours et remet le multiplicateur à 1 ; tant qu'on y est, aucun drift ne commence. Le compteur ne
// montre un drift (en cours, compté ou perdu) qu'à partir de `affichage` points : pas de « 2 » qui clignote.
//
// Paliers des médailles : simulés par `npm run courses:drift` (tools/courses/paliers-drift.mjs,
// src/drive/simulationDrift.ts) sur chaque départ de chaque carte, avec chaque véhicule du catalogue, au
// sec : une conduite de drift appliquée (manche qui suit l'axe de la route, un coup de frein, manche poussé du
// côté du virage, à l'entrée de chaque virage assez serré, plein gaz ensuite, freinage au dernier moment avant
// les virages trop vifs). Résultat versionné dans public/assets/maps/<id>/drift.json, lu ici au build ; sans ce
// fichier, le format se court, sans médaille. L'or demande de faire aussi bien que cette conduite de robot
// (au pouce, c'est un exploit ; ouvrir l'angle au manche, dans le virage, y aide), l'argent 60 % de son score,
// le bronze 30 %.

import { SURVIRAGE } from './adherence.ts';
import type { Medaille } from '../jeu/contrat.ts';

export const POINTS_DRIFT = {
  angleMin: 0.17,
  vitesseMin: 5.5,
  parSeconde: 100,
  angleRef: 0.5,
  angleMax: 1.1,
  vitesseRef: 15,
  vitesseMax: 40,
  tolerance: 0.35,
  dureeMin: 0.4,
  enchainement: 1.5,
  multMax: 5,
  toupie: SURVIRAGE.teteAQueue,
  bordMax: 0.3,
  affichage: 15,
} as const;

/**
 * Ligne d'aide du format, au départ et jusqu'au premier drift compté (retour du 19 novembre 2026 : « j'ai pas
 * compris comment ») : le geste qui fait glisser en direction libre (src/data/adherence.ts, `DRIFT`).
 */
export const AIDE_DRIFT = 'En virage\u00a0: braque, un coup sec sur FREIN, puis plein gaz\u00a0: l’arrière glisse.';

/** Part du score de référence (conduite simulée) qu'il faut pour chaque médaille, de la plus haute à la plus basse. */
export const MEDAILLES_DRIFT: readonly { id: Medaille; part: number }[] = [
  { id: 'or', part: 1 },
  { id: 'argent', part: 0.6 },
  { id: 'bronze', part: 0.3 },
];

/** Score de référence d'un départ dans drift.json : la médiane du catalogue, et par véhicule. */
export interface ReferenceDrift {
  score: number;
  vehicules: Readonly<Record<string, number>>;
}

/** public/assets/maps/<id>/drift.json, écrit par l'outil. */
export interface FichierDrift {
  format: 'pmb-drift';
  version: 1;
  /** Par départ (MapStart.id). */
  departs: Readonly<Record<string, ReferenceDrift>>;
}

const positif = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Lecture tolérante d'un drift.json : ce qui est mal formé est écarté (pas de médaille, le format se court). */
export function lireFichierDrift(raw: unknown): FichierDrift | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  if (source.format !== 'pmb-drift' || source.version !== 1) return null;
  const departs: Record<string, ReferenceDrift> = {};
  const brut = typeof source.departs === 'object' && source.departs !== null ? (source.departs as Record<string, unknown>) : {};
  for (const [depart, value] of Object.entries(brut)) {
    if (typeof value !== 'object' || value === null) continue;
    const v = value as Record<string, unknown>;
    if (!positif(v.score)) continue;
    const vehicules: Record<string, number> = {};
    if (typeof v.vehicules === 'object' && v.vehicules !== null) {
      for (const [id, score] of Object.entries(v.vehicules as Record<string, unknown>)) if (positif(score)) vehicules[id] = score;
    }
    departs[depart] = { score: v.score, vehicules };
  }
  return { format: 'pmb-drift', version: 1, departs };
}

const FICHIERS = import.meta.glob<unknown>('../../public/assets/maps/*/drift.json', { eager: true, import: 'default' });

/** Scores de référence par carte (dossier de la carte), lus au build. */
export const REFERENCES_DRIFT: Readonly<Record<string, FichierDrift>> = Object.fromEntries(
  Object.entries(FICHIERS)
    .map(([path, raw]) => [path.split('/').slice(-2)[0] ?? '', lireFichierDrift(raw)] as const)
    .filter((entry): entry is readonly [string, FichierDrift] => entry[0] !== '' && entry[1] !== null),
);

/** Score de référence d'un départ : celui du véhicule s'il a été simulé, sinon la médiane ; `null` sans référence. */
export function scoreReference(carte: string, depart: string, vehicule?: string, references: Readonly<Record<string, FichierDrift>> = REFERENCES_DRIFT): number | null {
  const ref = references[carte]?.departs[depart];
  if (!ref) return null;
  return (vehicule ? ref.vehicules[vehicule] : undefined) ?? ref.score;
}

/** Paliers des médailles (points), arrondis à la dizaine. */
export function paliersDrift(reference: number): Readonly<Record<Medaille, number>> {
  const out: Record<Medaille, number> = { or: 0, argent: 0, bronze: 0 };
  for (const item of MEDAILLES_DRIFT) out[item.id] = Math.max(10, Math.round((reference * item.part) / 10) * 10);
  return out;
}

/** Médaille d'un score ; `null` sous le bronze ou sans référence. */
export function medailleDrift(score: number, reference: number | null): Medaille | null {
  if (reference === null || !(Number.isFinite(score) && score > 0)) return null;
  const paliers = paliersDrift(reference);
  for (const item of MEDAILLES_DRIFT) if (score >= paliers[item.id]) return item.id;
  return null;
}
