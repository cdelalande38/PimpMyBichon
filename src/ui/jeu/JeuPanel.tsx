// Atelier › Jeu : ton solde, la boutique (packs de stickers, trophées à gagner) et les hauts faits,
// obtenus et à faire. Tout vient des données (src/data/boutique.ts, hautsFaits.ts, economie.ts).

import { useEffect, useRef, useState } from 'react';
import { A_VENDRE, ARTICLES, TROPHEES, articleParId, type ArticleBoutique } from '../../data/boutique.ts';
import { ECONOMIE } from '../../data/economie.ts';
import { HAUTS_FAITS, type HautFaitDef } from '../../data/hautsFaits.ts';
import { MAPS } from '../../data/maps.ts';
import { possedeDans } from '../../jeu/achats.ts';
import { progression } from '../../jeu/hautsFaits.ts';
import { useJeu } from '../../state/jeu.ts';
import { dollars, gain, kilometres, pluriel } from './libelles.ts';
import './jeu.css';

type Onglet = 'boutique' | 'hauts-faits';

const ONGLETS: ReadonlyArray<{ id: Onglet; label: string }> = [
  { id: 'boutique', label: 'Boutique' },
  { id: 'hauts-faits', label: 'Hauts faits' },
];

/** Ce qu'offre un haut fait, en clair : « +50 $ », « Trophée d'or ». */
function recompenseEnClair(def: HautFaitDef): string {
  const parts: string[] = [];
  if (def.recompense.dollars) parts.push(gain(def.recompense.dollars));
  for (const id of def.recompense.articles ?? []) {
    const article = articleParId(id);
    if (article) parts.push(article.label);
  }
  return parts.join(' · ');
}

function Resume() {
  const solde = useJeu((state) => state.solde);
  const cumuls = useJeu((state) => state.cumuls);
  const obtenus = useJeu((state) => Object.keys(state.hautsFaits).length);
  return (
    <div className="jeu-solde" role="status" aria-label={`Ton solde : ${solde} dollars`}>
      <span className="jeu-solde-label">Ton solde</span>
      <b className="jeu-solde-montant">{dollars(solde)}</b>
      <small>
        {cumuls.courses === 0
          ? 'Aucune course finie pour l’instant : chaque course rapporte des dollars.'
          : `${pluriel(cumuls.courses, 'course finie', 'courses finies')} · ${kilometres(cumuls.distance)} · ${obtenus} sur ${HAUTS_FAITS.length} hauts faits`}
      </small>
    </div>
  );
}

/** Le bloc qui s'ouvre sous un pack : la confirmation, ou l'explication quand le solde ne suffit pas. */
function Achat({ article, onClose, onDone }: { article: ArticleBoutique; onClose: () => void; onDone: (message: string) => void }) {
  const solde = useJeu((state) => state.solde);
  const acheter = useJeu((state) => state.acheter);
  const bloc = useRef<HTMLDivElement>(null);
  const prix = article.prix ?? 0;
  const assez = solde >= prix;
  useEffect(() => {
    bloc.current?.scrollIntoView({ block: 'nearest' });
    bloc.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, []);

  if (!assez) {
    const manque = prix - solde;
    return (
      <div ref={bloc} className="jeu-achat" role="alert" data-etat="insuffisant">
        <p>
          Il te manque <b>{dollars(manque)}</b> pour le {article.label}. Une course d’un tour rapporte au moins {dollars(ECONOMIE.tour1.base)} : va rouler, puis reviens.
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
        Acheter le {article.label} pour <b>{dollars(prix)}</b> ? Il te restera {dollars(solde - prix)}.
      </p>
      <div className="jeu-achat-actes">
        <button
          type="button"
          className="btn cta"
          onClick={() => {
            const issue = acheter(article.id);
            if (issue.ok) {
              const faits = (issue.hautsFaits ?? []).map((fait) => `Haut fait : ${fait.label}.`);
              onDone([`${article.label} acheté : ses motifs t’attendent dans les stickers.`, ...faits].join(' '));
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

function Boutique() {
  const articles = useJeu((state) => state.articles);
  const [choix, setChoix] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const packs = ARTICLES.filter((article) => article.famille === 'pack');
  const possede = (id: string) => possedeDans({ articles }, id);
  const aVendre = new Set(A_VENDRE.map((article) => article.id));

  return (
    <>
      <p className="note">Ce qui est libre reste gratuit : peinture, roues, suspension, intérieur, ambiance et cartes. Les dollars débloquent les nouveautés.</p>
      {message && (
        <p className="jeu-message" role="status">
          {message}
        </p>
      )}
      <h3 className="jeu-titre">Packs de stickers</h3>
      <ul className="jeu-liste">
        {packs.map((pack) => (
          <li key={pack.id} className="jeu-ligne" data-possede={possede(pack.id) || undefined}>
            <div className="jeu-ligne-tete">
              <div className="jeu-ligne-texte">
                <b>{pack.label}</b>
                <small>{pack.description}</small>
              </div>
              {possede(pack.id) ? (
                <span className="jeu-etat">{pack.offert ? 'Offert' : 'Acquis'}</span>
              ) : (
                aVendre.has(pack.id) && (
                  <button
                    type="button"
                    className="btn jeu-acheter"
                    aria-label={`Acheter ${pack.label} : ${pack.prix} dollars`}
                    aria-expanded={choix === pack.id}
                    onClick={() => {
                      setMessage(null);
                      setChoix(choix === pack.id ? null : pack.id);
                    }}
                  >
                    {dollars(pack.prix ?? 0)}
                  </button>
                )
              )}
            </div>
            {choix === pack.id && !possede(pack.id) && (
              <Achat
                article={pack}
                onClose={() => setChoix(null)}
                onDone={(texte) => {
                  setChoix(null);
                  setMessage(texte);
                }}
              />
            )}
          </li>
        ))}
      </ul>
      <h3 className="jeu-titre">Trophées à gagner</h3>
      <p className="note">Ces stickers ne s’achètent pas : un haut fait te les offre.</p>
      <ul className="jeu-liste">
        {TROPHEES.map((trophee) => {
          const offert = HAUTS_FAITS.find((def) => def.recompense.articles?.includes(trophee.id));
          return (
            <li key={trophee.id} className="jeu-ligne" data-possede={possede(trophee.id) || undefined}>
              <div className="jeu-ligne-tete">
                <div className="jeu-ligne-texte">
                  <b>{trophee.label}</b>
                  <small>{offert ? `Haut fait : ${offert.label}. ${offert.description}` : trophee.description}</small>
                </div>
                <span className="jeu-etat">{possede(trophee.id) ? 'Gagné' : 'À gagner'}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function LigneHautFait({ def, obtenu }: { def: HautFaitDef; obtenu: boolean }) {
  const cumuls = useJeu((state) => state.cumuls);
  const avancement = obtenu ? null : progression(def, cumuls, MAPS.length);
  const enKm = avancement?.champ === 'cumul.distance';
  return (
    <li className="jeu-ligne" data-possede={obtenu || undefined} data-haut-fait={def.id}>
      <div className="jeu-ligne-tete">
        <div className="jeu-ligne-texte">
          <b>{def.label}</b>
          <small>{def.description}</small>
          {avancement && avancement.cible > 1 && (
            <small className="jeu-avancement">
              {enKm ? `${kilometres(avancement.actuel)} sur ${kilometres(avancement.cible)}` : `${Math.floor(avancement.actuel)} sur ${avancement.cible}`}
            </small>
          )}
        </div>
        <span className="jeu-etat" data-or={obtenu || undefined}>
          {obtenu ? 'Obtenu' : recompenseEnClair(def)}
        </span>
      </div>
      {obtenu && <small className="jeu-recompense">{recompenseEnClair(def)}</small>}
    </li>
  );
}

function HautsFaits() {
  const hautsFaits = useJeu((state) => state.hautsFaits);
  const faits = HAUTS_FAITS.filter((def) => hautsFaits[def.id]);
  const aFaire = HAUTS_FAITS.filter((def) => !hautsFaits[def.id]);
  return (
    <>
      <p className="note">
        {faits.length} sur {HAUTS_FAITS.length} obtenus. Chaque haut fait rapporte des dollars, parfois un sticker de trophée.
      </p>
      {aFaire.length > 0 && <h3 className="jeu-titre">À faire</h3>}
      <ul className="jeu-liste">
        {aFaire.map((def) => (
          <LigneHautFait key={def.id} def={def} obtenu={false} />
        ))}
      </ul>
      {faits.length > 0 && <h3 className="jeu-titre">Obtenus</h3>}
      <ul className="jeu-liste">
        {faits.map((def) => (
          <LigneHautFait key={def.id} def={def} obtenu />
        ))}
      </ul>
    </>
  );
}

export function JeuPanel() {
  const [onglet, setOnglet] = useState<Onglet>('boutique');
  return (
    <>
      <Resume />
      <nav className="tabs" aria-label="Rubriques du jeu">
        {ONGLETS.map((item) => (
          <button key={item.id} type="button" aria-current={onglet === item.id ? 'true' : undefined} onClick={() => setOnglet(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>
      {onglet === 'boutique' ? <Boutique /> : <HautsFaits />}
    </>
  );
}
