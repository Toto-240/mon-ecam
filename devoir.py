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
Ne saute aucune question, et remplis aussi les tableaux à compléter.

TRÈS IMPORTANT : les images jointes font partie de l'énoncé (captures Wireshark, trames en hexadécimal,
schémas, tables d'adressage…). Lis-les attentivement et réponds avec les VRAIES valeurs qu'elles montrent
(adresses MAC/IP, octets, champs, noms de constructeurs) en citant où tu les lis. N'invente jamais de
valeurs « d'exemple » ou « typiques ». Si une valeur est vraiment illisible, écris « (illisible sur la capture) ».
Quand l'énoncé demande une capture d'écran (Packet Tracer…), donne les commandes et la sortie attendue
en bloc de code, suivies de « (à remplacer par ta capture d'écran) ».
Si une question demande un avis personnel ou une expérience vécue, propose une réponse plausible et
signale-la par « (à personnaliser) »."""

PROMPT_DOCX = PROMPT + """

L'énoncé est un document Word découpé en paragraphes numérotés [n]. Les images sont jointes dans
l'ordre, et repérées dans le texte par « [image k] » à l'endroit où elles se trouvent.
Les cellules des tableaux sont repérées par [Tt Ll Cc] (tableau t, ligne l, colonne c, à partir de 0).
Réponds UNIQUEMENT en JSON :
{{
  "reponses": [{{"apres": <numéro du paragraphe après lequel insérer la réponse>, "texte": "<réponse, plusieurs lignes possibles>"}}],
  "cellules": [{{"cellule": "T0 L1 C2", "texte": "<contenu de la cellule vide à remplir>"}}],
  "md": "<le devoir complet en Markdown : énoncé recopié avec chaque réponse sous sa question>"
}}
Insère chaque réponse juste après la question (ou après le dernier paragraphe de la question).
Quand un même paragraphe contient plusieurs questions (A, B, C…), donne une réponse par question,
préfixée « Réponse A : », « Réponse B : »…, dans un seul "texte".
Dans "texte", utilise des lignes commençant par "- " pour les listes et ``` pour le code.

Énoncé :
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


IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}


def _images_of(par, doc):
    """Images d'un paragraphe Word (dans l'ordre) : [(octets, type)]."""
    out = []
    for blip in par._p.xpath(".//a:blip"):
        rid = blip.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed")
        part = doc.part.related_parts.get(rid) if rid else None
        if part is not None:
            out.append((part.blob, part.content_type))
    return out


def _image_part(blob, ctype):
    """Image -> morceau pour Gemini (les formats Windows type EMF sont convertis si possible)."""
    from google.genai import types
    if ctype not in IMAGE_TYPES:
        try:
            from PIL import Image
            buf = io.BytesIO()
            Image.open(io.BytesIO(blob)).convert("RGB").save(buf, "PNG")
            blob, ctype = buf.getvalue(), "image/png"
        except Exception:
            return None
    return types.Part.from_bytes(data=blob, mime_type=ctype)


def docx_parts(doc):
    """Texte numéroté + images + tableaux d'un énoncé Word."""
    pars = doc.paragraphs
    lines, images = [], []
    for i, p in enumerate(pars):
        marks = ""
        for blob, ctype in _images_of(p, doc):
            part = _image_part(blob, ctype)
            if part is not None:
                images.append(part)
                marks += f" [image {len(images)}]"
        if p.text.strip() or marks:
            lines.append(f"[{i}] {p.text}{marks}")
    for t, table in enumerate(doc.tables):
        lines.append(f"\nTableau T{t} :")
        for l, row in enumerate(table.rows):
            seen = set()
            for c, cell in enumerate(row.cells):
                if id(cell._tc) in seen:   # cellules fusionnées
                    continue
                seen.add(id(cell._tc))
                txt = cell.text.strip().replace("\n", " / ")
                lines.append(f"[T{t} L{l} C{c}] {txt or '(vide)'}")
    return "\n".join(lines), images


def _fill_cell(doc, ref, text):
    m = re.match(r"T(\d+)\s*L(\d+)\s*C(\d+)", ref or "")
    if not m:
        return
    t, l, c = map(int, m.groups())
    try:
        cell = doc.tables[t].rows[l].cells[c]
    except IndexError:
        return
    lines = [x for x in text.splitlines() if x.strip()] or [text]
    first = cell.paragraphs[-1] if not cell.paragraphs[-1].text.strip() else cell.add_paragraph()
    _runs(first, lines[0].strip())
    for line in lines[1:]:
        _runs(cell.add_paragraph(), re.sub(r"^\s*[-*•]\s+", "• ", line.strip()))


def docx_answer(client, generate, data, meta, extra=None):
    from docx import Document
    doc = Document(io.BytesIO(data))
    pars = doc.paragraphs
    listing, images = docx_parts(doc)
    if len(listing) < 30 and not images:
        raise RuntimeError("Énoncé Word vide")
    print(f"  énoncé Word : {len(pars)} paragraphes, {len(images)} image(s), {len(doc.tables)} tableau(x)")
    prompt = PROMPT_DOCX.format(paragraphes=listing[:120000], **_fmt(meta))
    contents = (extra or []) + images + [prompt]
    raw, model = generate(client, contents, json_mode=True, strong=True)
    from process_inbox import parse_json
    out = parse_json(raw)
    for cel in out.get("cellules", []) or []:
        if str(cel.get("texte", "")).strip():
            _fill_cell(doc, cel.get("cellule"), str(cel["texte"]).strip())
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
    md, model = generate(client, parts + [PROMPT_REBUILD.format(**_fmt(meta))], strong=True)
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
    """Énoncé d'un devoir Moodle : consigne + fichiers joints (connexion ECAM).
    Si la page du devoir est vide, on prend les documents de la même section du cours
    (souvent le sujet est déposé à côté du devoir)."""
    import requests
    from bs4 import BeautifulSoup
    from urllib.parse import unquote, urljoin
    import ecam_scraper as ecam
    user, pwd = ecam.load_env()
    s = requests.Session()
    s.headers["User-Agent"] = ecam.UA
    ecam.cas_login(s, ecam.MOODLE_LOGIN, user, pwd)
    soup = BeautifulSoup(s.get(f"{ecam.MOODLE}/mod/assign/view.php?id={int(cmid)}", timeout=40).text, "html.parser")
    for hidden in soup.select(".accesshide, .sr-only, .visually-hidden"):
        hidden.decompose()
    title = soup.select_one("#page-header h1, .page-header-headings h1, h1, h2")
    region = soup.select_one("#region-main") or soup
    intro = (region.select_one(".activity-description") or region.select_one("#intro")
             or region.select_one('[id^="intro"]') or region.select_one(".box.generalbox"))
    text = intro.get_text("\n", strip=True) if intro else ""
    files = []
    for a in region.select('a[href*="pluginfile.php"]'):
        href = a["href"]
        if "/mod_assign/" not in href or not re.search(r"intro", href):
            continue
        r = s.get(urljoin(ecam.MOODLE, href), timeout=90)
        if r.ok and len(r.content) < 30e6:
            files.append((unquote(href.split("?")[0].rsplit("/", 1)[-1]), r.content, r.headers.get("content-type", "")))
        if len(files) >= 3:
            break

    source = "page du devoir"
    n_links = len(region.select('a[href*="pluginfile.php"]'))
    diag = (f"page devoir : titre={'oui' if title else 'non'}, zone principale={len(region.get_text(strip=True))} car., "
            f"bloc consigne={'oui' if intro else 'non'}, liens fichiers={n_links}, "
            f"connecté={'oui' if 'logout' in str(soup) else 'non'}")
    print(f"::notice::{diag}")
    if len(text.strip()) < 40 and not files:
        files, extra = section_documents(s, soup, cmid)
        text = (text + "\n" + extra).strip()
        source = "section du cours"
    print(f"::notice::Énoncé Moodle : {len(text)} caractères, {len(files)} fichier(s) ({source})")
    return (title.get_text(strip=True) if title else ""), text, files


def section_documents(s, assign_soup, cmid):
    """Documents déposés dans la même section du cours que le devoir."""
    from bs4 import BeautifulSoup
    import ecam_scraper as ecam
    import moodle_fiches
    # numéro du cours : classe « course-N » du <body> ou configuration Moodle de la page
    body = assign_soup.find("body")
    m = re.search(r"\bcourse-(\d+)\b", " ".join(body.get("class", []))) if body else None
    m = m or re.search(r'"courseId"\s*:\s*(\d+)', str(assign_soup))
    if not m:
        print("::notice::section : lien vers le cours introuvable")
        return [], ""
    page = BeautifulSoup(s.get(f"{ecam.MOODLE}/course/view.php?id={m.group(1)}", timeout=40).text, "html.parser")
    for hidden in page.select(".accesshide, .sr-only, .visually-hidden"):
        hidden.decompose()
    node = (page.select_one(f"#module-{int(cmid)}") or page.select_one(f'[data-id="{int(cmid)}"]')
            or page.select_one(f'a[href*="mod/assign/view.php?id={int(cmid)}"]'))
    ancestors = list(node.parents) if node is not None else []
    # d'abord le bloc complet de la section (Moodle 4 : data-for="section" / id="section-N")
    section = next((n for n in ancestors if getattr(n, "get", None) and
                    (n.get("data-for") == "section" or str(n.get("id", "")).startswith("section-"))), None)
    section = section or next((n for n in ancestors if getattr(n, "get", None) and
                               re.search(r"\b(section|course-section|tile|topic)\b", " ".join(n.get("class", [])))), None)
    n_mods = len(page.select('a[href*="/mod/"]'))
    print(f"::notice::section : devoir trouvé dans le cours={'oui' if node is not None else 'non'}, "
          f"section trouvée={'oui' if section is not None else 'non'}, liens d'activités dans le cours={n_mods}")
    if section is None and node is not None:
        # pas de section reconnaissable : les documents déposés juste avant le devoir
        links = page.select('a[href*="/mod/"]')
        anchor = node if node.name == "a" else node.select_one("a")
        idx = next((i for i, a in enumerate(links) if a is anchor), None)
        if idx is not None:
            section = BeautifulSoup("<div>" + "".join(str(a) for a in links[max(0, idx - 3):idx]) + "</div>", "html.parser")
    if section is None:
        return [], ""
    files, texts = [], []
    for a in section.select('a[href*="/mod/"]'):
        mm = re.search(r"/mod/(resource|folder|page)/view\.php\?id=(\d+)", a.get("href", ""))
        if not mm:
            continue
        name = (a.select_one(".instancename") or a).get_text(" ", strip=True)
        for doc in moodle_fiches.documents(s, mm.group(2), mm.group(1), name, {}):
            if "text" in doc:
                texts.append(f"{doc['titre']} :\n{doc['text']}")
            else:
                ext = doc["fichier"].lower().rsplit(".", 1)[-1]
                ctype = {"pdf": "application/pdf", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"}.get(ext, "")
                files.append((doc["fichier"], doc["data"], ctype))
        if len(files) >= 4:
            break
    n_acts = len(section.select('a[href*="/mod/"]'))
    print(f"::notice::section : {n_acts} activité(s), {len(files)} document(s) récupéré(s)")
    summary = section.select_one(".summarytext, .section_summary, .summary")
    if summary and summary.get_text(strip=True):
        texts.insert(0, "Présentation de la section :\n" + summary.get_text("\n", strip=True))
    return files[:4], "\n\n".join(texts)


def make(client, generate, meta, data):
    """Point d'entrée : renvoie le dict chiffré ensuite dans devoirs/."""
    filename = meta.get("nom") or ""
    if meta.get("kind") == "devoir_moodle":
        titre, text, files = moodle_statement(meta["cmid"])
        meta.setdefault("titre", titre)
        docx_file = next((f for f in files if f[0].lower().endswith(".docx")), None)
        if docx_file:
            # le sujet Word est complété directement (mise en page, images et tableaux d'origine)
            extra = [f"Consigne du devoir sur Moodle :\n{text}"] if text.strip() else []
            for fname, content, ctype in files:
                if fname != docx_file[0] and not fname.lower().endswith(".docx"):
                    extra += statement_parts(client, content, fname, ctype)
            meta["nom"] = docx_file[0]
            out, md, model = docx_answer(client, generate, docx_file[1], meta, extra)
            return _result(meta, out, md, model, "original")
        else:
            parts = [f"Consigne du devoir sur Moodle :\n{text}"] if text.strip() else []
            for fname, content, ctype in files:
                if fname.lower().endswith(".docx"):
                    from docx import Document
                    listing, imgs = docx_parts(Document(io.BytesIO(content)))
                    parts += [f"Fichier joint {fname} :\n{listing}"] + imgs
                else:
                    parts += statement_parts(client, content, fname, ctype)
            if not parts:
                raise RuntimeError("Énoncé introuvable sur Moodle : la page du devoir et sa section sont vides. "
                                   "Télécharge le sujet et envoie-le dans l'onglet Devoirs.")
            out, md, model = rebuild(client, generate, parts, meta)
            return _result(meta, out, md, model, "reconstruit")

    if filename.lower().endswith(".docx"):
        out, md, model = docx_answer(client, generate, data, meta)
        return _result(meta, out, md, model, "original")
    out, md, model = rebuild(client, generate, statement_parts(client, data, filename, meta.get("type")), meta)
    return _result(meta, out, md, model, "reconstruit")


def to_pdf(docx_bytes):
    """PDF fidèle au .docx (LibreOffice). Renvoie None si LibreOffice est absent ou échoue."""
    import shutil
    import subprocess
    import tempfile
    from pathlib import Path
    exe = shutil.which("soffice") or shutil.which("libreoffice")
    if not exe:
        return None
    with tempfile.TemporaryDirectory() as d:
        src = Path(d) / "devoir.docx"
        src.write_bytes(docx_bytes)
        try:
            subprocess.run([exe, "--headless", "--convert-to", "pdf", "--outdir", d, str(src)],
                           check=True, capture_output=True, timeout=180)
            return (Path(d) / "devoir.pdf").read_bytes()
        except Exception:
            return None


def _result(meta, docx_bytes, md, model, mode):
    titre = meta.get("titre") or next((l[2:].strip() for l in md.splitlines() if l.startswith("# ")), "Devoir")
    base = re.sub(r"\.[^.]+$", "", meta.get("nom") or titre)
    pdf = to_pdf(docx_bytes)
    return {"id": meta["id"], "kind": "devoir", "titre": titre, "matiere": meta.get("matiere"),
            "fichier": f"{base} - fait.docx", "mise_en_page": mode, "md": md,
            "docx": base64.b64encode(docx_bytes).decode(),
            "pdf": base64.b64encode(pdf).decode() if pdf else None,
            "modele": model, "pour": meta.get("pour"), "cree": datetime.now().isoformat(timespec="seconds")}
