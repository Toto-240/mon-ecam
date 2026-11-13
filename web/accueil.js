"use strict";
/* Accueil « Aujourd'hui » (design A) : prochain cours, trajet, journée, à rendre, prochain DS. */
(() => {
  const ICO = {
    bus: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14M8 17v3M16 17v3"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
  };
  const svg = (p, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  const wait = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`);

  function hero(evs) {
    const cur = evs.find((e) => e.d0 <= NOW && NOW < e.d1);
    if (cur && !$("#encours").hidden) return "";   // la carte « en cours » (enregistrer, photo, note) est déjà affichée
    const e = cur || evs.find((x) => x.d0 > NOW);
    if (!e) return `<div class="a-hero free"><div class="a-kick">Rien de prévu</div><div class="a-title">Pas de cours à venir</div>
      <div class="a-meta">Recharge pour récupérer les prochaines semaines.</div></div>`;
    const kick = cur ? `En cours · fin à ${fmtTime(e.d1)}`
      : sameDay(e.d0, NOW) ? `Prochain cours · ${inMinutes(e.d0) || `à ${fmtTime(e.d0)}`}`
      : `Prochain cours · ${relDay(e.d0)} à ${fmtTime(e.d0)}`;
    const meta = [`${fmtTime(e.d0)} – ${fmtTime(e.d1)}`, e.salle ? `Salle ${e.salle}` : "", e.prof].filter(Boolean).join(" · ");
    const hasFiches = (DATA.fiches || []).some((f) => sameMatiere(f.matiere, e.matiere));
    return `<div class="a-hero">
      <div class="a-row"><span class="a-kick">${esc(kick)}</span>${e.type ? `<span class="a-tag${e.type === "DS" ? " ds" : ""}">${esc(e.type)}</span>` : ""}</div>
      <div class="a-title">${esc(e.matiere)}</div>
      <div class="a-meta">${esc(meta)}</div>
      <div class="a-actions">
        ${hasFiches ? `<button type="button" class="a-btn light" data-a-fiches="${esc(e.matiere)}">${e.type === "DS" ? "Réviser" : "Fiches du cours"}</button>` : ""}
        <button type="button" class="a-btn dark" data-a-week>Semaine</button>
      </div></div>`;
  }

  function trajet() {
    const t = window.trajetResume?.();
    if (!t) return "";
    return `<button type="button" class="a-card a-trajet" data-a-goto="trajet">
      <span class="a-ico orange">${svg(ICO.bus)}</span>
      <span class="a-grow"><b>Pars à ${esc(t.leave)}</b><small>${esc(t.ligne)} → métro D → F2 · ${t.sens === "aller" ? "école" : "chez toi"} à ${esc(t.arrive)}</small></span>
      <span class="a-when${t.retard ? " late" : ""}">${t.dans <= 0 ? "maintenant" : `dans ${esc(wait(t.dans))}`}</span></button>`;
  }

  function ceSoir() {
    const r = window.relireCeSoir?.();
    if (!r) return "";
    return `<button type="button" class="a-card a-trajet" data-a-goto="relire">
      <span class="a-ico nuit">${svg('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>')}</span>
      <span class="a-grow"><b>Relis ta journée</b><small>${r.reste} fiche${r.reste > 1 ? "s" : ""} de cours à relire ce soir</small></span>
      ${svg(ICO.chev, "a-chev")}</button>`;
  }

  function journee(evs) {
    const today = evs.filter((e) => sameDay(e.d0, NOW));
    const list = today.length ? today : evs.filter((e) => e.d0 > NOW && sameDay(e.d0, (evs.find((x) => x.d0 > NOW) || {}).d0 || NOW));
    if (!list.length) return "";
    const title = today.length ? "Ta journée" : `${relDay(list[0].d0).replace(/^./, (c) => c.toUpperCase())}`;
    return `<h2 class="a-h">${esc(title)}</h2>
      <ul class="a-list">${list.map((e) => `<li class="${e.d1 <= NOW ? "past" : ""}">
        <span class="a-time">${esc(fmtTime(e.d0))}</span>
        <span class="a-grow"><b>${esc(e.matiere)}</b><small>${esc([e.type, e.salle, e.prof].filter(Boolean).join(" · "))}</small></span>
        ${e.type === "DS" ? '<span class="a-tag ds">DS</span>' : ""}</li>`).join("")}</ul>`;
  }

  function tuiles() {
    const rendre = window.aRendre || [];
    const r0 = rendre[0];
    const exams = (typeof upcomingExams === "function" ? upcomingExams() : []).filter((e) => !window.dsFini?.(dsKey(e)));
    const d0 = exams[0];
    const jours = d0 ? Math.ceil((startOfDay(d0.d0) - startOfDay(NOW)) / 864e5) : 0;
    return `<div class="a-tiles">
      <button type="button" class="a-card a-tile" data-a-goto="rendre">
        <small>À rendre</small><b class="big">${rendre.length}</b>
        <small>${r0 ? esc(`${r0.titre}`).slice(0, 60) : "Rien pour l'instant"}</small></button>
      <button type="button" class="a-card a-tile" data-a-goto="ds">
        <small>Prochain DS</small><b class="big">${d0 ? (jours <= 0 ? "Auj." : jours === 1 ? "Demain" : `J-${jours}`) : "—"}</b>
        <small>${d0 ? esc(d0.matiere) : "Aucun DS prévu"}</small></button>
    </div>`;
  }

  window.renderAccueil = function () {
    const box = $("#accueil");
    if (!box || !DATA) return;
    const evs = events().filter((e) => !e.sansHeure).sort((a, b) => a.d0 - b.d0);
    box.innerHTML = hero(evs) + ceSoir() + trajet();
    $("#accueil-bas").innerHTML = journee(evs) + tuiles();
    const root = $("#pane-accueil");
    root.querySelectorAll("[data-a-goto]").forEach((b) => { b.onclick = () => showPane(b.dataset.aGoto); });
    root.querySelectorAll("[data-a-fiches]").forEach((b) => { b.onclick = () => window.openMatiere?.(b.dataset.aFiches); });
    root.querySelectorAll("[data-a-week]").forEach((b) => { b.onclick = () => showPane("planning"); });
  };

  function sameDay(a, b) { return a && b && dayKey(a) === dayKey(b); }

  setInterval(() => { if (DATA && document.visibilityState === "visible" && document.body.dataset.pane === "accueil") window.renderAccueil(); }, 60e3);
})();
