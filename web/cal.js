"use strict";
/* Abonnement au calendrier .ics publié par la synchro (adresse secrète, même calcul que calendrier.py) */
(async function () {
  async function calUrl() {
    const pw = store.get("ecam-pw");
    if (!pw) return null;
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ecam-cal:${pw}`)));
    const name = [...h].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    return new URL(`cal/${name}.ics`, location.href.split(/[?#]/)[0].replace(/[^/]*$/, "")).href;
  }
  async function refresh() {
    const url = await calUrl();
    if (!url) return;
    $("#cal-sub").href = url.replace(/^https?:/, "webcal:");
    $("#cal-copy").onclick = async () => {
      try { await navigator.clipboard.writeText(url); $("#cal-msg").textContent = "Lien copié : colle-le dans Google Agenda (Autres agendas > À partir de l'URL) ou Outlook."; }
      catch { $("#cal-msg").textContent = url; }
    };
  }
  $("#cal-sub").addEventListener("click", () => {
    $("#cal-msg").textContent = "Dans la fenêtre de l'iPhone, touche « S'abonner ». Astuce : Réglages > Calendrier > Comptes > Calendriers abonnés > Mon ECAM > Actualiser : « Toutes les heures ».";
  });
  document.getElementById("bell")?.addEventListener("click", refresh);
  refresh();
})();
