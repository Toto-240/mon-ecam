"use strict";
/* Cloud : tes fichiers (Word, PDF, images…) chiffrés sur ton GitHub (dossier cloud/),
   la liste est synchronisée entre tes appareils (perso.js). Utilise gh, encryptUpload, toBase64,
   send, newId (revisions.js), saveFile (devoirs.js), openReader, closeReader, store, esc (app.js). */

const CLOUD_MAX_MB = 25;
const cloudCache = {};            // id -> { bytes, type, nom }
let cloudDossier = "";

const fileKind = (nom, type) => {
  const ext = (nom.split(".").pop() || "").toLowerCase();
  if (/^image\//.test(type) || ["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)) return "img";
  if (ext === "pdf" || type === "application/pdf") return "pdf";
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return "word";
  if (["ppt", "pptx", "odp"].includes(ext)) return "ppt";
  if (["xls", "xlsx", "ods", "csv"].includes(ext)) return "xls";
  return "file";
};
const KIND_LABEL = { img: "IMG", pdf: "PDF", word: "W", ppt: "P", xls: "X", file: "•" };
const sizeTxt = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1e3))} Ko`;

/* ---------- Déchiffrement (même format que encryptUpload : MEC1 + sel + iv + données) ---------- */
async function decryptUpload(buf) {
  const u = new Uint8Array(buf);
  if (new TextDecoder().decode(u.slice(0, 4)) !== "MEC1") throw new Error("fichier illisible");
  const salt = u.slice(4, 20), iv = u.slice(20, 32), ct = u.slice(32);
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(store.get("ecam-pw")), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
  const nl = plain.indexOf(10);
  return { meta: JSON.parse(new TextDecoder().decode(plain.slice(0, nl))), bytes: plain.slice(nl + 1) };
}

/* ---------- Envoi ---------- */
async function cloudUpload(files) {
  const msg = $("#cloud-msg"), bar = $("#cloud-bar");
  if (!store.get(TOKEN_KEY)) { msg.textContent = "Ajoute d'abord ton jeton GitHub (onglet Micro, Réglages)."; return; }
  const dossier = $("#cloud-dossier").value.trim() || "Divers";
  const list = [...files];
  bar.hidden = false;
  let ok = 0;
  for (const [i, f] of list.entries()) {
    if (f.size > CLOUD_MAX_MB * 1e6) { msg.textContent = `${f.name} : trop gros (${CLOUD_MAX_MB} Mo maximum).`; continue; }
    const nom = !f.name || f.name === "image.jpg" ? `photo-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.jpg` : f.name;
    msg.textContent = `Envoi de ${nom} (${i + 1}/${list.length})…`;
    bar.value = i / list.length;
    try {
      const id = newId();
      const blob = await encryptUpload({ id, nom, type: f.type }, await f.arrayBuffer());
      const r = await gh(`/contents/cloud/${id}.enc`, { method: "PUT",
        body: JSON.stringify({ message: "Fichier ajouté", branch: "main", content: await toBase64(blob) }) });
      if (!r.ok) throw new Error(r.status === 401 ? "jeton GitHub refusé" : r.status === 403 ? "ce jeton ne peut pas écrire dans le dépôt" : `refusé par GitHub (${r.status})`);
      window.saveCloud({ id, nom, type: f.type, taille: f.size, dossier, cree: new Date().toISOString() });
      ok++;
    } catch (e) {
      msg.textContent = `${nom} : ${e.message}`;
      bar.hidden = true;
      return;
    }
  }
  bar.hidden = true;
  msg.textContent = ok ? `${ok} fichier${ok > 1 ? "s" : ""} ajouté${ok > 1 ? "s" : ""} dans « ${dossier} ».` : msg.textContent;
}

$("#cloud-file").addEventListener("change", (ev) => { const f = ev.target.files; cloudUpload(f).finally(() => { ev.target.value = ""; }); });
$("#cloud-photo").addEventListener("change", (ev) => { const f = ev.target.files; cloudUpload(f).finally(() => { ev.target.value = ""; }); });
$("#cloud-filtre").addEventListener("input", () => window.renderCloud());

/* ---------- Liste ---------- */
window.renderCloud = function () {
  const all = window.persoCloud?.() || [];
  const q = norm($("#cloud-filtre").value);
  const items = all.filter((f) => !q || norm(f.nom).includes(q) || norm(f.dossier).includes(q))
    .sort((a, b) => (b.cree || "").localeCompare(a.cree || ""));
  // dossiers proposés : ceux déjà utilisés + les matières
  const dossiers = [...new Set([...all.map((f) => f.dossier), ...(DATA?.planning || []).map((e) => e.matiere), "Divers"].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "fr"));
  $("#cloud-dossiers").innerHTML = dossiers.map((d) => `<option value="${esc(d)}">`).join("");
  const groups = {};
  for (const f of items) (groups[f.dossier || "Divers"] ||= []).push(f);
  const names = Object.keys(groups).sort((a, b) => a === "Divers" ? 1 : b === "Divers" ? -1 : a.localeCompare(b, "fr"));
  $("#cloud-list").innerHTML = !all.length
    ? `<p class="empty-state">Ton cloud est vide. Ajoute tes Word, PDF et images ci-dessus : ils seront sur ton PC et ton téléphone.</p>`
    : !items.length ? `<p class="empty-state">Aucun fichier ne correspond.</p>`
    : names.map((d) => `<details class="cloud-folder" open>
        <summary><span class="folder-ico" aria-hidden="true"></span>${esc(d)} <span class="muted">(${groups[d].length})</span></summary>
        <ul class="list cloud-files">${groups[d].map((f) => {
          const k = fileKind(f.nom, f.type);
          return `<li><button type="button" class="item cloud-item" data-cloud="${esc(f.id)}">
            <span class="file-ico k-${k}" aria-hidden="true">${KIND_LABEL[k]}</span>
            <span class="cloud-txt"><span class="t">${esc(f.nom)}</span>
            <span class="m">${esc(sizeTxt(f.taille || 0))} · ${esc(fmtDate((f.cree || "").slice(0, 10)))}</span></span></button></li>`;
        }).join("")}</ul></details>`).join("");
  $("#cloud-list").querySelectorAll("[data-cloud]").forEach((b) => { b.onclick = () => openCloud(b.dataset.cloud, b); });
};

/* ---------- Ouvrir un fichier ---------- */
async function cloudBytes(f) {
  if (cloudCache[f.id]) return cloudCache[f.id];
  const r = await gh(`/contents/cloud/${encodeURIComponent(f.id)}.enc?ref=main&t=${Date.now()}`,
    { headers: { Accept: "application/vnd.github.raw" }, cache: "no-store" });
  if (r.status === 404) throw new Error("fichier introuvable (peut-être encore en cours d'envoi, réessaie dans une minute)");
  if (!r.ok) throw new Error(r.status === 401 ? "jeton GitHub refusé" : `GitHub ne répond pas (${r.status})`);
  const { bytes } = await decryptUpload(await r.arrayBuffer());
  return (cloudCache[f.id] = { bytes, type: f.type || "application/octet-stream" });
}

let cloudUrl = null;
async function openCloud(id, button) {
  const f = (window.persoCloud?.() || []).find((x) => x.id === id);
  if (!f) return;
  if (!store.get(TOKEN_KEY)) { $("#cloud-msg").textContent = "Ajoute ton jeton GitHub (onglet Micro, Réglages) pour ouvrir tes fichiers."; return; }
  button?.setAttribute("aria-busy", "true");
  let data;
  try { data = await cloudBytes(f); }
  catch (e) { $("#cloud-msg").textContent = `${f.nom} : ${e.message}`; return; }
  finally { button?.removeAttribute("aria-busy"); }
  if (cloudUrl) URL.revokeObjectURL(cloudUrl);
  const k = fileKind(f.nom, f.type);
  const type = k === "pdf" ? "application/pdf" : data.type;
  cloudUrl = URL.createObjectURL(new Blob([data.bytes], { type }));
  const isApp = !!window.Capacitor?.isNativePlatform?.();
  const preview = k === "img" ? `<img class="cloud-img" src="${cloudUrl}" alt="${esc(f.nom)}">`
    : k === "pdf" && !isApp ? `<iframe class="cloud-pdf" src="${cloudUrl}" title="${esc(f.nom)}"></iframe>`
    : `<p class="muted">Pas d'aperçu ici pour ce type de fichier : ouvre-le avec le bouton ci-dessus.</p>`;
  openReader(f.nom, `<p class="meta">${esc(f.dossier || "Divers")} · ${esc(sizeTxt(f.taille || data.bytes.length))} · ajouté ${esc(fmtDate((f.cree || "").slice(0, 10)))}</p>
    <div class="row tight">
      <button type="button" class="btn primary" id="cloud-open">${isApp ? "Ouvrir / Enregistrer" : "Télécharger"}</button>
      <button type="button" class="btn" id="cloud-fiche">Créer une fiche avec</button>
      <button type="button" class="btn" id="cloud-move">Changer de dossier</button>
    </div>
    <p id="cloud-note" class="small muted" aria-live="polite"></p>
    <div id="cloud-r" hidden><p id="cloud-r-msg" class="small muted" aria-live="polite"></p><progress id="cloud-r-bar" max="1" value="0"></progress></div>
    ${preview}
    ${deleteZoneCloud()}`);
  $("#cloud-open").onclick = async () => saveFile(await toBase64(new Blob([data.bytes])), f.nom, type);
  $("#cloud-fiche").onclick = async () => {
    const matiere = f.dossier && f.dossier !== "Divers" ? f.dossier : prompt("Pour quelle matière ?", "") || "";
    if (!matiere.trim()) return;
    $("#cloud-fiche").disabled = true;
    try {
      await send({ id: newId(), kind: "notes", matiere: matiere.trim(), date: new Date().toISOString().slice(0, 10),
        files: [{ name: f.nom, type, size: data.bytes.length }], texte: "" }, data.bytes.buffer.slice(data.bytes.byteOffset, data.bytes.byteOffset + data.bytes.byteLength), "cloud-r");
      $("#cloud-note").textContent = "Envoyé : la fiche arrive dans Révisions dans quelques minutes.";
    } catch (e) { $("#cloud-note").textContent = `Échec : ${e.message}`; $("#cloud-fiche").disabled = false; }
  };
  $("#cloud-move").onclick = () => {
    const d = prompt("Nouveau dossier :", f.dossier || "Divers");
    if (d == null || !d.trim()) return;
    window.saveCloud({ ...f, dossier: d.trim() });
    $("#cloud-note").textContent = `Rangé dans « ${d.trim()} ».`;
  };
  wireCloudDelete(f);
}

function deleteZoneCloud() {
  return `<div class="row danger-zone"><button type="button" class="btn danger" id="cloud-del">Supprimer ce fichier</button>
    <span id="cloud-del-msg" class="small muted" aria-live="polite"></span></div>`;
}

function wireCloudDelete(f) {
  let armed = 0;
  $("#cloud-del").onclick = async () => {
    const btn = $("#cloud-del"), msg = $("#cloud-del-msg");
    if (Date.now() - armed > 4000) {
      armed = Date.now();
      btn.textContent = "Confirmer la suppression";
      msg.textContent = "Appuie encore une fois pour supprimer définitivement.";
      return;
    }
    btn.disabled = true;
    msg.textContent = "Suppression…";
    try {
      const path = `/contents/cloud/${encodeURIComponent(f.id)}.enc`;
      const info = await gh(`${path}?ref=main&t=${Date.now()}`, { cache: "no-store" });
      if (info.ok) {
        const r = await gh(path, { method: "DELETE", body: JSON.stringify({ message: "Suppression", sha: (await info.json()).sha, branch: "main" }) });
        if (!r.ok) throw new Error(`suppression refusée (${r.status})`);
      } else if (info.status !== 404) throw new Error(`GitHub ne répond pas (${info.status})`);
      window.delCloud(f.id);
      delete cloudCache[f.id];
      closeReader();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Supprimer ce fichier";
      msg.textContent = `Échec : ${e.message}`;
    }
  };
}
