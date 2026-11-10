"""Rattrapage : cherche les annonces de DS dans les fiches de cours récentes (photos, notes, enregistrements).
Une fois par fiche (le résultat est rangé dans ds_detectes/, même s'il est vide)."""
import os
import sys
from datetime import date, timedelta
from pathlib import Path

from crypto_util import decrypt_json
from process_inbox import detect_ds, gemini, save_ds, write

BASE = Path(__file__).parent
JOURS = int(os.environ.get("SCAN_JOURS") or 21)


def main():
    pw = os.environ.get("APP_PASSWORD") or sys.exit("APP_PASSWORD manquant")
    client = gemini()
    depuis = (date.today() - timedelta(JOURS)).isoformat()
    n = 0
    for p in sorted((BASE / "fiches").glob("*.enc")):
        try:
            f = decrypt_json(p.read_text(encoding="utf-8"), pw)
        except Exception:
            continue
        if f.get("kind") != "cours" or f.get("source") not in (None, "notes", "complete") or (f.get("date") or "") < depuis:
            continue
        if (BASE / "ds_detectes" / f"{f['id']}.enc").exists():
            continue
        meta = {"id": f["id"], "matiere": f.get("matiere"), "date": f.get("date")}
        try:
            ds = detect_ds(client, meta, [f"Fiche du cours :\n{f.get('md', '')}"])[1]
        except Exception as e:
            print(f"{f['id']} : échec ({type(e).__name__})")
            continue
        n += 1
        if ds:
            save_ds(meta, ds, BASE)
        else:
            write(BASE / "ds_detectes" / f"{f['id']}.enc", {"id": f["id"], "matiere": f.get("matiere"), "ds": []})
    print(f"::notice::{n} fiche(s) relue(s)")


if __name__ == "__main__":
    main()
