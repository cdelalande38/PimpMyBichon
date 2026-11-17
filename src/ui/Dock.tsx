// Dock : la personnalisation, dans le tiers bas (§ 2). En tête, une ligne de repère de 48 px :
// « Retour » (dès qu'on est descendu d'un niveau), le fil (où l'on est), la poignée et « Fermer le
// menu » ; dessous, un seul niveau à la fois : les sections (Véhicule, Custom, Mécanique, Garage),
// les entrées d'une section, ou le contenu d'une entrée (src/data/dockMenu.ts). Fermé, le dock se réduit
// à une pastille « Personnaliser » qui le rouvre là où on l'avait laissé. La radio, la photo et
// l'atelier vivent dans la colonne de boutons ronds du haut de l'écran (src/ui/Hud.tsx).
// Trois tailles (src/state/dock.ts) : fermé, compact (les rangées défilent), agrandi (le dock monte
// et les options passent à la ligne). La poignée ne paraît que là où agrandir montre quelque chose
// de plus (mesuré, voir moreWhenExpanded) ; ailleurs, un menu resté « agrandi » s'affiche compact,
// à sa hauteur utile, et le redevient en revenant là où il gagne. Échap remonte d'un niveau, puis
// ferme le menu.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { usePaysage } from '../app/paysage.ts';
import { useSettling } from '../app/useRoute.ts';
import { resolveVehicle } from '../data/vehicles.ts';
import type { VehicleManifest } from '../data/vehicleTypes.ts';
import { usePwa } from '../pwa/pwaStore.ts';
import { applyUpdate } from '../pwa/register.ts';
import { useBuilds } from '../state/builds.ts';
import { dockSize, useDock, type DockLevel, type MenuLevel } from '../state/dock.ts';
import { activeEntry, visibleSections } from '../data/dockMenu.ts';
import { BenchControls } from './BenchControls.tsx';

interface DockProps {
  /** La scène 3D n'a pas démarré : le dock propose de relancer. */
  sceneFailed: boolean;
  /** Un panneau est ouvert par-dessus : le dock est hors d'atteinte (clavier, lecteurs d'écran). */
  covered?: boolean;
}

/** Poignée du dock : agrandit ou réduit le menu, au pouce comme au clavier. */
function DockHandle() {
  const expanded = useDock((state) => state.expanded);
  const toggle = useDock((state) => state.toggle);
  const label = expanded ? 'Réduire le menu' : 'Agrandir le menu';
  return (
    <button type="button" className="dock-handle" aria-label={label} title={label} onClick={toggle}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 15l6-6 6 6" />
      </svg>
    </button>
  );
}

/** Libellé d'un niveau dans le fil : la zone et son étape, ou le nuancier. */
function levelCrumbs(level: DockLevel, vehicle: VehicleManifest): string[] {
  if (level.kind === 'zone') {
    const zone = vehicle.zones.find((item) => item.id === level.zone);
    return [zone?.label ?? level.zone, level.step === 'finition' ? 'Finition' : 'Couleur'];
  }
  return [level.target === 'color2' ? 'Seconde teinte' : 'Nuancier'];
}

/** Largeur d'une rangée posée sur une seule ligne (ses éléments, leurs marges, les écarts) : plus
 *  large que la place, elle défile en compact et passe à la ligne agrandie. Mesure indépendante de
 *  la taille du dock : la décision ne bascule pas d'une taille à l'autre. */
function rowOverflows(row: HTMLElement): boolean {
  const style = getComputedStyle(row);
  const items = [...row.children].filter((item): item is HTMLElement => item instanceof HTMLElement && item.getClientRects().length > 0);
  if (items.length === 0) return false;
  let width = (Number.parseFloat(style.columnGap) || 0) * (items.length - 1);
  for (const item of items) {
    const box = getComputedStyle(item);
    width += item.getBoundingClientRect().width + (Number.parseFloat(box.marginLeft) || 0) + (Number.parseFloat(box.marginRight) || 0);
  }
  const room = row.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
  return width > room + 1;
}

/**
 * Vrai si agrandir le menu montre quelque chose de plus au niveau à l'écran : jamais aux sections ;
 * aux entrées d'une section, si leur rangée ne tient pas dans la largeur ; dans le contenu d'une
 * entrée, s'il se déclare plus riche agrandi (`data-agrandir="toujours"` : la peinture, couleurs et
 * finitions ensemble), s'il défile en hauteur, ou si l'une de ses rangées ne tient pas sur une ligne.
 */
function moreWhenExpanded(footer: HTMLElement, level: MenuLevel): boolean {
  if (level === 'sections') return false;
  const entries = footer.querySelector<HTMLElement>('.dock-entries');
  if (level === 'entrees') return entries !== null && rowOverflows(entries);
  const tab = footer.querySelector<HTMLElement>('.dock-tab');
  if (!tab) return false;
  if (tab.querySelector('[data-agrandir="toujours"]')) return true;
  if (tab.scrollHeight > tab.clientHeight + 1) return true;
  return [...tab.querySelectorAll<HTMLElement>('.chips, .tabs')].some(rowOverflows);
}

/** Ligne de repère : Retour, le fil (section · entrée · niveaux), la poignée (si utile), Fermer le menu. */
function DockHeader({ vehicle, handle }: { vehicle: VehicleManifest; handle: boolean }) {
  const chosen = useDock((state) => state.section);
  const menu = useDock((state) => state.menu);
  const remembered = useDock((state) => state.entries);
  const levels = useDock((state) => state.levels);
  const back = useDock((state) => state.back);
  const setClosed = useDock((state) => state.setClosed);
  const sections = visibleSections(vehicle.engine !== undefined);
  // Section absente pour ce véhicule (Mécanique sans moteur) : on est aux sections.
  const section = sections.find((item) => item.id === chosen);
  const level = section ? menu : 'sections';
  const entry = section ? activeEntry(section, remembered[section.id]) : undefined;
  // Le nuancier remplace l'étape (couleur) dans le fil : « Custom · Peinture · Toit · Nuancier ».
  const deeper = levels.reduce<string[]>((path, item) => {
    const next = levelCrumbs(item, vehicle);
    return item.kind === 'nuancier' ? [...path.slice(0, -1), ...next] : [...path, ...next];
  }, []);
  // Une section à une seule entrée (Véhicule, Garage) ne répète pas son nom : « Garage · Ambiance ».
  const crumbs =
    level === 'entrees'
      ? [section?.label]
      : [section?.label, entry && entry.label !== section?.label ? entry.label : undefined, ...deeper];
  const parts = crumbs.filter((crumb): crumb is string => crumb !== undefined);
  // Les sections, ou le choix du véhicule : le véhicule à l'écran reste lisible.
  const top = level === 'sections' || (section?.id === 'vehicule' && levels.length === 0);

  return (
    <div className="dock-head">
      {level !== 'sections' && (
        <button type="button" className="btn dock-back" onClick={() => back()}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Retour
        </button>
      )}
      <p className="dock-crumbs" aria-live="polite">
        {top ? (
          <span className="eyebrow">
            Au garage · <b className="dock-vehicle">{vehicle.name}</b>
          </span>
        ) : (
          <>
            {/* Deux lignes : le chemin (qui se coupe faute de place), puis où l'on est, toujours entier. */}
            {parts.length > 1 && (
              <span className="dock-crumbs-path">
                {parts.slice(0, -1).map((crumb, index) => (
                  <span key={`${index}-${crumb}`} className="dock-crumb">
                    {crumb}
                  </span>
                ))}
              </span>
            )}
            <span className="dock-crumb dock-crumb-here">{parts.at(-1)}</span>
          </>
        )}
      </p>
      {handle && <DockHandle />}
      <button type="button" className="dock-close" aria-label="Fermer le menu" title="Fermer le menu" onClick={() => setClosed(true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Focus au clavier : le bouton touché (« Retour », une section, « Fermer le menu », « Personnaliser »)
 * disparaît avec son niveau. Si le focus était dans le dock et retombe sur la page, il passe au
 * premier bouton du nouveau niveau, ou à « Retour », ou à la pastille « Personnaliser ».
 */
function useKeepFocus(footer: RefObject<HTMLElement | null>, key: string): void {
  const inside = useRef(false);
  useEffect(() => {
    const element = footer.current;
    if (!element) return;
    const onIn = () => {
      inside.current = true;
    };
    const onOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && !element.contains(next)) inside.current = false;
    };
    const onDown = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) inside.current = false;
    };
    element.addEventListener('focusin', onIn);
    element.addEventListener('focusout', onOut);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      element.removeEventListener('focusin', onIn);
      element.removeEventListener('focusout', onOut);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [footer]);
  useEffect(() => {
    const element = footer.current;
    if (!element || !inside.current) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const target =
      element.querySelector<HTMLElement>('.dock-open') ??
      element.querySelector<HTMLElement>('.dock-tab button:not([disabled]), .dock-tab input, nav.tabs button:not([disabled])') ??
      element.querySelector<HTMLElement>('.dock-back, .dock-close');
    // Sans défilement : la position rendue au niveau (src/ui/scroll.ts) ne doit pas bouger.
    target?.focus({ preventScroll: true });
  }, [footer, key]);
}

export function Dock({ sceneFailed, covered = false }: DockProps) {
  const updateReady = usePwa((state) => state.updateReady);
  // Double appui sur « Retour à l'atelier » : le second ne doit pas rouvrir un panneau.
  const settling = useSettling();
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const expanded = useDock((state) => state.expanded);
  const closed = useDock((state) => state.closed);
  const setTop = useDock((state) => state.setTop);
  const setClosed = useDock((state) => state.setClosed);
  const menu = useDock((state) => state.menu);
  const section = useDock((state) => state.section);
  const remembered = useDock((state) => state.entries);
  const depth = useDock((state) => state.levels.length);
  // Comme le dock et le fil : une section absente pour ce véhicule retombe sur les sections.
  const shown = visibleSections(vehicle.engine !== undefined).find((item) => item.id === section);
  const level: MenuLevel = shown ? menu : 'sections';
  const entryId = shown ? activeEntry(shown, remembered[shown.id])?.id : undefined;
  // Agrandir montre-t-il quelque chose de plus ici ? Mesuré après chaque rendu du niveau (avant
  // l'affichage), et quand la taille de l'écran, du texte ou du contenu change.
  const [more, setMore] = useState(false);
  // Resté « agrandi » là où la poignée n'a rien à montrer : affiché compact, à sa hauteur utile.
  // Paysage : le menu est une colonne sur toute la hauteur, qui présente toujours ses options en
  // pleine page (rangées à la ligne, contenu qui défile en hauteur) : « agrandi » pour les contenus,
  // sans poignée ; la scène ne recadre rien en hauteur (src/scene/GarageCanvas.tsx).
  const paysage = usePaysage();
  const size = paysage && !closed ? 'agrandi' : dockSize({ expanded: expanded && more, closed });

  // Dock agrandi : son bord haut, mesuré à l'écran, sert à la scène pour recadrer le véhicule
  // au-dessus. Il bouge avec le contenu de l'onglet, la taille du texte et celle de l'écran.
  // Fermé ou compact : le cadrage d'origine.
  const footer = useRef<HTMLElement>(null);
  useKeepFocus(footer, `${size}/${menu}/${section}/${depth}`);
  useLayoutEffect(() => {
    const element = footer.current;
    if (!element || closed || sceneFailed) return;
    const measure = () => setMore(moreWhenExpanded(element, level));
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    for (const row of element.querySelectorAll('.dock-entries, .dock-tab, .dock-tab .chips')) resize.observe(row);
    // Un contenu qui change sans changer de niveau (question du cadenas, nuancier) : on remesure.
    const mutations = new MutationObserver(measure);
    mutations.observe(element, { childList: true, subtree: true });
    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, [closed, sceneFailed, level, section, entryId, depth, vehicle.id, size]);
  useLayoutEffect(() => {
    const element = footer.current;
    if (size !== 'agrandi' || !element || paysage) {
      setTop(null);
      return;
    }
    const measure = () => setTop(Math.round(element.getBoundingClientRect().top));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [size, setTop, paysage]);

  // Échap : remonte d'un niveau, puis ferme le menu. Un panneau ouvert garde sa touche Échap.
  useEffect(() => {
    if (sceneFailed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      const state = useDock.getState();
      if (state.closed) return;
      if (!state.back()) state.setClosed(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sceneFailed]);

  const banners = (
    <>
      {sceneFailed && (
        <div className="strip strip-alert">
          <span>Le garage 3D est à l’arrêt.</span>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Relancer
          </button>
        </div>
      )}

      {updateReady && (
        <div className="strip" role="status">
          <span>Nouvelle version de l’atelier prête.</span>
          <button type="button" className="btn" onClick={() => void applyUpdate()}>
            Recharger
          </button>
        </div>
      )}
    </>
  );

  if (sceneFailed) {
    return (
      <footer ref={footer} className="dock" data-taille="compact" inert={settling || covered} aria-hidden={covered || undefined}>
        <div className="dock-text">
          <p className="eyebrow">
            Au garage · <b className="dock-vehicle">{vehicle.name}</b>
          </p>
        </div>
        {banners}
      </footer>
    );
  }

  if (size === 'ferme') {
    return (
      <footer ref={footer} className="dock" data-taille="ferme" inert={settling || covered} aria-hidden={covered || undefined}>
        {banners}
        <button type="button" className="dock-open" onClick={() => setClosed(false)}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 17.5h6M14 17.5h6M4 6.5h10M18 6.5h2M10 15v5M14 4v5" />
          </svg>
          Personnaliser
        </button>
      </footer>
    );
  }

  return (
    <footer ref={footer} className="dock" data-taille={size} inert={settling || covered} aria-hidden={covered || undefined}>
      <DockHeader vehicle={vehicle} handle={more && !paysage} />
      {banners}
      <BenchControls />
    </footer>
  );
}
