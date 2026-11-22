// La ligne d'échappement (§ 5.4, § 9) : ce qu'elle change au son du moteur, à la finition des sorties
// et au retour de flammes, en données. Le son des lignes traite les prises réelles du moteur
// (src/audio/engine/echappement.ts : égalisation, saturation douce, gain compensé) ; rien n'est
// synthétisé. Les flammes de la sortie de nuit : src/drive/scene/flammes.ts. La finition des sorties :
// src/scene/vehicle/echappement.ts. Le panneau : src/ui/echappement/. Les articles : src/data/articles/echappement.ts.
//
// Sauvegarde (src/data/vehicleTypes.ts, `Build`) : `parts.echappement` = identifiant de la ligne (l'origine
// n'est pas écrite ; une valeur inconnue retombe sur l'origine) ; `partPaints.echappement` = la finition
// des sorties, sous la forme d'une peinture (`finish` dit laquelle, src/data/finishes.ts).

import type { Build, Paint } from './vehicleTypes.ts';

/** Poste de `Build.parts` et de `Build.partPaints`. */
export const POSTE_ECHAPPEMENT = 'echappement';

export type LigneId = 'origine' | 'feutree' | 'sport' | 'libre';

/** Une bande d'égalisation en plateau (graves, aigus) : fréquence de coin (Hz) et gain (dB). */
export interface Plateau {
  frequence: number;
  gain: number;
}

/** Une bande en cloche (médium) : fréquence centrale (Hz), largeur (Q) et gain (dB). */
export interface Cloche {
  frequence: number;
  q: number;
  gain: number;
}

/**
 * Caractère sonore d'une ligne : un taux de lecture (`hauteur`), quatre filtres en série (plateau grave,
 * cloche du médium, plateau aigu, passe-bas), puis une saturation douce, puis un gain de sortie calculé pour
 * que le niveau ne bouge que de `niveau` dB (src/audio/engine/echappement.ts, `reglageSon`). Tout se règle
 * ici, ligne par ligne : c'est l'objet à retoucher à l'oreille.
 */
export interface SonLigne {
  /** Taux de lecture des prises du moteur (1 : tel qu'enregistré ; 0,94 : environ un demi-ton plus grave, borné à 0,85-1,05). */
  hauteur: number;
  graves: Plateau;
  medium: Cloche;
  aigus: Plateau;
  /** Passe-bas (Hz) qui étouffe le son ; absent : grand ouvert. */
  coupure?: number;
  /** Saturation douce : 0, aucune (le son passe tel quel) ; jusqu'à 2, de plus en plus rauque. */
  saturation: number;
  /** Écart de niveau voulu, en dB, une fois l'égalisation et la saturation compensées (± 4 dB au plus). */
  niveau: number;
}

/**
 * Retour de flammes à la décélération (§ 9) : après un passage à haut régime en charge, un lever de
 * pied franc fait cracher les sorties. Temps en secondes de route, régime rapporté au rupteur.
 */
export interface RetourFlammes {
  /** Régime tenu en charge, juste avant le lever de pied, rapporté au rupteur (0 à 1). */
  regimeMin: number;
  /** Chance qu'un lever de pied franc crache (0 à 1). */
  chance: number;
  /** Délai minimal entre deux jets (s). */
  attente: number;
  /** Durée d'un jet (s). */
  duree: number;
  /** Nombre de bouffées dans un jet (1 à 3). */
  salves: number;
  /** Longueur et largeur de la flamme la plus forte, en mètres. */
  longueur: number;
  largeur: number;
  /**
   * Rayon de la gerbe vue dans l'axe du jet (de la poursuite, le jet vient vers la caméra), en part de
   * sa longueur : vue de face, une flamme se lit plus large que de côté.
   */
  disque: number;
  /** Éclat du corps de la flamme et de son cœur (lumière ajoutée, sans unité) : plus fort, il sature en blanc. */
  eclat: number;
  coeur: number;
  /** Voile : part du fond que le corps de la flamme cache (lisible de jour sur la route claire). */
  voile: number;
  /** Au garage : un coup de gaz tenu au moins ce temps (s), puis lâché, fait cracher. */
  tenueGarage: number;
}

/** Bornes des réglages de la flamme (vérifiées par les tests) : lisible, sans exagération. */
export const FLAMMES_LIMITES = Object.freeze({
  longueur: { min: 0.2, max: 0.9 },
  largeur: { min: 0.04, max: 0.2 },
  disque: { min: 0, max: 0.4 },
  eclat: { min: 0.3, max: 2 },
  coeur: { min: 0, max: 1 },
  voile: { min: 0, max: 2 },
  tenueGarage: { min: 0.2, max: 2 },
});

export interface LigneEchappement {
  id: LigneId;
  /** Nom court, sur la puce. */
  label: string;
  /** Sous le nom, en quelques mots. */
  hint: string;
  /** Une phrase tutoyée : ce qu'on entend. */
  description: string;
  son: SonLigne;
  /** Présent : la ligne crache des flammes au lever de pied (si le véhicule a des sorties déclarées). */
  flammes?: RetourFlammes;
}

/** Bande neutre : aucun effet. */
const PLAT = { hauteur: 1, graves: { frequence: 120, gain: 0 }, medium: { frequence: 800, q: 0.9, gain: 0 }, aigus: { frequence: 3500, gain: 0 } } as const;

/** Les lignes, de la plus discrète à la plus libre. L'origine est la première. */
export const LIGNES_ECHAPPEMENT: readonly LigneEchappement[] = [
  {
    id: 'origine',
    label: 'Origine',
    hint: 'Comme sortie d’usine',
    description: 'Le son du moteur tel qu’il a été enregistré.',
    son: { ...PLAT, saturation: 0, niveau: 0 },
  },
  {
    id: 'feutree',
    label: 'Feutrée',
    hint: 'Discrète et sourde',
    description: 'Un gros silencieux : le haut est étouffé, le moteur ronronne plus bas.',
    son: { hauteur: 1, graves: { frequence: 110, gain: 1.5 }, medium: { frequence: 900, q: 0.8, gain: -1 }, aigus: { frequence: 2500, gain: -4 }, coupure: 2000, saturation: 0, niveau: -3.5 },
  },
  {
    id: 'sport',
    label: 'Sport',
    hint: 'Plus grave, plus ouverte',
    description: 'Plus de graves, un médium moins enfermé, des aigus qui respirent ; du grain.',
    // Retour du 22 novembre 2026 (« ça fait jouet ») : un peu plus grave (taux de lecture), plus de bas, plus de grain, plus fort.
    son: { hauteur: 0.97, graves: { frequence: 110, gain: 6 }, medium: { frequence: 450, q: 1, gain: -2 }, aigus: { frequence: 3000, gain: 2.5 }, saturation: 1, niveau: 2 },
  },
  {
    id: 'libre',
    label: 'Libre',
    hint: 'Rauque, crache des flammes',
    description: 'Sans silencieux : rauque, agressive, plus forte, et ça crache au lever de pied.',
    // La plus course, la plus agressive : un demi-ton plus bas, un gros plateau grave, la saturation au maximum.
    son: { hauteur: 0.94, graves: { frequence: 90, gain: 7 }, medium: { frequence: 1400, q: 0.8, gain: 4.5 }, aigus: { frequence: 4500, gain: 1.5 }, saturation: 2, niveau: 3.5 },
    // Vue de la poursuite, la gerbe fait jusqu'à 40 cm de large (son cœur, 25 cm) ; orangée, jaune au cœur, sans blanc brûlé.
    flammes: { regimeMin: 0.6, chance: 1, attente: 1.2, duree: 0.45, salves: 2, longueur: 0.7, largeur: 0.14, disque: 0.35, eclat: 1.15, coeur: 0.3, voile: 1.6, tenueGarage: 0.6 },
  },
];

export const LIGNE_ORIGINE = LIGNES_ECHAPPEMENT[0] as LigneEchappement;

export function ligneParId(id: string | null | undefined): LigneEchappement | undefined {
  return LIGNES_ECHAPPEMENT.find((ligne) => ligne.id === id);
}

/** Ligne montée sur un build : celle de `parts.echappement`, l'origine si elle est absente ou inconnue. */
export function ligneDe(build: Pick<Build, 'parts'> | undefined): LigneEchappement {
  return ligneParId(build?.parts?.[POSTE_ECHAPPEMENT]) ?? LIGNE_ORIGINE;
}

export type FinitionId = 'chrome' | 'noir' | 'bleui';

/** Rendu d'une finition sur les pièces de métal des sorties (matière standard : couleur, métal, rugosité). */
export interface RenduFinition {
  color: string;
  metalness: number;
  roughness: number;
  envMapIntensity: number;
}

export interface FinitionEchappement {
  id: FinitionId;
  label: string;
  hint: string;
  /** Ce qui s'écrit dans `Build.partPaints.echappement` (la finition se reconnaît à `finish`). */
  peinture: Pick<Paint, 'finish' | 'color'>;
  rendu: RenduFinition;
}

/** Finitions des sorties ; le chrome est celle d'origine (le rôle « chrome » de src/data/materialRoles.ts). */
export const FINITIONS_ECHAPPEMENT: readonly FinitionEchappement[] = [
  { id: 'chrome', label: 'Chrome', hint: 'Miroir, d’origine', peinture: { finish: 'chrome', color: '#f2f3f5' }, rendu: { color: '#f2f3f5', metalness: 1, roughness: 0.06, envMapIntensity: 1.2 } },
  { id: 'noir', label: 'Noir', hint: 'Céramique satinée', peinture: { finish: 'satine', color: '#17171a' }, rendu: { color: '#17171a', metalness: 0.35, roughness: 0.42, envMapIntensity: 0.7 } },
  { id: 'bleui', label: 'Bleui', hint: 'Titane passé au feu', peinture: { finish: 'chrome-colore', color: '#5a63c8' }, rendu: { color: '#5a63c8', metalness: 1, roughness: 0.16, envMapIntensity: 1.3 } },
];

export const FINITION_ORIGINE = FINITIONS_ECHAPPEMENT[0] as FinitionEchappement;

/** Finition des sorties d'un build : reconnue à la finition de `partPaints.echappement` ; le chrome sinon. */
export function finitionDe(build: Pick<Build, 'partPaints'> | undefined): FinitionEchappement {
  const finish = build?.partPaints?.[POSTE_ECHAPPEMENT]?.finish;
  return FINITIONS_ECHAPPEMENT.find((item) => item.peinture.finish === finish) ?? FINITION_ORIGINE;
}

/** Identifiant de l'article qui débloque une ligne (src/data/articles/echappement.ts). */
export function articleLigne(id: LigneId): string {
  return `piece-${POSTE_ECHAPPEMENT}-${id}`;
}

/** Identifiant de l'article qui débloque une finition des sorties. */
export function articleFinition(id: FinitionId): string {
  return `piece-${POSTE_ECHAPPEMENT}-finition-${id}`;
}
