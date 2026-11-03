"""
Traite la « boîte de dépôt » (branche inbox) remplie par l'appli :
- enregistrement de cours  -> fiche de cours (Markdown)
- notes / photos / documents d'un cours -> fiche de cours
- demande de révision      -> fiche de révision + QCM pour une matière
- énoncé de devoir         -> devoir fait (.docx, même mise en page), voir devoir.py
Les résultats sont chiffrés avec APP_PASSWORD dans fiches/ et revisions/ (branche main).

Usage : python process_inbox.py <dossier_inbox> <dossier_main>
Écrit <dossier_inbox>/.traites (fichiers terminés, un par ligne) pour le nettoyage.
Les journaux restent volontairement vagues : le dépôt est public.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import time
import unicodedata
from datetime import datetime
from pathlib import Path

from crypto_util import decrypt_json, decrypt_upload, encrypt_json

# Ordre de préférence ; seuls ceux que Google propose encore sont utilisés.
PREFERRED = [m for m in (os.environ.get("GEMINI_MODEL"), "gemini-flash-latest", "gemini-3-flash-preview",
                         "gemini-2.5-flash", "gemini-3.1-flash-lite", "gemini-flash-lite-latest") if m]
_models = None


# Modèles plus forts, essayés d'abord pour les devoirs (quota gratuit plus petit : sinon les modèles habituels)
STRONG = ["gemini-pro-latest", "gemini-3-pro-preview", "gemini-2.5-pro"]
_names = None


def models(client, strong=False):
    global _models, _names
    if _models is None:
        try:
            _names = {m.name.split("/")[-1] for m in client.models.list()}
            _models = [m for m in PREFERRED if m in _names] or PREFERRED
        except Exception:
            _names, _models = set(), PREFERRED
        print(f"  modèles disponibles : {len(_models)}")
    if strong:
        return [m for m in STRONG if m in (_names or set())] + _models
    return _models

PROMPT_COURS = """Tu es un assistant pour un étudiant en Bachelor cybersécurité à l'ECAM LaSalle (Lyon).
Voici l'enregistrement audio d'un cours de « {matiere} » du {date}.

Rédige en français une fiche de cours claire et complète, en Markdown, avec exactement cette structure :

# <titre précis du cours>
**En bref :** 2 à 3 phrases qui résument le cours.

## Plan du cours
Les parties dans l'ordre où le prof les a abordées, avec sous chaque partie les notions expliquées.
Développe : un étudiant absent doit pouvoir comprendre le cours avec cette fiche.

## Définitions
Liste « **terme** : définition » des notions importantes.

## Formules, commandes et exemples
Formules, commandes, schémas décrits en texte, exemples donnés par le prof (en blocs de code si besoin).
Supprime cette partie s'il n'y en a pas.

## Ce que le prof a souligné
Les points sur lesquels le prof a insisté, les annonces (examen, devoir, date).

## Questions pour réviser
5 questions de compréhension, sans les réponses.

Règles : ignore les bavardages et les passages hors sujet. N'invente rien : si un passage est inaudible,
écris « (passage inaudible) ». Garde les termes techniques exacts."""

PROMPT_COMPLETER = """Tu es un assistant pour un étudiant en Bachelor cybersécurité à l'ECAM LaSalle (Lyon).
Voici la fiche qu'il a déjà, faite à partir du support Moodle « {doc} » (matière « {matiere} ») :

=== FICHE ACTUELLE ===
{fiche}
=== FIN DE LA FICHE ===

Ci-joint {quoi} du cours du {date} qui porte sur ce support.

Réécris la fiche COMPLÈTE en Markdown, en gardant sa structure (# titre, **En bref**, parties…) :
- garde tout ce qui est juste dans la fiche actuelle ;
- ajoute à leur place les explications, exemples, précisions et schémas décrits que le prof a donnés en plus du support ;
- corrige ce que le cours contredit ;
- ajoute ou complète une partie « ## Ce que le prof a souligné » (points sur lesquels il a insisté, annonces : examen, devoir, date) ;
- termine par « ## Questions pour réviser » (5 questions, sans les réponses).

Règles : n'invente rien, ignore les bavardages, garde les termes techniques exacts.
Réponds uniquement avec la fiche."""

PROMPT_REVISION = """Tu prépares les révisions d'un étudiant pour la matière « {matiere} ».
Voici ses fiches de cours, de la plus ancienne à la plus récente :

{fiches}

Réponds UNIQUEMENT avec un objet JSON de cette forme :
{{
  "fiche": "<fiche de révision en Markdown : # titre, puis l'essentiel à savoir par thème, définitions clés, formules/commandes, pièges fréquents ; concise, une à deux pages>",
  "qcm": [
    {{"question": "...", "choix": ["...", "...", "...", "..."], "bonne": 0, "explication": "..."}}
  ]
}}
Le QCM contient 10 questions qui couvrent tous les cours, 4 choix chacune, "bonne" est l'index (0 à 3)
de la bonne réponse, et les mauvaises réponses doivent être plausibles. Tout en français."""


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60] or "matiere"


def gemini():
    from google import genai
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("Clé GEMINI_API_KEY manquante dans les secrets GitHub")
    from google.genai import types
    # 3 min max par appel : un document qui bloque ne fige plus tout le passage
    return genai.Client(api_key=key, http_options=types.HttpOptions(timeout=180_000))


class QuotaError(RuntimeError):
    """Quota gratuit Gemini épuisé pour aujourd'hui."""


def generate(client, contents, json_mode=False, strong=False):
    from google.genai import types
    errors = []
    for model in models(client, strong):
        try:
            cfg = types.GenerateContentConfig(response_mime_type="application/json") if json_mode else None
            r = client.models.generate_content(model=model, contents=contents, config=cfg)
            if r.text:
                return r.text, model
            errors.append(f"{model}: réponse vide")
        except Exception as e:  # modèle retiré, quota, surcharge…
            code = re.search(r"\b(4\d\d|5\d\d)\b\s*([A-Z_]+)?", str(e))
            errors.append(f"{model}: {code.group(0) if code else type(e).__name__}")
            time.sleep(2)
    raise RuntimeError("Aucun modèle Gemini n'a répondu (" + " ; ".join(errors) + ")")


def wait_active(client, f):
    """Attend que Gemini ait fini de préparer le fichier envoyé (audio)."""
    for _ in range(120):
        if f.state and f.state.name != "PROCESSING":
            break
        time.sleep(3)
        f = client.files.get(name=f.name)
    return f


def to_mp3(audio: bytes, workdir: Path):
    src, dst = workdir / "in.audio", workdir / "cours.mp3"
    src.write_bytes(audio)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(src), "-ac", "1", "-ar", "16000",
                    "-b:a", "32k", str(dst)], check=True)
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                          "default=nw=1:nk=1", str(dst)], capture_output=True, text=True).stdout.strip()
    return dst, round(float(dur or 0) / 60)


def load_support(meta, out: Path):
    """Fiche du support Moodle à compléter (None si pas demandé ou introuvable)."""
    sid = re.sub(r"[^A-Za-z0-9_-]", "", str(meta.get("support") or ""))
    if not sid:
        return None
    p = out / "fiches" / f"{sid}.enc"
    if not p.exists():
        print("  support introuvable : fiche à part")
        return None
    return decrypt_json(p.read_text(encoding="utf-8"), os.environ["APP_PASSWORD"])


def completer(client, support, meta, parts, quoi, out: Path, minutes=None):
    """Complète la fiche du support avec le cours (audio ou notes) ; même fichier, une seule fiche."""
    prompt = PROMPT_COMPLETER.format(doc=support.get("doc") or support.get("titre") or "", matiere=support.get("matiere"),
                                     fiche=support["md"], quoi=quoi, date=meta.get("date") or "")
    md, model = generate(client, parts + [prompt])
    titre = next((l[2:].strip() for l in md.splitlines() if l.startswith("# ")), support.get("titre"))
    fiche = {**support, "source": "complete", "titre": titre, "md": md.strip(), "modele": model,
             "md_moodle": support.get("md_moodle") or support["md"],   # version d'origine gardée
             "date": meta.get("date") or support.get("date"), "heure": meta.get("heure"), "creneau": meta.get("creneau"),
             "complete_par": (support.get("complete_par") or []) + [meta["id"]],
             "maj": datetime.now().isoformat(timespec="seconds")}
    if minutes is not None:
        fiche["duree_min"] = (support.get("duree_min") or 0) + minutes
    write(out / "fiches" / f"{support['id']}.enc", fiche)
    print("  support Moodle complété")


def fiche_cours(client, meta, audio, out: Path):
    support = load_support(meta, out)
    with tempfile.TemporaryDirectory() as tmp:
        mp3, minutes = to_mp3(audio, Path(tmp))
        print(f"  audio : {minutes} min")
        f = wait_active(client, client.files.upload(file=str(mp3), config={"mime_type": "audio/mpeg"}))
        try:
            if support:
                return completer(client, support, meta, [f], "l'enregistrement audio", out, minutes)
            prompt = PROMPT_COURS.format(matiere=meta.get("matiere") or "cours", date=meta.get("date") or "")
            md, model = generate(client, [f, prompt])
        finally:
            try:
                client.files.delete(name=f.name)
            except Exception:
                pass
    titre = next((l[2:].strip() for l in md.splitlines() if l.startswith("# ")), meta.get("matiere"))
    fiche = {"id": meta["id"], "kind": "cours", "matiere": meta.get("matiere"), "date": meta.get("date"),
             "heure": meta.get("heure"), "creneau": meta.get("creneau"),
             "titre": titre, "duree_min": minutes, "md": md.strip(), "modele": model,
             "cree": datetime.now().isoformat(timespec="seconds")}
    write(out / "fiches" / f"{meta['id']}.enc", fiche)


def fiche_revision(client, meta, out: Path, password: str):
    matiere = meta.get("matiere")
    fiches = []
    for p in sorted((out / "fiches").glob("*.enc")):
        try:
            f = decrypt_json(p.read_text(encoding="utf-8"), password)
        except Exception:
            continue
        if f.get("kind") == "cours" and f.get("matiere") == matiere:
            fiches.append(f)
    if not fiches:
        raise RuntimeError("Aucune fiche de cours pour cette matière")
    fiches.sort(key=lambda f: f.get("date") or "")
    texte = "\n\n---\n\n".join(f"Cours du {f.get('date')} :\n{f['md']}" for f in fiches)
    raw, model = generate(client, PROMPT_REVISION.format(matiere=matiere, fiches=texte), json_mode=True)
    data = json.loads(re.sub(r"^```(?:json)?|```$", "", raw.strip()).strip())
    qcm = [q for q in data.get("qcm", []) if isinstance(q, dict) and len(q.get("choix", [])) >= 2
           and isinstance(q.get("bonne"), int) and 0 <= q["bonne"] < len(q["choix"])]
    rev = {"id": meta["id"], "kind": "revision", "matiere": matiere, "md": data.get("fiche", "").strip(),
           "qcm": qcm, "sources": len(fiches), "modele": model,
           "cree": datetime.now().isoformat(timespec="seconds")}
    write(out / "revisions" / f"{slug(matiere)}.enc", rev)


PROMPT_NOTES = """Tu es un assistant pour un étudiant en Bachelor cybersécurité à l'ECAM LaSalle (Lyon).
Voici ce que l'étudiant a gardé du cours de « {matiere} » du {date} : ses notes, des photos
(tableau, cahier, diapos) et/ou des documents. Rédige une fiche de cours en français, en Markdown :

# <titre précis du cours>
**En bref :** 2 à 3 phrases.

## Plan du cours
Les notions dans l'ordre, expliquées clairement (complète les notes abrégées pour qu'elles soient compréhensibles).

## Définitions
« **terme** : définition ».

## Formules, commandes et exemples
Uniquement s'il y en a.

## Points à retenir

## Questions pour réviser
5 questions, sans les réponses.

Règles : appuie-toi sur le contenu fourni ; tu peux expliquer une notion abrégée, mais n'ajoute pas de
chapitre qui n'y est pas. Si une photo est illisible, dis-le en une ligne."""


def notes_parts(meta, data):
    """Fichiers envoyés par l'appli (collés à la suite) -> contenu pour Gemini."""
    import devoir
    parts, offset = [], 0
    for f in meta.get("files", []):
        chunk = data[offset:offset + int(f.get("size", 0))]
        offset += int(f.get("size", 0))
        name, mime = f.get("name", ""), f.get("type", "")
        if name.lower().endswith(".docx"):
            import io
            from docx import Document
            d = Document(io.BytesIO(chunk))
            parts.append(f"Document {name} :\n" + "\n".join(p.text for p in d.paragraphs if p.text.strip()))
        else:
            parts += devoir.statement_parts(None, chunk, name, mime)
    if meta.get("texte"):
        parts.append("Notes tapées par l'étudiant :\n" + meta["texte"][:60000])
    if not parts:
        raise RuntimeError("Rien à transformer en fiche (aucun fichier ni texte)")
    return parts


def fiche_notes(client, meta, data, out: Path):
    support = load_support(meta, out)
    if support:
        return completer(client, support, meta, notes_parts(meta, data), "les notes et photos (ou documents)", out)
    prompt = PROMPT_NOTES.format(matiere=meta.get("matiere") or "cours", date=meta.get("date") or "")
    md, model = generate(client, notes_parts(meta, data) + [prompt])
    titre = next((l[2:].strip() for l in md.splitlines() if l.startswith("# ")), meta.get("matiere"))
    write(out / "fiches" / f"{meta['id']}.enc", {
        "id": meta["id"], "kind": "cours", "source": "notes", "matiere": meta.get("matiere"),
        "date": meta.get("date"), "heure": meta.get("heure"), "creneau": meta.get("creneau"), "titre": titre, "md": md.strip(),
        "modele": model, "cree": datetime.now().isoformat(timespec="seconds")})


def write(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(encrypt_json(obj, os.environ["APP_PASSWORD"]), encoding="utf-8")


def main():
    inbox, out = Path(sys.argv[1]), Path(sys.argv[2])
    password = os.environ.get("APP_PASSWORD")
    if not password:
        sys.exit("APP_PASSWORD manquant")
    files = sorted((inbox / "inbox").glob("*.bin"))
    print(f"{len(files)} élément(s) à traiter")
    summary = []
    done, failed_now = [], set()
    client = None
    for p in files:
        print(f"- {p.name}")
        try:
            meta, audio = decrypt_upload(p.read_bytes(), password)
        except Exception:
            print("  illisible (mauvais mot de passe ?), ignoré")
            done.append(p.name)
            continue
        meta["id"] = re.sub(r"[^A-Za-z0-9_-]", "", str(meta.get("id") or p.stem))[:40]
        summary.append(meta.get("kind") or "cours")
        try:
            client = client or gemini()
            if meta.get("kind") == "revision":
                fiche_revision(client, meta, out, password)
            elif meta.get("kind") == "notes":
                fiche_notes(client, meta, audio, out)
            elif meta.get("kind") in ("devoir", "devoir_moodle"):
                import devoir
                write(out / "devoirs" / f"{meta['id']}.enc", devoir.make(client, generate, meta, audio))
            else:
                fiche_cours(client, meta, audio, out)
            print("  ok")
            summary[-1] += " ok"
            done.append(p.name)
        except Exception as e:
            msg = str(e)[:300]
            print(f"  échec : {type(e).__name__}")
            summary[-1] += f" échec ({type(e).__name__}: {re.sub(r'https?://\\S+', '<url>', msg)[:120]})"
            failed_now.add(meta["id"])
            # L'appli affiche l'erreur ; l'élément reste dans la boîte pour un nouvel essai.
            write(out / "erreurs" / f"{meta['id']}.enc",
                  {"id": meta["id"], "kind": "erreur", "matiere": meta.get("matiere"), "message": msg,
                   "quand": datetime.now().isoformat(timespec="seconds")})
            if meta.get("kind") == "revision" and "Aucune fiche" in msg:
                done.append(p.name)  # inutile de réessayer
    # un élément réussi efface l'erreur d'un essai précédent
    for name in done:
        err = out / "erreurs" / f"{Path(name).stem}.enc"
        if err.exists() and Path(name).stem not in failed_now:
            err.unlink()
    (inbox / ".traites").write_text("\n".join(done), encoding="utf-8")
    print(f"{len(done)}/{len(files)} terminé(s)")
    print(f"::notice::Boîte : {len(files)} élément(s) ; " + (" | ".join(summary) or "rien"))


if __name__ == "__main__":
    main()
