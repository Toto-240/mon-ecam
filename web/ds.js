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

/* Un DS est repéré par son id (DS ajouté à la main) ou sa matière + son jour */
const dsKey = (e) => e.persoId || `${norm(e.matiere)}|${e.debut.slice(0, 10)}`;
const dsOpen = new Set();

/* DS marqués « terminés » : rangés à part, plus comptés dans le badge */
function renderFinis(list) {
  const box = $("#ds-finis");
  box.hidden = !list.length;
  $("#ds-finis-n").textContent = list.length;
  $("#ds-finis-list").innerHTML = list.map((e) => `<li class="is-done">
      <div class="due"><span class="t">${esc(e.matiere)}</span><span class="left">Terminé</span></div>
      <div class="m">${esc(fmtDayLong(e.d0))}</div>
      <div class="due-actions"><button type="button" class="btn small" data-ds-refaire="${esc(dsKey(e))}">Remettre dans les DS à venir</button></div>
    </li>`).join("");
  box.querySelectorAll("[data-ds-refaire]").forEach((b) => { b.onclick = () => window.setDsFini?.(b.dataset.dsRefaire, false); });
}

window.renderDS = function () {
  const all = upcomingExams();
  const fini = (e) => window.dsFini?.(dsKey(e));
  const exams = all.filter((e) => !fini(e));
  renderFinis(all.filter(fini));
  const soon = exams.filter((e) => e.d0 - NOW < 7 * 864e5).length;
  $("#ds-badge").hidden = !soon;
  $("#ds-badge").textContent = soon;
  fillDsForm();
  const box = $("#ds-list");
  if (!exams.length) {
    box.innerHTML = `<p class="empty-state">${all.length ? "Plus de DS à venir : tout est terminé 👍"
      : "Aucun DS dans ton planning des prochaines semaines. Un DS annoncé en cours ? Ajoute-le ci-dessus."}</p>`;
    return;
  }
  const allFiches = (DATA.fiches || []).filter((f) => f.kind === "cours");
  const revs = DATA.revisions || [];
  box.innerHTML = exams.map((e, i) => {
    const days = Math.ceil((startOfDay(e.d0) - startOfDay(NOW)) / 864e5);
    const fs = allFiches.filter((f) => sameMatiere(f.matiere, e.matiere))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const key = dsKey(e);
    const exclus = new Set(window.dsExclus?.(key) || []);
    const chosen = fs.filter((f) => !exclus.has(f.id));
    // révision faite pour ce DS (avec ta sélection), sinon celle de la matière
    const r = revs.find((x) => x.ds === e.debut && sameMatiere(x.matiere, e.matiere))
      || revs.find((x) => !x.ds && sameMatiere(x.matiere, e.matiere));
    const sameSel = r?.fiches ? [...r.fiches].sort().join() === chosen.map((f) => f.id).sort().join() : false;
    const stale = r && (r.ds ? !sameSel : true);
    const said = profSaid(fs);
    e.chosen = chosen.map((f) => f.id);
    return `<article class="ds${days <= 7 ? " soon" : ""}">
      <div class="ds-top">
        <div>
          <h3>${esc(e.matiere)}</h3>
          <div class="ds-when">${esc(fmtDayLong(e.d0))}, ${e.sansHeure ? "heure à préciser" : `${fmtTime(e.d0)}–${fmtTime(e.d1)}`}${e.salle ? `, salle ${esc(e.salle)}` : ""}</div>
          ${e.prof ? `<div class="ds-when">${esc(e.prof)}</div>` : ""}
          ${e.perso ? `<div class="chg chg-oral">Annoncé à l'oral, pas encore dans le planning</div>` : ""}
        </div>
        <div class="ds-count"><b>${days <= 0 ? "Auj." : days}</b><span>${days <= 0 ? "" : days === 1 ? "jour" : "jours"}</span></div>
      </div>
      ${e.persoNotes ? `<h4>Tes notes</h4><p class="ds-notes">${esc(e.persoNotes)}</p>` : ""}
      ${said.length ? `<h4>Ce que le prof a dit</h4><ul class="said">${said.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      ${fs.length ? `
      ${r ? `<ul class="list ds-rev"><li class="rev"><button type="button" class="item" data-ds-rev="${esc(r.id)}">
          <div class="t">Fiche de révision et QCM${r.ds ? "" : " (toute la matière)"}</div>
          <div class="m">${r.qcm?.length || 0} question${(r.qcm?.length || 0) > 1 ? "s" : ""}, ${r.sources} fiche${r.sources > 1 ? "s" : ""}${r.ds && !sameSel ? " · ta sélection a changé depuis" : ""}</div></button></li></ul>` : ""}
      <details class="ds-pick"${dsOpen.has(key) ? " open" : ""} data-key="${esc(key)}">
        <summary><b>Fiches à réviser</b> <span class="muted">${chosen.length} sur ${fs.length}</span></summary>
        <p class="muted small">Décoche les fiches que tu n'as pas à apprendre pour ce DS. La révision et le QCM seront faits avec celles cochées.</p>
        <div class="row tight pick-all">
          <button type="button" class="btn small" data-sel-all="${i}">Tout cocher</button>
          <button type="button" class="btn small" data-sel-none="${i}">Tout décocher</button>
        </div>
        <ul class="list pick-list">
          ${fs.map((f) => `<li class="pick${exclus.has(f.id) ? " off" : ""}">
            <input type="checkbox" id="sel-${i}-${esc(f.id)}" data-sel="${i}" data-id="${esc(f.id)}"${exclus.has(f.id) ? "" : " checked"}
              aria-label="Réviser ${esc(f.titre || f.matiere)}">
            <button type="button" class="item" data-ds-fiche="${esc(f.id)}">
              <div class="t">${esc(f.titre || f.matiere)}</div>
              <div class="m">${f.source === "moodle" ? "Support Moodle" : f.source === "complete" ? "Support Moodle + cours" : esc(fmtDate(f.date))}</div></button>
          </li>`).join("")}
        </ul>
      </details>
      <div class="row">
        <button type="button" class="btn small${r && !stale ? "" : " primary"}" data-ds-make="${i}"${chosen.length ? "" : " disabled"}>${
          !chosen.length ? "Coche au moins une fiche"
          : r?.ds ? (sameSel ? "Refaire la révision et le QCM" : `Mettre à jour avec les ${chosen.length} fiches cochées`)
          : `Créer la révision et le QCM (${chosen.length} fiche${chosen.length > 1 ? "s" : ""})`}</button>
      </div>`
      : `<p class="muted small">Pas encore de fiche pour cette matière. Ajoute-en depuis le planning (bouton « + Ajouter une fiche » sous chaque cours) ou enregistre le prochain cours.</p>`}
      <div class="row ds-perso">
        <button type="button" class="btn small fait-btn" data-ds-fini="${esc(dsKey(e))}">✓ DS terminé</button>
        ${e.persoId ? `<button type="button" class="btn small danger" data-ds-del="${esc(e.persoId)}">${e.perso ? "Supprimer ce DS" : "Retirer tes notes"}</button>` : ""}
      </div>
    </article>`;
  }).join("");

  box.querySelectorAll("[data-ds-fini]").forEach((b) => { b.onclick = () => window.setDsFini?.(b.dataset.dsFini, true); });
  box.querySelectorAll("[data-ds-del]").forEach((b) => {
    b.onclick = () => {
      if (b.dataset.armed) { window.delPersoDS?.(b.dataset.dsDel); return; }
      const label = b.textContent;
      b.dataset.armed = "1";
      b.textContent = "Appuie encore pour confirmer";
      setTimeout(() => { delete b.dataset.armed; b.textContent = label; }, 4000);
    };
  });
  box.querySelectorAll("[data-ds-fiche]").forEach((b) => { b.onclick = () => openFiche(b.dataset.dsFiche); });
  box.querySelectorAll("[data-ds-rev]").forEach((b) => { b.onclick = () => openRevision(null, b.dataset.dsRev); });
  box.querySelectorAll("details.ds-pick").forEach((d) => {
    d.addEventListener("toggle", () => { d.open ? dsOpen.add(d.dataset.key) : dsOpen.delete(d.dataset.key); });
  });
  // cocher / décocher : enregistré (et synchronisé entre tes appareils)
  const setSel = (e, ids) => {
    const all = (DATA.fiches || []).filter((f) => f.kind === "cours" && sameMatiere(f.matiere, e.matiere)).map((f) => f.id);
    window.setDsExclus?.(dsKey(e), all.filter((id) => !ids.includes(id)));
  };
  box.querySelectorAll("[data-sel]").forEach((c) => {
    c.onchange = () => {
      const e = exams[+c.dataset.sel];
      const ids = [...box.querySelectorAll(`[data-sel="${c.dataset.sel}"]`)].filter((x) => x.checked).map((x) => x.dataset.id);
      setSel(e, ids);
    };
  });
  box.querySelectorAll("[data-sel-all]").forEach((b) => {
    b.onclick = () => { const e = exams[+b.dataset.selAll]; setSel(e, (DATA.fiches || []).map((f) => f.id)); };
  });
  box.querySelectorAll("[data-sel-none]").forEach((b) => { b.onclick = () => setSel(exams[+b.dataset.selNone], []); });
  box.querySelectorAll("[data-ds-make]").forEach((b) => {
    b.onclick = async () => {
      const e = exams[+b.dataset.dsMake];
      const m = (DATA.fiches || []).find((f) => norm(f.matiere) === norm(e.matiere))?.matiere || e.matiere;
      b.disabled = true;
      b.textContent = "Demande envoyée, révision en préparation…";
      try { await send({ id: newId(), kind: "revision", matiere: m, ds: e.debut, fiches: e.chosen }, new ArrayBuffer(0), "add"); }
      catch { b.disabled = false; b.textContent = "Réessayer"; }
    };
  });
};

/* ---------- Ajouter un DS annoncé à l'oral ---------- */
function fillDsForm() {
  const names = new Set([...(DATA.planning || []).map((e) => e.matiere), ...matieres()].filter(Boolean));
  $("#ds-matieres").innerHTML = [...names].sort((a, b) => a.localeCompare(b, "fr")).map((m) => `<option value="${esc(m)}">`).join("");
  const p2 = (n) => String(n).padStart(2, "0");
  $("#ds-date").min = `${NOW.getFullYear()}-${p2(NOW.getMonth() + 1)}-${p2(NOW.getDate())}`;
}

$("#ds-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const v = (id) => $(id).value.trim();
  if (v("#ds-fin") && v("#ds-debut") && v("#ds-fin") <= v("#ds-debut")) {
    $("#ds-form-msg").textContent = "L'heure de fin doit être après le début.";
    return;
  }
  window.addPersoDS({ id: newId(), matiere: v("#ds-matiere"), date: v("#ds-date"), debut: v("#ds-debut"),
    fin: v("#ds-debut") ? v("#ds-fin") : "", salle: v("#ds-salle"), notes: v("#ds-notes"), cree: new Date().toISOString() });
  ev.target.reset();
  $("#add-ds").open = false;
  $("#ds-form-msg").textContent = "";
});

/* ---------- Ajouter une fiche à un cours ---------- */
let addCtx = null, addFiles = [];

/* Depuis l'onglet Révisions : une fiche sans cours précis du planning (matière et date au choix) */
window.openAddSheetLibre = function (matiere) {
  addCtx = { libre: true, matiere: matiere || "", date: dayIso(NOW), heure: "", now: false };
  $("#add-libre").hidden = false;
  $("#add-matiere").value = matiere || "";
  $("#add-date").value = addCtx.date;
  $("#add-support").value = "";
  fillSupports($("#add-support"), matiere || "");
  addFiles = [];
  $("#add-what").textContent = "Photos, documents, notes ou enregistrement : la fiche est rangée dans la matière choisie.";
  $("#add-rec").hidden = false;
  $("#add-text").value = "";
  $("#add-msg").textContent = "";
  $("#add-bar").hidden = true;
  renderAddFiles();
  $("#add-sheet").hidden = false;
  document.body.style.overflow = "hidden";
};
const dayIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
$("#add-matiere").addEventListener("change", () => fillSupports($("#add-support"), $("#add-matiere").value.trim()));

/* Matière, date… de la fiche à créer (null si la matière manque) */
function addInfo() {
  if (!addCtx) return null;
  if (!addCtx.libre) return addCtx;
  const matiere = $("#add-matiere").value.trim();
  if (!matiere) { $("#add-msg").textContent = "Choisis d'abord la matière."; $("#add-matiere").focus(); return null; }
  return { ...addCtx, matiere, date: $("#add-date").value || dayIso(NOW) };
}

window.openAddSheet = function (e) {
  if (!e) return;
  $("#add-libre").hidden = true;
  addCtx = { matiere: e.matiere, date: e.debut.slice(0, 10), heure: e.debut.slice(11, 16), creneau: e.debut, now: e.d0 <= NOW && NOW < e.d1 };
  $("#add-support").value = "";
  fillSupports($("#add-support"), e.matiere);
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
  const ctx = addInfo();
  if (!ctx) return;
  const m = ctx.matiere, sup = $("#add-support").value;
  closeAdd();
  showPane("enregistrer");
  $("#f-date").value = ctx.date;
  fillForm(m);
  $("#f-creneau").value = ctx.creneau;
  $("#f-support").value = sup;
  startRecording(m);
};

/* Un enregistrement audio suit le circuit des cours enregistrés */
$("#add-audio").addEventListener("change", async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = "";
  const c = addInfo();
  if (!f || !c) return;
  $("#add-bar").hidden = false;
  try {
    await send({ id: newId(), kind: "cours", matiere: c.matiere, date: c.date, heure: c.heure,
      creneau: c.creneau, ...($("#add-support").value && { support: $("#add-support").value }),
      nom: f.name, type: f.type }, await f.arrayBuffer(), "add");
  } catch {}
});

$("#add-send").onclick = async () => {
  const c = addInfo();
  if (!c) return;
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
    await send({ id: newId(), kind: "notes", matiere: c.matiere, date: c.date, heure: c.heure, texte,
      creneau: c.creneau, ...($("#add-support").value && { support: $("#add-support").value }),
      files: addFiles.map((f) => ({ name: f.name, type: f.type, size: f.size })) }, all, "add");
  } catch {}
  btn.disabled = false;
};
