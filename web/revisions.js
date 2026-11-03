"use strict";
/* Onglet Révisions : enregistrer / importer un cours, l'envoyer (chiffré) à GitHub,
   afficher les fiches de cours, les fiches de révision et les QCM.
   Utilise DATA, store, esc, fmtTime, cleanCourse, events, load définis dans app.js. */

const TOKEN_KEY = "ecam-gh-token";
const PENDING_KEY = "ecam-pending";
const MAX_MB = 70;
const ITER = 250000;

const repo = () => window.REPO || "Toto-240/mon-ecam";
const pending = {
  all: () => { try { return JSON.parse(store.get(PENDING_KEY)) || []; } catch { return []; } },
  save: (list) => store.set(PENDING_KEY, JSON.stringify(list)),
  add(item) { this.save([...this.all(), item]); },
  remove(id) { this.save(this.all().filter((p) => p.id !== id)); },
};
const newId = () => new Date().toISOString().replace(/\D/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 6);
const todayIso = () => { const d = new Date(NOW); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = (iso) => iso ? new Date(iso + (iso.length === 10 ? "T12:00" : "")).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) : "";

/* ---------- Markdown (tout est échappé d'abord) ---------- */
// Formules LaTeX simples -> texte lisible (exposants, indices, fractions, symboles)
const TEX = { "\\times": "×", "\\cdot": "·", "\\leq": "≤", "\\le": "≤", "\\geq": "≥", "\\ge": "≥", "\\neq": "≠",
  "\\approx": "≈", "\\infty": "∞", "\\pm": "±", "\\to": "→", "\\rightarrow": "→", "\\Rightarrow": "⇒",
  "\\leftarrow": "←", "\\Leftrightarrow": "⇔", "\\in": "∈", "\\sum": "∑", "\\prod": "∏", "\\int": "∫",
  "\\alpha": "α", "\\beta": "β", "\\gamma": "γ", "\\delta": "δ", "\\Delta": "Δ", "\\lambda": "λ", "\\mu": "μ",
  "\\pi": "π", "\\sigma": "σ", "\\theta": "θ", "\\omega": "ω", "\\Omega": "Ω", "\\%": "%", "\\,": " ", "\;": " ",
  "\\left": "", "\\right": "", "\\log": "log", "\\ln": "ln", "\\mod": "mod", "\\land": "∧", "\\lor": "∨",
  "\\neg": "¬", "\\oplus": "⊕", "\\forall": "∀", "\\exists": "∃", "\\emptyset": "∅", "\\cup": "∪", "\\cap": "∩" };
function tex(s) {
  let x = s;
  for (let i = 0; i < 3; i++) {
    x = x.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)").replace(/\\sqrt\{([^{}]*)\}/g, "√($1)")
      .replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, "$1");
  }
  x = x.replace(/\\[A-Za-z]+|\\[%,;]/g, (m) => (m in TEX ? TEX[m] : m.slice(1)));
  x = x.replace(/\^\{([^{}]*)\}/g, "<sup>$1</sup>").replace(/\^(\w)/g, "<sup>$1</sup>")
    .replace(/_\{([^{}]*)\}/g, "<sub>$1</sub>").replace(/_(\w)/g, "<sub>$1</sub>");
  return x.replace(/[{}]/g, "");
}

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`); // le code n'est pas retouché
  s = s.replace(/\$\$([^$]+)\$\$/g, (_, m) => `<span class="math">${tex(m)}</span>`)
    .replace(/\$([^$\n]+?)\$/g, (_, m) => `<span class="math">${tex(m)}</span>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}

function md(src) {
  const lines = esc(src || "").replace(/\r/g, "").split("\n");
  let html = "", para = [], code = null, quote = [];
  const stack = []; // listes ouvertes : { type, indent }
  const flushPara = () => { if (para.length) { html += `<p>${inline(para.join(" "))}</p>`; para = []; } };
  const closeLists = (indent = -1) => {
    while (stack.length && stack[stack.length - 1].indent > indent) html += `</li></${stack.pop().type}>`;
  };
  const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const flushQuote = () => { if (quote.length) { html += `<blockquote>${md(unesc(quote.join("\n")))}</blockquote>`; quote = []; } };
  const cells = (row) => row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      if (code === null) { flushPara(); closeLists(); flushQuote(); code = []; }
      else { html += `<pre><code>${code.join("\n")}</code></pre>`; code = null; }
      continue;
    }
    if (code !== null) { code.push(line); continue; }

    if (/^\s*&gt;\s?/.test(line)) { flushPara(); closeLists(); quote.push(line.replace(/^\s*&gt;\s?/, "")); continue; }
    flushQuote();

    // tableau : ligne d'en-tête suivie de |---|---|
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flushPara(); closeLists();
      const head = cells(line);
      let rows = "";
      i += 2;
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
        rows += `<tr>${cells(lines[i]).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`;
        i++;
      }
      i--;
      html += `<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
      continue;
    }

    let m;
    if ((m = line.match(/^\s*(#{1,6})\s+(.*)/))) {
      flushPara(); closeLists();
      const n = Math.min(m[1].length, 4);
      html += `<h${n}>${inline(m[2].replace(/\s*#+\s*$/, ""))}</h${n}>`;
    } else if ((m = line.match(/^(\s*)([-*+•]|\d+[.)])\s+(.*)/))) {
      flushPara();
      const indent = m[1].replace(/\t/g, "    ").length, type = /\d/.test(m[2]) ? "ol" : "ul";
      closeLists(indent);
      const top = stack[stack.length - 1];
      if (top && top.indent === indent && top.type !== type) { html += `</li></${stack.pop().type}>`; }
      const cur = stack[stack.length - 1];
      if (!cur || cur.indent < indent) { html += `<${type}><li>`; stack.push({ type, indent }); }
      else html += `</li><li>`;
      html += inline(m[3]);
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara(); closeLists(); html += "<hr>";
    } else if (/^\s*\$\$.*\$\$\s*$/.test(line)) {
      flushPara(); closeLists();
      html += `<div class="math block">${tex(line.trim().slice(2, -2))}</div>`;
    } else if (!line.trim()) {
      flushPara();
      // une ligne vide ne ferme pas une liste si elle continue juste après
      if (!(lines[i + 1] && /^\s*([-*+•]|\d+[.)])\s+/.test(lines[i + 1]))) closeLists();
    } else if (stack.length && /^\s{2,}\S/.test(line)) {
      html += " " + inline(line.trim()); // suite d'un élément de liste
    } else {
      closeLists(); para.push(line.trim()); flushPara(); // une ligne = un paragraphe (questions / réponses)
    }
  }
  flushPara(); closeLists(); flushQuote();
  if (code !== null) html += `<pre><code>${code.join("\n")}</code></pre>`;
  return html;
}

/* ---------- Matières ---------- */
function matieres() {
  const set = new Set();
  events().forEach((e) => { if (["CM", "TD", "TP", "DS"].includes(e.type)) set.add(e.matiere); });
  (DATA.cours || []).forEach((c) => set.add(cleanCourse(c.nom)));
  (DATA.fiches || []).forEach((f) => f.matiere && set.add(f.matiere));
  return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, "fr"));
}

function guessMatiere() {
  const now = NOW, evs = events().filter((e) => e.type !== "Événement");
  const cur = evs.find((e) => e.d0 <= now && now < e.d1);
  if (cur) return cur.matiere;
  const ended = evs.filter((e) => e.d1 <= now && now - e.d1 < 3 * 3600e3).pop();
  return ended?.matiere || "";
}

function fillForm(force) {
  const sel = $("#f-matiere");
  const keep = force || sel.value || guessMatiere();
  sel.innerHTML = `<option value="">Choisis la matière</option>` +
    matieres().map((m) => `<option${m === keep ? " selected" : ""}>${esc(m)}</option>`).join("");
  if (!$("#f-date").value) $("#f-date").value = todayIso();
  fillLinks(sel.value, $("#f-date").value);
}

/* ---------- Relier à un cours : créneau du planning et support Moodle ---------- */
const hm = (iso) => String(iso || "").slice(11, 16);
const sameMatiere = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

function slotsFor(matiere, date) {
  const day = events().filter((e) => e.debut.slice(0, 10) === date && ["CM", "TD", "TP", "DS"].includes(e.type) && !e.perso);
  const mine = day.filter((e) => sameMatiere(e.matiere, matiere));
  return mine.length ? mine : day;
}

function supportsFor(matiere) {
  return (DATA.fiches || []).filter((f) => (f.source === "moodle" || f.source === "complete") && sameMatiere(f.matiere, matiere))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (a.titre || "").localeCompare(b.titre || "", "fr"));
}

/* Remplit les listes « cours du planning » et « support Moodle » */
function fillLinks(matiere, date) {
  const slots = slotsFor(matiere, date);
  const cs = $("#f-creneau"), keepSlot = cs.value;
  // par défaut : le cours en ce moment (ou qui vient de finir), sinon le seul cours de la matière ce jour-là
  const auto = slots.find((e) => e.d0 <= NOW && NOW < e.d1) || slots.filter((e) => e.d1 <= NOW && NOW - e.d1 < 3 * 3600e3).pop()
    || (slots.filter((e) => sameMatiere(e.matiere, matiere)).length === 1 ? slots.find((e) => sameMatiere(e.matiere, matiere)) : null);
  const pick = slots.some((e) => e.debut === keepSlot) ? keepSlot : auto?.debut || "";
  cs.innerHTML = `<option value="">${slots.length ? "Aucun" : "Aucun cours ce jour-là"}</option>` + slots.map((e) =>
    `<option value="${esc(e.debut)}"${e.debut === pick ? " selected" : ""}>${esc(`${fmtTime(e.d0)}–${fmtTime(e.d1)} ${e.type} ${e.matiere}${e.salle ? ", " + e.salle : ""}`)}</option>`).join("");
  fillSupports($("#f-support"), matiere);
}

function fillSupports(sel, matiere) {
  const keep = sel.value;
  const list = supportsFor(matiere);
  sel.innerHTML = `<option value="">${list.length ? "Aucun (fiche à part)" : "Aucun support Moodle pour cette matière"}</option>` +
    list.map((f) => `<option value="${esc(f.id)}"${f.id === keep ? " selected" : ""}>${esc((f.doc || f.titre || "Support").slice(0, 70))}${f.source === "complete" ? " (déjà complété)" : ""}</option>`).join("");
  sel.disabled = !list.length;
}

/* Ce qu'on joint à l'envoi */
function linkMeta() {
  const creneau = $("#f-creneau").value, support = $("#f-support").value;
  return { ...(creneau && { creneau, heure: hm(creneau) }), ...(support && { support }) };
}

$("#f-matiere").addEventListener("change", () => fillLinks($("#f-matiere").value, $("#f-date").value));
$("#f-date").addEventListener("change", () => fillLinks($("#f-matiere").value, $("#f-date").value));
$("#f-creneau").addEventListener("change", () => {
  // choisir un cours d'une autre matière met la matière à jour
  const e = events().find((x) => x.debut === $("#f-creneau").value);
  if (e && !sameMatiere(e.matiere, $("#f-matiere").value) && matieres().includes(e.matiere)) {
    $("#f-matiere").value = e.matiere;
    fillSupports($("#f-support"), e.matiere);
  }
});

/* ---------- Chiffrement de l'envoi (même format que crypto_util.py) ---------- */
async function encryptUpload(meta, audio) {
  const pw = store.get("ecam-pw");
  if (!pw) throw new Error("mot de passe de l'appli introuvable, recharge l'appli");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const head = new TextEncoder().encode(JSON.stringify(meta) + "\n");
  const plain = new Uint8Array(head.length + audio.byteLength);
  plain.set(head, 0); plain.set(new Uint8Array(audio), head.length);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  return new Blob([new TextEncoder().encode("MEC1"), salt, iv, ct]);
}

const toBase64 = (blob) => new Promise((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1]);
  r.onerror = () => ko(new Error("lecture du fichier impossible"));
  r.readAsDataURL(blob);
});

/* ---------- GitHub ---------- */
function gh(path, opts = {}) {
  return fetch(`https://api.github.com/repos/${repo()}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${store.get(TOKEN_KEY)}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
  });
}

async function ensureInbox() {
  if ((await gh("/git/ref/heads/inbox")).ok) return;
  const main = await gh("/git/ref/heads/main");
  if (!main.ok) throw new Error(main.status === 401 ? "jeton GitHub refusé" : `GitHub ne répond pas (${main.status})`);
  const sha = (await main.json()).object.sha;
  const r = await gh("/git/refs", { method: "POST", body: JSON.stringify({ ref: "refs/heads/inbox", sha }) });
  if (!r.ok && r.status !== 422) throw new Error(`création de la boîte impossible (${r.status})`);
}

function putFile(id, b64, onProgress) {
  return new Promise((ok, ko) => {
    const x = new XMLHttpRequest();
    x.open("PUT", `https://api.github.com/repos/${repo()}/contents/inbox/${id}.bin`);
    x.setRequestHeader("Authorization", `Bearer ${store.get(TOKEN_KEY)}`);
    x.setRequestHeader("Accept", "application/vnd.github+json");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => (x.status >= 200 && x.status < 300 ? ok() : ko(new Error(
      x.status === 401 || x.status === 403 ? "jeton GitHub refusé ou sans droit d'écriture" :
      x.status === 413 || x.status === 422 ? "fichier trop gros pour GitHub" : `envoi refusé (${x.status})`)));
    x.onerror = () => ko(new Error("pas de connexion Internet"));
    x.send(JSON.stringify({ message: "Nouvel envoi", content: b64, branch: "inbox" }));
  });
}

async function send(meta, audio, ui = "upload") {
  if (!store.get(TOKEN_KEY)) {
    showPane("enregistrer");
    $("#setup").open = true;
    $("#setup").scrollIntoView({ behavior: "smooth" });
    alertForm("Ajoute d'abord ton jeton GitHub ci-dessous (une seule fois par appareil).");
    throw new Error("ajoute d'abord ton jeton GitHub dans les réglages");
  }
  const box = $(`#${ui}`) || $(`#${ui}-sheet`), bar = $(`#${ui}-bar`), msg = $(`#${ui}-msg`);
  box.hidden = false; bar.value = 0;
  try {
    msg.textContent = "Chiffrement…";
    const blob = await encryptUpload(meta, audio);
    msg.textContent = "Préparation…";
    const b64 = await toBase64(blob);
    await ensureInbox();
    msg.textContent = `Envoi (${(blob.size / 1e6).toFixed(1)} Mo)…`;
    await putFile(meta.id, b64, (p) => { bar.value = p; });
    pending.add({ id: meta.id, kind: meta.kind, matiere: meta.matiere, titre: meta.titre, date: meta.date, ds: meta.ds, at: new Date().toISOString() });
    msg.textContent = meta.kind === "revision" ? "Demande envoyée. La fiche de révision arrive dans quelques minutes."
      : meta.kind?.startsWith("devoir") ? "Envoyé. Le devoir fait arrive dans quelques minutes, dans la liste ci-dessous."
      : meta.kind === "notes" ? "Envoyé. La fiche arrive dans quelques minutes (onglet Révisions et sur le planning)."
      : "Envoyé. Ta fiche sera prête dans quelques minutes.";
    bar.value = 1;
    setTimeout(() => { box.hidden = true; if (ui === "add") document.body.style.overflow = ""; }, ui === "add" ? 2500 : 6000);
    window.renderRevisions?.();
    window.renderDevoirsIA?.();
    watchPending();
  } catch (e) {
    msg.textContent = `Échec : ${e.message}`;
    throw e;
  }
}

/* ---------- Import d'un fichier (Dictaphone…) ---------- */
$("#f-audio").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  const matiere = $("#f-matiere").value;
  if (!matiere) { alertForm("Choisis d'abord la matière."); return; }
  if (file.size > MAX_MB * 1e6) { alertForm(`Fichier trop gros (${Math.round(file.size / 1e6)} Mo, maximum ${MAX_MB} Mo).`); return; }
  try {
    await send({ id: newId(), kind: "cours", matiere, date: $("#f-date").value, nom: file.name, type: file.type, ...linkMeta() },
      await file.arrayBuffer());
  } catch {}
});

function alertForm(text) {
  const box = $("#upload");
  box.hidden = false;
  $("#upload-msg").textContent = text;
  $("#upload-bar").value = 0;
}

/* ---------- Enregistrement dans l'appli ---------- */
let rec = null;
const MIME = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"]
  .find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || "";

const idb = {
  open: () => new Promise((ok, ko) => {
    const r = indexedDB.open("mon-ecam", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("rec");
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  }),
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((ok, ko) => {
      const tx = db.transaction("rec", mode), req = fn(tx.objectStore("rec"));
      tx.oncomplete = () => ok(req?.result); tx.onerror = () => ko(tx.error);
    });
  },
  put: (k, v) => idb.run("readwrite", (s) => s.put(v, k)).catch(() => {}),
  get: (k) => idb.run("readonly", (s) => s.get(k)).catch(() => null),
  del: (k) => idb.run("readwrite", (s) => s.delete(k)).catch(() => {}),
};

async function wakeLock() {
  try { rec.lock = await navigator.wakeLock?.request("screen"); } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (rec && document.visibilityState === "visible") wakeLock();
});

/* Enregistreur natif de l'appli iPhone : continue écran verrouillé.
   Absent dans Safari ou dans une ancienne version de l'appli : on utilise alors le micro de la page. */
const REC_META = "ecam-rec-meta";
const Dicta = (() => {
  try { return window.Capacitor?.isNativePlatform?.() ? window.Capacitor.registerPlugin("Dicta") : null; }
  catch { return null; }
})();
const notImplemented = (e) => /not implemented|unimplemented|not available/i.test(String(e?.message || e));

function fmtDuration(s) {
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return `${h ? h + ":" : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function showLive(r) {
  rec = r;
  $("#rec-live").hidden = false; $("#new-form").hidden = true; $("#rec-dot").hidden = false;
  $("#rec-what").textContent = r.matiere;
  $("#rec-hint").textContent = r.native
    ? "Tu peux verrouiller l'iPhone : l'enregistrement continue. À la fin du cours, rouvre l'appli et appuie sur Terminer."
    : "Garde l'appli ouverte et l'écran allumé (tu peux baisser la luminosité). À la fin du cours, appuie sur Terminer.";
  r.acc = r.acc || 0;                       // durée déjà enregistrée avant la dernière pause (ms)
  if (r.since === undefined) r.since = r.t0;  // début du morceau en cours, null si en pause
  const tick = () => { $("#rec-time").textContent = fmtDuration(Math.floor(recElapsed(r) / 1000)); };
  tick();
  r.timer = setInterval(tick, 500);
  showPaused(r);
}

const recElapsed = (r) => Math.max(0, (r.acc || 0) + (r.since ? Date.now() - r.since : 0));

function showPaused(r) {
  const p = !r.since;
  $("#rec-state").textContent = p ? "Enregistrement en pause" : "Enregistrement en cours";
  $("#rec-live-dot").classList.toggle("on", !p);
  $("#rec-live-dot").classList.toggle("paused", p);
  $("#rec-pause").textContent = p ? "Reprendre" : "Pause";
  $("#rec-pause").classList.toggle("primary", p);
  $("#rec-dot").hidden = p;
}

function saveNativeMeta(r) {
  store.set(REC_META, JSON.stringify({ t0: r.t0, matiere: r.matiere, date: r.date, id: r.id, acc: r.acc, since: r.since,
    heure: r.heure, creneau: r.creneau, support: r.support }));
}

$("#rec-pause").onclick = async () => {
  const r = rec;
  if (!r) return;
  const b = $("#rec-pause");
  b.disabled = true;
  try {
    if (r.since) {          // pause
      if (r.native) await Dicta.pause(); else r.mr.pause();
      r.acc = recElapsed(r);
      r.since = null;
    } else {                // reprise
      if (r.native) await Dicta.resume(); else r.mr.resume();
      r.since = Date.now();
    }
    if (r.native) saveNativeMeta(r);
    showPaused(r);
  } catch (e) {
    $("#rec-hint").textContent = notImplemented(e)
      ? "La pause demande la dernière version de l'appli iPhone (à réinstaller avec Sideloadly). L'enregistrement continue."
      : `Pause impossible : ${e.message || e}`;
  }
  b.disabled = false;
};

function hideLive() {
  if (rec?.timer) clearInterval(rec.timer);
  rec = null;
  $("#rec-live").hidden = true; $("#new-form").hidden = false; $("#rec-dot").hidden = true;
  $("#rec-time").textContent = "0:00";
}

window.startRecording = async function (matiere) {
  if (rec) return;
  fillForm(matiere);
  matiere = matiere || $("#f-matiere").value;
  if (!matiere) { alertForm("Choisis d'abord la matière."); return; }
  const base = { t0: Date.now(), matiere, date: $("#f-date").value || todayIso(), id: newId(), ...linkMeta() };

  if (Dicta) {
    try {
      await Dicta.start();
      const r = { ...base, native: true, acc: 0, since: base.t0 };
      saveNativeMeta(r);
      showLive(r);
      return;
    } catch (e) {
      if (!notImplemented(e)) { alertForm(`${e.message || e}. Autorise le micro pour Mon ECAM dans les Réglages de l'iPhone.`); return; }
    }
  }

  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    alertForm("L'enregistrement n'est pas possible ici. Utilise le Dictaphone puis « Importer un enregistrement ».");
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } });
  } catch {
    alertForm("Accès au micro refusé. Autorise le micro pour Mon ECAM dans les Réglages de l'iPhone.");
    return;
  }
  const mr = new MediaRecorder(stream, { ...(MIME && { mimeType: MIME }), audioBitsPerSecond: 32000 });
  const r = { ...base, mr, stream, chunks: [] };
  mr.ondataavailable = (e) => {
    if (!e.data.size) return;
    r.chunks.push(e.data);
    idb.put("current", { meta: { id: r.id, matiere: r.matiere, date: r.date, mime: mr.mimeType,
      heure: r.heure, creneau: r.creneau, support: r.support }, chunks: r.chunks });
  };
  mr.start(30000); // sauvegarde toutes les 30 s, en cas de fermeture
  showLive(r);
  await wakeLock();
};

async function stopRecording() {
  if (!rec) return null;
  const r = rec;
  r.duree = recElapsed(r);
  r.acc = r.duree; r.since = null;
  if (r.native) {
    try { r.size = (await Dicta.stop()).size; } catch { r.size = 0; }
    hideLive();
    return r;
  }
  return new Promise((ok) => {
    r.mr.onstop = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      r.lock?.release?.().catch(() => {});
      hideLive();
      ok(r);
    };
    r.mr.stop();
  });
}

/* Récupère le fichier natif par morceaux de 1 Mo. */
async function readNative() {
  const parts = [];
  for (let offset = 0; ; ) {
    const { data, eof } = await Dicta.read({ offset, length: 1_000_000 });
    const bytes = unb64(data);
    parts.push(bytes);
    offset += bytes.length;
    if (eof || !bytes.length) break;
  }
  return await new Blob(parts).arrayBuffer();
}

async function sendNative(meta) {
  alertForm("Récupération de l'enregistrement…");
  const audio = await readNative();
  if (!audio.byteLength) throw new Error("enregistrement vide");
  await send({ id: meta.id, kind: "cours", matiere: meta.matiere, date: meta.date, type: "audio/mp4",
    heure: meta.heure, creneau: meta.creneau, support: meta.support,
    duree_s: Math.round((meta.since === undefined ? Date.now() - meta.t0 : recElapsed(meta)) / 1000) }, audio);
  await Dicta.discard();
  store.del(REC_META);
}

$("#rec-start").onclick = () => window.startRecording($("#f-matiere").value);
$("#rec-cancel").onclick = async () => {
  if (!confirmSafe("Supprimer cet enregistrement ?")) return;
  const r = await stopRecording();
  if (r?.native) { await Dicta.discard().catch(() => {}); store.del(REC_META); }
  else await idb.del("current");
};
$("#rec-stop").onclick = async () => {
  const r = await stopRecording();
  if (!r) return;
  try {
    if (r.native) return await sendNative(r);
    const blob = new Blob(r.chunks, { type: r.mr.mimeType || MIME });
    await send({ id: r.id, kind: "cours", matiere: r.matiere, date: r.date, type: blob.type,
      heure: r.heure, creneau: r.creneau, support: r.support,
      duree_s: Math.round(r.duree / 1000) }, await blob.arrayBuffer());
    await idb.del("current");
  } catch {
    offerRecovery();
  }
};

// Un window.confirm bloquerait l'appli iPhone : bouton à deux temps à la place.
let confirmArmed = 0;
function confirmSafe(text) {
  if (Date.now() - confirmArmed < 4000) { confirmArmed = 0; return true; }
  confirmArmed = Date.now();
  alertForm(`${text} Appuie une deuxième fois pour confirmer.`);
  return false;
}

window.recordingActive = () => !!rec || !!store.get(REC_META);

/* Statut de l'enregistreur natif ; juste après un rechargement de la page,
   le pont avec l'appli peut mettre un instant à répondre : on réessaie. */
async function nativeStatus() {
  for (let i = 0; i < 6; i++) {
    const st = await Promise.race([Dicta.status(), new Promise((ok) => setTimeout(() => ok(null), 1500))]).catch(() => null);
    if (st) return st;
    await new Promise((ok) => setTimeout(ok, 500));
  }
  return null;
}

let recovering = false;
async function offerRecovery() {
  if (recovering) return;
  recovering = true;
  try { await recover(); } finally { recovering = false; }
}
// en revenant dans l'appli (écran déverrouillé), on revérifie qu'un enregistrement n'a pas été perdu de vue
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !rec && store.get(REC_META)) offerRecovery();
});

async function recover() {
  if (Dicta && !rec) {
    let meta = null;
    try { meta = JSON.parse(store.get(REC_META)); } catch {}
    const st = meta ? await nativeStatus() : await Dicta.status().catch(() => null);
    if (meta && !st) {
      // l'appli ne répond pas encore : on garde l'enregistrement, nouvel essai au prochain retour
      alertForm(`Enregistrement de ${meta.matiere} en cours : reviens sur l'onglet Micro dans un instant.`);
      setTimeout(offerRecovery, 3000);
      return;
    }
    if (st?.recording && meta) {
      // l'appli a été rechargée pendant le cours : on reprend l'affichage (et l'état pause)
      if (meta.since === undefined) { meta.acc = 0; meta.since = meta.t0; }
      if (st.paused && meta.since) { meta.acc = recElapsed(meta); meta.since = null; }
      if (!st.paused && !meta.since) meta.since = Date.now();
      showLive({ ...meta, native: true });
      return;
    }  // l'appli a été rechargée pendant le cours
    if (st && !st.recording && !st.size && meta) store.del(REC_META);  // plus rien à récupérer
    if (st && !st.recording && st.size > 0 && meta) {
      $("#upload").hidden = false;
      $("#upload-bar").value = 0;
      $("#upload-msg").innerHTML = `Un enregistrement de <b>${esc(meta.matiere)}</b> n'a pas été envoyé.
        <div class="row"><button type="button" class="btn primary small" id="rec-resend">Envoyer</button>
        <button type="button" class="btn small" id="rec-drop">Supprimer</button></div>`;
      $("#rec-resend").onclick = () => sendNative(meta).catch(() => {});
      $("#rec-drop").onclick = async () => { await Dicta.discard(); store.del(REC_META); $("#upload").hidden = true; };
      return;
    }
  }
  const saved = await idb.get("current");
  if (!saved?.chunks?.length || rec) return;
  const box = $("#upload");
  box.hidden = false;
  $("#upload-bar").value = 0;
  $("#upload-msg").innerHTML = `Un enregistrement de <b>${esc(saved.meta.matiere)}</b> n'a pas été envoyé.
    <div class="row"><button type="button" class="btn primary small" id="rec-resend">Envoyer</button>
    <button type="button" class="btn small" id="rec-drop">Supprimer</button></div>`;
  $("#rec-resend").onclick = async () => {
    const blob = new Blob(saved.chunks, { type: saved.meta.mime });
    try { await send({ ...saved.meta, kind: "cours", type: blob.type }, await blob.arrayBuffer()); await idb.del("current"); } catch {}
  };
  $("#rec-drop").onclick = async () => { await idb.del("current"); box.hidden = true; };
}

/* ---------- Jeton GitHub ---------- */
async function checkToken() {
  const msg = $("#token-msg");
  if (!store.get(TOKEN_KEY)) { msg.textContent = "Aucun jeton enregistré sur cet appareil."; msg.className = "small"; return false; }
  try {
    const r = await gh("");
    const j = r.ok ? await r.json() : null;
    const okPush = j?.permissions?.push;
    msg.textContent = okPush ? "Jeton valide : l'envoi des enregistrements est prêt."
      : r.status === 401 ? "Jeton refusé par GitHub (expiré ou mal copié)."
      : "Ce jeton ne peut pas écrire dans mon-ecam : vérifie la permission Contenu en Lecture et écriture.";
    msg.className = "small " + (okPush ? "ok" : "ko");
    return !!okPush;
  } catch {
    msg.textContent = "Impossible de joindre GitHub."; msg.className = "small ko"; return false;
  }
}
$("#token-save").onclick = async () => {
  const v = $("#f-token").value.trim();
  if (!v) return;
  store.set(TOKEN_KEY, v);
  $("#f-token").value = "";
  $("#token-del").hidden = false;
  if (await checkToken()) $("#setup").open = false;
};
$("#token-del").onclick = () => { store.del(TOKEN_KEY); $("#token-del").hidden = true; checkToken(); };

/* ---------- Suivi des envois ---------- */
let watching = null;
function watchPending() {
  if (watching || !pending.all().length) return;
  watching = setInterval(async () => {
    if (!pending.all().length) { clearInterval(watching); watching = null; return; }
    if (document.visibilityState === "visible" && !rec) await load();
  }, 60000);
}

function resolvePending() {
  const fiches = new Set([...(DATA.fiches || []), ...(DATA.travaux || [])].map((f) => f.id));
  const errs = Object.fromEntries((DATA.erreurs || []).map((e) => [e.id, e]));
  const revs = DATA.revisions || [];
  const list = pending.all().filter((p) => {
    if (p.kind === "revision") return !revs.some((r) => r.matiere === p.matiere && (r.ds || null) === (p.ds || null)
      && r.cree && new Date(r.cree) > new Date(p.at) - 120e3);
    return !fiches.has(p.id);
  });
  pending.save(list);
  return list.map((p) => ({ ...p, err: errs[p.id] }));
}

function renderPending() {
  const all = resolvePending();
  renderPendingList($("#pending"), all.filter((p) => !p.kind?.startsWith("devoir")));
  renderPendingList($("#dv-pending"), all.filter((p) => p.kind?.startsWith("devoir")));
}

function renderPendingList(ul, list) {
  ul.hidden = !list.length;
  ul.innerHTML = list.map((p) => `<li class="pending${p.err ? " fail" : ""}">
    <div class="due"><span class="t">${esc(p.kind === "revision" ? "Révision : " + p.matiere : p.titre || p.matiere || "Devoir")}</span>
    <button type="button" class="btn small" data-forget="${esc(p.id)}">Retirer</button></div>
    <div class="m">${p.err ? `Échec : ${esc(p.err.message)}. Nouvel essai automatique toutes les heures.`
      : `Envoyé à ${esc(fmtTime(new Date(p.at)))}, ${p.kind?.startsWith("devoir") ? "devoir" : "fiche"} en préparation (quelques minutes).`}</div>
  </li>`).join("");
  ul.querySelectorAll("[data-forget]").forEach((b) => { b.onclick = () => { pending.remove(b.dataset.forget); renderPending(); }; });
}

/* ---------- Fiches ---------- */
const openSubjects = new Set();
function renderFiches() {
  const by = new Map();
  (DATA.fiches || []).filter((f) => f.kind === "cours").forEach((f) => {
    if (!by.has(f.matiere)) by.set(f.matiere, []);
    by.get(f.matiere).push(f);
  });
  const revs = Object.fromEntries((DATA.revisions || []).filter((r) => !r.ds).map((r) => [r.matiere, r]));
  const box = $("#matieres");
  $("#rev-intro").hidden = false;
  if (!by.size) {
    box.innerHTML = `<p class="empty-state">Pas encore de fiche. Enregistre ou importe un cours : sa fiche apparaîtra ici, rangée par matière.</p>`;
    return;
  }
  const names = [...by.keys()].sort((a, b) => a.localeCompare(b, "fr"));
  const current = [...openSubjects].reverse().find((m) => by.has(m));

  /* Toutes les matières : une tuile de couleur chacune */
  if (!current) {
    openSubjects.clear();
    box.innerHTML = `<ul class="tiles">${names.map((m) => {
      const n = by.get(m).length, r = revs[m];
      const info = [`${n} fiche${n > 1 ? "s" : ""}`, r ? "QCM prêt" : ""].filter(Boolean).join(" · ");
      return `<li><button type="button" class="tile ${tileColor(m)}" data-m="${esc(m)}">
        ${r ? `<span class="tile-badge" aria-hidden="true">QCM</span>` : ""}
        <span class="tile-name">${esc(m)}</span><span class="tile-info">${esc(info)}</span></button></li>`;
    }).join("")}</ul>`;
    box.querySelectorAll("[data-m]").forEach((b) => {
      b.onclick = () => { openSubjects.add(b.dataset.m); renderFiches(); scrollTo({ top: 0 }); };
    });
    return;
  }

  /* Une matière ouverte */
  const m = current;
  const fs = by.get(m).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const r = revs[m];
  const stale = r && r.sources < fs.length;
  $("#rev-intro").hidden = true;
  box.innerHTML = `
    <button type="button" class="back" id="rev-back">‹ Toutes les matières</button>
    <div class="tile subject-head ${tileColor(m)}">
      <span class="tile-name">${esc(m)}</span>
      <span class="tile-info">${fs.length} fiche${fs.length > 1 ? "s" : ""}${r ? ", révision prête" : ""}</span>
    </div>
    <div class="row">
      <button type="button" class="btn small${r && !stale ? "" : " primary"}" data-rev="${esc(m)}">${r ? (stale ? "Mettre à jour la révision" : "Refaire la révision") : "Créer la fiche de révision et le QCM"}</button></div>
    <ul class="list subject-list">
      ${r ? `<li class="rev"><button type="button" class="item" data-open-rev="${esc(m)}">
        <div class="t">Fiche de révision et QCM</div>
        <div class="m">${r.qcm?.length || 0} question${(r.qcm?.length || 0) > 1 ? "s" : ""}, à partir de ${r.sources} cours${stale ? " (des cours ont été ajoutés depuis)" : ""}</div>
      </button></li>` : ""}
      ${fs.map((f) => `<li><button type="button" class="item" data-open="${esc(f.id)}">
        <div class="t">${esc(f.titre || m)}</div>
        <div class="m">${f.source === "moodle" ? `D'après le support Moodle${f.date ? ", " + esc(fmtDate(f.date)) : ""}`
          : f.source === "complete" ? `Support Moodle complété par le cours du ${esc(fmtDate(f.date))}`
          : f.source === "notes" ? `${esc(fmtDate(f.date))}, d'après tes notes et photos`
          : `${esc(fmtDate(f.date))}${f.duree_min ? `, ${f.duree_min} min d'enregistrement` : ""}`}</div>
      </button></li>`).join("")}
    </ul>`;
  $("#rev-back").onclick = () => { openSubjects.clear(); renderFiches(); };
  box.querySelectorAll("[data-open]").forEach((b) => { b.onclick = () => openFiche(b.dataset.open); });
  box.querySelectorAll("[data-open-rev]").forEach((b) => { b.onclick = () => openRevision(b.dataset.openRev); });
  box.querySelectorAll("[data-rev]").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try { await send({ id: newId(), kind: "revision", matiere: b.dataset.rev }, new ArrayBuffer(0)); } catch {}
      b.disabled = false;
    };
  });
}

/* ---------- Lecteur ---------- */
let lastFocus = null;
function openReader(title, html) {
  lastFocus = document.activeElement;
  $("#reader-title").textContent = title;
  $("#reader-body").innerHTML = html;
  $("#reader").hidden = false;
  $("#reader").scrollTop = 0;
  document.body.style.overflow = "hidden";
  $("#reader-close").focus();
}
function closeReader() {
  $("#reader").hidden = true;
  document.body.style.overflow = "";
  lastFocus?.focus?.();
}
$("#reader-close").onclick = closeReader;
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#reader").hidden) closeReader(); });

function openFiche(id) {
  const f = (DATA.fiches || []).find((x) => x.id === id);
  if (!f) return;
  const meta = f.source === "moodle" ? `${esc(f.matiere)}, d'après « ${esc(f.doc || "")} » sur Moodle`
    : f.source === "complete" ? `${esc(f.matiere)}, « ${esc(f.doc || "")} » (Moodle) complété par le cours du ${esc(fmtDate(f.date))}${f.heure ? " à " + esc(f.heure) : ""}`
    : `${esc(f.matiere)}, ${esc(fmtDate(f.date))}${f.heure ? " à " + esc(f.heure) : ""}${f.source === "notes" ? ", d'après tes notes" : ""}`;
  openReader(f.matiere, `<p class="meta">${meta}</p>${md(f.md)}`);
}

function openRevision(matiere, id) {
  const revs = DATA.revisions || [];
  const r = id ? revs.find((x) => x.id === id) : revs.find((x) => x.matiere === matiere && !x.ds) || revs.find((x) => x.matiere === matiere);
  if (!r) return;
  matiere = r.matiere;
  r.qcm = (Array.isArray(r.qcm) ? r.qcm : []).filter((q) => q && Array.isArray(q.choix) && q.choix.length > 1)
    .map((q) => ({ ...q, bonne: Number(q.bonne) || 0 }));
  const qcm = (r.qcm || []).map((q, i) => `<div class="q" data-q="${i}">
    <p>${i + 1}. ${esc(q.question)}</p>
    ${q.choix.map((c, j) => `<button type="button" data-c="${j}">${esc(c)}</button>`).join("")}
    <div class="why" hidden>${esc(q.explication || "")}</div></div>`).join("");
  openReader(`Révision : ${matiere}`, `<p class="meta">${esc(matiere)}, à partir de ${r.sources} fiche${r.sources > 1 ? "s" : ""}${r.ds ? ` (pour le DS du ${esc(fmtDate(r.ds.slice(0, 10)))})` : ""}</p>${md(r.md)}
    ${qcm ? `<section class="qcm"><h2>QCM</h2><p id="score" class="score" aria-live="polite"></p>${qcm}
      <button type="button" class="btn" id="qcm-reset">Recommencer</button></section>` : ""}`);
  const body = $("#reader-body");
  let good = 0, done = 0;
  const total = r.qcm.length;
  body.querySelectorAll(".q").forEach((qEl) => {
    const q = r.qcm[+qEl.dataset.q];
    qEl.querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        if (qEl.dataset.done) return;
        qEl.dataset.done = 1; done++;
        const pick = +b.dataset.c;
        if (pick === q.bonne) good++; else b.classList.add("bad");
        qEl.querySelector(`[data-c="${q.bonne}"]`).classList.add("good");
        qEl.querySelector(".why").hidden = false;
        $("#score").textContent = done === total ? `Score : ${good}/${total}` : `${good} bonne(s) réponse(s) sur ${done}`;
      };
    });
  });
  $("#qcm-reset")?.addEventListener("click", () => openRevision(null, r.id));
}

/* ---------- Rendu ---------- */
window.renderRevisions = function () {
  fillForm();
  renderPending();
  renderFiches();
  $("#token-del").hidden = !store.get(TOKEN_KEY);
};

checkToken();
offerRecovery();
watchPending();

if (Dicta) {
  $("#form-hint").innerHTML = "Dans l'appli, l'enregistrement continue <b>même écran verrouillé</b>. Tu peux aussi importer un fichier du Dictaphone.";
}
