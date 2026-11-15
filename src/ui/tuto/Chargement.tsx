// Écran de chargement : la marque et trois étapes (l'atelier, le garage, le véhicule), par-dessus
// tout, le temps que la scène soit prête ; puis il s'efface en fondu. Il ne lit que des faits que la
// scène expose déjà (image dessinée, état du véhicule) : aucune attente ajoutée, aucun rendu forcé.
// Il ne retient jamais l'app : la scène tombe, le véhicule manque ou tout tarde trop, et il cède la
// place à ce que l'app affiche déjà dans ce cas (alerte, étiquette « en route… », texte d'attente).
// Il ne prend aucun appui (pointer-events: none) : rien de ce qu'il couvre n'est bloqué.

import { useEffect, useState } from 'react';
import { useMediaQuery } from '../../app/useMediaQuery.ts';
import { useRenderStats } from '../../render/renderStats.ts';
import { useBench } from '../../state/bench.ts';
import { useTutos } from '../../state/tutos.ts';
import './tuto.css';

/** Au-delà, l'écran de chargement s'efface quoi qu'il arrive. */
export const PATIENCE_MS = 10_000;
/** Le garage dessiné, le véhicule a ce temps-là pour arriver ; sinon l'étiquette « en route… » prend le relais. */
export const GRACE_VEHICULE_MS = 3_000;
const FONDU_MS = 450;

const ETAPES = [
  { nom: 'L’atelier', enCours: 'L’atelier se prépare' },
  { nom: 'Le garage', enCours: 'Le garage s’allume' },
  { nom: 'Le véhicule', enCours: 'Le véhicule entre au garage' },
] as const;

export function Chargement({ sceneFailed }: { sceneFailed: boolean }) {
  const [atelier, setAtelier] = useState(false);
  const [lasse, setLasse] = useState(false);
  const [fonduFini, setFonduFini] = useState(false);
  // Première image dessinée par la scène (src/scene/SceneProbe.tsx).
  const garage = useRenderStats((state) => state.frame !== null);
  const bench = useBench((state) => state.status);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const setPret = useTutos((state) => state.setPret);

  useEffect(() => {
    let vivant = true;
    // Le module de la scène, déjà demandé par App.tsx : on apprend seulement qu'il est arrivé.
    import('../../scene/GarageCanvas.tsx').then(
      () => vivant && setAtelier(true),
      () => undefined,
    );
    const timer = window.setTimeout(() => setLasse(true), PATIENCE_MS);
    return () => {
      vivant = false;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!garage) return;
    const timer = window.setTimeout(() => setLasse(true), GRACE_VEHICULE_MS);
    return () => window.clearTimeout(timer);
  }, [garage]);

  const faites = !atelier ? 0 : !garage ? 1 : bench === 'chargement' ? 2 : 3;
  // Une fois fini, il le reste : « Réessayer » ou un autre véhicule remettent le banc en chargement,
  // l'écran de chargement ne revient pas pour autant.
  const [dejaFini, setDejaFini] = useState(false);
  const fini = dejaFini || sceneFailed || lasse || bench === 'absent' || bench === 'erreur' || faites === 3;
  if (fini && !dejaFini) setDejaFini(true);

  // Fondu quand tout est prêt, sauf en mouvement réduit. S'il cède la place (échec, attente trop
  // longue), il part d'un coup : ce qu'il couvrait doit se voir tout de suite.
  const fondu = faites === 3 && !reduced;
  // Parti, il ne revient plus (même si le fondu en cours perd sa raison d'être).
  const [dejaParti, setDejaParti] = useState(false);
  const parti = dejaParti || (fini && (!fondu || fonduFini));
  if (parti && !dejaParti) setDejaParti(true);
  useEffect(() => {
    if (!fini || !fondu) return;
    const timer = window.setTimeout(() => setFonduFini(true), FONDU_MS);
    return () => window.clearTimeout(timer);
  }, [fini, fondu]);

  useEffect(() => {
    if (parti) setPret();
  }, [parti, setPret]);

  if (parti) return null;
  const courante = ETAPES[Math.min(faites, ETAPES.length - 1)] ?? ETAPES[0];

  return (
    <div
      className="tuto-chargement"
      data-fini={fini || undefined}
      role="progressbar"
      aria-label="Ouverture du garage"
      aria-valuemin={0}
      aria-valuemax={ETAPES.length}
      aria-valuenow={faites}
      aria-valuetext={faites >= ETAPES.length ? 'Tout est prêt' : `${courante.enCours}, étape ${faites + 1} sur ${ETAPES.length}`}
      aria-hidden={fini || undefined}
    >
      <div className="tuto-chargement-bas">
        <p className="tuto-marque">
          <span>Pimp my</span>
          <b>Bichon</b>
        </p>
        <ol className="tuto-etapes">
          {ETAPES.map((etape, index) => (
            <li key={etape.nom} data-etat={index < faites ? 'fait' : index === faites ? 'encours' : 'attente'}>
              {etape.nom}
            </li>
          ))}
        </ol>
        <div className="tuto-barre">
          <i style={{ transform: `scaleX(${Math.max(0.06, faites / ETAPES.length)})` }} />
        </div>
        <p className="tuto-chargement-texte">{faites >= ETAPES.length ? 'Tout est prêt' : `${courante.enCours}…`}</p>
      </div>
    </div>
  );
}
