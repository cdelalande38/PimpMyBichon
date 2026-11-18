// @ts-check
// Familles de sons et emplacements nommés (§ 9 du cahier des charges, LISEZ-MOI.md du dossier
// privé). Une famille de moteur est jouée par src/audio/engine/ ; une famille de bruitages
// (route, atelier, interface) est fabriquée de la même façon. Les bruitages de route sont joués en
// sortie par src/audio/sfx/ (qui joue quoi : src/data/bruitages.ts) ; ceux de l'interface (gain, dollars)
// par src/audio/sfx/interface.ts, à la fin d'une course et au garage ; ceux de l'atelier ne sont pas
// encore branchés.
//
// Un emplacement est une « boucle » (régime tenu, ambiance : bouclée sans clic) ou un « ponctuel »
// (démarrage, coup de gaz, bruitage court : début et fin adoucis). `variantes` : nombre de prises
// qu'il peut garder (les coups de gaz et les retours de flamme se jouent au hasard parmi elles).

/** @typedef {{ id: string, nom: string, genre: 'boucle' | 'ponctuel', variantes: number, cible: number }} Emplacement */
/** @typedef {{ id: string, nom: string, genre: 'moteur' | 'bruitage', dossier: string, emplacements: Emplacement[] }} Famille */

/**
 * Niveau visé à la fabrication, en dB efficaces (RMS sur les passages audibles) : le moteur monte
 * un peu avec le régime, un coup de gaz sort du ralenti. Le gain du choix s'ajoute par-dessus.
 * @param {string} id @param {string} nom @param {'boucle' | 'ponctuel'} genre @param {number} cible @param {number} [variantes]
 * @returns {Emplacement}
 */
function emplacement(id, nom, genre, cible, variantes = 1) {
  return { id, nom, genre, variantes, cible };
}

/** Emplacements d'un moteur, dans l'ordre de la page d'écoute. */
export const EMPLACEMENTS_MOTEUR = Object.freeze([
  emplacement('start', 'Démarrage', 'ponctuel', -21),
  emplacement('idle', 'Ralenti', 'boucle', -22),
  emplacement('rev', 'Coup de gaz à vide', 'ponctuel', -18, 3),
  emplacement('stop', 'Coupure', 'ponctuel', -22),
  emplacement('low', 'Régime bas tenu', 'boucle', -20),
  emplacement('mid', 'Régime moyen tenu', 'boucle', -19),
  emplacement('high', 'Régime haut tenu', 'boucle', -18),
  emplacement('sweep_up', 'Montée continue', 'ponctuel', -19),
  emplacement('sweep_down', 'Descente continue', 'ponctuel', -20),
  emplacement('backfire', 'Retour de flamme', 'ponctuel', -16, 3),
]);

/** @param {string[]} boucles @param {string[]} ponctuels @param {number} cible */
function bruitages(boucles, ponctuels, cible) {
  return [
    ...ponctuels.map((id) => emplacement(id, id.replaceAll('-', ' ').replaceAll('_', ' '), 'ponctuel', cible, 3)),
    ...boucles.map((id) => emplacement(id, id.replaceAll('-', ' '), 'boucle', cible - 4)),
  ];
}

/** @type {readonly Famille[]} */
export const FAMILLES = Object.freeze([
  { id: 'quatre-a-plat', nom: '4 cylindres à plat (la Cox)', genre: 'moteur', dossier: 'engines/quatre-a-plat', emplacements: [...EMPLACEMENTS_MOTEUR] },
  { id: 'diesel-turbo', nom: '4 cylindres turbo diesel (le van)', genre: 'moteur', dossier: 'engines/diesel-turbo', emplacements: [...EMPLACEMENTS_MOTEUR] },
  { id: 'bicylindre-v', nom: 'Bicylindre en V (le bobber)', genre: 'moteur', dossier: 'engines/bicylindre-v', emplacements: [...EMPLACEMENTS_MOTEUR] },
  { id: 'quatre-en-ligne-moto', nom: '4 cylindres en ligne de moto (la sportive)', genre: 'moteur', dossier: 'engines/quatre-en-ligne-moto', emplacements: [...EMPLACEMENTS_MOTEUR] },
  { id: 'v8', nom: 'V8 (le concept, plus tard le fastback)', genre: 'moteur', dossier: 'engines/v8', emplacements: [...EMPLACEMENTS_MOTEUR] },
  {
    id: 'route',
    nom: 'Route (sortie de nuit)',
    genre: 'bruitage',
    dossier: 'sfx/route',
    emplacements: bruitages(
      ['derapage-long', 'burnout', 'roulement-sec', 'roulement-mouille', 'pluie', 'vent', 'tunnel', 'nos'],
      ['derapage-court', 'freinage', 'passage-1', 'passage-2', 'rapport', 'nos-depart', 'depart-feu', 'depart-vert', 'klaxon-1', 'klaxon-2', 'klaxon-3', 'essuie-glaces', 'clignotant', 'backfire'],
      -20,
    ),
  },
  {
    id: 'atelier',
    nom: 'Atelier (gestes du garage)',
    genre: 'bruitage',
    dossier: 'sfx/atelier',
    emplacements: bruitages(
      [],
      ['cle-a-chocs', 'cliquet', 'pistolet-peinture', 'bombe-peinture', 'raclette-sticker', 'ponceuse', 'porte-garage', 'neon-allumage', 'compresseur', 'hydraulique', 'portiere-ouverture', 'portiere-fermeture', 'capot', 'outil-pose', 'nitro_purge', 'nitro_shot'],
      -20,
    ),
  },
  {
    id: 'interface',
    nom: 'Interface (courts et discrets)',
    genre: 'bruitage',
    dossier: 'sfx/interface',
    emplacements: bruitages([], ['clic', 'valide', 'retour', 'erreur', 'photo', 'gain', 'dollars'], -26),
  },
]);

/** @param {string} id */
export function famille(id) {
  return FAMILLES.find((item) => item.id === id);
}

/**
 * Emplacement suggéré par le nom d'une découpe (`<emplacement>__<prise>.flac`) : rev1 → rev,
 * tenu-4000 → low, mid ou high selon le régime estimé, backfire → backfire. Les séquences
 * « à écouter » (contact, debut, fin, depart, roulage, passage, manoeuvres) n'ont pas d'emplacement.
 * @param {string} prefixe
 * @returns {{ emplacement: string | null, regime: number | null }}
 */
export function suggestion(prefixe) {
  const tenu = /^tenu(?:-(\d+))?$/.exec(prefixe);
  if (tenu) {
    const regime = tenu[1] ? Number(tenu[1]) : null;
    if (regime === null) return { emplacement: 'mid', regime };
    return { emplacement: regime < 3000 ? 'low' : regime < 4500 ? 'mid' : 'high', regime };
  }
  const base = prefixe.replace(/\d+$/, '').replace(/-$/, '');
  if (EMPLACEMENTS_MOTEUR.some((item) => item.id === base)) return { emplacement: base, regime: null };
  for (const item of FAMILLES) {
    if (item.genre === 'bruitage' && item.emplacements.some((slot) => slot.id === prefixe)) return { emplacement: prefixe, regime: null };
  }
  return { emplacement: null, regime: null };
}
