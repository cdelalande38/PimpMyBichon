// Ce que les écrans de la carrière lisent : la suite (src/data/carriere.ts), la progression sauvegardée
// (src/state/jeu.ts) et ce qui s'en déduit (src/jeu/carriere.ts). Plus deux aides d'affichage : la zone
// d'une carte et le nom de son départ.

import { useEffect, useState } from 'react';
import { CARRIERE, placeDe, SAISONS, type RendezVous, type Saison } from '../../data/carriere.ts';
import { loadRoute, mapById } from '../../data/maps.ts';
import type { MapManifest } from '../../data/mapTypes.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import { indexCourant, indexSaisonCourante } from '../../jeu/carriere.ts';
import { useBuilds } from '../../state/builds.ts';
import { useJeu } from '../../state/jeu.ts';

export interface EtatCarriere {
  /** Faux tant que la sauvegarde du jeu n'est pas relue (rien à annoncer à tort). */
  hydrated: boolean;
  /** La saison en cours (la dernière quand tout est bouclé) et son numéro (1 pour la première) ; `null` : pas de carrière. */
  saison: Saison | null;
  saisonNumero: number;
  /** Rendez-vous de la saison en cours, et ceux qui y sont réussis. */
  total: number;
  reussis: number;
  /** Le rendez-vous courant et son numéro dans sa saison (1 pour le premier) ; `null` : bouclée, ou pas de carrière. */
  courant: RendezVous | null;
  numero: number;
  /** Toutes les saisons sont bouclées. */
  bouclee: boolean;
}

export function useCarriere(): EtatCarriere {
  const hydrated = useJeu((state) => state.hydrated);
  const progression = useJeu((state) => state.carriere);
  const courant = CARRIERE[indexCourant(progression, CARRIERE)] ?? null;
  const s = indexSaisonCourante(progression, SAISONS);
  const saison = SAISONS[s] ?? null;
  const rendezVous = saison?.rendezVous ?? [];
  return {
    hydrated,
    saison,
    saisonNumero: s + 1,
    total: rendezVous.length,
    reussis: rendezVous.filter((rdv) => progression.resultats[rdv.id]?.reussi === true).length,
    courant,
    numero: (placeDe(courant?.id)?.rang ?? 0) + 1,
    bouclee: CARRIERE.length > 0 && courant === null,
  };
}

/**
 * La zone d'une carte : son champ `zone` quand le manifeste en porte un (le lot « entree » l'ajoute aux
 * map.json), sinon son nom.
 */
export function zoneDe(map: MapManifest | undefined): string | null {
  if (!map) return null;
  const zone = (map as unknown as Record<string, unknown>).zone;
  return typeof zone === 'string' && zone.trim() !== '' ? zone : null;
}

/** Nom d'un départ, lu dans la route de la carte (chargée une fois par séance) ; `null` en attendant, `false` si indisponible. */
export function useLibelleDepart(carte: string, depart: string): string | null | false {
  const [lu, setLu] = useState<{ cle: string; libelle: string | false } | null>(null);
  const cle = `${carte}|${depart}`;
  useEffect(() => {
    const map = mapById(carte);
    if (!map) return;
    let vivant = true;
    loadRoute(map).then(
      (route) => vivant && setLu({ cle, libelle: route.starts.find((start) => start.id === depart)?.label ?? false }),
      () => vivant && setLu({ cle, libelle: false }),
    );
    return () => {
      vivant = false;
    };
  }, [carte, depart, cle]);
  return lu?.cle === cle ? lu.libelle : null;
}

/** Le véhicule à l'écran (ses temps de référence fixent le seuil du bronze). */
export function useVehiculeCourant(): string {
  return resolveVehicle(useBuilds((state) => state.current)).id;
}
