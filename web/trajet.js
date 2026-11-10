"use strict";
/* Onglet « Trajet » : bus C21/C22/C24/114 (Aquavert) <-> métro D (Gorge de Loup) <-> funiculaire F2 (Vieux Lyon) <-> Fourvière.
   Horaires théoriques TCL du jour (tcl.py), correspondances enchaînées ici. Pas de temps réel. */

(() => {
const TRAJET_KEY = "ecam-trajet";
const TRAJET_DEF = { home: 5, school: 5, c1: 4, c2: 3, marge: 5, alerte: true };
function trajetCfg() {
  try { return { ...TRAJET_DEF, ...JSON.parse(store.get(TRAJET_KEY) || "{}") }; } catch { return { ...TRAJET_DEF }; }
}
const tHM = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const minOf = (d) => d.getHours() * 60 + d.getMinutes();
const firstAfter = (legs, t) => legs.find((l) => l[0] >= t);

/* Trajets complets d'un jour (minutes depuis minuit) */
function chainsAller(j, c) {
  const out = [];
  for (const b of j.a_bus) {
    const m = firstAfter(j.a_metro, b[1] + c.c1); if (!m) continue;
    const f = firstAfter(j.a_funi, m[1] + c.c2); if (!f) continue;
    out.push({ leave: b[0] - c.home, bus: b, metro: m, funi: f, arrive: f[1] + c.school });
  }
  // pour une même arrivée, on garde le départ le plus tardif
  return out.filter((x, i) => !out.some((y, k) => k !== i && y.arrive <= x.arrive && y.leave > x.leave));
}
function chainsRetour(j, c) {
  const out = [];
  for (const f of j.r_funi) {
    const m = firstAfter(j.r_metro, f[1] + c.c2); if (!m) continue;
    const b = firstAfter(j.r_bus, m[1] + c.c1); if (!b) continue;
    out.push({ leave: f[0] - c.school, funi: f, metro: m, bus: b, arrive: b[1] + c.home });
  }
  return out.filter((x, i) => !out.some((y, k) => k !== i && y.arrive <= x.arrive && y.leave > x.leave));
}

function coursDuJour(iso) {
  return events().filter((e) => !e.sansHeure && isoDay(e.d0) === iso);
}

let trajetDir = null, trajetDay = 0;

window.renderTrajet = function () {
  const box = $("#trajet");
  if (!box || !DATA) return;
  const T = DATA.tcl;
  if (!T?.jours) {
    box.innerHTML = `<p class="empty-state">Les horaires TCL arrivent à la prochaine synchro.</p>`;
    return;
  }
  const c = trajetCfg();
  const day = new Date(NOW); day.setDate(day.getDate() + trajetDay); day.setHours(0, 0, 0, 0);
  const iso = isoDay(day);
  const j = T.jours[iso];
  const isToday = trajetDay === 0;
  const now = isToday ? minOf(NOW) : 0;
  const cours = coursDuJour(iso);
  const first = cours[0], last = cours[cours.length - 1];
  if (!trajetDir) trajetDir = isToday && (minOf(NOW) >= 12 * 60 || (first && NOW >= first.d0)) ? "retour" : "aller";
  const aller = trajetDir === "aller";

  const head = `<div class="seg trajet-dir">
      <button type="button" data-tdir="aller" aria-pressed="${aller}">🏫 Aller à l'école</button>
      <button type="button" data-tdir="retour" aria-pressed="${!aller}">🏠 Retour</button></div>
    <div class="seg trajet-day">
      ${[0, 1, 2].map((d) => { const x = new Date(NOW); x.setDate(x.getDate() + d);
        return `<button type="button" data-tday="${d}" aria-pressed="${trajetDay === d}">${d === 0 ? "Aujourd'hui" : d === 1 ? "Demain" : esc(fmtDayLong(x).split(" ")[0])}</button>`; }).join("")}
    </div>`;
  if (!j) {
    box.innerHTML = head + `<p class="empty-state">Pas d'horaires pour ce jour-là (mis à jour chaque matin).</p>`;
    return wireTrajet();
  }

  const all = aller ? chainsAller(j, c) : chainsRetour(j, c);
  const route = (x) => aller
    ? `<span class="tl tl-bus">${esc(x.bus[2])}</span> ${tHM(x.bus[0])} → <span class="tl tl-d">D</span> ${tHM(x.metro[0])} → <span class="tl tl-f">F2</span> ${tHM(x.funi[0])}`
    : `<span class="tl tl-f">F2</span> ${tHM(x.funi[0])} → <span class="tl tl-d">D</span> ${tHM(x.metro[0])} → <span class="tl tl-bus">${esc(x.bus[2])}</span> ${tHM(x.bus[0])}`;
  const row = (x, cls = "") => `<li class="trow ${cls}">
      <div class="tleave"><b>${tHM(x.leave)}</b><span>${x.leave - now >= 0 && isToday ? `dans ${fmtWait(x.leave - now)}` : "départ"}</span></div>
      <div class="troute">${route(x)}</div>
      <div class="tarr">${aller ? "à l'école" : "chez toi"} <b>${tHM(x.arrive)}</b></div></li>`;

  // trajet conseillé : arriver avant le 1er cours / partir après le dernier
  let conseil = "";
  if (aller && first) {
    const limite = minOf(first.d0) - c.marge;
    const best = [...all].reverse().find((x) => x.arrive <= limite);
    if (best && (!isToday || best.leave >= now - 1)) {
      conseil = `<div class="card tconseil"><div class="muted small">Pour ton cours de ${esc(fmtTime(first.d0))} · ${esc(first.matiere)}</div>
        <div class="tbig">Pars à <b>${tHM(best.leave)}</b> au plus tard</div>${`<ul class="list tlist">${row(best, "best")}</ul>`}</div>`;
    } else if (isToday && NOW < first.d0) {
      const next = all.find((x) => x.leave >= now);
      conseil = `<div class="card tconseil warn">⚠️ Plus aucun trajet ne t'amène à l'heure pour ton cours de ${esc(fmtTime(first.d0))}.
        ${next ? `<div class="tbig">Le plus rapide : pars à <b>${tHM(next.leave)}</b>, école à <b>${tHM(next.arrive)}</b></div>` : ""}</div>`;
    }
  } else if (!aller && last) {
    const fin = minOf(last.d1);
    const next = all.find((x) => x.leave >= fin);
    if (next) conseil = `<div class="card tconseil"><div class="muted small">Après ton dernier cours (fin ${esc(fmtTime(last.d1))})</div>
      <div class="tbig">Prochain départ : <b>${tHM(next.leave)}</b></div><ul class="list tlist">${row(next, "best")}</ul></div>`;
  }

  const upcoming = all.filter((x) => x.leave >= now - (isToday ? 0 : 1e9)).slice(0, 6);
  const lastChain = all[all.length - 1];
  const lastLeg = (legs, nom) => legs.length ? `<li><span>${nom}</span><b>${tHM(legs[legs.length - 1][0])}</b></li>` : "";
  const derniers = aller
    ? lastLeg(j.a_bus, `Dernier bus à ${esc(T.noms.maison)}`) + lastLeg(j.a_metro, "Dernier métro D à Gorge de Loup") + lastLeg(j.a_funi, "Dernier F2 à Vieux Lyon")
    : lastLeg(j.r_funi, "Dernier F2 à Fourvière") + lastLeg(j.r_metro, "Dernier métro D à Vieux Lyon") + lastLeg(j.r_bus, "Dernier bus à Gorge de Loup");

  box.innerHTML = head + conseil + `
    <h3 class="memo-h">${isToday ? "Prochains départs" : "Départs"} depuis ${aller ? esc(T.noms.maison) : "Fourvière"}</h3>
    ${upcoming.length ? `<ul class="list tlist">${upcoming.map((x) => row(x)).join("")}</ul>` : `<p class="empty-state">Plus de trajet complet aujourd'hui.</p>`}
    <div class="card tlast">
      <h3 class="memo-h">🌙 Derniers départs</h3>
      ${lastChain ? `<p class="tlast-full">Dernier trajet complet : départ <b>${tHM(lastChain.leave)}</b>, arrivée <b>${tHM(lastChain.arrive)}</b></p>` : ""}
      <ul class="tlast-list">${derniers}</ul>
    </div>
    <details class="card tcfg"><summary>Réglages du trajet</summary>
      <div class="tcfg-grid">
        ${num("home", "Marche maison ↔ Aquavert", c.home)}
        ${num("school", "Marche Fourvière ↔ école", c.school)}
        ${num("c1", "Correspondance bus ↔ métro", c.c1)}
        ${num("c2", "Correspondance métro ↔ funi", c.c2)}
        ${num("marge", "Arriver en avance de", c.marge)}
      </div>
      <label class="check"><input type="checkbox" id="tcfg-alerte" ${c.alerte ? "checked" : ""}> Notification « pars dans 5 min » les jours de cours (appli iPhone)</label>
    </details>
    <p class="muted small">Horaires théoriques TCL (pas le temps réel), mis à jour chaque matin.</p>`;
  wireTrajet();
};

function num(k, label, v) {
  return `<label class="tcfg-item"><span>${label}</span><span><input type="number" min="0" max="60" inputmode="numeric" data-tcfg="${k}" value="${v}"> min</span></label>`;
}
function fmtWait(m) { return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`; }

function wireTrajet() {
  const box = $("#trajet");
  box.querySelectorAll("[data-tdir]").forEach((b) => { b.onclick = () => { trajetDir = b.dataset.tdir; window.renderTrajet(); }; });
  box.querySelectorAll("[data-tday]").forEach((b) => { b.onclick = () => { trajetDay = +b.dataset.tday; window.renderTrajet(); }; });
  const save = (k, v) => { const c = trajetCfg(); c[k] = v; store.set(TRAJET_KEY, JSON.stringify(c)); window.planRappels?.(); };
  box.querySelectorAll("[data-tcfg]").forEach((i) => {
    i.onchange = () => { save(i.dataset.tcfg, Math.max(0, Math.min(60, +i.value || 0))); const open = box.querySelector(".tcfg")?.open; window.renderTrajet(); if (open) box.querySelector(".tcfg").open = true; };
  });
  const a = $("#tcfg-alerte");
  if (a) a.onchange = () => save("alerte", a.checked);
}

/* Pour les rappels iPhone : heure de départ conseillée pour chaque jour de cours à venir */
window.trajetAlertes = function () {
  const c = trajetCfg(), T = DATA?.tcl;
  if (!c.alerte || !T?.jours) return [];
  const out = [];
  for (const [iso, j] of Object.entries(T.jours)) {
    const first = coursDuJour(iso)[0];
    if (!first) continue;
    const best = [...chainsAller(j, c)].reverse().find((x) => x.arrive <= minOf(first.d0) - c.marge);
    if (!best) continue;
    const d = new Date(`${iso}T00:00:00`);
    d.setMinutes(best.leave - 5);
    out.push({ when: d, title: `🚌 Pars dans 5 min`, body: `${best.bus[2]} à ${tHM(best.bus[0])} (${T.noms.maison}) → école à ${tHM(best.arrive)}, cours à ${fmtTime(first.d0)}.` });
  }
  return out;
};

setInterval(() => { if (DATA && document.visibilityState === "visible" && document.body.dataset.pane === "trajet") window.renderTrajet(); }, 30e3);
})();
