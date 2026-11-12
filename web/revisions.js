"use strict";
/* Onglet Révisions : enregistrer / importer un cours, l'envoyer (chiffré) à GitHub,
   afficher les fiches de cours, les fiches de révision et les QCM.
   Utilise DATA, store, esc, fmtTime, cleanCourse, events, load définis dans app.js. */

const TOKEN_KEY = "ecam-gh-token";
const PENDING_KEY = "ecam-pending";
const MAX_MB = 300;   // gros fichiers envoyés en morceaux de 20 Mo
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

/* Matière d'après l'emploi du temps : le cours en ce moment, sinon celui qui commence dans
   les 20 min, sinon celui qui vient de finir (moins de 3 h) */
function guessMatiere() {
  const now = NOW, evs = events().filter((e) => e.type !== "Événement" && !e.perso);
  const cur = evs.find((e) => e.d0 <= now && now < e.d1);
  if (cur) return cur.matiere;
  const soon = evs.find((e) => e.d0 > now && e.d0 - now <= 20 * 60e3);
  if (soon) return soon.matiere;
  const ended = evs.filter((e) => e.d1 <= now && now - e.d1 < 3 * 3600e3).pop();
  return ended?.matiere || "";
}

/* Si tu as changé toi-même la matière, la date ou le cours, ton choix est gardé 2 h (le jour même) ;
   sinon tout suit l'emploi du temps à chaque affichage */
let recManual = 0;
const recIsManual = () => recManual && Date.now() - recManual < 2 * 3600e3 && new Date(recManual).toDateString() === new Date().toDateString();
["#f-matiere", "#f-date", "#f-creneau", "#f-support"].forEach((id) =>
  document.querySelector(id)?.addEventListener("change", () => { recManual = Date.now(); }));

function fillForm(force) {
  const sel = $("#f-matiere");
  const manual = recIsManual();
  const keep = force || (manual ? sel.value : guessMatiere() || sel.value);
  sel.innerHTML = `<option value="">Choisis la matière</option>` +
    matieres().map((m) => `<option${m === keep ? " selected" : ""}>${esc(m)}</option>`).join("");
  if (!$("#f-date").value || !manual) $("#f-date").value = todayIso();
  if (!manual) { $("#f-creneau").value = ""; $("#f-support").value = ""; }
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
  const auto = slots.find((e) => e.d0 <= NOW && NOW < e.d1) || slots.find((e) => e.d0 > NOW && e.d0 - NOW <= 20 * 60e3)
    || slots.filter((e) => e.d1 <= NOW && NOW - e.d1 < 3 * 3600e3).pop()
    || (slots.filter((e) => sameMatiere(e.matiere, matiere)).length === 1 ? slots.find((e) => sameMatiere(e.matiere, matiere)) : null);
  const pick = slots.some((e) => e.debut === keepSlot) ? keepSlot : auto?.debut || "";
  cs.innerHTML = `<option value="">${slots.length ? "Aucun" : "Aucun cours ce jour-là"}</option>` + slots.map((e) =>
    `<option value="${esc(e.debut)}"${e.debut === pick ? " selected" : ""}>${esc(`${fmtTime(e.d0)}–${fmtTime(e.d1)} ${e.type} ${e.matiere}${e.salle ? ", " + e.salle : ""}`)}</option>`).join("");
  fillSupports($("#f-support"), matiere);
  updateRecHero();
}

function fillSupports(sel, matiere) {
  const keep = sel.value;
  const list = supportsFor(matiere);
  sel.innerHTML = `<option value="">${list.length ? "Aucun (fiche à part)" : "Aucun support Moodle pour cette matière"}</option>` +
    list.map((f) => `<option value="${esc(f.id)}"${f.id === keep ? " selected" : ""}>${esc((f.doc || f.titre || "Support").slice(0, 70))}${f.source === "complete" ? " (déjà complété)" : ""}</option>`).join("");
  sel.disabled = !list.length;
}

/* En-tête de l'onglet Micro : le cours qui sera enregistré, et le résumé des réglages */
function updateRecHero() {
  const m = $("#f-matiere").value;
  const slot = events().find((e) => e.debut === $("#f-creneau").value);
  const sup = $("#f-support").selectedOptions[0];
  const live = slot && slot.d0 <= NOW && NOW < slot.d1;
  const mins = slot ? Math.round((slot.d0 - NOW) / 60e3) : 0;
  $("#rec-hero-kicker").textContent = live ? "Cours en ce moment" : slot && mins > 0 && mins <= 20 ? `Commence dans ${mins} min`
    : slot ? "Cours choisi" : "Prêt à enregistrer";
  $("#rec-hero-title").textContent = m || "Choisis la matière";
  $("#rec-hero-sub").textContent = slot
    ? `${slot.type} · ${fmtTime(slot.d0)}–${fmtTime(slot.d1)}${slot.salle ? ` · salle ${slot.salle}` : ""}${slot.prof ? ` · ${slot.prof}` : ""}`
    : m ? "Pas de cours du planning choisi" : "Ouvre les réglages ci-dessous pour la choisir";
  const d = $("#f-date").value ? new Date(`${$("#f-date").value}T12:00:00`) : null;
  $("#rec-opts-sum").textContent = [m || "matière à choisir", d ? fmtDayLong(d) : "",
    $("#f-support").value && sup ? `complète « ${sup.textContent.trim()} »` : "fiche à part"].filter(Boolean).join(" · ");
  $("#new-form").classList.toggle("is-live", !!live);
  if (!m) $("#rec-opts").open = true;
}
["#f-matiere", "#f-date", "#f-creneau", "#f-support"].forEach((id) =>
  $(id).addEventListener("change", () => setTimeout(updateRecHero, 0)));

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

const PART = 8e6;   // morceaux de 8 Mo : petits envois, plus sûrs sur le réseau mobile

/* Envoie le fichier chiffré : en un seul morceau, ou en morceaux « nom.i-n.part » recollés côté GitHub.
   Chaque essai a ses propres noms de fichiers (un essai raté ne gêne pas le suivant) ; ce qu'un essai
   raté avait déjà envoyé est effacé. */
async function putBlob(id, blob, onProgress) {
  const stem = `${id}-${Math.random().toString(36).slice(2, 7)}`;
  const n = Math.ceil(blob.size / PART);
  const sent = [];
  try {
    for (let i = 0; i < n; i++) {
      const part = n === 1 ? blob : blob.slice(i * PART, Math.min(blob.size, (i + 1) * PART));
      const name = n === 1 ? `${stem}.bin` : `${stem}.${String(i).padStart(3, "0")}-${String(n).padStart(3, "0")}.part`;
      const b64 = await toBase64(part);
      for (let tries = 1; ; tries++) {
        try { sent.push({ name, sha: await putFile(name, b64, (p) => onProgress((i + p) / n)) }); break; }
        catch (e) {
          if (e.final || tries >= 5) throw e;
          await new Promise((r) => setTimeout(r, 1500 * tries));
        }
      }
    }
  } catch (e) {
    for (const f of sent) {   // ménage : sans le reste, ces morceaux ne serviraient à rien
      if (f.sha) await gh(`/contents/inbox/${f.name}`, { method: "DELETE",
        body: JSON.stringify({ message: "Envoi annulé", sha: f.sha, branch: "inbox" }) }).catch(() => {});
    }
    throw e;
  }
}

function putFile(name, b64, onProgress) {
  return new Promise((ok, ko) => {
    const x = new XMLHttpRequest();
    x.open("PUT", `https://api.github.com/repos/${repo()}/contents/inbox/${name}`);
    x.setRequestHeader("Authorization", `Bearer ${store.get(TOKEN_KEY)}`);
    x.setRequestHeader("Accept", "application/vnd.github+json");
    x.timeout = 180000;
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    const fail = (text, final = false) => { const e = new Error(text); e.final = final; ko(e); };
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) {
        let sha = null;
        try { sha = JSON.parse(x.responseText).content.sha; } catch {}
        return ok(sha);
      }
      let why = "";
      try { why = JSON.parse(x.responseText).message || ""; } catch {}
      if (x.status === 401 || x.status === 403) return fail("jeton GitHub refusé ou sans droit d'écriture", true);
      if (x.status === 413) return fail("morceau trop gros pour GitHub", true);
      fail(`envoi refusé par GitHub (${x.status}${why ? ` : ${why}` : ""})`);   // 409, 422, 5xx : on réessaie
    };
    x.onerror = () => fail("pas de connexion Internet");
    x.ontimeout = () => fail("envoi trop long (connexion lente)");
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
    await ensureInbox();
    msg.textContent = `Envoi (${(blob.size / 1e6).toFixed(1)} Mo${blob.size > PART ? `, en ${Math.ceil(blob.size / PART)} morceaux` : ""})…`;
    await putBlob(meta.id, blob, (p) => { bar.value = p; });
    pending.add({ id: meta.id, kind: meta.kind, matiere: meta.matiere, titre: meta.titre, date: meta.date, ds: meta.ds, cmid: meta.cmid, action: meta.action, at: new Date().toISOString() });
    msg.textContent = meta.kind === "carte" ? "Demande envoyée. La carte mentale arrive dans quelques minutes."
      : meta.kind === "depot" ? "Envoyé. Le dépôt sur Moodle se fait dans 1 à 3 minutes, suis-le dans À rendre."
      : meta.kind === "revision" ? "Demande envoyée. La fiche de révision arrive dans quelques minutes."
      : meta.kind?.startsWith("devoir") ? "Envoyé. Le devoir fait arrive dans quelques minutes, dans la liste ci-dessous."
      : meta.kind === "notes" ? "Envoyé. La fiche arrive dans quelques minutes (onglet Révisions et sur le planning)."
      : "Envoyé. Ta fiche sera prête dans quelques minutes.";
    bar.value = 1;
    setTimeout(() => { box.hidden = true; if (ui === "add" || ui === "depot") document.body.style.overflow = ""; }, ui === "add" || ui === "depot" ? 2500 : 6000);
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
  // d'abord le module tel que l'appli l'annonce (Capacitor.Plugins) : registerPlugin peut échouer
  // sur une page chargée depuis Internet, et l'appli retombait alors sur le micro de la page web
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return null;
    return window.Capacitor.Plugins?.Dicta || window.Capacitor.registerPlugin("Dicta");
  } catch { return window.Capacitor?.Plugins?.Dicta || null; }
})();
const notImplemented = (e) => /not implemented|unimplemented|not available/i.test(String(e?.message || e));

function fmtDuration(s) {
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return `${h ? h + ":" : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function showLive(r) {
  rec = r;
  $("#rec-live").hidden = false; $("#new-form").hidden = true; $("#rec-dot").hidden = false;
  const slot = r.creneau && events().find((e) => e.debut === r.creneau);
  $("#rec-what").textContent = slot ? `${r.matiere} · ${slot.type} ${fmtTime(slot.d0)}–${fmtTime(slot.d1)}` : r.matiere;
  $("#rec-hint").textContent = r.native
    ? "Tu peux verrouiller l'iPhone : l'enregistrement continue. À la fin du cours, rouvre l'appli et appuie sur Terminer."
    : "Garde l'appli ouverte et l'écran allumé (tu peux baisser la luminosité). À la fin du cours, appuie sur Terminer.";
  r.acc = r.acc || 0;                       // durée déjà enregistrée avant la dernière pause (ms)
  if (r.since === undefined) r.since = r.t0;  // début du morceau en cours, null si en pause
  const tick = () => { $("#rec-time").textContent = fmtDuration(Math.floor(recElapsed(r) / 1000)); };
  tick();
  r.timer = setInterval(tick, 500);
  if (r.native) r.watch = setInterval(() => checkLive(r), 10000);
  showPaused(r);
}

/* Vérifie que le micro de l'iPhone capte vraiment (sinon l'appli le relance). */
async function checkLive(r) {
  if (rec !== r || !r.since || document.visibilityState !== "visible") return;
  const st = await Dicta.status().catch(() => null);
  if (!st || st.live !== false || rec !== r || !r.since) return;
  try {
    await Dicta.resume();
    $("#rec-hint").textContent = "Le micro s'était arrêté : il a été relancé.";
  } catch (e) {
    $("#rec-hint").textContent = `⚠️ Le micro ne capte plus. Appuie sur Pause puis Reprendre. (${e.message || e})`;
  }
}

const recElapsed = (r) => Math.max(0, (r.acc || 0) + (r.since ? Date.now() - r.since : 0));

function showPaused(r) {
  const p = !r.since;
  $("#rec-state").textContent = p ? "Enregistrement en pause" : "Enregistrement en cours";
  $("#rec-live-dot").classList.toggle("on", !p);
  $("#rec-live-dot").classList.toggle("paused", p);
  $("#rec-pause .lbl").textContent = p ? "Reprendre" : "Pause";
  $("#rec-pause").classList.toggle("resume", p);
  $("#rec-live").classList.toggle("paused", p);
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
      if (!r.native && r.stream?.getAudioTracks().some((t) => t.readyState === "ended")) {
        // micro de la page coupé par l'iPhone pendant que l'appli était en arrière-plan
        $("#rec-hint").textContent = "⚠️ L'iPhone a coupé le micro quand tu as quitté l'appli. Appuie sur Terminer (ce qui a été enregistré est gardé), puis relance un enregistrement.";
        b.disabled = false;
        return;
      }
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
  if (rec?.watch) clearInterval(rec.watch);
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

  if (Dicta && store.get(REC_META) && !(await parkNative())) {
    alertForm("Un enregistrement n'a pas encore été envoyé : envoie-le ou supprime-le d'abord, sinon il serait écrasé.");
    offerRecovery();
    return;
  }
  if (!Dicta) await parkWeb();

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
    $("#rec-state").textContent = "Finalisation de l'enregistrement…";
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
async function readNative(id) {
  const parts = [];
  for (let offset = 0; ; ) {
    const { data, eof } = await Dicta.read({ offset, length: 1_000_000, ...(id && { id }) });
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
    if (r.native) { saveNativeMeta(r); return await sendNative(r); }
    const blob = new Blob(r.chunks, { type: r.mr.mimeType || MIME });
    await send({ id: r.id, kind: "cours", matiere: r.matiere, date: r.date, type: blob.type,
      heure: r.heure, creneau: r.creneau, support: r.support,
      duree_s: Math.round(r.duree / 1000) }, await blob.arrayBuffer());
    await idb.del("current");
  } catch {
    store.set(AUTO_KEY, String(Date.now()));   // pas de nouvel essai automatique tout de suite
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
  if (document.visibilityState === "visible" && !rec && (store.get(REC_META) || queueGet().length)) offerRecovery();
});
window.addEventListener("online", () => { if (!rec) offerRecovery(); });

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
    if (st && !st.recording && st.size > 0 && meta && await parkNative()) return flushQueue();
    if (st && !st.recording && st.size > 0 && meta) {   // ancienne version de l'appli iPhone
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
  if (rec) return;
  await parkWeb();
  return flushQueue();
}

/* ---------- File d'attente des enregistrements pas encore envoyés ----------
   Un enregistrement qui n'a pas pu partir est mis de côté (sur l'iPhone : dossier « attente » de l'appli ;
   dans le navigateur : IndexedDB). Rien n'est effacé avant d'être bien arrivé sur GitHub.
   La file part toute seule en revenant dans l'appli avec du réseau (au plus un essai automatique
   toutes les 10 minutes après un échec), ou avec « Envoyer maintenant ». */
const QUEUE_KEY = "ecam-rec-queue", AUTO_KEY = "ecam-rec-autofail";
function queueGet() { try { return JSON.parse(store.get(QUEUE_KEY)) || []; } catch { return []; } }
function queueSet(q) { q.length ? store.set(QUEUE_KEY, JSON.stringify(q)) : store.del(QUEUE_KEY); }
const queueDrop = (id) => queueSet(queueGet().filter((x) => x.id !== id));
const metaDuree = (m) => m.duree_s ?? Math.round((m.since === undefined ? Date.now() - m.t0 : recElapsed(m)) / 1000);

/* Enregistrement natif terminé mais pas envoyé -> file d'attente. false si impossible (ancienne appli iPhone). */
async function parkNative() {
  let meta = null;
  try { meta = JSON.parse(store.get(REC_META)); } catch {}
  if (!meta) return true;
  const st = await nativeStatus();
  if (!st || st.recording) return false;
  if (!st.size) { store.del(REC_META); return true; }
  try { await Dicta.park({ id: meta.id }); } catch { return false; }
  queueSet([...queueGet().filter((x) => x.id !== meta.id), { ...meta, duree_s: metaDuree(meta), native: true }]);
  store.del(REC_META);
  return true;
}

async function parkWeb() {
  const saved = await idb.get("current");
  if (!saved?.chunks?.length) return;
  await idb.put(`q-${saved.meta.id}`, saved);
  await idb.del("current");
  queueSet([...queueGet().filter((x) => x.id !== saved.meta.id), { ...saved.meta, web: true }]);
}

let flushing = false;
async function flushQueue(manual = false) {
  if (flushing || rec) return;
  if (!queueGet().length) return;
  if (!manual && (!navigator.onLine || !store.get(TOKEN_KEY) || Date.now() - (+store.get(AUTO_KEY) || 0) < 10 * 60e3)) {
    return showQueue();
  }
  flushing = true;
  try {
    for (const m of queueGet()) {
      if (rec) return;
      try {
        if (m.web) {
          const saved = await idb.get(`q-${m.id}`);
          if (!saved?.chunks?.length) { queueDrop(m.id); continue; }
          const blob = new Blob(saved.chunks, { type: saved.meta.mime });
          await send({ ...saved.meta, kind: "cours", type: blob.type }, await blob.arrayBuffer());
          await idb.del(`q-${m.id}`);
        } else {
          alertForm(`Envoi de l'enregistrement en attente : ${m.matiere}…`);
          let audio;
          try { audio = await readNative(m.id); }
          catch (e) { if (/introuvable/i.test(e.message || e)) { queueDrop(m.id); continue; } throw e; }
          if (!audio.byteLength) { await Dicta.discard({ id: m.id }).catch(() => {}); queueDrop(m.id); continue; }
          await send({ id: m.id, kind: "cours", matiere: m.matiere, date: m.date, type: "audio/mp4",
            heure: m.heure, creneau: m.creneau, support: m.support, duree_s: m.duree_s }, audio);
          await Dicta.discard({ id: m.id }).catch(() => {});
        }
        queueDrop(m.id);
      } catch (e) {
        store.set(AUTO_KEY, String(Date.now()));
        return showQueue(`Échec de l'envoi : ${e.message || e}`);
      }
    }
    store.del(AUTO_KEY);
  } finally { flushing = false; }
}

function showQueue(err = "") {
  const q = queueGet();
  if (!q.length || rec) return;
  const box = $("#upload");
  box.hidden = false;
  $("#upload-bar").value = 0;
  $("#upload-msg").innerHTML = `${err ? `<p class="ko">${esc(err)}</p>` : ""}
    <b>${q.length} enregistrement${q.length > 1 ? "s" : ""} en attente d'envoi</b> (gardé${q.length > 1 ? "s" : ""} sur cet appareil) :
    <ul class="rec-queue">${q.map((m) => `<li><span>${esc(m.matiere)} · ${esc(fmtDate(m.date))}${m.duree_s ? ` · ${esc(fmtDuration(m.duree_s))}` : ""}</span>
      <button type="button" class="btn small" data-qdrop="${esc(m.id)}">Supprimer</button></li>`).join("")}</ul>
    <div class="row"><button type="button" class="btn primary small" id="rec-flush">Envoyer maintenant</button></div>
    <p class="muted small">${navigator.onLine ? "Ils partiront aussi tout seuls à ta prochaine ouverture de l'appli." : "Pas de réseau : ils partiront tout seuls quand tu en auras."}</p>`;
  $("#rec-flush").onclick = () => flushQueue(true);
  box.querySelectorAll("[data-qdrop]").forEach((b) => {
    b.onclick = async () => {
      if (!b.dataset.armed) {   // en deux temps (pas de window.confirm dans l'appli iPhone)
        b.dataset.armed = "1"; b.textContent = "Confirmer ?"; b.classList.add("danger");
        setTimeout(() => { delete b.dataset.armed; b.textContent = "Supprimer"; b.classList.remove("danger"); }, 4000);
        return;
      }
      const m = queueGet().find((x) => x.id === b.dataset.qdrop);
      if (m?.web) await idb.del(`q-${m.id}`); else if (m) await Dicta?.discard({ id: m.id }).catch(() => {});
      queueDrop(b.dataset.qdrop);
      queueGet().length ? showQueue() : (box.hidden = true);
    };
  });
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
  const fiches = new Set([...(DATA.fiches || []), ...(DATA.travaux || []), ...(DATA.depots || []), ...(DATA.cartes || []),
    ...(DATA.dsDetectes || [])].map((f) => f.id));   // annonce de DS seule : pas de fiche, le DS est ajouté
  const errs = Object.fromEntries((DATA.erreurs || []).map((e) => [e.id, e]));
  const revs = DATA.revisions || [];
  const list = pending.all().filter((p) => {
    // révision arrivée après la demande (même matière, pour le DS ou toute la matière)
    if (p.kind === "revision") return !revs.some((r) => r.id === p.id
      || (!r.choix && sameMatiere(r.matiere, p.matiere) && r.cree && new Date(r.cree) > new Date(p.at) - 120e3));
    return !fiches.has(p.id);
  });
  pending.save(list);
  return list.map((p) => ({ ...p, err: errs[p.id] }));
}

function renderPending() {
  const all = resolvePending();
  renderPendingList($("#pending"), all.filter((p) => !p.kind?.startsWith("devoir") && p.kind !== "depot"));
  renderPendingList($("#dv-pending"), all.filter((p) => p.kind?.startsWith("devoir")));
}

function renderPendingList(ul, list) {
  ul.hidden = !list.length;
  ul.innerHTML = list.map((p) => `<li class="pending${p.err ? " fail" : ""}">
    <div class="due"><span class="t">${esc(p.kind === "revision" ? "Révision : " + p.matiere : p.kind === "carte" ? "Carte mentale : " + p.matiere : p.titre || p.matiere || "Devoir")}</span>
    <button type="button" class="btn small" data-forget="${esc(p.id)}">Retirer</button></div>
    <div class="m">${p.err ? `Échec : ${esc(p.err.message)}. Nouvel essai automatique toutes les heures.`
      : `Envoyé à ${esc(fmtTime(new Date(p.at)))}, ${p.kind?.startsWith("devoir") ? "devoir" : "fiche"} en préparation (quelques minutes).`}</div>
  </li>`).join("");
  ul.querySelectorAll("[data-forget]").forEach((b) => { b.onclick = () => { pending.remove(b.dataset.forget); renderPending(); }; });
}

/* ---------- Fiches ---------- */
const openSubjects = new Set();
/* Ouvre directement les fiches d'une matière (depuis l'accueil) */
window.openMatiere = (m) => {
  const f = (DATA.fiches || []).find((x) => sameMatiere(x.matiere, m));
  openSubjects.clear();
  if (f) openSubjects.add(f.matiere);
  showPane("revisions");
  renderFiches();
};
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function nextDsDate(m) {
  const ds = (window.upcomingExams?.() || (typeof upcomingExams === "function" ? upcomingExams() : []))
    .filter((e) => sameMatiere(e.matiere, m) && e.d0 > NOW).sort((a, b) => a.d0 - b.d0)[0];
  return ds ? isoDay(ds.d0) : isoDay(new Date(NOW.getTime() + 7 * 864e5));
}

/* ---------- Scores de QCM ---------- */
const scoresFor = (m) => (window.persoScores?.() || []).filter((x) => sameMatiere(x.matiere, m))
  .sort((a, b) => (a.quand || "").localeCompare(b.quand || ""));

/* Historique « ce qu'on a fait » de la matière (rempli sous chaque cours du planning) */
function activitesHtml(m) {
  const list = Object.entries(window.persoActivites?.() || {})
    .map(([k, v]) => { const i = k.indexOf("|"); return { debut: k.slice(0, i), matiere: k.slice(i + 1), texte: v.texte }; })
    .filter((a) => a.texte && sameMatiere(a.matiere, m))
    .sort((a, b) => b.debut.localeCompare(a.debut));
  if (!list.length) return "";
  return `<details class="progress-card act-card"${list.length <= 6 ? " open" : ""}>
    <summary>🗒️ Ce qu'on a fait en cours <span class="muted">(${list.length})</span></summary>
    <ul class="act-hist">${list.map((a) => `<li><span class="d">${esc(fmtDate(a.debut))}</span>${esc(a.texte)}</li>`).join("")}</ul>
  </details>`;
}

function progressHtml(m) {
  const sc = scoresFor(m);
  if (!sc.length) return "";
  const pct = (x) => Math.round(100 * x.good / x.total);
  const last = sc.slice(-10);
  const moy = Math.round(sc.reduce((a, x) => a + pct(x), 0) / sc.length);
  const recent = sc.slice(-3), older = sc.slice(-6, -3);
  const avg = (l) => l.reduce((a, x) => a + pct(x), 0) / l.length;
  const trend = older.length ? Math.round(avg(recent) - avg(older)) : 0;
  // questions ratées le plus souvent (et pas réussies depuis)
  const count = {};
  for (const x of sc) for (const q of x.rates || []) count[q] = (count[q] || 0) + 1;
  const top = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const color = (p) => p >= 75 ? "#3A9A4C" : p >= 50 ? "#C27410" : "#D93F3F";
  return `<details class="card progress-card">
    <summary><span class="t">📈 Tes QCM</span>
      <span class="m">${sc.length} fait${sc.length > 1 ? "s" : ""} · moyenne ${moy} %${trend ? ` · ${trend > 0 ? "▲" : "▼"} ${Math.abs(trend)} pts` : ""}</span></summary>
    <div class="bars" role="img" aria-label="Tes ${last.length} derniers scores">
      ${last.map((x) => `<div class="bar" title="${esc(fmtDate(x.quand.slice(0, 10)))} : ${x.good}/${x.total}">
        <span style="height:${Math.max(6, pct(x))}%;background:${color(pct(x))}"></span><em>${pct(x)}</em></div>`).join("")}
    </div>
    <p class="small muted">Tes ${last.length} derniers QCM, du plus ancien au plus récent (en %).</p>
    ${top.length ? `<h4>Questions que tu rates le plus</h4><ul class="missed">${top.map(([q, n]) => `<li>${esc(q)} <span class="muted">(${n}×)</span></li>`).join("")}</ul>` : ""}
  </details>`;
}

/* Choix des fiches pour une carte mentale : matière -> ensemble des fiches cochées */
const cartePick = new Map();

function renderFiches() {
  const by = new Map();
  (DATA.fiches || []).filter((f) => f.kind === "cours").forEach((f) => {
    if (!by.has(f.matiere)) by.set(f.matiere, []);
    by.get(f.matiere).push(f);
  });
  const revs = Object.fromEntries((DATA.revisions || []).filter((r) => !r.ds && !r.choix).map((r) => [r.matiere, r]));
  // révisions faites avec des fiches choisies (les plus récentes d'abord)
  const choixRevs = (m) => (DATA.revisions || []).filter((r) => r.choix && sameMatiere(r.matiere, m))
    .sort((a, b) => (b.cree || "").localeCompare(a.cree || ""));
  // révisions faites pour un DS (avec les fiches cochées), les plus récentes d'abord
  const dsRevs = (m) => (DATA.revisions || []).filter((r) => r.ds && sameMatiere(r.matiere, m))
    .sort((a, b) => (b.ds || "").localeCompare(a.ds || ""));
  const box = $("#matieres");
  $("#rev-intro").hidden = false;
  if (!by.size) {
    box.innerHTML = `<div class="row add-fiche-row"><button type="button" class="btn small primary" id="add-fiche-libre">+ Ajouter une fiche</button></div>
      <p class="empty-state">Pas encore de fiche. Enregistre ou importe un cours : sa fiche apparaîtra ici, rangée par matière.</p>`;
    $("#add-fiche-libre").onclick = () => window.openAddSheetLibre?.("");
    return;
  }
  const names = [...by.keys()].sort((a, b) => a.localeCompare(b, "fr"));
  const current = [...openSubjects].reverse().find((m) => by.has(m));

  /* Toutes les matières : une tuile de couleur chacune */
  if (!current) {
    openSubjects.clear();
    box.innerHTML = `<div class="row add-fiche-row"><button type="button" class="btn small primary" id="add-fiche-libre">+ Ajouter une fiche</button></div>
      <ul class="tiles">${names.map((m) => {
      const n = by.get(m).length, r = revs[m] || choixRevs(m)[0] || dsRevs(m)[0];
      const info = [`${n} fiche${n > 1 ? "s" : ""}`, r ? "QCM prêt" : ""].filter(Boolean).join(" · ");
      return `<li><button type="button" class="tile ${tileColor(m)}" data-m="${esc(m)}">
        ${r ? `<span class="tile-badge" aria-hidden="true">QCM</span>` : ""}
        <span class="tile-name">${esc(m)}</span><span class="tile-info">${esc(info)}</span></button></li>`;
    }).join("")}</ul>`;
    box.querySelectorAll("[data-m]").forEach((b) => {
      b.onclick = () => { openSubjects.add(b.dataset.m); renderFiches(); scrollTo({ top: 0 }); };
    });
    $("#add-fiche-libre").onclick = () => window.openAddSheetLibre?.("");
    return;
  }

  /* Une matière ouverte */
  const m = current;
  const fs = by.get(m).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const r = revs[m];
  const stale = r && r.sources < fs.length;
  const pick = cartePick.get(m);
  const cartes = (DATA.cartes || []).filter((c) => sameMatiere(c.matiere, m)).sort((a, b) => (b.cree || "").localeCompare(a.cree || ""));
  $("#rev-intro").hidden = true;
  box.innerHTML = `
    <button type="button" class="back" id="rev-back">‹ Toutes les matières</button>
    <div class="tile subject-head ${tileColor(m)}">
      <span class="tile-name">${esc(m)}</span>
      <span class="tile-info">${fs.length} fiche${fs.length > 1 ? "s" : ""}${r ? ", révision prête" : ""}</span>
    </div>
    ${pick ? `<div class="carte-pick-bar">
        <p><b>Choisis tes fiches</b> <span class="muted">(${pick.size} sur ${fs.length})</span>, puis ce que tu veux en faire</p>
        <div class="row tight">
          <button type="button" class="btn small" data-pick-all>Tout cocher</button>
          <button type="button" class="btn small" data-pick-none>Tout décocher</button>
          <button type="button" class="btn small" data-pick-cancel>Annuler</button>
        </div>
        <div class="prepa-box">
          <p class="prepa-h"><b>Prépa</b></p>
          <label class="check"><input type="checkbox" data-prepa="fiche" checked> <span>Fiche de révision</span></label>
          <div class="prepa-qcm"><label class="check"><input type="checkbox" data-prepa="qcm" checked> <span>QCM</span></label>
            <label class="qcm-n">Questions <select data-prepa-n>${[10, 15, 20, 30, 40].map((v) => `<option${v === 20 ? " selected" : ""}>${v}</option>`).join("")}</select></label></div>
          <label class="check"><input type="checkbox" data-prepa="blanc"> <span>DS blanc + corrigé</span></label>
          <div class="prepa-qcm"><label class="check"><input type="checkbox" data-prepa="plan"> <span>Plan de révision jusqu'au</span></label>
            <input type="date" class="field prepa-date" data-prepa-fin value="${esc(nextDsDate(m))}" min="${esc(isoDay(NOW))}"></div>
          <div class="row tight">
            <button type="button" class="btn small primary" data-rev-go${pick.size ? "" : " disabled"}>Lancer la prépa (${pick.size})</button>
            <button type="button" class="btn small" data-carte-go${pick.size ? "" : " disabled"}>Carte mentale (${pick.size})</button>
            <button type="button" class="btn small" data-pick-print${pick.size ? "" : " disabled"}>🖨️ Imprimer (${pick.size})</button>
          </div>
        </div>
        <p id="carte-msg" class="small muted" aria-live="polite"></p>
      </div>`
    : `<div class="row">
      <button type="button" class="btn small primary" data-pick-start>Choisir des fiches…</button>
      <button type="button" class="btn small" data-add-libre>+ Ajouter une fiche</button>
      <button type="button" class="btn small" data-print-all>🖨️ Tout imprimer</button></div>`}
    ${activitesHtml(m)}
    ${progressHtml(m)}
    <ul class="list subject-list">
      ${r ? `<li class="rev"><button type="button" class="item" data-open-rev="${esc(m)}">
        <div class="t">Fiche de révision et QCM</div>
        <div class="m">${r.qcm?.length || 0} question${(r.qcm?.length || 0) > 1 ? "s" : ""}, à partir de ${r.sources} cours${stale ? " (des cours ont été ajoutés depuis)" : ""}</div>
      </button></li>` : ""}
      ${dsRevs(m).map((x) => `<li class="rev"><button type="button" class="item" data-open-rev-id="${esc(x.id)}">
        <div class="t">Révision pour le DS du ${esc(fmtDate(String(x.ds).slice(0, 10)))}</div>
        <div class="m">${x.qcm?.length || 0} question${(x.qcm?.length || 0) > 1 ? "s" : ""}, à partir des ${x.sources} fiche${x.sources > 1 ? "s" : ""} que tu as cochées</div>
      </button></li>`).join("")}
      ${choixRevs(m).map((x) => `<li class="prepa-card">
        <div class="t">Prépa sur ${x.sources} fiche${x.sources > 1 ? "s" : ""} choisie${x.sources > 1 ? "s" : ""}</div>
        <div class="m">${x.cree ? esc(fmtDate(x.cree.slice(0, 10))) : ""}</div>
        ${window.prepaHtml?.(null, x, 0, true) || ""}
      </li>`).join("")}
      ${cartes.map((c) => `<li class="rev carte-item"><button type="button" class="item" data-open-carte="${esc(c.id)}">
        <div class="t">Carte mentale${c.titre && c.titre !== m ? ` : ${esc(c.titre)}` : ""}</div>
        <div class="m">${c.sources} fiche${c.sources > 1 ? "s" : ""}${c.cree ? `, ${esc(fmtDate(c.cree.slice(0, 10)))}` : ""}</div>
      </button></li>`).join("")}
      ${fs.map((f) => `<li${pick ? ` class="pick${pick.has(f.id) ? "" : " off"}"` : ""}>${pick ? `<input type="checkbox" data-pick="${esc(f.id)}"${pick.has(f.id) ? " checked" : ""}
        aria-label="Mettre ${esc(f.titre || m)} dans la carte mentale">` : ""}<button type="button" class="item" data-open="${esc(f.id)}">
        <div class="t">${esc(f.titre || m)}</div>
        <div class="m">${f.source === "moodle" ? `D'après ${f.origine === "padlet" ? "le Padlet" : "le support Moodle"}${f.date ? ", " + esc(fmtDate(f.date)) : ""}`
          : f.source === "complete" ? `Support Moodle complété par le cours du ${esc(fmtDate(f.date))}`
          : f.source === "notes" ? `${esc(fmtDate(f.date))}, d'après tes notes et photos`
          : `${esc(fmtDate(f.date))}${f.duree_min ? `, ${f.duree_min} min d'enregistrement` : ""}`}</div>
      </button></li>`).join("")}
    </ul>`;
  box.querySelector(".subject-list").classList.toggle("pick-list", !!pick);
  $("#rev-back").onclick = () => { openSubjects.clear(); cartePick.delete(m); renderFiches(); };
  box.querySelectorAll("[data-open-carte]").forEach((b) => { b.onclick = () => window.openCarte?.(b.dataset.openCarte); });
  box.querySelector("[data-add-libre]")?.addEventListener("click", () => window.openAddSheetLibre?.(m));
  box.querySelector("[data-pick-start]")?.addEventListener("click", () => { cartePick.set(m, new Set(fs.map((f) => f.id))); renderFiches(); });
  box.querySelector("[data-pick-cancel]")?.addEventListener("click", () => { cartePick.delete(m); renderFiches(); });
  const chrono = (list) => [...list].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  box.querySelector("[data-print-all]")?.addEventListener("click", () => window.printMatiere?.(m, chrono(fs), r));
  box.querySelector("[data-pick-print]")?.addEventListener("click", () => window.printFiches?.(m, chrono(fs.filter((f) => pick.has(f.id)))));
  box.querySelector("[data-pick-all]")?.addEventListener("click", () => { cartePick.set(m, new Set(fs.map((f) => f.id))); renderFiches(); });
  box.querySelector("[data-pick-none]")?.addEventListener("click", () => { cartePick.set(m, new Set()); renderFiches(); });
  box.querySelectorAll("[data-pick]").forEach((c) => {
    c.onchange = () => { const set = cartePick.get(m); c.checked ? set.add(c.dataset.pick) : set.delete(c.dataset.pick); renderFiches(); };
  });
  window.wirePrepa?.(box, []);
  box.querySelectorAll(".prepa-card [data-ds-rev]").forEach((b) => { b.onclick = () => openRevision(null, b.dataset.dsRev); });
  box.querySelector("[data-rev-go]")?.addEventListener("click", async (ev) => {
    const b = ev.currentTarget, ids = [...cartePick.get(m)];
    const bar = box.querySelector(".prepa-box"), prepa = {};
    bar.querySelectorAll("[data-prepa]").forEach((c) => { if (c.checked) prepa[c.dataset.prepa] = true; });
    if (!Object.keys(prepa).length) { $("#carte-msg").textContent = "Coche au moins une partie de la prépa."; return; }
    const jusqua = bar.querySelector("[data-prepa-fin]").value;
    if (prepa.plan && (!jusqua || jusqua <= isoDay(NOW))) { $("#carte-msg").textContent = "Pour le plan, choisis une date après aujourd'hui."; return; }
    b.disabled = true;
    try {
      await send({ id: newId(), kind: "revision", matiere: m, fiches: ids, prepa, qcm_n: +bar.querySelector("[data-prepa-n]").value,
        jusqua: prepa.plan ? jusqua : undefined, aujourdhui: isoDay(new Date()) }, new ArrayBuffer(0));
      cartePick.delete(m);
      renderFiches();
    } catch (e) { $("#carte-msg").textContent = `Échec : ${e.message}`; b.disabled = false; }
  });
  box.querySelector("[data-carte-go]")?.addEventListener("click", async (ev) => {
    const b = ev.currentTarget, ids = [...cartePick.get(m)];
    b.disabled = true;
    try {
      await send({ id: newId(), kind: "carte", matiere: m, titre: `Carte mentale : ${m}`, fiches: ids }, new ArrayBuffer(0));
      cartePick.delete(m);
      renderFiches();
    } catch (e) { $("#carte-msg").textContent = `Échec : ${e.message}`; b.disabled = false; }
  });
  box.querySelectorAll("[data-open]").forEach((b) => { b.onclick = () => openFiche(b.dataset.open); });
  box.querySelectorAll("[data-open-rev]").forEach((b) => { b.onclick = () => openRevision(b.dataset.openRev); });
  box.querySelectorAll("[data-open-rev-id]").forEach((b) => { b.onclick = () => openRevision(null, b.dataset.openRevId); });
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

/* ---------- Supprimer une fiche ou une révision ---------- */
/* Cachées tout de suite, en attendant que GitHub republie l'appli */
const GONE_KEY = "ecam-fiches-supprimees";
/* { chemin, quand } : on cache seulement la version supprimée, pas une nouvelle refaite ensuite
   sous le même nom (ex. révision d'un DS supprimée puis recréée) */
const gone = {
  all: () => {
    try { return (JSON.parse(store.get(GONE_KEY)) || []).filter((g) => g && typeof g === "object" && g.path); }
    catch { return []; }
  },
  add(path) { store.set(GONE_KEY, JSON.stringify([...this.all().filter((g) => g.path !== path), { path, at: new Date().toISOString() }])); },
};

window.applyDeleted = function (fresh = true) {
  if (!DATA) return;
  const items = [...(DATA.fiches || []).map((f) => [`fiches/${f._fichier}`, f]),
    ...(DATA.revisions || []).map((r) => [`revisions/${r._fichier}`, r]),
    ...(DATA.cartes || []).map((c) => [`cartes/${c._fichier}`, c])];
  const byPath = new Map(items);
  const made = (x) => new Date(x.maj || x.cree || 0);
  let list = gone.all();
  if (fresh) {
    // on oublie : ce qui a disparu en ligne, et ce qui a été refait après la suppression
    list = list.filter((g) => byPath.has(g.path) && !(made(byPath.get(g.path)) > new Date(g.at)));
    store.set(GONE_KEY, JSON.stringify(list));
  }
  const hide = new Set(list.filter((g) => !(byPath.get(g.path) && made(byPath.get(g.path)) > new Date(g.at))).map((g) => g.path));
  DATA.fiches = (DATA.fiches || []).filter((f) => !hide.has(`fiches/${f._fichier}`));
  DATA.revisions = (DATA.revisions || []).filter((r) => !hide.has(`revisions/${r._fichier}`));
  DATA.cartes = (DATA.cartes || []).filter((c) => !hide.has(`cartes/${c._fichier}`));
};

function deleteZone(label, what) {
  return `<div class="row danger-zone"><button type="button" class="btn danger" id="del-item">${esc(label)}</button>
    <span id="del-msg" class="small muted" aria-live="polite"></span></div>
    ${what ? `<p class="muted small">${esc(what)}</p>` : ""}`;
}

let delArmed = 0;
function wireDelete(path, label) {
  const btn = $("#del-item"), msg = $("#del-msg");
  if (!btn) return;
  btn.onclick = async () => {
    if (!store.get(TOKEN_KEY)) { msg.textContent = "Ajoute d'abord ton jeton GitHub (onglet Micro, Réglages)."; return; }
    if (Date.now() - delArmed > 4000) {
      delArmed = Date.now();
      btn.textContent = "Confirmer la suppression";
      msg.textContent = "Appuie encore une fois pour supprimer définitivement.";
      setTimeout(() => { if (Date.now() - delArmed >= 4000) { btn.textContent = label; msg.textContent = ""; } }, 4100);
      return;
    }
    delArmed = 0;
    btn.disabled = true;
    msg.textContent = "Suppression…";
    try {
      const api = `/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
      const info = await gh(`${api}?ref=main&t=${Date.now()}`, { cache: "no-store" });
      if (info.status !== 404) {
        if (!info.ok) throw new Error(info.status === 401 ? "jeton GitHub refusé" : `GitHub ne répond pas (${info.status})`);
        const { sha } = await info.json();
        const r = await gh(api, { method: "DELETE", body: JSON.stringify({ message: "Suppression", sha, branch: "main" }) });
        if (!r.ok) throw new Error(r.status === 403 ? "ce jeton ne peut pas modifier le dépôt" : `suppression refusée (${r.status})`);
      }
      gone.add(path);
      closeReader();
      window.applyDeleted(false);
      renderAll();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = label;
      msg.textContent = `Échec : ${e.message}`;
    }
  };
}

function openFiche(id) {
  const f = (DATA.fiches || []).find((x) => x.id === id);
  if (!f) return;
  const meta = f.source === "moodle" ? `${esc(f.matiere)}, d'après « ${esc(f.doc || "")} » sur Moodle`
    : f.source === "complete" ? `${esc(f.matiere)}, « ${esc(f.doc || "")} » (Moodle) complété par le cours du ${esc(fmtDate(f.date))}${f.heure ? " à " + esc(f.heure) : ""}`
    : `${esc(f.matiere)}, ${esc(fmtDate(f.date))}${f.heure ? " à " + esc(f.heure) : ""}${f.source === "notes" ? ", d'après tes notes" : ""}`;
  openReader(f.matiere, `<p class="meta">${meta}</p>${md(f.md)}${f._fichier ? deleteZone("Supprimer cette fiche",
    f.source === "moodle" || f.source === "complete" ? "Elle ne sera pas refaite automatiquement à partir de Moodle." : "") : ""}`);
  if (f._fichier) wireDelete(`fiches/${f._fichier}`, "Supprimer cette fiche");
}

function openRevision(matiere, id, focus) {
  const revs = DATA.revisions || [];
  const r = id ? revs.find((x) => x.id === id) : revs.find((x) => x.matiere === matiere && !x.ds && !x.choix) || revs.find((x) => x.matiere === matiere);
  if (!r) return;
  matiere = r.matiere;
  r.qcm = (Array.isArray(r.qcm) ? r.qcm : []).filter((q) => q && Array.isArray(q.choix) && q.choix.length > 1)
    .map((q) => ({ ...q, bonne: Number(q.bonne) || 0 }));
  const qcm = (r.qcm || []).map((q, i) => `<div class="q" data-q="${i}">
    <p>${i + 1}. ${esc(q.question)}</p>
    ${q.choix.map((c, j) => `<button type="button" data-c="${j}">${esc(c)}</button>`).join("")}
    <div class="why" hidden>${esc(q.explication || "")}</div></div>`).join("");
  // depuis la prépa DS : le QCM seul ; sinon la fiche puis le QCM
  const onlyQcm = focus === "qcm";
  openReader(onlyQcm ? `QCM : ${matiere}` : `Révision : ${matiere}`, `<p class="meta">${esc(matiere)}, à partir de ${r.sources} fiche${r.sources > 1 ? "s" : ""}${r.ds ? ` (pour le DS du ${esc(fmtDate(r.ds.slice(0, 10)))})` : r.choix ? " choisies" : ""}</p>${onlyQcm ? "" : `<div class="row"><button type="button" class="btn small" id="rev-print">🖨️ Imprimer</button></div>${md(r.md)}`}
    ${qcm ? `<section class="qcm"><h2>QCM</h2><p id="score" class="score" aria-live="polite"></p>${qcm}
      <button type="button" class="btn" id="qcm-reset">Recommencer</button></section>` : ""}
    ${r._fichier && !onlyQcm ? deleteZone(r.ds ? "Supprimer toute la prépa de ce DS" : "Supprimer cette révision", r.ds ? "Fiche, QCM, DS blanc et plan de ce DS sont supprimés, pas tes fiches de cours." : "Seules la fiche de révision et son QCM sont supprimés, pas tes fiches de cours.") : ""}`);
  if (r._fichier && !onlyQcm) wireDelete(`revisions/${r._fichier}`, r.ds ? "Supprimer toute la prépa de ce DS" : "Supprimer cette révision");
  $("#rev-print")?.addEventListener("click", () => window.printRevision?.(r));
  const body = $("#reader-body");
  let good = 0, done = 0;
  const total = r.qcm.length, missed = [];
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
        if (pick !== q.bonne) missed.push(q.question);
        $("#score").textContent = done === total ? `Score : ${good}/${total}` : `${good} bonne(s) réponse(s) sur ${done}`;
        if (done === total) {
          // score gardé (synchronisé) pour suivre ta progression dans Révisions
          const prev = scoresFor(r.matiere).filter((x) => x.rev === r.id);
          window.saveScore?.({ id: newId(), rev: r.id, matiere: r.matiere, quand: new Date().toISOString(), good, total,
            rates: missed.slice(0, 15).map((t) => String(t).slice(0, 200)) });
          const best = Math.max(0, ...prev.map((x) => x.good / x.total));
          const pct = Math.round(100 * good / total);
          $("#score").textContent = `Score : ${good}/${total} (${pct} %)${prev.length ? (good / total > best ? " · nouveau record ! 🎉" : ` · ton meilleur : ${Math.round(100 * best)} %`) : ""}`;
        }
      };
    });
  });
  $("#qcm-reset")?.addEventListener("click", () => openRevision(null, r.id));
}

/* ---------- Rendu ---------- */
window.pendingAll = () => resolvePending();
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
