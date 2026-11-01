"""
Fiches de cours à partir des supports déposés sur Moodle.

Pour chaque cours Moodle : liste les ressources (fichiers, dossiers, pages), télécharge
les PDF / diaporamas / documents Word / pages, et demande à Gemini une fiche par document.
Les fiches sont chiffrées dans fiches/ (même format que celles des enregistrements).

Le travail est progressif (quota gratuit de Gemini) : MAX_DOCS documents par passage,
les déjà traités sont notés dans moodle_vus.enc (chiffré) et ne sont jamais refaits.
Journaux volontairement vagues : le dépôt est public.
"""

import hashlib
import io
import os
import re
import sys
import tempfile
import time
from datetime import datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import unquote, urljoin

import requests
from bs4 import BeautifulSoup

import ecam_scraper as ecam
from crypto_util import decrypt_json, encrypt_json
from process_inbox import generate, gemini

BASE = Path(__file__).parent
SEEN_FILE = BASE / "moodle_vus.enc"
MAX_DOCS = int(os.environ.get("MAX_DOCS") or 20)
MAX_MB = 40
PAUSE = 7  # secondes entre deux appels à Gemini (quota gratuit)

PROMPT_DOC = """Voici un support de cours de la matière « {matiere} », intitulé « {titre} ».
L'étudiant est en Bachelor cybersécurité à l'ECAM LaSalle (Lyon).

Rédige en français une fiche de cours en Markdown, avec cette structure :

# <titre précis>
**En bref :** 2 à 3 phrases qui résument le document.

## L'essentiel
Les notions du document, dans l'ordre, expliquées clairement (un étudiant doit pouvoir réviser avec la fiche seule).

## Définitions
Liste « **terme** : définition ».

## Formules, commandes et exemples
Uniquement s'il y en a (blocs de code si besoin).

## Points à retenir pour l'examen

## Questions pour réviser
5 questions, sans les réponses.

Règles : n'invente rien qui ne soit pas dans le document. Si le document n'est pas un cours
(consignes, sujet de TP, planning, règlement), fais une fiche courte qui résume ce qui est demandé
et commence le titre par « Consignes : »."""

TEXT_TYPES = ("pdf", "pptx", "docx", "txt", "md", "html")


def clean_course(name: str) -> str:
    """Même nettoyage que l'appli, pour ranger les fiches dans la bonne matière."""
    name = re.sub(r"^📚\s*", "", name or "")
    return re.sub(r"\s+-\s+LIB\w+$", "", name).strip()


def key_id(key: str) -> str:
    return "md-" + hashlib.sha1(key.encode()).hexdigest()[:12]


def load_seen(pw):
    try:
        return decrypt_json(SEEN_FILE.read_text(encoding="utf-8"), pw)
    except FileNotFoundError:
        return {}


def save_seen(seen, pw):
    SEEN_FILE.write_text(encrypt_json(seen, pw), encoding="utf-8")


# ---------- Moodle ----------

def course_items(s, cid):
    """Ressources d'un cours, dans l'ordre de la page : (cmid, type, nom)."""
    soup = BeautifulSoup(s.get(f"{ecam.MOODLE}/course/view.php?id={cid}", timeout=40).text, "html.parser")
    for hidden in soup.select(".accesshide, .sr-only, .visually-hidden"):
        hidden.decompose()
    items, seen = [], set()
    for a in soup.select('a[href*="/mod/"]'):
        m = re.search(r"/mod/(resource|folder|page)/view\.php\?id=(\d+)", a.get("href", ""))
        if not m or m.group(2) in seen:
            continue
        seen.add(m.group(2))
        label = a.select_one(".instancename") or a
        name = label.get_text(" ", strip=True)
        if name:
            items.append((m.group(2), m.group(1), name))
    return items


def filename_of(r, fallback):
    cd = r.headers.get("content-disposition", "")
    m = re.search(r"filename\*=UTF-8''([^;]+)", cd) or re.search(r'filename="?([^";]+)', cd)
    if m:
        return unquote(m.group(1))
    return unquote(r.url.split("?")[0].rsplit("/", 1)[-1]) or fallback


def file_date(r):
    try:
        return parsedate_to_datetime(r.headers["last-modified"]).date().isoformat()
    except Exception:
        return None


def download(s, url):
    r = s.get(url, timeout=90, stream=True)
    size = int(r.headers.get("content-length") or 0)
    if size > MAX_MB * 1e6:
        r.close()
        return None
    data = r.content
    return r, data if len(data) <= MAX_MB * 1e6 else None


def finished(seen, key):
    """Déjà traité (ou abandonné après 3 échecs) ?"""
    v = seen.get(key)
    if v is None:
        return False
    m = re.match(r"échec:(\d+)", str(v))
    return not m or int(m.group(1)) >= 3


def documents(s, cmid, kind, name, seen):
    """Liste de documents : dicts {key, titre, fichier, data|text, date}."""
    if kind == "resource":
        r, data = download(s, f"{ecam.MOODLE}/mod/resource/view.php?id={cmid}&redirect=1") or (None, None)
        if r is not None and "text/html" in r.headers.get("content-type", ""):
            # page intermédiaire : chercher le lien vers le fichier
            link = BeautifulSoup(data, "html.parser").select_one('a[href*="pluginfile.php"]')
            if not link:
                return []
            r, data = download(s, link["href"]) or (None, None)
        if not data:
            return []
        fname = filename_of(r, name)
        return [{"key": f"{cmid}:{fname}", "titre": name, "fichier": fname, "data": data, "date": file_date(r)}]

    if kind == "folder":
        soup = BeautifulSoup(s.get(f"{ecam.MOODLE}/mod/folder/view.php?id={cmid}", timeout=40).text, "html.parser")
        docs = []
        for a in soup.select('a[href*="pluginfile.php"]')[:12]:
            label = a.get_text(strip=True) or unquote(a["href"].split("?")[0].rsplit("/", 1)[-1])
            if finished(seen, f"{cmid}:{label}"):
                continue
            got = download(s, urljoin(ecam.MOODLE, a["href"]))
            if not got or not got[1]:
                continue
            r, data = got
            fname = filename_of(r, label)
            docs.append({"key": f"{cmid}:{label}", "titre": f"{name} : {Path(fname).stem}", "fichier": fname,
                         "data": data, "date": file_date(r)})
        return docs

    if kind == "page":
        soup = BeautifulSoup(s.get(f"{ecam.MOODLE}/mod/page/view.php?id={cmid}", timeout=40).text, "html.parser")
        main = soup.select_one("#region-main .box.generalbox") or soup.select_one("#region-main")
        text = main.get_text("\n", strip=True) if main else ""
        if len(text) < 600:  # trop court pour une fiche
            return []
        return [{"key": f"{cmid}:page", "titre": name, "fichier": "page.html", "text": text[:60000], "date": None}]
    return []


# ---------- Contenu -> texte / fichier pour Gemini ----------

def extract(doc):
    """Renvoie ('pdf', octets) ou ('text', texte), ou None si format non géré."""
    if "text" in doc:
        return "text", doc["text"]
    ext = Path(doc["fichier"]).suffix.lower().lstrip(".")
    data = doc["data"]
    if ext == "pdf" or data[:4] == b"%PDF":
        return "pdf", data
    if ext == "pptx":
        from pptx import Presentation
        prs = Presentation(io.BytesIO(data))
        parts = []
        for i, slide in enumerate(prs.slides, 1):
            texts = [sh.text_frame.text for sh in slide.shapes if getattr(sh, "has_text_frame", False) and sh.text_frame.text.strip()]
            if slide.has_notes_slide and slide.notes_slide.notes_text_frame.text.strip():
                texts.append("Notes : " + slide.notes_slide.notes_text_frame.text)
            if texts:
                parts.append(f"--- Diapo {i} ---\n" + "\n".join(texts))
        return ("text", "\n\n".join(parts)) if parts else None
    if ext == "docx":
        from docx import Document
        d = Document(io.BytesIO(data))
        text = "\n".join(p.text for p in d.paragraphs if p.text.strip())
        return ("text", text) if text else None
    if ext in ("txt", "md"):
        return "text", data.decode("utf-8", "ignore")
    return None


def make_fiche(client, doc, matiere):
    content = extract(doc)
    if not content:
        return None
    prompt = PROMPT_DOC.format(matiere=matiere, titre=doc["titre"])
    kind, payload = content
    if kind == "text":
        if len(payload.strip()) < 300:
            return None
        md, model = generate(client, [prompt, "Contenu du document :\n\n" + payload[:120000]])
    else:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(payload)
        try:
            f = client.files.upload(file=tmp.name, config={"mime_type": "application/pdf"})
            for _ in range(60):
                if f.state and f.state.name != "PROCESSING":
                    break
                time.sleep(2)
                f = client.files.get(name=f.name)
            try:
                md, model = generate(client, [f, prompt])
            finally:
                try:
                    client.files.delete(name=f.name)
                except Exception:
                    pass
        finally:
            os.unlink(tmp.name)
    titre = next((l[2:].strip() for l in md.splitlines() if l.startswith("# ")), doc["titre"])
    return {"id": key_id(doc["key"]), "kind": "cours", "source": "moodle", "matiere": matiere,
            "date": doc.get("date"), "titre": titre, "doc": doc["titre"], "md": md.strip(), "modele": model,
            "cree": datetime.now().isoformat(timespec="seconds")}


def main():
    pw = os.environ.get("APP_PASSWORD")
    if not pw:
        sys.exit("APP_PASSWORD manquant")
    if not os.environ.get("GEMINI_API_KEY"):
        print("::error::Ajoute la clé GEMINI_API_KEY dans les secrets du dépôt pour créer les fiches")
        sys.exit(1)
    user, pwd = ecam.load_env()
    seen = load_seen(pw)
    client = gemini()

    s = requests.Session()
    s.headers["User-Agent"] = ecam.UA
    ecam.cas_login(s, ecam.MOODLE_LOGIN, user, pwd)
    courses = ecam.moodle_courses(s, ecam.moodle_sesskey(s))

    # matières du planning d'abord (les cours actuels sont les plus utiles)
    current = set()
    try:
        import json
        current = {e.get("matiere") for e in json.loads((BASE / "data" / "planning.json").read_text(encoding="utf-8"))}
    except Exception:
        pass
    courses.sort(key=lambda c: (clean_course(c["nom"]) not in current, clean_course(c["nom"])))

    made = skipped = failed = 0
    causes = {}
    remaining = 0
    (BASE / "fiches").mkdir(exist_ok=True)
    for c in courses:
        matiere = clean_course(c["nom"])
        try:
            items = course_items(s, c["id"])
        except Exception as e:
            failed += 1
            note(causes, "cours", e)
            continue
        for cmid, kind, name in items:
            if kind != "folder" and any(k.startswith(f"{cmid}:") and finished(seen, k) for k in seen):
                continue
            if made >= MAX_DOCS:
                remaining += 1
                continue
            try:
                docs = documents(s, cmid, kind, name, seen)
            except Exception as e:
                failed += 1
                note(causes, "téléchargement", e)
                continue
            if not docs:
                seen[f"{cmid}:-"] = "vide"
                continue
            for doc in docs:
                if finished(seen, doc["key"]):
                    continue
                if made >= MAX_DOCS:
                    remaining += 1
                    continue
                try:
                    fiche = make_fiche(client, doc, matiere)
                except Exception as e:
                    failed += 1
                    note(causes, "fiche", e)
                    if re.search(r"quota|429|RESOURCE_EXHAUSTED|rate", str(e), re.I):
                        remaining += 1
                        print("::warning::Quota Gemini atteint, la suite au prochain passage")
                        save_seen(seen, pw)
                        return report(made, skipped, failed, remaining, causes)
                    n = int(re.match(r"échec:(\d+)", str(seen.get(doc["key"], "échec:0"))).group(1)) + 1 \
                        if str(seen.get(doc["key"], "")).startswith("échec") else 1
                    seen[doc["key"]] = f"échec:{n}"
                    save_seen(seen, pw)
                    continue
                if fiche:
                    (BASE / "fiches" / f"{fiche['id']}.enc").write_text(encrypt_json(fiche, pw), encoding="utf-8")
                    seen[doc["key"]] = "fiche"
                    made += 1
                else:
                    seen[doc["key"]] = "ignoré"
                    skipped += 1
                save_seen(seen, pw)  # sauvegarde au fil de l'eau
                time.sleep(PAUSE)
            time.sleep(1)  # discret avec Moodle
    save_seen(seen, pw)
    report(made, skipped, failed, remaining, causes)


def note(causes, step, e):
    """Regroupe les erreurs par cause (sans donnée personnelle) pour le résumé."""
    msg = re.sub(r"https?://\S+", "<url>", str(e))
    msg = re.sub(r"\s+", " ", msg)[:160]
    k = f"{step} : {type(e).__name__} {msg}"
    causes[k] = causes.get(k, 0) + 1


def report(made, skipped, failed, remaining, causes=None):
    msg = f"{made} fiche(s) créée(s), {skipped} document(s) ignoré(s), {failed} échec(s), {remaining} restant(s)"
    print(f"::notice::{msg}")
    for k, n in sorted((causes or {}).items(), key=lambda x: -x[1])[:5]:
        print(f"::warning::{n} × {k}")


if __name__ == "__main__":
    main()
