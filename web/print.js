"use strict";
/* Impression : DS blanc et corrigé, fiches de révision, QCM (corrigé à part), dossier d'un DS,
   toute une matière. On choisit les parties, puis la mise en page A4 (feuille blanche) s'imprime :
   fenêtre d'impression d'iOS dans l'appli iPhone (AirPrint ou « Enregistrer en PDF »), du navigateur sur PC. */
(() => {
  const Native = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.registerPlugin?.("Dicta") : null;
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

  /* ---------- Fenêtre « que veux-tu imprimer ? » ---------- */
  function choose(title, sub, parts, off = []) {
    parts = parts.filter(Boolean);
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
      <div class="sheet-head"><h2>🖨️ Imprimer</h2><button type="button" class="btn small" data-pclose>Fermer</button></div>
      <p class="muted small">${esc(title)}</p>
      ${parts.map((p) => `<label class="check"><input type="checkbox" data-ppart="${p.key}"${off.includes(p.key) ? "" : " checked"}> <span>${esc(p.label)}</span></label>`).join("")}
      <p class="muted small">Chaque partie commence sur une nouvelle page.</p>
      <div class="row"><button type="button" class="btn primary" data-pgo>Imprimer</button></div>
      <p class="small" data-pmsg aria-live="polite"></p></div>`;
    sheet.hidden = false;
    sheet.querySelector("[data-pclose]").onclick = () => { sheet.hidden = true; };
    sheet.querySelector("[data-pgo]").onclick = async () => {
      const keep = new Set([...sheet.querySelectorAll("[data-ppart]:checked")].map((c) => c.dataset.ppart));
      const chosen = parts.filter((p) => keep.has(p.key));
      if (!chosen.length) { sheet.querySelector("[data-pmsg]").textContent = "Coche au moins une partie."; return; }
      sheet.hidden = true;
      await printNow(title, sub, chosen.map((p) => `<section class="p-part">${p.html}</section>`).join(""));
    };
  }

  /* ---------- Mise en page et impression ---------- */
  async function printNow(title, sub, html) {
    let root = $("#print-root");
    if (!root) { root = document.createElement("div"); root.id = "print-root"; document.body.appendChild(root); }
    root.innerHTML = `<header class="p-head"><div class="p-title">${esc(title)}</div><div class="p-sub">${esc(sub || "")}
      <span>Mon ECAM · ${esc(fmtDate(dayIso(new Date())))}</span></div></header>${html}`;
    document.documentElement.classList.add("printing");
    window.printBusy = true;
    const done = () => { document.documentElement.classList.remove("printing"); root.innerHTML = ""; setTimeout(() => { window.printBusy = false; }, 3000); };
    try {
      if (Native) {
        // iPhone : PDF A4 fabriqué ici (jsPDF), puis la feuille de partage d'iOS (Imprimer, Fichiers…),
        // comme le PDF des devoirs. L'impression d'iOS n'est plus utilisée (sa fenêtre se refermait).
        document.documentElement.classList.remove("printing");
        const data = await window.pdfFromPrintRoot(root, title);
        const name = `${title.replace(/[·\/:]/g, "-").replace(/\s+/g, " ").trim()}.pdf`;
        done();
        await Native.share({ data, name });
        return;
      }
      if (Native?.printPage) {
        await new Promise((r) => setTimeout(r, 150));   // le temps d'afficher la mise en page
        await Native.printPage({ title });
        done();
      } else {
        window.addEventListener("afterprint", done, { once: true });
        window.print();
        setTimeout(() => { if (!window.matchMedia("print").matches) done(); }, 1500);
      }
    } catch (e) {
      done();
      alert(/not implemented|n'est pas/i.test(e?.message || "")
        ? "L'impression demande la nouvelle version de l'appli iPhone (à réinstaller avec Sideloadly)."
        : `Impression impossible : ${e?.message || e}`);
    }
  }

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
  window.printMatiere = (m, fiches, r) => choose(`Révisions · ${m}`, "Toute la matière",
    [P.revision(r), P.fiches(fiches, "Toutes les fiches de cours"), P.qcm(r), P.qcmCorrige(r)]);
  window.printFiches = (m, fiches) => choose(`Fiches · ${m}`, "", [P.fiches(fiches)]);
})();
