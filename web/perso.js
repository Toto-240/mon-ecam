"use strict";
/* Ce que tu ajoutes toi-même : devoirs marqués « faits » et DS annoncés à l'oral.
   Enregistré sur l'appareil, et chiffré sur GitHub (perso/etat.enc) avec ton jeton pour
   être le même sur le PC et le téléphone. Utilise DATA, store, esc, decrypt, unb64 (app.js)
   et gh, TOKEN_KEY (revisions.js, appelé seulement après chargement). */

const PERSO_PATH = "/contents/perso/etat.enc";
const PERSO_BASE = "ecam-perso-base";     // dernier état connu de GitHub
const PERSO_PENDING = "ecam-perso-ops";   // changements pas encore envoyés
const emptyPerso = () => ({ faits: {}, ds: [], dsSel: {}, dsFinis: {}, devoirs: [], memos: [], maj: "" });

const persoStore = {
  get(k, def) { try { return JSON.parse(store.get(k)) ?? def; } catch { return def; } },
  set(k, v) { store.set(k, JSON.stringify(v)); },
};

/* Un changement = une petite opération, rejouée sur la version de GitHub au moment d'envoyer */
function applyOp(s, op) {
  s = { ...emptyPerso(), ...s, faits: { ...(s?.faits || {}) }, ds: [...(s?.ds || [])], dsSel: { ...(s?.dsSel || {}) }, dsFinis: { ...(s?.dsFinis || {}) }, devoirs: [...(s?.devoirs || [])], memos: [...(s?.memos || [])] };
  if (op.op === "fait") {
    if (op.val) s.faits[op.key] = op.val; else delete s.faits[op.key];
  } else if (op.op === "ds+") {
    s.ds = s.ds.filter((d) => d.id !== op.ds.id).concat(op.ds);
  } else if (op.op === "memo+") {
    const i = s.memos.findIndex((m) => m.id === op.memo.id);
    if (i >= 0) s.memos[i] = op.memo; else s.memos.push(op.memo);
  } else if (op.op === "memo-") {
    s.memos = s.memos.filter((m) => m.id !== op.id);
  } else if (op.op === "dv+") {
    s.devoirs = s.devoirs.filter((d) => d.id !== op.dv.id).concat(op.dv);
  } else if (op.op === "dv-") {
    s.devoirs = s.devoirs.filter((d) => d.id !== op.id);
  } else if (op.op === "dsfini") {
    if (op.val) s.dsFinis[op.key] = op.val; else delete s.dsFinis[op.key];
  } else if (op.op === "dssel") {
    if (op.exclus?.length) s.dsSel[op.key] = op.exclus; else delete s.dsSel[op.key];
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
  s.dsFinis = Object.fromEntries(Object.entries(s.dsFinis || {}).filter(([, v]) => v >= old));
  s.ds = s.ds.filter((d) => (d.date || "") >= dsOld);
  s.devoirs = (s.devoirs || []).filter((d) => (d.echeance || "") >= dsOld);
  s.memos = (s.memos || []).filter((m) => !m.fait || m.fait >= dsOld);   // faits gardés 2 mois
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
  window.renderMemos?.();
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

/* Requête GitHub avec délai max : une requête coupée (téléphone en veille) ne bloque plus la synchro */
function ghT(path, opts = {}, ms = 25000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return gh(path, { ...opts, signal: ctl.signal })
    .catch((e) => { throw new Error(e.name === "AbortError" ? "GitHub ne répond pas (délai dépassé)" : "pas de connexion Internet"); })
    .finally(() => clearTimeout(t));
}

async function fetchRemote() {
  const r = await ghT(`${PERSO_PATH}?ref=main&t=${Date.now()}`, { cache: "no-store" });
  if (r.status === 404) return { sha: null, state: null };
  if (!r.ok) throw new Error(r.status === 401 ? "jeton GitHub refusé" : `GitHub ne répond pas (${r.status})`);
  const j = await r.json();
  const state = await decrypt(JSON.parse(atob(j.content.replace(/\s/g, ""))), store.get("ecam-pw"));
  return { sha: j.sha, state };
}

let syncing = null, syncStart = 0, lastPull = 0;
function persoSync() {
  if (!hasToken()) { persoNote(); return Promise.resolve(); }
  if (syncing && Date.now() - syncStart < 90e3) return syncing.then(() => persoSync());
  syncStart = Date.now();   // une synchro bloquée depuis plus de 90 s est abandonnée
  syncing = (async () => {
    for (let essai = 0; essai < 3; essai++) {
      const { sha, state } = await fetchRemote();
      const ops = persoStore.get(PERSO_PENDING, []);
      if (!ops.length) { if (state) persoStore.set(PERSO_BASE, state); return; }
      const next = prune(ops.reduce(applyOp, state || emptyPerso()));
      const r = await ghT(PERSO_PATH, { method: "PUT", body: JSON.stringify({
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
  })().then(() => { store.set("ecam-perso-ok", new Date().toISOString()); store.del("ecam-perso-err"); persoNote(); },
    (e) => { store.set("ecam-perso-err", e.message); persoNote(`Pas encore synchronisé : ${e.message}. Réessai automatique.`); })
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
  try { rerender(); } catch (e) { console.error(e); }   // un souci d'affichage ne doit jamais bloquer l'envoi
  persoNote();
  persoSync();
}

function persoNote(err) {
  const pending = persoStore.get(PERSO_PENDING, []).length;
  const text = err || (!hasToken() && pending
    ? "Enregistré sur cet appareil seulement. Ajoute ton jeton GitHub (onglet Micro, Réglages) pour le retrouver sur tes autres appareils."
    : "");
  document.querySelectorAll(".perso-note").forEach((el) => { el.textContent = text; el.hidden = !text; });
  const st = $("#memo-sync-state");
  if (st) {
    const ok = store.get("ecam-perso-ok"), err = store.get("ecam-perso-err");
    st.textContent = !hasToken() ? "Pas de jeton GitHub sur cet appareil : notes gardées ici seulement."
      : err ? `⚠ Pas synchronisé (${pending} en attente) : ${err}`
      : pending ? `⏳ ${pending} changement${pending > 1 ? "s" : ""} en cours d'envoi…`
      : `✓ Synchronisé${ok ? ` à ${new Date(ok).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}`;
    st.className = `small memo-sync-state${err || !hasToken() ? " bad" : pending ? " wait" : " ok"}`;
  }
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
window.dsExclus = (key) => PERSO.dsSel?.[key] || [];
window.setDsExclus = (key, exclus) => persoChange({ op: "dssel", key, exclus });
window.dsFini = (key) => !!PERSO.dsFinis?.[key];
window.setDsFini = (key, on) => persoChange({ op: "dsfini", key, val: on ? new Date().toISOString() : null });

/* Devoirs à rendre ajoutés à la main (énoncé chiffré dans perso/enonces/) */
window.persoDevoirs = () => PERSO.devoirs || [];
window.addPersoDevoir = (dv) => persoChange({ op: "dv+", dv });
window.delPersoDevoir = async (id) => {
  const dv = (PERSO.devoirs || []).find((d) => d.id === id);
  persoChange({ op: "dv-", id });
  if (dv?.enonce && hasToken()) {   // l'énoncé aussi (sans bloquer si ça échoue)
    try {
      const path = `/contents/perso/enonces/${encodeURIComponent(id)}.enc`;
      const r = await gh(`${path}?ref=main&t=${Date.now()}`, { cache: "no-store" });
      if (r.ok) await gh(path, { method: "DELETE", body: JSON.stringify({ message: "Suppression", sha: (await r.json()).sha, branch: "main" }) });
    } catch {}
  }
};
window.uploadEnonce = async (id, file) => {
  if (!hasToken()) throw new Error("ajoute d'abord ton jeton GitHub (onglet Micro, Réglages)");
  const blob = await encryptUpload({ id, nom: file.name, type: file.type }, await file.arrayBuffer());
  const r = await gh(`/contents/perso/enonces/${encodeURIComponent(id)}.enc`, { method: "PUT",
    body: JSON.stringify({ message: "Énoncé ajouté", branch: "main", content: await toBase64(blob) }) });
  if (!r.ok) throw new Error(r.status === 401 ? "jeton GitHub refusé" : r.status === 422 ? "fichier trop gros" : `envoi refusé (${r.status})`);
};

/* Pense-bête */
window.persoMemos = () => PERSO.memos || [];
window.saveMemo = (memo) => persoChange({ op: "memo+", memo });
window.delMemo = (id) => persoChange({ op: "memo-", id });

window.persoSyncNow = () => { lastPull = Date.now(); return persoSync(); };
window.persoShowState = () => persoNote(store.get("ecam-perso-err") ? `Pas encore synchronisé : ${store.get("ecam-perso-err")}.` : undefined);
