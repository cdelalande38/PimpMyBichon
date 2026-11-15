// Tutoriels : le premier passage (le tutoriel d'un écran se propose tout seul, une seule fois), le
// bouton « ? » (Aide) qui rouvre celui de l'écran et donne la liste de tous, et le dialogue qui les
// déroule. L'écran courant se lit depuis la route, la vue et le dock, sans toucher à leurs composants.
// Monté hors de la coque (.app) : il ne bouscule ni la grille de l'écran ni ses boutons.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRoute } from '../../app/useRoute.ts';
import { activeEntry, visibleSections } from '../../data/dockMenu.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import { TUTO_ACCUEIL, TUTOS, tutoById, tutoForEcran, type EcranKey } from '../../data/tutos.ts';
import { useBuilds } from '../../state/builds.ts';
import { useDock } from '../../state/dock.ts';
import { useTutos } from '../../state/tutos.ts';
import { useView } from '../../state/view.ts';
import { ecranCourant, ecranDuGarage, premierPassageActif } from './ecran.ts';
import './tuto.css';

/** L'écran doit rester le même ce temps-là avant que son tutoriel se propose (et qu'un panneau soit posé). */
const DELAI_MS = 700;

// L'app s'ouvre sur « Véhicule » (l'accueil) : on retient, pour la séance, qu'on en est sorti une fois.
let sortiAccueil = useDock.getState().section !== 'vehicule';
useDock.subscribe((state) => {
  if (state.section !== 'vehicule') sortiAccueil = true;
});

/** Écran courant, tenu à jour avec la route, la vue et le dock. */
function useEcran(): EcranKey | null {
  const route = useRoute();
  const vue = useView((state) => state.mode);
  const closed = useDock((state) => state.closed);
  const menu = useDock((state) => state.menu);
  const chosen = useDock((state) => state.section);
  const remembered = useDock((state) => state.entries);
  const hasEngine = resolveVehicle(useBuilds((state) => state.current)).engine !== undefined;

  // Comme le dock : une section absente pour ce véhicule (Mécanique sans moteur) retombe sur la première.
  const sections = visibleSections(hasEngine);
  const section = sections.find((item) => item.id === chosen) ?? sections[0];
  const entry = section ? activeEntry(section, remembered[section.id]) : undefined;

  if (!section || !entry) return null;
  return ecranCourant({ route, vue, dock: { closed, section: section.id, entry: entry.id, menu }, sortiAccueil });
}

/** Rectangle qui englobe les éléments visés (visibles) ; `null` s'il n'y en a aucun à l'écran. */
function rectCible(selecteur: string | undefined): { left: number; top: number; width: number; height: number } | null {
  if (!selecteur) return null;
  let elements: Element[];
  try {
    elements = [...document.querySelectorAll(selecteur)];
  } catch {
    return null;
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const element of elements) {
    if (element.closest('dialog.tuto')) continue;
    if (typeof element.checkVisibility === 'function' && !element.checkVisibility()) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  if (!Number.isFinite(left)) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/** Le dialogue : un tutoriel étape par étape, ou la liste de tous. */
function TutoDialog() {
  const ouvert = useTutos((state) => state.ouvert);
  const liste = useTutos((state) => state.liste);
  const { ouvrir, etape: allerA, montrerListe, fermer } = useTutos.getState();
  const dialog = useRef<HTMLDialogElement>(null);
  const principal = useRef<HTMLButtonElement>(null);
  const titreId = useId();
  const butId = useId();
  const texteId = useId();
  const [cible, setCible] = useState<ReturnType<typeof rectCible>>(null);
  const [hauteur, setHauteur] = useState(() => window.innerHeight);

  const tuto = ouvert ? tutoById(ouvert.id) : undefined;
  const index = ouvert && tuto ? Math.min(ouvert.etape, tuto.etapes.length - 1) : 0;
  const etape = tuto?.etapes[index];
  const derniere = tuto ? index === tuto.etapes.length - 1 : false;

  // Ouvert en modal (au-dessus d'un panneau ouvert, lui-même modal) ; refermé avant de disparaître,
  // pour que le navigateur rende le focus là où il était.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      if (element?.open) element.close();
    };
  }, []);

  // Le focus va sur le bouton principal, en bas, sous le pouce.
  useEffect(() => {
    principal.current?.focus({ preventScroll: true });
  }, [liste, ouvert?.id]);

  // L'élément visé : mesuré à chaque étape et quand l'écran change de taille.
  useLayoutEffect(() => {
    const mesurer = () => {
      setCible(rectCible(etape?.cible));
      setHauteur(window.innerHeight);
    };
    mesurer();
    window.addEventListener('resize', mesurer);
    return () => window.removeEventListener('resize', mesurer);
  }, [etape?.cible]);

  // Cible dans le bas de l'écran (le dock) : la carte se pose juste au-dessus, pour la laisser voir.
  let place: CSSProperties | undefined;
  if (cible && !liste && cible.top + cible.height / 2 > hauteur / 2 && cible.top - 24 >= 200) {
    place = { bottom: `${Math.round(hauteur - cible.top + 12)}px`, maxHeight: `${Math.round(cible.top - 24)}px` };
  }
  const spot = cible && !liste ? cible : null;

  return (
    <dialog
      ref={dialog}
      className="tuto"
      data-cible={spot ? '' : undefined}
      aria-labelledby={titreId}
      aria-describedby={liste ? undefined : `${butId} ${texteId}`}
      // Échap ou geste retour : comme « Passer ».
      onCancel={(event) => {
        event.preventDefault();
        fermer();
      }}
    >
      {spot && (
        <div
          className="tuto-spot"
          aria-hidden="true"
          style={{ left: spot.left - 6, top: spot.top - 6, width: spot.width + 12, height: spot.height + 12 }}
        />
      )}
      {liste ? (
        <div className="tuto-carte tuto-carte-liste">
          <div className="tuto-defile">
            <p className="eyebrow">Aide</p>
            <h2 id={titreId}>Tous les tutos</h2>
            <ul className="tuto-liste">
              {TUTOS.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => ouvrir(item.id)}>
                    <b>{item.titre}</b>
                    <span>{item.but}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="tuto-acts">
            <button ref={principal} type="button" className="btn cta" onClick={fermer}>
              Fermer
            </button>
          </div>
        </div>
      ) : (
        tuto &&
        etape && (
          <div className="tuto-carte" style={place}>
            <div className="tuto-defile">
              <div className="tuto-tete">
                <p className="eyebrow">
                  Tuto · {index + 1} sur {tuto.etapes.length}
                </p>
                {!ouvert?.auto && (
                  <button type="button" className="tuto-tous" onClick={montrerListe}>
                    Tous les tutos
                  </button>
                )}
              </div>
              <h2 id={titreId}>{tuto.titre}</h2>
              <p className="tuto-but" id={butId}>
                {tuto.but}
              </p>
              <p className="tuto-texte" id={texteId} aria-live="polite">
                {etape.texte}
              </p>
              <ol className="tuto-points" aria-hidden="true">
                {tuto.etapes.map((item, rang) => (
                  <li key={item.texte} data-on={rang <= index || undefined} />
                ))}
              </ol>
            </div>
            <div className="tuto-acts">
              {!derniere && (
                <button type="button" className="btn" onClick={fermer}>
                  Passer
                </button>
              )}
              <button ref={principal} type="button" className="btn cta" onClick={() => (derniere ? fermer() : allerA(index + 1))}>
                {derniere ? 'C’est parti' : 'Suivant'}
              </button>
            </div>
          </div>
        )
      )}
    </dialog>
  );
}

/** Bouton « ? », en haut à gauche sous l'étiquette du véhicule ; caché en mode photo. */
function BoutonAide({ ecran }: { ecran: EcranKey | null }) {
  const ouvrir = useTutos((state) => state.ouvrir);
  return (
    <button
      type="button"
      className="tuto-aide"
      aria-label="Aide"
      title="Aide : ce qu’on fait sur cet écran, et tous les tutos"
      onClick={() => ouvrir((tutoForEcran(ecran) ?? tutoById(TUTO_ACCUEIL) ?? TUTOS[0])?.id ?? TUTO_ACCUEIL)}
    >
      <span aria-hidden="true">?</span>
    </button>
  );
}

export function Tutos() {
  const ecran = useEcran();
  const hydrated = useTutos((state) => state.hydrated);
  const pret = useTutos((state) => state.pret);
  const ouvert = useTutos((state) => state.ouvert);
  const liste = useTutos((state) => state.liste);
  const vus = useTutos((state) => state.vus);
  // Lu une fois : le paramètre d'adresse reste dans l'adresse d'un panneau à l'autre (router.ts).
  const actif = useMemo(() => premierPassageActif(navigator.webdriver === true, window.location.search), []);

  // Premier passage : l'accueil d'abord (sur les écrans du garage), puis le tutoriel de chaque écran.
  useEffect(() => {
    if (!actif || !hydrated || !pret || ouvert || liste) return;
    const candidat = ecranDuGarage(ecran) && !vus[TUTO_ACCUEIL] ? tutoById(TUTO_ACCUEIL) : tutoForEcran(ecran);
    if (!candidat || vus[candidat.id]) return;
    const timer = window.setTimeout(() => useTutos.getState().ouvrir(candidat.id, true), DELAI_MS);
    return () => window.clearTimeout(timer);
  }, [actif, hydrated, pret, ouvert, liste, ecran, vus]);

  return (
    <>
      {pret && ecran !== 'photo' && <BoutonAide ecran={ecran} />}
      {(ouvert || liste) && <TutoDialog />}
    </>
  );
}
