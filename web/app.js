"use strict";

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
// heure « maintenant », remise à jour à chaque affichage (l'appli peut rester ouverte des jours) ; ?now= pour tester
let NOW = params.get("now") ? new Date(params.get("now")) : new Date();
const tickNow = () => { if (!params.get("now")) NOW = new Date(); };

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
  const evs = (DATA.planning || [])
    .map((e) => ({ ...e, d0: new Date(e.debut), d1: new Date(e.fin || e.debut) }))
    .filter((e) => !isNaN(e.d0));
  // DS annoncés à l'oral (ajoutés dans l'onglet DS)
  for (const p of window.persoDS?.() || []) {
    // s'il apparaît ensuite dans le planning officiel, on garde l'officiel avec tes notes
    const off = evs.find((e) => e.type === "DS" && !e.perso && e.debut.slice(0, 10) === p.date && norm(e.matiere) === norm(p.matiere));
    if (off) { off.persoNotes = p.notes; off.persoId = p.id; off.programme = p.programme; continue; }
    // heure non donnée : celle du cours de la même matière ce jour-là (le DS a lieu en cours)
    const same = (a, b) => (typeof sameMatiere === "function" ? sameMatiere(a, b) : norm(a) === norm(b));
    const cours = !p.debut && evs.find((e) => !e.perso && e.debut.slice(0, 10) === p.date && same(e.matiere, p.matiere));
    const debut = cours ? cours.debut : `${p.date}T${p.debut || "08:00"}:00`;
    const fin = cours ? cours.fin || cours.debut : `${p.date}T${p.fin || (p.debut ? addHour(p.debut) : "23:59")}:00`;
    evs.push({ perso: true, auto: !!p.auto, persoId: p.id, persoNotes: p.notes, programme: p.programme,
      sansHeure: !p.debut && !cours, heureCours: !!cours, type: "DS",
      matiere: p.matiere, titre: `DS ${p.matiere}`, debut, fin, salle: p.salle || cours?.salle || "", prof: cours?.prof || "",
      d0: new Date(debut), d1: new Date(fin) });
  }
  return evs.filter((e) => !isNaN(e.d0)).sort((a, b) => a.d0 - b.d0);
}
const addHour = (hm) => { const [h, m] = hm.split(":").map(Number); return `${String(Math.min(h + 2, 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}`; };

function kindLabel(t) {
  return { CM: "Cours magistral", TD: "TD", TP: "TP", DS: "Devoir surveillé" }[t] || t;
}

/* ---------- Panneau de porte ---------- */
function renderDoor(evs) {
  evs = evs.filter((e) => !e.sansHeure);
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
    $("#f-date").value = "";   // aujourd'hui, et le cours en cours est choisi tout seul
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
  const linked = (DATA.fiches || []).find((f) => f.creneau === e.debut);
  if (linked) return linked;
  const same = (DATA.fiches || []).filter((f) => f.source !== "moodle" && !f.creneau && f.date === day && norm(f.matiere) === norm(e.matiere));
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
  const act = canAdd ? window.persoActivite?.(e) || "" : "";
  const actHtml = !canAdd ? "" : act
    ? `<button type="button" class="act-line" data-act="${esc(e.debut)}" title="Modifier"><span aria-hidden="true">✏️</span> ${esc(act)}</button>`
    : `<button type="button" class="btn small act-btn" data-act="${esc(e.debut)}">+ Ce qu'on a fait</button>`;
  return `<li class="slot ${esc(e.type)}${st}">
    <time datetime="${e.d0.toISOString()}">${e.sansHeure ? "?<small>heure</small>" : `${fmtTime(e.d0)}<small>${fmtTime(e.d1)}</small>`}</time>
    <div><div class="t">${esc(e.matiere)}</div><div class="m">${esc(e.perso ? "Annoncé à l'oral" : e.prof || e.groupes || "")}</div></div>
    <div><div class="r">${esc(e.salle)}</div><div class="k">${esc(kindLabel(e.type))}</div></div>
    ${changeTag(e)}
    ${actHtml}
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
  ol.querySelectorAll("[data-act]").forEach((b) => {
    const e = evs.find((x) => x.debut === b.dataset.act);
    b.onclick = () => editActivite(b, e);
  });
  ol.querySelectorAll("[data-add]").forEach((b) => {
    const e = evs.find((x) => x.debut === b.dataset.add);
    b.onclick = () => window.openAddSheet?.(e);
  });
}

/* « Ce qu'on a fait » : quelques mots tapés directement sous le cours */
function editActivite(btn, e) {
  if (!e) return;
  const form = document.createElement("form");
  form.className = "act-form";
  form.innerHTML = `<input type="text" maxlength="200" enterkeyhint="done" placeholder="Ex. : exposés, jeu de rôle, exo 3"
      aria-label="Ce qu'on a fait en cours"><button type="submit" class="btn small primary">OK</button>`;
  const input = form.querySelector("input");
  input.value = window.persoActivite?.(e) || "";
  btn.replaceWith(form);
  input.focus();
  let done = false;
  const save = () => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (v !== (window.persoActivite?.(e) || "")) window.saveActivite(e, v);
    renderPlanning();
  };
  form.onsubmit = (ev) => { ev.preventDefault(); save(); };
  input.addEventListener("blur", () => setTimeout(save, 150));
  input.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { done = true; renderPlanning(); } });
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
  // devoirs Moodle + devoirs ajoutés à la main
  const mine = (window.persoDevoirs?.() || []).map((d) => ({ titre: d.titre, cours: d.matiere || "", echeance: d.echeance,
    url: `perso:${d.id}`, perso: d }));
  const all = [...(DATA.devoirs || []), ...mine].map((d) => ({ ...d, due: new Date(d.echeance) }))
    .filter((d) => !isNaN(d.due)).sort((a, b) => a.due - b.due);
  const travailFor = (key) => [...(DATA.travaux || [])].filter((t) => t.pour === key)
    .sort((a, b) => (b.cree || "").localeCompare(a.cree || ""))[0];
  const cmidOf = (d) => (String(d.url).match(/mod\/assign\/view\.php\?id=(\d+)/) || [])[1];
  // un devoir déposé sur Moodle (et envoyé si besoin) compte comme fait
  const fait = (d) => window.isFait?.(d) || window.depotDone?.(cmidOf(d));
  const items = all.filter((d) => !fait(d)), done = all.filter(fait);
  const soon = items.filter((d) => d.due - NOW < 7 * 864e5).length;
  const badge = $("#badge");
  badge.hidden = !soon;
  badge.textContent = soon;
  $("#plus-badge").hidden = !soon;
  $("#plus-badge").textContent = soon;
  window.aRendre = items;   // pour l'accueil
  $("#devoirs").innerHTML = items.length ? items.map((d) => {
    const i = all.indexOf(d);
    const ms = d.due - NOW, days = Math.ceil(ms / 864e5);
    const left = ms < 0 ? "En retard" : days <= 1 ? (inMinutes(d.due) || "Demain") : `${days} jours`;
    const cls = ms < 0 || d.en_retard ? "late" : days <= 3 ? "soon" : "";
    const cmid = (String(d.url).match(/mod\/assign\/view\.php\?id=(\d+)/) || [])[1];
    const p = d.perso;
    const head = `<div class="due"><span class="t">${esc(d.titre)}</span><span class="left ${cls}">${esc(left)}</span></div>
        <div class="m">${esc(cleanCourse(d.cours))}${p ? `${d.cours ? " · " : ""}ajouté par toi` : ""}</div>
        <div class="m">Pour le ${esc(d.due.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }))} à ${fmtTime(d.due)}${d.action ? ", " + esc(d.action.toLowerCase()) : ""}</div>
        ${p?.enonce ? `<div class="m">Énoncé : ${esc(p.enonce.nom)}</div>` : ""}
        ${p?.consigne ? `<div class="m">Consigne : ${esc(p.consigne)}</div>` : ""}`;
    const t = travailFor(p ? `perso:${p.id}` : cmid ? `moodle:${cmid}` : "");
    return `<li>
      ${p ? `<div class="due-body">${head}</div>` : `<a href="${esc(d.url)}" target="_blank" rel="noopener">${head}</a>`}
      ${t ? `<p class="depot-line ok">Fait par l'IA ✓ <button type="button" class="linkish" data-travail-open="${esc(t.id)}">Ouvrir (Word / PDF)</button></p>` : ""}
      <div class="due-actions">
        <button type="button" class="btn small fait-btn" data-fait="${i}">✓ Fait</button>
        ${p && (p.enonce || p.consigne) ? `<button type="button" class="btn small" data-ia-perso="${esc(p.id)}">Faire avec l'IA</button>` : ""}
        ${p ? `<button type="button" class="btn small danger" data-dv-del="${esc(p.id)}">Supprimer</button>` : ""}
        ${cmid ? `<button type="button" class="btn small" data-ia="${esc(cmid)}"
        data-titre="${esc(d.titre)}" data-matiere="${esc(cleanCourse(d.cours))}">Faire avec l'IA</button>
        <button type="button" class="btn small" data-depot="${esc(cmid)}" data-titre="${esc(d.titre)}"
          data-matiere="${esc(cleanCourse(d.cours))}">Déposer sur Moodle</button>` : ""}
      </div>
      ${cmid ? window.depotLine?.(cmid) || "" : ""}
    </li>`;
  }).join("") : `<li class="m">${done.length ? "Tout est fait 👍" : "Rien à rendre pour l'instant."}</li>`;
  const box = $("#devoirs-faits");
  box.hidden = !done.length;
  $("#faits-n").textContent = done.length;
  $("#faits-list").innerHTML = done.map((d) => `<li class="is-done">
      <div class="due"><span class="t">${esc(d.titre)}</span><span class="left">Fait</span></div>
      <div class="m">${esc(cleanCourse(d.cours))}, pour le ${esc(d.due.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }))}</div>
      <div class="due-actions"><button type="button" class="btn small" data-defait="${all.indexOf(d)}">Remettre à faire</button></div>
    </li>`).join("");
  document.querySelectorAll("#devoirs [data-ia]").forEach((b) => {
    b.onclick = () => window.faireDevoirMoodle?.(b.dataset.ia, b.dataset.titre, b.dataset.matiere, b);
  });
  document.querySelectorAll("#devoirs [data-ia-perso]").forEach((b) => {
    b.onclick = () => window.faireDevoirPerso?.((window.persoDevoirs?.() || []).find((d) => d.id === b.dataset.iaPerso), b);
  });
  document.querySelectorAll("#devoirs [data-travail-open]").forEach((b) => { b.onclick = () => window.openTravailById?.(b.dataset.travailOpen); });
  document.querySelectorAll("#devoirs [data-dv-del]").forEach((b) => {
    b.onclick = () => {
      if (b.dataset.armed) { window.delPersoDevoir?.(b.dataset.dvDel); return; }
      b.dataset.armed = "1"; b.textContent = "Confirmer";
      setTimeout(() => { delete b.dataset.armed; b.textContent = "Supprimer"; }, 4000);
    };
  });
  document.querySelectorAll("#devoirs [data-depot]").forEach((b) => {
    b.onclick = () => window.openDepot?.(b.dataset.depot, b.dataset.titre, b.dataset.matiere);
  });
  document.querySelectorAll("#devoirs [data-envoyer]").forEach((b) => {
    b.onclick = () => window.openDepot?.(b.dataset.envoyer, b.dataset.titre, b.dataset.matiere, true);
  });
  document.querySelectorAll("[data-fait]").forEach((b) => { b.onclick = () => window.setFait?.(all[+b.dataset.fait], true); });
  document.querySelectorAll("[data-defait]").forEach((b) => { b.onclick = () => window.setFait?.(all[+b.dataset.defait], false); });
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

/* Même couleur pour une matière partout (onglet Cours et onglet Révisions) */
function tileColor(name) {
  const noms = (DATA.cours || []).map((c) => cleanCourse(c.nom)).sort((a, b) => a.localeCompare(b, "fr"));
  const n = norm(name);
  let i = noms.findIndex((x) => norm(x) === n);
  if (i < 0) i = noms.findIndex((x) => n && (norm(x).includes(n) || n.includes(norm(x))));
  if (i < 0) i = [...n].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return TILE_COLORS[i % TILE_COLORS.length];
}

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
  tickNow();
  window.persoInit?.();
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
  window.renderMemos?.();
  window.renderAlarmes?.();
  window.renderEnCours?.();
  window.renderTrajet?.();
  window.renderAccueil?.();
  window.renderCloud?.();
  window.planRappels?.();
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
  window.applyDeleted?.();
  renderAll();
}

function setSyncButton(busy) {
  const b = $("#sync");
  b.setAttribute("aria-busy", !!busy);
  b.querySelector(".sync-lbl").textContent = busy ? "Chargement…" : "Recharger";
  b.disabled = !!busy;
}

$("#sync").onclick = () => {
  checkVersion();
  // la nuit (0h-7h30) il n'y a pas de synchro automatique : le bouton la lance
  if (isNight()) requestSync(); else load();
};

/* ---------- Synchro à la demande ---------- */
function isNight() {
  const d = new Date();
  return d.getHours() * 100 + d.getMinutes() < 730;
}

let syncWait = null;
async function requestSync() {
  if (syncWait) return;
  const token = store.get("ecam-gh-token");
  if (!token || !window.gh) {
    await load();
    $("#maj").textContent += " · Pour lancer une synchro la nuit, ajoute ton jeton GitHub (onglet Micro, Réglages).";
    return;
  }
  setSyncButton(true);
  $("#sync .sync-lbl").textContent = "Synchro…";
  const before = DATA?.maj;
  try {
    // lance la synchro (droit « Actions » du jeton) ; sinon dépose une demande dans le dépôt (droit « Contenu »)
    let r = await gh("/actions/workflows/sync.yml/dispatches", { method: "POST", body: JSON.stringify({ ref: "main" }) });
    if (!r.ok) {
      const path = "/contents/perso/synchro.json";
      // 409/422 : le dépôt a bougé au même moment (une autre tâche vient d'enregistrer) -> on relit et on réessaie
      for (let essai = 0; essai < 5; essai++) {
        if (essai) await new Promise((ok) => setTimeout(ok, 1200 * essai));
        const cur = await gh(`${path}?ref=main&t=${Date.now()}`, { cache: "no-store" });
        const sha = cur.ok ? (await cur.json()).sha : undefined;
        r = await gh(path, { method: "PUT", body: JSON.stringify({ message: "Synchro demandée", branch: "main", sha,
          content: btoa(JSON.stringify({ demande: new Date().toISOString() })) }) });
        if (r.status !== 409 && r.status !== 422) break;
      }
      if (!r.ok) {
        const msg = (await r.json().catch(() => ({}))).message || "";
        throw new Error(r.status === 401 ? "jeton GitHub refusé ou expiré"
          : r.status === 403 || r.status === 404 ? `ce jeton ne peut pas écrire dans le dépôt (${r.status} ${msg})`
          : r.status === 409 || r.status === 422 ? "GitHub était occupé, réessaie dans une minute"
          : `GitHub a refusé (${r.status} ${msg})`);
      }
    }
  } catch (e) {
    setSyncButton(false);
    $("#maj").textContent = `Synchro impossible : ${e.name === "TypeError" ? "GitHub injoignable (" + e.message + ")" : e.message}`;
    return;
  }
  $("#maj").textContent = "Synchro lancée, résultat dans 2 à 3 minutes…";
  // on recharge les données dès que la nouvelle version est publiée (8 min maximum)
  const t0 = Date.now();
  syncWait = setInterval(async () => {
    let done = Date.now() - t0 > 8 * 60e3;
    try {
      const r = await fetch(`data.enc?t=${Date.now()}`, { cache: "no-store" });
      const d = await decrypt(await r.json(), store.get("ecam-pw"));
      if (d.maj !== before) done = true;
    } catch {}
    if (done) { clearInterval(syncWait); syncWait = null; await load(); }
  }, 20e3);
}

/* Nouvelle version de l'interface publiée ? On recharge la page (l'appli iPhone reste
   ouverte en arrière-plan et garderait sinon l'ancienne interface). */
const APP_VERSION = document.querySelector('meta[name="app-version"]')?.content || "";
async function checkVersion() {
  if (!APP_VERSION) return;
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    const { v } = await r.json();
    if (!v || v === APP_VERSION) return;
    // jamais pendant un enregistrement : on recharge seulement quand le micro est libre
    if (window.recordingActive?.()) return;
    if (sessionStorage.getItem("ecam-reload") === v) return; // déjà essayé : pas de boucle
    sessionStorage.setItem("ecam-reload", v);
    const u = new URL(location.href);
    u.searchParams.set("v", v); // adresse nouvelle : le cache ne peut pas resservir l'ancienne page
    location.replace(u.toString());
  } catch {}
}
checkVersion();
let lastShown = Date.now();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  checkVersion();
  // retour dans l'appli : tout est recalculé avec l'heure actuelle, et les données rechargées si besoin
  if (DATA) renderAll();
  if (Date.now() - lastShown > 10 * 60e3) load();
  lastShown = Date.now();
});
// l'appli ouverte reste à l'heure (prochain cours, matière proposée…)
setInterval(() => { if (DATA && document.visibilityState === "visible" && !params.get("now")) renderAll(); }, 5 * 60e3);

fetch("config.json", { cache: "no-store" }).then((r) => r.json()).then((c) => {
  if (!c.repo) return;
  window.REPO = c.repo;
  const a = $("#force");
  a.href = `https://github.com/${c.repo}/actions/workflows/sync.yml`;
  a.hidden = false;
  // avec le jeton, le lien lance directement la synchro depuis l'appli (à toute heure)
  a.onclick = (ev) => { if (store.get("ecam-gh-token")) { ev.preventDefault(); requestSync(); } };
}).catch(() => {});

$("#filtre").oninput = renderCours;

/* 5 onglets (design A) : certains regroupent plusieurs pages */
const PANE_GROUP = { accueil: "accueil", planning: "cours", revisions: "cours", cours: "cours", enregistrer: "enregistrer",
  ds: "ds", plus: "plus", rendre: "plus", devoirs: "plus", notes: "plus", trajet: "plus", cloud: "plus" };
const PANE_TITLE = { accueil: "Aujourd'hui", planning: "Cours", revisions: "Cours", cours: "Cours", enregistrer: "Micro",
  ds: "DS", plus: "Plus", rendre: "À rendre", devoirs: "Devoirs IA", notes: "Notes", trajet: "Trajet", cloud: "Cloud" };

function showPane(name) {
  if (!document.getElementById("pane-" + name)) name = "accueil";
  const group = PANE_GROUP[name] || name;
  document.querySelectorAll(".panes button").forEach((b) =>
    b.dataset.group === group ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  document.querySelectorAll(".pane").forEach((p) => { p.hidden = p.id !== "pane-" + name; });
  $("#pane-title").textContent = PANE_TITLE[name] || "";
  $("#subtabs").hidden = group !== "cours";
  document.querySelectorAll("#subtabs [data-goto]").forEach((b) => b.setAttribute("aria-selected", b.dataset.goto === name));
  $("#back-plus").hidden = !(group === "plus" && name !== "plus");
  if (group === "cours") store.set("ecam-cours-sub", name);
  store.set("ecam-pane", name);
  document.body.dataset.pane = name;   // ex. : le bandeau du pense-bête n'apparaît que sur l'accueil
  if (name === "trajet") window.renderTrajet?.();
  if (name === "accueil") window.renderAccueil?.();
  scrollTo(0, 0);
}
document.querySelectorAll(".panes button").forEach((b) => {
  b.onclick = () => showPane(b.dataset.group === "cours" ? store.get("ecam-cours-sub") || "planning" : b.dataset.pane);
});
document.querySelectorAll("#subtabs [data-goto]").forEach((b) => { b.onclick = () => showPane(b.dataset.goto); });
$("#back-plus").onclick = () => showPane("plus");
/* page Plus : tuiles vers les pages, ou vers les fenêtres (rappels, pense-bête, notifications…) */
document.querySelectorAll("#pane-plus [data-goto], #pane-plus [data-click]").forEach((b) => {
  b.onclick = () => {
    if (b.dataset.goto) showPane(b.dataset.goto);
    if (b.dataset.click) $(b.dataset.click)?.click();
    if (b.dataset.open) { const d = $(b.dataset.open); if (d) { d.open = true; d.scrollIntoView({ block: "start" }); } }
  };
});
{
  const last = store.get("ecam-pane");
  // nouveau design : on arrive une première fois sur l'accueil
  if (!store.get("ecam-design-a")) { store.set("ecam-design-a", "1"); showPane("accueil"); }
  else showPane(last && document.getElementById("pane-" + last) ? last : "accueil");
}

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker?.register("sw.js").catch(() => {});
}

load();
