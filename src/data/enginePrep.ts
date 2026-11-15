// Fiche de préparation du moteur (§ 5.4) : des postes et leurs options, proposés selon le moteur
// d'origine du manifeste. Des chiffres d'atelier pour le plaisir : aucune simulation mécanique,
// aucun passage au banc. Rien n'est écrit par véhicule : tout se déduit de `EngineSpec`.
// Les choix vivent dans le build, poste par poste (`Build.parts`), sous les identifiants ci-dessous.

import type { Build, EngineSpec, VehicleManifest } from './vehicleTypes.ts';

export type Boost = EngineSpec['boost'];
export type VehicleKind = VehicleManifest['kind'];

export interface PrepOption {
  /** Identifiant rangé dans le build. */
  id: string;
  /** Texte de la puce. */
  label: string;
  /** Une ligne d'atelier sous la puce. */
  hint: string;
  /**
   * Postes à multiplicateur : coefficient appliqué à la puissance d'origine, selon la
   * suralimentation d'origine (reprogrammation) ou le même pour tous (carburation).
   */
  ratio?: number | Readonly<Record<Boost, number>>;
  /** Poste nitro : chevaux ajoutés bouteille ouverte, selon qu'on prépare une voiture ou une moto. */
  shot?: Readonly<Record<VehicleKind, number>>;
}

export interface PrepSlot {
  /** Identifiant du poste dans le build. */
  id: string;
  label: string;
  /** Une ligne qui dit ce que fait le poste. */
  hint: string;
  /** Alimentations d'origine qui ouvrent le poste ; absent : tous les moteurs. */
  feeds?: readonly EngineSpec['feed'][];
  /** 'ratio' : multiplie la puissance ; 'shot' : chevaux ajoutés à part (nitro). */
  effect: 'ratio' | 'shot';
  /** Titre du chiffre préparé sur la fiche quand ce poste est proposé : « Reprogrammé ». */
  resultLabel?: string;
  /** Options montables, sans l'origine (l'origine, c'est le poste vide). */
  options: readonly PrepOption[];
}

/** Libellé de la puce qui rend un poste à son origine. */
export const ORIGIN_LABEL = 'Origine';

export const ENGINE_SLOTS: readonly PrepSlot[] = Object.freeze([
  {
    id: 'reprog',
    label: 'Reprogrammation',
    hint: 'On réécrit la carto du calculateur. Ça pousse fort sur un turbo, beaucoup moins sur un atmo.',
    feeds: ['injection'],
    effect: 'ratio',
    resultLabel: 'Reprogrammé',
    options: [
      {
        id: 'stage1',
        label: 'Stage 1',
        hint: 'Carto seule',
        ratio: { atmo: 1.05, compresseur: 1.15, turbo: 1.3 },
      },
      {
        id: 'stage2',
        label: 'Stage 2',
        hint: 'Carto, admission, ligne',
        ratio: { atmo: 1.08, compresseur: 1.25, turbo: 1.5 },
      },
      {
        id: 'stage3',
        label: 'Stage 3',
        hint: 'Gros échangeur, tout y passe',
        ratio: { atmo: 1.12, compresseur: 1.35, turbo: 1.72 },
      },
    ],
  },
  {
    id: 'carbu',
    label: 'Carburation',
    hint: 'Pas de calculateur ici : ça se règle au tournevis et aux gicleurs.',
    feeds: ['carburateur'],
    effect: 'ratio',
    resultLabel: 'Préparé',
    options: [
      { id: 'gicleurs', label: 'Gicleurs et filtre', hint: 'Filtre libre, gicleurs revus', ratio: 1.06 },
      { id: 'gros-carbu', label: 'Gros carbu', hint: 'Un corps plus gros', ratio: 1.12 },
      { id: 'double-carbu', label: 'Double carbu', hint: 'Un carbu par côté', ratio: 1.2 },
    ],
  },
  {
    id: 'nitro',
    label: 'Nitro',
    hint: 'Des chevaux en plus, bouteille ouverte seulement. Comptés à part.',
    effect: 'shot',
    options: [
      { id: 'nitro-petit', label: 'Petit kit', hint: 'Pour goûter', shot: { car: 50, bike: 15 } },
      { id: 'nitro-moyen', label: 'Kit moyen', hint: 'Ça décolle', shot: { car: 100, bike: 25 } },
      { id: 'nitro-gros', label: 'Gros kit', hint: 'Accroche-toi', shot: { car: 150, bike: 40 } },
    ],
  },
] satisfies PrepSlot[]);

/** Postes proposés pour ce moteur, dans l'ordre d'affichage. Aucun moteur : aucun poste. */
export function slotsFor(engine: EngineSpec | undefined): PrepSlot[] {
  if (!engine) return [];
  return ENGINE_SLOTS.filter((slot) => !slot.feeds || slot.feeds.includes(engine.feed));
}

/** Titre du chiffre préparé : celui du premier poste qui en donne un, sinon « Préparé ». */
export function resultLabelFor(engine: EngineSpec | undefined): string {
  return slotsFor(engine).find((slot) => slot.resultLabel)?.resultLabel ?? 'Préparé';
}

/**
 * Option montée sur un poste, lue de façon tolérante : un poste qui ne s'applique pas à ce moteur
 * ou une option inconnue (sauvegarde d'une autre version) valent l'origine.
 */
export function chosenOption(
  engine: EngineSpec | undefined,
  build: Pick<Build, 'parts'> | undefined,
  slotId: string,
): PrepOption | undefined {
  const slot = slotsFor(engine).find((item) => item.id === slotId);
  const id = build?.parts?.[slotId];
  if (!slot || id === undefined) return undefined;
  return slot.options.find((option) => option.id === id);
}

function ratioOf(option: PrepOption, boost: Boost): number {
  const { ratio } = option;
  if (typeof ratio === 'number') return ratio;
  return ratio?.[boost] ?? 1;
}

export interface EnginePrep {
  /** Puissance d'origine, en chevaux. */
  origin: number;
  /** Chevaux gagnés par la préparation, hors nitro. */
  gain: number;
  /** Puissance préparée, hors nitro, arrondie au cheval. */
  prepared: number;
  /** Chevaux ajoutés bouteille ouverte ; 0 sans kit. */
  nitro: number;
  /** Puissance bouteille ouverte. */
  withNitro: number;
}

/**
 * Chiffres de la fiche : puissance d'origine, gain, puissance préparée (arrondis au cheval) et,
 * à part, le nitro. `null` : pas de moteur déclaré.
 */
export function computePrep(
  vehicle: Pick<VehicleManifest, 'engine' | 'kind'>,
  build: Pick<Build, 'parts'> | undefined,
): EnginePrep | null {
  const { engine, kind } = vehicle;
  if (!engine || !Number.isFinite(engine.power) || engine.power <= 0) return null;
  const origin = Math.round(engine.power);
  let ratio = 1;
  let nitro = 0;
  for (const slot of slotsFor(engine)) {
    const option = chosenOption(engine, build, slot.id);
    if (!option) continue;
    if (slot.effect === 'ratio') ratio *= ratioOf(option, engine.boost);
    else nitro += option.shot?.[kind] ?? 0;
  }
  const prepared = Math.round(engine.power * ratio);
  return { origin, gain: prepared - origin, prepared, nitro, withNitro: prepared + nitro };
}

/** Libellés courts du moteur, pour la ligne d'en-tête de la fiche. */
export const FUEL_LABEL: Readonly<Record<EngineSpec['fuel'], string>> = { essence: 'essence', diesel: 'diesel' };
export const FEED_LABEL: Readonly<Record<EngineSpec['feed'], string>> = {
  carburateur: 'carburateur',
  injection: 'injection',
};
export const BOOST_LABEL: Readonly<Record<Boost, string>> = {
  atmo: 'atmosphérique',
  turbo: 'turbo',
  compresseur: 'compresseur',
};
