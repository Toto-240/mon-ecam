"use strict";
/* Déposer un devoir sur Moodle depuis l'onglet À rendre.
   Le fichier part (chiffré) sur GitHub, qui le dépose sur Moodle avec ta connexion ECAM.
   Utilise DATA, store, esc, decrypt, unb64, fmtTime, relDay, norm (app.js) et
   send, newId, sameMatiere (revisions.js). */

let depotCtx = null, depotFiles = [];
const DEPOT_MAX = 40e6;

/* Derniers résultats de dépôt pour un devoir (le plus récent d'abord) */
const depotsFor = (cmid) => (DATA.depots || []).filter((d) => String(d.cmid) === String(cmid))
  .sort((a, b) => (b.quand || "").localeCompare(a.quand || ""));

window.depotDone = (cmid) => {
  if (!cmid) return false;
  const d = depotsFor(cmid)[0];
  return !!d && !d.besoin_envoi;
};

/* Ligne de suivi sous le devoir dans À rendre */
window.depotLine = function (cmid) {
  const pend = (window.pendingAll?.() || []).filter((p) => p.kind === "depot" && String(p.cmid) === String(cmid)).pop();
  if (pend) {
    return pend.err
      ? `<p class="depot-line fail">Dépôt raté : ${esc(pend.err.message)}. <button type="button" class="linkish" data-forget-depot="${esc(pend.id)}">OK</button></p>`
      : `<p class="depot-line wait">${pend.action === "envoyer" ? "Envoi" : "Dépôt"} sur Moodle en cours (envoyé à ${esc(fmtTime(new Date(pend.at)))}, 1 à 3 min)…</p>`;
  }
  const d = depotsFor(cmid)[0];
  if (!d) return "";
  const when = new Date(d.quand);
  return `<p class="depot-line ok">Déposé sur Moodle ✓ ${esc(relDay(when))} à ${esc(fmtTime(when))}${d.fichier ? ` (${esc(d.fichier)})` : ""}
    ${d.statut ? `<br><span class="muted">Moodle : ${esc(d.statut)}</span>` : ""}</p>
    ${d.besoin_envoi ? `<div class="due-actions"><button type="button" class="btn small primary" data-envoyer="${esc(cmid)}"
      data-titre="${esc(d.titre || "")}">Envoyer le devoir pour évaluation</button></div>` : ""}`;
};

document.addEventListener("click", (ev) => {
  const b = ev.target.closest?.("[data-forget-depot]");
  if (!b) return;
  pending.remove(b.dataset.forgetDepot);
  renderDevoirs();
});

/* ---------- Fenêtre de dépôt ---------- */
window.openDepot = function (cmid, titre, matiere, envoiSeul = false) {
  depotCtx = { cmid, titre, matiere, envoiSeul, source: null };
  depotFiles = [];
  const last = depotsFor(cmid)[0];
  $("#depot-title").textContent = envoiSeul ? "Envoyer le devoir" : "Déposer sur Moodle";
  $("#depot-what").textContent = titre || "";
  $("#depot-choose").querySelectorAll(":scope > :not(#depot-decl)").forEach((el) => { el.hidden = envoiSeul; });
  $("#depot-file").hidden = true;   // le vrai champ fichier reste caché (bouton « Choisir un fichier »)
  showFiles();
  $("#depot-envoyer").checked = false;
  $("#depot-decl-ok").checked = false;
  $("#depot-msg").textContent = envoiSeul
    ? "L'envoi est définitif : tu ne pourras plus modifier ton dépôt sur Moodle."
    : "";
  $("#depot-bar").hidden = true;
  const decl = last?.declaration || "";
  $("#depot-decl-text").textContent = decl;
  $("#depot-decl").hidden = !(decl && envoiSeul);
  $("#depot-send").textContent = envoiSeul ? "Envoyer définitivement" : "Déposer";
  $("#depot-send").disabled = false;
  if (!envoiSeul) renderSources(matiere, titre);
  $("#depot-sheet").hidden = false;
  document.body.style.overflow = "hidden";
};

function closeDepot() {
  $("#depot-sheet").hidden = true;
  document.body.style.overflow = "";
}
$("#depot-close").onclick = closeDepot;
$("#depot-sheet").addEventListener("click", (ev) => { if (ev.target.id === "depot-sheet") closeDepot(); });

$("#depot-envoyer").onchange = () => {
  const decl = depotsFor(depotCtx?.cmid)[0]?.declaration;
  $("#depot-decl").hidden = !($("#depot-envoyer").checked && decl);
};

/* Devoirs faits par l'IA : ceux de ce devoir en premier */
function renderSources(matiere, titre) {
  const t = norm(titre);
  const list = [...(DATA.travaux || [])].sort((a, b) => {
    const score = (x) => (norm(x.titre) && t && (norm(x.titre).includes(t) || t.includes(norm(x.titre))) ? 2 : 0)
      + (sameMatiere(x.matiere, matiere) ? 1 : 0);
    return score(b) - score(a) || (b.cree || "").localeCompare(a.cree || "");
  }).slice(0, 6);
  $("#depot-sources").innerHTML = list.length ? list.map((d) => `<li>
      <div class="t">${esc(d.titre || "Devoir")}</div>
      <div class="m">${esc([d.matiere, d.cree ? fmtDate(d.cree.slice(0, 10)) : ""].filter(Boolean).join(", "))}</div>
      <div class="row tight">
        <label class="check"><input type="checkbox" name="depot-src" value="${esc(d.id)}|pdf"> PDF</label>
        <label class="check"><input type="checkbox" name="depot-src" value="${esc(d.id)}|docx"> Word</label>
      </div></li>`).join("")
    : `<li class="m">Aucun devoir fait dans l'onglet Devoirs. Ajoute tes fichiers ci-dessous.</li>`;
}

/* Fichiers de l'appareil choisis (on peut en ajouter en plusieurs fois, et en retirer) */
const mo = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1e3))} ko`);
function showFiles() {
  const ul = $("#depot-file-name");
  ul.innerHTML = depotFiles.map((f, i) => `<li><span>📎 ${esc(f.name)} <span class="muted">(${mo(f.size)})</span></span>
    <button type="button" class="linkish" data-depot-rm="${i}" aria-label="Retirer ${esc(f.name)}">Retirer</button></li>`).join("");
  ul.querySelectorAll("[data-depot-rm]").forEach((b) => {
    b.onclick = () => { depotFiles.splice(+b.dataset.depotRm, 1); showFiles(); };
  });
}

$("#depot-file").addEventListener("change", (ev) => {
  const add = [...ev.target.files];
  ev.target.value = "";
  const msg = $("#depot-msg");
  msg.textContent = "";
  for (const f of add) {
    if (depotFiles.some((x) => x.name === f.name && x.size === f.size)) continue;   // déjà dans la liste
    const total = depotFiles.reduce((t, x) => t + x.size, 0) + f.size;
    if (total > DEPOT_MAX) { msg.textContent = `« ${f.name} » n'a pas été ajouté : 40 Mo maximum en tout.`; continue; }
    depotFiles.push(f);
  }
  showFiles();
});

async function travailFile(id, format) {
  const r = await fetch(`devoirs/${encodeURIComponent(id)}.enc?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("devoir introuvable, recharge l'appli");
  const d = await decrypt(await r.json(), store.get("ecam-pw"));
  const b64 = format === "pdf" ? d.pdf : d.docx;
  if (!b64) throw new Error(format === "pdf" ? "le PDF de ce devoir n'est pas encore prêt, choisis Word" : "fichier Word introuvable");
  const base = (d.fichier || "devoir.docx").replace(/\.docx$/i, "");
  return { name: `${base}.${format}`, bytes: unb64(b64).buffer,
    type: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
}

$("#depot-send").onclick = async () => {
  const c = depotCtx;
  if (!c) return;
  const btn = $("#depot-send"), msg = $("#depot-msg");
  const decl = depotsFor(c.cmid)[0]?.declaration;
  const wantsSend = c.envoiSeul || $("#depot-envoyer").checked;
  if (wantsSend && decl && !$("#depot-decl-ok").checked) {
    $("#depot-decl").hidden = false;
    msg.textContent = "Coche la déclaration sur l'honneur pour envoyer le devoir.";
    return;
  }
  btn.disabled = true;
  try {
    if (c.envoiSeul) {
      await send({ id: newId(), kind: "depot", action: "envoyer", cmid: c.cmid, titre: c.titre, matiere: c.matiere,
        accepte_declaration: !!decl && $("#depot-decl-ok").checked }, new ArrayBuffer(0), "depot");
    } else {
      const files = [];
      const srcs = [...document.querySelectorAll('input[name="depot-src"]:checked')].map((x) => x.value);
      if (srcs.length) msg.textContent = "Préparation des fichiers…";
      for (const src of srcs) { const [id, fmt] = src.split("|"); files.push(await travailFile(id, fmt)); }
      for (const f of depotFiles) files.push({ name: f.name, type: f.type, bytes: await f.arrayBuffer() });
      if (!files.length) { msg.textContent = "Choisis au moins un fichier à déposer."; btn.disabled = false; return; }
      const total = files.reduce((t, f) => t + f.bytes.byteLength, 0);
      if (total > DEPOT_MAX) { msg.textContent = "Trop gros : 40 Mo maximum en tout."; btn.disabled = false; return; }
      // les fichiers partent collés bout à bout ; la liste (noms, tailles) permet de les séparer
      const all = new Uint8Array(total);
      let pos = 0;
      for (const f of files) { all.set(new Uint8Array(f.bytes), pos); pos += f.bytes.byteLength; }
      await send({ id: newId(), kind: "depot", action: "deposer", cmid: c.cmid, titre: c.titre, matiere: c.matiere,
        nom: files.map((f) => f.name).join(", "), type: files[0].type,
        fichiers: files.map((f) => ({ nom: f.name, type: f.type, taille: f.bytes.byteLength })),
        envoyer: $("#depot-envoyer").checked,
        accepte_declaration: !!decl && $("#depot-decl-ok").checked }, all.buffer, "depot");
    }
    renderDevoirs();
  } catch (e) {
    msg.textContent = `Échec : ${e.message}`;
    btn.disabled = false;
  }
};
