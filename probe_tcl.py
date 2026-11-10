import csv, io, json, os, requests, zipfile
A = (os.environ["GL_USER"].strip(), os.environ["GL_PASS"].strip())
r = requests.get("https://data.grandlyon.com/fr/datapusher/ws/rdata/tcl_sytral.tclpassagearret/all.json?maxfeatures=2&start=1", auth=A, timeout=60)
print("TR", r.status_code, r.text[:900])
r = requests.get("https://download.data.grandlyon.com/files/rdata/tcl_sytral.tcltheorique/GTFS_TCL.ZIP", auth=A, timeout=300)
print("GTFS", r.status_code, len(r.content))
if r.ok:
    z = zipfile.ZipFile(io.BytesIO(r.content)); print(z.namelist())
    rd = lambda n: list(csv.DictReader(io.TextIOWrapper(z.open(n), "utf-8-sig")))
    print([(x["route_id"], x["route_short_name"], x.get("route_long_name","")[:50]) for x in rd("routes.txt") if x["route_short_name"] in ("C21","C22","C24","114","D","F1","F2")])
    for s in rd("stops.txt"):
        if any(k in s["stop_name"].lower() for k in ("aquavert", "gorge de loup", "vieux lyon", "fourvi")):
            print(s["stop_id"], "|", s["stop_name"], "|", s.get("location_type"), s.get("parent_station"))
    for n in ("calendar.txt", "calendar_dates.txt", "feed_info.txt"):
        if n in z.namelist(): x = rd(n); print(n, len(x), x[:2])
    t = rd("trips.txt"); print("trips", len(t), t[0])
    print("stop_times", next(csv.DictReader(io.TextIOWrapper(z.open("stop_times.txt"), "utf-8-sig"))))
