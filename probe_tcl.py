import base64, csv, io, json, os, urllib.request, zipfile
print("secrets présents:", bool(os.environ.get("GL_USER")), bool(os.environ.get("GL_PASS")))
auth = "Basic " + base64.b64encode(f"{os.environ.get('GL_USER','')}:{os.environ.get('GL_PASS','')}".encode()).decode()
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "mon-ecam", "Authorization": auth}), timeout=180).read()
z = None
try:
    d = get("https://download.data.grandlyon.com/files/rdata/tcl_sytral.tcltheorique/GTFS_TCL.ZIP"); print("GTFS OK", len(d)); z = zipfile.ZipFile(io.BytesIO(d))
except Exception as e:
    print("GTFS KO", e)
ids = []
if z:
    print(z.namelist())
    rd = lambda n: list(csv.DictReader(io.TextIOWrapper(z.open(n), "utf-8-sig")))
    print([(r["route_id"], r["route_short_name"], r.get("route_long_name","")[:50]) for r in rd("routes.txt") if r["route_short_name"] in ("C21","C22","C24","114","D","F1","F2")])
    for s in rd("stops.txt"):
        if any(k in s["stop_name"].lower() for k in ("aquavert", "gorge de loup", "vieux lyon", "fourvi")):
            print(s["stop_id"], "|", s["stop_name"], "|", s.get("location_type"), s.get("parent_station"), s.get("stop_code"))
            ids.append(s["stop_id"])
    for n in ("calendar.txt", "calendar_dates.txt", "feed_info.txt"):
        if n in z.namelist(): r = rd(n); print(n, len(r), r[:2])
    t = rd("trips.txt"); print("trips", len(t), t[0])
    print("stop_times sample", next(csv.DictReader(io.TextIOWrapper(z.open("stop_times.txt"), "utf-8-sig"))))
for u in ["https://data.grandlyon.com/fr/datapusher/ws/rdata/tcl_sytral.tclpassagearret/all.json?maxfeatures=3&start=1",
          "https://download.data.grandlyon.com/ws/rdata/tcl_sytral.tclpassagearret/all.json?maxfeatures=3&start=1"]:
    try:
        j = json.loads(get(u)); print("TR OK", u, list(j.keys())); print(json.dumps(j.get("values", j)[:3] if isinstance(j.get("values"), list) else j, ensure_ascii=False)[:1200])
    except Exception as e:
        print("TR KO", u, e)
