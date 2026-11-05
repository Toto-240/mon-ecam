"use strict";
/* Cartes mentales : dessin en SVG (arbre de gauche à droite, une couleur par branche),
   zoom, et vue « plan » en liste. Utilise DATA, esc, fmtDate, openReader, deleteZone, wireDelete. */

const CARTE_COLORS = ["#D8603F", "#3A9A4C", "#4157BE", "#7446B8", "#C27410", "#14857D", "#C9426F", "#4F4FC4", "#6E8A1E", "#2479B8"];

function wrapText(t, max) {
  const words = String(t).split(/\s+/), lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max && cur) { lines.push(cur); cur = w; }
    else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

/* Disposition : x selon la profondeur, y selon la hauteur des sous-arbres */
function layoutCarte(root) {
  const LH = 16, PADX = 10, PADY = 7, GAPY = 10, GAPX = 46;
  const nodes = [];
  (function prep(n, depth, color) {
    n.depth = depth;
    n.color = color;
    n.lines = wrapText(n.titre, depth === 0 ? 18 : depth === 1 ? 22 : 26);
    const longest = Math.max(...n.lines.map((l) => l.length));
    n.w = Math.min(depth === 0 ? 190 : 230, Math.max(70, longest * (depth <= 1 ? 7.6 : 6.9) + PADX * 2));
    n.h = n.lines.length * LH + PADY * 2;
    nodes.push(n);
    (n.enfants || []).forEach((k, i) => prep(k, depth + 1, depth === 0 ? CARTE_COLORS[i % CARTE_COLORS.length] : color));
  })(root, 0, "#2D2A80");
  const colW = [];
  nodes.forEach((n) => { colW[n.depth] = Math.max(colW[n.depth] || 0, n.w); });
  const colX = colW.map((_, d) => colW.slice(0, d).reduce((a, b) => a + b + GAPX, 0));
  (function height(n) {
    const kids = n.enfants || [];
    n.sh = kids.length ? Math.max(n.h + GAPY, kids.reduce((a, k) => a + height(k), 0)) : n.h + GAPY;
    return n.sh;
  })(root);
  (function place(n, top) {
    n.x = colX[n.depth];
    const kids = n.enfants || [];
    if (!kids.length) { n.y = top + (n.sh - n.h) / 2; return; }
    const total = kids.reduce((a, k) => a + k.sh, 0);
    let t = top + (n.sh - total) / 2;
    kids.forEach((k) => { place(k, t); t += k.sh; });
    const first = kids[0], last = kids[kids.length - 1];
    n.y = (first.y + first.h / 2 + last.y + last.h / 2) / 2 - n.h / 2;
  })(root, 0);
  const width = colX[colX.length - 1] + colW[colW.length - 1] + 8, height = root.sh;
  return { nodes, width, height, LH, PADX, PADY };
}

function carteSvg(root) {
  const L = layoutCarte(root);
  const links = [], boxes = [];
  for (const n of L.nodes) {
    for (const k of n.enfants || []) {
      const x1 = n.x + n.w, y1 = n.y + n.h / 2, x2 = k.x, y2 = k.y + k.h / 2, mx = (x1 + x2) / 2;
      links.push(`<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" stroke="${k.color}" stroke-width="${n.depth === 0 ? 3 : 2}" fill="none" opacity=".8"/>`);
    }
    const root0 = n.depth === 0, br = n.depth === 1;
    boxes.push(`<g transform="translate(${n.x},${n.y})">
      <rect width="${n.w}" height="${n.h}" rx="${root0 ? 14 : 10}"
        fill="${root0 ? n.color : br ? n.color : "var(--surface)"}" stroke="${n.color}" stroke-width="${root0 || br ? 0 : 1.5}"/>
      ${n.lines.map((l, i) => `<text x="${L.PADX}" y="${L.PADY + 12 + i * L.LH}" font-size="${root0 ? 14 : br ? 13 : 12}"
        font-weight="${root0 || br ? 700 : 500}" fill="${root0 || br ? "#fff" : "var(--ink)"}">${esc(l)}</text>`).join("")}
    </g>`);
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 ${L.width + 8} ${L.height + 8}"
      width="${L.width + 8}" height="${L.height + 8}" font-family="inherit" role="img" aria-label="Carte mentale">${links.join("")}${boxes.join("")}</svg>`,
    width: L.width + 8 };
}

function cartePlan(n, depth = 0) {
  const kids = n.enfants || [];
  if (depth === 0) return `<h2>${esc(n.titre)}</h2>${kids.map((k) => cartePlan(k, 1)).join("")}`;
  if (depth === 1) return `<h3>${esc(n.titre)}</h3>${kids.length ? `<ul>${kids.map((k) => cartePlan(k, 2)).join("")}</ul>` : ""}`;
  return `<li>${esc(n.titre)}${kids.length ? `<ul>${kids.map((k) => cartePlan(k, depth + 1)).join("")}</ul>` : ""}</li>`;
}

window.openCarte = function (id) {
  const c = (DATA.cartes || []).find((x) => x.id === id);
  if (!c?.carte) return;
  const { svg, width } = carteSvg(JSON.parse(JSON.stringify(c.carte)));
  openReader(`Carte mentale : ${c.matiere}`, `
    <p class="meta">${esc(c.matiere)}, à partir de ${c.sources} fiche${c.sources > 1 ? "s" : ""}${c.cree ? `, ${esc(fmtDate(c.cree.slice(0, 10)))}` : ""}</p>
    <div class="row tight carte-tools">
      <div class="seg" role="tablist">
        <button type="button" class="seg-b" aria-pressed="true" data-vue="carte">Carte</button>
        <button type="button" class="seg-b" aria-pressed="false" data-vue="plan">Plan</button>
      </div>
      <span class="zoom">
        <button type="button" class="btn small" data-z="-1" aria-label="Dézoomer">−</button>
        <button type="button" class="btn small" data-z="0">Ajuster</button>
        <button type="button" class="btn small" data-z="1" aria-label="Zoomer">+</button>
      </span>
    </div>
    <div class="carte-wrap" id="carte-wrap">${svg}</div>
    <div class="carte-plan" id="carte-plan" hidden>${cartePlan(c.carte)}</div>
    ${c.noms?.length ? `<details class="carte-src"><summary>Fiches utilisées (${c.noms.length})</summary><ul>${c.noms.map((n) => `<li>${esc(n || "")}</li>`).join("")}</ul></details>` : ""}
    ${c._fichier ? deleteZone("Supprimer cette carte mentale", "") : ""}`);
  if (c._fichier) wireDelete(`cartes/${c._fichier}`, "Supprimer cette carte mentale");

  const wrap = $("#carte-wrap"), el = wrap.querySelector("svg");
  let z = 1;
  const fit = () => Math.max(0.35, Math.min(1, (wrap.clientWidth - 8) / width));
  const apply = () => { el.style.width = `${width * z}px`; el.style.height = "auto"; };
  z = fit(); apply();
  document.querySelectorAll(".carte-tools [data-z]").forEach((b) => {
    b.onclick = () => {
      const d = +b.dataset.z;
      z = d === 0 ? fit() : Math.max(0.3, Math.min(2.5, z * (d > 0 ? 1.25 : 0.8)));
      apply();
    };
  });
  document.querySelectorAll(".carte-tools [data-vue]").forEach((b) => {
    b.onclick = () => {
      const plan = b.dataset.vue === "plan";
      document.querySelectorAll(".carte-tools [data-vue]").forEach((x) => x.setAttribute("aria-pressed", x === b));
      $("#carte-wrap").hidden = plan;
      $("#carte-plan").hidden = !plan;
      document.querySelector(".carte-tools .zoom").hidden = plan;
    };
  });
};
