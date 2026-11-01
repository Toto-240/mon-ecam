"use strict";
/* Onglet Devoirs : envoyer un énoncé (fichier, photo ou devoir Moodle) et récupérer le devoir fait.
   Utilise send, md, matieres, guessMatiere, newId, openReader, fmtDate (revisions.js) et
   DATA, store, esc, decrypt (app.js). */

const MAX_DV_MB = 25;
let dvFile = null;

function pickFile(ev) {
  const f = ev.target.files[0];
  ev.target.value = "";
  if (!f) return;
  if (f.size > MAX_DV_MB * 1e6) { dvStatus(`Fichier trop gros (${Math.round(f.size / 1e6)} Mo, maximum ${MAX_DV_MB} Mo).`); return; }
  dvFile = f;
  $("#dv-file-name").textContent = f.name || "photo";
}
$("#dv-file").addEventListener("change", pickFile);
$("#dv-photo").addEventListener("change", pickFile);

function dvStatus(text) {
  $("#dv-upload").hidden = false;
  $("#dv-upload-msg").textContent = text;
  $("#dv-upload-bar").value = 0;
}

function fillDevoirForm() {
  const sel = $("#dv-matiere");
  const keep = sel.value || guessMatiere();
  sel.innerHTML = `<option value="">Matière (facultatif)</option>` +
    matieres().map((m) => `<option${m === keep ? " selected" : ""}>${esc(m)}</option>`).join("");
}

$("#dv-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!dvFile) { dvStatus("Choisis d'abord l'énoncé (fichier ou photo)."); return; }
  const btn = $("#dv-send");
  btn.disabled = true;
  try {
    const name = dvFile.name && dvFile.name !== "image.jpg" ? dvFile.name : `photo-${Date.now()}.jpg`;
    await send({ id: newId(), kind: "devoir", nom: name, type: dvFile.type, titre: name.replace(/\.[^.]+$/, ""),
      matiere: $("#dv-matiere").value, consigne: $("#dv-consigne").value.trim() },
      await dvFile.arrayBuffer(), "dv-upload");
    dvFile = null;
    $("#dv-file-name").textContent = "";
    $("#dv-consigne").value = "";
  } catch {}
  btn.disabled = false;
});

/* Depuis l'onglet À rendre : l'énoncé est récupéré directement sur Moodle. */
window.faireDevoirMoodle = async function (cmid, titre, matiere, button) {
  showPane("devoirs");
  if (button) button.disabled = true;
  try {
    await send({ id: newId(), kind: "devoir_moodle", cmid, titre, matiere }, new ArrayBuffer(0), "dv-upload");
  } catch {}
  if (button) button.disabled = false;
};

/* ---------- Devoirs faits ---------- */
function renderTravaux() {
  const items = [...(DATA.travaux || [])].sort((a, b) => (b.cree || "").localeCompare(a.cree || ""));
  $("#travaux").innerHTML = items.length ? items.map((d) => `<li><button type="button" class="item" data-travail="${esc(d.id)}">
      <div class="t">${esc(d.titre || "Devoir")}</div>
      <div class="m">${esc([d.matiere, d.cree ? fmtDate(d.cree.slice(0, 10)) : "",
        d.mise_en_page === "original" ? "dans ton document d'origine" : "document Word reconstruit"].filter(Boolean).join(", "))}</div>
    </button></li>`).join("")
    : `<li class="m">Pas encore de devoir. Envoie un énoncé ci-dessus, ou appuie sur « Faire avec l'IA » dans l'onglet À rendre.</li>`;
  $("#travaux").querySelectorAll("[data-travail]").forEach((b) => { b.onclick = () => openTravail(b.dataset.travail, b); });
}

const travauxCache = {};
async function openTravail(id, button) {
  let d = travauxCache[id];
  if (!d) {
    button?.setAttribute("aria-busy", "true");
    try {
      const r = await fetch(`devoirs/${encodeURIComponent(id)}.enc?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      d = travauxCache[id] = await decrypt(await r.json(), store.get("ecam-pw"));
    } catch {
      dvStatus("Impossible d'ouvrir ce devoir pour l'instant. Recharge l'appli dans une minute.");
      return;
    } finally {
      button?.removeAttribute("aria-busy");
    }
  }
  openReader(d.titre || "Devoir", `
    <div class="row tight"><button type="button" class="btn primary" id="dv-download">Télécharger le devoir (.docx)</button></div>
    <p class="meta">${esc(d.mise_en_page === "original"
      ? "Réponses ajoutées dans ton document Word d'origine, avec sa mise en page."
      : "Document Word avec la même structure que l'énoncé.")}</p>
    ${md(d.md)}`);
  $("#dv-download").onclick = () => saveDocx(d);
}

async function saveDocx(d) {
  const bytes = unb64(d.docx);
  const name = d.fichier || "devoir.docx";
  const type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const file = new File([bytes], name, { type });
  // iPhone : feuille de partage (Enregistrer dans Fichiers, ouvrir dans Word…)
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e?.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

window.renderDevoirsIA = function () {
  fillDevoirForm();
  renderTravaux();
};
