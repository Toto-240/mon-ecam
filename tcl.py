"""
Horaires TCL du trajet domicile <-> école (onglet « Trajet » de l'appli).

Télécharge les horaires théoriques officiels (GTFS, data.grandlyon.com, compte gratuit :
secrets GRANDLYON_LOGIN / GRANDLYON_PASSWORD) et garde seulement les tronçons du trajet,
pour les 7 prochains jours :
  aller  : bus C21/C22/C24/114 Aquavert -> Gorge de Loup, métro D -> Vieux Lyon, funiculaire F2 -> Fourvière
  retour : l'inverse.
L'appli enchaîne elle-même les correspondances. Résultat chiffré (le dépôt est public) : tcl.enc,
ajouté à data.enc par build_site.py.
"""

import csv
import io
import os
import sys
import zipfile
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import requests

from crypto_util import encrypt_json

GTFS_URL = "https://download.data.grandlyon.com/files/rdata/tcl_sytral.tcltheorique/GTFS_TCL.ZIP"
OUT = Path(__file__).parent / "tcl.enc"
DAYS = 7

STOPS = {"maison": "S5762", "gdl": "S5040", "vl": "S5095", "fourviere": "S5224"}   # stations (parent_station)
NOMS = {"maison": "Aquavert", "papa": "Brignais", "gdl": "Gorge de Loup", "vl": "Vieux Lyon", "fourviere": "Fourvière"}
BUS = ["C21", "C22", "C24", "114"]
LEGS = {   # nom : (lignes, de, vers)
    "a_bus": (BUS, "maison", "gdl"),
    "a_metro": (["D"], "gdl", "vl"),
    "a_funi": (["F2"], "vl", "fourviere"),
    "r_funi": (["F2"], "fourviere", "vl"),
    "r_metro": (["D"], "vl", "gdl"),
    "r_bus": (BUS, "gdl", "maison"),
}
WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def mins(t):
    h, m, *_ = t.split(":")
    return int(h) * 60 + int(m)


TER_URL = "https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip"   # SNCF, public, à jour
TER_GARES = {"brignais": "brignais", "lyon gorge de loup": "gdl"}


def ter_legs(days):
    """Semaine chez papa : TER (ou car TER) Brignais <-> Lyon Gorge de Loup, puis métro D comme d'habitude."""
    try:
        r = requests.get(TER_URL, timeout=300)
        r.raise_for_status()
        z = zipfile.ZipFile(io.BytesIO(r.content))
    except Exception as e:
        print(f"horaires TER indisponibles ({type(e).__name__})")
        return {}
    rows = lambda n: csv.DictReader(io.TextIOWrapper(z.open(n), "utf-8-sig"))
    noms = {s["stop_id"]: (s["stop_name"], s.get("parent_station") or "") for s in rows("stops.txt")}
    gare = {}
    for sid, (nom, parent) in noms.items():
        k = TER_GARES.get(nom.strip().lower()) or TER_GARES.get(noms.get(parent, ("", ""))[0].strip().lower())
        if k:
            gare[sid] = k
    passages = defaultdict(list)
    for st in rows("stop_times.txt"):
        g = gare.get(st["stop_id"])
        if g:
            passages[st["trip_id"]].append((int(st["stop_sequence"]), g, mins(st["arrival_time"]), mins(st["departure_time"])))
    passages = {t: v for t, v in passages.items() if len({x[1] for x in v}) == 2}
    car = {x["route_id"] for x in rows("routes.txt") if x.get("route_type") == "3"}
    trips = {t["trip_id"]: (t["service_id"], "Car TER" if t["route_id"] in car else "TER") for t in rows("trips.txt") if t["trip_id"] in passages}
    dayset = {d.strftime("%Y%m%d"): d for d in days}
    actifs = defaultdict(set)
    if "calendar.txt" in z.namelist():
        for c in rows("calendar.txt"):
            for ds, d in dayset.items():
                if c["start_date"] <= ds <= c["end_date"] and c[WEEK[d.weekday()]] == "1":
                    actifs[ds].add(c["service_id"])
    for c in rows("calendar_dates.txt"):
        if c["date"] in dayset:
            (actifs[c["date"]].add if c["exception_type"] == "1" else actifs[c["date"]].discard)(c["service_id"])
    out = {}
    for ds in dayset:
        a, r_ = set(), set()
        for trip, ps in passages.items():
            service, kind = trips.get(trip, (None, "TER"))
            if service not in actifs[ds]:
                continue
            ps = sorted(ps)
            for (_, g1, _, dep), (_, g2, arr, _) in zip(ps, ps[1:]):
                if g1 == "brignais" and g2 == "gdl":
                    a.add((dep, arr, kind))
                if g1 == "gdl" and g2 == "brignais":
                    r_.add((dep, arr, kind))
        out[ds] = {"a_ter": sorted(a), "r_ter": sorted(r_)}
    print(f"TER : {len(gare)} arrêts, {len(passages)} courses ;", {k: (len(v["a_ter"]), len(v["r_ter"])) for k, v in sorted(out.items())})
    return out


def main():
    pw = os.environ.get("APP_PASSWORD")
    auth = (os.environ.get("GRANDLYON_LOGIN", "").strip(), os.environ.get("GRANDLYON_PASSWORD", "").strip())
    if not pw or not all(auth):
        sys.exit("APP_PASSWORD ou identifiants Data Grand Lyon manquants")
    r = requests.get(GTFS_URL, auth=auth, timeout=300)
    r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    rows = lambda n: csv.DictReader(io.TextIOWrapper(z.open(n), "utf-8-sig"))

    lignes = {x for v in LEGS.values() for x in v[0]}
    route_name = {x["route_id"]: x["route_short_name"] for x in rows("routes.txt") if x["route_short_name"] in lignes}
    trips = {t["trip_id"]: (route_name[t["route_id"]], t["service_id"]) for t in rows("trips.txt") if t["route_id"] in route_name}
    station = {}
    for s in rows("stops.txt"):
        for k, p in STOPS.items():
            if s["stop_id"] == p or s.get("parent_station") == p:
                station[s["stop_id"]] = k

    # passages aux 4 stations, par course
    passages = defaultdict(list)
    for st in rows("stop_times.txt"):
        k = station.get(st["stop_id"])
        if k and st["trip_id"] in trips:
            passages[st["trip_id"]].append((int(st["stop_sequence"]), k, mins(st["arrival_time"]), mins(st["departure_time"])))

    # jours de circulation
    today = date.today()
    days = [today + timedelta(d) for d in range(DAYS)]
    services = defaultdict(set)
    for c in rows("calendar.txt"):
        a, b = c["start_date"], c["end_date"]
        for d in days:
            ds = d.strftime("%Y%m%d")
            if a <= ds <= b and c[WEEK[d.weekday()]] == "1":
                services[ds].add(c["service_id"])
    dayset = {d.strftime("%Y%m%d") for d in days}
    for c in rows("calendar_dates.txt"):
        if c["date"] in dayset:
            (services[c["date"]].add if c["exception_type"] == "1" else services[c["date"]].discard)(c["service_id"])

    # tronçons de chaque course : [départ, arrivée, ligne] en minutes depuis minuit du jour de service
    legs_by_service = defaultdict(lambda: defaultdict(list))
    for trip, ps in passages.items():
        ligne, service = trips[trip]
        ps.sort()
        for name, (ls, a, b) in LEGS.items():
            if ligne not in ls:
                continue
            ia = next((i for i, p in enumerate(ps) if p[1] == a), None)
            ib = next((i for i, p in enumerate(ps) if p[1] == b and ia is not None and i > ia), None)
            if ia is not None and ib is not None:
                legs_by_service[service][name].append([ps[ia][3], ps[ib][2], ligne])

    ter = ter_legs(days)

    out = {"maj": today.isoformat(), "noms": NOMS, "jours": {}}
    for d in days:
        ds = d.strftime("%Y%m%d")
        jour = {}
        for name in LEGS:
            jour[name] = sorted({tuple(x) for s in services[ds] for x in legs_by_service[s][name]})
        jour.update(ter.get(ds, {"a_ter": [], "r_ter": []}))
        out["jours"][d.isoformat()] = {k: [list(x) for x in v] for k, v in jour.items()}
        print(d, {k: len(v) for k, v in jour.items()})
    OUT.write_text(encrypt_json(out, pw), encoding="utf-8")
    print("tcl.enc écrit")


if __name__ == "__main__":
    main()
