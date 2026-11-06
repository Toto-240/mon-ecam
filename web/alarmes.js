"use strict";
/* Rappels à une heure précise (séparés du pense-bête). Enregistrés avec perso.js,
   la notification est programmée sur l'iPhone par rappels.js. */

const pad2 = (n) => String(n).padStart(2, "0");
const dayStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const timeStr = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const rappelDate = (r) => new Date(`${r.quand}:00`);

function setQuick(q) {
  const now = new Date();
  let d;
  if (q === "1h") d = new Date(now.getTime() + 3600e3);
  if (q === "soir") { d = new Date(now); if (now.getHours() >= 19) d.setDate(d.getDate() + 1); d.setHours(19, 0, 0, 0); }
  if (q === "matin") { d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); }
  $("#alarm-date").value = dayStr(d);
  $("#alarm-time").value = timeStr(d);
  document.querySelectorAll("#alarm-form [data-quick]").forEach((c) => c.setAttribute("aria-pressed", c.dataset.quick === q));
}
document.querySelectorAll("#alarm-form [data-quick]").forEach((c) => { c.onclick = () => setQuick(c.dataset.quick); });
["#alarm-date", "#alarm-time"].forEach((id) => $(id).addEventListener("input", () =>
  document.querySelectorAll("#alarm-form [data-quick]").forEach((c) => c.setAttribute("aria-pressed", "false"))));

function whenText(d) {
  const today = dayStr(new Date()), tomorrow = dayStr(new Date(Date.now() + 864e5));
  const day = dayStr(d) === today ? "Aujourd'hui" : dayStr(d) === tomorrow ? "Demain" : fmtDayLong(d);
  return `${day} à ${d.getHours()}h${pad2(d.getMinutes())}`;
}

window.renderAlarmes = function () {
  const all = window.persoRappels?.() || [];
  const now = new Date();
  const next = all.filter((r) => !r.fait && rappelDate(r) > now).sort((a, b) => a.quand.localeCompare(b.quand));
  const past = all.filter((r) => r.fait || rappelDate(r) <= now).sort((a, b) => b.quand.localeCompare(a.quand));
  const today = next.filter((r) => r.quand.slice(0, 10) === dayStr(now)).length;
  $("#alarm-badge").hidden = !today;
  $("#alarm-badge").textContent = today;
  const li = (r, isPast) => `<li class="memo alarm-item${isPast ? " done" : ""}">
      <span class="alarm-ico" aria-hidden="true">⏰</span>
      <div class="memo-body"><div class="t">${esc(r.texte)}</div><div class="m">${esc(whenText(rappelDate(r)))}${isPast ? " · passé" : ""}</div></div>
      <button type="button" class="memo-del" data-alarm-del="${esc(r.id)}" aria-label="Supprimer">×</button></li>`;
  $("#alarm-list").innerHTML = (next.length
    ? `<h3 class="memo-h">À venir</h3><ul class="list memo-list">${next.map((r) => li(r, false)).join("")}</ul>`
    : `<p class="empty-state">Aucun rappel prévu. Écris-en un ci-dessus.</p>`)
    + (past.length ? `<details class="faits"><summary>Passés (${past.length})</summary><ul class="list memo-list">${past.map((r) => li(r, true)).join("")}</ul>
        <div class="row"><button type="button" class="btn small" id="alarm-clear">Effacer les rappels passés</button></div></details>` : "");
  $("#alarm-list").querySelectorAll("[data-alarm-del]").forEach((b) => { b.onclick = () => window.delRappel(b.dataset.alarmDel); });
  $("#alarm-clear")?.addEventListener("click", () => past.forEach((r) => window.delRappel(r.id)));
};

function openAlarmes() {
  window.renderAlarmes();
  if (!$("#alarm-date").value) setQuick("1h");
  $("#alarm-native").hidden = !!window.Capacitor?.isNativePlatform?.();
  $("#alarm-sheet").hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#alarm-text").focus(), 50);
}
function closeAlarmes() {
  $("#alarm-sheet").hidden = true;
  document.body.style.overflow = "";
}
$("#alarm-btn").onclick = openAlarmes;
$("#alarm-close").onclick = closeAlarmes;
$("#alarm-sheet").addEventListener("click", (ev) => { if (ev.target.id === "alarm-sheet") closeAlarmes(); });
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("#alarm-sheet").hidden) closeAlarmes(); });

$("#alarm-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const texte = $("#alarm-text").value.trim(), msg = $("#alarm-msg");
  const day = $("#alarm-date").value, time = $("#alarm-time").value;
  if (!texte) { msg.textContent = "Écris d'abord le rappel."; return; }
  if (!day || !time) { msg.textContent = "Choisis le jour et l'heure."; return; }
  if (new Date(`${day}T${time}:00`) <= new Date()) { msg.textContent = "Cette heure est déjà passée."; return; }
  window.saveRappel({ id: newId(), texte, quand: `${day}T${time}`, fait: null, cree: new Date().toISOString() });
  $("#alarm-text").value = "";
  msg.textContent = `Rappel prévu ${whenText(new Date(`${day}T${time}:00`)).toLowerCase()}.`;
  setQuick("1h");
});
