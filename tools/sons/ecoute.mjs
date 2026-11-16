#!/usr/bin/env node
// @ts-check
// npm run sons:ecoute : petit serveur local (127.0.0.1 seulement, jamais publié, hors du build)
// pour écouter les découpes et les prises brutes du dossier privé, régler une boucle et retenir une
// prise par emplacement. Le choix s'écrit dans assets-src/sons/choix.json ; « npm run sons:build »
// fabrique ensuite les sons de l'app. Mode d'emploi : tools/sons/LISEZ-MOI.md.
//
// Options : --port <n> (4950 par défaut).

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOSSIER_PRIVE, licence, lireCatalogue, lireChoix, ecrireChoix, privePresent, problemesChoix } from './catalogue.mjs';
import { famille, FAMILLES } from './emplacements.mjs';
import { fabriquer } from './fabriquer.mjs';
import { analyser, decoder, ffmpegPresent, wav } from './signal.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const PORT = Number(args.includes('--port') ? args[args.indexOf('--port') + 1] : process.env.PORT ?? 4950);

if (!privePresent()) {
  console.log(`sons:ecoute : dossier privé absent (${DOSSIER_PRIVE}) : rien à écouter.`);
  process.exit(0);
}
if (!ffmpegPresent()) {
  console.log('sons:ecoute : ffmpeg absent : impossible de lire les prises.');
  process.exit(1);
}

/** Catalogue relu à chaque demande : une découpe ajoutée au dossier privé apparaît sans relancer. */
function catalogue() {
  const choix = lireChoix();
  return { choix, ...lireCatalogue(new Set(choix.accordRequis ?? [])) };
}

/** @param {import('node:http').ServerResponse} res @param {number} status @param {unknown} body */
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** @param {import('node:http').IncomingMessage} req */
async function corps(req) {
  let texte = '';
  for await (const morceau of req) texte += morceau;
  return JSON.parse(texte || '{}');
}

/** @param {URLSearchParams} q @param {string} nom */
function nombre(q, nom) {
  const v = q.get(nom);
  return v === null || v === '' ? undefined : Number(v);
}

/** Retenue décrite par la requête (prise, bornes, boucle, fondu, régime, gain). */
function retenueDe(/** @type {URLSearchParams} */ q) {
  const bd = nombre(q, 'bd');
  const bf = nombre(q, 'bf');
  return {
    prise: q.get('prise') ?? '',
    debut: nombre(q, 'debut') ?? 0,
    fin: nombre(q, 'fin') ?? 0,
    ...(bd !== undefined && bf !== undefined ? { boucle: { debut: bd, fin: bf } } : {}),
    fondu: nombre(q, 'fondu'),
    gain: nombre(q, 'gain') ?? 0,
  };
}

const serveur = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const q = url.searchParams;
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(readFileSync(join(ICI, 'page.html')));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/catalogue') {
      const { choix, prises, decoupes } = catalogue();
      const parId = new Map(prises.map((p) => [p.id, p]));
      json(res, 200, {
        familles: FAMILLES,
        choix,
        problemes: problemesChoix(choix),
        prises: prises.map((p) => ({ ...p, nom: p.fichier.split('/').pop(), licenceCourte: licence(p.licence).texte })),
        decoupes: decoupes.map((d) => {
          const p = parId.get(d.prise);
          return { ...d, duree: Math.round((d.fin - d.debut) * 10) / 10, auteur: p?.auteur ?? '', licence: licence(p?.licence ?? '').texte, accord: p?.accord ?? false };
        }),
      });
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/api/extrait' || url.pathname === '/api/apercu' || url.pathname === '/api/analyse')) {
      const { parId } = catalogue();
      const retenue = retenueDe(q);
      const prise = parId.get(retenue.prise);
      if (!prise) return json(res, 404, { erreur: 'prise inconnue' });
      if (!(retenue.fin > retenue.debut)) return json(res, 400, { erreur: 'bornes illisibles' });
      if (url.pathname === '/api/extrait' || url.pathname === '/api/analyse') {
        const pcm = decoder(join(DOSSIER_PRIVE, prise.fichier), retenue.debut, retenue.fin);
        if (url.pathname === '/api/analyse') return json(res, 200, analyser(pcm));
        res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'no-store' });
        res.end(wav(pcm));
        return;
      }
      const fam = famille(q.get('famille') ?? '');
      const empl = fam?.emplacements.find((e) => e.id === q.get('emplacement'));
      if (!fam || !empl) return json(res, 400, { erreur: 'famille ou emplacement inconnu' });
      const fait = fabriquer(retenue, empl, prise);
      res.writeHead(200, {
        'content-type': 'audio/wav',
        'cache-control': 'no-store',
        'x-fabrication': JSON.stringify({ boucle: fait.boucle, gainDb: fait.gainDb, limite: fait.limite, analyse: fait.analyse }),
      });
      res.end(wav(fait.pcm));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/choix') {
      const demande = await corps(req);
      const { choix, parId } = catalogue();
      const fam = famille(demande.famille);
      if (!fam) return json(res, 400, { erreur: 'famille inconnue' });
      choix.familles[fam.id] ??= { emplacements: {} };
      const contenu = choix.familles[fam.id];
      if (!contenu) return json(res, 500, { erreur: 'choix illisible' });
      if (demande.action === 'gaz') {
        if (demande.gaz === 'boucles' || demande.gaz === 'prises') contenu.gaz = demande.gaz;
        else delete contenu.gaz;
      } else {
        const empl = fam.emplacements.find((e) => e.id === demande.emplacement);
        if (!empl) return json(res, 400, { erreur: 'emplacement inconnu' });
        const liste = contenu.emplacements[empl.id] ?? [];
        if (demande.action === 'retirer') {
          liste.splice(Number(demande.rang), 1);
        } else {
          const r = demande.retenue ?? {};
          const prise = parId.get(r.prise);
          if (!prise) return json(res, 404, { erreur: 'prise inconnue' });
          if (prise.accord) return json(res, 403, { erreur: 'cette prise demande l’accord du commanditaire' });
          /** @type {import('./catalogue.mjs').Retenue} */
          const retenue = { prise: prise.id, debut: Number(r.debut), fin: Number(r.fin), gain: Number(r.gain ?? 0) };
          if (empl.genre === 'boucle' && r.boucle) retenue.boucle = { debut: Number(r.boucle.debut), fin: Number(r.boucle.fin) };
          if (empl.genre === 'boucle') retenue.fondu = Number(r.fondu ?? 0.12);
          retenue.regime = r.regime === null || r.regime === undefined || r.regime === '' ? null : Number(r.regime);
          retenue.pourquoi = 'retenue à l’écoute';
          if (demande.action === 'ajouter' && liste.length < empl.variantes) liste.push(retenue);
          else liste.splice(0, liste.length, retenue);
        }
        if (liste.length === 0) delete contenu.emplacements[empl.id];
        else contenu.emplacements[empl.id] = liste;
      }
      const problemes = problemesChoix(choix);
      if (problemes.length > 0) return json(res, 400, { erreur: problemes.join(' ; ') });
      ecrireChoix(choix);
      return json(res, 200, { choix });
    }
    json(res, 404, { erreur: 'introuvable' });
  } catch (erreur) {
    json(res, 500, { erreur: erreur instanceof Error ? erreur.message : String(erreur) });
  }
});

serveur.listen(PORT, '127.0.0.1', () => {
  console.log(`sons:ecoute : ouvre http://127.0.0.1:${PORT}/ dans le navigateur du poste (Ctrl+C pour arrêter).`);
});
