// @ts-check
// Fournisseur « osm » : OpenStreetMap par l'API Overpass (sans clé, données sous ODbL 1.0), en
// longitude et latitude, ramenées dans une projection conique conforme centrée sur la carte.
// Deux usages :
// - seul, hors de France : routes, bâtiments, eau, trait de côte et végétation (même interface que
//   fournisseurs/ign.mjs) ; le relief est demandé au service d'altimétrie de l'IGN (ressource
//   mondiale), faute de quoi le terrain est plat ;
// - en enrichissement d'une carte de l'IGN (tools/maps/fetch.mjs, enrichirOsm) : lampadaires, arbres
//   isolés et alignements, parcs, feux, passages piétons, glissières et murs, attributs des routes
//   (voies, sens unique, vitesse limite, pont, tunnel, niveau) et des bâtiments (étages, toit,
//   couleur), nature des commerces au bord du parcours, pistes.
// Commerces : seule leur nature est lue (amenity, shop, tourism), traduite en un mot générique
// (MAP_SHOP_KINDS de src/data/mapTypes.ts) ; ni nom, ni marque, ni exploitant ne sont lus. Les
// réponses sont filtrées avant d'être gardées dans brut/ (enrichissement.mjs, filtrerOverpass) : ni
// nom de commerce, ni contact, ni adresse n'y sont écrits, seulement leurs empreintes.
// Overpass est un service partagé : une requête à la fois, quatre secondes au moins entre deux
// (tools/maps/fetch.mjs, lecteur), emprises petites, réponses gardées dans brut/.

import { filtrerOverpass } from '../enrichissement.mjs';
import { lambertConique } from '../geo.mjs';
import ign from './ign.mjs';

const OVERPASS = 'https://overpass-api.de/api/interpreter';

/** Classes de routes carrossables, de la plus importante à la moins importante (importance 1 à 6). */
const CLASSES = {
  motorway: 1,
  trunk: 1,
  primary: 2,
  secondary: 3,
  tertiary: 4,
  unclassified: 5,
  residential: 5,
  living_street: 6,
  service: 6,
  pedestrian: 6,
  road: 5,
  raceway: 5,
};
// Ni voies de service (allées, parkings), ni voies piétonnes (promenades du bord de mer, qui ne
// rejoignent les rues qu'en de rares points et détourneraient l'itinéraire).
const RE_ROUTES = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|road|raceway)(_link)?$';
/** Requête des tuiles du couloir : voies de service et piétonnes comprises (vitesses, ouvrages), écartées ensuite des routes. */
const RE_TUILE = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|road|raceway)(_link)?$';

/**
 * Nature des commerces : clé et valeur OSM → genre générique (MAP_SHOP_KINDS). Les autres boutiques
 * (shop=*) deviennent « boutique » ; banques, distributeurs, écoles, etc. sont ignorés.
 * @type {Record<string, string>}
 */
const COMMERCES = {
  'amenity=bar': 'bar',
  'amenity=pub': 'bar',
  'amenity=biergarten': 'bar',
  'amenity=cafe': 'cafe',
  'amenity=restaurant': 'resto',
  'amenity=fast_food': 'resto',
  'amenity=food_court': 'resto',
  'amenity=ice_cream': 'glaces',
  'shop=ice_cream': 'glaces',
  'amenity=nightclub': 'club',
  'amenity=pharmacy': 'pharmacie',
  'shop=chemist': 'pharmacie',
  'amenity=fuel': 'station',
  'tourism=hotel': 'hotel',
  'tourism=motel': 'hotel',
  'tourism=hostel': 'hotel',
  'tourism=guest_house': 'hotel',
  'shop=car_repair': 'garage',
  'amenity=car_wash': 'lavage',
  'shop=tyres': 'pneus',
  'shop=car_parts': 'pieces',
  'shop=bakery': 'pain',
  'shop=pastry': 'pain',
  'amenity=cinema': 'cinema',
};

/** @param {Record<string, string>} t */
export function natureCommerce(t) {
  for (const k of ['amenity', 'tourism', 'shop']) {
    const v = t[k];
    if (!v) continue;
    const g = COMMERCES[`${k}=${v}`];
    if (g) return g;
    if (k === 'shop' && !/^(vacant|no|yes)$/.test(v)) return 'boutique';
  }
  return null;
}

/** Nombre d'un attribut OSM (« 3 », « 3;4 », « 12 m », « 40 mph »), ou null. @param {string | undefined} v */
export function nombreOsm(v) {
  if (v === undefined) return null;
  const m = /^\s*(-?\d+(?:[.,]\d+)?)/.exec(String(v));
  return m ? Number((m[1] ?? '').replace(',', '.')) : null;
}

/** Vitesse limite en km/h (maxspeed : nombre en km/h, « 30 mph », « FR:urban »…), ou null. @param {string | undefined} v */
export function vitesseOsm(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^[A-Z]{2}:urban$/i.test(s)) return 50;
  if (/^[A-Z]{2}:rural$/i.test(s)) return 80;
  if (/^[A-Z]{2}:(motorway)$/i.test(s)) return 130;
  if (/^[A-Z]{2}:(zone|zone30)$/i.test(s)) return 30;
  if (/^[A-Z]{2}:living_street$/i.test(s) || s === 'walk') return 20;
  const n = nombreOsm(s);
  if (n === null || n <= 0) return null;
  return Math.round(/mph/i.test(s) ? n * 1.609344 : n);
}

/** Hauteur en mètres d'un attribut height (« 12 », « 12 m », « 40'»). @param {string | undefined} v */
function hauteurOsm(v) {
  const n = nombreOsm(v);
  if (n === null || n <= 0) return null;
  return /'|ft/i.test(String(v)) ? n * 0.3048 : n;
}

/** Usage d'un bâtiment, dans le vocabulaire des bâtiments de la BD TOPO (build.mjs y lit « annexe », « industriel »…). @param {string} b */
function usageBatiment(b) {
  if (/^(house|residential|apartments|detached|terrace|semidetached_house|dormitory|bungalow)$/.test(b)) return 'Résidentiel';
  if (/^(commercial|retail|office|hotel|supermarket|kiosk)$/.test(b)) return 'Commercial et services';
  if (/^(industrial|warehouse|manufacture|hangar)$/.test(b)) return 'Industriel';
  if (/^(garage|garages|shed|carport|roof|hut|cabin|service|transformer_tower)$/.test(b)) return 'Annexe';
  if (/^(church|chapel|cathedral|mosque|synagogue|temple|religious)$/.test(b)) return 'Religieux';
  if (/^(farm|farm_auxiliary|barn|stable|cowshed|greenhouse|silo)$/.test(b)) return 'Agricole';
  return 'Indifférencié';
}

/** Forme de toit, en un code court (0 inconnue ou plate). */
const TOITS = ['flat', 'gabled', 'hipped', 'pyramidal', 'skillion', 'dome', 'round', 'mansard', 'gambrel'];

/**
 * Projection conique conforme centrée sur une emprise (deux parallèles à ±0,5° du centre) : le
 * facteur d'échelle y reste à moins de 10⁻⁴ de 1.
 * @param {[number, number, number, number]} e lonMin, latMin, lonMax, latMax
 */
export function projectionLocale(e) {
  const lat = (e[1] + e[3]) / 2;
  const lon = (e[0] + e[2]) / 2;
  return lambertConique({ lat0: lat, lon0: lon, lat1: lat - 0.5, lat2: lat + 0.5, x0: 500000, y0: 500000 });
}

/** @param {[number, number, number, number]} b lonMin, latMin, lonMax, latMax */
const bboxOverpass = (b) => [b[1], b[0], b[3], b[2]].map((v) => v.toFixed(5)).join(',');

/** Réseau routier seul (itinéraire). @param {string} bb */
const requeteReseau = (bb) => `[out:json][timeout:120][bbox:${bb}];way["highway"~"${RE_ROUTES}"];out body geom qt;`;

/** Eau et trait de côte seuls, sur toute l'emprise de la carte (plans d'eau à 3 km, mer). @param {string} bb */
const requeteEaux = (bb) =>
  `[out:json][timeout:120][bbox:${bb}];(way["natural"~"^(water|coastline)$"];relation["natural"="water"];way["waterway"="riverbank"];way["landuse"~"^(reservoir|basin)$"];);out body geom qt;`;

/** Tout ce que la carte prend dans le couloir. @param {string} bb */
const requeteTuile = (bb) =>
  `[out:json][timeout:180][bbox:${bb}];(` +
  `way["highway"~"${RE_TUILE}"];` +
  'way["building"];relation["building"];' +
  'way["natural"~"^(water|wood|scrub|tree_row|coastline)$"];relation["natural"~"^(water|wood)$"];' +
  'way["waterway"="riverbank"];way["landuse"~"^(forest|reservoir|basin)$"];relation["landuse"="forest"];' +
  'way["leisure"~"^(park|garden)$"];relation["leisure"~"^(park|garden)$"];' +
  'way["barrier"~"^(guard_rail|wall|retaining_wall|city_wall|jersey_barrier)$"];' +
  'node["highway"~"^(street_lamp|traffic_signals|crossing)$"];node["natural"="tree"];' +
  'node["amenity"];node["shop"];node["tourism"~"^(hotel|motel|hostel|guest_house)$"];' +
  'way["amenity"]["building"];way["shop"]["building"];way["tourism"~"^(hotel|motel|hostel|guest_house)$"];' +
  ');out body geom qt;';

/**
 * Fournisseur lié à une projection (Lambert-93 pour enrichir une carte de l'IGN, projection locale
 * pour une carte d'OpenStreetMap seul).
 * @param {{ forward: (lon: number, lat: number) => [number, number], inverse: (x: number, y: number) => [number, number], scale: (lat: number) => number } | null} [proj]
 */
export function creer(proj = null) {
  /** @type {Map<string, any>} */
  const tuiles = new Map();
  const f = {
    nom: 'osm',
    projection: proj,
    /** Le relief des routes n'est pas dans la donnée : fetch.mjs le demande au service d'altimétrie. */
    altitudeRoutes: false,
    /** @param {[number, number, number, number]} emprise */
    projectionPour(emprise) {
      f.projection = projectionLocale(emprise);
      return f.projection;
    },
    /** @param {string} date */
    credits: (date) => [
      { source: '© les contributeurs d’OpenStreetMap (routes, bâtiments, eau, trait de côte, végétation, mobilier urbain)', licence: 'ODbL 1.0', date },
      { source: 'IGN, service d’altimétrie de la Géoplateforme, ressource mondiale (relief)', licence: 'Licence Ouverte 2.0', date },
    ],
    /** @param {string} date */
    creditsEnrichissement: (date) => [{ source: '© les contributeurs d’OpenStreetMap (lampadaires, arbres, parcs, feux, passages piétons, glissières et murs, vitesses limites, nature des commerces)', licence: 'ODbL 1.0', date }],

    /**
     * Aucun service à comparer : contrôle aller-retour de la projection locale aux coins de l'emprise.
     * @param {any} _ctx @param {[number, number, number, number]} bbox
     */
    async verifierProjection(_ctx, bbox) {
      const p = /** @type {NonNullable<typeof proj>} */ (f.projection);
      let max = 0;
      for (const lon of [bbox[0], bbox[2]])
        for (const lat of [bbox[1], bbox[3]]) {
          const [x, y] = p.forward(lon, lat);
          const [lo, la] = p.inverse(x, y);
          const q = p.forward(lo, la);
          max = Math.max(max, Math.hypot(q[0] - x, q[1] - y));
        }
      return { ecart: max, points: 4 };
    },

    /** @param {any} ctx @param {[number, number, number, number]} bbox */
    async routes(ctx, bbox) {
      const r = await ctx.lire(`${OVERPASS}?data=${encodeURIComponent(requeteReseau(bboxOverpass(bbox)))}`, { filtre: filtrerOverpass });
      return decouperRoutes(r.elements ?? [], /** @type {NonNullable<typeof proj>} */ (f.projection));
    },
    /** Pas de route numérotée dans ce fournisseur : les étapes passent par toutes les rues. */
    async routeNumerotee() {
      throw new Error('fournisseur osm : itinéraire par étapes seulement (itineraire.etapes, sans routes)');
    },
    /** @param {any} ctx @param {[number, number, number, number]} bbox */
    async tuile(ctx, bbox) {
      const k = bbox.join(',');
      let t = tuiles.get(k);
      if (!t) {
        const r = await ctx.lire(`${OVERPASS}?data=${encodeURIComponent(requeteTuile(bboxOverpass(bbox)))}`, { filtre: filtrerOverpass });
        t = lireTuile(r.elements ?? [], /** @type {NonNullable<typeof proj>} */ (f.projection));
        tuiles.set(k, t);
      }
      return t;
    },
    /** Routes du couloir (routes voisines). @param {any} ctx @param {[number, number, number, number]} bbox */
    async routesCouloir(ctx, bbox) {
      return (await f.tuile(ctx, bbox)).routes;
    },
    /** @param {any} ctx @param {[number, number, number, number]} bbox */
    async batiments(ctx, bbox) {
      return (await f.tuile(ctx, bbox)).batiments;
    },
    /** Eau et trait de côte de l'emprise : une requête légère, à part. @param {any} ctx @param {[number, number, number, number]} bbox */
    async eauxEtCote(ctx, bbox) {
      const k = `eaux:${bbox.join(',')}`;
      let t = tuiles.get(k);
      if (!t) {
        const r = await ctx.lire(`${OVERPASS}?data=${encodeURIComponent(requeteEaux(bboxOverpass(bbox)))}`, { filtre: filtrerOverpass });
        t = lireTuile(r.elements ?? [], /** @type {NonNullable<typeof proj>} */ (f.projection));
        tuiles.set(k, t);
      }
      return t;
    },
    /** @param {any} ctx @param {[number, number, number, number]} bbox */
    async eaux(ctx, bbox) {
      return (await f.eauxEtCote(ctx, bbox)).eaux;
    },
    /** @param {any} ctx @param {[number, number, number, number]} bbox */
    async cote(ctx, bbox) {
      return (await f.eauxEtCote(ctx, bbox)).cote;
    },
    /** @param {any} ctx @param {[number, number, number, number]} bbox */
    async vegetation(ctx, bbox) {
      const t = await f.tuile(ctx, bbox);
      return { zones: t.bois, haies: t.alignements };
    },
    /** Relief : service d'altimétrie de l'IGN (ressource mondiale). @param {any} ctx @param {Array<[number, number]>} lonlat */
    async altitudes(ctx, lonlat) {
      return ign.altitudes(ctx, lonlat);
    },
  };
  return f;
}

/** Coordonnées projetées d'une géométrie Overpass. @param {Array<{ lat: number, lon: number }>} g @param {{ forward: (lon: number, lat: number) => [number, number] }} proj */
const projeter = (g, proj) => (g ?? []).filter(Boolean).map((p) => proj.forward(p.lon, p.lat));

/** Attributs d'une route OSM, normalisés comme ceux de l'IGN. @param {Record<string, string>} t */
function attributsRoute(t) {
  const hw = String(t.highway ?? '').replace(/_link$/, '');
  const lanes = nombreOsm(t.lanes);
  const vitesse = vitesseOsm(t.maxspeed);
  const ow = t.oneway ?? (t.junction === 'roundabout' ? 'yes' : '');
  return {
    numero: String(t.ref ?? ''),
    // Nom de la rue (pas d'un commerce) : sert aux étapes et aux départs, comme celui de l'IGN.
    nom: String(t.name ?? ''),
    importance: /** @type {Record<string, number>} */ (CLASSES)[hw] ?? 6,
    nature: hw,
    largeur: hauteurOsm(t.width),
    voies: lanes,
    sol: t.tunnel && t.tunnel !== 'no' ? 'tunnel' : t.bridge && t.bridge !== 'no' ? 'pont' : 'sol',
    couche: nombreOsm(t.layer) ?? 0,
    urbain: !/^(motorway|trunk)$/.test(hw) && (vitesse === null || vitesse <= 60),
    sens: /^(yes|true|1)$/.test(ow) ? 'direct' : ow === '-1' ? 'inverse' : 'double',
    vitesse,
  };
}

/**
 * Routes d'OSM découpées à chaque carrefour (nœud partagé par deux voies ou plus), comme les
 * tronçons de l'IGN : le plus court chemin (trace.mjs) ne connaît que les extrémités des arêtes.
 * L'altitude (troisième coordonnée) est inconnue : −1 000.
 * @param {any[]} elements @param {{ forward: (lon: number, lat: number) => [number, number] }} proj
 */
export function decouperRoutes(elements, proj) {
  // Rues carrossables seulement (RE_ROUTES), sans accès privé : les autres attireraient les étapes.
  const ways = elements.filter(
    (e) =>
      e.type === 'way' && new RegExp(RE_ROUTES).test(e.tags?.highway ?? '') && Array.isArray(e.nodes) && Array.isArray(e.geometry) && e.tags.access !== 'private',
  );
  /** @type {Map<number, number>} */
  const usage = new Map();
  for (const w of ways)
    w.nodes.forEach((/** @type {number} */ n, /** @type {number} */ i) => {
      const bout = i === 0 || i === w.nodes.length - 1;
      usage.set(n, (usage.get(n) ?? 0) + (bout ? 2 : 1));
    });
  /** @type {any[]} */
  const out = [];
  for (const w of ways) {
    const a = attributsRoute(w.tags);
    const pts = projeter(w.geometry, proj);
    if (pts.length !== w.nodes.length || pts.length < 2) continue;
    let debut = 0;
    let k = 0;
    for (let i = 1; i < pts.length; i += 1) {
      if (i < pts.length - 1 && (usage.get(w.nodes[i]) ?? 0) < 2) continue;
      out.push({ id: `${w.id}-${k}`, points: pts.slice(debut, i + 1).map((p) => [p[0], p[1], -1000]), ...a });
      debut = i;
      k += 1;
    }
  }
  return out;
}

/**
 * Anneaux d'une surface : un chemin fermé, ou les membres « outer » d'une relation mis bout à bout.
 * @param {any} e @param {{ forward: (lon: number, lat: number) => [number, number] }} proj
 * @returns {number[][][]}
 */
function anneaux(e, proj) {
  if (e.type === 'way') {
    const p = projeter(e.geometry, proj);
    return p.length >= 4 ? [p] : [];
  }
  if (e.type !== 'relation') return [];
  /** @type {number[][][]} */
  const morceaux = (e.members ?? []).filter((/** @type {any} */ m) => m.type === 'way' && m.role !== 'inner' && Array.isArray(m.geometry)).map((/** @type {any} */ m) => projeter(m.geometry, proj));
  /** @type {number[][][]} */
  const out = [];
  const reste = morceaux.filter((m) => m.length >= 2);
  while (reste.length) {
    let l = /** @type {number[][]} */ (reste.shift());
    for (let ajout = true; ajout; ) {
      ajout = false;
      for (let i = 0; i < reste.length; i += 1) {
        const m = /** @type {number[][]} */ (reste[i]);
        const fin = /** @type {number[]} */ (l[l.length - 1]);
        const d = (/** @type {number[]} */ q) => Math.hypot((q[0] ?? 0) - (fin[0] ?? 0), (q[1] ?? 0) - (fin[1] ?? 0)) < 0.01;
        if (d(/** @type {number[]} */ (m[0]))) l = [...l, ...m.slice(1)];
        else if (d(/** @type {number[]} */ (m[m.length - 1]))) l = [...l, ...[...m].reverse().slice(1)];
        else continue;
        reste.splice(i, 1);
        ajout = true;
        break;
      }
    }
    if (l.length >= 4) out.push(l);
  }
  return out;
}

/** Centre (moyenne des sommets) d'une géométrie Overpass. @param {any} e */
function centreLonLat(e) {
  if (e.type === 'node') return { lon: e.lon, lat: e.lat };
  /** @type {Array<{ lon: number, lat: number }>} */
  const g = e.geometry ?? (e.members ?? []).flatMap((/** @type {any} */ m) => m.geometry ?? []);
  if (!g.length) return null;
  return { lon: g.reduce((s, p) => s + p.lon, 0) / g.length, lat: g.reduce((s, p) => s + p.lat, 0) / g.length };
}

/** Palmiers : genre ou espèce connus (taxon, genus, species), ou feuillage palmé. @param {Record<string, string>} t */
function genreArbre(t) {
  const txt = `${t.genus ?? ''} ${t.species ?? ''} ${t.taxon ?? ''} ${t['taxon:en'] ?? ''} ${t['species:en'] ?? ''} ${t.leaf_type ?? ''}`;
  if (/palm|phoenix|washingtonia|sabal|roystonea|cocos|arecaceae|livistona|trachycarpus|syagrus|chamaerops|butia|dypsis|adonidia|veitchia/i.test(txt)) return 3;
  if (/needle/i.test(txt)) return 1;
  return 0;
}

/**
 * Lecture d'une tuile Overpass : tout ce dont fetch.mjs a besoin, en coordonnées projetées. Aucune
 * clé « name », « brand » ou « operator » n'est lue, sauf le nom des rues.
 * @param {any[]} elements @param {{ forward: (lon: number, lat: number) => [number, number] }} proj
 */
export function lireTuile(elements, proj) {
  const t = {
    routes: decouperRoutes(elements, proj),
    /** @type {any[]} */ batiments: [],
    /** @type {any[]} */ eaux: [],
    /** @type {any[]} */ cote: [],
    /** @type {any[]} */ bois: [],
    /** @type {any[]} */ alignements: [],
    /** @type {any[]} */ parcs: [],
    /** @type {any[]} */ barrieres: [],
    /** @type {Array<[number, number]>} */ lampadaires: [],
    /** @type {Array<[number, number, number]>} */ arbres: [],
    /** @type {Array<[number, number]>} */ feux: [],
    /** @type {Array<[number, number, number]>} */ passages: [],
    /** @type {Array<{ p: [number, number], genre: string }>} */ commerces: [],
    /** @type {any[]} */ pistes: [],
  };
  for (const e of elements) {
    const g = e.tags ?? {};
    const id = `${e.type}/${e.id}`;
    if (e.type === 'node') {
      const p = proj.forward(e.lon, e.lat);
      if (g.highway === 'street_lamp') t.lampadaires.push(p);
      else if (g.highway === 'traffic_signals') t.feux.push(p);
      else if (g.highway === 'crossing') {
        // Passages peints : zébrés, marqués, ou à feux ; « unmarked » n'a pas de peinture.
        const c = String(g.crossing ?? '');
        const peint = /zebra|marked|uncontrolled|traffic_signals/.test(c) || g['crossing:markings'] === 'zebra' || g.crossing_ref === 'zebra';
        if (peint && c !== 'unmarked') t.passages.push([p[0], p[1], c === 'traffic_signals' ? 1 : 0]);
      }
      if (g.natural === 'tree') t.arbres.push([p[0], p[1], genreArbre(g)]);
    }
    const genre = natureCommerce(g);
    if (genre && (e.type === 'node' || g.building)) {
      const c = centreLonLat(e);
      if (c) t.commerces.push({ p: proj.forward(c.lon, c.lat), genre });
    }
    if (e.type === 'node') continue;
    if (g.highway === 'raceway') t.pistes.push({ id, points: projeter(e.geometry, proj) });
    if (g.building && g.building !== 'no') {
      for (const an of anneaux(e, proj)) {
        const niveaux = nombreOsm(g['building:levels']);
        const h = hauteurOsm(g.height) ?? (niveaux !== null ? niveaux * 3.2 + (nombreOsm(g['roof:levels']) ?? 0) * 2 : null);
        t.batiments.push({
          id,
          anneau: an,
          hauteur: h,
          etages: niveaux,
          zSol: null,
          nature: 'OSM',
          usage: usageBatiment(String(g.building)),
          toit: Math.max(0, TOITS.indexOf(String(g['roof:shape'] ?? 'flat'))),
          couleur: /^#[0-9a-f]{6}$/i.test(String(g['building:colour'] ?? '')) ? String(g['building:colour']).toLowerCase() : null,
        });
      }
      continue;
    }
    if (g.natural === 'coastline') {
      t.cote.push({ id, points: projeter(e.geometry, proj) });
      continue;
    }
    if (g.natural === 'water' || g.waterway === 'riverbank' || /^(reservoir|basin)$/.test(g.landuse ?? '')) {
      const an = anneaux(e, proj);
      if (an.length) t.eaux.push({ id, nom: '', nature: 'Plan d’eau', altitude: null, anneaux: an });
      continue;
    }
    if (/^(wood|scrub)$/.test(g.natural ?? '') || g.landuse === 'forest') {
      const nature = g.leaf_type === 'needleleaved' ? 'Forêt fermée de conifères' : g.leaf_type === 'broadleaved' ? 'Forêt fermée de feuillus' : 'Forêt fermée mixte';
      for (const an of anneaux(e, proj)) t.bois.push({ id, nature, anneaux: [an] });
      continue;
    }
    if (g.natural === 'tree_row') {
      t.alignements.push({ id, points: projeter(e.geometry, proj), genre: genreArbre(g) });
      continue;
    }
    if (/^(park|garden)$/.test(g.leisure ?? '')) {
      for (const an of anneaux(e, proj)) t.parcs.push({ id, anneaux: [an] });
      continue;
    }
    if (g.barrier) {
      const type = /guard_rail|jersey_barrier/.test(g.barrier) ? 'glissiere' : 'mur';
      t.barrieres.push({ id, type, hauteur: hauteurOsm(g.height), points: projeter(e.geometry, proj) });
    }
  }
  return t;
}

export default creer();
