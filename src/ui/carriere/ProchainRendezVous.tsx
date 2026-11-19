// L'écran de fin d'une course de carrière (contrat entre lots : une ligne, `<ProchainRendezVous />`, dans la
// colonne des gains de src/ui/drive/FinCourseVue.tsx) : le rendez-vous réussi ou manqué, dit clairement (ce
// qui manquait, de combien) ; réussi, l'annonce du suivant, pour préparer le véhicule avant d'y aller. Au
// dernier rendez-vous, une fin de carrière sobre. Course libre : rien.
// Vague V : au dernier rendez-vous d'une saison, l'annonce de la saison bouclée et de la suivante qui s'ouvre
// (avec la fiche de son premier rendez-vous) ; à la toute fin, une suite viendra (sans date). Une contrainte
// manquée se dit (« tu as poussé le NOS »), comme le temps de trop pour l'argent ou l'or.
// Les boutons (« Course suivante », « Retenter », « Rentrer au garage préparer le véhicule ») ne sont plus ici
// (retour du 18 novembre 2026 : deux retours au garage à l'écran) : un seul jeu, en bas de l'écran de fin
// (`boutonsDeFin`, src/ui/drive/FinCourseVue.tsx).
// Le verdict accompagne le bilan (src/jeu/carriereCloture.ts) : la vue reste sans état propre.

import { CONTRAINTE_LABEL, OBJECTIF_LABEL, SAISONS } from '../../data/carriere.ts';
import { formatChrono } from '../../drive/depart.ts';
import { verdictDe, type VerdictRendezVous } from '../../jeu/carriereCloture.ts';
import type { Bilan } from '../../jeu/contrat.ts';
import { useDrive } from '../../state/drive.ts';
import { dollars } from '../jeu/libelles.ts';
import { FicheRendezVous } from './FicheRendezVous.tsx';
import './carriere.css';

const ECARTS: Readonly<Record<string, string>> = { carte: 'la carte', depart: 'le départ', format: 'le format', meteo: 'la météo', moment: 'le moment', vehicule: 'le véhicule' };

/** « le bronze », « l’argent », « l’or » */
const VISEE: Readonly<Record<string, string>> = { bronze: 'le bronze', argent: 'l’argent', or: 'l’or' };

/** « 4,4 s » */
function secondes(s: number): string {
  return `${s.toFixed(1).replace('.', ',')} s`;
}

/** Titre et phrase du verdict. */
export function texteVerdict(v: VerdictRendezVous, temps: number): { titre: string; phrase: string } {
  const n = v.saisonNumero > 1 ? `${v.numero} (saison ${v.saisonNumero})` : `${v.numero}`;
  if (v.bouclee) return { titre: 'Carrière bouclée', phrase: `Toutes les saisons sont réussies. Chapeau ! Une suite viendra ; d’ici là, rejoue tes épreuves pour l’or.` };
  if (v.saisonBouclee) {
    const suivante = SAISONS[v.suivantSaison - 1];
    return {
      titre: `Saison ${v.saisonNumero} bouclée`,
      phrase: `${v.saison.titre} : les ${v.total} épreuves sont réussies.${v.prime > 0 ? ` La prime de ${dollars(v.prime)} est dans tes gains.` : ''}${suivante ? ` La saison ${v.suivantSaison}, « ${suivante.titre} », s’ouvre : ${suivante.sousTitre.charAt(0).toLowerCase()}${suivante.sousTitre.slice(1)}` : ''}`,
    };
  }
  switch (v.raison) {
    case 'fini':
    case 'medaille':
      if (v.dejaReussi) return { titre: `Rendez-vous ${n} : encore réussi`, phrase: 'Déjà réussi avant : pas de nouvelle prime, mais ton temps est gardé.' };
      return { titre: `Rendez-vous ${n} réussi`, phrase: v.prime > 0 ? `${OBJECTIF_LABEL[v.rendezVous.objectif]} : c’est fait. La prime de ${dollars(v.prime)} est dans tes gains.` : `${OBJECTIF_LABEL[v.rendezVous.objectif]} : c’est fait.` };
    case 'trop-lent':
      return {
        titre: `Rendez-vous ${n} manqué`,
        phrase:
          v.seuil !== null && v.ecart !== null
            ? `Il fallait ${VISEE[v.rendezVous.objectif]}, sous ${formatChrono(v.seuil * 1000)}. Tu as mis ${formatChrono(temps * 1000)} : ${secondes(v.ecart)} de trop.`
            : `Il fallait ${VISEE[v.rendezVous.objectif]} : pas assez vite cette fois.`,
      };
    case 'contrainte':
      return { titre: `Rendez-vous ${n} manqué`, phrase: `${v.manquees.map((c) => CONTRAINTE_LABEL[c].court).join(', ')} : ${v.manquees.map((c) => CONTRAINTE_LABEL[c].manque).join(', ')}. Le temps ne compte pas pour ce rendez-vous.` };
    case 'non-conforme':
      return { titre: `Rendez-vous ${n} pas couru`, phrase: `La course n’était pas celle du rendez-vous (${v.ecarts.map((e) => ECARTS[e] ?? e).join(', ')}) : elle compte comme une course libre.` };
    case 'pas-encore':
      return { titre: `Rendez-vous ${n} pas encore ouvert`, phrase: 'Réussis d’abord ceux d’avant : la course compte comme une course libre.' };
  }
}

export function ProchainRendezVous({ bilan }: { bilan?: Bilan }) {
  const fin = useDrive((state) => state.fin);
  const source = bilan ?? fin;
  const v = verdictDe(source);
  if (!v || !source) return null;
  const { titre, phrase } = texteVerdict(v, source.resultat.temps);
  const annonce = v.reussi && !v.bouclee && v.suivant;
  const prochain = v.saisonBouclee ? `Saison ${v.suivantSaison}, premier rendez-vous` : 'Prochain rendez-vous';
  return (
    <div className="fin-course-bloc carriere-fin" aria-labelledby="carriere-fin-titre" data-verdict={v.reussi ? 'reussi' : 'manque'} data-bouclee={v.bouclee || undefined}>
      <h3 id="carriere-fin-titre">{titre}</h3>
      <p className="carriere-fin-phrase" role="status">
        {phrase}
      </p>
      {!v.reussi && <p className="carriere-fin-note">Le rendez-vous t’attend : retente-le autant que tu veux, ou va d’abord préparer ton véhicule.</p>}
      {annonce && v.suivant && (
        <div className="carriere-fin-annonce">
          <p className="carriere-fin-prochain">{prochain}</p>
          <FicheRendezVous rdv={v.suivant} numero={v.suivantNumero} total={v.suivantTotal} />
        </div>
      )}
    </div>
  );
}
