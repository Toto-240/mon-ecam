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
/* Devoirs supprimés : cachés tout de suite, en attendant que GitHub republie l'appli */
const HIDDEN_KEY = "ecam-devoirs-supprimes";
const hidden = {
  all: () => { try { return JSON.parse(store.get(HIDDEN_KEY)) || []; } catch { return []; } },
  add(id) { store.set(HIDDEN_KEY, JSON.stringify([...this.all(), id])); },
};

function renderTravaux() {
  const present = new Set((DATA.travaux || []).map((d) => d.id));
  store.set(HIDDEN_KEY, JSON.stringify(hidden.all().filter((id) => present.has(id)))); // ménage
  const gone = new Set(hidden.all());
  const items = [...(DATA.travaux || [])].filter((d) => !gone.has(d.id))
    .sort((a, b) => (b.cree || "").localeCompare(a.cree || ""));
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
    <div class="row tight">
      <button type="button" class="btn primary" id="dv-docx">Word (.docx)</button>
      ${d.pdf ? `<button type="button" class="btn primary" id="dv-pdf">PDF</button>`
        : `<span class="muted small">PDF en préparation, recharge dans quelques minutes.</span>`}
    </div>
    <p class="meta">${esc(d.mise_en_page === "original"
      ? "Réponses ajoutées dans ton document Word d'origine, avec sa mise en page."
      : "Document Word avec la même structure que l'énoncé.")}</p>
    ${md(d.md)}
    <div class="row danger-zone"><button type="button" class="btn danger" id="dv-delete">Supprimer ce devoir</button>
      <span id="dv-delete-msg" class="small muted" aria-live="polite"></span></div>`);
  const base = (d.fichier || "devoir.docx").replace(/\.docx$/i, "");
  $("#dv-docx").onclick = () => saveFile(d.docx, `${base}.docx`,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  $("#dv-pdf")?.addEventListener("click", () => saveFile(d.pdf, `${base}.pdf`, "application/pdf"));
  $("#dv-delete").onclick = () => deleteTravail(d);
}

/* Supprime le devoir fait du dépôt GitHub (avec ton jeton) */
let deleteArmed = 0;
async function deleteTravail(d) {
  const btn = $("#dv-delete"), msg = $("#dv-delete-msg");
  if (!store.get(TOKEN_KEY)) { msg.textContent = "Ajoute d'abord ton jeton GitHub (onglet Micro, Réglages)."; return; }
  if (Date.now() - deleteArmed > 4000) {
    deleteArmed = Date.now();
    btn.textContent = "Confirmer la suppression";
    msg.textContent = "Appuie encore une fois pour supprimer définitivement ce devoir.";
    setTimeout(() => { if (Date.now() - deleteArmed >= 4000) { btn.textContent = "Supprimer ce devoir"; msg.textContent = ""; } }, 4100);
    return;
  }
  deleteArmed = 0;
  btn.disabled = true;
  msg.textContent = "Suppression…";
  try {
    const path = `/contents/devoirs/${encodeURIComponent(d.id)}.enc`;
    const info = await gh(`${path}?ref=main`);
    if (info.status !== 404) {
      if (!info.ok) throw new Error(info.status === 401 ? "jeton GitHub refusé" : `GitHub ne répond pas (${info.status})`);
      const { sha } = await info.json();
      const r = await gh(path, { method: "DELETE", body: JSON.stringify({ message: "Devoir supprimé", sha, branch: "main" }) });
      if (!r.ok) throw new Error(r.status === 403 ? "ce jeton ne peut pas modifier le dépôt" : `suppression refusée (${r.status})`);
    }
    hidden.add(d.id);
    delete travauxCache[d.id];
    closeReader();
    renderTravaux();
    dvStatus("Devoir supprimé.");
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Supprimer ce devoir";
    msg.textContent = `Échec : ${e.message}`;
  }
}

async function saveFile(b64, name, type) {
  // Appli iPhone : feuille de partage native (Enregistrer dans Fichiers, ouvrir dans Word…)
  if (typeof Dicta !== "undefined" && Dicta) {
    try { await Dicta.share({ data: b64, name, type }); return; }
    catch (e) {
      if (notImplemented(e)) {
        dvStatus("Pour télécharger dans l'appli iPhone, installe la dernière version de l'appli (Sideloadly). En attendant, ouvre l'appli dans Safari.");
        return;
      }
      dvStatus(`Téléchargement impossible : ${e.message || e}`);
      return;
    }
  }
  const file = new File([unb64(b64)], name, { type });
  // Téléphone (Safari, Android) : feuille de partage ; sur ordinateur : vrai téléchargement
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
  if (mobile && navigator.canShare?.({ files: [file] })) {
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
