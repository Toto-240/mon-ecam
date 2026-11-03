"use strict";
/* Déposer un devoir sur Moodle depuis l'onglet À rendre.
   Le fichier part (chiffré) sur GitHub, qui le dépose sur Moodle avec ta connexion ECAM.
   Utilise DATA, store, esc, decrypt, unb64, fmtTime, relDay, norm (app.js) et
   send, newId, sameMatiere (revisions.js). */

let depotCtx = null, depotFile = null;

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
  depotFile = null;
  const last = depotsFor(cmid)[0];
  $("#depot-title").textContent = envoiSeul ? "Envoyer le devoir" : "Déposer sur Moodle";
  $("#depot-what").textContent = titre || "";
  $("#depot-choose").querySelectorAll(":scope > :not(#depot-decl)").forEach((el) => { el.hidden = envoiSeul; });
  $("#depot-file").hidden = true;   // le vrai champ fichier reste caché (bouton « Choisir un fichier »)
  $("#depot-file-name").textContent = "";
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
        <label class="check"><input type="radio" name="depot-src" value="${esc(d.id)}|pdf"> PDF</label>
        <label class="check"><input type="radio" name="depot-src" value="${esc(d.id)}|docx"> Word</label>
      </div></li>`).join("")
    : `<li class="m">Aucun devoir fait dans l'onglet Devoirs. Choisis un fichier ci-dessous.</li>`;
  $("#depot-sources").querySelectorAll('input[name="depot-src"]').forEach((r) => {
    r.onchange = () => { depotFile = null; $("#depot-file-name").textContent = ""; };
  });
}

$("#depot-file").addEventListener("change", (ev) => {
  const f = ev.target.files[0];
  ev.target.value = "";
  if (!f) return;
  if (f.size > 40e6) { $("#depot-msg").textContent = "Fichier trop gros (40 Mo maximum)."; return; }
  depotFile = f;
  document.querySelectorAll('input[name="depot-src"]').forEach((r) => { r.checked = false; });
  $("#depot-file-name").textContent = `Fichier choisi : ${f.name}`;
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
      let file;
      const src = document.querySelector('input[name="depot-src"]:checked')?.value;
      if (depotFile) file = { name: depotFile.name, type: depotFile.type, bytes: await depotFile.arrayBuffer() };
      else if (src) { msg.textContent = "Préparation du fichier…"; const [id, fmt] = src.split("|"); file = await travailFile(id, fmt); }
      else { msg.textContent = "Choisis le fichier à déposer."; btn.disabled = false; return; }
      await send({ id: newId(), kind: "depot", action: "deposer", cmid: c.cmid, titre: c.titre, matiere: c.matiere,
        nom: file.name, type: file.type, envoyer: $("#depot-envoyer").checked,
        accepte_declaration: !!decl && $("#depot-decl-ok").checked }, file.bytes, "depot");
    }
    renderDevoirs();
  } catch (e) {
    msg.textContent = `Échec : ${e.message}`;
    btn.disabled = false;
  }
};
