"use strict";
/* Impression : DS blanc et corrigé, fiches de révision, QCM (corrigé à part), dossier d'un DS,
   toute une matière. On choisit les parties, puis la mise en page A4 (feuille blanche) s'imprime :
   fenêtre d'impression d'iOS dans l'appli iPhone (AirPrint ou « Enregistrer en PDF »), du navigateur sur PC. */
(() => {
  // appli iPhone ? (vérifié au moment du clic) et son module natif, par le chemin le plus direct
  const isApp = () => !!window.Capacitor?.isNativePlatform?.();
  const plugin = () => {
    try {
      return window.Capacitor?.Plugins?.Dicta || (typeof Dicta !== "undefined" && Dicta) || window.Capacitor.registerPlugin("Dicta");
    } catch { return null; }
  };
  const unimpl = (e) => /not implemented|unimplemented/i.test(String(e?.message || e?.code || e));
  const L = "ABCDEFGH";

  /* ---------- Parties imprimables ---------- */
  const P = {
    revision: (r) => r?.md && { key: "rev", label: "Fiche de révision", html: md(r.md) },
    fiches: (fs, label = "Fiches de cours") => fs?.length && {
      key: "fiches", label: `${label} (${fs.length})`,
      html: `<h1>Sommaire</h1><ol class="p-toc">${fs.map((f) => `<li>${esc(ficheTitle(f))}${f.date ? ` <span>· ${esc(fmtDate(f.date))}</span>` : ""}</li>`).join("")}</ol>`
        + fs.map((f) => `<section class="p-fiche"><p class="p-meta">${esc(f.matiere || "")}${f.date ? ` · ${esc(fmtDate(f.date))}` : ""}</p>${md(f.md)}</section>`).join(""),
    },
    qcm: (r) => r?.qcm?.length && {
      key: "qcm", label: `QCM (${r.qcm.length} questions)`,
      html: `<h1>QCM</h1><ol class="p-qcm">${r.qcm.map((q) => `<li><p>${inline(esc(q.question))}</p>
        <ul>${q.choix.map((c, k) => `<li><span class="p-box">${L[k]}</span> ${inline(esc(c))}</li>`).join("")}</ul></li>`).join("")}</ol>`,
    },
    qcmCorrige: (r) => r?.qcm?.length && {
      key: "qcmc", label: "Corrigé du QCM",
      html: `<h1>Corrigé du QCM</h1><ol class="p-corr">${r.qcm.map((q) => `<li><b>${L[q.bonne]}</b> : ${inline(esc(q.choix[q.bonne] || ""))}
        ${q.explication ? `<div class="p-expl">${inline(esc(q.explication))}</div>` : ""}</li>`).join("")}</ol>`,
    },
    blanc: (r) => r?.blanc?.sujet && { key: "blanc", label: "DS blanc (sujet)", html: md(r.blanc.sujet) },
    corrige: (r) => r?.blanc?.corrige && { key: "corrige", label: "Corrigé du DS blanc", html: `<h1>Corrigé</h1>${md(r.blanc.corrige)}` },
    plan: (r) => r?.plan?.length && {
      key: "plan", label: "Plan de révision",
      html: `<h1>Plan de révision</h1><ol class="p-plan">${r.plan.map((j) => `<li><b>${esc(fmtDayLong(new Date(`${j.date}T12:00:00`)))}</b>${j.minutes ? ` · ${esc(j.minutes)} min` : ""} : ${esc(j.titre || "")}
        <ul>${(j.taches || []).map((t) => `<li>☐ ${esc(t)}</li>`).join("")}</ul></li>`).join("")}</ol>`,
    },
  };
  const ficheTitle = (f) => (String(f.md || "").match(/^#\s+(.+)/m)?.[1] || f.titre || "Fiche").replace(/[*_`]/g, "");

  // en-tête encadré (titre, date) : absent quand on exporte juste des fiches
  let bare = false;
  const head = (title, sub) => bare ? "" : `<header class="p-head"><div class="p-title">${esc(title)}</div><div class="p-sub">${esc(sub || "")}
      <span>Mon ECAM · ${esc(fmtDate(dayIso(new Date())))}</span></div></header>`;
  // juste les fiches, l'une après l'autre (chacune sur une nouvelle page), sans sommaire ni encadré
  const justFiches = (fs) => fs?.length && { key: "fiches", label: `Fiches (${fs.length})`,
    html: fs.map((f) => `<section class="p-fiche">${md(f.md)}</section>`).join("") };

  /* ---------- Fenêtre « que veux-tu imprimer ? » ---------- */
  function choose(title, sub, parts, off = [], nu = false) {
    parts = parts.filter(Boolean);
    bare = nu;
    if (!parts.length) return;
    let sheet = $("#print-sheet");
    if (!sheet) {
      sheet = document.createElement("div");
      sheet.id = "print-sheet";
      sheet.className = "sheet";
      sheet.setAttribute("role", "dialog");
      sheet.setAttribute("aria-modal", "true");
      document.body.appendChild(sheet);
      sheet.addEventListener("click", (ev) => { if (ev.target === sheet) sheet.hidden = true; });
    }
    sheet.innerHTML = `<div class="sheet-card">
      <div class="sheet-head"><h2>📄 PDF ou impression</h2><button type="button" class="btn small" data-pclose>Fermer</button></div>
      <p class="muted small">${esc(title)}</p>
      ${parts.map((p) => `<label class="check"><input type="checkbox" data-ppart="${p.key}"${off.includes(p.key) ? "" : " checked"}> <span>${esc(p.label)}</span></label>`).join("")}
      <p class="muted small">Chaque partie commence sur une nouvelle page.</p>
      <div class="row"><button type="button" class="btn primary" data-pgo="print">Imprimer${isApp() ? " ou PDF" : ""}</button>
        ${isApp() ? `<button type="button" class="btn" data-pgo="files">Enregistrer le PDF sur le téléphone</button>` : `<button type="button" class="btn" data-pgo="download">📄 Télécharger le PDF</button>`}</div>
      ${isApp() ? `<p class="muted small">« Imprimer ou PDF » ouvre la fenêtre d'impression de l'iPhone : choisis ton imprimante, ou touche le bouton de partage en haut pour l'enregistrer en PDF.</p>` : ""}
      <p class="small" data-pmsg aria-live="polite"></p>
      <p class="muted p-ver">version ${esc((typeof APP_VERSION !== "undefined" && APP_VERSION) || "?")} · ${isApp() ? `appli iPhone${plugin() ? "" : " (module absent)"}` : "navigateur"}</p></div>`;
    sheet.hidden = false;
    const msg = sheet.querySelector("[data-pmsg]");
    sheet.querySelector("[data-pclose]").onclick = () => { sheet.hidden = true; };
    sheet.querySelectorAll("[data-pgo]").forEach((b) => {
      b.onclick = async () => {
        const keep = new Set([...sheet.querySelectorAll("[data-ppart]:checked")].map((c) => c.dataset.ppart));
        const chosen = parts.filter((p) => keep.has(p.key));
        if (!chosen.length) { msg.textContent = "Coche au moins une partie."; return; }
        const html = chosen.map((p) => `<section class="p-part">${p.html}</section>`).join("");
        if (b.dataset.pgo === "print" && !isApp()) { sheet.hidden = true; return printNow(title, sub, html); }
        sheet.querySelectorAll("[data-pgo]").forEach((x) => { x.disabled = true; });
        msg.textContent = "Fabrication du PDF…";
        try {
          if (b.dataset.pgo === "print") {
            msg.textContent = "Ouverture de la fenêtre d'impression…";
            const ok = await nativePrint(title, sub, html);
            msg.textContent = ok ? "" : "Impression annulée.";
            if (!ok) return;
            sheet.hidden = true;
            return;
          }
          const r = await makePdf(title, sub, html, b.dataset.pgo);
          msg.innerHTML = r;
        } catch (e) {
          msg.textContent = unimpl(e)
            ? "Installe la nouvelle version de l'appli iPhone (avec Sideloadly) pour enregistrer le PDF."
            : `Impossible : ${e?.message || e}`;
        } finally {
          sheet.querySelectorAll("[data-pgo]").forEach((x) => { x.disabled = false; });
        }
      };
    });
  }

  /* iPhone : la vraie fenêtre d'impression d'iOS (imprimante AirPrint, ou partage › Enregistrer en PDF),
     avec le document préparé dans une page à part ; ancienne appli : impression de la page. */
  async function nativePrint(title, sub, html) {
    const root = document.createElement("div");
    root.id = "print-root";
    root.innerHTML = head(title, sub) + html;
    const doc = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=794">
      <style>html, body { margin: 0; background: #fff; } #print-root { display: block !important; } ${printCss()}</style></head>
      <body>${root.outerHTML}</body></html>`;
    window.printBusy = true;
    try {
      const r = await plugin().printHtml({ title, html: doc });
      return r?.printed !== false;
    } catch (e) {
      if (!unimpl(e)) throw e;
      await printNow(title, sub, html);   // ancienne appli
      return true;
    } finally {
      setTimeout(() => { window.printBusy = false; }, 3000);
    }
  }

  /* iPhone : PDF fabriqué ici et rangé sur le téléphone, dans Fichiers (aucune fenêtre d'iOS, rien dans le Cloud) */
  async function makePdf(title, sub, html, mode) {
    const root = document.createElement("div");
    root.innerHTML = head(title, sub) + html;
    const data = await window.pdfFromPrintRoot(root, title);
    const name = `${title.replace(/[·\/:]/g, "-").replace(/\s+/g, " ").trim()}.pdf`;
    if (mode === "files") {
      const r = await plugin().savePdf({ data, name });
      return `✓ PDF enregistré : app <b>Fichiers</b> › Sur mon iPhone › Mon ECAM › Impressions › <b>${esc(r?.name || name)}</b>`;
    }
    // navigateur (ordinateur, tablette) : téléchargement direct du fichier
    const bin = atob(data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60e3);
    return `✓ PDF téléchargé : <b>${esc(name)}</b> (dossier Téléchargements)`;

  }

  /* ---------- Mise en page et impression ---------- */
  async function printNow(title, sub, html) {
    let root = $("#print-root");
    if (!root) { root = document.createElement("div"); root.id = "print-root"; document.body.appendChild(root); }
    root.innerHTML = head(title, sub) + html;
    document.documentElement.classList.add("printing");
    window.printBusy = true;
    root.onclick = () => done();   // si le navigateur ne prévient pas de la fin : un appui ferme l'aperçu
    const done = () => { document.documentElement.classList.remove("printing"); root.innerHTML = ""; setTimeout(() => { window.printBusy = false; }, 3000); };
    try {
      window.addEventListener("afterprint", done, { once: true });
      window.print();
    } catch (e) {
      done();
      diag("erreur", { msg: String(e?.message || e).slice(0, 120) });
      alert(/not implemented|n'est pas/i.test(e?.message || "")
        ? "L'impression demande la nouvelle version de l'appli iPhone (à réinstaller avec Sideloadly)."
        : `Impression impossible : ${e?.message || e}`);
    }
  }

  /* Journal de diagnostic de l'impression (iPhone) : ce qui s'est passé, et si l'appli s'est rechargée */
  function diag(what, extra) {
    try {
      const j = JSON.parse(localStorage.getItem("ecam-print-diag") || "[]").slice(-15);
      j.push({ t: new Date().toISOString().slice(11, 19), what, ...(extra || {}) });
      localStorage.setItem("ecam-print-diag", JSON.stringify(j));
      if (what === "partage ouvert") localStorage.setItem("ecam-print-open", String(Date.now()));
      if (what === "partage fermé") localStorage.removeItem("ecam-print-open");
    } catch {}
  }
  window.printDiag = () => { try { return JSON.parse(localStorage.getItem("ecam-print-diag") || "[]"); } catch { return []; } };
  // au démarrage : la page s'est-elle rechargée pendant que la feuille de partage était ouverte ?
  try {
    const open = +localStorage.getItem("ecam-print-open");
    if (open && Date.now() - open < 5 * 60e3) {
      localStorage.removeItem("ecam-print-open");
      diag("appli rechargée pendant le partage", { apres_s: Math.round((Date.now() - open) / 1000) });
      setTimeout(() => alert(`Diagnostic impression : l'appli s'est rechargée ${Math.round((Date.now() - open) / 1000)} s après l'ouverture du partage. Envoie-moi une capture de ce message.`), 1500);
    }
  } catch {}

  /* Les règles de mise en page de l'impression (celles de #print-root dans app.css) */
  function printCss() {
    const out = [];
    const walk = (rules) => {
      for (const r of rules) {
        if (r.cssRules && !r.selectorText) walk(r.cssRules);
        else if (r.selectorText?.includes("#print-root") && !r.selectorText.includes("html.printing")) out.push(r.cssText);
      }
    };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch {} }
    return out.join("\n").replace(/#print-root\s*\{\s*display:\s*none;?\s*\}/g, "");
  }

  /* ---------- Raccourcis utilisés par les onglets ---------- */
  window.printRevision = (r) => choose(`Révision · ${r.matiere}`, r.ds ? `DS du ${fmtDate(String(r.ds).slice(0, 10))}` : "",
    [P.revision(r), P.qcm(r), P.qcmCorrige(r), P.blanc(r), P.corrige(r), P.plan(r)], ["plan"]);
  window.printBlanc = (r) => choose(`DS blanc · ${r.matiere}`, r.ds ? `DS du ${fmtDate(String(r.ds).slice(0, 10))}` : "",
    [P.blanc(r), P.corrige(r)]);
  window.printDossierDS = (e, r, fiches) => choose(`DS · ${e.matiere}`, fmtDayLong(e.d0),
    [P.revision(r), P.fiches(fiches, "Fiches cochées"), P.qcm(r), P.qcmCorrige(r), P.blanc(r), P.corrige(r), P.plan(r)], ["plan"]);
  window.printMatiere = (m, fiches) => choose(`Fiches · ${m}`, "", [justFiches(fiches)], [], true);
  window.printFiche = (f) => choose(ficheTitle(f), "", [justFiches([f])], [], true);
  /* Fiches cochées : impression directe ou PDF direct, sans fenêtre de choix */
  window.ficheAction = async (m, fiches, mode, msgEl) => {
    const part = justFiches(fiches);
    if (!part) return;
    bare = true;
    const title = `Fiches · ${m}`, html = `<section class="p-part">${part.html}</section>`;
    const say = (t) => { if (msgEl) msgEl.innerHTML = t; };
    try {
      if (mode === "print") {
        if (!isApp()) return printNow(title, "", html);
        say("Ouverture de la fenêtre d'impression…");
        await nativePrint(title, "", html);
        return say("");
      }
      say("Fabrication du PDF…");
      say(await makePdf(title, "", html, isApp() ? "files" : "download"));
    } catch (e) {
      say(unimpl(e) ? "Installe la nouvelle version de l'appli iPhone (avec Sideloadly) pour ça." : `Impossible : ${esc(e?.message || String(e))}`);
    }
  };
  window.printFiches = (m, fiches) => choose(`Fiches · ${m}`, "", [justFiches(fiches)], [], true);
})();
