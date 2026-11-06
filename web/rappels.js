"use strict";
/* Rappels sur l'iPhone (notifications locales, visibles écran verrouillé) : DS, devoirs à rendre,
   pense-bête. Programmés par l'appli elle-même à chaque ouverture : aucun serveur nécessaire.
   Ne fonctionne que dans l'appli iPhone (plugin LocalNotifications). */

const LNotif = window.Capacitor?.isNativePlatform?.() ? window.Capacitor?.Plugins?.LocalNotifications : null;
const RAPPELS_KEY = "ecam-rappels";      // "off" pour les couper
const RAPPEL_ID0 = 1000, RAPPEL_MAX = 60;               // iOS garde au plus 64 notifications programmées

const rappelsOn = () => store.get(RAPPELS_KEY) !== "off";
const atHour = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
const hhmm = (d) => `${d.getHours()}h${String(d.getMinutes()).padStart(2, "0")}`;

function rappelsList() {
  const real = new Date();   // vraie heure (pas le ?now= de test)
  const out = [];
  const add = (when, title, body) => {
    if (when > new Date(real.getTime() + 20e3) && when - real < 15 * 864e5) out.push({ when, title, body });
  };

  // DS à venir (pas marqués « terminé ») : la veille à 19h et le matin même à 7h
  for (const e of upcomingExams()) {
    if (window.dsFini?.(dsKey(e))) continue;
    const quand = e.sansHeure ? "heure à préciser" : `à ${hhmm(e.d0)}`;
    const salle = e.salle ? `, salle ${e.salle}` : "";
    add(atHour(addDays(e.d0, -1), 19), `DS demain : ${e.matiere}`, `${quand}${salle}. Pense à réviser !`);
    add(atHour(e.d0, 7), `DS aujourd'hui : ${e.matiere}`, `${quand}${salle}. Bon courage !`);
  }

  // devoirs à rendre (pas faits) : la veille à 18h, et 3 h avant si c'est dans la journée
  const mine = (window.persoDevoirs?.() || []).map((d) => ({ titre: d.titre, cours: d.matiere, echeance: d.echeance, url: `perso:${d.id}` }));
  for (const d of [...(DATA.devoirs || []), ...mine]) {
    const due = new Date(d.echeance);
    if (isNaN(due) || window.isFait?.(d)) continue;
    const cmid = (String(d.url).match(/id=(\d+)/) || [])[1];
    if (cmid && window.depotDone?.(cmid)) continue;
    add(atHour(addDays(due, -1), 18), `À rendre demain : ${d.titre}`, `Avant ${hhmm(due)}${d.cours ? ` (${cleanCourse(d.cours)})` : ""}.`);
    if (due.getHours() >= 10) add(new Date(due.getTime() - 3 * 3600e3), `À rendre dans 3 h : ${d.titre}`, `Avant ${hhmm(due)}.`);
  }

  // pense-bête : un rappel le jour J à 7h30 avec les notes du jour
  const byDay = {};
  for (const m of window.persoMemos?.() || []) {
    if (m.fait || !m.pour) continue;
    // rappel à une heure précise : sa propre notification
    if (m.heure) { add(new Date(`${m.pour}T${m.heure}:00`), "⏰ Rappel", m.texte.split("\n").slice(0, 3).join(" · ")); continue; }
    (byDay[m.pour] ||= []).push(m.texte.split("\n")[0]);
  }
  for (const [day, items] of Object.entries(byDay)) {
    add(new Date(`${day}T07:30:00`), items.length === 1 ? "Pense-bête" : `Pense-bête : ${items.length} choses aujourd'hui`,
      items.slice(0, 4).join(" · ") + (items.length > 4 ? ` · +${items.length - 4}` : ""));
  }
  return out.sort((a, b) => a.when - b.when).slice(0, RAPPEL_MAX);
}

let planTimer = null, asked = false;
async function programmerRappels() {
  if (!LNotif || !DATA) return;
  try {
    const old = (await LNotif.getPending()).notifications || [];
    const mineIds = old.filter((n) => +n.id >= RAPPEL_ID0 && +n.id < RAPPEL_ID0 + 1000).map((n) => ({ id: +n.id }));
    if (mineIds.length) await LNotif.cancel({ notifications: mineIds });
    if (!rappelsOn()) return;
    let perm = await LNotif.checkPermissions();
    if (perm.display !== "granted" && !asked) {
      asked = true;
      perm = await LNotif.requestPermissions();
    }
    if (perm.display !== "granted") return;
    const list = rappelsList();
    if (list.length) {
      await LNotif.schedule({ notifications: list.map((r, i) => ({
        id: RAPPEL_ID0 + i, title: r.title, body: r.body, schedule: { at: r.when, allowWhileIdle: true } })) });
    }
    rappelsState(`${list.length} rappel${list.length > 1 ? "s" : ""} programmé${list.length > 1 ? "s" : ""}${list[0] ? `, le prochain ${fmtDayLong(list[0].when)} à ${hhmm(list[0].when)}` : ""}.`);
  } catch (e) {
    rappelsState(`Rappels indisponibles : ${e.message || e}`);
  }
}

function rappelsState(text) {
  const el = $("#rappels-state");
  if (el) el.textContent = text;
}

/* Reprogrammés après chaque changement (regroupés pour ne pas le faire 10 fois d'affilée) */
window.planRappels = () => {
  clearTimeout(planTimer);
  planTimer = setTimeout(programmerRappels, 1500);
};

/* Réglage dans la fenêtre des notifications (seulement dans l'appli iPhone) */
(function setup() {
  const box = $("#rappels-box");
  if (!box) return;
  if (!LNotif) {
    box.querySelector("#rappels-native").hidden = true;
    return;
  }
  box.querySelector("#rappels-web").hidden = true;
  const cb = $("#rappels-on");
  cb.checked = rappelsOn();
  cb.onchange = () => {
    store.set(RAPPELS_KEY, cb.checked ? "on" : "off");
    rappelsState(cb.checked ? "Programmation…" : "Rappels coupés sur cet iPhone.");
    asked = false;
    window.planRappels();
  };
})();
