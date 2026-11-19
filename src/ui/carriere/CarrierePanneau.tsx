// Panneau de la carrière (vague U, contrat entre lots : export nommé, sans propriété obligatoire). Le menu
// de la sortie l'affiche quand le joueur choisit « Carrière » (lot « entree », étape « Mode »).
//
// Vague V, les saisons (demande du 18 novembre 2026 : « Il faudra une suite a ce mode carrière »), en trois
// niveaux du dock (src/state/dock.ts : la saison, puis le rendez-vous, chacun un niveau `element` ; « Retour »
// remonte d'un niveau, le fil dit « Carrière › Saison 1 › 3. Le bord de mer ») :
// - l'accueil : la saison en cours en tête (« Saison 2 · 3 sur 12 »), ses cases, la fiche du rendez-vous
//   courant (src/ui/carriere/FicheRendezVous.tsx), puis la liste des saisons pour revoir une saison bouclée ;
// - une saison : ses rendez-vous, chacun réussi ou non, sa médaille et son record ;
// - un rendez-vous : sa fiche, son résultat, et « Y aller » (le courant) ou « Rejouer » (un réussi, pour la
//   médaille ou le temps ; la prime n'est versée qu'une fois).
// Le bouton d'action est collé en bas, sous le pouce et toujours entier : il part avec TOUT imposé.

import { MEDAILLES } from '../../data/courses.ts';
import { SAISONS, type RendezVous, type Saison } from '../../data/carriere.ts';
import { formatChrono } from '../../drive/depart.ts';
import { indexCourant, saisonBouclee, saisonOuverte, type ProgressionCarriere } from '../../jeu/carriere.ts';
import type { Medaille } from '../../jeu/contrat.ts';
import { useDock } from '../../state/dock.ts';
import { useJeu } from '../../state/jeu.ts';
import { sortirSurRendezVous } from './actions.ts';
import { Padlock } from '../paint/Padlock.tsx';
import { FicheRendezVous } from './FicheRendezVous.tsx';
import { useCarriere } from './useCarriere.ts';
import './carriere.css';

const NOM_MEDAILLE: Readonly<Record<Medaille, string>> = Object.fromEntries(MEDAILLES.map((m) => [m.id, m.label])) as Record<Medaille, string>;

/** Une case par rendez-vous de la saison : réussi, courant, à venir. */
function Jalons({ saison, progression, courant }: { saison: Saison; progression: ProgressionCarriere; courant: RendezVous | null }) {
  const reussis = saison.rendezVous.filter((rdv) => progression.resultats[rdv.id]?.reussi).length;
  const total = saison.rendezVous.length;
  return (
    <ol className="carriere-jalons" role="progressbar" aria-label="Rendez-vous réussis" aria-valuemin={0} aria-valuemax={total} aria-valuenow={reussis} aria-valuetext={`${reussis} sur ${total}`}>
      {saison.rendezVous.map((rdv) => (
        <li key={rdv.id} data-etat={progression.resultats[rdv.id]?.reussi ? 'reussi' : rdv === courant ? 'courant' : 'a-venir'} />
      ))}
    </ol>
  );
}

/** « Saison 2 · Les choses sérieuses » */
function nomSaison(index: number, saison: Saison): string {
  return `Saison ${index + 1} · ${saison.titre}`;
}

/** Bouton d'action collé en bas. */
function Action({ rdv, numero, total, label, aide }: { rdv: RendezVous; numero: number; total: number; label: string; aide: string }) {
  return (
    <div className="carriere-go">
      <button type="button" className="btn cta carriere-sortir" aria-label={label} aria-describedby="carriere-sortir-aide" onClick={() => sortirSurRendezVous(rdv, numero, total)}>
        <span>{label}</span>
        <small id="carriere-sortir-aide">{aide}</small>
      </button>
    </div>
  );
}

/** Les saisons, une rangée chacune : bouclée, en cours, ou fermée (avec ce qui l'ouvre). */
function ListeSaisons({ progression }: { progression: ProgressionCarriere }) {
  return (
    <section className="carriere-saisons" aria-label="Les saisons">
      <h4 className="carriere-sous-titre">Les saisons</h4>
      <ul className="carriere-lignes">
        {SAISONS.map((saison, i) => {
          const ouverte = saisonOuverte(progression, SAISONS, i);
          const bouclee = saisonBouclee(progression, saison);
          const reussis = saison.rendezVous.filter((rdv) => progression.resultats[rdv.id]?.reussi).length;
          const ors = saison.rendezVous.filter((rdv) => progression.resultats[rdv.id]?.medaille === 'or').length;
          const etat = bouclee ? `Bouclée · ${ors} en or sur ${saison.rendezVous.length}` : ouverte ? `En cours · ${reussis} sur ${saison.rendezVous.length}` : `Fermée : boucle d’abord la saison ${i}`;
          return (
            <li key={saison.id}>
              <button
                type="button"
                className="carriere-ligne"
                data-saison={saison.id}
                data-etat={bouclee ? 'bouclee' : ouverte ? 'en-cours' : 'fermee'}
                disabled={!ouverte}
                onClick={() => useDock.getState().push({ kind: 'element', element: saison.id, libelle: `Saison ${i + 1}` })}
              >
                <span className="carriere-ligne-texte">
                  <b>{nomSaison(i, saison)}</b>
                  <small>{etat}</small>
                </span>
                {ouverte ? (
                  <span className="carriere-ligne-fleche" aria-hidden="true">
                    ›
                  </span>
                ) : (
                  <Padlock open={false} className="carriere-cadenas" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Une saison : ses rendez-vous, réussis ou non, avec leur médaille et leur record. */
function VueSaison({ index, progression }: { index: number; progression: ProgressionCarriere }) {
  const saison = SAISONS[index]!;
  const carriere = SAISONS.flatMap((s) => s.rendezVous);
  const courant = carriere[indexCourant(progression, carriere)] ?? null;
  return (
    <div className="carriere-corps">
      <header className="carriere-tete">
        <span className="carriere-surtitre">Saison {index + 1}</span>
        <span className="carriere-compte">{saisonBouclee(progression, saison) ? 'Bouclée' : `${saison.rendezVous.filter((rdv) => progression.resultats[rdv.id]?.reussi).length} sur ${saison.rendezVous.length}`}</span>
      </header>
      <h3 className="carriere-saison-titre">{saison.titre}</h3>
      <p className="carriere-note">{saison.sousTitre}</p>
      <ul className="carriere-lignes" aria-label={`Les rendez-vous de la saison ${index + 1}`}>
        {saison.rendezVous.map((rdv, i) => {
          const r = progression.resultats[rdv.id];
          const etat = r?.reussi ? 'reussi' : rdv === courant ? 'courant' : 'a-venir';
          return (
            <li key={rdv.id}>
              <button type="button" className="carriere-ligne" data-rendez-vous={rdv.id} data-etat={etat} onClick={() => useDock.getState().push({ kind: 'element', element: rdv.id, libelle: `${i + 1}. ${rdv.titre}` })}>
                <span className="carriere-ligne-numero">{i + 1}</span>
                <span className="carriere-ligne-texte">
                  <b>{rdv.titre}</b>
                  <small>{r?.reussi ? `Réussi${r.meilleurTemps !== null ? ` · record ${formatChrono(r.meilleurTemps * 1000)}` : ''}` : etat === 'courant' ? 'À faire maintenant' : 'Après le précédent'}</small>
                </span>
                {r?.medaille ? (
                  <span className="carriere-medaille" data-medaille={r.medaille}>
                    {NOM_MEDAILLE[r.medaille]}
                  </span>
                ) : (
                  r?.reussi && <span className="carriere-medaille">Fait</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Un rendez-vous choisi dans sa saison : sa fiche, son résultat, et l'action qu'il permet. */
function VueRendezVous({ index, rdv, progression }: { index: number; rdv: RendezVous; progression: ProgressionCarriere }) {
  const saison = SAISONS[index]!;
  const numero = saison.rendezVous.indexOf(rdv) + 1;
  const total = saison.rendezVous.length;
  const carriere = SAISONS.flatMap((s) => s.rendezVous);
  const ouvert = carriere.indexOf(rdv) <= indexCourant(progression, carriere);
  const r = progression.resultats[rdv.id];
  return (
    <>
      <div className="carriere-corps">
        {r?.reussi && (
          <p className="carriere-resultat">
            Réussi{r.medaille ? `, ${NOM_MEDAILLE[r.medaille].toLowerCase()}` : ''}
            {r.meilleurTemps !== null && ` · record ${formatChrono(r.meilleurTemps * 1000)}`} · prime déjà touchée
          </p>
        )}
        <FicheRendezVous rdv={rdv} numero={numero} total={total} />
        {!ouvert && <p className="carriere-note">Réussis d’abord les rendez-vous d’avant : celui-ci t’attend.</p>}
      </div>
      {ouvert && <Action rdv={rdv} numero={numero} total={total} label={r?.reussi ? 'Rejouer' : 'Y aller'} aide={r?.reussi ? 'Pour la médaille ou le temps · tout est imposé' : `Rendez-vous ${numero} · tout est imposé`} />}
    </>
  );
}

export function CarrierePanneau() {
  const carriere = useCarriere();
  const progression = useJeu((state) => state.carriere);
  const levels = useDock((state) => state.levels);
  if (!carriere.hydrated) return <p className="carriere-note">Ta carrière se relit…</p>;
  if (carriere.total === 0 || !carriere.saison) return <p className="carriere-note">Pas de carrière dans cette version : les courses libres t’attendent.</p>;
  // Les niveaux sous l'étape : la saison choisie, puis le rendez-vous choisi (une saison fermée ne s'ouvre pas).
  const saisonId = levels[1]?.kind === 'element' ? levels[1].element : null;
  const rdvId = levels[2]?.kind === 'element' ? levels[2].element : null;
  const index = SAISONS.findIndex((s) => s.id === saisonId);
  if (index >= 0 && saisonOuverte(progression, SAISONS, index)) {
    const rdv = SAISONS[index]!.rendezVous.find((x) => x.id === rdvId);
    return (
      <section className="carriere" aria-label={`Carrière, saison ${index + 1}`} data-vue={rdv ? 'rendez-vous' : 'saison'}>
        {rdv ? <VueRendezVous index={index} rdv={rdv} progression={progression} /> : <VueSaison index={index} progression={progression} />}
      </section>
    );
  }
  const { courant, numero, total, reussis, saison, saisonNumero } = carriere;
  return (
    <section className="carriere" aria-label="Carrière" data-etat={courant ? 'en-cours' : 'bouclee'} data-vue="accueil">
      <div className="carriere-corps">
        <header className="carriere-tete">
          <span className="carriere-surtitre">
            Saison {saisonNumero} · {courant ? `${numero} sur ${total}` : 'bouclée'}
          </span>
          <span className="carriere-compte">
            {reussis} sur {total} réussi{reussis > 1 ? 's' : ''}
          </span>
        </header>
        <p className="carriere-saison-nom">
          <b>{saison.titre}</b> {saison.sousTitre}
        </p>
        <Jalons saison={saison} progression={progression} courant={courant} />
        {courant ? (
          <FicheRendezVous rdv={courant} numero={numero} total={total} />
        ) : (
          <div className="carriere-bouclee">
            <h3>Carrière bouclée</h3>
            <p>Toutes les saisons sont réussies. Chapeau. Une suite viendra ; d’ici là, rejoue tes épreuves pour l’or et tes records.</p>
          </div>
        )}
        <ListeSaisons progression={progression} />
      </div>
      {courant && <Action rdv={courant} numero={numero} total={total} label="Sortir" aide={`${saisonNumero > 1 ? `Saison ${saisonNumero} · rendez-vous` : 'Rendez-vous'} ${numero} · tout est imposé`} />}
    </section>
  );
}
