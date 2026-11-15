// Coque de l'app : la scène 3D en fond, le HUD en haut (marque, état, boutons ronds de la radio, de
// la photo et de l'atelier), le dock en bas (la personnalisation), et un panneau bas piloté par l'adresse.

import { lazy, Suspense, useEffect, useState, type CSSProperties } from 'react';
import { resolveVehicle } from '../data/vehicles.ts';
import { useBench } from '../state/bench.ts';
import { useBuilds } from '../state/builds.ts';
import { useSettings } from '../state/store.ts';
import { Dock } from '../ui/Dock.tsx';
import { Hud } from '../ui/Hud.tsx';
import { SceneOverlay } from '../ui/overlay/SceneOverlay.tsx';
import { PhotoBar } from '../ui/PhotoBar.tsx';
import { Sheets } from '../ui/Sheets.tsx';
import { Chargement } from '../ui/tuto/Chargement.tsx';
import { Tutos } from '../ui/tuto/Tutos.tsx';
import { isSheetRoute } from './router.ts';
import { SceneBoundary } from './SceneBoundary.tsx';
import { useRoute } from './useRoute.ts';

// three.js et la scène arrivent dans un second temps : la coque s'affiche d'abord.
const GarageCanvas = lazy(() => import('../scene/GarageCanvas.tsx'));

/**
 * « Réessayer » : en bas de la zone centrale, comme l'alerte, à portée du pouce (le haut à gauche est
 * pris par le bouton « ? »). La zone laisse passer les gestes vers la scène ; le bouton, lui, se touche.
 */
const RETRY: CSSProperties = { flex: 'none', marginTop: 'auto', pointerEvents: 'auto' };

function SceneFailure() {
  return (
    <p className="alert" role="alert">
      <b>Le garage 3D ne démarre pas.</b> Si c’est ta première visite, vérifie ta connexion. Sinon,
      ton navigateur a peut-être besoin d’une mise à jour (il faut WebGL 2).
    </p>
  );
}

export function App() {
  const route = useRoute();
  const textSize = useSettings((state) => state.textSize);
  const [sceneFailed, setSceneFailed] = useState(false);
  const benchStatus = useBench((state) => state.status);
  const setBenchStatus = useBench((state) => state.setStatus);
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const photo = route.name === 'photo' && !sceneFailed;

  // La taille du texte s'applique à la racine : toute l'interface est dimensionnée en rem.
  useEffect(() => {
    document.documentElement.dataset.text = textSize;
  }, [textSize]);

  return (
    <>
      <div className="app">
        <SceneBoundary onFail={() => setSceneFailed(true)}>
          <Suspense fallback={<p className="stage-wait">Ouverture du garage…</p>}>
            <GarageCanvas paused={isSheetRoute(route)} photo={photo} />
          </Suspense>
        </SceneBoundary>

        {photo ? (
          // Mode photo : l'interface s'efface, la scène prend l'écran.
          <>
            <div className="mid" />
            <PhotoBar />
          </>
        ) : (
          <>
            {/* Panneau ouvert : le haut de l'écran et le dock passent derrière, hors d'atteinte. */}
            <Hud sceneFailed={sceneFailed} covered={isSheetRoute(route)} />
            {/* Ce qui se pose sur l'image sans toucher à ce fichier (pastilles de la pièce). */}
            {!sceneFailed && <SceneOverlay covered={isSheetRoute(route)} />}

            <div className="mid">
              {/* Jamais de substitut en silence : il est annoncé à l'écran, comme le chargement. */}
              {!sceneFailed && (vehicle.placeholder !== undefined || benchStatus !== 'pret') && (
                <p className="tag" role="status">
                  {vehicle.placeholder !== undefined ? `Substitut · ${vehicle.name}` : vehicle.name}
                  {benchStatus === 'chargement' && ' · en route…'}
                  {benchStatus === 'absent' && ' · modèle absent de cette version'}
                  {benchStatus === 'erreur' && ' · introuvable, relance avec du réseau'}
                </p>
              )}
              {/* Modèle tombé : nouvel essai sur le même véhicule (src/scene/GarageCanvas.tsx), sous le pouce. */}
              {!sceneFailed && benchStatus === 'erreur' && (
                <button type="button" className="btn" style={RETRY} onClick={() => setBenchStatus('chargement')}>
                  Réessayer
                </button>
              )}
              {sceneFailed && <SceneFailure />}
            </div>

            <Dock sceneFailed={sceneFailed} covered={isSheetRoute(route)} />
          </>
        )}
        <Sheets route={route} />
      </div>
      {/* Accueil d'un nouvel utilisateur, hors de la coque : écran de chargement, tutos et bouton « ? ». */}
      <Chargement sceneFailed={sceneFailed} />
      <Tutos />
    </>
  );
}
