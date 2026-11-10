import csv, io, urllib.request, zipfile
URLS = ["https://download.data.grandlyon.com/files/rdata/tcl_sytral.tcltheorique/GTFS_TCL.ZIP",
        "https://download.data.grandlyon.com/files/grandlyon/localisation/tcl_sytral.tcltheorique/GTFS_TCL.ZIP"]
z = None
for u in URLS:
    try:
        d = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "mon-ecam"}), timeout=120).read()
        print("OK", u, len(d)); z = zipfile.ZipFile(io.BytesIO(d)); break
    except Exception as e:
        print("KO", u, e)
if z:
    print(z.namelist())
    rd = lambda n: list(csv.DictReader(io.TextIOWrapper(z.open(n), "utf-8-sig")))
    routes = rd("routes.txt")
    print([ (r["route_id"], r["route_short_name"], r.get("route_long_name","")[:40]) for r in routes if r["route_short_name"] in ("C21","C22","C24","114","D","F1","F2")])
    stops = rd("stops.txt")
    for s in stops:
        if any(k in s["stop_name"].lower() for k in ("aquavert", "gorge de loup", "vieux lyon", "fourvi")):
            print(s["stop_id"], "|", s["stop_name"], "|", s.get("location_type"), s.get("parent_station"))
    cal = rd("calendar.txt") if "calendar.txt" in z.namelist() else []
    print("calendar", len(cal), cal[:2])
    print("feed_info", rd("feed_info.txt")[:1] if "feed_info.txt" in z.namelist() else None)
