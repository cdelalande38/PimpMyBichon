// Conseil d'avant course (vague U) : deux ou trois phrases qui disent au joueur si son véhicule est prêt
// pour la météo annoncée (pneus, assiette, puissance), et quoi changer. Fonction pure, sans état : le
// mode carrière l'affiche avant la course (« on lui annonce le prochain est x zone x circuit et x meteo
// afin que le joueur puisse préparer son véhicule », le commanditaire, 18 novembre 2026). Les chiffres
// viennent des mêmes données que la conduite (src/data/preparation.ts, src/data/adherence.ts).

import { computePrep } from '../data/enginePrep.ts';
import { ARTICLE_REHAUSSE, articlePneu, meilleurPneu, tenueAssiette, type BuildPreparation } from '../data/preparation.ts';
import type { VehicleManifest } from '../data/vehicleTypes.ts';
import { resolveWheels, RIDE_PRESETS, tiresFor, type TireType } from '../data/wheels.ts';
import type { Weather } from '../drive/contrat.ts';
import { engineModel, excesDe, motriciteDe, performanceDe, pousseeDepart } from '../drive/pilote.ts';

export interface OptionsConseil {
  /**
   * Ce que le joueur possède (src/state/jeu.ts, `possedeDans`) : une nouveauté pas encore débloquée est
   * conseillée « à débloquer ». Absent : tout est tenu pour acquis.
   */
  possede?: (articleId: string) => boolean;
}

/** Seuils du conseil : gain d'adhérence qui vaut un changement de pneus ou d'assiette (part). */
export const CONSEIL = {
  pneu: 0.04,
  assiette: 0.05,
  /** Vitesse où l'on juge le patinage (m/s, ≈ 40 km/h : une sortie de virage) et excès qui le rend gênant (part). */
  vitessePatinage: 11,
  excesPatinage: 0.5,
} as const;

const DANS: Readonly<Record<Weather, string>> = { sec: 'au sec', pluie: 'sous la pluie', neige: 'sur la neige' };
const ENNUI: Readonly<Record<Weather, string>> = { sec: 'manquer d’accroche au sec', pluie: 'glisser sous la pluie', neige: 'patiner sur la neige' };

const nomPneu = (tire: TireType): string => tire.nom ?? `pneus « ${tire.label} »`;
/** Espace fine insécable, entre un nombre et son unité. */
const NNBSP = '\u202f';
const pourcent = (part: number): string => `${Math.round(part * 100)}${NNBSP}%`;
const majuscule = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

function conseilPneus(vehicule: VehicleManifest, build: BuildPreparation | undefined, meteo: Weather, possede: (id: string) => boolean): string | null {
  const wheels = resolveWheels(vehicule, build);
  const actuel = wheels?.swap ? wheels.tire : null;
  if (!actuel) return null;
  const permis = (tire: TireType) => tiresFor(vehicule).some((item) => item.id === tire.id);
  const libre = (tire: TireType) => permis(tire) && possede(articlePneu(tire.id));
  const mieux = meilleurPneu(meteo, libre);
  const ideal = meilleurPneu(meteo, permis);
  const ici = actuel.tenue[meteo];
  if (mieux && mieux.id !== actuel.id && mieux.tenue[meteo] / ici - 1 >= CONSEIL.pneu) {
    return `Tes ${nomPneu(actuel)} vont ${ENNUI[meteo]} : passe aux ${nomPneu(mieux)}, ils tiennent ${pourcent(mieux.tenue[meteo] / ici - 1)} de mieux.`;
  }
  if (ideal && ideal.id !== actuel.id && ideal.tenue[meteo] / ici - 1 >= CONSEIL.pneu) {
    return `Des ${nomPneu(ideal)} tiendraient ${pourcent(ideal.tenue[meteo] / ici - 1)} de mieux ${DANS[meteo]} : ils sont à débloquer dans Roues.`;
  }
  return `Tes ${nomPneu(actuel)} sont un bon choix ${DANS[meteo]}.`;
}

function conseilAssiette(vehicule: VehicleManifest, build: BuildPreparation | undefined, meteo: Weather, possede: (id: string) => boolean): string | null {
  const wheels = resolveWheels(vehicule, build);
  if (!wheels) return null;
  const ici = tenueAssiette(wheels.ride)[meteo];
  let best = RIDE_PRESETS[0]!;
  for (const preset of RIDE_PRESETS) if (tenueAssiette(preset.value)[meteo] > tenueAssiette(best.value)[meteo]) best = preset;
  const gain = tenueAssiette(best.value)[meteo] / ici - 1;
  if (gain < CONSEIL.assiette) return null;
  const aDebloquer = best.value < 0 && !possede(ARTICLE_REHAUSSE);
  if (meteo === 'neige' && wheels.ride > 0) {
    return `Si basse, ta caisse va racler la neige : remonte-la dans Suspension${best.value < 0 ? `, rehaussée c’est encore mieux${aDebloquer ? ' (à débloquer)' : ''}` : ''}.`;
  }
  if (best.value < 0) return `Sur la neige, une assiette rehaussée passe mieux${aDebloquer ? ' : elle est à débloquer dans Suspension' : ' : règle-la dans Suspension'}.`;
  return `${majuscule(DANS[meteo])}, une assiette ${best.value >= 1 ? 'posée au sol' : 'plus basse'} vire plus à plat : règle-la dans Suspension.`;
}

function conseilPuissance(vehicule: VehicleManifest, build: BuildPreparation | undefined, meteo: Weather): string | null {
  if (meteo === 'sec') return null;
  const perf = performanceDe(vehicule, build);
  const v = CONSEIL.vitessePatinage;
  const pousse = Math.min(engineModel(perf).thrust(v, false), pousseeDepart(perf));
  if (excesDe(pousse, motriciteDe(perf, meteo)) < CONSEIL.excesPatinage) return null;
  const prep = computePrep(vehicule, build);
  if (prep && prep.gain > 0) {
    // La puissance d'origine (sans aucun poste du build), sur les pneus d'aujourd'hui : passerait-elle ?
    const origine = performanceDe(vehicule);
    const tenu = excesDe(Math.min(engineModel(origine).thrust(v, false), pousseeDepart(origine)), motriciteDe(perf, meteo)) < CONSEIL.excesPatinage;
    return `${majuscule(DANS[meteo])}, les chevaux de ta préparation moteur vont faire patiner les roues : ${tenu ? 'reviens à l’origine dans Mécanique' : 'dose l’accélérateur en sortie de virage'}.`;
  }
  return `${majuscule(DANS[meteo])}, ton moteur a plus de chevaux que tes roues n’en passent : dose l’accélérateur en sortie de virage.`;
}

/**
 * Conseil de préparation pour une course sous la météo `meteo` : deux ou trois phrases courtes, tutoyées
 * (pneus, assiette, puissance), dans cet ordre ; une seule quand tout va. `build` absent : le véhicule
 * d'origine. Les nouveautés pas encore débloquées sont dites « à débloquer » si `options.possede` est donné.
 */
export function conseilPreparation(build: BuildPreparation | undefined, vehicule: VehicleManifest, meteo: Weather, options: OptionsConseil = {}): string[] {
  const possede = options.possede ?? (() => true);
  const phrases: string[] = [];
  const pneus = conseilPneus(vehicule, build, meteo, possede);
  const assiette = conseilAssiette(vehicule, build, meteo, possede);
  const puissance = conseilPuissance(vehicule, build, meteo);
  if (pneus) phrases.push(pneus);
  if (assiette) phrases.push(assiette);
  if (puissance) phrases.push(puissance);
  if (phrases.length === 0) phrases.push(`Ta préparation tient la route ${DANS[meteo]} : rien à changer.`);
  return phrases.slice(0, 3);
}
