"""
Changements d'emploi du temps.

À chaque synchro, le planning qui vient d'être récupéré est comparé à celui de la version
publiée juste avant (data.enc sur GitHub Pages). Les différences (cours annulé, ajouté, déplacé,
changement de salle ou d'enseignant) sont ajoutées à un historique de 60 jours affiché dans l'appli.
Optionnel : une notification sur le téléphone via ntfy (secret NTFY_TOPIC).
"""

import hashlib
import json
import os
from datetime import datetime, timedelta

import requests

from crypto_util import decrypt_json

KEEP_DAYS = 60
HORIZON_WEEKS = 5  # on ne compare que les cours à venir dans cette fenêtre (le planning en couvre 6)


def previous_published(password):
    """data.enc actuellement en ligne -> dict, ou None si indisponible."""
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if "/" not in repo:
        return None
    owner, name = repo.split("/", 1)
    url = f"https://{owner.lower()}.github.io/{name}/data.enc"
    for _ in range(3):
        try:
            r = requests.get(url, params={"t": datetime.now().timestamp()}, timeout=20)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return decrypt_json(r.text, password)
        except Exception:
            continue
    return None


def _key(e):
    """Identifiant stable d'un créneau : matière + type + numéro de séance (S3…)."""
    if e.get("seance") is not None and e.get("type") in ("CM", "TD", "TP", "DS"):
        return f"{e.get('matiere')}|{e.get('type')}|{e['seance']}"
    return f"{e.get('titre')}|{(e.get('debut') or '')[:10]}"


def _index(planning):
    out = {}
    for e in planning or []:
        out.setdefault(_key(e), e)  # en cas de doublon, on garde le premier
    return out


def _snap(e):
    return {k: e.get(k) for k in ("debut", "fin", "salle", "prof", "type")}


def detect(old, new, now=None):
    """Liste des changements entre deux plannings (seulement pour les cours à venir)."""
    now = now or datetime.now()
    lo, hi = now.isoformat(timespec="seconds"), (now + timedelta(weeks=HORIZON_WEEKS)).isoformat(timespec="seconds")
    in_window = lambda e: e and lo <= (e.get("debut") or "") <= hi
    a, b = _index(old), _index(new)
    found = []

    def add(kind, ref, avant=None, apres=None):
        raw = json.dumps([kind, _key(ref), avant, apres], sort_keys=True, ensure_ascii=False)
        found.append({"id": hashlib.sha1(raw.encode()).hexdigest()[:12], "type": kind,
                      "matiere": ref.get("matiere"), "titre": ref.get("titre"), "cours": ref.get("type"),
                      "avant": avant, "apres": apres, "quand": now.isoformat(timespec="seconds")})

    for k, e in a.items():
        n = b.get(k)
        if n is None:
            if in_window(e):
                add("annule", e, avant=_snap(e))
            continue
        if not (in_window(e) or in_window(n)):
            continue
        if (e.get("debut"), e.get("fin")) != (n.get("debut"), n.get("fin")):
            add("deplace", n, avant=_snap(e), apres=_snap(n))
        else:
            if (e.get("salle") or "") != (n.get("salle") or ""):
                add("salle", n, avant=_snap(e), apres=_snap(n))
            if (e.get("prof") or "") != (n.get("prof") or ""):
                add("prof", n, avant=_snap(e), apres=_snap(n))
    for k, n in b.items():
        if k not in a and in_window(n):
            add("ajoute", n, apres=_snap(n))
    return found


def merge(history, new, now=None):
    now = now or datetime.now()
    limit = (now - timedelta(days=KEEP_DAYS)).isoformat()
    seen = {c["id"] for c in history}
    out = [c for c in history if c.get("quand", "") >= limit] + [c for c in new if c["id"] not in seen]
    return sorted(out, key=lambda c: c.get("quand", ""), reverse=True)[:200]


# ---------- Notification sur le téléphone (facultatif) ----------

def _fr(iso):
    if not iso:
        return ""
    d = datetime.fromisoformat(iso)
    jours = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."]
    return f"{jours[d.weekday()]} {d.day}/{d.month:02d} {d.hour}h{d.minute:02d}"


def describe(c):
    m, av, ap = c.get("matiere") or c.get("titre"), c.get("avant") or {}, c.get("apres") or {}
    return {
        "annule": f"Annulé : {m}, {_fr(av.get('debut'))}",
        "ajoute": f"Nouveau : {m}, {_fr(ap.get('debut'))}" + (f", salle {ap.get('salle')}" if ap.get("salle") else ""),
        "deplace": f"Déplacé : {m}, {_fr(av.get('debut'))} → {_fr(ap.get('debut'))}",
        "salle": f"Salle changée : {m}, {_fr(ap.get('debut'))} : {av.get('salle') or '?'} → {ap.get('salle') or '?'}",
        "prof": f"Enseignant changé : {m}, {_fr(ap.get('debut'))} : {ap.get('prof') or '?'}",
    }.get(c["type"], m)


def notify(changes):
    topic = os.environ.get("NTFY_TOPIC")
    if not topic or not changes:
        return
    lines = [describe(c) for c in changes]
    body = "\n".join(lines[:8]) + (f"\n… et {len(lines) - 8} autre(s)" if len(lines) > 8 else "")
    try:
        requests.post("https://ntfy.sh/", timeout=15, json={
            "topic": topic, "title": "Emploi du temps modifié", "message": body, "tags": ["calendar"],
            "priority": 4 if any(c["type"] in ("annule", "deplace") for c in changes) else 3})
        print(f"Notification envoyée ({len(changes)} changement(s))")
    except Exception as e:
        print(f"Notification non envoyée ({type(e).__name__})")
