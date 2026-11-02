"use strict";

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const NOW = params.get("now") ? new Date(params.get("now")) : new Date(); // ?now= pour tester

const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const fmtTime = (d) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const fmtDayLong = (d) => d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let DATA = null;
let selectedDay = null;

function relDay(d) {
  const diff = Math.round((startOfDay(d) - startOfDay(NOW)) / 864e5);
  if (diff === 0) return "aujourd'hui";
  if (diff === 1) return "demain";
  if (diff > 1 && diff < 7) return d.toLocaleDateString("fr-FR", { weekday: "long" });
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

function inMinutes(d) {
  const m = Math.round((d - NOW) / 6e4);
  if (m < 60) return `dans ${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return `dans ${h} h${r ? String(r).padStart(2, "0") : ""}`;
  return null;
}

function events() {
  return (DATA.planning || [])
    .map((e) => ({ ...e, d0: new Date(e.debut), d1: new Date(e.fin || e.debut) }))
    .filter((e) => !isNaN(e.d0))
    .sort((a, b) => a.d0 - b.d0);
}

function kindLabel(t) {
  return { CM: "Cours magistral", TD: "TD", TP: "TP", DS: "Devoir surveillé" }[t] || t;
}

/* ---------- Panneau de porte ---------- */
function renderDoor(evs) {
  const cur = evs.find((e) => e.d0 <= NOW && NOW < e.d1);
  const next = evs.find((e) => e.d0 > NOW);
  const e = cur || next;
  const el = $("#door");
  if (!e) {
    el.innerHTML = `<div class="door free"><div class="when">Rien de prévu</div><div class="room">Pas de cours à venir</div>
      <div class="who">Actualise pour récupérer les prochaines semaines.</div></div>`;
    return;
  }
  const when = cur
    ? `En ce moment, jusqu'à ${fmtTime(e.d1)}`
    : `Prochain cours, ${relDay(e.d0)} à ${fmtTime(e.d0)}${inMinutes(e.d0) ? ` (${inMinutes(e.d0)})` : ""}`;
  el.innerHTML = `<div class="door">
    <div class="when">${esc(when)}</div>
    <div class="room">${esc(e.salle || "?")}</div>
    <div class="kind">${esc(e.type)}</div>
    <div class="what">${esc(e.matiere)}</div>
    <div class="who">${esc([e.prof, `${fmtTime(e.d0)}–${fmtTime(e.d1)}`].filter(Boolean).join(", "))}</div>
    ${cur ? `<button type="button" class="btn door-rec" data-matiere="${esc(e.matiere)}">Enregistrer ce cours</button>` : ""}
  </div>`;
  el.querySelector(".door-rec")?.addEventListener("click", (ev) => {
    showPane("enregistrer");
    window.startRecording?.(ev.currentTarget.dataset.matiere);
  });
}

/* ---------- Jours ---------- */
function renderDays(evs) {
  const byDay = new Map();
  evs.forEach((e) => {
    const k = dayKey(e.d0);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  });
  const first = addDays(startOfDay(NOW), -((NOW.getDay() + 6) % 7)); // lundi de cette semaine
  const last = evs.length ? startOfDay(evs[evs.length - 1].d0) : addDays(first, 4);
  if (!selectedDay) {
    const upcoming = evs.find((e) => e.d1 > NOW);
    selectedDay = upcoming ? startOfDay(upcoming.d0) : startOfDay(NOW);
  }
  const nav = $("#days");
  nav.innerHTML = "";
  for (let d = first; d <= last; d = addDays(d, 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const list = byDay.get(dayKey(d)) || [];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "day" + (list.length ? " has" : "") + (list.some((e) => e.type === "DS") ? " exam" : "")
      + (d.getDay() === 1 && d > first ? " week" : "");
    b.setAttribute("aria-pressed", dayKey(d) === dayKey(selectedDay));
    b.setAttribute("aria-label", fmtDayLong(d));
    b.innerHTML = `<span>${JOURS[d.getDay()]}</span><b>${d.getDate()}</b>`;
    b.onclick = () => { selectedDay = d; renderPlanning(); };
    nav.appendChild(b);
  }
  nav.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  return byDay;
}

const WIDE = matchMedia("(min-width: 900px)");

const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/* Fiche déjà faite pour ce créneau (enregistrement ou notes, même matière, même jour) */
function ficheFor(e) {
  const day = e.debut.slice(0, 10), heure = e.debut.slice(11, 16);
  // une fiche avec une heure va à son créneau ; sans heure (anciens envois), au premier créneau du jour
  const same = (DATA.fiches || []).filter((f) => f.source !== "moodle" && f.date === day && norm(f.matiere) === norm(e.matiere));
  const first = events().find((x) => x.debut.slice(0, 10) === day && norm(x.matiere) === norm(e.matiere));
  return same.find((f) => f.heure === heure) || (first?.debut === e.debut && same.find((f) => !f.heure));
}

/* ---------- Changements d'emploi du temps sur le planning ---------- */
const CHG_LABEL = { deplace: "Déplacé", salle: "Salle changée", prof: "Autre enseignant", ajoute: "Nouveau" };
const recentChanges = () => (DATA.changements || []).filter((c) => NOW - new Date(c.quand) < 14 * 864e5);

function changeTag(e) {
  const c = recentChanges().find((c) => c.apres?.debut === e.debut && norm(c.matiere || c.titre) === norm(e.matiere || e.titre)
    && CHG_LABEL[c.type]);
  if (!c) return "";
  const was = c.type === "salle" ? ` (avant ${c.avant?.salle || "?"})`
    : c.type === "deplace" ? ` (avant ${fmtShort(c.avant?.debut)})` : "";
  return `<div class="chg chg-${c.type}">${esc(CHG_LABEL[c.type] + was)}</div>`;
}

function fmtShort(iso) {
  if (!iso) return "?";
  const d = new Date(iso);
  return `${JOURS[d.getDay()]} ${d.getDate()} à ${fmtTime(d)}`;
}

function ghostSlots(day) {
  return recentChanges().filter((c) => (c.type === "annule" || c.type === "deplace") && c.avant?.debut
      && dayKey(new Date(c.avant.debut)) === dayKey(day))
    .map((c) => ({ ghost: true, c, d0: new Date(c.avant.debut), d1: new Date(c.avant.fin || c.avant.debut) }));
}

function ghostHtml(g) {
  const c = g.c;
  return `<li class="slot ghost">
    <time>${fmtTime(g.d0)}<small>${fmtTime(g.d1)}</small></time>
    <div><div class="t">${esc(c.matiere || c.titre)}</div>
      <div class="m">${c.type === "annule" ? "Cours annulé" : `Déplacé au ${esc(fmtShort(c.apres?.debut))}`}</div></div>
    <div><div class="r">${esc(c.avant?.salle || "")}</div></div>
  </li>`;
}

function slotHtml(e) {
  const st = e.d1 <= NOW ? " past" : e.d0 <= NOW ? " now" : "";
  const canAdd = ["CM", "TD", "TP"].includes(e.type) && e.d0 <= NOW;
  const f = canAdd && ficheFor(e);
  return `<li class="slot ${esc(e.type)}${st}">
    <time datetime="${e.d0.toISOString()}">${fmtTime(e.d0)}<small>${fmtTime(e.d1)}</small></time>
    <div><div class="t">${esc(e.matiere)}</div><div class="m">${esc(e.prof || e.groupes || "")}</div></div>
    <div><div class="r">${esc(e.salle)}</div><div class="k">${esc(kindLabel(e.type))}</div></div>
    ${changeTag(e)}
    ${!canAdd ? "" : f
      ? `<button type="button" class="btn small fiche-btn done" data-fiche="${esc(f.id)}">Voir la fiche</button>`
      : `<button type="button" class="btn small fiche-btn" data-add="${esc(e.debut)}">+ Ajouter une fiche</button>`}
  </li>`;
}

function renderSlots(byDay) {
  const ol = $("#slots");
  // Sur PC : toute la semaine du jour choisi. Sur téléphone : le jour choisi.
  const days = WIDE.matches
    ? [0, 1, 2, 3, 4].map((i) => addDays(selectedDay, i - ((selectedDay.getDay() + 6) % 7)))
    : [selectedDay];
  ol.innerHTML = days.map((d) => {
    const ghosts = ghostSlots(d);
    const list = [...(byDay.get(dayKey(d)) || []), ...ghosts].sort((a, b) => a.d0 - b.d0);
    const head = WIDE.matches
      ? `<li class="dayhead${dayKey(d) === dayKey(selectedDay) ? " sel" : ""}"><h3>${esc(fmtDayLong(d))}</h3></li>` : "";
    const body = list.length ? list.map((x) => (x.ghost ? ghostHtml(x) : slotHtml(x))).join("")
      : `<li class="empty">Pas de cours ${WIDE.matches ? "" : relDay(d) === "aujourd'hui" ? "aujourd'hui" : "le " + esc(fmtDayLong(d))}</li>`;
    return head + body;
  }).join("");
  const evs = events();
  ol.querySelectorAll("[data-fiche]").forEach((b) => { b.onclick = () => window.openFiche?.(b.dataset.fiche); });
  ol.querySelectorAll("[data-add]").forEach((b) => {
    const e = evs.find((x) => x.debut === b.dataset.add);
    b.onclick = () => window.openAddSheet?.(e);
  });
}

WIDE.addEventListener("change", () => DATA && renderPlanning());

function renderPlanning() {
  const evs = events();
  renderDoor(evs);
  renderSlots(renderDays(evs));
}

/* ---------- Devoirs ---------- */
function cleanCourse(name) {
  return String(name || "").replace(/^📚\s*/, "").replace(/\s+-\s+LIB\w+$/, "").trim();
}

function renderDevoirs() {
  const items = (DATA.devoirs || []).map((d) => ({ ...d, due: new Date(d.echeance) })).sort((a, b) => a.due - b.due);
  const soon = items.filter((d) => d.due - NOW < 7 * 864e5).length;
  const badge = $("#badge");
  badge.hidden = !soon;
  badge.textContent = soon;
  $("#devoirs").innerHTML = items.length ? items.map((d) => {
    const ms = d.due - NOW, days = Math.ceil(ms / 864e5);
    const left = ms < 0 ? "En retard" : days <= 1 ? (inMinutes(d.due) || "Demain") : `${days} jours`;
    const cls = ms < 0 || d.en_retard ? "late" : days <= 3 ? "soon" : "";
    const cmid = (String(d.url).match(/mod\/assign\/view\.php\?id=(\d+)/) || [])[1];
    return `<li>
      <a href="${esc(d.url)}" target="_blank" rel="noopener">
        <div class="due"><span class="t">${esc(d.titre)}</span><span class="left ${cls}">${esc(left)}</span></div>
        <div class="m">${esc(cleanCourse(d.cours))}</div>
        <div class="m">Pour le ${esc(d.due.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }))} à ${fmtTime(d.due)}${d.action ? ", " + esc(d.action.toLowerCase()) : ""}</div>
      </a>
      ${cmid ? `<div class="due-actions"><button type="button" class="btn small" data-ia="${esc(cmid)}"
        data-titre="${esc(d.titre)}" data-matiere="${esc(cleanCourse(d.cours))}">Faire avec l'IA</button>
        <a class="btn small" href="${esc(d.url)}" target="_blank" rel="noopener">Déposer sur Moodle</a></div>` : ""}
    </li>`;
  }).join("") : `<li class="m">Rien à rendre pour l'instant.</li>`;
  document.querySelectorAll("#devoirs [data-ia]").forEach((b) => {
    b.onclick = () => window.faireDevoirMoodle?.(b.dataset.ia, b.dataset.titre, b.dataset.matiere, b);
  });
}

/* ---------- Notes ---------- */
const num = (s) => parseFloat(String(s).split("/")[0].replace(",", "."));

function renderNotes() {
  const items = DATA.notes || [];
  $("#notes").innerHTML = items.length ? items.map((n) => {
    const v = num(n.note), moy = num(n.moyenne_classe);
    const diff = !isNaN(v) && !isNaN(moy) ? v - moy : null;
    const cmp = diff === null ? "" : `${diff >= 0 ? "+" : ""}${diff.toFixed(2).replace(".", ",")} par rapport à la moyenne de la classe (${String(n.moyenne_classe).replace("/20", "")})`;
    return `<li class="note">
      <div><div class="t">${esc(n.matiere)}</div><div class="m">${esc(n.epreuve)}, coef. ${esc(n.coefficient)}, ${esc(n.date)}</div></div>
      <div class="v">${esc(String(n.note).replace("/20", ""))}<small>/20</small></div>
      ${isNaN(v) ? "" : `<div class="bar" aria-hidden="true"><i style="width:${v * 5}%"></i>${isNaN(moy) ? "" : `<b style="left:${moy * 5}%"></b>`}</div>`}
      <div class="cmp">${esc(cmp)}</div>
    </li>`;
  }).join("") : `<li class="m">Aucune note publiée.</li>`;
}

/* ---------- Cours ---------- */
const TILE_COLORS = ["corail", "vert", "bleu", "violet", "ambre", "turquoise", "rose", "indigo", "olive", "ciel"];

function renderCours() {
  const q = norm($("#filtre").value);
  const evs = events();
  // couleur fixée par la position dans la liste complète : jamais deux voisines identiques
  const items = (DATA.cours || [])
    .map((c) => ({ ...c, nom: cleanCourse(c.nom) }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
    .map((c, i) => ({ ...c, color: TILE_COLORS[i % TILE_COLORS.length] }))
    .filter((c) => !q || norm(c.nom).includes(q));
  $("#cours").innerHTML = items.length ? items.map((c) => {
    const next = evs.find((e) => e.d0 > NOW && norm(e.matiere) === norm(c.nom));
    const n = (DATA.fiches || []).filter((f) => f.kind === "cours" && norm(f.matiere) === norm(c.nom)).length;
    const info = [next ? `${next.type === "DS" ? "DS" : "Prochain cours"} ${relDay(next.d0)}` : "", n ? `${n} fiche${n > 1 ? "s" : ""}` : ""]
      .filter(Boolean).join(" · ");
    return `<li><a class="tile ${c.color}" href="${esc(c.url)}" target="_blank" rel="noopener">
      <span class="tile-name">${esc(c.nom)}</span>${info ? `<span class="tile-info">${esc(info)}</span>` : ""}</a></li>`;
  }).join("") : `<li class="empty-state">Aucun cours ne correspond.</li>`;
}

/* ---------- Données ---------- */
function renderAll() {
  $("#today").textContent = fmtDayLong(NOW);
  const maj = DATA.maj ? new Date(DATA.maj) : null;
  $("#maj").textContent = maj ? `Mis à jour ${relDay(maj)} à ${fmtTime(maj)}` : "Pas encore synchronisé";
  $("#err").hidden = !DATA.synchro?.erreur;
  $("#err").textContent = DATA.synchro?.erreur ? `Actualisation impossible : ${DATA.synchro.erreur}` : "";
  renderPlanning();
  renderDevoirs();
  renderNotes();
  renderCours();
  window.renderRevisions?.();
  window.renderDevoirsIA?.();
  window.renderDS?.();
  window.renderNotifs?.();
}

/* ---------- Données chiffrées (data.enc publié par GitHub) ---------- */
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function decrypt(blob, password) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: unb64(blob.salt), iterations: blob.iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, key, unb64(blob.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

function showLock(message) {
  const lock = $("#lock");
  lock.hidden = false;
  $("#lock-msg").textContent = message || "";
  $("#pw").value = "";
  $("#pw").focus();
}

$("#lock form").onsubmit = async (ev) => {
  ev.preventDefault();
  store.set("ecam-pw", $("#pw").value);
  $("#lock").hidden = true;
  await load();
};

async function load() {
  setSyncButton(true);
  let blob = null, offline = false;
  try {
    const r = await fetch(`data.enc?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    blob = await r.json();
    store.set("ecam-blob", JSON.stringify(blob));
  } catch {
    try { blob = JSON.parse(store.get("ecam-blob")); } catch {}
    offline = true;
  }
  setSyncButton(false);
  if (!blob) {
    DATA = { planning: [], devoirs: [], notes: [], cours: [], synchro: { erreur: "pas encore de données, la première synchro n'a pas tourné" } };
    return renderAll();
  }
  const pw = store.get("ecam-pw");
  if (!pw) return showLock();
  try {
    DATA = await decrypt(blob, pw);
  } catch {
    store.del("ecam-pw");
    return showLock("Mot de passe incorrect.");
  }
  if (offline) DATA.synchro = { erreur: "hors connexion, affichage de la dernière version enregistrée" };
  renderAll();
}

function setSyncButton(busy) {
  const b = $("#sync");
  b.setAttribute("aria-busy", !!busy);
  b.textContent = busy ? "Chargement…" : "Recharger";
  b.disabled = !!busy;
}

$("#sync").onclick = load;

fetch("config.json", { cache: "no-store" }).then((r) => r.json()).then((c) => {
  if (!c.repo) return;
  window.REPO = c.repo;
  const a = $("#force");
  a.href = `https://github.com/${c.repo}/actions/workflows/sync.yml`;
  a.hidden = false;
}).catch(() => {});

$("#filtre").oninput = renderCours;

function showPane(name) {
  document.querySelectorAll(".panes button").forEach((b) =>
    b.dataset.pane === name ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  document.querySelectorAll(".pane").forEach((p) => { p.hidden = p.id !== "pane-" + name; });
  store.set("ecam-pane", name);
  scrollTo(0, 0);
}
document.querySelectorAll(".panes button").forEach((b) => { b.onclick = () => showPane(b.dataset.pane); });
{
  const last = store.get("ecam-pane");
  if (last && document.getElementById("pane-" + last)) showPane(last);
}

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker?.register("sw.js").catch(() => {});
}

load();
