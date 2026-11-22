// Ligne d'échappement sur le son du moteur (§ 9 : « l'échappement choisi […] applique une égalisation
// et une saturation propres à la pièce »). Entre le bus du moteur et le limiteur (src/audio/engine/
// lecteur.ts) : plateau grave, cloche du médium, plateau aigu, passe-bas, saturation douce par courbe de
// transfert (WaveShaper), gain de sortie compensé. Ces nœuds TRAITENT les prises réelles du moteur :
// aucune source n'est créée ici et aucun échantillon n'est écrit par le code. Si un nœud ne peut pas
// être créé, le bus est relié au limiteur tel quel (repli : le son d'origine).
//
// Quelle ligne : `echappementSon`, réécrit quand le build change (src/ui/echappement/suivi.ts), relu par
// le lecteur à chaque pas (`suivre`, sans allocation : les courbes sont faites une fois par contexte).
// Les réglages viennent de src/data/echappement.ts ; la compensation de niveau est calculée ici
// (`reglageSon`), en fonctions pures testées par tests/unit/echappement-son.test.ts.

import { LIGNES_ECHAPPEMENT, LIGNE_ORIGINE, ligneParId, type SonLigne } from '../../data/echappement.ts';

/** La ligne que le moteur joue, et un tour qui change à chaque choix (le lecteur la relit). */
export const echappementSon = { ligne: LIGNE_ORIGINE.id as string, tour: 0 };

/** Choisit la ligne jouée par le moteur (identifiant inconnu : l'origine). */
export function choisirSonEchappement(id: string): void {
  const ligne = ligneParId(id)?.id ?? LIGNE_ORIGINE.id;
  if (echappementSon.ligne === ligne) return;
  echappementSon.ligne = ligne;
  echappementSon.tour += 1;
}

/**
 * Retours de flammes lancés par la scène de la sortie (src/drive/scene/flammes.ts), comptés depuis le
 * lancement : les bruitages de route jouent le claquement (emplacement `backfire`) à chaque nouveau tir.
 */
export const retourFlammes = { tirs: 0 };

/** Fréquence d'échantillonnage des calculs de réponse (celle du téléphone de référence). */
export const FS_REFERENCE = 48000;
/** Amplitude crête de référence du bus du moteur, pour mesurer ce que la saturation ajoute au niveau. */
export const AMPLITUDE_REFERENCE = 0.3;
/** Passe-bas grand ouvert (Hz) et facteur Q (dB) d'un passe-bas sans bosse (Butterworth). */
export const COUPURE_OUVERTE = 20000;
export const Q_PASSE_BAS_DB = -3.01;
/** Bornes : écart de niveau voulu (dB), saturation. */
export const NIVEAU_MAX_DB = 4;
export const SATURATION_MAX = 2;
export const HAUTEUR_MIN = 0.85;
export const HAUTEUR_MAX = 1.05;
/** Constante de temps des rampes au changement de ligne (s). */
const RAMPE = 0.06;
/** Points de la courbe de saturation (impair : le zéro tombe sur un point). */
const POINTS_COURBE = 1025;

type Biquad = 'lowshelf' | 'highshelf' | 'peaking' | 'lowpass';

/**
 * Coefficients d'un filtre biquad, formules de la spécification Web Audio (celles du « cookbook »
 * de R. Bristow-Johnson ; plateaux à pente S = 1, Q du passe-bas en dB).
 */
function coefficients(type: Biquad, frequence: number, q: number, gain: number, fs: number): [number, number, number, number, number, number] {
  const A = 10 ** (gain / 40);
  const w0 = (2 * Math.PI * Math.min(frequence, fs / 2 - 1)) / fs;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  if (type === 'lowpass') {
    const alpha = sin / (2 * 10 ** (q / 20));
    return [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
  }
  if (type === 'peaking') {
    const alpha = sin / (2 * q);
    return [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A];
  }
  const alpha = (sin / 2) * Math.SQRT2;
  const s = 2 * alpha * Math.sqrt(A);
  if (type === 'lowshelf') {
    return [A * (A + 1 - (A - 1) * cos + s), 2 * A * (A - 1 - (A + 1) * cos), A * (A + 1 - (A - 1) * cos - s), A + 1 + (A - 1) * cos + s, -2 * (A - 1 + (A + 1) * cos), A + 1 + (A - 1) * cos - s];
  }
  return [A * (A + 1 + (A - 1) * cos + s), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - s), A + 1 - (A - 1) * cos + s, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - s];
}

/** Gain (dB) d'un biquad à la fréquence `f`. */
function biquadDb(type: Biquad, frequence: number, q: number, gain: number, f: number, fs: number): number {
  const [b0, b1, b2, a0, a1, a2] = coefficients(type, frequence, q, gain, fs);
  const w = (2 * Math.PI * f) / fs;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const num = Math.hypot(b0 + b1 * c1 + b2 * c2, b1 * s1 + b2 * s2);
  const den = Math.hypot(a0 + a1 * c1 + a2 * c2, a1 * s1 + a2 * s2);
  return 20 * Math.log10(num / den);
}

/** Réponse de l'égalisation d'une ligne (les quatre filtres en série) à la fréquence `f`, en dB. */
export function reponseDb(son: SonLigne, f: number, fs = FS_REFERENCE): number {
  return (
    biquadDb('lowshelf', son.graves.frequence, 1, son.graves.gain, f, fs) +
    biquadDb('peaking', son.medium.frequence, son.medium.q, son.medium.gain, f, fs) +
    biquadDb('highshelf', son.aigus.frequence, 1, son.aigus.gain, f, fs) +
    biquadDb('lowpass', son.coupure ?? COUPURE_OUVERTE, Q_PASSE_BAS_DB, 0, f, fs)
  );
}

/** Tiers d'octave de 63 Hz à 5 kHz : là où un moteur a son énergie. */
export const TIERS_OCTAVE: readonly number[] = Array.from({ length: 20 }, (_, i) => 63 * 2 ** (i / 3));

/** Écart moyen de l'égalisation sur les tiers d'octave (dB) : ce qu'elle ajoute ou retire au niveau. */
export function egalisationMoyenne(son: SonLigne, fs = FS_REFERENCE): number {
  return TIERS_OCTAVE.reduce((sum, f) => sum + reponseDb(son, f, fs), 0) / TIERS_OCTAVE.length;
}

/** Pente de la courbe de saturation : 1 (droite) sans saturation, jusqu'à 3,5 à la saturation la plus forte. */
export function penteSaturation(saturation: number): number {
  const s = Number.isFinite(saturation) ? Math.min(SATURATION_MAX, Math.max(0, saturation)) : 0;
  return 1 + 1.25 * s;
}

/**
 * Courbe de transfert de la saturation douce : f(x) = tanh(d·x) ÷ tanh(d), bornée à ± 1 (rien ne sort
 * plus fort que la pleine échelle), impaire (pas de décalage continu). `null` sans saturation : le
 * nœud laisse passer le son tel quel.
 */
export function courbeSaturation(pente: number, points = POINTS_COURBE): Float32Array<ArrayBuffer> | null {
  if (!(pente > 1.0001)) return null;
  const courbe = new Float32Array(points);
  const norme = Math.tanh(pente);
  for (let i = 0; i < points; i += 1) {
    const x = (i / (points - 1)) * 2 - 1;
    courbe[i] = Math.tanh(pente * x) / norme;
  }
  return courbe;
}

/** Gain de la saturation sur un signal d'amplitude crête `a` (rapport sortie ÷ entrée, au sommet). */
export function gainSaturation(pente: number, a = AMPLITUDE_REFERENCE): number {
  if (!(pente > 1.0001)) return 1;
  const x = Math.min(1, Math.max(1e-6, a));
  return Math.tanh(pente * x) / Math.tanh(pente) / x;
}

/** Réglage effectif des nœuds pour une ligne. */
export interface ReglageSon {
  graves: { frequence: number; gain: number };
  medium: { frequence: number; q: number; gain: number };
  aigus: { frequence: number; gain: number };
  coupure: number;
  /** Taux de lecture des prises (1 : tel qu'enregistré), borné à HAUTEUR_MIN-HAUTEUR_MAX. */
  hauteur: number;
  /** Pente de la saturation (1 : aucune). */
  pente: number;
  /** Gain de sortie, linéaire, au plus 1 : compense l'égalisation et la saturation. */
  sortie: number;
  /** Écart de niveau attendu au signal de référence, en dB (≈ `niveau` de la ligne, borné). */
  ecartDb: number;
}

const borne = (v: number, min: number, max: number) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : 0);

/**
 * Réglage d'une ligne : filtres repris tels quels (gains bornés à ± 12 dB), saturation bornée, et gain
 * de sortie choisi pour que le niveau au signal de référence bouge de `niveau` dB (borné à ± 4 dB) :
 * sortie = niveau − égalisation moyenne − gain de la saturation, jamais au-dessus de 0 dB (la chaîne
 * n'ajoute aucun gain après la courbe, qui est bornée à la pleine échelle).
 */
export function reglageSon(son: SonLigne, fs = FS_REFERENCE): ReglageSon {
  const plat = (gain: number) => borne(gain, -12, 12);
  const graves = { frequence: borne(son.graves.frequence, 20, 1000), gain: plat(son.graves.gain) };
  const medium = { frequence: borne(son.medium.frequence, 100, 8000), q: borne(son.medium.q, 0.2, 8), gain: plat(son.medium.gain) };
  const aigus = { frequence: borne(son.aigus.frequence, 1000, 16000), gain: plat(son.aigus.gain) };
  const coupure = son.coupure === undefined ? COUPURE_OUVERTE : borne(son.coupure, 400, COUPURE_OUVERTE);
  const pente = penteSaturation(son.saturation);
  const borneSon: SonLigne = { hauteur: 1, graves, medium, aigus, coupure, saturation: son.saturation, niveau: son.niveau };
  const niveau = borne(son.niveau, -NIVEAU_MAX_DB, NIVEAU_MAX_DB);
  const saturationDb = 20 * Math.log10(gainSaturation(pente));
  const sortieDb = Math.min(0, niveau - egalisationMoyenne(borneSon, fs) - saturationDb);
  const ecartDb = sortieDb + egalisationMoyenne(borneSon, fs) + saturationDb;
  const hauteur = Number.isFinite(son.hauteur) ? Math.min(HAUTEUR_MAX, Math.max(HAUTEUR_MIN, son.hauteur)) : 1;
  return { graves, medium, aigus, coupure, hauteur, pente, sortie: 10 ** (sortieDb / 20), ecartDb };
}

/** Ce que le lecteur tient : la ligne jouée, et `suivre` à appeler à chaque pas. */
export interface ChaineEchappement {
  /** Ligne appliquée (identifiant de src/data/echappement.ts). */
  readonly ligne: string;
  /** Faux en repli (bus relié au limiteur tel quel). */
  readonly active: boolean;
  /** Taux de lecture à multiplier à celui des prises (1 : tel qu'enregistré) ; suit la ligne. */
  readonly hauteur: number;
  /** Relit `echappementSon` et applique la ligne si elle a changé (rampes ; aucune allocation). */
  suivre(): void;
}

/** Ce qu'il faut d'un contexte audio : de quoi créer les nœuds de traitement, et l'heure. */
type ContexteTraitement = Pick<BaseAudioContext, 'createBiquadFilter' | 'createWaveShaper' | 'createGain' | 'currentTime'>;

/**
 * Relie `entree` (le bus du moteur) à `sortie` (le limiteur) à travers la ligne d'échappement. Si un
 * nœud ne peut pas être créé, relie tel quel et rend une chaîne inactive (le son d'origine).
 */
export function brancherEchappement(ctx: ContexteTraitement, entree: AudioNode, sortie: AudioNode): ChaineEchappement {
  let nodes: { graves: BiquadFilterNode; medium: BiquadFilterNode; aigus: BiquadFilterNode; coupure: BiquadFilterNode; saturation: WaveShaperNode; niveau: GainNode };
  try {
    nodes = {
      graves: ctx.createBiquadFilter(),
      medium: ctx.createBiquadFilter(),
      aigus: ctx.createBiquadFilter(),
      coupure: ctx.createBiquadFilter(),
      saturation: ctx.createWaveShaper(),
      niveau: ctx.createGain(),
    };
    nodes.graves.type = 'lowshelf';
    nodes.medium.type = 'peaking';
    nodes.aigus.type = 'highshelf';
    nodes.coupure.type = 'lowpass';
    nodes.coupure.Q.value = Q_PASSE_BAS_DB;
    nodes.saturation.oversample = '2x';
  } catch {
    entree.connect(sortie);
    return { ligne: LIGNE_ORIGINE.id, active: false, hauteur: 1, suivre: () => undefined };
  }
  const { graves, medium, aigus, coupure, saturation, niveau } = nodes;
  entree.connect(graves).connect(medium).connect(aigus).connect(coupure).connect(saturation).connect(niveau).connect(sortie);
  // Réglages et courbes de chaque ligne, faits une fois.
  const reglages = new Map(LIGNES_ECHAPPEMENT.map((ligne) => {
    const reglage = reglageSon(ligne.son);
    return [ligne.id as string, { reglage, courbe: courbeSaturation(reglage.pente) }];
  }));
  const chaine = { ligne: '', active: true, hauteur: 1, tour: -1, suivre };
  const poser = (param: AudioParam, value: number, now: number, premier: boolean) => {
    param.cancelScheduledValues(now);
    if (premier) param.setValueAtTime(value, now);
    else param.setTargetAtTime(value, now, RAMPE);
  };
  function appliquer(id: string): void {
    const choix = reglages.get(id) ?? reglages.get(LIGNE_ORIGINE.id);
    if (!choix) return;
    const { reglage, courbe } = choix;
    const now = ctx.currentTime;
    const premier = chaine.ligne === '';
    poser(graves.frequency, reglage.graves.frequence, now, premier);
    poser(graves.gain, reglage.graves.gain, now, premier);
    poser(medium.frequency, reglage.medium.frequence, now, premier);
    poser(medium.Q, reglage.medium.q, now, premier);
    poser(medium.gain, reglage.medium.gain, now, premier);
    poser(aigus.frequency, reglage.aigus.frequence, now, premier);
    poser(aigus.gain, reglage.aigus.gain, now, premier);
    poser(coupure.frequency, reglage.coupure, now, premier);
    poser(niveau.gain, reglage.sortie, now, premier);
    try {
      saturation.curve = courbe;
    } catch {
      // Courbe refusée : la saturation reste celle d'avant, le gain compensé suit quand même.
    }
    chaine.hauteur = reglage.hauteur;
    chaine.ligne = id;
  }
  function suivre(): void {
    if (chaine.tour === echappementSon.tour) return;
    chaine.tour = echappementSon.tour;
    appliquer(echappementSon.ligne);
  }
  suivre();
  return chaine;
}
