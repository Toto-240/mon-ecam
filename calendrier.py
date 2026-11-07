"""
Calendrier .ics de l'emploi du temps (cours, DS, devoirs à rendre), pour l'appli Calendrier
de l'iPhone (abonnement). Publié à une adresse secrète dérivée du mot de passe de l'appli :
l'appli calcule la même adresse pour afficher le bouton « S'abonner ».
"""

import hashlib
from datetime import datetime, timedelta


def secret_name(password):
    """Même calcul que l'appli (cal.js) : SHA-256("ecam-cal:" + mot de passe), 32 caractères."""
    return hashlib.sha256(f"ecam-cal:{password}".encode()).hexdigest()[:32]


def _esc(t):
    return str(t or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line):
    """Lignes de 75 octets maximum (norme iCalendar)."""
    out, b = [], line.encode()
    while len(b) > 74:
        cut = 74
        while (b[cut] & 0xC0) == 0x80:   # ne pas couper un caractère accentué
            cut -= 1
        out.append(b[:cut].decode())
        b = b" " + b[cut:]
    out.append(b.decode())
    return "\r\n".join(out)


def _dt(iso):
    d = datetime.fromisoformat(iso[:19])
    return d.strftime("%Y%m%dT%H%M%S")


def _uid(*parts):
    return hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:20] + "@mon-ecam"


VTZ = """BEGIN:VTIMEZONE
TZID:Europe/Paris
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE"""


def build(data, app_url=""):
    now = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    ev = []

    def add(uid, start, end, summary, location="", desc="", alarm=None):
        lines = ["BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{now}",
                 f"DTSTART;TZID=Europe/Paris:{_dt(start)}", f"DTEND;TZID=Europe/Paris:{_dt(end)}",
                 f"SUMMARY:{_esc(summary)}"]
        if location:
            lines.append(f"LOCATION:{_esc(location)}")
        if desc:
            lines.append(f"DESCRIPTION:{_esc(desc)}")
        if app_url:
            lines.append(f"URL:{app_url}")
        if alarm:
            lines += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{_esc(summary)}", f"TRIGGER:{alarm}", "END:VALARM"]
        lines.append("END:VEVENT")
        ev.extend(lines)

    for e in data.get("planning") or []:
        if not e.get("debut"):
            continue
        typ = e.get("type") or ""
        is_ds = typ == "DS"
        titre = f"{'📝 DS ' if is_ds else ''}{e.get('matiere') or e.get('titre')}{'' if is_ds or not typ else f' ({typ})'}"
        desc = "\n".join(x for x in [e.get("prof"), e.get("groupes"), e.get("titre") if e.get("titre") != e.get("matiere") else ""] if x)
        add(_uid("cours", e.get("matiere"), typ, e.get("seance"), e.get("debut")), e["debut"], e.get("fin") or e["debut"],
            titre, f"Salle {e['salle']}" if e.get("salle") else "", desc, alarm="-P1D" if is_ds else None)

    perso = data.get("perso") or {}
    # DS annoncés à l'oral (ajoutés dans l'appli)
    for d in perso.get("ds") or []:
        if not d.get("date"):
            continue
        debut = f"{d['date']}T{d.get('debut') or '08:00'}:00"
        fin = f"{d['date']}T{d.get('fin') or (d.get('debut') and (datetime.fromisoformat(debut) + timedelta(hours=2)).strftime('%H:%M')) or '10:00'}:00"
        add(_uid("ds-perso", d.get("id")), debut, fin, f"📝 DS {d.get('matiere')} (annoncé à l'oral)",
            f"Salle {d['salle']}" if d.get("salle") else "", d.get("notes") or "", alarm="-P1D")

    # devoirs à rendre (Moodle + ajoutés à la main), sauf ceux marqués faits
    faits = perso.get("faits") or {}
    mine = [{"titre": d.get("titre"), "cours": d.get("matiere"), "echeance": d.get("echeance"), "url": f"perso:{d.get('id')}"}
            for d in perso.get("devoirs") or []]
    for d in (data.get("devoirs") or []) + mine:
        due = d.get("echeance")
        key = d.get("url") or f"{d.get('titre')}|{d.get('cours')}"
        if not due or key in faits:
            continue
        end = datetime.fromisoformat(due[:19])
        add(_uid("devoir", key), (end - timedelta(minutes=30)).isoformat(), end.isoformat(),
            f"📌 À rendre : {d.get('titre')}", "", d.get("cours") or "", alarm="-PT3H")

    cal = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mon ECAM//Emploi du temps//FR", "CALSCALE:GREGORIAN",
           "METHOD:PUBLISH", "X-WR-CALNAME:Mon ECAM", "X-WR-TIMEZONE:Europe/Paris",
           "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H", *VTZ.split("\n"), *ev, "END:VCALENDAR"]
    return "\r\n".join(_fold(l) for l in cal) + "\r\n"
