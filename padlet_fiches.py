"""
Fiches de cours à partir d'un Padlet (cours qui n'utilisent pas Moodle).

Lit les posts publics du Padlet par son API (pas besoin de compte), télécharge les
pièces jointes (Word, PowerPoint, PDF, Google Docs publics) et le texte des posts,
et crée une fiche par document, rangée dans la matière du planning. Comme pour Moodle,
les posts déjà traités sont notés dans moodle_vus.enc (clés « padlet:… ») et jamais refaits.

Lancé 2 fois par semaine (lundi et jeudi matin), ou à la demande.
"""

import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote

import requests
from bs4 import BeautifulSoup

from crypto_util import encrypt_json
from moodle_fiches import BASE, PAUSE, finished, load_seen, make_fiche, note, report, save_seen
from process_inbox import gemini

PADLETS = [
    {   # https://padlet.com/ludovicrenzi1/techniques-de-communication-et-culture-generale-semestre-1-l-5xmj7pnnapr3vi7o
        "nom": "Techniques de communication (Padlet)",
        "wall_id": 201830617,
        "board": "board_wY7WyVlwZRRMn52P",
        "matiere": "Techniques de communication orales et écrites 1",
        "sauter": ["Administratif"],
    },
]
API = "https://padlet.com/api"
MAX_DOCS = int(os.environ.get("PADLET_MAX_DOCS") or 15)
JOURS = (0, 3)  # lundi, jeudi
DOC_EXT = (".pdf", ".docx", ".pptx", ".txt", ".md")


def session():
    s = requests.Session()
    s.headers["User-Agent"] = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"
    s.headers["Accept"] = "application/json"
    return s


def sections(s, p):
    r = s.get(f"{API}/5/wall_sections", params={"wall_id": p["wall_id"]}, timeout=30)
    r.raise_for_status()
    return {int(x["id"]): x["attributes"].get("title") or "" for x in r.json().get("data", [])}


def posts(s, p):
    out, start = [], ""
    for _ in range(20):
        r = s.get(f"{API}/10/wishes", params={"wall_hashid": p["board"], "page_start": start}, timeout=30)
        r.raise_for_status()
        j = r.json()
        out += [w["attributes"] for w in j.get("data", [])]
        start = (j.get("meta") or {}).get("next")
        if not start:
            break
    return [w for w in out if w.get("published", True)]


def html_text(h):
    return BeautifulSoup(h or "", "html.parser").get_text("\n", strip=True)


def attachment_doc(s, url):
    """(nom de fichier, octets) d'une pièce jointe utilisable, sinon None."""
    if not url:
        return None
    m = re.search(r"docs\.google\.com/(document|presentation)/d/([\w-]+)", url)
    if m:  # Google Docs / Slides public : export en PDF
        kind, gid = m.groups()
        r = s.get(f"https://docs.google.com/{kind}/d/{gid}/export/pdf", timeout=60, headers={"Accept": "*/*"})
        if r.ok and r.content[:4] == b"%PDF":
            return f"{gid}.pdf", r.content
        return None
    path = unquote(url.split("?")[0])
    if "padletusercontent.com" not in url or not path.lower().endswith(DOC_EXT):
        return None
    r = s.get(url, timeout=90, headers={"Accept": "*/*"})
    if not r.ok or len(r.content) > 40e6:
        return None
    return path.rsplit("/", 1)[-1], r.content


def due():
    if os.environ.get("PADLET_FORCE") == "1":
        return True
    return datetime.now().weekday() in JOURS


def main():
    if not due():
        print("Padlet : pas aujourd'hui (lundi et jeudi seulement)")
        return
    pw = os.environ.get("APP_PASSWORD")
    if not pw or not os.environ.get("GEMINI_API_KEY"):
        sys.exit("APP_PASSWORD ou GEMINI_API_KEY manquant")
    seen = load_seen(pw)
    client = gemini()
    s = session()
    made = skipped = failed = remaining = 0
    causes = {}
    (BASE / "fiches").mkdir(exist_ok=True)
    for p in PADLETS:
        try:
            secs = sections(s, p)
            items = posts(s, p)
        except Exception as e:
            failed += 1
            note(causes, "padlet", e)
            continue
        items.sort(key=lambda w: w.get("created_at") or "")
        for w in items:
            section = secs.get(w.get("wall_section_id"), "")
            if section in p.get("sauter", []):
                continue
            hid = w.get("hashid") or str(w.get("id"))
            subject = (w.get("subject") or w.get("headline") or "").strip()
            body = html_text(w.get("body"))
            att = w.get("attachment") or (w.get("wish_content") or {}).get("attachment_props", {}).get("url") or ""
            key = f"padlet:{hid}:{'doc' if att else 'texte'}"
            if finished(seen, key):
                continue
            if made >= MAX_DOCS:
                remaining += 1
                continue
            titre = f"{section} : {subject}" if section and subject else (subject or section or "Post du Padlet")
            date = (w.get("created_at") or "")[:10] or None
            try:
                got = attachment_doc(s, att)
            except Exception as e:
                failed += 1
                note(causes, "téléchargement", e)
                continue
            if got:
                fname, data = got
                doc = {"key": key, "titre": titre, "fichier": fname, "data": data, "date": date}
                if body:  # le texte du post sert de contexte
                    doc["titre"] = f"{titre} ({body[:200]})"
            elif len(body) >= 300:
                doc = {"key": key, "titre": titre, "fichier": "post.txt", "text": f"{subject}\n\n{body}", "date": date}
            else:
                seen[key] = "ignoré"  # lien, image ou post trop court : rien à mettre en fiche
                skipped += 1
                continue
            try:
                fiche = make_fiche(client, doc, p["matiere"])
            except Exception as e:
                failed += 1
                note(causes, "fiche", e)
                if re.search(r"quota|429|RESOURCE_EXHAUSTED", str(e), re.I):
                    print("::warning::Quota gratuit Gemini atteint, la suite au prochain passage")
                    save_seen(seen, pw)
                    return report(made, skipped, failed, remaining + 1, causes)
                prev = re.match(r"échec:(\d+)", str(seen.get(key, "")))
                seen[key] = f"échec:{int(prev.group(1)) + 1 if prev else 1}"
                save_seen(seen, pw)
                continue
            if fiche:
                fiche["doc"] = titre
                fiche["origine"] = "padlet"
                (BASE / "fiches" / f"{fiche['id']}.enc").write_text(encrypt_json(fiche, pw), encoding="utf-8")
                seen[key] = "fiche"
                made += 1
            else:
                seen[key] = "ignoré"
                skipped += 1
            save_seen(seen, pw)
            time.sleep(PAUSE)
    save_seen(seen, pw)
    report(made, skipped, failed, remaining, causes)
    if made:
        try:
            import notif
            notif.send("Nouveau sur le Padlet", f"{made} fiche(s) de Techniques de communication prête(s).", tags=["books"])
        except Exception:
            pass


if __name__ == "__main__":
    main()
