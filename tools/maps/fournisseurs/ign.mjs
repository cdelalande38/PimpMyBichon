// @ts-check
// Fournisseur « ign » : services ouverts de la Géoplateforme de l'IGN (sans clé, Licence Ouverte 2.0).
// - WFS de la BD TOPO (routes, bâtiments, plans d'eau, végétation, haies), en Lambert-93 avec l'altitude ;
// - service de calcul altimétrique (RGE ALTI), en longitude et latitude.
// Tout ce qui dépend de l'IGN est ici : noms de couches, attributs, adresses, projection. Le reste de
// tools/maps/ ne voit que des objets normalisés en coordonnées projetées (voir la forme plus bas).
// Un fournisseur OpenStreetMap exposerait la même interface (projection locale, mêmes objets).

import { LAMBERT93 } from '../geo.mjs';

const WFS = 'https://data.geopf.fr/wfs/ows';
const ALTI = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
const PAGE = 5000;
/** Points par requête d'altitude : l'adresse reste sous 8 ko. */
export const ALTI_LOT = 200;

/**
 * @typedef {object} Ctx
 * @property {(url: string) => Promise<any>} lire   requête GET mise en cache sur le disque (brut/)
 */

/**
 * @param {Ctx} ctx
 * @param {string} couche
 * @param {string[]} proprietes
 * @param {[number, number, number, number]} bbox lonMin, latMin, lonMax, latMax
 * @param {string} [filtre] condition CQL en plus de l'emprise
 */
async function wfs(ctx, couche, proprietes, bbox, filtre) {
  const b = bbox.map((v) => v.toFixed(5)).join(',');
  const cql = `${filtre ? `${filtre} AND ` : ''}BBOX(geometrie,${b},'EPSG:4326')`;
  /** @type {any[]} */
  const out = [];
  for (let start = 0; ; start += PAGE) {
    const q = new URLSearchParams({
      SERVICE: 'WFS',
      VERSION: '2.0.0',
      REQUEST: 'GetFeature',
      TYPENAMES: couche,
      SRSNAME: 'EPSG:2154',
      OUTPUTFORMAT: 'application/json',
      COUNT: String(PAGE),
      STARTINDEX: String(start),
      PROPERTYNAME: [...proprietes, 'geometrie'].join(','),
      CQL_FILTER: cql,
    });
    const page = await ctx.lire(`${WFS}?${q}`);
    const feats = page.features ?? [];
    out.push(...feats);
    if (feats.length < PAGE) break;
  }
  return out;
}

/** Anneaux extérieurs et trous d'une géométrie (Multi)Polygon, en [x, y, z?]. @param {any} g @returns {number[][][][]} */
function polygones(g) {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}
/** Lignes d'une géométrie (Multi)LineString. @param {any} g @returns {number[][][]} */
function lignes(g) {
  if (!g) return [];
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  return [];
}
/** @param {unknown} v */
const nombre = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** @param {unknown} pos */
function sol(pos) {
  const p = Number(pos ?? 0);
  return p > 0 ? 'pont' : p < 0 ? 'tunnel' : 'sol';
}

/** @param {any} f */
function troncon(f) {
  const p = f.properties ?? {};
  return lignes(f.geometry).map((c) => ({
    id: String(f.id),
    points: /** @type {number[][]} */ (c),
    numero: String(p.cpx_numero ?? ''),
    importance: Number(p.importance ?? 6),
    nature: String(p.nature ?? ''),
    largeur: nombre(p.largeur_de_chaussee),
    voies: nombre(p.nombre_de_voies),
    sol: sol(p.position_par_rapport_au_sol),
    urbain: p.urbain === true || p.urbain === 'true' || p.urbain === 1,
    // Sens de circulation : « direct » (du premier au dernier sommet), « inverse », ou les deux.
    sens: /inverse/i.test(String(p.sens_de_circulation ?? '')) ? 'inverse' : /direct/i.test(String(p.sens_de_circulation ?? '')) ? 'direct' : 'double',
  }));
}

export default {
  nom: 'ign',
  projection: LAMBERT93,
  /** @param {string} date année et mois */
  credits: (date) => [
    { source: 'IGN, BD TOPO (routes, bâtiments, plans d’eau, végétation)', licence: 'Licence Ouverte 2.0', date },
    { source: 'IGN, RGE ALTI (relief)', licence: 'Licence Ouverte 2.0', date },
  ],

  /**
   * Contrôle de la projection : un même tronçon demandé en Lambert-93 et en longitude et latitude ;
   * rend l'écart le plus grand, en mètres, entre la conversion locale et le service.
   * @param {Ctx} ctx @param {[number, number, number, number]} bbox @param {string} numero
   */
  async verifierProjection(ctx, bbox, numero) {
    const base = {
      SERVICE: 'WFS',
      VERSION: '2.0.0',
      REQUEST: 'GetFeature',
      TYPENAMES: 'BDTOPO_V3:troncon_de_route',
      OUTPUTFORMAT: 'application/json',
      COUNT: '1',
      PROPERTYNAME: 'cpx_numero,geometrie',
      CQL_FILTER: `cpx_numero='${numero.replace(/'/g, '')}' AND BBOX(geometrie,${bbox.map((v) => v.toFixed(5)).join(',')},'EPSG:4326')`,
    };
    const l93 = await ctx.lire(`${WFS}?${new URLSearchParams({ ...base, SRSNAME: 'EPSG:2154' })}`);
    const geo = await ctx.lire(`${WFS}?${new URLSearchParams({ ...base, SRSNAME: 'EPSG:4326' })}`);
    const a = lignes(l93.features?.[0]?.geometry)[0] ?? [];
    const b = lignes(geo.features?.[0]?.geometry)[0] ?? [];
    if (a.length === 0 || a.length !== b.length) throw new Error('contrôle de projection : réponses incomparables');
    let max = 0;
    a.forEach((/** @type {number[]} */ p, /** @type {number} */ i) => {
      const q = /** @type {number[]} */ (b[i]);
      // WFS 2.0 en EPSG:4326 : ordre latitude, longitude.
      const [lat, lon] = (q[0] ?? 0) > (q[1] ?? 0) ? [q[0] ?? 0, q[1] ?? 0] : [q[1] ?? 0, q[0] ?? 0];
      const [x, y] = LAMBERT93.forward(lon, lat);
      max = Math.max(max, Math.hypot(x - (p[0] ?? 0), y - (p[1] ?? 0)));
    });
    return { ecart: max, points: a.length };
  },

  /** Tronçons d'une route numérotée. @param {Ctx} ctx @param {[number, number, number, number]} bbox @param {string} numero */
  async routeNumerotee(ctx, bbox, numero) {
    const props = ['cpx_numero', 'importance', 'nature', 'largeur_de_chaussee', 'nombre_de_voies', 'position_par_rapport_au_sol', 'urbain', 'sens_de_circulation'];
    const feats = await wfs(ctx, 'BDTOPO_V3:troncon_de_route', props, bbox, `cpx_numero='${numero.replace(/'/g, '')}'`);
    return feats.flatMap(troncon);
  },

  /** Routes carrossables d'une emprise (importance 1 à 5). @param {Ctx} ctx @param {[number, number, number, number]} bbox */
  async routes(ctx, bbox) {
    const props = ['cpx_numero', 'importance', 'nature', 'largeur_de_chaussee', 'nombre_de_voies', 'position_par_rapport_au_sol', 'urbain'];
    const feats = await wfs(ctx, 'BDTOPO_V3:troncon_de_route', props, bbox, "importance IN ('1','2','3','4','5')");
    return feats.flatMap(troncon);
  },

  /** @param {Ctx} ctx @param {[number, number, number, number]} bbox */
  async batiments(ctx, bbox) {
    const feats = await wfs(ctx, 'BDTOPO_V3:batiment', ['hauteur', 'nombre_d_etages', 'altitude_minimale_sol', 'nature', 'usage_1'], bbox);
    return feats.flatMap((f) => {
      const p = f.properties ?? {};
      return polygones(f.geometry).map((poly) => ({
        id: String(f.id),
        anneau: /** @type {number[][]} */ (poly[0]),
        hauteur: nombre(p.hauteur),
        etages: nombre(p.nombre_d_etages),
        zSol: nombre(p.altitude_minimale_sol),
        nature: String(p.nature ?? ''),
        usage: String(p.usage_1 ?? ''),
      }));
    });
  },

  /** @param {Ctx} ctx @param {[number, number, number, number]} bbox */
  async eaux(ctx, bbox) {
    const feats = await wfs(ctx, 'BDTOPO_V3:plan_d_eau', ['toponyme', 'nature', 'altitude_moyenne'], bbox);
    return feats.flatMap((f) => {
      const p = f.properties ?? {};
      return polygones(f.geometry).map((poly) => ({
        id: String(f.id),
        nom: String(p.toponyme ?? ''),
        nature: String(p.nature ?? ''),
        altitude: nombre(p.altitude_moyenne),
        anneaux: /** @type {number[][][]} */ (poly),
      }));
    });
  },

  /** Zones boisées et haies. @param {Ctx} ctx @param {[number, number, number, number]} bbox */
  async vegetation(ctx, bbox) {
    const zones = await wfs(ctx, 'BDTOPO_V3:zone_de_vegetation', ['nature'], bbox);
    const haies = await wfs(ctx, 'BDTOPO_V3:haie', [], bbox);
    return {
      zones: zones.flatMap((f) =>
        polygones(f.geometry).map((poly) => ({ id: String(f.id), nature: String(f.properties?.nature ?? ''), anneaux: /** @type {number[][][]} */ (poly) })),
      ),
      haies: haies.flatMap((f) => lignes(f.geometry).map((c) => ({ id: String(f.id), points: /** @type {number[][]} */ (c) }))),
    };
  },

  /**
   * Altitudes du terrain nu (RGE ALTI) en des points donnés en longitude et latitude, par lots.
   * @param {Ctx} ctx @param {Array<[number, number]>} lonlat @returns {Promise<number[]>}
   */
  async altitudes(ctx, lonlat) {
    /** @type {number[]} */
    const out = [];
    for (let i = 0; i < lonlat.length; i += ALTI_LOT) {
      const lot = lonlat.slice(i, i + ALTI_LOT);
      const q = new URLSearchParams({
        lon: lot.map((p) => p[0].toFixed(6)).join('|'),
        lat: lot.map((p) => p[1].toFixed(6)).join('|'),
        resource: 'ign_rge_alti_wld',
        delimiter: '|',
        zonly: 'true',
      });
      const r = await ctx.lire(`${ALTI}?${q}`);
      const z = r.elevations;
      if (!Array.isArray(z) || z.length !== lot.length) throw new Error(`altitudes : ${lot.length} points demandés, réponse inattendue`);
      for (const v of z) out.push(typeof v === 'number' ? v : Number(v?.z ?? v));
    }
    return out;
  },
};
