# Modeler un véhicule par le code

Les véhicules sans vrai modèle 3D (Cox, van, bobber, sportive…) sont des **substituts déclarés** (`placeholder_<id>`, listés dans `TODO_ASSETS.md`), modelés en JavaScript d'après leur fiche, exportés en GLB aux conventions du § 8 du cahier des charges. L'app les charge comme de vrais modèles : le jour où un vrai GLB arrive, il prend la place de `body.glb` sans toucher au code.

Exemple complet et commenté : `assets-src/vehicles/van/model.mjs`. Boîte à outils : `tools/vehicles/kit.mjs` (chaque fonction y a son commentaire JSDoc).

## En bref

1. Crée `assets-src/vehicles/<id>/model.mjs` (modèle ci-dessous) et `public/assets/vehicles/<id>/vehicle.json` (manifeste, type `VehicleManifest` de `src/data/vehicleTypes.ts` ; exemple : celui du van).
2. Génère : `npm run vehicles:build -- <id>` (ou `node tools/vehicles/build.mjs <id>`). Écrit `public/assets/vehicles/<id>/body.glb` (jamais versionné) et affiche triangles, appels de dessin, matériaux, nœuds, boîte englobante, poids, durée.
3. Regarde : `node tools/captures/vehicule.mjs <id> --port <ton port>` écrit six vues (`av34`, `profil`, `ar34`, `face`, `dessus`, `roue`, 1000 × 640) et `planche.png` (les six en 3 × 2, 1500 × 640) dans `captures/vehicules/<id>/`. Ou, serveur de dev lancé (`npx vite --port <ton port>`), ouvre le chemin `/PimpMyBichon/src/dev/vehicule/index.html?id=<id>&vue=profil&orbite`.
4. Corrige jusqu'à une silhouette juste et lisse, de trois quarts avant comme de profil. Compare les cotes affichées à celles de la fiche.
5. Vignette du catalogue : la capture écrit aussi `captures/vehicules/<id>/thumb.webp` (512 × 320, tirée du trois quarts avant) ; recopie-la dans `public/assets/vehicles/<id>/thumb.webp` (versionnée et facultative ; `npm run assets:check` demande une ligne de `CREDITS.md` qui couvre le dossier, et note un `body.glb` absent pour un substitut déclaré). Refais-la quand la silhouette change.
6. Ajoute `placeholder_<id>` à `TODO_ASSETS.md`. Le `body.glb` généré est déjà ignoré par git (motif `public/assets/vehicles/*/body.glb` de `.gitignore`, seul le concept y échappe).

```js
// @ts-check
/** @typedef {typeof import('../../../tools/vehicles/kit.mjs')} Kit */

/** @param {Kit} k */
export default function cox(k) {
  const m = new k.Model('cox');          // l'identifiant doit être le nom du dossier
  m.material('paint_carrosserie', { color: '#8fd3c8' }); // valeur d'origine dans le GLB (l'app peint par-dessus)
  m.add('carrosserie', k.loft({ /* … */ material: 'paint_carrosserie' }));
  m.shared('roue', k.wheel({ outer: 0.3, rim: 0.19, width: 0.16, style: 'tole', material: 'paint_jantes' }));
  m.instance('roue_avant_droite', 'roue', { position: [1.2, 0.3, 0.65] });
  m.instance('roue_avant_gauche', 'roue', { position: [1.2, 0.3, -0.65], rotation: [0, Math.PI, 0] });
  return m;
}
```

Le générateur importe `model.mjs`, appelle sa fonction par défaut avec la boîte à outils et attend un `k.Model` en retour. Node seul : pas de DOM, pas de hasard (le résultat doit être identique d'une fois à l'autre et sous Node 20 comme 24), aucune dépendance en plus de `three`.

## Repères et conventions (§ 8)

- **Unités** : mètres, radians.
- **Axes** : avant vers **+X**, haut vers **+Y**, côté **droit vers +Z**, gauche vers −Z.
- **Origine** : au sol (y = 0 sous les pneus), au **centre de l'empattement** (essieux en x = ±empattement / 2 ; pour une moto, roues avant et arrière symétriques en x).
- **Matériaux nommés par rôle**, et seulement ceux-là (le modèle refuse tout autre nom) : `paint_<zone>` (tout ce qui se colore librement ; **une zone par matériau** ; minuscules, chiffres, `_`), `chrome`, `alu`, `black` (plastiques, joints, calandre, dessous), `rubber` (pneus), `glass` (vitres, verres d'optique), `leather` (sellerie), `lamp` (feux avant), `tail` (feux arrière), `signal` (clignotants).
- **Manifeste** : chaque `materials` d'une zone nomme un `paint_<zone>` présent dans le GLB ; la première zone `carrosserie` est la maîtresse ; jantes, cadre, réservoir… vont en `accastillage` ou en `carrosserie` selon la fiche.
- **Nœuds** : minuscules, chiffres et `_`. Roues dans des nœuds à elles, nommés `roue_avant_droite`, `roue_avant_gauche`, `roue_arriere_droite`, `roue_arriere_gauche` (moto : `roue_avant`, `roue_arriere`), centre de la roue à l'origine du maillage partagé, axe de rotation Z : l'app pourra les faire tourner. La page d'aperçu cadre la vue `roue` sur `roue_avant_droite` (ou `roue_avant`).
- **Budgets** : 40 000 à 120 000 triangles posés (une roue partagée compte à chaque pose ; la Cox, habitacle complet compris, a un plafond de 150 000), moins de 60 appels de dessin (= une primitive par matériau et par nœud ; le générateur fusionne tout ce qui partage nœud et matériau).
- **Aucun** nom de constructeur, de modèle ou de marque, nulle part (code, commentaires, noms de nœuds) ; pas de logo, pas de plaque : à la place d'un emblème, rien ou une pastille unie. `npm run guard` doit passer.

## Les outils (`k.` = `tools/vehicles/kit.mjs`)

Chaque outil rend une liste de pièces `[{ material, geometry }]` (BufferGeometry indexée, position et normal seulement). On les combine avec `place`, `orient`, `symmetric`, puis `m.add(nœud, pièces)`.

### Loft : la carrosserie

Une surface lisse tendue sur des sections fermées perpendiculaires à X. C'est l'outil des caisses, capots, réservoirs, carénages. Les normales sont continues d'un bout à l'autre ; les arêtes au-delà de l'angle de pli (`crease`, 50° par défaut) restent franches.

- Une **section** est un contour fermé de points `[z, y]`. Le plus simple : décrire la **moitié droite** (z ≥ 0), du milieu du dessous (z = 0) au milieu du dessus (z = 0), et la refermer avec `k.mirrorSection(moitié)` (symétrie gauche-droite exacte, couture sous la caisse).
- **Toutes les sections d'un loft ont le même nombre de points.** Construis-les avec des segments à nombre de points fixe (`k.segment(a, b, n)`, `k.arc(cz, cy, r, de°, à°, n)`), jamais avec un nombre qui dépend des cotes. `k.roundedHalf({ bottom, top, halfWidthBottom, halfWidthTop, rBottom, rTop, crown })` donne une moitié en trapèze arrondi prête à l'emploi.
- **Deux façons de donner les sections** :
  - sections clés interpolées : `k.loft({ sections: [{ x: -1, points }, { x: 0, points }, { x: 1, points }], along: 8, material })` ; chaque point suit une cubique monotone le long de X (pas de vague entre deux clés) ;
  - fonction échantillonnée (ce que fait le van) : `k.loft({ sectionAt: (x) => k.mirrorSection(moitié(x)), xs, material })`, avec des cotes décrites par des courbes lisses `k.smoothCurve([[x, valeur], …])` (ligne de toit, bas de caisse, demi-largeur en plan) et des abscisses `xs = k.sampleX(x0, x1, { step: 0.035, endZone: 0.16, breaks: [...] })`, resserrées aux bouts.
- `around: 2` subdivise chaque côté du contour (Catmull-Rom centripète : pas de boucle dans un coin serré) : arrondis plus doux pour deux fois plus de triangles.
- **Bouts arrondis** : retire `k.endInset(x, xBout, r)` aux cotes près des bouts (quart de cercle tangent au plan du bout) ; le bout est fermé par un **bouchon plat** (`caps: 'both'`), maillé en grille si la section est symétrique et monte régulièrement de chaque côté.
- **Découper vitres et panneaux sans booléen** : `material` peut être une fonction appelée pour chaque triangle avec `{ x, y, z, nx, ny, nz, u, v, cap }` (centre, normale sortante, position relative le long et autour du loft, vrai sur un bouchon). Exemple du van : pare-brise = `nx > 0.3 && ny > 0.3 && |nz| < 0.45`, vitre de porte = flanc (`sign(z)·nz > 0.55`) entre la ceinture et le haut des vitres, pour x dans l'ouverture.
- **Bords nets** : un bord de région ne peut pas être plus fin que la grille. Pose une abscisse dans `breaks` à chaque bord vertical (montant, joint de porte : deux abscisses à 6 mm l'une de l'autre donnent un joint noir), un point de contour à chaque hauteur de bord horizontal (ceinture, haut des boucliers), et sur les bouchons `capY: [hauteurs]` et `capZ: [demi-largeurs]`.
- `inward: true` : surface vue de l'intérieur (doublure sombre de l'habitacle, pour que les vitres ne montrent pas le vide).

```js
const half = (x) => k.roundedHalf({ bottom: 0.25, top: top(x), halfWidthBottom: w(x), halfWidthTop: w(x) - 0.1, rTop: 0.12 });
const caisse = k.loft({ sectionAt: (x) => k.mirrorSection(half(x)), xs: k.sampleX(-2.2, 2.0), around: 2,
  material: (f) => (f.ny > 0.9 && f.y > 1.4 ? 'paint_toit' : 'paint_carrosserie') });
```

### Révolution, tube, extrusion, formes simples

- `k.lathe([[r, h], …], { material, axis: 'z', segments: 48 })` : profil tourné autour de l'axe (z par défaut, celui des roues ; h suit l'axe). **Sens** : dessine le profil r vers la droite, h vers le haut, et parcours-le en laissant la matière à ta gauche ; le dehors visible est à ta droite (un dessus se parcourt de l'extérieur vers l'axe). Surface visible des deux côtés : `k.doubleSided(géométrie)`.
- `k.tube([[x, y, z], …], { material, radius, closed, radial: 12 })` : tube le long d'une courbe lisse passant par les points (guidon, cadre, échappement, arceau) ; bouts fermés.
- `k.roundedExtrude(contour, { material, depth, bevel, holes, axis })` : contour fermé `[u, v]` extrudé, bords arrondis de `bevel`, épaisseur centrée. `axis: 'z'` : (u, v) = (x, y) ; `'x'` : (u, v) = (z, y) ; `'y'` : (u, v) = (x, z). Contours tout faits : `k.roundedRect(l, h, r)`, `k.circle(cx, cy, r, n)`. Poignées, sièges, garde-boue plats, plaques.
- `k.rod(de, à, rayon, { material })` : cylindre d'un point à un autre (bras, axe, rayon de roue).
- `k.ellipsoid(centre, [rx, ry, rz], { material })` : coques de rétroviseur, phares ronds, réservoirs simples.

### Placer, symétriser

- `k.place(pièces, { position, rotation: [rx, ry, rz], scale })` (copie déplacée).
- `k.orient(pièces, { position, normal, up })` : pose une pièce modelée « face vers +Z local » (une optique) pour qu'elle regarde vers `normal`.
- `k.symmetric(pièces)` : les pièces et leur miroir gauche-droite (triangles remis à l'endroit). `k.mirrorZ(géométrie)` pour une seule.
- `k.smooth(géométrie, angle)` : recalcule des normales lissées avec angle de pli (utile après une géométrie three faite à la main).

### Roues

- `k.wheel({ outer, rim, width, style, material, holes, spokes, moto })` : pneu + jante, axe Z, face extérieure vers **+Z**, centre à l'origine. Pose-la côté droit telle quelle, côté gauche avec `rotation: [0, Math.PI, 0]`.
  - `style: 'tole'` : voile plat percé d'une couronne de `holes` trous ronds (14 par défaut), moyeu noir, écrous chromés ;
  - `style: 'branches'` : moyeu et `spokes` branches (5) ;
  - `style: 'rayons'` : rayons croisés fins (moto ; `spokes` 36, `spokeMaterial` chrome).
  - `material` : un `paint_jantes` (ou autre `paint_<zone>`) pour que la jante se colore ; `barrelMaterial` pour le fût s'il diffère.
- `k.tire({ outer, rim, width, moto })` seul : pneu à flanc bombé ; `moto: true` donne une section ronde. 17 pouces : `rim: 0.216`.
- Toujours `m.shared('roue', …)` puis `m.instance(...)` : la roue n'est écrite qu'une fois dans le GLB.

### Optiques

- Sur une carrosserie, le plus net est une **région** du loft (`'lamp'`, `'tail'`, `'signal'`) cerclée d'une bande `'black'` de 2 cm : elle se lit sur une peinture claire (un phare `lamp` blanc sur une caisse blanche ne se voit pas sans ce cerclage).
- Pièce rapportée : `k.lamp(contour, { material: 'signal', bulge: 0.006 })` donne un fond allumé sous un verre bombé (contour étoilé : rond, trapèze, goutte), face vers +Z local, à poser avec `k.orient`.

### Comptes

`k.triangleCount(géométrie)`, `k.partsTriangles(pièces)` ; le générateur affiche le total posé.

## Regarder

- La page `src/dev/vehicule/` pose la peinture de l'app (`createPaintMaterial` et `applyPaint`) sur chaque zone du manifeste, avec sa couleur et sa finition d'origine, et un matériau par rôle sur le reste, sous un studio sans fichier externe avec une barre néon magenta à gauche et une cyan à droite (pour juger les reflets). Un matériau `paint_*` absent du manifeste est signalé en haut à gauche ; un rôle inconnu sort en magenta vif.
- Paramètres : `id`, `vue` (`av34`, `profil`, `ar34`, `face`, `arriere`, `dessus`, `roue`), `orbite` (souris).
- La capture prend la vraie carte du poste (`--use-angle=gl-egl --ignore-gpu-blocklist --enable-gpu`) ; `--logiciel` passe en SwiftShader. Plusieurs captures en parallèle : un port chacun (`--port`).

## Pièges rencontrés (van)

- **Sens des triangles** : le loft calcule seul le sens du contour ; si tu écris une géométrie à la main, vérifie de trois quarts avant : une caisse retournée se voit « en creux » (on voit l'intérieur du flanc opposé). Le test `tests/unit/vehicules-outillage.test.ts` contrôle l'orientation des outils.
- **Un phare blanc sur une caisse blanche est invisible** : cercle-le de noir.
- **Bouchon en éventail** : un grand bout plat maillé en éventail donne des régions en nœud papillon. La grille (automatique sur une section symétrique) et `capY`/`capZ` règlent ça.
- **Catmull-Rom uniforme** faisait des boucles dans les coins serrés (rayon de 3 cm à côté de côtés de 15 cm) : la subdivision est centripète. Garde quand même des points de contour à peu près réguliers.
- **Contour qui se replie** : si une hauteur imposée (rail, haut de vitre) passe sous la précédente quand la caisse s'abaisse (capot), le contour se croise. Borne-la (`Math.min(1.0, épaule - 0.05)`) ou exprime-la en fraction entre deux hauteurs.
- **Passages de roue** : le van les fait par une marche dans la section (paroi intérieure à z = 0,66, voûte en arc au-dessus de chaque essieu) ; les faces tournées vers le bas ou vers l'intérieur sont `black`. Mets des abscisses `breaks` aux bords de l'arc.
- **Rétroviseurs** : la largeur de la fiche est souvent « hors rétroviseurs » ; garde les rétroviseurs dans un nœud à part (`accessoires`) pour mesurer la caisse seule.
- **Budget** : la roue compte quatre fois. Le van tient en 113 000 triangles : caisse 65 000 (loft `around: 2`, pas de 3,5 cm), roues 4 × 9 000, habitacle 9 000.
