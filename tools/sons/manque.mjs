#!/usr/bin/env node
// @ts-check
// npm run sons:manque : la liste de courses des sons. Pour chaque famille de moteur et pour les
// bruitages de route, les emplacements encore vides (aucun fichier fabriqué dans public/assets/
// audio/), avec leur genre, la durée et le niveau visés, et une description du son voulu en une
// phrase, en français et en anglais, prête à donner à un générateur de sons. Aucune marque, aucun
// modèle : on décrit la mécanique (« quatre cylindres à plat refroidi par air »).
//
// Options : --json (sortie JSON sur la sortie standard), --sortie <fichier> (écrit le JSON là).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from '../lib/cli.mjs';
import { FAMILLES } from './emplacements.mjs';

/** Consigne commune, ajoutée à chaque description. */
const SEUL_FR = 'son seul, sans musique ni voix';
const SEUL_EN = 'sound effect only, no music, no voice';

/**
 * Moteurs décrits par leur mécanique, et les régimes visés des boucles tenues (tr/min).
 * @type {Record<string, { fr: string, en: string, bas: number, moyen: number, haut: number }>}
 */
export const MOTEURS = {
  'quatre-a-plat': {
    fr: 'petit quatre cylindres à plat refroidi par air de voiture ancienne, échappement d’origine',
    en: 'small air-cooled flat-four engine of a vintage compact car, stock exhaust',
    bas: 1800,
    moyen: 3000,
    haut: 4200,
  },
  'diesel-turbo': {
    fr: 'quatre cylindres turbo diesel de fourgon, claquement diesel et sifflement léger du turbo',
    en: 'turbo-diesel four-cylinder van engine, diesel clatter and a light turbo whistle',
    bas: 1500,
    moyen: 2500,
    haut: 3500,
  },
  'bicylindre-v': {
    fr: 'gros bicylindre en V de moto custom, échappement libre, battement lent et irrégulier',
    en: 'large V-twin custom motorcycle engine, open straight pipes, slow uneven beat',
    bas: 1800,
    moyen: 3000,
    haut: 4500,
  },
  'quatre-en-ligne-moto': {
    fr: 'quatre cylindres en ligne de moto sportive, son aigu qui monte très haut dans les tours',
    en: 'inline-four sport motorcycle engine, high-pitched, revving very high',
    bas: 4000,
    moyen: 8000,
    haut: 12000,
  },
  v8: {
    fr: 'gros V8 essence à échappement sport, grondement grave et rond',
    en: 'big-block petrol V8 with a sport exhaust, deep round rumble',
    bas: 1800,
    moyen: 3500,
    haut: 5500,
  },
};

/** @typedef {{ duree: number, fr: string, en: string }} Brief */

/**
 * Emplacements d'un moteur : durée visée (s) et description ({m} : le moteur, {r} : le régime).
 * @type {Record<string, Brief>}
 */
const BRIEFS_MOTEUR = {
  start: {
    duree: 3,
    fr: 'Démarrage d’un {m} : démarreur, le moteur prend, puis deux secondes de ralenti ; prise extérieure à deux mètres de l’échappement',
    en: 'Engine start of a {m}: starter cranking, the engine catches, then two seconds of idle; exterior recording two metres from the exhaust',
  },
  idle: {
    duree: 6,
    fr: 'Ralenti tenu d’un {m}, régime stable sans coup de gaz, bouclable sans clic ; prise extérieure près de l’échappement',
    en: 'Steady idle of a {m}, constant rpm with no throttle blips, seamlessly loopable; exterior recording near the exhaust',
  },
  rev: {
    duree: 2,
    fr: 'Coup de gaz à vide d’un {m} : du ralenti à mi-régime puis retour au ralenti ; prise extérieure près de l’échappement',
    en: 'Single throttle blip of a {m} in neutral: from idle to mid revs and back to idle; exterior recording near the exhaust',
  },
  stop: {
    duree: 2,
    fr: 'Coupure du contact d’un {m} : le ralenti s’éteint en une à deux secondes, puis le silence ; prise extérieure',
    en: 'Ignition off on a {m}: the idle dies out within one to two seconds, then silence; exterior recording',
  },
  low: {
    duree: 6,
    fr: '{m}, en charge légère, régime tenu bas vers {r} tr/min, sans variation ni passage de rapport, bouclable ; prise embarquée près de l’échappement',
    en: '{m}, under light load, held at a low steady {r} rpm, no rev change and no gear shift, seamlessly loopable; onboard recording near the exhaust',
  },
  mid: {
    duree: 6,
    fr: '{m}, en charge, régime moyen tenu vers {r} tr/min, sans variation ni passage de rapport, bouclable ; prise embarquée près de l’échappement',
    en: '{m}, under load, held at a steady mid {r} rpm, no rev change and no gear shift, seamlessly loopable; onboard recording near the exhaust',
  },
  high: {
    duree: 5,
    fr: '{m}, en pleine charge, régime haut tenu vers {r} tr/min, sans variation ni passage de rapport, bouclable ; prise embarquée près de l’échappement',
    en: '{m}, at full load, held at a steady high {r} rpm, no rev change and no gear shift, seamlessly loopable; onboard recording near the exhaust',
  },
  sweep_up: {
    duree: 4,
    fr: 'Montée en régime continue d’un {m} en pleine charge, du ralenti jusqu’au régime maximal en quatre secondes, sans passage de rapport',
    en: 'Continuous full-throttle rev sweep of a {m} from idle up to redline over four seconds, no gear shift',
  },
  sweep_down: {
    duree: 4,
    fr: 'Descente en régime continue d’un {m}, pied levé, du régime haut jusqu’au ralenti en quatre secondes, sans passage de rapport',
    en: 'Continuous off-throttle rev drop of a {m} from high revs down to idle over four seconds, no gear shift',
  },
  backfire: {
    duree: 1,
    fr: 'Retour de flamme à l’échappement d’un {m} au lever de pied : une ou deux détonations sèches, puis le silence',
    en: 'Exhaust backfire of a {m} on lift-off: one or two sharp pops, then silence',
  },
};

/**
 * Bruitages de route : durée visée (s) et description.
 * @type {Record<string, Brief>}
 */
const BRIEFS_ROUTE = {
  'roulement-sec': {
    duree: 6,
    fr: 'Roulement de pneus de voiture sur asphalte sec vers 70 km/h, régulier, sans moteur audible, bouclable sans clic ; prise embarquée près d’une roue',
    en: 'Car tyres rolling on dry asphalt at about 70 km/h, steady, no audible engine, seamlessly loopable; onboard recording near a wheel',
  },
  'roulement-mouille': {
    duree: 6,
    fr: 'Roulement de pneus de voiture sur chaussée mouillée vers 70 km/h, chuintement de l’eau projetée, sans moteur audible, bouclable sans clic',
    en: 'Car tyres rolling on a wet road at about 70 km/h, hiss of sprayed water, no audible engine, seamlessly loopable',
  },
  vent: {
    duree: 8,
    fr: 'Souffle du vent autour d’une voiture lancée vers 110 km/h, entendu de l’habitacle, régulier, sans moteur ni pneus, bouclable sans clic',
    en: 'Wind noise around a car cruising at about 110 km/h, heard from inside the cabin, steady, no engine and no tyres, seamlessly loopable',
  },
  pluie: {
    duree: 8,
    fr: 'Pluie modérée et régulière sur le toit et le pare-brise d’une voiture, entendue de l’intérieur, sans tonnerre ni essuie-glaces, bouclable sans clic',
    en: 'Steady moderate rain on the roof and windscreen of a car, heard from inside, no thunder, no wipers, seamlessly loopable',
  },
  tunnel: {
    duree: 8,
    fr: 'Ambiance d’un tunnel routier la nuit : grondement sourd et réverbéré, sans véhicule distinct qui passe, bouclable sans clic',
    en: 'Road tunnel ambience at night: low reverberant rumble, no distinct passing vehicle, seamlessly loopable',
  },
  nos: {
    duree: 4,
    fr: 'Souffle puissant et continu de gaz sous pression injecté dans un moteur, sifflement chuintant, sans moteur ni explosion, bouclable sans clic',
    en: 'Powerful continuous hiss of pressurised gas being injected into an engine, rushing whoosh, no engine, no explosion, seamlessly loopable',
  },
  freinage: {
    duree: 2,
    fr: 'Freinage appuyé d’une voiture vers 60 km/h : frottement des plaquettes et léger crissement des pneus jusqu’à l’arrêt, sans moteur',
    en: 'Hard braking of a car from about 60 km/h: brake pad friction and a light tyre squeal down to a stop, no engine',
  },
  'derapage-court': {
    duree: 1,
    fr: 'Crissement bref de pneus sur asphalte sec, une seconde, attaque nette et fin adoucie, sans moteur',
    en: 'Short tyre screech on dry asphalt, one second, sharp attack and soft tail, no engine',
  },
  'derapage-long': {
    duree: 4,
    fr: 'Crissement de pneus prolongé et régulier dans un virage pris trop vite, sans moteur, bouclable sans clic',
    en: 'Sustained steady tyre screech through a corner taken too fast, no engine, seamlessly loopable',
  },
  burnout: {
    duree: 6,
    fr: 'Pneus qui patinent sur place et crissent en continu, moteur discret, bouclable sans clic',
    en: 'Tyres spinning on the spot with a continuous screech, engine kept quiet, seamlessly loopable',
  },
  'nos-depart': {
    duree: 0.8,
    fr: 'Décharge brève et sèche de gaz sous pression, attaque franche puis retombée rapide, comme une vanne qui s’ouvre d’un coup, sans moteur ni explosion',
    en: 'Brief sharp discharge of pressurised gas, hard attack then a quick decay, like a valve snapping open, no engine, no explosion',
  },
  'depart-feu': {
    duree: 0.3,
    fr: 'Bip électronique bref et net d’un feu de départ qui s’allume au rouge, ton médium, attaque franche, sans écho ni voix',
    en: 'Short clean electronic beep of a start light turning red, mid-pitched tone, sharp attack, no echo, no voice',
  },
  'depart-vert': {
    duree: 0.8,
    fr: 'Bip électronique plus long et plus aigu d’un feu de départ qui passe au vert, ton tenu puis coupé net, sans écho ni voix',
    en: 'Longer, higher-pitched electronic beep of a start light turning green, held tone then a clean cut, no echo, no voice',
  },
  rapport: {
    duree: 0.5,
    fr: 'Claquement mécanique bref d’un levier de vitesses de voiture qui passe un rapport, entendu de l’habitacle, sans moteur',
    en: 'Short mechanical clunk of a car gear lever shifting into gear, heard from the cabin, no engine',
  },
  'passage-1': {
    duree: 3,
    fr: 'Une voiture passe devant le micro vers 90 km/h, de loin à loin, la nuit sur une route calme',
    en: 'A single car passing by the microphone at about 90 km/h, from far to far, at night on a quiet road',
  },
  'passage-2': {
    duree: 3,
    fr: 'Une moto passe devant le micro vers 90 km/h, de loin à loin, la nuit sur une route calme',
    en: 'A single motorcycle passing by the microphone at about 90 km/h, from far to far, at night on a quiet road',
  },
  'klaxon-1': {
    duree: 1,
    fr: 'Coup de klaxon bref et aigu d’une petite voiture ancienne',
    en: 'Short high-pitched horn honk of a small vintage car',
  },
  'klaxon-2': {
    duree: 1,
    fr: 'Coup de klaxon bref et grave d’un fourgon',
    en: 'Short low-pitched horn honk of a van',
  },
  'klaxon-3': {
    duree: 1.5,
    fr: 'Klaxon à deux tons bref, puissant',
    en: 'Short loud two-tone horn',
  },
  'essuie-glaces': {
    duree: 1.5,
    fr: 'Un aller-retour d’essuie-glace sur un pare-brise mouillé, entendu de l’intérieur',
    en: 'One back-and-forth sweep of a windscreen wiper on a wet windscreen, heard from inside',
  },
  clignotant: {
    duree: 0.6,
    fr: 'Un seul cycle de clignotant de voiture (tic puis tac), entendu de l’intérieur',
    en: 'One single cycle of a car turn signal relay (tick then tock), heard from inside',
  },
  backfire: {
    duree: 1,
    fr: 'Retour de flamme à l’échappement d’une voiture au lever de pied : une détonation sèche, puis le silence',
    en: 'Car exhaust backfire on lift-off: one sharp pop, then silence',
  },
};

/**
 * Emplacements de moteur que l'app joue : le lecteur (src/audio/engine/lecteur.ts : boucles,
 * démarrage, coupure, coups de gaz) et les bruitages de route (retour de flamme).
 */
const JOUES_MOTEUR = new Set(['start', 'idle', 'rev', 'stop', 'low', 'mid', 'high', 'backfire']);

/** Emplacements présents dans un manifeste fabriqué (engine.json ou sfx.json), ou aucun. */
export function emplacementsPresents(/** @type {string} */ fichier) {
  if (!existsSync(fichier)) return new Map();
  /** @type {Map<string, number>} */
  const presents = new Map();
  try {
    const lu = JSON.parse(readFileSync(fichier, 'utf8'));
    for (const item of [...(lu.boucles ?? []), ...(lu.ponctuels ?? [])]) {
      if (typeof item?.emplacement === 'string') presents.set(item.emplacement, (presents.get(item.emplacement) ?? 0) + 1);
    }
  } catch {
    return new Map();
  }
  return presents;
}

/**
 * Emplacements de route joués par l'app : ceux que nomme src/data/bruitages.ts (une seule vérité,
 * lue comme texte : l'outil ne charge pas le TypeScript).
 */
export function emplacementsBranches(/** @type {string} */ texte) {
  return new Set([...texte.matchAll(/emplacement:\s*'([\w-]+)'/g)].map((trouve) => trouve[1] ?? ''));
}

/** @param {string} modele @param {Record<string, string>} valeurs */
function remplir(modele, valeurs) {
  return modele.replace(/\{(\w)\}/g, (_, cle) => valeurs[cle] ?? '');
}

/**
 * La liste des emplacements vides, famille par famille (les cinq moteurs et la route).
 * @param {{ racine?: string }} [options]
 */
export function listeManques({ racine = REPO_ROOT } = {}) {
  const audio = join(racine, 'public', 'assets', 'audio');
  const dataBruitages = join(racine, 'src', 'data', 'bruitages.ts');
  const branches = existsSync(dataBruitages) ? emplacementsBranches(readFileSync(dataBruitages, 'utf8')) : new Set();
  const familles = [];
  for (const fam of FAMILLES) {
    if (fam.genre === 'bruitage' && fam.id !== 'route') continue;
    const moteur = MOTEURS[fam.id];
    const manifeste = join(audio, fam.dossier, fam.genre === 'moteur' ? 'engine.json' : 'sfx.json');
    const presents = emplacementsPresents(manifeste);
    const vides = [];
    for (const empl of fam.emplacements) {
      if (presents.has(empl.id)) continue;
      const brief = fam.genre === 'moteur' ? BRIEFS_MOTEUR[empl.id] : BRIEFS_ROUTE[empl.id];
      if (!brief) throw new Error(`sons:manque : pas de description pour ${fam.id} · ${empl.id}`);
      const regime = moteur ? String(empl.id === 'low' ? moteur.bas : empl.id === 'high' ? moteur.haut : moteur.moyen) : '';
      const fr = `${remplir(brief.fr, { m: moteur?.fr ?? '', r: regime.replace(/\B(?=(\d{3})+$)/g, ' ') })} ; ${SEUL_FR}.`;
      const en = `${remplir(brief.en, { m: moteur?.en ?? '', r: regime })}; ${SEUL_EN}.`;
      vides.push({
        emplacement: empl.id,
        nom: empl.nom,
        genre: empl.genre,
        dureeVisee: brief.duree,
        niveauViseDb: empl.cible,
        variantes: empl.variantes,
        // Moteurs : ce que le lecteur joue (les montées et descentes continues attendent). Route :
        // ce que nomme src/data/bruitages.ts.
        joue: fam.genre === 'moteur' ? JOUES_MOTEUR.has(empl.id) : branches.has(empl.id),
        fichier: `public/assets/audio/${fam.dossier}/${empl.variantes > 1 ? `${empl.id}-1.ogg` : `${empl.id}.ogg`}`,
        fr: fr.charAt(0).toUpperCase() + fr.slice(1),
        en: en.charAt(0).toUpperCase() + en.slice(1),
      });
    }
    familles.push({ famille: fam.id, nom: fam.nom, genre: fam.genre, remplis: [...presents.keys()], vides });
  }
  return {
    format: 'pmb-sons-manquants',
    version: 1,
    note:
      'Emplacements sans aucun fichier fabriqué. dureeVisee en secondes ; niveauViseDb : niveau efficace visé à la fabrication (sons:build le règle) ; ' +
      'variantes : nombre de prises différentes que l’emplacement peut garder ; joue : l’app le joue déjà dès qu’il existe. ' +
      'Une prise générée se déclare dans le dossier privé avec la licence « genere-commanditaire » (tools/sons/LISEZ-MOI.md).',
    familles,
  };
}

function main() {
  const args = process.argv.slice(2);
  const liste = listeManques();
  const sortie = args.includes('--sortie') ? args[args.indexOf('--sortie') + 1] : null;
  const texte = `${JSON.stringify(liste, null, 2)}\n`;
  if (sortie) writeFileSync(sortie, texte);
  if (args.includes('--json')) {
    process.stdout.write(texte);
    return;
  }
  for (const fam of liste.familles) {
    console.log(`\n${fam.nom} (${fam.famille}) : ${fam.vides.length} emplacement(s) vide(s)`);
    for (const vide of fam.vides) {
      console.log(`  ${vide.joue ? '*' : ' '} ${vide.emplacement} · ${vide.genre} · ${vide.dureeVisee} s · ${vide.niveauViseDb} dB · ${vide.variantes} variante(s)`);
      console.log(`      fr : ${vide.fr}`);
      console.log(`      en : ${vide.en}`);
    }
  }
  console.log('\n* : joué par l’app dès qu’il existe.');
  if (sortie) console.log(`Liste écrite dans ${sortie}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
