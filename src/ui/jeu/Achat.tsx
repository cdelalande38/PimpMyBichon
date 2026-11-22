// Le bloc d'achat, partagé : il s'ouvre sous ce qu'on veut débloquer (un pack dans Atelier › Ton compte, une
// pièce dans son panneau du dock) et demande confirmation, ou explique ce qui manque quand le solde ne
// suffit pas. L'achat passe par l'état du jeu (src/state/jeu.ts) ; rien n'est débité sans « Acheter ».

import { useEffect, useRef } from 'react';
import type { ArticleBoutique } from '../../data/boutique.ts';
import { ECONOMIE } from '../../data/economie.ts';
import { useJeu } from '../../state/jeu.ts';
import { dollars } from './libelles.ts';
import './jeu.css';

export interface AchatProps {
  article: ArticleBoutique;
  /** Le nom avec son article, pour les phrases : « le Pack Flammes », « l’aileron haut ». Sans lui : « Aileron haut ». */
  nom?: string;
  /** La phrase dite une fois l'achat fait. Sans elle : « Aileron haut débloqué. » */
  fait?: string;
  onClose: () => void;
  /** Achat fait : la phrase à afficher (les hauts faits obtenus au passage y sont ajoutés). */
  onDone: (message: string) => void;
}

export function Achat({ article, nom, fait, onClose, onDone }: AchatProps) {
  const solde = useJeu((state) => state.solde);
  const acheter = useJeu((state) => state.acheter);
  const bloc = useRef<HTMLDivElement>(null);
  const prix = article.prix ?? 0;
  const assez = solde >= prix;
  const quoi = nom ?? `« ${article.label} »`;
  useEffect(() => {
    bloc.current?.scrollIntoView({ block: 'nearest' });
    bloc.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, []);

  if (!assez) {
    const manque = prix - solde;
    return (
      <div ref={bloc} className="jeu-achat" role="alert" data-etat="insuffisant">
        <p>
          Il te manque <b>{dollars(manque)}</b> pour {quoi}. Une course d’un tour rapporte au moins {dollars(ECONOMIE.tour1.base)} : va rouler, puis reviens.
        </p>
        <div className="jeu-achat-actes">
          <button type="button" className="btn" onClick={onClose}>
            Compris
          </button>
        </div>
      </div>
    );
  }
  return (
    <div ref={bloc} className="jeu-achat" role="group" aria-label={`Acheter ${article.label}`} data-etat="confirmation">
      <p>
        Acheter {quoi} pour <b>{dollars(prix)}</b> ? Il te restera {dollars(solde - prix)}.
      </p>
      <div className="jeu-achat-actes">
        <button
          type="button"
          className="btn cta"
          onClick={() => {
            const issue = acheter(article.id);
            if (issue.ok) {
              const faits = (issue.hautsFaits ?? []).map((haut) => `Haut fait : ${haut.label}.`);
              onDone([fait ?? `${article.label} débloqué.`, ...faits].join(' '));
            } else onClose();
          }}
        >
          Acheter
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Pas maintenant
        </button>
      </div>
    </div>
  );
}
