// Coque de l'app : la scène 3D en fond, le HUD en haut (lecture seule), le dock en bas
// (toutes les commandes), et un panneau bas piloté par l'adresse.

import { lazy, Suspense, useEffect, useState } from 'react';
import { useBench } from '../state/bench.ts';
import { useSettings } from '../state/store.ts';
import { Dock } from '../ui/Dock.tsx';
import { Hud } from '../ui/Hud.tsx';
import { PhotoBar } from '../ui/PhotoBar.tsx';
import { Sheets } from '../ui/Sheets.tsx';
import { isSheetRoute } from './router.ts';
import { SceneBoundary } from './SceneBoundary.tsx';
import { useRoute } from './useRoute.ts';

// three.js et la scène arrivent dans un second temps : la coque s'affiche d'abord.
const GarageCanvas = lazy(() => import('../scene/GarageCanvas.tsx'));

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
  const photo = route.name === 'photo' && !sceneFailed;

  // La taille du texte s'applique à la racine : toute l'interface est dimensionnée en rem.
  useEffect(() => {
    document.documentElement.dataset.text = textSize;
  }, [textSize]);

  return (
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
          <Hud />

          <div className="mid">
            {/* Jamais de substitut en silence : celui-ci est annoncé à l'écran. */}
            {!sceneFailed && (
              <p className="tag" role="status">
                Substitut · modèle de banc d’essai
                {benchStatus === 'chargement' && ' · en route…'}
                {benchStatus === 'erreur' && ' · introuvable, relance avec du réseau'}
              </p>
            )}
            {sceneFailed && <SceneFailure />}
          </div>

          <Dock sceneFailed={sceneFailed} />
        </>
      )}
      <Sheets route={route} />
    </div>
  );
}
