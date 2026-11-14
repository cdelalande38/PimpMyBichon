import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { detectPrivateAssets } from './tools/private-assets.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

function git(args: string[]): string | null {
  try {
    const out = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

// GitHub Pages sert un site de projet sous /<nom-du-dépôt>/ (§ 11).
// PMB_BASE permet un autre socle, par exemple "./" pour un APK qui embarque les fichiers.
const base = process.env.PMB_BASE ?? '/PimpMyBichon/';

// Identité du build, affichée dans « Sous le capot » pour savoir quelle version tourne sur le téléphone.
// Un « + » signale un arbre de travail modifié par rapport au commit.
const head = process.env.GITHUB_SHA ?? git(['rev-parse', 'HEAD']);
const dirty = process.env.GITHUB_SHA ? false : Boolean(git(['status', '--porcelain']));
const buildInfo = {
  version: pkg.version,
  commit: head ? `${head.slice(0, 7)}${dirty ? '+' : ''}` : 'local',
  date: git(['log', '-1', '--format=%cI']) ?? '',
  privateAssets: detectPrivateAssets({ root }),
};

const NIGHT = '#0a0911';

/** Dossier, sous le socle de l'app, où le transcodeur des textures KTX2 est servi (cf. src/data/bench.ts). */
const BASIS_DIR = 'libs/basis/';
const BASIS_FILES: Record<string, string> = {
  'basis_transcoder.js': 'text/javascript',
  'basis_transcoder.wasm': 'application/wasm',
};

/**
 * Transcodeur Basis Universal (textures KTX2 des modèles), fourni par three : servi par l'app,
 * jamais par un CDN. Émis dans le build sous libs/basis/, servi tel quel par le serveur de
 * développement. Aucune copie versionnée : la source reste le paquet three installé.
 */
function basisTranscoder(): Plugin {
  const require = createRequire(import.meta.url);
  const source = dirname(require.resolve('three/examples/jsm/libs/basis/basis_transcoder.js'));
  return {
    name: 'pmb-basis-transcoder',
    configureServer(server) {
      const prefix = `${base.startsWith('/') ? base : '/'}${BASIS_DIR}`;
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        const name = path.startsWith(prefix) ? path.slice(prefix.length) : '';
        const type = BASIS_FILES[name];
        if (!type) {
          next();
          return;
        }
        res.setHeader('Content-Type', type);
        res.end(readFileSync(join(source, name)));
      });
    },
    generateBundle() {
      for (const name of Object.keys(BASIS_FILES)) {
        this.emitFile({
          type: 'asset',
          fileName: `${BASIS_DIR}${name}`,
          source: readFileSync(join(source, name)),
        });
      }
    },
  };
}

export default defineConfig({
  base,
  define: {
    __PMB_BUILD__: JSON.stringify(buildInfo),
  },
  plugins: [
    react(),
    basisTranscoder(),
    VitePWA({
      // Service worker écrit à la main : progression du précache et, plus tard,
      // mise en cache à la demande des véhicules et des stations de radio.
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'sw.ts',
      // Jamais de rechargement surprise : la nouvelle version attend un geste ou le prochain lancement.
      registerType: 'prompt',
      injectRegister: false,
      // Les icônes entrent déjà dans le précache par le motif de fichiers : pas de doublon.
      includeManifestIcons: false,
      manifest: {
        name: 'PimpMyBichon',
        short_name: 'PimpMyBichon',
        description:
          'L’atelier de Bichon : prépare un véhicule dans le garage, sors-le de nuit, livre la commande.',
        lang: 'fr',
        dir: 'ltr',
        id: base,
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: NIGHT,
        theme_color: NIGHT,
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icons/monochrome-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'monochrome',
          },
        ],
      },
      injectManifest: {
        // Script classique : le type de service worker le plus largement pris en charge.
        rollupFormat: 'iife',
        // Précache : toute la coque de l'app, le modèle de banc d'essai et le transcodeur de ses
        // textures. Les véhicules et la musique n'y entrent pas, ils se téléchargent à la demande
        // puis restent hors ligne (§ 7).
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,webp,ico,glb,wasm}'],
        globIgnores: ['assets/vehicles/**', 'assets/audio/**'],
        // Le modèle de banc d'essai pèse près de 10 Mo (budget d'un véhicule : 8 à 15 Mo, § 8).
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    // three.js pèse environ 700 ko minifié à lui seul : le seuil par défaut (500 ko)
    // signalerait un avertissement permanent et sans objet.
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        // Morceaux stables d'un déploiement à l'autre : sur un mauvais réseau,
        // une mise à jour de l'app ne retélécharge pas three.js.
        // Un groupe emporte aussi les dépendances de ses modules : la priorité la plus haute va
        // donc à React, sinon il partirait dans le morceau 3D et la coque attendrait three.js.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler|zustand|use-sync-external-store)[\\/]/,
              priority: 30,
            },
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 20 },
            {
              name: 'r3f',
              test: /node_modules[\\/](@react-three|postprocessing|three-stdlib|maath)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
