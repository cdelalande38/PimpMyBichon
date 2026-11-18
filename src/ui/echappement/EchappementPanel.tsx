// Mécanique · Échappement : la ligne (origine, feutrée, sport, libre), l'écoute au garage, la finition
// des sorties. Tout vient de src/data/echappement.ts ; les choix vont dans le build (`parts.echappement`,
// `partPaints.echappement`). L'origine et le chrome sont libres ; le reste se débloque avec des dollars,
// sur place : une puce verrouillée montre son cadenas et son prix, un appui ouvre le bloc d'achat partagé
// (src/ui/jeu/Achat.tsx) sous la rangée, et l'option se monte une fois achetée. Une option montée sans
// être acquise reste en place, et le panneau le dit (src/ui/nonAcquis.tsx). À l'écoute, ligne libre : un
// coup de gaz tenu puis lâché fait cracher les sorties au garage, avec le claquement enregistré du moteur
// s'il en a un (./flammesGarage.ts, ./claquement.ts) ; rien n'est fabriqué. Sur un véhicule aux sorties
// déclarées, la caméra du garage cadre son arrière tant que le panneau est ouvert (src/ui/useCadreBout.ts).

import { useCallback, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { articleParId, type ArticleBoutique } from '../../data/boutique.ts';
import {
  articleFinition,
  articleLigne,
  FINITIONS_ECHAPPEMENT,
  finitionDe,
  LIGNE_ORIGINE,
  LIGNES_ECHAPPEMENT,
  ligneDe,
  POSTE_ECHAPPEMENT,
  type FinitionEchappement,
  type LigneEchappement,
} from '../../data/echappement.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import { possedeDans } from '../../jeu/achats.ts';
import { useBuilds } from '../../state/builds.ts';
import { useEngineSound } from '../../state/engineSound.ts';
import { useJeu } from '../../state/jeu.ts';
import { EngineSoundControls } from '../engine/EngineSoundControls.tsx';
import { Achat } from '../jeu/Achat.tsx';
import { dollars } from '../jeu/libelles.ts';
import { nomNonAcquis, NoteNonAcquise } from '../nonAcquis.tsx';
import { Padlock } from '../paint/Padlock.tsx';
import { useCadreBout } from '../useCadreBout.ts';
import { claquer } from './claquement.ts';
import { crache, useFlammesGarage } from './flammesGarage.ts';
import '../engine/engine.css';
import './echappement.css';
import './suivi.ts';

/** Un achat en cours : l'article, le nom dans la phrase, ce qui se monte une fois payé, et sa rangée. */
interface AchatEnCours {
  article: ArticleBoutique;
  nom: string;
  fait: string;
  rangee: 'ligne' | 'finition';
  monter: () => void;
}

/** Prix et cadenas d'une option verrouillée, dans sa puce. */
function Verrou({ article }: { article: ArticleBoutique }) {
  return (
    <small className="ech-prix">
      <Padlock open={false} className="ech-cadenas" />
      {dollars(article.prix ?? 0)}
    </small>
  );
}

export function EchappementPanel() {
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const build = useBuilds((state) => state.builds[vehicle.id]);
  const setPart = useBuilds((state) => state.setPart);
  const setPartPaint = useBuilds((state) => state.setPartPaint);
  const acquis = useJeu((state) => state.articles);
  const possede = useCallback((id: string) => possedeDans({ articles: acquis }, id), [acquis]);
  const [achat, setAchat] = useState<AchatEnCours | null>(null);
  const [message, setMessage] = useState('');
  const ligneId = useId();
  const ecouteId = useId();
  const finitionId = useId();

  const ligne = ligneDe(build);
  const finition = finitionDe(build);
  const sorties = vehicle.exhaust?.outlets.length ?? 0;
  const finitionPossible = (vehicle.exhaust?.nodes?.length ?? 0) > 0;
  // Posé sans être acquis (la règle commune) : l'article de ce qui est monté, s'il manque.
  const sansAchat = (id: string | undefined) => {
    const article = id ? articleParId(id) : undefined;
    return article && !possede(article.id) ? article : undefined;
  };
  const ligneSansAchat = sansAchat(ligne.id === LIGNE_ORIGINE.id ? undefined : articleLigne(ligne.id));
  const finitionSansAchat = finitionPossible ? sansAchat(finition.id === 'chrome' ? undefined : articleFinition(finition.id)) : undefined;

  // Les sorties se voient : l'arrière du véhicule, cadré au-dessus du menu.
  const root = useRef<HTMLDivElement>(null);
  useCadreBout(root, vehicle.id, vehicle.exhaust ? 'arriere' : null, 'echappement-arriere');

  // Écoute : le lâcher d'un coup de gaz tenu (bouton « Coup de gaz », au doigt ou au clavier) peut faire
  // cracher la ligne libre au garage. Lu au passage des évènements, sans toucher aux commandes du moteur.
  const appui = useRef<number | null>(null);
  const tourne = () => {
    const etat = useEngineSound.getState().state;
    return etat === 'ralenti' || etat === 'charge';
  };
  const surGaz = (target: EventTarget, on: boolean, maintenant: number) => {
    if (!(target instanceof Element) || !target.closest('.engine-throttle')) return;
    if (on) {
      if (appui.current === null && tourne()) appui.current = maintenant;
      return;
    }
    const depuis = appui.current;
    appui.current = null;
    if (depuis === null || !tourne()) return;
    const tirs = useFlammesGarage.getState();
    if (!crache(ligne.flammes, sorties, (maintenant - depuis) / 1000, (maintenant - tirs.dernier) / 1000)) return;
    tirs.tirer(maintenant);
    claquer();
  };
  // L'heure de l'évènement (même origine que performance.now) : la tenue du coup de gaz.
  const touche = (event: KeyboardEvent<HTMLDivElement>, on: boolean) => {
    if (event.key === ' ' || event.key === 'Enter') surGaz(event.target, on, event.timeStamp);
  };
  const doigt = (event: PointerEvent<HTMLDivElement>, on: boolean) => surGaz(event.target, on, event.timeStamp);

  const monterLigne = (choix: LigneEchappement) => setPart(vehicle.id, POSTE_ECHAPPEMENT, choix.id === LIGNE_ORIGINE.id ? null : choix.id);
  const monterFinition = (choix: FinitionEchappement) => setPartPaint(vehicle.id, POSTE_ECHAPPEMENT, choix.id === 'chrome' ? null : { ...choix.peinture });

  const choisirLigne = (choix: LigneEchappement) => {
    setMessage('');
    const article = choix.id === LIGNE_ORIGINE.id ? undefined : articleParId(articleLigne(choix.id));
    if (!article || possede(article.id)) {
      setAchat(null);
      monterLigne(choix);
      return;
    }
    const nom = `la ligne ${choix.label.toLowerCase()}`;
    setAchat(achat?.article.id === article.id ? null : { article, nom, fait: `Ligne ${choix.label.toLowerCase()} débloquée : elle est montée.`, rangee: 'ligne', monter: () => monterLigne(choix) });
  };
  const choisirFinition = (choix: FinitionEchappement) => {
    setMessage('');
    const article = choix.id === 'chrome' ? undefined : articleParId(articleFinition(choix.id));
    if (!article || possede(article.id)) {
      setAchat(null);
      monterFinition(choix);
      return;
    }
    const nom = `les sorties ${choix.label.toLowerCase()}es`;
    setAchat(achat?.article.id === article.id ? null : { article, nom, fait: `${article.label} débloquées : elles sont posées.`, rangee: 'finition', monter: () => monterFinition(choix) });
  };

  const blocAchat = (rangee: AchatEnCours['rangee']) =>
    achat?.rangee === rangee && (
      <Achat
        article={achat.article}
        nom={achat.nom}
        fait={achat.fait}
        onClose={() => setAchat(null)}
        onDone={(texte) => {
          achat.monter();
          setAchat(null);
          setMessage(texte);
        }}
      />
    );

  let flammes: string;
  if (!ligne.flammes) flammes = 'Pas de retour de flammes avec cette ligne.';
  else if (sorties > 0) flammes = 'En sortie, un lever de pied après un haut régime fait cracher les sorties.';
  else flammes = 'Ce véhicule n’a pas encore de sortie modelée : le claquement s’entend en sortie, sans flamme visible.';

  return (
    <div ref={root} className="echappement" data-ligne={ligne.id} data-finition={finition.id}>
      <section className="ech-bloc" aria-labelledby={ligneId}>
        <h3 id={ligneId}>Ligne</h3>
        <div className="chips ech-chips" role="group" aria-label="Ligne d’échappement">
          {LIGNES_ECHAPPEMENT.map((choix) => {
            const article = choix.id === LIGNE_ORIGINE.id ? undefined : articleParId(articleLigne(choix.id));
            const ferme = article !== undefined && !possede(article.id);
            return (
              <button
                key={choix.id}
                type="button"
                className="chip"
                data-ligne={choix.id}
                data-verrou={ferme ? 'ferme' : undefined}
                aria-pressed={ligne.id === choix.id}
                aria-expanded={ferme ? achat?.article.id === article?.id : undefined}
                aria-label={ferme && article ? (ligne.id === choix.id ? nomNonAcquis(choix.label, article.prix) : `${choix.label}, verrouillée, ${article.prix} dollars`) : undefined}
                onClick={() => choisirLigne(choix)}
              >
                <b>{choix.label}</b>
                {ferme && article ? <Verrou article={article} /> : <small>{choix.hint}</small>}
              </button>
            );
          })}
        </div>
        {blocAchat('ligne')}
        {ligneSansAchat && <NoteNonAcquise label={ligne.label} prix={ligneSansAchat.prix} />}
        <p className="ech-note">{ligne.description}</p>
        <p className="ech-note" data-flammes={ligne.flammes ? (sorties > 0 ? 'oui' : 'sans-sortie') : 'non'}>
          {flammes}
        </p>
      </section>

      <section className="ech-bloc" aria-labelledby={ecouteId}>
        <h3 id={ecouteId}>Écouter</h3>
        <p className="ech-note">
          {ligne.flammes && sorties > 0
            ? 'Démarre, tiens le gaz un instant puis lâche d’un coup : les sorties crachent, comme sur la route.'
            : 'Démarre et donne des coups de gaz : le moteur joue ici avec la ligne choisie, comme en sortie.'}
        </p>
        <div
          className="ech-ecoute"
          onPointerDownCapture={(event) => doigt(event, true)}
          onPointerUpCapture={(event) => doigt(event, false)}
          onPointerCancelCapture={() => {
            appui.current = null;
          }}
          onKeyDownCapture={(event) => touche(event, true)}
          onKeyUpCapture={(event) => touche(event, false)}
        >
          <EngineSoundControls />
        </div>
      </section>

      <section className="ech-bloc" aria-labelledby={finitionId}>
        <h3 id={finitionId}>Finition des sorties</h3>
        {finitionPossible ? (
          <div className="chips ech-chips" role="group" aria-label="Finition des sorties">
            {FINITIONS_ECHAPPEMENT.map((choix) => {
              const article = choix.id === 'chrome' ? undefined : articleParId(articleFinition(choix.id));
              const ferme = article !== undefined && !possede(article.id);
              return (
                <button
                  key={choix.id}
                  type="button"
                  className="chip chip-swatch"
                  data-finition={choix.id}
                  data-verrou={ferme ? 'ferme' : undefined}
                  aria-pressed={finition.id === choix.id}
                  aria-expanded={ferme ? achat?.article.id === article?.id : undefined}
                  aria-label={ferme && article ? (finition.id === choix.id ? nomNonAcquis(choix.label, article.prix) : `${choix.label}, verrouillée, ${article.prix} dollars`) : undefined}
                  onClick={() => choisirFinition(choix)}
                >
                  <span className="swatch" style={{ background: choix.rendu.color }} aria-hidden="true" />
                  <span className="chip-text">
                    <b>{choix.label}</b>
                    {ferme && article ? <Verrou article={article} /> : <small>{choix.hint}</small>}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="ech-note" data-finition="sans-sorties">
            Les sorties de ce modèle ne sont pas des pièces à part : leur finition viendra avec les sorties modelées.
          </p>
        )}
        {blocAchat('finition')}
        {finitionSansAchat && <NoteNonAcquise label={finition.label} prix={finitionSansAchat.prix} />}
      </section>

      <p className="ech-message" role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
