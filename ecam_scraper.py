"""
ECAM scraper - étape 1
- Connexion unique via le CAS ECAM (sac.ecam.fr)
- Moodle : liste des cours + devoirs/échéances à venir
- Intranet : planning (agenda) + notes récentes

Usage :  python ecam_scraper.py
Identifiants : fichier .env à côté du script (voir .env.example)
"""

import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

BASE = Path(__file__).parent
OUT = BASE / "data"
DUMP = BASE / "dump"

MOODLE = "https://moodle.ecam.fr"
MOODLE_LOGIN = f"{MOODLE}/login/index.php?authCAS=CAS"
INTRANET = "https://espace.ecam.fr"
INTRANET_LOGIN = f"{INTRANET}/c/portal/login?p_l_id=527917"
CAS_HOST = "sac.ecam.fr"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")


def load_env():
    env_file = BASE / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    user, pwd = os.environ.get("ECAM_USER"), os.environ.get("ECAM_PASSWORD")
    if not user or not pwd:
        sys.exit("Identifiants manquants : remplis ECAM_USER et ECAM_PASSWORD dans le fichier .env")
    return user, pwd


def cas_login(s: requests.Session, service_url: str, user: str, pwd: str) -> requests.Response:
    """Ouvre un service ECAM ; si le CAS demande le mot de passe, remplit le formulaire."""
    r = s.get(service_url, timeout=30)
    if urlparse(r.url).hostname != CAS_HOST:
        return r  # déjà connecté (ticket CAS réutilisé)

    soup = BeautifulSoup(r.text, "html.parser")
    form = soup.find("form", id="fm1") or soup.find("form")
    if form is None:
        raise RuntimeError("Formulaire CAS introuvable")
    data = {i["name"]: i.get("value", "") for i in form.find_all("input") if i.get("name")}
    data["username"] = user
    data["password"] = pwd
    data.setdefault("_eventId", "submit")
    action = urljoin(r.url, form.get("action") or r.url)

    r2 = s.post(action, data=data, timeout=30)
    if urlparse(r2.url).hostname == CAS_HOST:
        err = BeautifulSoup(r2.text, "html.parser").find(class_=re.compile("alert|error"))
        msg = err.get_text(" ", strip=True) if err else "échec de connexion"
        raise RuntimeError(f"CAS : {msg}")
    return r2


# ---------------- Moodle ----------------

def moodle_sesskey(s: requests.Session) -> str:
    html = s.get(f"{MOODLE}/my/", timeout=30).text
    m = re.search(r'"sesskey":"([^"]+)"', html)
    if not m:
        raise RuntimeError("sesskey Moodle introuvable (connexion Moodle ratée ?)")
    return m.group(1)


def moodle_call(s, sesskey, method, args):
    url = f"{MOODLE}/lib/ajax/service.php?sesskey={sesskey}&info={method}"
    payload = [{"index": 0, "methodname": method, "args": args}]
    res = s.post(url, json=payload, timeout=30).json()
    if isinstance(res, dict) or res[0].get("error"):
        raise RuntimeError(f"Moodle {method} : {res}")
    return res[0]["data"]


def moodle_courses(s, sesskey):
    data = moodle_call(s, sesskey, "core_course_get_enrolled_courses_by_timeline_classification",
                       {"offset": 0, "limit": 0, "classification": "inprogress", "sort": "fullname"})
    return [{"id": c["id"], "nom": c["fullname"], "court": c.get("shortname"),
             "url": c.get("viewurl")} for c in data.get("courses", [])]


def moodle_deadlines(s, sesskey):
    now = int(time.time())
    data = moodle_call(s, sesskey, "core_calendar_get_action_events_by_timesort",
                       {"limitnum": 50, "timesortfrom": now - 86400,
                        "limittononsuspendedevents": True})
    out = []
    for e in data.get("events", []):
        out.append({
            "titre": e.get("activityname") or e.get("name"),
            "type": e.get("modulename"),
            "cours": (e.get("course") or {}).get("fullname"),
            "echeance": datetime.fromtimestamp(e["timesort"]).isoformat(),
            "url": e.get("url"),
            "action": (e.get("action") or {}).get("name"),
            "en_retard": e.get("overdue", False),
        })
    return sorted(out, key=lambda d: d["echeance"])


# ---------------- Intranet ----------------

AGENDA_PAGE = f"{INTRANET}/group/tools/agenda"
NOTES_PAGE = f"{INTRANET}/group/education/notes"


def _parse_dt(v):
    """L'agenda renvoie des dates en secondes Unix, en millisecondes ou en ISO."""
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)) or str(v).lstrip("-").isdigit():
        n = int(v)
        return datetime.fromtimestamp(n / 1000 if n > 10**11 else n).isoformat()
    return str(v)


def _clean(txt):
    return BeautifulSoup(txt or "", "html.parser").get_text(" ", strip=True)


def intranet_planning(s, weeks_before=1, weeks_after=6):
    page = s.get(AGENDA_PAGE, timeout=30).text
    m_url = re.search(r'var urlCal="([^"]+)"', page)
    m_uid = re.search(r'getUserId:function\(\)\{return"(\d+)"', page)
    if not (m_url and m_uid):
        raise RuntimeError("Agenda : URL ou identifiant introuvable dans la page")
    url_cal = m_url.group(1).replace("\\x26", "&")
    cal = f"o{m_uid.group(1)}"

    now = int(time.time())
    start, end = now - weeks_before * 7 * 86400, now + weeks_after * 7 * 86400
    r = s.get(f"{url_cal}&cal={cal}", params={"start": start, "end": end, "_": now * 1000},
              headers={"X-Requested-With": "XMLHttpRequest"}, timeout=30)
    DUMP.mkdir(exist_ok=True)
    (DUMP / "agenda_reponse.txt").write_text(r.text, encoding="utf-8")

    try:
        raw = r.json()
    except ValueError:
        raise RuntimeError("Agenda : réponse inattendue (enregistrée dans dump/agenda_reponse.txt)")
    if isinstance(raw, dict):
        raw = raw.get("events") or raw.get("data") or []

    events = []
    for e in raw:
        desc = _clean(e.get("description"))
        prof = re.search(r"Enseignant\(s\)\s*:\s*(.+?)(?=\s*Groupe\(s\)|$)", desc)
        groupes = re.search(r"Groupe\(s\)\s*:\s*(.+)$", desc)
        titre = _clean(e.get("title"))
        parts = [p.strip() for p in titre.split(" - ")]
        m_type = re.match(r"(CM|TD|TP|DS|EXAM\w*|Projet)\b", parts[1]) if len(parts) > 1 else None
        m_seance = re.match(r"S(\d+)$", parts[-1]) if len(parts) > 2 else None
        events.append({
            "titre": titre,
            "matiere": parts[0] if m_type else titre,
            "type": m_type.group(1) if m_type else (_clean(e.get("categories")) or "Événement"),
            "seance": int(m_seance.group(1)) if m_seance else None,
            "debut": _parse_dt(e.get("start")),
            "fin": _parse_dt(e.get("end")),
            "salle": _clean(e.get("location")),
            "prof": prof.group(1).strip() if prof else None,
            "groupes": groupes.group(1).strip() if groupes else None,
            "journee": bool(e.get("allDay")),
        })
    return sorted(events, key=lambda ev: ev["debut"] or "")


def intranet_notes(s):
    soup = BeautifulSoup(s.get(NOTES_PAGE, timeout=30).text, "html.parser")
    table = soup.select_one("#currentNote table")
    notes = []
    if not table:
        return notes
    for tr in table.find_all("tr")[1:]:
        tds = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        if len(tds) != 6:
            continue  # lignes « La semaine dernière », etc.
        note, libelle, bareme, moyenne, prof, date = tds
        parts = [p.strip() for p in libelle.split(" - ")]
        notes.append({
            "note": note, "matiere": parts[1] if len(parts) > 1 else libelle,
            "epreuve": " - ".join(parts[2:]) if len(parts) > 2 else "",
            "coefficient": bareme, "moyenne_classe": moyenne,
            "prof": prof, "date": date, "libelle": libelle,
        })
    return notes


def main():
    """Récupère tout et écrit les fichiers dans data/. Utilisable depuis server.py."""
    user, pwd = load_env()
    OUT.mkdir(exist_ok=True)
    s = requests.Session()
    s.headers["User-Agent"] = UA

    print("Connexion Moodle…")
    cas_login(s, MOODLE_LOGIN, user, pwd)
    key = moodle_sesskey(s)

    courses = moodle_courses(s, key)
    deadlines = moodle_deadlines(s, key)
    (OUT / "cours.json").write_text(json.dumps(courses, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "devoirs.json").write_text(json.dumps(deadlines, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  {len(courses)} cours, {len(deadlines)} échéances")

    print("Connexion intranet…")
    cas_login(s, INTRANET_LOGIN, user, pwd)
    planning = intranet_planning(s)
    (OUT / "planning.json").write_text(json.dumps(planning, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  {len(planning)} créneaux de cours")

    notes = intranet_notes(s)
    (OUT / "notes.json").write_text(json.dumps(notes, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  {len(notes)} notes récentes")
    (OUT / "meta.json").write_text(json.dumps({"maj": datetime.now().isoformat(timespec="seconds")}),
                                   encoding="utf-8")
    print("Terminé. Tout est dans le dossier data/.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.exit(f"Erreur : {exc}")
