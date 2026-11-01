"""
Chiffrement partagé entre GitHub et l'appli (même schéma que le navigateur) :
AES-256-GCM, clé dérivée du mot de passe par PBKDF2-SHA256.

- Données texte (data.enc, fiches) : enveloppe JSON {v, iter, salt, iv, ct} en base64.
- Enregistrements audio envoyés par l'appli : binaire  b"MEC1" + sel(16) + iv(12) + chiffré.
"""

import base64
import json
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITERATIONS = 250_000
MAGIC = b"MEC1"


def _key(password: str, salt: bytes, iterations: int = ITERATIONS) -> bytes:
    return PBKDF2HMAC(hashes.SHA256(), 32, salt, iterations).derive(password.encode("utf-8"))


def encrypt_json(obj, password: str) -> str:
    salt, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(_key(password, salt)).encrypt(iv, json.dumps(obj, ensure_ascii=False).encode("utf-8"), None)
    b64 = lambda b: base64.b64encode(b).decode()
    return json.dumps({"v": 1, "iter": ITERATIONS, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)})


def decrypt_json(text: str, password: str):
    blob = json.loads(text)
    d = lambda k: base64.b64decode(blob[k])
    plain = AESGCM(_key(password, d("salt"), blob.get("iter", ITERATIONS))).decrypt(d("iv"), d("ct"), None)
    return json.loads(plain.decode("utf-8"))


def decrypt_upload(raw: bytes, password: str):
    """Fichier envoyé par l'appli -> (métadonnées, octets audio ou b'')."""
    if raw[:4] != MAGIC:
        raise ValueError("format de fichier inconnu")
    salt, iv, ct = raw[4:20], raw[20:32], raw[32:]
    plain = AESGCM(_key(password, salt)).decrypt(iv, ct, None)
    head, _, audio = plain.partition(b"\n")
    return json.loads(head.decode("utf-8")), audio


def encrypt_upload(meta: dict, audio: bytes, password: str) -> bytes:
    """Utilisé pour les tests (l'appli fait la même chose en JavaScript)."""
    salt, iv = os.urandom(16), os.urandom(12)
    plain = json.dumps(meta, ensure_ascii=False).encode("utf-8") + b"\n" + audio
    return MAGIC + salt + iv + AESGCM(_key(password, salt)).encrypt(iv, plain, None)
