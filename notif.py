"""
Notifications sur le téléphone via ntfy (appli gratuite ntfy, abonnée au sujet secret NTFY_TOPIC).

Le sujet ntfy fonctionne comme un mot de passe : quiconque le connaît peut lire les messages.
On n'y met donc que le strict nécessaire (matière, heure, titre), jamais une note chiffrée.
"""

import os

import requests

def _app_url():
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if "/" not in repo:
        return None
    owner, name = repo.split("/", 1)
    return f"https://{owner.lower()}.github.io/{name}/"


def send(title, message, tags=None, priority=3):
    topic = os.environ.get("NTFY_TOPIC")
    if not topic or not message:
        return False
    body = {"topic": topic, "title": title, "message": message[:3500], "priority": priority}
    if tags:
        body["tags"] = tags
    url = _app_url()
    if url:
        body["click"] = url
    try:
        requests.post("https://ntfy.sh/", json=body, timeout=15)
        print("Notification envoyée")
        return True
    except Exception as e:
        print(f"Notification non envoyée ({type(e).__name__})")
        return False


def _lines(items, n=6):
    return "\n".join(items[:n]) + (f"\n… et {len(items) - n} autre(s)" if len(items) > n else "")


def nouveautes(prev, data):
    """Compare avec la version en ligne : nouvelles notes, nouveaux devoirs Moodle."""
    if not prev:
        return
    # nouvelles notes (sans la valeur : le sujet ntfy n'est pas chiffré)
    key = lambda n: f"{n.get('libelle')}|{n.get('date')}"
    old = {key(n) for n in prev.get("notes") or []}
    new = [n for n in data.get("notes") or [] if key(n) not in old]
    if prev.get("notes") is not None and new and len(new) < 15:
        send("Nouvelle note" if len(new) == 1 else f"{len(new)} nouvelles notes",
             _lines([f"{n.get('matiere')}{' – ' + n['epreuve'] if n.get('epreuve') else ''}" for n in new]),
             tags=["memo"], priority=4)
    # nouveaux devoirs à rendre sur Moodle
    old_dv = {d.get("url") or d.get("titre") for d in prev.get("devoirs") or []}
    new_dv = [d for d in data.get("devoirs") or [] if (d.get("url") or d.get("titre")) not in old_dv]
    if prev.get("devoirs") is not None and new_dv and len(new_dv) < 15:
        def due(d):
            e = d.get("echeance") or ""
            return f" (pour le {e[8:10]}/{e[5:7]} {e[11:16]})" if len(e) >= 16 else ""
        send("Nouveau devoir à rendre" if len(new_dv) == 1 else f"{len(new_dv)} nouveaux devoirs",
             _lines([f"{d.get('titre')}{due(d)}" for d in new_dv]), tags=["inbox_tray"], priority=4)


PRET = {
    "cours": ("Fiche de cours prête", "{matiere}"),
    "notes": ("Fiche prête", "{matiere}"),
    "revision": ("Révision et QCM prêts", "{matiere}"),
    "carte": ("Carte mentale prête", "{matiere}"),
    "devoir": ("Devoir fait", "{titre}"),
    "devoir_moodle": ("Devoir fait", "{titre}"),
    "depot": ("Déposé sur Moodle", "{titre}"),
}


def pret(meta, ok=True, erreur=""):
    """Après le traitement d'un envoi de l'appli (fiche, révision, devoir, dépôt…)."""
    kind = meta.get("kind")
    if kind not in PRET:
        return
    titre, msg = PRET[kind]
    if kind == "depot" and meta.get("action") == "envoyer":
        titre = "Devoir envoyé pour évaluation"
    text = msg.format(matiere=meta.get("matiere") or "", titre=meta.get("titre") or meta.get("matiere") or "")
    if ok:
        send(titre, text or "C'est prêt dans l'appli.", tags=["white_check_mark"], priority=3)
    else:
        rate = {"depot": "Dépôt Moodle raté", "revision": "Révision impossible"}.get(kind, "Échec")
        send(rate, f"{text}\n{erreur}"[:300], tags=["warning"], priority=4)
