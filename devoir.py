"""
Devoirs : à partir d'un énoncé, Gemini rédige le devoir complet, rendu avec la même mise en page.

- Énoncé Word (.docx) : les réponses sont insérées dans le document d'origine, sous chaque
  question, avec les styles du document (titres, polices, marges, en-têtes conservés).
- Énoncé PDF, photo, texte ou devoir Moodle : un .docx est reconstruit avec la même structure
  (mêmes titres, même numérotation, questions recopiées) et les réponses sous chaque question.
"""

import base64
import io
import json
import re
from datetime import datetime

PROMPT = """Tu aides un étudiant en Bachelor cybersécurité à l'ECAM LaSalle (Lyon), matière « {matiere} ».
Voici l'énoncé d'un devoir{titre}. {consigne}

Réalise le devoir en entier, en français : réponses complètes, justifiées et rédigées comme un bon
étudiant (calculs détaillés, commandes ou code en blocs, schémas décrits en texte si besoin).
Ne saute aucune question. Si une question demande un avis personnel ou une expérience vécue,
propose une réponse plausible et signale-la par « (à personnaliser) »."""

PROMPT_DOCX = PROMPT + """

L'énoncé est un document Word découpé en paragraphes numérotés [n]. Réponds UNIQUEMENT en JSON :
{{
  "reponses": [{{"apres": <numéro du paragraphe après lequel insérer la réponse>, "texte": "<réponse, plusieurs lignes possibles>"}}],
  "md": "<le devoir complet en Markdown : énoncé recopié avec chaque réponse sous sa question>"
}}
Insère chaque réponse juste après la question (ou après le dernier paragraphe de la question).
Dans "texte", utilise des lignes commençant par "- " pour les listes et ``` pour le code.

Paragraphes de l'énoncé :
{paragraphes}"""

PROMPT_REBUILD = PROMPT + """

Rends le devoir complet en Markdown, en gardant EXACTEMENT la structure de l'énoncé :
mêmes titres (avec #, ##), même numérotation, chaque question recopiée telle quelle en **gras**,
puis la réponse juste en dessous. Commence par le titre du devoir (# …).
Réponds uniquement avec le Markdown."""


def _fmt(meta):
    titre = f" intitulé « {meta['titre']} »" if meta.get("titre") else ""
    consigne = f"Consigne de l'étudiant : {meta['consigne']}" if meta.get("consigne") else ""
    return dict(matiere=meta.get("matiere") or "non précisée", titre=titre, consigne=consigne)


# ---------- Markdown -> Word ----------

def _runs(par, text):
    """**gras**, *italique* et `code` dans un paragraphe Word."""
    for part in re.split(r"(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)", text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            par.add_run(part[2:-2]).bold = True
        elif part.startswith("`") and part.endswith("`"):
            r = par.add_run(part[1:-1]); r.font.name = "Consolas"
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            par.add_run(part[1:-1]).italic = True
        else:
            par.add_run(part)


def _style(doc, name, fallback="Normal"):
    try:
        doc.styles[name]
        return name
    except KeyError:
        return fallback


def md_to_docx(md, doc=None):
    from docx import Document
    from docx.shared import Pt
    doc = doc or Document()
    code = False
    for line in md.splitlines():
        if line.strip().startswith("```"):
            code = not code
            continue
        if code:
            p = doc.add_paragraph(style=_style(doc, "No Spacing"))
            r = p.add_run(line); r.font.name = "Consolas"; r.font.size = Pt(9.5)
            continue
        m = re.match(r"^(#{1,4})\s+(.*)", line)
        if m:
            level = len(m.group(1))
            doc.add_heading(m.group(2).replace("**", ""), level=0 if level == 1 else min(level - 1, 3))
        elif re.match(r"^\s*[-*•]\s+", line):
            _runs(doc.add_paragraph(style=_style(doc, "List Bullet")), re.sub(r"^\s*[-*•]\s+", "", line))
        elif re.match(r"^\s*\d+[.)]\s+", line):
            _runs(doc.add_paragraph(style=_style(doc, "List Number")), re.sub(r"^\s*\d+[.)]\s+", "", line))
        elif line.strip():
            _runs(doc.add_paragraph(), line.strip())
    return doc


# ---------- Énoncé Word : insertion des réponses dans l'original ----------

def _insert_after(par, text, doc):
    """Insère la réponse (plusieurs paragraphes) après `par`, en style du document."""
    from docx.oxml import OxmlElement
    from docx.text.paragraph import Paragraph
    anchor, code = par, False
    for line in text.splitlines() or [text]:
        if line.strip().startswith("```"):
            code = not code
            continue
        new_p = OxmlElement("w:p")
        anchor._p.addnext(new_p)
        p = Paragraph(new_p, anchor._parent)
        bullet = re.match(r"^\s*[-*•]\s+(.*)", line)
        if code:
            p.style = doc.styles[_style(doc, "No Spacing")]
            r = p.add_run(line); r.font.name = "Consolas"
        elif bullet:
            p.style = doc.styles[_style(doc, "List Bullet")]
            _runs(p, bullet.group(1))
        else:
            p.style = doc.styles["Normal"]
            _runs(p, line)
        anchor = p
    return anchor


def docx_answer(client, generate, data, meta):
    from docx import Document
    doc = Document(io.BytesIO(data))
    pars = doc.paragraphs
    listing = "\n".join(f"[{i}] {p.text}" for i, p in enumerate(pars) if p.text.strip())
    if len(listing) < 30:
        raise RuntimeError("Énoncé Word vide (le texte est peut-être dans des images)")
    raw, model = generate(client, PROMPT_DOCX.format(paragraphes=listing[:100000], **_fmt(meta)), json_mode=True)
    out = json.loads(re.sub(r"^```(?:json)?|```$", "", raw.strip()).strip())
    # du bas vers le haut, pour ne pas décaler les numéros
    for rep in sorted(out.get("reponses", []), key=lambda r: -int(r.get("apres", 0))):
        i = int(rep.get("apres", -1))
        if 0 <= i < len(pars) and rep.get("texte", "").strip():
            _insert_after(pars[i], rep["texte"].strip(), doc)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue(), out.get("md", ""), model


# ---------- Autres énoncés : reconstruction ----------

def rebuild(client, generate, parts, meta):
    md, model = generate(client, parts + [PROMPT_REBUILD.format(**_fmt(meta))])
    md = re.sub(r"^```(?:markdown|md)?\s*|\s*```$", "", md.strip())
    buf = io.BytesIO()
    md_to_docx(md).save(buf)
    return buf.getvalue(), md, model


def statement_parts(client, data, filename, mime):
    """Énoncé (non Word) -> contenu à donner à Gemini."""
    from google.genai import types
    name = (filename or "").lower()
    if name.endswith(".pdf") or data[:4] == b"%PDF":
        return [types.Part.from_bytes(data=data, mime_type="application/pdf")]
    if (mime or "").startswith("image/") or re.search(r"\.(png|jpe?g|heic|webp)$", name):
        return [types.Part.from_bytes(data=data, mime_type=mime if (mime or "").startswith("image/") else "image/jpeg")]
    if name.endswith(".pptx"):
        from pptx import Presentation
        prs = Presentation(io.BytesIO(data))
        txt = "\n\n".join("\n".join(sh.text_frame.text for sh in s.shapes if getattr(sh, "has_text_frame", False))
                          for s in prs.slides)
        return ["Énoncé :\n" + txt]
    return ["Énoncé :\n" + data.decode("utf-8", "ignore")[:100000]]


def moodle_statement(cmid):
    """Énoncé d'un devoir Moodle : consigne + fichiers joints (connexion ECAM)."""
    import requests
    from bs4 import BeautifulSoup
    from urllib.parse import unquote, urljoin
    import ecam_scraper as ecam
    user, pwd = ecam.load_env()
    s = requests.Session()
    s.headers["User-Agent"] = ecam.UA
    ecam.cas_login(s, ecam.MOODLE_LOGIN, user, pwd)
    soup = BeautifulSoup(s.get(f"{ecam.MOODLE}/mod/assign/view.php?id={int(cmid)}", timeout=40).text, "html.parser")
    title = soup.select_one("h1, h2")
    intro = soup.select_one(".activity-description, #intro, .box.generalbox")
    text = intro.get_text("\n", strip=True) if intro else ""
    files = []
    for a in soup.select('a[href*="pluginfile.php"]'):
        href = a["href"]
        if "introattachment" not in href and "intro" not in href:
            continue
        r = s.get(urljoin(ecam.MOODLE, href), timeout=90)
        if r.ok and len(r.content) < 30e6:
            files.append((unquote(href.split("?")[0].rsplit("/", 1)[-1]), r.content, r.headers.get("content-type", "")))
        if len(files) >= 3:
            break
    return (title.get_text(strip=True) if title else ""), text, files


def make(client, generate, meta, data):
    """Point d'entrée : renvoie le dict chiffré ensuite dans devoirs/."""
    filename = meta.get("nom") or ""
    if meta.get("kind") == "devoir_moodle":
        titre, text, files = moodle_statement(meta["cmid"])
        meta.setdefault("titre", titre)
        docx_file = next((f for f in files if f[0].lower().endswith(".docx")), None)
        if docx_file and not text.strip():
            data, filename = docx_file[1], docx_file[0]
        else:
            parts = [f"Consigne du devoir sur Moodle :\n{text}"] if text.strip() else []
            for fname, content, ctype in files:
                if fname.lower().endswith(".docx"):
                    from docx import Document
                    d = Document(io.BytesIO(content))
                    parts.append(f"Fichier joint {fname} :\n" + "\n".join(p.text for p in d.paragraphs))
                else:
                    parts += statement_parts(client, content, fname, ctype)
            if not parts:
                raise RuntimeError("Énoncé introuvable sur Moodle (consigne vide, pas de fichier joint)")
            out, md, model = rebuild(client, generate, parts, meta)
            return _result(meta, out, md, model, "reconstruit")

    if filename.lower().endswith(".docx"):
        out, md, model = docx_answer(client, generate, data, meta)
        return _result(meta, out, md, model, "original")
    out, md, model = rebuild(client, generate, statement_parts(client, data, filename, meta.get("type")), meta)
    return _result(meta, out, md, model, "reconstruit")


def _result(meta, docx_bytes, md, model, mode):
    titre = meta.get("titre") or next((l[2:].strip() for l in md.splitlines() if l.startswith("# ")), "Devoir")
    base = re.sub(r"\.[^.]+$", "", meta.get("nom") or titre)
    return {"id": meta["id"], "kind": "devoir", "titre": titre, "matiere": meta.get("matiere"),
            "fichier": f"{base} - fait.docx", "mise_en_page": mode, "md": md,
            "docx": base64.b64encode(docx_bytes).decode(), "modele": model,
            "cree": datetime.now().isoformat(timespec="seconds")}
