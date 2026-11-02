"use strict";
/* Ce que tu ajoutes toi-même : devoirs marqués « faits » et DS annoncés à l'oral.
   Enregistré sur l'appareil, et chiffré sur GitHub (perso/etat.enc) avec ton jeton pour
   être le même sur le PC et le téléphone. Utilise DATA, store, esc, decrypt, unb64 (app.js)
   et gh, TOKEN_KEY (revisions.js, appelé seulement après chargement). */

const PERSO_PATH = "/contents/perso/etat.enc";
const PERSO_BASE = "ecam-perso-base";     // dernier état connu de GitHub
const PERSO_PENDING = "ecam-perso-ops";   // changements pas encore envoyés
const emptyPerso = () => ({ faits: {}, ds: [], maj: "" });

const persoStore = {
  get(k, def) { try { return JSON.parse(store.get(k)) ?? def; } catch { return def; } },
  set(k, v) { store.set(k, JSON.stringify(v)); },
};

/* Un changement = une petite opération, rejouée sur la version de GitHub au moment d'envoyer */
function applyOp(s, op) {
  s = { ...emptyPerso(), ...s, faits: { ...(s?.faits || {}) }, ds: [...(s?.ds || [])] };
  if (op.op === "fait") {
    if (op.val) s.faits[op.key] = op.val; else delete s.faits[op.key];
  } else if (op.op === "ds+") {
    s.ds = s.ds.filter((d) => d.id !== op.ds.id).concat(op.ds);
  } else if (op.op === "ds-") {
    s.ds = s.ds.filter((d) => d.id !== op.id);
  }
  s.maj = op.quand || new Date().toISOString();
  return s;
}

function prune(s) {
  // on oublie les vieux « faits » (4 mois) et les DS passés depuis plus de 2 mois
  const old = new Date(Date.now() - 120 * 864e5).toISOString(), dsOld = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  s.faits = Object.fromEntries(Object.entries(s.faits).filter(([, v]) => v >= old));
  s.ds = s.ds.filter((d) => (d.date || "") >= dsOld);
  return s;
}

let PERSO = emptyPerso();
function recompute() {
  let base = persoStore.get(PERSO_BASE, null);
  // la version publiée dans l'appli peut être plus récente que celle gardée ici
  if (DATA?.perso && (!base || (DATA.perso.maj || "") > (base.maj || ""))) {
    base = DATA.perso;
    persoStore.set(PERSO_BASE, base);
  }
  PERSO = persoStore.get(PERSO_PENDING, []).reduce(applyOp, base || emptyPerso());
}

function rerender() {
  if (!DATA) return;
  renderPlanning();
  renderDevoirs();
  window.renderDS?.();
}

/* ---------- Chiffrement (même enveloppe que crypto_util.encrypt_json) ---------- */
async function encryptJson(obj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key,
    new TextEncoder().encode(JSON.stringify(obj))));
  const b64 = (u) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
  return JSON.stringify({ v: 1, iter: 250000, salt: b64(salt), iv: b64(iv), ct: b64(ct) });
}

/* ---------- GitHub ---------- */
const hasToken = () => !!store.get(TOKEN_KEY);

async function fetchRemote() {
  const r = await gh(`${PERSO_PATH}?ref=main&t=${Date.now()}`, { cache: "no-store" });
  if (r.status === 404) return { sha: null, state: null };
  if (!r.ok) throw new Error(r.status === 401 ? "jeton GitHub refusé" : `GitHub ne répond pas (${r.status})`);
  const j = await r.json();
  const state = await decrypt(JSON.parse(atob(j.content.replace(/\s/g, ""))), store.get("ecam-pw"));
  return { sha: j.sha, state };
}

let syncing = null, lastPull = 0;
function persoSync() {
  if (!hasToken()) { persoNote(); return Promise.resolve(); }
  if (syncing) return syncing.then(() => persoSync());
  syncing = (async () => {
    for (let essai = 0; essai < 3; essai++) {
      const { sha, state } = await fetchRemote();
      const ops = persoStore.get(PERSO_PENDING, []);
      if (!ops.length) { if (state) persoStore.set(PERSO_BASE, state); return; }
      const next = prune(ops.reduce(applyOp, state || emptyPerso()));
      const r = await gh(PERSO_PATH, { method: "PUT", body: JSON.stringify({
        message: "Mise à jour", branch: "main", ...(sha ? { sha } : {}),
        content: btoa(await encryptJson(next, store.get("ecam-pw"))) }) });
      if (r.ok) {
        // retire seulement les changements envoyés (d'autres ont pu arriver entre-temps)
        const sent = new Set(ops.map((o) => o.n));
        persoStore.set(PERSO_PENDING, persoStore.get(PERSO_PENDING, []).filter((o) => !sent.has(o.n)));
        persoStore.set(PERSO_BASE, next);
        return;
      }
      if (r.status !== 409 && r.status !== 422) throw new Error(r.status === 403 ? "ce jeton ne peut pas modifier le dépôt" : `envoi refusé (${r.status})`);
    }
    throw new Error("GitHub occupé, nouvel essai plus tard");
  })().then(() => persoNote(), (e) => persoNote(`Pas encore synchronisé : ${e.message}. Réessai automatique.`))
    .finally(() => {
      syncing = null;
      const before = JSON.stringify(PERSO);
      recompute();
      if (JSON.stringify(PERSO) !== before) rerender();
    });
  return syncing;
}

function persoChange(op) {
  op.n = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  op.quand = new Date().toISOString();
  persoStore.set(PERSO_PENDING, [...persoStore.get(PERSO_PENDING, []), op]);
  recompute();
  rerender();
  persoSync();
}

function persoNote(err) {
  const pending = persoStore.get(PERSO_PENDING, []).length;
  const text = err || (!hasToken() && pending
    ? "Enregistré sur cet appareil seulement. Ajoute ton jeton GitHub (onglet Micro, Réglages) pour le retrouver sur tes autres appareils."
    : "");
  document.querySelectorAll(".perso-note").forEach((el) => { el.textContent = text; el.hidden = !text; });
}

/* Appelé à chaque affichage : récupère la dernière version de GitHub (au plus une fois par minute) */
window.persoInit = function () {
  recompute();
  persoNote();
  if (hasToken() && Date.now() - lastPull > 60e3) {
    lastPull = Date.now();
    persoSync();
  }
};
addEventListener("online", () => persoSync());

/* ---------- Ce qu'utilisent les onglets ---------- */
const devoirKey = (d) => d.url || `${d.titre}|${d.cours}`;
window.isFait = (d) => !!PERSO.faits[devoirKey(d)];
window.setFait = (d, on) => persoChange({ op: "fait", key: devoirKey(d), val: on ? new Date().toISOString() : null });
window.persoDS = () => PERSO.ds;
window.addPersoDS = (ds) => persoChange({ op: "ds+", ds });
window.delPersoDS = (id) => persoChange({ op: "ds-", id });
