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
    }
    shutil.rmtree(SITE, ignore_errors=True)
    shutil.copytree(WEB, SITE)
    (SITE / "data.enc").write_text(encrypt_json(data, password), encoding="utf-8")
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    (SITE / "config.json").write_text(json.dumps({"repo": repo}), encoding="utf-8")
    print(f"Site prêt : {len(data['planning'])} créneaux, {len(data['devoirs'])} devoirs, "
          f"{len(data['notes'])} notes, {len(data['cours'])} cours, {len(data['fiches'])} fiches (chiffrés)")


if __name__ == "__main__":
    main()
