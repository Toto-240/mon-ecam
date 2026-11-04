"use strict";
/* Pense-bête : petites notes rapides (« réviser le chap. 3 pour demain », « refaire l'exo 2 »…).
   Enregistrées avec perso.js (chiffré sur GitHub, mêmes notes sur le PC et le téléphone).
   Utilise NOW, esc, fmtDayLong, startOfDay, addDays (app.js) et newId (revisions.js). */

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
let memoWhen = "dem";

function memoDate() {
  if (memoWhen === "auj") return iso(NOW);
  if (memoWhen === "dem") return iso(addDays(startOfDay(NOW), 1));
  if (memoWhen === "date") return $("#memo-date").value || "";
  return "";
}

function setWhen(w) {
  memoWhen = w;
  document.querySelectorAll(".memo-when .chip").forEach((c) => c.setAttribute("aria-pressed", c.dataset.when === w));
  $("#memo-date").classList.toggle("on", w === "date");
}
document.querySelectorAll(".memo-when .chip").forEach((c) => { c.onclick = () => setWhen(c.dataset.when); });
$("#memo-date").addEventListener("change", () => setWhen($("#memo-date").value ? "date" : "none"));

/* Libellé et groupe d'une note selon sa date */
function memoGroup(m) {
  if (!m.pour) return ["none", "Sans date"];
  const today = iso(NOW), tomorrow = iso(addDays(startOfDay(NOW), 1));
  if (m.pour < today) return ["late", "En retard"];
  if (m.pour === today) return ["auj", "Aujourd'hui"];
  if (m.pour === tomorrow) return ["dem", "Demain"];
  return ["later", "Plus tard"];
}

function memoLi(m) {
  const [g] = memoGroup(m);
  const when = m.pour && g === "later" ? fmtDayLong(new Date(m.pour + "T12:00")) : g === "late" ? `prévu ${fmtDayLong(new Date(m.pour + "T12:00"))}` : "";
  const tag = !m.fait && g === "auj" ? `<span class="memo-tag">Aujourd'hui</span>` : !m.fait && g === "late" ? `<span class="memo-tag late">En retard</span>` : "";
  return `<li class="memo${m.fait ? " done" : ""}${g === "late" && !m.fait ? " late" : ""}${g === "auj" && !m.fait ? " today" : ""}">
    <input type="checkbox" data-memo-check="${esc(m.id)}"${m.fait ? " checked" : ""} aria-label="Fait : ${esc(m.texte)}">
    <div class="memo-body">${tag}<div class="t">${esc(m.texte)}</div>${when ? `<div class="m">${esc(when)}</div>` : ""}</div>
    <button type="button" class="memo-del" data-memo-del="${esc(m.id)}" aria-label="Supprimer">×</button>
  </li>`;
}

function wireMemos(root) {
  root.querySelectorAll("[data-memo-check]").forEach((c) => {
    c.onchange = () => {
      const m = window.persoMemos().find((x) => x.id === c.dataset.memoCheck);
      if (m) window.saveMemo({ ...m, fait: c.checked ? new Date().toISOString() : null });
    };
  });
  root.querySelectorAll("[data-memo-del]").forEach((b) => { b.onclick = () => window.delMemo(b.dataset.memoDel); });
}

window.renderMemos = function () {
  const all = window.persoMemos?.() || [];
  const todo = all.filter((m) => !m.fait), done = all.filter((m) => m.fait);
  const order = { late: 0, auj: 1, dem: 2, later: 3, none: 4 };
  todo.sort((a, b) => order[memoGroup(a)[0]] - order[memoGroup(b)[0]] || (a.pour || "").localeCompare(b.pour || "")
    || (a.cree || "").localeCompare(b.cree || ""));

  // pastille : ce qui est pour aujourd'hui ou en retard
  const urgentList = todo.filter((m) => ["late", "auj"].includes(memoGroup(m)[0]));
  const urgent = urgentList.length;
  $("#memo-badge").hidden = !urgent;
  $("#memo-badge").textContent = urgent;
  $("#memo-btn").classList.toggle("alert", !!urgent);

  // bandeau visible sur tous les onglets tant qu'il reste des notes pour aujourd'hui
  const banner = $("#memo-banner");
  banner.hidden = !urgent;
  if (urgent) {
    const late = urgentList.filter((m) => memoGroup(m)[0] === "late").length;
    banner.innerHTML = `<span class="pin" aria-hidden="true">!</span>
      <span class="txt"><b>Aujourd'hui :</b> ${esc(urgentList.slice(0, 2).map((m) => m.texte.split("\n")[0]).join(" · "))}${urgent > 2 ? ` · +${urgent - 2}` : ""}
      ${late ? `<em>(${late} en retard)</em>` : ""}</span><span class="go" aria-hidden="true">›</span>`;
    banner.setAttribute("aria-label", `${urgent} note${urgent > 1 ? "s" : ""} pour aujourd'hui, ouvrir le pense-bête`);
  }

  // fenêtre complète, par groupes
  let html = "", last = null;
  for (const m of todo) {
    const [g, label] = memoGroup(m);
    if (g !== last) { html += `${last ? "</ul>" : ""}<h3 class="memo-h ${g}">${label}</h3><ul class="list memo-list">`; last = g; }
    html += memoLi(m);
  }
  if (last) html += "</ul>";
  if (!todo.length) html = `<p class="empty-state">Rien à retenir pour l'instant. Écris ta première note ci-dessus.</p>`;
  if (done.length) {
    html += `<details class="faits"><summary>Faits (${done.length})</summary><ul class="list memo-list">
      ${done.sort((a, b) => (b.fait || "").localeCompare(a.fait || "")).map(memoLi).join("")}</ul>
      <div class="row"><button type="button" class="btn small" id="memo-clear">Effacer les notes faites</button></div></details>`;
  }
  const list = $("#memo-list");
  const wasOpen = list.querySelector("details.faits")?.open;
  list.innerHTML = html;
  if (wasOpen) list.querySelector("details.faits").open = true;
  wireMemos(list);
  $("#memo-clear")?.addEventListener("click", () => done.forEach((m) => window.delMemo(m.id)));

  // rappel en haut du planning : en retard, aujourd'hui, demain
  const soon = todo.filter((m) => ["late", "auj", "dem"].includes(memoGroup(m)[0]));
  const box = $("#memo-today");
  box.hidden = !soon.length;
  box.classList.toggle("has-today", !!urgent);
  box.innerHTML = soon.length ? `<div class="memo-today-head"><b>${urgent ? `Aujourd'hui : ${urgent} à faire` : "À ne pas oublier"}</b>
      <button type="button" class="linkish" id="memo-all">Pense-bête (${todo.length})</button></div>
      <ul class="memo-list">${soon.slice(0, 5).map((m) => memoLi(m).replace('class="memo', `class="memo g-${memoGroup(m)[0]}`)).join("")}</ul>
      ${soon.length > 5 ? `<p class="small muted">… et ${soon.length - 5} autre(s)</p>` : ""}` : "";
  wireMemos(box);
  $("#memo-all")?.addEventListener("click", openMemos);
};

function openMemos() {
  window.renderMemos();
  $("#memo-sheet").hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#memo-text").focus(), 50);
}
function closeMemos() {
  $("#memo-sheet").hidden = true;
  document.body.style.overflow = "";
}
$("#memo-btn").onclick = openMemos;
$("#memo-banner").onclick = openMemos;
$("#memo-close").onclick = closeMemos;
$("#memo-sheet").addEventListener("click", (ev) => { if (ev.target.id === "memo-sheet") closeMemos(); });
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("#memo-sheet").hidden) closeMemos(); });

$("#memo-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const texte = $("#memo-text").value.trim();
  if (!texte) return;
  window.saveMemo({ id: newId(), texte, pour: memoDate(), fait: null, cree: new Date().toISOString() });
  $("#memo-text").value = "";
  $("#memo-text").focus();
});
// Entrée pour ajouter (Maj+Entrée : nouvelle ligne)
$("#memo-text").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); $("#memo-form").requestSubmit(); }
});
