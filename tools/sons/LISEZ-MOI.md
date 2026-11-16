# Sons des moteurs : écouter, choisir, fabriquer

1. `npm run sons:ecoute`, puis ouvre http://127.0.0.1:4950/ sur le poste (serveur local seulement, rien n'est publié ; `-- --port <n>` pour un autre port).
2. En haut, choisis une famille (la Cox, le van, le bobber, la sportive, le V8, ou la route, l'atelier, l'interface).
3. Chaque emplacement (start, idle, rev, stop, low, mid, high, sweep_up, sweep_down, backfire…) liste ses découpes : description, durée, régime estimé, licence. « Écouter » joue la découpe telle quelle, « En boucle » la fait tourner telle qu'elle sera fabriquée, « Retenir » la choisit.
4. « Régler » la met dans l'atelier en bas : bornes dans la prise, points de bouclage, fondu de bouclage, régime réel (tr/min), gain (dB).
5. « Écouter fabriqué » fait entendre exactement ce que la fabrication produira : la boucle tourne sans fin, le niveau est égalisé.
6. « Retenir pour l'emplacement » écrit le choix dans `assets-src/sons/choix.json` ; « Ajouter en variante » garde jusqu'à trois coups de gaz ou retours de flamme.
7. « Prises brutes » (en bas de la famille) : « Couper dedans », puis règle début et fin à l'oreille pour tailler ta propre découpe.
8. Une prise marquée « demande l'accord du commanditaire » s'écoute mais ne peut pas être retenue (liste « accordRequis » du choix).
9. `npm run sons:build` fabrique `public/assets/audio/engines/<famille>/` (Opus, boucles sans clic, niveaux égalisés, `engine.json`), met à jour `CREDITS.md` et `src/audio/engine/familles.json` ; à versionner ensuite.
10. Sans le dossier privé `.private-assets/sons/` (la CI, un autre poste), les deux commandes ne font rien et le disent ; l'app garde les sons versionnés.
