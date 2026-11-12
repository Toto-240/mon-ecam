import csv, io, zipfile, requests
for u in ["https://eu.ftp.opendatasoft.com/sncf/gtfs/export-ter-gtfs-last.zip",
          "https://eu.ftp.opendatasoft.com/sncf/plandata/export-ter-gtfs-last.zip"]:
    try:
        r = requests.get(u, timeout=180); print(u, r.status_code, len(r.content))
        if r.ok and r.content[:2] == b"PK": break
    except Exception as e: print(u, e)
z = zipfile.ZipFile(io.BytesIO(r.content)); print(z.namelist())
rd = lambda n: csv.DictReader(io.TextIOWrapper(z.open(n), "utf-8-sig"))
ids = {}
for s in rd("stops.txt"):
    n = s["stop_name"].lower()
    if "brignais" in n or "gorge de loup" in n or "saint-paul" in n and "lyon" in n:
        print(s["stop_id"], "|", s["stop_name"], "|", s.get("location_type"), s.get("parent_station")); ids[s["stop_id"]] = s["stop_name"]
cal = list(rd("calendar.txt")) if "calendar.txt" in z.namelist() else []
print("calendar", len(cal), cal[:1]); cd = list(rd("calendar_dates.txt")); print("calendar_dates", len(cd), cd[:2])
n = 0
trips = {}
for st in rd("stop_times.txt"):
    if st["stop_id"] in ids:
        trips.setdefault(st["trip_id"], []).append((int(st["stop_sequence"]), ids[st["stop_id"]], st["departure_time"]))
both = {t: v for t, v in trips.items() if len({x[1] for x in v}) >= 2}
print("courses passant par 2 de ces gares:", len(both))
for t, v in list(both.items())[:4]: print(t, sorted(v))
