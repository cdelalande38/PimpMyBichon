// Mécanique · Échappement : la ligne (origine, feutrée, sport, libre), l'écoute au garage, la finition
// des sorties. Tout vient de src/data/echappement.ts ; les choix vont dans le build (`parts.echappement`,
// `partPaints.echappement`). L'origine et le chrome sont libres ; le reste se débloque avec des dollars,
// sur place : une puce verrouillée montre son cadenas et son prix, un appui ouvre le bloc d'achat partagé
// (src/ui/jeu/Achat.tsx) sous la rangée, et l'option se monte une fois achetée.

import { useCallback, useId, useState } from 'react';
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
import { useJeu } from '../../state/jeu.ts';
import { EngineSoundControls } from '../engine/EngineSoundControls.tsx';
import { Achat } from '../jeu/Achat.tsx';
import { dollars } from '../jeu/libelles.ts';
import { Padlock } from '../paint/Padlock.tsx';
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
  else if (sorties > 0) flammes = 'En sortie de nuit, un lever de pied après un haut régime fait cracher les sorties.';
  else flammes = 'Ce véhicule n’a pas encore de sortie modelée : le claquement s’entend en sortie, sans flamme visible.';

  return (
    <div className="echappement" data-ligne={ligne.id} data-finition={finition.id}>
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
                aria-label={ferme && article ? `${choix.label}, verrouillée, ${article.prix} dollars` : undefined}
                onClick={() => choisirLigne(choix)}
              >
                <b>{choix.label}</b>
                {ferme && article ? <Verrou article={article} /> : <small>{choix.hint}</small>}
              </button>
            );
          })}
        </div>
        {blocAchat('ligne')}
        <p className="ech-note">{ligne.description}</p>
        <p className="ech-note" data-flammes={ligne.flammes ? (sorties > 0 ? 'oui' : 'sans-sortie') : 'non'}>
          {flammes}
        </p>
      </section>

      <section className="ech-bloc" aria-labelledby={ecouteId}>
        <h3 id={ecouteId}>Écouter</h3>
        <p className="ech-note">Démarre et donne des coups de gaz : le moteur joue ici avec la ligne choisie, comme en sortie.</p>
        <EngineSoundControls />
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
                  aria-label={ferme && article ? `${choix.label}, verrouillée, ${article.prix} dollars` : undefined}
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
      </section>

      <p className="ech-message" role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
