"""
Dépôt d'un fichier dans un devoir Moodle, depuis l'appli (connexion ECAM des secrets GitHub).

Deux temps, comme sur Moodle :
1. « deposer » : le fichier remplace les fichiers du brouillon et le formulaire est enregistré.
2. « envoyer » : seulement si Moodle demande « Envoyer le devoir » (définitif) ET que l'étudiant
   l'a confirmé dans l'appli (avec la déclaration sur l'honneur s'il y en a une).

Rien n'est envoyé définitivement sans une demande explicite (meta["envoyer"]).
Journaux volontairement vagues : le dépôt GitHub est public.
"""

import json
import re
from datetime import datetime
from urllib.parse import urljoin

from bs4 import BeautifulSoup

import ecam_scraper as ecam


class DepotError(RuntimeError):
    pass


def _session():
    import requests
    user, pwd = ecam.load_env()
    s = requests.Session()
    s.headers["User-Agent"] = ecam.UA
    ecam.cas_login(s, ecam.MOODLE_LOGIN, user, pwd)
    return s


def _soup(s, url, **kw):
    r = s.get(url, timeout=60, **kw)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    return soup, r.text


def _form_fields(form):
    """Champs d'un formulaire HTML -> dict (sans les boutons)."""
    data = {}
    for el in form.select("input[name], textarea[name], select[name]"):
        name, typ = el.get("name"), (el.get("type") or "").lower()
        if typ in ("submit", "button", "image", "file"):
            continue
        if typ in ("checkbox", "radio") and not el.has_attr("checked"):
            continue
        if el.name == "textarea":
            data[name] = el.get_text()
        elif el.name == "select":
            opt = el.select_one("option[selected]") or el.select_one("option")
            data[name] = opt.get("value", "") if opt else ""
        else:
            data[name] = el.get("value", "")
    return data


def _filemanager_options(html):
    """Options du gestionnaire de fichiers Moodle (itemid, dépôt « upload », contexte…)."""
    dec = json.JSONDecoder()
    for m in re.finditer(r"M\.form_filemanager\.init\(\s*Y\s*,\s*", html):
        try:
            opts, _ = dec.raw_decode(html[m.end():])
            if isinstance(opts, dict) and opts.get("itemid"):
                return opts
        except ValueError:
            continue
    return None


def status(s, cmid):
    """État du devoir sur sa page : statut, besoin d'« Envoyer le devoir », date limite."""
    soup, _ = _soup(s, f"{ecam.MOODLE}/mod/assign/view.php?id={int(cmid)}")
    rows = {}
    for tr in soup.select("table tr"):
        th, td = tr.select_one("th"), tr.select_one("td")
        if th and td:
            rows[th.get_text(" ", strip=True).lower()] = td.get_text(" ", strip=True)
    statut = next((v for k, v in rows.items() if "statut des travaux" in k or "submission status" in k), "")
    fichiers = next((v for k, v in rows.items() if "fichiers" in k or "file submissions" in k), "")
    envoi = soup.select_one('form input[name="action"][value="submit"]') is not None
    return {"statut": statut, "fichiers": fichiers[:300], "besoin_envoi": envoi}


def deposer(s, cmid, nom, contenu):
    base = f"{ecam.MOODLE}/mod/assign/view.php"
    soup, html = _soup(s, f"{base}?id={int(cmid)}&action=editsubmission")
    form = next((f for f in soup.select("form") if f.select_one('input[name="files_filemanager"]')), None)
    if form is None:
        if soup.select_one('[name^="onlinetext"]'):
            raise DepotError("ce devoir se rend en texte en ligne sur Moodle, pas en fichier")
        raise DepotError("Moodle ne propose pas de déposer un fichier pour ce devoir "
                         "(date limite passée, devoir déjà envoyé ou fermé ?)")
    opts = _filemanager_options(html)
    if not opts:
        raise DepotError("zone de dépôt de fichier introuvable sur la page Moodle")
    fields = _form_fields(form)
    sesskey = fields.get("sesskey") or re.search(r'"sesskey":"([^"]+)"', html).group(1)
    itemid = fields.get("files_filemanager") or str(opts["itemid"])
    client_id = opts.get("client_id", "")
    ctx = (opts.get("context") or {}).get("id") or re.search(r'"contextid":(\d+)', html).group(1)

    # formats acceptés par le devoir
    accepted = opts.get("accepted_types") or "*"
    if isinstance(accepted, list) and accepted and "*" not in accepted:
        ext = "." + nom.rsplit(".", 1)[-1].lower() if "." in nom else ""
        if ext not in [a.lower() for a in accepted]:
            raise DepotError(f"ce devoir n'accepte que : {', '.join(accepted)}")

    # dépôt « Téléverser un fichier »
    repo_id = next((r.get("id") for r in (opts.get("filepicker", {}).get("repositories")
                                          or opts.get("repositories") or {}).values()
                    if isinstance(r, dict) and r.get("type") == "upload"), None)
    if repo_id is None:
        repo_id = next((m for m in re.findall(r'"id":"?(\d+)"?,"name":"[^"]*","type":"upload"', html)), None)
    if repo_id is None:
        raise DepotError("le téléversement de fichier n'est pas disponible sur ce devoir")

    # on retire les fichiers déjà présents dans le brouillon (le nouveau fichier les remplace)
    ajax = f"{ecam.MOODLE}/repository/draftfiles_ajax.php"
    common = {"sesskey": sesskey, "client_id": client_id, "itemid": itemid, "filepath": "/"}
    try:
        lst = s.post(f"{ajax}?action=list", data=common, timeout=40).json()
        for f in (lst.get("list") or []):
            if f.get("type") != "folder":
                s.post(f"{ajax}?action=delete", data={**common, "filename": f["filename"]}, timeout=40)
    except ValueError:
        pass

    up = s.post(f"{ecam.MOODLE}/repository/repository_ajax.php?action=upload",
                data={"sesskey": sesskey, "repo_id": repo_id, "itemid": itemid, "ctx_id": ctx,
                      "savepath": "/", "title": nom, "author": "", "license": "unknown",
                      "client_id": client_id, "env": "filemanager", "overwrite": "1",
                      "maxbytes": opts.get("maxbytes", -1), "areamaxbytes": opts.get("areamaxbytes", -1)},
                files={"repo_upload_file": (nom, contenu)}, timeout=180)
    try:
        res = up.json()
    except ValueError:
        raise DepotError(f"Moodle a refusé le fichier (réponse inattendue, {up.status_code})")
    if isinstance(res, dict) and res.get("error"):
        raise DepotError(f"Moodle a refusé le fichier : {res['error']}")

    # enregistrer le formulaire (bouton « Enregistrer »)
    btn = form.select_one('input[type="submit"][name="submitbutton"]')
    fields["submitbutton"] = btn.get("value", "Enregistrer") if btn else "Enregistrer"
    fields["files_filemanager"] = itemid
    action = urljoin(base, form.get("action") or base)
    r = s.post(action, data=fields, timeout=60)
    r.raise_for_status()
    err = BeautifulSoup(r.text, "html.parser").select_one(".error, .alert-danger, .form-control-feedback.invalid-feedback")
    if err and err.get_text(strip=True):
        raise DepotError(f"Moodle n'a pas accepté le dépôt : {err.get_text(' ', strip=True)[:200]}")


def envoyer(s, cmid, accepte_declaration):
    base = f"{ecam.MOODLE}/mod/assign/view.php"
    soup, _ = _soup(s, f"{base}?id={int(cmid)}&action=submit")
    form = next((f for f in soup.select("form") if f.select_one('input[name="action"][value="confirmsubmit"]')), None)
    if form is None:
        return None, "Moodle ne demande pas d'envoi pour ce devoir (déjà envoyé ?)"
    decl = form.select_one('input[name="submissionstatement"]')
    texte = ""
    if decl is not None:
        lab = form.select_one(f'label[for="{decl.get("id")}"]') if decl.get("id") else None
        texte = (lab or decl.find_parent()).get_text(" ", strip=True)
        if not accepte_declaration:
            return texte, "la déclaration sur l'honneur doit être acceptée dans l'appli"
    fields = _form_fields(form)
    if decl is not None:
        fields["submissionstatement"] = "1"
    btn = form.select_one('input[type="submit"][name="submitbutton"]')
    fields["submitbutton"] = btn.get("value", "Continuer") if btn else "Continuer"
    r = s.post(urljoin(base, form.get("action") or base), data=fields, timeout=60)
    r.raise_for_status()
    return texte, None


def declaration(s, cmid):
    """Texte de la déclaration sur l'honneur demandée à l'envoi (ou "")."""
    soup, _ = _soup(s, f"{ecam.MOODLE}/mod/assign/view.php?id={int(cmid)}&action=submit")
    decl = soup.select_one('input[name="submissionstatement"]')
    if decl is None:
        return ""
    lab = soup.select_one(f'label[for="{decl.get("id")}"]') if decl.get("id") else None
    return (lab or decl.find_parent()).get_text(" ", strip=True)


def make(meta, data):
    """Point d'entrée (process_inbox) : renvoie le résultat chiffré ensuite dans depots/."""
    cmid = int(meta["cmid"])
    s = _session()
    out = {"id": meta["id"], "kind": "depot", "cmid": cmid, "titre": meta.get("titre"),
           "fichier": meta.get("nom"), "action": meta.get("action") or "deposer",
           "quand": datetime.now().isoformat(timespec="seconds")}
    if out["action"] == "envoyer":
        texte, refus = envoyer(s, cmid, bool(meta.get("accepte_declaration")))
        if refus and texte:
            out["declaration"] = texte
            raise DepotError(refus)
        out["message"] = refus or "Devoir envoyé pour évaluation."
    else:
        if not data:
            raise DepotError("fichier vide")
        deposer(s, cmid, meta.get("nom") or "devoir.pdf", data)
        if meta.get("envoyer"):
            texte, refus = envoyer(s, cmid, bool(meta.get("accepte_declaration")))
            out["declaration"] = texte
            out["message"] = refus or "Déposé et envoyé pour évaluation."
        else:
            out["message"] = "Déposé sur Moodle."
    st = status(s, cmid)
    out.update(st)
    if st["besoin_envoi"]:
        out["declaration"] = out.get("declaration") or declaration(s, cmid)
    print(f"::notice::Dépôt Moodle : {out['action']} ok, envoi encore nécessaire : {'oui' if st['besoin_envoi'] else 'non'}")
    return out
