"""
Prépare le dossier site/ publié sur GitHub Pages :
- copie l'interface (web/)
- chiffre les données (data/*.json) avec APP_PASSWORD -> site/data.enc
Le site est public, mais sans le mot de passe data.enc est illisible.
AES-256-GCM, clé dérivée par PBKDF2-SHA256 (même schéma que le navigateur).
"""

import base64
import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

BASE = Path(__file__).parent
DATA, WEB, SITE = BASE / "data", BASE / "web", BASE / "site"
ITERATIONS = 250_000


def read(name, default):
    try:
        return json.loads((DATA / name).read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return default


def encrypt(payload: bytes, password: str) -> dict:
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(hashes.SHA256(), 32, salt, ITERATIONS).derive(password.encode("utf-8"))
    ct = AESGCM(key).encrypt(iv, payload, None)
    b64 = lambda b: base64.b64encode(b).decode()
    return {"v": 1, "iter": ITERATIONS, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}


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
    }
    shutil.rmtree(SITE, ignore_errors=True)
    shutil.copytree(WEB, SITE)
    blob = encrypt(json.dumps(data, ensure_ascii=False).encode("utf-8"), password)
    (SITE / "data.enc").write_text(json.dumps(blob), encoding="utf-8")
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    (SITE / "config.json").write_text(json.dumps({"repo": repo}), encoding="utf-8")
    print(f"Site prêt : {len(data['planning'])} créneaux, {len(data['devoirs'])} devoirs, "
          f"{len(data['notes'])} notes, {len(data['cours'])} cours (chiffrés)")


if __name__ == "__main__":
    main()
