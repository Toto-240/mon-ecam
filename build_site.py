"""
Prépare le dossier site/ publié sur GitHub Pages :
- copie l'interface (web/)
- chiffre les données (data/*.json) avec APP_PASSWORD -> site/data.enc
Le site est public, mais sans le mot de passe data.enc est illisible.
Ajoute aussi les fiches de cours et de révision (fiches/, revisions/), déjà chiffrées.
"""

import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

import changements
from crypto_util import decrypt_json, encrypt_json

BASE = Path(__file__).parent
DATA, WEB, SITE = BASE / "data", BASE / "web", BASE / "site"


def read(name, default):
    try:
        return json.loads((DATA / name).read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return default


def read_enc_dir(name, password):
    """Fiches / révisions / erreurs déjà chiffrées dans le dépôt."""
    items = []
    for p in sorted((BASE / name).glob("*.enc")):
        try:
            items.append(decrypt_json(p.read_text(encoding="utf-8"), password))
        except Exception:
            print(f"{name}/{p.name} illisible, ignoré")
    return items


def read_perso(password):
    """Devoirs marqués faits et DS ajoutés à la main dans l'appli (perso/etat.enc)."""
    p = BASE / "perso" / "etat.enc"
    try:
        return decrypt_json(p.read_text(encoding="utf-8"), password)
    except FileNotFoundError:
        return None
    except Exception:
        print("perso/etat.enc illisible, ignoré")
        return None


def main():
    password = os.environ.get("APP_PASSWORD")
    if not password:
        sys.exit("APP_PASSWORD manquant : ajoute-le dans les Secrets du dépôt GitHub")

    data = {
        "planning": read("planning.json", []),
        "devoirs": read("devoirs.json", []),
        "notes": read("notes.json", []),
        "cours": read("cours.json", []),
        "maj": read("meta.json", {}).get("maj") or datetime.now().isoformat(timespec="seconds"),
        "fiches": read_enc_dir("fiches", password),
        "revisions": read_enc_dir("revisions", password),
        "erreurs": read_enc_dir("erreurs", password),
        # devoirs faits : seulement la liste ici, le fichier se charge à l'ouverture
        "perso": read_perso(password),
        "travaux": [{k: d.get(k) for k in ("id", "titre", "matiere", "fichier", "mise_en_page", "cree")}
                    for d in read_enc_dir("devoirs", password)],
    }
    # changements d'emploi du temps : comparaison avec la version en ligne
    prev = changements.previous_published(password)
    history = (prev or {}).get("changements", [])
    new = []
    if prev and prev.get("planning") and data["planning"]:
        new = changements.detect(prev["planning"], data["planning"])
    data["changements"] = changements.merge(history, new)
    print("::notice::Emploi du temps : " + (f"comparé à la version en ligne ({len(new)} changement(s))" if prev
          else "version précédente introuvable, comparaison au prochain passage"))
    if new:
        print(f"::notice::{len(new)} changement(s) d'emploi du temps")
        changements.notify(new)

    shutil.rmtree(SITE, ignore_errors=True)
    shutil.copytree(WEB, SITE)
    (SITE / "data.enc").write_text(encrypt_json(data, password), encoding="utf-8")
    if (BASE / "devoirs").is_dir():
        shutil.copytree(BASE / "devoirs", SITE / "devoirs")  # déjà chiffrés
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    (SITE / "config.json").write_text(json.dumps({"repo": repo}), encoding="utf-8")
    print(f"Site prêt : {len(data['planning'])} créneaux, {len(data['devoirs'])} devoirs, "
          f"{len(data['notes'])} notes, {len(data['cours'])} cours, {len(data['fiches'])} fiches (chiffrés)")


if __name__ == "__main__":
    main()
