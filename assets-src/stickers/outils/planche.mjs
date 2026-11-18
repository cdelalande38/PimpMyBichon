// Usage: node planche.mjs <sortie.png> <colonnes> <taille-cellule> <fond: clair|sombre> <dossier-svg> id1 id2 ...
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [out, colsS, cellS, fond, dir, ...ids] = process.argv.slice(2);
const cols = Number(colsS), cell = Number(cellS);
const clair = fond === 'clair';
const cells = ids.map((id) => {
  const f = id.includes('/') ? id : `${dir}/${id}.svg`;
  const svg = readFileSync(f, 'utf8');
  const name = id.split('/').pop().replace('.svg','');
  return `<div class="c"><div class="s">${svg}</div><div class="n">${name}</div></div>`;
}).join('');
const html = `<!doctype html><meta charset=utf-8><style>
body{margin:0;background:${clair ? '#e8e8ea' : '#14141c'};font:11px sans-serif;color:${clair?'#222':'#ccc'}}
.g{display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:6px;padding:6px}
.c{width:${cell}px}
.s{width:${cell}px;height:${cell}px;display:flex;align-items:center;justify-content:center;background:${clair?'#fff':'#1c1c28'};color:${clair?'#1a1a22':'#ff7a1a'};}
.s svg{width:100%;height:100%}
.n{text-align:center;padding:2px;overflow:hidden;white-space:nowrap}
</style><div class=g>${cells}</div>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: cols * (cell + 6) + 12, height: 400 } });
await p.setContent(html);
await p.screenshot({ path: out, fullPage: true });
await b.close();
