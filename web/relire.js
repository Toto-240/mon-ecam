"use strict";
/* « Ce soir » : relire les fiches faites à partir des cours enregistrés (ce qu'a dit le prof),
   jour par jour, avec « Tout relire » d'affilée. Les fiches faites seulement à partir de Moodle n'y sont pas. */
(() => {
  const KEY = "ecam-relu";
  const JOURS = 14;
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const lues = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { return new Set(); } };
  const marquer = (ids) => {
    const s = lues();
    ids.forEach((i) => s.add(i));
    try { localStorage.setItem(KEY, JSON.stringify([...s].slice(-500))); } catch {}
  };

  // fiches issues d'un cours (enregistrement, ou notes et photos), des derniers jours
  function fichesCours() {
    const min = new Date(NOW); min.setDate(min.getDate() - JOURS);
    const lim = iso(min);
    return (DATA?.fiches || []).filter((f) => f.source !== "moodle" && f.md && f.date && f.date >= lim)
      .sort((a, b) => (b.date + (b.heure || "")).localeCompare(a.date + (a.heure || "")));
  }
  const parJour = (fs) => {
    const m = new Map();
    for (const f of fs) { if (!m.has(f.date)) m.set(f.date, []); m.get(f.date).push(f); }
    for (const l of m.values()) l.sort((a, b) => (a.heure || "").localeCompare(b.heure || ""));
    return [...m.entries()];
  };
  const titre = (f) => (String(f.md).match(/^#\s+(.+)/m)?.[1] || f.titre || f.matiere || "Fiche").replace(/[*_`]/g, "");
  const bref = (f) => {
    const t = String(f.md).match(/en bref\s*:?\**\s*:?\s*(.+)/i)?.[1]
      || String(f.md).split("\n").find((l) => l.trim() && !/^[#>\-*|]/.test(l.trim())) || "";
    const s = t.replace(/[*_`#]/g, "").trim();
    return s.length > 170 ? s.slice(0, 165).replace(/\s+\S*$/, "") + "…" : s;
  };
  const jourLabel = (d) => {
    const dt = new Date(`${d}T12:00`);
    const r = relDay(dt);
    return r.charAt(0).toUpperCase() + r.slice(1);
  };

  function lireTout(list, label) {
    marquer(list.map((f) => f.id));
    openReader(`Relire · ${label}`, list.map((f, i) => `<section class="relire-bloc">
        <p class="meta">${i + 1}/${list.length} · ${esc(f.matiere || "")}${f.heure ? ` · ${esc(f.heure)}` : ""}${f.duree_min ? ` · ${f.duree_min} min` : ""}</p>
        ${md(f.md)}</section>`).join('<hr class="relire-sep">'));
    window.renderRelire();
  }

  window.renderRelire = function () {
    const box = $("#relire");
    if (!box || !DATA) return;
    const fs = fichesCours(), vu = lues();
    if (!fs.length) {
      box.innerHTML = `<p class="muted">Pas encore de fiche faite à partir d'un cours ces ${JOURS} derniers jours.
        Enregistre un cours (onglet Micro) : sa fiche arrivera ici pour que tu la relises le soir.</p>`;
      return;
    }
    box.innerHTML = parJour(fs).map(([d, list]) => {
      const reste = list.filter((f) => !vu.has(f.id)).length;
      return `<section class="relire-jour">
        <div class="relire-head"><h3>${esc(jourLabel(d))}</h3>
          <button type="button" class="btn small${reste ? " primary" : ""}" data-relire-jour="${esc(d)}">Tout relire (${list.length})</button></div>
        <ul class="list">${list.map((f) => `<li><button type="button" class="item relire-item${vu.has(f.id) ? " lu" : ""}" data-relire="${esc(f.id)}">
          <div class="t">${vu.has(f.id) ? "✓ " : ""}${esc(titre(f))}</div>
          <div class="m">${esc([f.matiere, f.heure, f.duree_min ? `${f.duree_min} min d'enregistrement` : f.source === "notes" ? "d'après tes notes" : ""].filter(Boolean).join(" · "))}</div>
          ${bref(f) ? `<div class="relire-bref">${esc(bref(f))}</div>` : ""}
        </button></li>`).join("")}</ul></section>`;
    }).join("");
    box.querySelectorAll("[data-relire]").forEach((b) => {
      b.onclick = () => { marquer([b.dataset.relire]); openFiche(b.dataset.relire); window.renderRelire(); };
    });
    box.querySelectorAll("[data-relire-jour]").forEach((b) => {
      b.onclick = () => lireTout(parJour(fs).find(([d]) => d === b.dataset.relireJour)[1], jourLabel(b.dataset.relireJour));
    });
  };

  /* Pour l'accueil, le soir : les fiches du jour pas encore relues */
  window.relireCeSoir = function () {
    if (!DATA || NOW.getHours() < 16) return null;
    const auj = iso(NOW), vu = lues();
    const list = fichesCours().filter((f) => f.date === auj);
    const reste = list.filter((f) => !vu.has(f.id));
    return list.length && reste.length ? { total: list.length, reste: reste.length } : null;
  };
})();
