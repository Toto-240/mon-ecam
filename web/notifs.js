"use strict";
/* Cloche : changements d'emploi du temps détectés à chaque synchro (DATA.changements). */
const SEEN_KEY = "ecam-notifs-vu";
const ICO = { annule: "✕", deplace: "↷", salle: "⌂", prof: "P", ajoute: "+" };
const TITLE = { annule: "Cours annulé", deplace: "Cours déplacé", salle: "Changement de salle",
  prof: "Changement d'enseignant", ajoute: "Nouveau cours" };

function whenText(c) {
  const av = c.avant || {}, ap = c.apres || {};
  const at = (iso) => (iso ? `${fmtDayLong(new Date(iso))} à ${fmtTime(new Date(iso))}` : "?");
  switch (c.type) {
    case "annule": return `Prévu ${at(av.debut)}${av.salle ? `, salle ${av.salle}` : ""}`;
    case "ajoute": return `${at(ap.debut)}${ap.salle ? `, salle ${ap.salle}` : ""}`;
    case "deplace": return `${at(av.debut)} → ${at(ap.debut)}${ap.salle ? `, salle ${ap.salle}` : ""}`;
    case "salle": return `${at(ap.debut)} : salle ${av.salle || "?"} → ${ap.salle || "?"}`;
    case "prof": return `${at(ap.debut)} : ${ap.prof || "?"} (au lieu de ${av.prof || "?"})`;
    default: return "";
  }
}

window.renderNotifs = function () {
  const list = DATA.changements || [];
  const seen = store.get(SEEN_KEY) || "";
  const unread = list.filter((c) => c.quand > seen).length;
  $("#bell-badge").hidden = !unread;
  $("#bell-badge").textContent = unread > 9 ? "9+" : unread;
  $("#bell").setAttribute("aria-label", unread ? `Changements d'emploi du temps, ${unread} nouveau(x)` : "Changements d'emploi du temps");
  $("#notif-list").innerHTML = list.length ? list.map((c) => `<li class="${c.quand > seen ? "new" : ""}">
      <span class="ico ico-${esc(c.type)}" aria-hidden="true">${ICO[c.type] || "•"}</span>
      <div class="t">${esc(TITLE[c.type] || "Changement")} : ${esc(c.matiere || c.titre || "")}</div>
      <div class="m">${esc(whenText(c))}</div>
      <div class="when">Repéré ${esc(relDay(new Date(c.quand)))} à ${esc(fmtTime(new Date(c.quand)))}</div>
    </li>`).join("")
    : `<li class="m">Aucun changement pour l'instant. Dès qu'un cours est annulé, ajouté, déplacé ou change de salle, il apparaîtra ici.</li>`;
};

function openNotifs() {
  window.renderNotifs();
  $("#notif-sheet").hidden = false;
  document.body.style.overflow = "hidden";
  const newest = (DATA.changements || [])[0]?.quand;
  if (newest) store.set(SEEN_KEY, newest); // marqués comme vus (le surlignage reste jusqu'à la fermeture)
}
function closeNotifs() {
  $("#notif-sheet").hidden = true;
  document.body.style.overflow = "";
  window.renderNotifs();
}
$("#bell").onclick = openNotifs;
$("#notif-close").onclick = closeNotifs;
$("#notif-sheet").addEventListener("click", (ev) => { if (ev.target.id === "notif-sheet") closeNotifs(); });
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("#notif-sheet").hidden) closeNotifs(); });
