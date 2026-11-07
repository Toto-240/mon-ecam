"use strict";
/* Mode « en cours » (à l'essai) : pendant un cours, en haut du Planning, tout en un geste :
   enregistrer, photographier le tableau, prendre une note — rangés dans le bon cours.
   Pour l'enlever : retirer ce fichier de index.html (et la section #encours). */

function coursActif() {
  const evs = events().filter((e) => !e.sansHeure && !e.perso && ["CM", "TD", "TP", "DS"].includes(e.type));
  const cur = evs.find((e) => e.d0 <= NOW && NOW < e.d1);
  if (cur) return { e: cur, etat: "cur" };
  const soon = evs.find((e) => e.d0 > NOW && e.d0 - NOW <= 10 * 60e3);
  if (soon) return { e: soon, etat: "soon" };
  const ended = evs.filter((e) => e.d1 <= NOW && NOW - e.d1 <= 15 * 60e3).pop();
  return ended ? { e: ended, etat: "ended" } : null;
}

window.renderEnCours = function () {
  const box = $("#encours");
  if (!box) return;
  const a = coursActif();
  box.hidden = !a;
  $("#door").hidden = !!a && a.etat === "cur";   // la carte « en cours » remplace celle de la porte
  if (!a) return;
  const { e, etat } = a;
  const total = e.d1 - e.d0, left = Math.max(0, Math.round((e.d1 - NOW) / 60e3));
  const pct = etat === "cur" ? Math.min(100, Math.max(0, Math.round(100 * (NOW - e.d0) / total))) : etat === "ended" ? 100 : 0;
  const head = etat === "cur" ? `En cours · plus que ${left >= 60 ? `${Math.floor(left / 60)} h ${String(left % 60).padStart(2, "0")}` : `${left} min`}`
    : etat === "soon" ? `Commence dans ${Math.max(1, Math.round((e.d0 - NOW) / 60e3))} min` : "Vient de finir";
  const fiche = window.ficheFor?.(e);
  const recOn = window.recordingActive?.();
  box.innerHTML = `<div class="encours ${etat}">
    <div class="encours-head"><span class="pulse" aria-hidden="true"></span>${esc(head)}</div>
    <div class="encours-what">${esc(e.matiere)}</div>
    <div class="encours-meta">${esc([e.type, `${fmtTime(e.d0)}–${fmtTime(e.d1)}`, e.salle ? `salle ${e.salle}` : "", e.prof].filter(Boolean).join(" · "))}</div>
    <div class="encours-bar"><span style="width:${pct}%"></span></div>
    <div class="encours-actions">
      <button type="button" class="ea rec${recOn ? " on" : ""}" data-ea="rec"><span class="ico" aria-hidden="true">🎙️</span><span>${recOn ? "Enregistrement en cours" : "Enregistrer"}</span></button>
      <button type="button" class="ea" data-ea="photo"><span class="ico" aria-hidden="true">📷</span><span>Photo du tableau</span></button>
      <button type="button" class="ea" data-ea="note"><span class="ico" aria-hidden="true">📝</span><span>Note rapide</span></button>
    </div>
    ${fiche ? `<button type="button" class="encours-fiche" data-ea="fiche">Fiche de ce cours prête ✓ · Voir</button>` : ""}
  </div>`;
  box.querySelectorAll("[data-ea]").forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.ea;
      if (k === "rec") {
        showPane("enregistrer");
        if (recOn) return;
        $("#f-date").value = "";
        window.startRecording?.(e.matiere);
      } else if (k === "photo" || k === "note") {
        window.openAddSheet?.(e);
        if (k === "photo") $("#add-photo")?.click();
        else setTimeout(() => $("#add-text")?.focus(), 80);
      } else if (k === "fiche" && fiche) {
        openFiche(fiche.id);
      }
    };
  });
};

// la carte suit l'heure (minutes restantes, passage au cours suivant)
setInterval(() => { if (DATA && document.visibilityState === "visible") window.renderEnCours(); }, 60e3);
