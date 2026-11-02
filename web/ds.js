"use strict";
/* Onglet DS (contrôles à venir et quoi réviser) et feuille « Ajouter une fiche » d'un cours.
   Utilise DATA, NOW, events, norm, esc, fmtTime, fmtDayLong, relDay, showPane (app.js) et
   send, newId, openFiche, openRevision, openSubjects, startRecording (revisions.js). */

/* ---------- DS ---------- */
const EXAM_RE = /\b(DS|examen|partiel|contr[ôo]le|interro|QCM|soutenance)\b/i;

function upcomingExams() {
  return events().filter((e) => e.d1 > NOW && (e.type === "DS" || (e.type === "Événement" && EXAM_RE.test(e.titre))));
}

/* Ce que le prof a dit sur le DS, relevé dans les fiches d'enregistrement */
function profSaid(fiches) {
  const out = [];
  for (const f of fiches) {
    if (f.source === "moodle") continue;
    for (const line of String(f.md || "").split("\n")) {
      const clean = line.replace(/^\s*[-*•\d.)]+\s*/, "").replace(/\*\*/g, "").trim();
      if (clean.length > 12 && EXAM_RE.test(clean) && !out.includes(clean)) out.push(clean);
    }
  }
  return out.slice(0, 5);
}

window.renderDS = function () {
  const exams = upcomingExams();
  const soon = exams.filter((e) => e.d0 - NOW < 7 * 864e5).length;
  $("#ds-badge").hidden = !soon;
  $("#ds-badge").textContent = soon;
  const box = $("#ds-list");
  if (!exams.length) {
    box.innerHTML = `<p class="empty-state">Aucun DS dans ton planning des prochaines semaines.</p>`;
    return;
  }
  const allFiches = (DATA.fiches || []).filter((f) => f.kind === "cours");
  const revs = DATA.revisions || [];
  box.innerHTML = exams.map((e, i) => {
    const days = Math.ceil((startOfDay(e.d0) - startOfDay(NOW)) / 864e5);
    const fs = allFiches.filter((f) => norm(f.matiere) === norm(e.matiere))
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const r = revs.find((x) => norm(x.matiere) === norm(e.matiere));
    const stale = r && r.sources < fs.length;
    const said = profSaid(fs);
    return `<article class="ds${days <= 7 ? " soon" : ""}">
      <div class="ds-top">
        <div>
          <h3>${esc(e.matiere)}</h3>
          <div class="ds-when">${esc(fmtDayLong(e.d0))}, ${fmtTime(e.d0)}–${fmtTime(e.d1)}${e.salle ? `, salle ${esc(e.salle)}` : ""}</div>
          ${e.prof ? `<div class="ds-when">${esc(e.prof)}</div>` : ""}
        </div>
        <div class="ds-count"><b>${days <= 0 ? "Auj." : days}</b><span>${days <= 0 ? "" : days === 1 ? "jour" : "jours"}</span></div>
      </div>
      ${said.length ? `<h4>Ce que le prof a dit</h4><ul class="said">${said.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      <h4>À réviser${fs.length ? ` (${fs.length} fiche${fs.length > 1 ? "s" : ""})` : ""}</h4>
      ${fs.length ? `<ul class="list">
        ${r ? `<li class="rev"><button type="button" class="item" data-ds-rev="${esc(r.matiere)}">
          <div class="t">Fiche de révision et QCM</div>
          <div class="m">${r.qcm?.length || 0} question${(r.qcm?.length || 0) > 1 ? "s" : ""}${stale ? ", des cours ont été ajoutés depuis" : ""}</div></button></li>` : ""}
        ${fs.slice(-6).reverse().map((f) => `<li><button type="button" class="item" data-ds-fiche="${esc(f.id)}">
          <div class="t">${esc(f.titre || f.matiere)}</div>
          <div class="m">${f.source === "moodle" ? "Support Moodle" : esc(fmtDate(f.date))}</div></button></li>`).join("")}
      </ul>
      <div class="row">
        <button type="button" class="btn small${r && !stale ? "" : " primary"}" data-ds-make="${i}">${r ? (stale ? "Mettre à jour la révision et le QCM" : "Refaire la révision et le QCM") : "Créer la révision et le QCM"}</button>
        ${fs.length > 6 ? `<button type="button" class="btn small" data-ds-all="${esc(e.matiere)}">Voir les ${fs.length} fiches</button>` : ""}
      </div>`
      : `<p class="muted small">Pas encore de fiche pour cette matière. Ajoute-en depuis le planning (bouton « + Ajouter une fiche » sous chaque cours) ou enregistre le prochain cours.</p>`}
    </article>`;
  }).join("");

  box.querySelectorAll("[data-ds-fiche]").forEach((b) => { b.onclick = () => openFiche(b.dataset.dsFiche); });
  box.querySelectorAll("[data-ds-rev]").forEach((b) => { b.onclick = () => openRevision(b.dataset.dsRev); });
  box.querySelectorAll("[data-ds-all]").forEach((b) => {
    b.onclick = () => {
      const m = (DATA.fiches || []).find((f) => norm(f.matiere) === norm(b.dataset.dsAll))?.matiere || b.dataset.dsAll;
      openSubjects.add(m);
      showPane("revisions");
      window.renderRevisions?.();
    };
  });
  box.querySelectorAll("[data-ds-make]").forEach((b) => {
    b.onclick = async () => {
      const e = exams[+b.dataset.dsMake];
      const m = (DATA.fiches || []).find((f) => norm(f.matiere) === norm(e.matiere))?.matiere || e.matiere;
      b.disabled = true;
      b.textContent = "Demande envoyée, révision en préparation…";
      try { await send({ id: newId(), kind: "revision", matiere: m, ds: e.debut }, new ArrayBuffer(0), "add"); }
      catch { b.disabled = false; b.textContent = "Réessayer"; }
    };
  });
};

/* ---------- Ajouter une fiche à un cours ---------- */
let addCtx = null, addFiles = [];

window.openAddSheet = function (e) {
  if (!e) return;
  addCtx = { matiere: e.matiere, date: e.debut.slice(0, 10), heure: e.debut.slice(11, 16), now: e.d0 <= NOW && NOW < e.d1 };
  addFiles = [];
  $("#add-what").textContent = `${e.matiere}, ${fmtDayLong(e.d0)} à ${fmtTime(e.d0)}`;
  $("#add-rec").hidden = !addCtx.now;
  $("#add-text").value = "";
  $("#add-msg").textContent = "";
  $("#add-bar").hidden = true;
  renderAddFiles();
  $("#add-sheet").hidden = false;
  document.body.style.overflow = "hidden";
};

function closeAdd() {
  $("#add-sheet").hidden = true;
  document.body.style.overflow = "";
}
$("#add-close").onclick = closeAdd;
$("#add-sheet").addEventListener("click", (ev) => { if (ev.target.id === "add-sheet") closeAdd(); });
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("#add-sheet").hidden) closeAdd(); });

function renderAddFiles() {
  $("#add-files").innerHTML = addFiles.map((f, i) =>
    `<li>${esc(f.name || "photo")} <button type="button" aria-label="Retirer" data-rm="${i}">×</button></li>`).join("");
  $("#add-files").querySelectorAll("[data-rm]").forEach((b) => {
    b.onclick = () => { addFiles.splice(+b.dataset.rm, 1); renderAddFiles(); };
  });
}

function addPicked(ev) {
  for (const f of ev.target.files) {
    const name = !f.name || f.name === "image.jpg" ? `photo-${addFiles.length + 1}.jpg` : f.name;
    addFiles.push(new File([f], name, { type: f.type }));
  }
  ev.target.value = "";
  renderAddFiles();
}
$("#add-photo").addEventListener("change", addPicked);
$("#add-doc").addEventListener("change", addPicked);

$("#add-rec").onclick = () => {
  const m = addCtx.matiere;
  closeAdd();
  showPane("enregistrer");
  startRecording(m);
};

/* Un enregistrement audio suit le circuit des cours enregistrés */
$("#add-audio").addEventListener("change", async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = "";
  if (!f || !addCtx) return;
  $("#add-bar").hidden = false;
  try {
    await send({ id: newId(), kind: "cours", matiere: addCtx.matiere, date: addCtx.date, heure: addCtx.heure,
      nom: f.name, type: f.type }, await f.arrayBuffer(), "add");
  } catch {}
});

$("#add-send").onclick = async () => {
  const texte = $("#add-text").value.trim();
  if (!addFiles.length && !texte) {
    $("#add-msg").textContent = "Ajoute une photo, un fichier ou tes notes.";
    return;
  }
  const total = addFiles.reduce((n, f) => n + f.size, 0);
  if (total > 40e6) { $("#add-msg").textContent = "Fichiers trop lourds (40 Mo maximum en tout)."; return; }
  const btn = $("#add-send");
  btn.disabled = true;
  $("#add-bar").hidden = false;
  try {
    // les fichiers sont collés à la suite ; leurs tailles permettent de les séparer côté GitHub
    const parts = await Promise.all(addFiles.map((f) => f.arrayBuffer()));
    const all = await new Blob(parts).arrayBuffer();
    await send({ id: newId(), kind: "notes", matiere: addCtx.matiere, date: addCtx.date, heure: addCtx.heure, texte,
      files: addFiles.map((f) => ({ name: f.name, type: f.type, size: f.size })) }, all, "add");
  } catch {}
  btn.disabled = false;
};
