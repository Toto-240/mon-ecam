"""Ajoute le PDF aux devoirs faits qui n'en ont pas encore (LibreOffice requis)."""
import base64
import os
import sys
from pathlib import Path

from crypto_util import decrypt_json, encrypt_json
from devoir import to_pdf

pw = os.environ.get("APP_PASSWORD") or sys.exit("APP_PASSWORD manquant")
done = 0
for p in sorted(Path("devoirs").glob("*.enc")):
    d = decrypt_json(p.read_text(encoding="utf-8"), pw)
    if d.get("pdf") or not d.get("docx"):
        continue
    pdf = to_pdf(base64.b64decode(d["docx"]))
    if pdf:
        d["pdf"] = base64.b64encode(pdf).decode()
        p.write_text(encrypt_json(d, pw), encoding="utf-8")
        done += 1
print(f"::notice::{done} devoir(s) complété(s) avec un PDF")
