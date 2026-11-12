import csv, io, zipfile, requests, collections
r = requests.get("https://eu.ftp.opendatasoft.com/sncf/gtfs/export-ter-gtfs-last.zip", timeout=180)
z = zipfile.ZipFile(io.BytesIO(r.content))
rd = lambda n: csv.DictReader(io.TextIOWrapper(z.open(n), "utf-8-sig"))
print(list(rd("feed_info.txt")))
dates = [c["date"] for c in rd("calendar_dates.txt")]; print("dates", min(dates), max(dates), len(dates))
names = {s["stop_id"]: s["stop_name"] for s in rd("stops.txt")}
trips = collections.defaultdict(list)
for st in rd("stop_times.txt"):
    trips[st["trip_id"]].append((int(st["stop_sequence"]), names.get(st["stop_id"], "?"), st["departure_time"]))
b = [t for t, v in trips.items() if any("Brignais" in x[1] for x in v)]
print("courses passant à Brignais:", len(b))
for t in b[:3]: print(t, [(x[1], x[2]) for x in sorted(trips[t])])
