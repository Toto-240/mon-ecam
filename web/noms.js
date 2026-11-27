"use strict";
/* Noms des fiches :
   - support Moodle / Padlet : le nom du document sur Moodle, un peu nettoyé (« CM3_cpu » → « Cours 3 · CPU »),
     avec entre parenthèses ce qu'il y a dedans, en court ;
   - enregistrement : « Enregistrement · » + le titre donné par l'IA ;
   - notes et photos : « Notes et photos · » + le titre donné par l'IA.
   Les révisions, QCM et cartes gardent le titre de l'IA (voir iaNom). */
(() => {
  const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const STOP = new Set("le la les un une des du de d l et ou en au aux a sur sous pour par avec dans ses son sa leurs the of and to in a an".split(" "));
  const words = (s) => (fold(s).match(/[a-z0-9]+/g) || []).filter((w) => !STOP.has(w));
  const GENERIQUE = /^(supports?|cours|documents?|ressources?|fichiers?|diapos?|diaporamas?|slides?|pdf|polys?|polycopies?)( (de|du) cours)?$/i;

  // retire la matière au début (« Fondements du génie… : Grandeurs… » → « Grandeurs… »)
  function sansMatiere(t, m) {
    const parts = String(t).split(/\s+[:–—-]\s+|\s*:\s+/);
    if (parts.length > 1 && m && (sameMatiere(parts[0], m) || words(parts[0]).every((w) => fold(m).includes(w))))
      return parts.slice(1).join(" : ").trim();
    return String(t).trim();
  }

  // nom de fichier ou de document Moodle → lisible
  // « rÃ©gime » → « régime » (nom de fichier en UTF-8 lu comme du Latin-1), pour les fiches déjà faites
  const demojibake = (t) => {
    t = String(t || "");
    if (!/[ÃÂ][\u0080-\u00BF]/.test(t)) return t;
    try { return decodeURIComponent(escape(t)); } catch { return t; }
  };

  const iaTitre = (f) => demojibake(String(String(f.md || "").match(/^#\s+(.+)/m)?.[1] || f.titre || "").replace(/[*_`]/g, "").trim());

  function propre(s) {
    let t = String(s || "").replace(/\.(pdf|pptx?|docx?|xlsx?|odt|odp|txt|html?|zip)$/i, "");
    t = t.replace(/[_]+/g, " ").replace(/(\D)-(\D)/g, "$1 $2").replace(/\s+/g, " ").trim();
    t = t.replace(/([a-zà-ÿ]{3,})([A-ZÀ-Ý])/g, "$1 $2")                    // « PrésentationElectrique »
      .replace(/\b([a-zà-ÿ]{4,})(\d{1,2})\b/gi, "$1 $2");                  // « additionnel1 »
    t = t.replace(/^\d{1,3}\s*(?:[-.)]\s*|\s+)(?=\D)/, "");                 // « 01 - », « 03-Puissance » en tête
    t = t.replace(/^(cours|CM|TD|TP)\s+S\d\s+(?=\d)/i, "$1 ");                // « Cours S1 2 … » : semestre inutile
    const fichier = !/\s/.test(String(s || "").trim());   // « cm3_cpu » : un nom de fichier, pas un titre
    t = t.replace(/\b(?:CM|cours)\s*0*(\d+)\b/gi, "Cours $1")
      .replace(/\bchap(?:itre|\.)?\s*0*(\d+)\b/gi, "Chapitre $1")
      .replace(/\b(TD|TP|DS|DM)\s*0*(\d+)\b/gi, (_, a, n) => `${a.toUpperCase()} ${n}`);
    // « Cours 3 CPU » → « Cours 3 · CPU »
    t = t.replace(/^((?:Cours|Chapitre|TP|TD|DS|DM|Partie|Séance|Semaine|Unit|Module|Lab|Lesson) \d+)\s*[-:.]?\s+(?=[^\s·])/i, "$1 · ");
    t = t.replace(/ · ([a-zà-ÿ])/, (_, c) => ` · ${c.toUpperCase()}`);
    // sigles courts en minuscules dans un nom de fichier (« cpu » → « CPU »)
    if (fichier) t = t.replace(/\b[a-z]{2,4}\b/g, (w) => (STOP.has(w) || /^(cours|chap|tp|td)$/.test(w) ? w : w.toUpperCase()));
    // mots tout en minuscules d'un nom de fichier : majuscule au début
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function moodleNom(f, avecContenu = true) {
    const doc = demojibake(f.doc).trim();
    if (!doc) return "";
    // dossier Moodle : « Nom du dossier : nom du fichier »
    let [a, b] = doc.split(/\s+:\s+(?=[^:]*$)/);
    // dossier « CM », « TD », « TP » : « CM : 03-Puissance » → « Cours 3 · Puissance »
    const genre = /^(CM|cours|TD|TP)s?$/i.exec(String(a).trim());
    if (genre && b) {
      const lab = /^(cm|cours)$/i.test(genre[1]) ? "Cours" : genre[1].toUpperCase();
      const nb = propre(b);
      const num = /^\s*0*(\d{1,3})\s*[-._ ]+\s*(?=\D)/.exec(String(b));
      a = /^(cours|chapitre|td|tp)\b/i.test(nb) ? nb : num ? `${lab} ${num[1]} · ${propre(String(b).slice(num[0].length))}` : `${lab} · ${nb}`;
      b = "";
    }
    a = propre(a); b = b ? propre(b) : "";
    if (b) {
      const wa = new Set(words(a)), wb = words(b);
      if (wb.length && wb.every((w) => wa.has(w))) b = "";
      else if (GENERIQUE.test(fold(a).trim()) || (wa.size && [...wa].every((w) => wb.includes(w)))) { a = b; b = ""; }
    }
    let nom = b ? `${a} · ${b}` : a;
    // la matière répétée dans le nom du document : inutile
    nom = sansMatiere(nom, f.matiere) || nom;
    // entre parenthèses : ce qu'il y a dedans (d'après l'IA), en court, si ça apporte quelque chose
    if (!avecContenu) return nom;
    const ia = sansMatiere(iaTitre(f), f.matiere).replace(/^(cours|chapitre|tp|td|cm)\s*\d*\s*[:·.-]?\s+/i, "");
    const deja = new Set(words(nom));
    // on enlève le début du titre de l'IA qui répète le nom (« Le CPU : fonctionnement… » → « fonctionnement… »)
    const toks = ia.split(/\s+/);
    while (toks.length && words(toks[0]).every((w) => deja.has(w) || STOP.has(w))) toks.shift();
    let c = toks.join(" ").replace(/^[\s:;,·–—-]+/, "").trim();
    if (c && words(c).filter((w) => !deja.has(w)).length >= 2) {
      c = c.replace(/\s*\(([^)]*)\)/g, " $1").replace(/\s+/g, " ").trim();   // pas de parenthèses dans les parenthèses
      if (c.length > 42) c = c.slice(0, 40).replace(/[\s,;:]+\S*$/, "") + "…";
      if (/^[A-ZÀ-Ý][a-zà-ÿ]*(\s+[a-zà-ÿ0-9(]|[,;]|$)/.test(c)) c = c.charAt(0).toLowerCase() + c.slice(1);   // pas les sigles (CPU, OSI…)
      nom += ` (${c})`;
    }
    return nom;
  }

  window.ficheNom = function (f) {
    if (!f) return "";
    if (f.source === "moodle" || f.source === "complete") {
      const n = moodleNom(f);
      if (n) return n;
    }
    const t = sansMatiere(iaTitre(f), f.matiere) || f.matiere || "Fiche";
    if (f.source === "notes") return `Notes et photos · ${t}`;
    if (f.source === "moodle") return t;
    return `Enregistrement · ${t}`;
  };

  /* Ordre d'affichage d'une matière : les supports Moodle dans l'ordre de la page Moodle du cours,
     puis tes cours (enregistrements, notes) du plus récent au plus ancien */
  window.ordreFiches = function (list) {
    const o = DATA?.ordreMoodle || {};
    const pos = (f) => o[f.id] ?? (f.source === "moodle" || f.source === "complete" ? 9e9 : null);
    return [...list].sort((a, b) => {
      const pa = pos(a), pb = pos(b);
      if (pa !== null && pb !== null) return pa - pb || (a.date || "").localeCompare(b.date || "");
      if (pa !== null) return -1;
      if (pb !== null) return 1;
      return (b.date || "").localeCompare(a.date || "");
    });
  };

  // nom Moodle nettoyé, sans le contenu entre parenthèses (listes de choix)
  window.docNom = (f) => moodleNom(f, false) || demojibake(f.titre) || "Support";

  // révisions, QCM, cartes : le titre que l'IA a donné, tel quel
  window.iaNom = (x, defaut) => iaTitre(x) || defaut || "";
})();
