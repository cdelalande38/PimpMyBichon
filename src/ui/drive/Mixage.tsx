// Panneau « Son » de la sortie de nuit (§ 5.5 « Son ») : trois curseurs « Radio », « Moteur »,
// « Route », de 0 à 100 %, gardés d'une sortie à l'autre (src/state/mixage.ts), effet immédiat
// (src/drive/son.ts). Un bouton « Son » dans la barre des commandes ouvre le panneau au-dessus de
// la barre ; Échap ou un appui ailleurs le ferme. Pour les parcours, le bloc porte le mélange
// appliqué : data-radio (facteur de la radio), data-moteur-niveau, data-route (niveaux),
// data-bruitage et data-bruitages (dernier bruitage ponctuel parti, et leur nombre).

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useSonSortie } from '../../drive/son.ts';
import { useMixage, VOIES_MIXAGE } from '../../state/mixage.ts';
import './mixage.css';

/** Trois curseurs de table de mixage. */
function IconeMixage() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M6 4v16M12 4v16M18 4v16" />
      </g>
      <g fill="currentColor">
        <rect x="3.5" y="12" width="5" height="3" rx="1" />
        <rect x="9.5" y="7" width="5" height="3" rx="1" />
        <rect x="15.5" y="14" width="5" height="3" rx="1" />
      </g>
    </svg>
  );
}

const AIDE: Record<string, string> = {
  radio: 'Ce qui reste de la radio quand le moteur tourne.',
  moteur: 'Le moteur, du ralenti au rupteur.',
  route: 'Pneus, vent, pluie, freinage, rapports.',
};

export function Mixage() {
  const [ouvert, setOuvert] = useState(false);
  const [bas, setBas] = useState<number | null>(null);
  const id = useId();
  const bloc = useRef<HTMLDivElement>(null);
  const reglages = useMixage();
  const { radio, niveau, route, bruitage, bruitages } = useSonSortie();

  // Le panneau s'ouvre juste au-dessus de la barre des commandes, quelle que soit sa hauteur.
  const basculer = () => {
    if (!ouvert) {
      const barre = bloc.current?.closest('.drive-bar') ?? bloc.current;
      const haut = barre?.getBoundingClientRect().top;
      setBas(typeof haut === 'number' ? Math.max(8, window.innerHeight - haut + 8) : null);
    }
    setOuvert(!ouvert);
  };

  // Échap ou un appui ailleurs (la route, une autre commande, la barre qui se replie) le ferme.
  useEffect(() => {
    if (!ouvert) return;
    const surTouche = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOuvert(false);
    };
    const surAppui = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !bloc.current?.contains(event.target)) setOuvert(false);
    };
    window.addEventListener('keydown', surTouche);
    document.addEventListener('pointerdown', surAppui, true);
    return () => {
      window.removeEventListener('keydown', surTouche);
      document.removeEventListener('pointerdown', surAppui, true);
    };
  }, [ouvert]);

  return (
    <div
      ref={bloc}
      className="mixage"
      data-ouvert={ouvert}
      data-radio={radio.toFixed(2)}
      data-moteur-niveau={niveau.toFixed(2)}
      data-route={route.toFixed(2)}
      data-bruitage={bruitage}
      data-bruitages={bruitages}
    >
      <button type="button" className="drive-act mixage-bouton" aria-expanded={ouvert} aria-controls={id} aria-label="Réglages du son" onClick={basculer}>
        <IconeMixage />
        <span>Son</span>
      </button>
      {ouvert && (
        <section className="mixage-panneau" id={id} aria-label="Son de la sortie" style={bas === null ? undefined : { bottom: `${bas}px` }}>
          <header className="mixage-tete">
            <h2>Son</h2>
            <button type="button" className="mixage-fermer" aria-label="Fermer les réglages du son" onClick={() => setOuvert(false)}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          {VOIES_MIXAGE.map((voie) => {
            const valeur = reglages[voie.id];
            return (
              <label key={voie.id} className="mixage-voie" data-voie={voie.id}>
                <span className="mixage-nom">{voie.label}</span>
                <span className="mixage-valeur" aria-hidden="true">
                  {valeur} %
                </span>
                <input
                  type="range"
                  aria-label={voie.label}
                  aria-describedby={`${id}-${voie.id}`}
                  min={0}
                  max={100}
                  step={5}
                  value={valeur}
                  aria-valuetext={`${valeur} %`}
                  style={{ '--part': `${valeur}%` } as CSSProperties}
                  onChange={(event) => reglages.regler(voie.id, Number(event.currentTarget.value))}
                />
                <span className="mixage-aide" id={`${id}-${voie.id}`}>
                  {AIDE[voie.id]}
                </span>
              </label>
            );
          })}
          <button type="button" className="btn mixage-origine" onClick={reglages.origine}>
            Valeurs d’origine
          </button>
        </section>
      )}
    </div>
  );
}
