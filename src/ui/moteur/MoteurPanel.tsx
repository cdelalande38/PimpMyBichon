// Mécanique · Moteur : l'établi (§ 5.11, première partie). Ouvrir l'entrée sort le moteur du véhicule
// sur son support (la scène, src/scene/moteur/Etabli.tsx) ; le panneau, tiré des données
// (src/data/moteurs.ts, src/data/optimisation.ts), va en deux étapes qui se remplacent (retour du 18
// novembre 2026 : « séparer la sélection des éléments des actions à mener dessus ») :
// 1. « Pièce » : la vue éclatée au curseur, la liste des pièces (chacune rappelle son traitement et son
//    niveau d'optimisation), le gain total du moteur et « D'origine » ; toucher une pièce l'allume et
//    passe à l'étape suivante ;
// 2. ses actions, en volets : Finition (traitement, couleur), Optimisation (niveaux payants qui comptent
//    pour la puissance), Échange (le filtre à air) ; la caméra cadre la pièce. « Retour » rend la liste,
//    la pièce encore allumée. L'étape est un niveau du dock (src/state/dock.ts, `element`) : le fil dit
//    « Mécanique · Moteur · Culasses ».
// L'origine (brut de fonderie, niveau d'origine, boîtier) et la peinture haute température sont libres ;
// ce qui n'est pas acquis porte un cadenas et son prix, un appui ouvre le bloc d'achat partagé
// (src/ui/jeu/Achat.tsx), et il s'applique une fois payé. Un véhicule dont le moteur n'a pas encore de
// modèle le dit en une phrase. Ajouter une famille, une pièce, un niveau ou une option ne touche pas à
// ce fichier.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { articleParId } from '../../data/boutique.ts';
import { gainPieces } from '../../data/enginePrep.ts';
import {
  articleEchange,
  articleTraitement,
  clesMoteur,
  cleMoteur,
  echangeLibre,
  ecritTraitement,
  familleOf,
  moteurTouche,
  resolveEchange,
  resolveTraitement,
  sansModele,
  traitementsDe,
  type EchangeOption,
  type MoteurPiece,
  type Traitement,
} from '../../data/moteurs.ts';
import { articleNiveau, cleNiveau, clesOptimisation, niveauxDe, optimisationMoteur, optimisationTouchee, ORIGINE_NIVEAU, resolveNiveau, type NiveauOptimisation } from '../../data/optimisation.ts';
import { PAINT_COLORS } from '../../data/paintColors.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import { possedeDans } from '../../jeu/achats.ts';
import { useEtabli } from '../../scene/moteur/etabli.ts';
import { normalizeHex, useBuilds } from '../../state/builds.ts';
import { useDock } from '../../state/dock.ts';
import { useJeu } from '../../state/jeu.ts';
import { Icon } from '../icons.tsx';
import { Achat } from '../jeu/Achat.tsx';
import { nomNonAcquis, NoteNonAcquise } from '../nonAcquis.tsx';
import { dollars } from '../jeu/libelles.ts';
import { Padlock } from '../paint/Padlock.tsx';
import { useRevealPressed } from '../scroll.ts';
import './moteur.css';

const NBSP = ' ';
const pourcent = (value: number) => `+${NBSP}${value}${NBSP}%`;
const chevaux = (value: number) => `+${NBSP}${value}${NBSP}ch`;

/** Volets de l'étape des actions d'une pièce. */
type Volet = 'finition' | 'optimisation' | 'echange';
const VOLETS: readonly { id: Volet; label: string }[] = [
  { id: 'finition', label: 'Finition' },
  { id: 'optimisation', label: 'Optimisation' },
  { id: 'echange', label: 'Échange' },
];

/** Ce qu'on est en train d'acheter : un traitement, une option d'échange ou un niveau d'une pièce. */
type EnAchat = { vehicle: string; piece: string; kind: Volet; id: string };

/** Pastille d'un traitement : un aperçu de sa matière (couleur choisie pour la peinture et l'anodisé). */
function Pastille({ traitement, couleur }: { traitement: Traitement; couleur: string | null }) {
  return <span className="moteur-pastille" data-traitement={traitement.id} style={traitement.teinte ? { background: couleur ?? traitement.teinte } : undefined} aria-hidden="true" />;
}

/** Prix d'une option verrouillée, derrière son cadenas. */
function Prix({ prix }: { prix: number }) {
  return (
    <small className="moteur-prix">
      <Padlock open={false} className="moteur-lock" />
      {dollars(prix)}
    </small>
  );
}

export function MoteurPanel() {
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const build = useBuilds((state) => state.builds[vehicle.id]);
  const setPart = useBuilds((state) => state.setPart);
  const setPartPaint = useBuilds((state) => state.setPartPaint);
  const rememberColor = useBuilds((state) => state.rememberColor);
  const resetKeys = useBuilds((state) => state.resetKeys);
  // Ce qui est acheté (src/state/jeu.ts) : le panneau suit un achat sans qu'on ait à le rouvrir.
  const acquis = useJeu((state) => state.articles);
  const eclate = useEtabli((state) => state.eclate);
  const setEclate = useEtabli((state) => state.setEclate);
  const allumee = useEtabli((state) => state.piece);
  const setPiece = useEtabli((state) => state.setPiece);
  const top = useDock((state) => state.levels.at(-1));
  const [achat, setAchat] = useState<EnAchat | null>(null);
  const [message, setMessage] = useState<{ vehicle: string; text: string } | null>(null);
  const [volet, setVolet] = useState<Volet>('finition');
  // Haut du panneau à l'écran (le dock qui le porte) : la scène cadre le moteur au-dessus.
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const dock = root.current?.closest<HTMLElement>('footer.dock') ?? root.current;
    if (!dock) return undefined;
    const measure = () => useEtabli.getState().setCoverTop(Math.round(dock.getBoundingClientRect().top));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      useEtabli.getState().setCoverTop(null);
    };
  }, []);

  const famille = familleOf(vehicle);
  // Étape des actions : la pièce du niveau `element` du dock ; une pièce que ce moteur n'a pas rend la liste.
  const ouverte: MoteurPiece | undefined = top?.kind === 'element' ? famille?.pieces.find((item) => item.id === top.element) : undefined;
  const ouverteId = ouverte?.id ?? null;
  const perdue = top?.kind === 'element' && !ouverte;
  useEffect(() => {
    if (perdue) useDock.getState().back();
  }, [perdue]);
  // La scène cadre la pièce dont on voit les actions, et la garde allumée au retour à la liste.
  useEffect(() => {
    useEtabli.getState().setCadree(ouverteId);
    if (ouverteId) useEtabli.getState().setPiece(ouverteId);
  }, [ouverteId]);
  useEffect(() => () => useEtabli.getState().setCadree(null), []);
  const pieceRow = useRevealPressed<HTMLDivElement>(ouverteId ? '' : (allumee ?? ''));

  if (!famille) {
    return (
      <div ref={root} className="moteur" data-testid="moteur">
        <p className="moteur-empty">{sansModele(vehicle)}</p>
      </div>
    );
  }

  const owned = (id: string | undefined) => id === undefined || possedeDans({ articles: acquis }, id);
  const gain = gainPieces(vehicle, build);
  const total = optimisationMoteur(famille, build);
  const touche = moteurTouche(famille, build) || optimisationTouchee(famille, build);
  const remettre = () => {
    const cles = clesMoteur(famille);
    resetKeys(vehicle.id, { parts: [...cles.parts, ...clesOptimisation(famille)], partPaints: cles.partPaints });
  };
  const ouvrir = (piece: MoteurPiece) => {
    setAchat(null);
    setMessage(null);
    setPiece(piece.id);
    useDock.getState().push({ kind: 'element', element: piece.id, libelle: piece.label });
  };
  const percent = Math.round(eclate * 100);

  if (!ouverte) {
    // Étape « Pièce » : la vue éclatée, la liste, le total du moteur ; rien d'autre.
    return (
      <div ref={root} className="moteur" data-testid="moteur" data-etape="piece" data-famille={famille.id} data-piece={allumee ?? undefined}>
        <label className="moteur-eclate">
          <span>Vue éclatée</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={percent}
            aria-valuetext={percent === 0 ? 'Assemblé' : `Éclaté à ${percent} %`}
            data-testid="moteur-eclate"
            onChange={(event) => setEclate(Number(event.target.value) / 100)}
          />
          <output>{percent === 0 ? 'Assemblé' : `${percent} %`}</output>
        </label>

        <div ref={pieceRow} className="chips moteur-pieces" role="group" aria-label="Pièces du moteur">
          {famille.pieces.map((item) => {
            const look = resolveTraitement(item, build);
            const niveau = resolveNiveau(item, build);
            return (
              <button key={item.id} type="button" className="chip moteur-piece" aria-pressed={item.id === allumee} data-piece={item.id} data-niveau={niveau?.id} onClick={() => ouvrir(item)}>
                <b>{item.label}</b>
                <small className="moteur-piece-etat">
                  <Pastille traitement={look.traitement} couleur={look.couleur} />
                  {look.traitement.label}
                </small>
                {niveauxDe(item).length > 0 && <small className="moteur-piece-niveau">{niveau ? `${niveau.label} · ${pourcent(niveau.puissance)}` : 'Optimisable'}</small>}
              </button>
            );
          })}
        </div>

        <div className="moteur-head">
          <p className="moteur-note">
            <span>
              {famille.label}
              {famille.placeholder ? ' · modèle provisoire' : ''}
            </span>
            {total.max > 0 && (
              <span className="moteur-total" data-testid="moteur-total" data-pourcent={total.pourcent}>
                Optimisé : <b>{pourcent(total.pourcent)}</b>
                {gain && gain.chevaux > 0 ? ` · ${chevaux(gain.chevaux)}` : ''} sur {pourcent(total.max)}
              </span>
            )}
          </p>
          {/* Place du bouton du capot (lot « capot », ouvrirCapot / fermerCapot) : ici, avant « D'origine ». */}
          <button type="button" className="btn moteur-reset" disabled={!touche} onClick={remettre}>
            <Icon name="origine" />
            <span>D’origine</span>
          </button>
        </div>
      </div>
    );
  }

  // Étape des actions de la pièce ouverte : un volet à la fois.
  const piece = ouverte;
  const resolved = resolveTraitement(piece, build);
  const posee = resolveEchange(piece, build);
  const niveaux = niveauxDe(piece);
  const niveau = resolveNiveau(piece, build);
  const volets = VOLETS.filter((item) => item.id === 'finition' || (item.id === 'optimisation' && niveaux.length > 0) || (item.id === 'echange' && piece.echange !== undefined));
  const shown: Volet = volets.some((item) => item.id === volet) ? volet : 'finition';
  const enAchat = achat?.vehicle === vehicle.id && achat.piece === piece.id ? achat : null;

  const traitementArticle = (traitement: Traitement) => (traitement.libre ? undefined : articleParId(articleTraitement(traitement.id)));
  const traitementLocked = (traitement: Traitement) => !owned(traitementArticle(traitement)?.id);
  const echangeArticle = (option: EchangeOption) => (echangeLibre(piece, option.id) ? undefined : articleParId(articleEchange(piece.id, option.id)));
  const echangeLocked = (option: EchangeOption) => !owned(echangeArticle(option)?.id);
  const niveauArticle = (item: NiveauOptimisation) => (piece.optimisation ? articleParId(articleNiveau(piece.optimisation, item.id)) : undefined);
  const niveauLocked = (item: NiveauOptimisation) => !owned(niveauArticle(item)?.id);

  const key = cleMoteur(piece.id);
  const stored = build?.partPaints?.[key]?.color;
  const applyTraitement = (traitement: Traitement) => setPartPaint(vehicle.id, key, ecritTraitement(traitement, resolved.couleur ?? stored));
  const paintColor = (hex: string) => {
    const value = normalizeHex(hex);
    if (!value || !resolved.traitement.porte) return;
    setPartPaint(vehicle.id, key, { finish: resolved.traitement.porte, color: value });
    rememberColor(value);
  };
  const poseOption = (id: string) => setPart(vehicle.id, key, piece.echange?.origine === id ? null : id);
  const poseNiveau = (id: string | null) => setPart(vehicle.id, cleNiveau(piece.id), id);
  /** Un choix : appliqué s'il est libre ou acquis ; sinon le bloc d'achat s'ouvre (ou se referme). */
  const choisir = (kind: Volet, id: string, locked: boolean, apply: () => void) => {
    setMessage(null);
    if (locked) {
      setAchat(enAchat?.kind === kind && enAchat.id === id ? null : { vehicle: vehicle.id, piece: piece.id, kind, id });
      return;
    }
    setAchat(null);
    apply();
  };
  const fini = (text: string, apply: () => void) => {
    setAchat(null);
    setMessage({ vehicle: vehicle.id, text });
    apply();
  };

  // Bloc d'achat ouvert : sur ce qu'on a touché, tant que ce n'est pas acquis.
  const buyTraitement = enAchat?.kind === 'finition' ? traitementsDe(piece).find((item) => item.id === enAchat.id && traitementLocked(item)) : undefined;
  const buyOption = enAchat?.kind === 'echange' ? piece.echange?.options.find((item) => item.id === enAchat.id && echangeLocked(item)) : undefined;
  const buyNiveau = enAchat?.kind === 'optimisation' ? niveaux.find((item) => item.id === enAchat.id && niveauLocked(item)) : undefined;
  const buyTraitementArticle = buyTraitement ? traitementArticle(buyTraitement) : undefined;
  const buyOptionArticle = buyOption ? echangeArticle(buyOption) : undefined;
  const buyNiveauArticle = buyNiveau ? niveauArticle(buyNiveau) : undefined;
  // Ce que fait le niveau en vue : celui qu'on achète, sinon celui qui est posé.
  const vu = buyNiveau ?? niveau;

  return (
    <div
      ref={root}
      className="moteur"
      data-testid="moteur"
      data-etape="actions"
      data-famille={famille.id}
      data-piece={piece.id}
      data-volet={shown}
      data-traitement={resolved.traitement.id}
      data-option={posee?.id}
      data-niveau={niveaux.length > 0 ? (niveau?.id ?? 'origine') : undefined}
    >
      {volets.length > 1 ? (
        <div className="moteur-volets" role="group" aria-label={`${piece.label} : que faire ?`}>
          {volets.map((item) => (
            <button
              key={item.id}
              type="button"
              className="moteur-volet"
              data-volet={item.id}
              aria-pressed={item.id === shown}
              onClick={() => {
                setAchat(null);
                setMessage(null);
                setVolet(item.id);
              }}
            >
              <b>{item.label}</b>
              <small>{item.id === 'finition' ? resolved.traitement.label : item.id === 'optimisation' ? (niveau ? pourcent(niveau.puissance) : ORIGINE_NIVEAU.label) : (posee?.label ?? '')}</small>
            </button>
          ))}
        </div>
      ) : (
        <p className="moteur-rubrique">Finition</p>
      )}

      {shown === 'finition' && (
        <Finition
          piece={piece}
          resolved={resolved}
          locked={traitementLocked}
          prix={(item) => traitementArticle(item)?.prix ?? 0}
          enAchat={buyTraitement?.id}
          onPick={(item) => choisir('finition', item.id, traitementLocked(item), () => applyTraitement(item))}
          onColor={paintColor}
        />
      )}

      {shown === 'optimisation' && (
        <>
          <div className="chips moteur-niveaux" role="group" aria-label={`Optimisation · ${piece.label}`}>
            <button type="button" className="chip moteur-niveau" data-niveau="origine" aria-pressed={niveau === null} onClick={() => choisir('optimisation', 'origine', false, () => poseNiveau(null))}>
              <b>{ORIGINE_NIVEAU.label}</b>
              <small className="moteur-gain">{pourcent(0)}</small>
            </button>
            {niveaux.map((item) => {
              const shut = niveauLocked(item);
              const prix = niveauArticle(item)?.prix ?? 0;
              const ch = gain ? Math.round((gain.base * item.puissance) / 100) : null;
              const gagne = `${pourcent(item.puissance)}${ch ? ` · ${chevaux(ch)}` : ''}`;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="chip moteur-niveau"
                  data-niveau={item.id}
                  data-verrou={shut ? 'ferme' : undefined}
                  aria-pressed={niveau?.id === item.id}
                  aria-expanded={shut ? buyNiveau?.id === item.id : undefined}
                  aria-label={`${item.label}, ${gagne.replaceAll(NBSP, ' ')}${shut ? `, verrouillé : ${prix} dollars` : ''}`}
                  onClick={() => choisir('optimisation', item.id, shut, () => poseNiveau(item.id))}
                >
                  <b>{item.label}</b>
                  <small className="moteur-gain">{gagne}</small>
                  {shut && <Prix prix={prix} />}
                </button>
              );
            })}
          </div>
          <p className="moteur-effet">{vu ? `${vu.label} : ${vu.effet}` : `${ORIGINE_NIVEAU.effet}. Un niveau acheté vaut pour tous tes moteurs.`}</p>
        </>
      )}

      {shown === 'echange' && piece.echange && posee && (
        <div className="chips moteur-echange" role="group" aria-label={piece.echange.label}>
          {piece.echange.options.map((option) => {
            const shut = echangeLocked(option);
            const price = echangeArticle(option)?.prix ?? 0;
            return (
              <button
                key={option.id}
                type="button"
                className="chip moteur-option"
                aria-pressed={posee.id === option.id}
                aria-expanded={shut ? buyOption?.id === option.id : undefined}
                aria-label={shut ? (posee.id === option.id ? nomNonAcquis(option.label, price) : `${option.label}, verrouillé : ${price} dollars`) : option.label}
                data-option={option.id}
                data-verrou={shut ? 'ferme' : undefined}
                onClick={() => choisir('echange', option.id, shut, () => poseOption(option.id))}
              >
                <b>{option.label}</b>
                {shut ? <Prix prix={price} /> : option.hint && <small className="moteur-hint">{option.hint}</small>}
              </button>
            );
          })}
        </div>
      )}
      {shown === 'echange' && piece.echange && posee && echangeLocked(posee) && <NoteNonAcquise label={posee.label} prix={echangeArticle(posee)?.prix} />}

      {buyTraitement && buyTraitementArticle && (
        <Achat
          key={`traitement-${buyTraitement.id}`}
          article={buyTraitementArticle}
          nom={buyTraitement.phrase}
          fait={`Payé : ${buyTraitement.phrase} est à toi, pour toutes les pièces de tous tes moteurs.`}
          onClose={() => setAchat(null)}
          onDone={(text) => fini(text, () => applyTraitement(buyTraitement))}
        />
      )}
      {buyNiveau && buyNiveauArticle && (
        <Achat
          key={`niveau-${buyNiveau.id}`}
          article={buyNiveauArticle}
          nom={buyNiveau.phrase}
          fait={`Payé, c’est monté : ${buyNiveau.label.toLowerCase()}, ${pourcent(buyNiveau.puissance)}, sur tous tes moteurs.`}
          onClose={() => setAchat(null)}
          onDone={(text) => fini(text, () => poseNiveau(buyNiveau.id))}
        />
      )}
      {buyOption && buyOptionArticle && (
        <Achat
          key={`echange-${buyOption.id}`}
          article={buyOptionArticle}
          fait="Payé : c’est monté, et l’échange vaut pour tous tes moteurs."
          onClose={() => setAchat(null)}
          onDone={(text) => fini(text, () => poseOption(buyOption.id))}
        />
      )}

      {message?.vehicle === vehicle.id && (
        <p className="moteur-message" role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}

interface FinitionProps {
  piece: MoteurPiece;
  resolved: ReturnType<typeof resolveTraitement>;
  locked: (traitement: Traitement) => boolean;
  prix: (traitement: Traitement) => number;
  /** Traitement dont le bloc d'achat est ouvert. */
  enAchat: string | undefined;
  onPick: (traitement: Traitement) => void;
  onColor: (hex: string) => void;
}

/** Volet « Finition » : les traitements de la pièce, puis la teinte quand le traitement en prend une. */
function Finition({ piece, resolved, locked, prix, enAchat, onPick, onColor }: FinitionProps) {
  const row = useRevealPressed<HTMLDivElement>(`${piece.id}:${resolved.traitement.id}`);
  return (
    <>
      <div ref={row} className="chips moteur-traitements" role="group" aria-label={`Traitement · ${piece.label}`}>
        {traitementsDe(piece).map((traitement) => {
          const shut = locked(traitement);
          const price = prix(traitement);
          return (
            <button
              key={traitement.id}
              type="button"
              className="chip moteur-traitement"
              aria-pressed={resolved.traitement.id === traitement.id}
              aria-expanded={shut ? enAchat === traitement.id : undefined}
              aria-label={shut ? (resolved.traitement.id === traitement.id ? nomNonAcquis(traitement.label, price) : `${traitement.label}, verrouillé : ${price} dollars`) : traitement.label}
              data-traitement={traitement.id}
              data-verrou={shut ? 'ferme' : undefined}
              onClick={() => onPick(traitement)}
            >
              <b>
                <Pastille traitement={traitement} couleur={resolved.traitement.id === traitement.id ? resolved.couleur : null} />
                {traitement.label}
              </b>
              {shut ? <Prix prix={price} /> : <small className="moteur-hint">{traitement.hint}</small>}
            </button>
          );
        })}
      </div>
      {/* Un traitement payant posé sans être acquis reste en place : le panneau le dit (src/ui/nonAcquis.tsx). */}
      {locked(resolved.traitement) && <NoteNonAcquise label={resolved.traitement.label} prix={prix(resolved.traitement)} />}
      {resolved.traitement.teinte && (
        <div className="moteur-swatches" role="group" aria-label={`${resolved.traitement.label} : teinte`}>
          {PAINT_COLORS.map((swatch) => (
            <button key={swatch.id} type="button" className="moteur-swatch" style={{ background: swatch.hex }} aria-label={swatch.label} aria-pressed={resolved.couleur === swatch.hex} onClick={() => onColor(swatch.hex)} />
          ))}
          <label className="moteur-swatch moteur-swatch-free" style={{ background: resolved.couleur ?? undefined }} title="Autre couleur">
            <span>+</span>
            <input type="color" aria-label="Autre couleur" value={resolved.couleur ?? '#000000'} onChange={(event) => onColor(event.target.value)} />
          </label>
        </div>
      )}
    </>
  );
}
