// Outils propres à la sportive, en complément de tools/vehicles/kit.mjs (qui reste inchangé) :
// - sweep : profil fermé balayé le long d'une courbe lisse, profil variable le long du chemin
//   (longerons du cadre, bras oscillant, garde-boue, silencieux) ;
// - ovalHalf : moitié de section en super-ellipse à deux étages (carénage, réservoir, coque) ;
// - motoRim : jante de moto à trois branches dédoublées ;
// - disc : disque de frein ou couronne crantée.

import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Vector3 } from 'three';

/**
 * Profil fermé `profile(t)` (points [a, b], même nombre à chaque t ; a suit le côté S, b le
 * dessus U) balayé le long d'une courbe passant par `points`. S est `side` (+Z par défaut)
 * rendu perpendiculaire à la tangente T, U = S × T. Les triangles sont remis à l'endroit (dehors
 * visible) et les bouts fermés en éventail.
 * @param {*} k boîte à outils
 * @param {[number, number, number][]} points
 * @param {{ material: string, profile: (t: number) => [number, number][], samples?: number, side?: [number, number, number], caps?: boolean, crease?: number }} o
 */
export function sweep(k, points, o) {
  const curve = new CatmullRomCurve3(points.map((p) => new Vector3(...p)), false, 'centripetal');
  const n = o.samples ?? 24;
  const ref = new Vector3(...(o.side ?? [0, 0, 1]));
  /** @type {number[]} */
  const pos = [];
  /** @type {Vector3[]} */
  const centers = [];
  let m = 0;
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const P = curve.getPointAt(t);
    const T = curve.getTangentAt(t).normalize();
    const S = ref.clone().sub(T.clone().multiplyScalar(ref.dot(T))).normalize();
    const U = new Vector3().crossVectors(S, T).normalize();
    const prof = o.profile(t);
    m = prof.length;
    centers.push(P);
    for (const [a, b] of prof) {
      pos.push(P.x + a * S.x + b * U.x, P.y + a * S.y + b * U.y, P.z + a * S.z + b * U.z);
    }
  }
  /** @type {number[]} */
  const idx = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      const a = i * m + j;
      const b = i * m + ((j + 1) % m);
      const c = (i + 1) * m + ((j + 1) % m);
      const d = (i + 1) * m + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  // Sens : les normales des faces latérales doivent s'éloigner de l'axe.
  const v = (/** @type {number} */ i) => new Vector3(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
  let score = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const A = v(idx[t]);
    const B = v(idx[t + 1]);
    const C = v(idx[t + 2]);
    const nrm = new Vector3().crossVectors(B.clone().sub(A), C.clone().sub(A));
    const ring = Math.floor(idx[t] / m);
    score += nrm.dot(A.clone().add(B).add(C).multiplyScalar(1 / 3).sub(centers[ring]));
  }
  if (score < 0) for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
  if (o.caps !== false) {
    for (const [ring, dir] of [[0, -1], [n, 1]]) {
      const c = pos.length / 3;
      const ctr = new Vector3();
      for (let j = 0; j < m; j += 1) ctr.add(v(ring * m + j));
      ctr.multiplyScalar(1 / m);
      pos.push(ctr.x, ctr.y, ctr.z);
      const T = curve.getTangentAt(ring / n);
      for (let j = 0; j < m; j += 1) {
        const a = ring * m + j;
        const b = ring * m + ((j + 1) % m);
        const nrm = new Vector3().crossVectors(v(a).sub(ctr), v(b).sub(ctr));
        if (nrm.dot(T) * dir >= 0) idx.push(c, a, b);
        else idx.push(c, b, a);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return [{ material: o.material, geometry: k.smooth(g, o.crease ?? 60) }];
}

/** Profil en rectangle arrondi (largeur w selon S, hauteur h selon U), 4 × (n + 1) points. */
export function rectProfile(w, h, r, n = 3) {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4);
  /** @type {[number, number][]} */
  const pts = [];
  const corners = [
    [w / 2 - rr, h / 2 - rr, 0],
    [-w / 2 + rr, h / 2 - rr, 90],
    [-w / 2 + rr, -h / 2 + rr, 180],
    [w / 2 - rr, -h / 2 + rr, 270],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= n; i += 1) {
      const a = ((a0 + (90 * i) / n) * Math.PI) / 180;
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  }
  return pts;
}

/** Profil ovale (demi-axes a, b), n points. */
export function ovalProfile(a, b, n = 20, p = 2) {
  /** @type {[number, number][]} */
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const t = (2 * Math.PI * i) / n;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push([a * Math.sign(c) * Math.abs(c) ** (2 / p), b * Math.sign(s) * Math.abs(s) ** (2 / p)]);
  }
  return pts;
}

/**
 * Moitié droite d'une section [z, y], du milieu du dessous au milieu du dessus : super-ellipse à
 * deux étages, largeur maxi `w` à la hauteur `ym`, exposant `pb` sous ym et `pt` au-dessus
 * (2 : ellipse ; plus grand : plus carré). `pinch(y)` multiplie la demi-largeur (creux des genoux).
 * Toujours nb + nt + 1 points.
 * @param {{ yb: number, yt: number, w: number, ym: number, pb?: number, pt?: number, nb?: number, nt?: number, pinch?: (y: number) => number }} o
 * @returns {[number, number][]}
 */
export function ovalHalf(o) {
  const nb = o.nb ?? 14;
  const nt = o.nt ?? 18;
  const pb = o.pb ?? 2.4;
  const pt = o.pt ?? 2.2;
  /** @type {[number, number][]} */
  const pts = [];
  for (let i = 0; i <= nb; i += 1) {
    const th = (-Math.PI / 2) * (1 - i / nb);
    const c = Math.max(0, Math.cos(th));
    const s = Math.abs(Math.sin(th));
    const y = o.ym - (o.ym - o.yb) * s ** (2 / pb);
    const z = i === 0 ? 0 : o.w * c ** (2 / pb);
    pts.push([z * (o.pinch ? o.pinch(y) : 1), y]);
  }
  for (let i = 1; i <= nt; i += 1) {
    const th = (Math.PI / 2) * (i / nt);
    const c = Math.max(0, Math.cos(th));
    const s = Math.sin(th);
    const y = o.ym + (o.yt - o.ym) * s ** (2 / pt);
    const z = i === nt ? 0 : o.w * c ** (2 / pt);
    pts.push([z * (o.pinch ? o.pinch(y) : 1), y]);
  }
  return pts;
}

/**
 * Jante de moto (axe Z, face extérieure vers +Z, centre à l'origine) : fût, moyeu, trois paires
 * de branches. `material` colore fût et branches.
 * @param {*} k
 * @param {{ rim: number, width: number, material: string, hubWidth?: number }} o
 */
export function motoRim(k, o) {
  const w = o.width / 2;
  const r = o.rim;
  /** @type {*[]} */
  const parts = [];
  const barrel = k.lathe(
    [
      [r - 0.012, -w + 0.006],
      [r + 0.012, -w + 0.004],
      [r + 0.014, -w + 0.012],
      [r - 0.006, -w + 0.02],
      [r - 0.016, -w * 0.3],
      [r - 0.016, w * 0.3],
      [r - 0.006, w - 0.02],
      [r + 0.014, w - 0.012],
      [r + 0.012, w - 0.004],
      [r - 0.012, w - 0.006],
    ],
    { material: o.material, segments: 64, crease: 55 },
  );
  parts.push({ material: o.material, geometry: k.doubleSided(barrel[0].geometry) });
  const hw = (o.hubWidth ?? Math.min(0.15, o.width * 0.9)) / 2;
  const hubR = 0.055;
  parts.push(...k.lathe([[0.02, -hw], [hubR, -hw + 0.004], [hubR, hw - 0.004], [0.02, hw]], { material: o.material, segments: 32, crease: 50 }));
  parts.push(...k.lathe([[0.012, -hw - 0.01], [0.02, -hw - 0.01], [0.02, hw + 0.01], [0.012, hw + 0.01]], { material: 'alu', segments: 16, crease: 50 }));
  for (let i = 0; i < 3; i += 1) {
    for (const d of [-1, 1]) {
      const a = (2 * Math.PI * i) / 3 + d * 0.16;
      const spoke = k.roundedExtrude(
        [
          [hubR * 0.7, -0.013],
          [r - 0.012, -0.009],
          [r - 0.012, 0.009],
          [hubR * 0.7, 0.013],
        ],
        { material: o.material, depth: 0.016, bevel: 0.005 },
      );
      // Branche légèrement vrillée vers la paire : rotation autour de Z.
      parts.push(...k.place(spoke, { position: [0, 0, 0], rotation: [0, 0, a] }));
    }
  }
  return parts;
}

/**
 * Disque plat (axe Z) entre les rayons ri et ro, épaisseur e ; `teeth` > 0 : couronne crantée.
 * @param {*} k
 * @param {{ ri: number, ro: number, e: number, material: string, teeth?: number, holes?: number }} o
 */
export function disc(k, o) {
  /** @type {[number, number][]} */
  let outline;
  if (o.teeth) {
    outline = [];
    const n = o.teeth;
    for (let i = 0; i < n * 2; i += 1) {
      const a = (Math.PI * i) / n;
      const rr = i % 2 === 0 ? o.ro : o.ro - 0.008;
      outline.push([rr * Math.cos(a), rr * Math.sin(a)]);
    }
  } else outline = k.circle(0, 0, o.ro, 64);
  const holes = [k.circle(0, 0, o.ri, 32).reverse()];
  const nh = o.holes ?? 0;
  for (let i = 0; i < nh; i += 1) {
    const a = (2 * Math.PI * i) / nh;
    const rc = (o.ri + o.ro) / 2 - (o.teeth ? 0.008 : 0);
    holes.push(k.circle(rc * Math.cos(a), rc * Math.sin(a), Math.min(0.012, (o.ro - o.ri) * 0.28), 10).reverse());
  }
  return k.roundedExtrude(outline, { material: o.material, depth: o.e, bevel: Math.min(0.0015, o.e / 3), bevelSegments: 1, holes, axis: 'z' });
}
