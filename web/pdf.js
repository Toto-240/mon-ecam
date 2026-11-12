"use strict";
/* PDF A4 fabriqué dans l'appli (jsPDF), à partir de la mise en page d'impression (#print-root) :
   titres, paragraphes (gras, italique, code), listes, tableaux, code, QCM. Sans l'impression d'iOS. */
(() => {
  let libP = null;
  function loadLib() {
    if (window.jspdf) return Promise.resolve();
    return libP ||= new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = "lib/jspdf.umd.min.js";
      s.onload = ok;
      s.onerror = () => { libP = null; ko(new Error("bibliothèque PDF introuvable (connexion ?)")); };
      document.head.appendChild(s);
    });
  }

  // les polices de base des PDF ne connaissent que l'alphabet latin : on remplace le reste
  const SUBS = { "→": "->", "←": "<-", "↔": "<->", "⇒": "=>", "⇔": "<=>", "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~",
    "∞": "infini", "√": "racine ", "∑": "somme ", "∫": "integrale ", "π": "pi", "Δ": "Delta", "δ": "delta", "α": "alpha",
    "β": "beta", "γ": "gamma", "λ": "lambda", "θ": "theta", "Ω": "Ohm", "ω": "omega", "σ": "sigma", "φ": "phi", "ρ": "rho",
    "τ": "tau", "ε": "epsilon", "∈": " dans ", "∀": "pour tout ", "∃": "il existe ", "⊂": "inclus dans", "∪": "U", "∩": "inter",
    "−": "-", "–": "-", "—": "-", "…": "...", " ": " ", " ": " ", "☐": "[ ]", "✓": "v", "✔": "v", "✗": "x", "²": "²", "³": "³" };
  const clean = (t) => String(t || "").replace(/[^\u0000-ÿ€‘’“”•…–—‰Œœ]/gu, (c) => SUBS[c] ?? "");

  async function make(root, title) {
    await loadLib();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const M = 48, MAXW = W - 2 * M;
    let y = M, first = true;

    const newPage = () => { doc.addPage(); y = M; };
    const ensure = (h) => { if (y + h > H - M) newPage(); };
    const font = (style = "normal", size = 10.5, fam = "helvetica") => { doc.setFont(fam, style); doc.setFontSize(size); };
    const color = (c) => doc.setTextColor(c);

    /* texte riche : morceaux { t, b, i, code } mis en lignes à la largeur dispo */
    function runs(el, st = {}) {
      const out = [];
      for (const n of el.childNodes) {
        if (n.nodeType === 3) out.push({ t: n.textContent, ...st });
        else if (n.nodeType === 1) {
          const tag = n.tagName;
          if (tag === "UL" || tag === "OL" || tag === "TABLE" || tag === "PRE") continue;   // blocs : traités à part
          if (tag === "BR") { out.push({ br: true }); continue; }
          const s2 = { ...st };
          if (tag === "STRONG" || tag === "B") s2.b = true;
          if (tag === "EM" || tag === "I") s2.i = true;
          if (tag === "CODE") s2.code = true;
          if (tag === "SUP") out.push({ t: "^", ...st });
          if (tag === "SUB") out.push({ t: "_", ...st });
          if (n.classList?.contains("p-box")) { out.push({ t: "[ ] ", ...st }); continue; }
          out.push(...runs(n, s2));
        }
      }
      return out;
    }
    function setRun(r, size) {
      if (r.code) font("normal", size - 1, "courier");
      else font(r.b && r.i ? "bolditalic" : r.b ? "bold" : r.i ? "italic" : "normal", size);
    }
    function paragraph(rs, { x = M, w = MAXW, size = 10.5, lead = 1.45, col = 20 } = {}) {
      const lh = size * lead;
      const words = [];
      for (const r of rs) {
        if (r.br) { words.push({ br: true }); continue; }
        const parts = clean(r.t).replace(/\s+/g, " ").split(/(\s)/);
        for (const p of parts) if (p) words.push({ ...r, t: p });
      }
      let line = [], lw = 0;
      const flush = () => {
        while (line.length && line[line.length - 1].t === " ") line.pop();
        if (!line.length) return;
        ensure(lh);
        let cx = x;
        for (const wd of line) { setRun(wd, size); color(col); doc.text(wd.t, cx, y + size); cx += doc.getTextWidth(wd.t); }
        y += lh; line = []; lw = 0;
      };
      for (const wd of words) {
        if (wd.br) { flush(); continue; }
        if (!line.length && wd.t === " ") continue;
        setRun(wd, size);
        let ww = doc.getTextWidth(wd.t);
        if (lw + ww > w && line.length) { flush(); if (wd.t === " ") continue; }
        if (ww > w) {   // mot plus long que la ligne : on le coupe
          let s = wd.t;
          while (s.length) {
            let k = s.length;
            while (k > 1 && doc.getTextWidth(s.slice(0, k)) > w) k--;
            line.push({ ...wd, t: s.slice(0, k) }); lw += doc.getTextWidth(s.slice(0, k)); s = s.slice(k);
            if (s.length) flush();
          }
          continue;
        }
        line.push(wd); lw += ww;
      }
      flush();
    }

    function list(el, depth, x) {
      const ordered = el.tagName === "OL";
      let i = 0;
      for (const li of el.children) {
        if (li.tagName !== "LI") continue;
        i++;
        const lx = x + 14;
        const mark = ordered ? `${i}.` : depth ? "-" : "•";
        const rs = runs(li);
        const before = y;
        ensure(16);
        font("normal", 10.5); color(20);
        doc.text(clean(mark) || "-", x + 2, y + 10.5);
        if (rs.some((r) => r.t?.trim())) paragraph(rs, { x: lx, w: MAXW - (lx - M) });
        else if (y === before) y += 6;
        for (const ch of li.children) {
          if (ch.tagName === "UL" || ch.tagName === "OL") list(ch, depth + 1, lx);
          else if (ch.tagName === "P" && li.children.length > 1 && ch !== li.firstElementChild) paragraph(runs(ch), { x: lx, w: MAXW - (lx - M) });
          else if (ch.tagName === "PRE") pre(ch, lx);
        }
        y += 2;
      }
      y += 4;
    }

    function pre(el, x = M) {
      font("normal", 9, "courier");
      const lines = clean(el.textContent).split("\n").flatMap((l) => doc.splitTextToSize(l || " ", MAXW - (x - M) - 12));
      for (const l of lines) {
        ensure(12);
        doc.setFillColor(243, 243, 243); doc.rect(x, y, MAXW - (x - M), 12, "F");
        color(30); doc.text(l, x + 6, y + 9); y += 12;
      }
      y += 6;
    }

    function table(el) {
      const rows = [...el.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => ({ t: clean(c.textContent.trim()), h: c.tagName === "TH" })));
      const n = Math.max(...rows.map((r) => r.length), 1), cw = MAXW / n, pad = 4, size = 9.5, lh = size * 1.35;
      for (const r of rows) {
        const cells = r.map((c) => { font(c.h ? "bold" : "normal", size); return doc.splitTextToSize(c.t || " ", cw - 2 * pad); });
        const h = Math.max(...cells.map((c) => c.length)) * lh + 2 * pad;
        ensure(h);
        r.forEach((c, k) => {
          const cx = M + k * cw;
          if (c.h) { doc.setFillColor(238, 241, 247); doc.rect(cx, y, cw, h, "F"); }
          doc.setDrawColor(150); doc.rect(cx, y, cw, h);
          font(c.h ? "bold" : "normal", size); color(20);
          cells[k].forEach((l, j) => doc.text(l, cx + pad, y + pad + size + j * lh));
        });
        y += h;
      }
      y += 8;
    }

    function heading(el, size, rule) {
      ensure(size * 2.4);
      y += size * 0.5;
      paragraph(runs(el).map((r) => ({ ...r, b: true })), { size, lead: 1.25, col: 10 });
      if (rule) { doc.setDrawColor(170); doc.line(M, y + 1, W - M, y + 1); y += 4; }
      y += 3;
    }

    function block(el) {
      const tag = el.tagName, cls = el.classList;
      if (cls?.contains("p-part") || cls?.contains("p-fiche")) {
        if (!first) newPage();
        first = false;
        for (const c of el.children) block(c);
        return;
      }
      if (cls?.contains("p-head")) {
        font("bold", 18); color(10);
        doc.text(clean(el.querySelector(".p-title")?.textContent), M, y + 18); y += 26;
        font("normal", 9); color(90);
        doc.text(clean(el.querySelector(".p-sub")?.textContent.replace(/\s+/g, " ").trim()), M, y + 9); y += 14;
        doc.setDrawColor(20); doc.setLineWidth(1.2); doc.line(M, y, W - M, y); doc.setLineWidth(0.5); y += 14;
        return;
      }
      if (tag === "H1") return heading(el, 15);
      if (tag === "H2") return heading(el, 12.5, true);
      if (tag === "H3" || tag === "H4") return heading(el, 11);
      if (tag === "P") { paragraph(runs(el), cls?.contains("p-meta") ? { size: 8.5, col: 110 } : {}); y += 4; return; }
      if (tag === "UL" || tag === "OL") return list(el, 0, M);
      if (tag === "PRE") return pre(el);
      if (tag === "TABLE") return table(el);
      if (tag === "HR") { ensure(10); doc.setDrawColor(180); doc.line(M, y + 4, W - M, y + 4); y += 10; return; }
      if (tag === "BLOCKQUOTE") {
        const top = y;
        for (const c of el.children) block(c);
        doc.setDrawColor(160); doc.setLineWidth(2); doc.line(M - 8, top, M - 8, y); doc.setLineWidth(0.5);
        return;
      }
      if (el.children.length) { for (const c of el.children) block(c); return; }
      if (el.textContent.trim()) { paragraph(runs(el)); y += 4; }
    }

    for (const c of root.children) block(c);

    // numéros de page
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p); font("normal", 8); color(130);
      doc.text(`${clean(title)} · ${p}/${pages}`, W - M, H - 24, { align: "right" });
    }
    return doc;
  }

  /* Le PDF en base64 (pour la feuille de partage de l'iPhone) */
  window.pdfFromPrintRoot = async (root, title) => {
    const doc = await make(root, title);
    return doc.output("datauristring").split(",")[1];
  };
})();
