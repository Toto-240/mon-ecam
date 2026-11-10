import os, requests
U, P = os.environ.get("GL_USER", ""), os.environ.get("GL_PASS", "")
print("login ressemble à un e-mail:", "@" in U, "| longueurs:", len(U), len(P), "| espaces en bord:", U != U.strip(), P != P.strip())
for u in ["https://download.data.grandlyon.com/files/rdata/tcl_sytral.tcltheorique/GTFS_TCL.ZIP",
          "https://data.grandlyon.com/fr/datapusher/ws/rdata/tcl_sytral.tclpassagearret/all.json?maxfeatures=2&start=1",
          "https://data.grandlyon.com/fr/datapusher/ws/rdata/tcl_sytral.tcllignebus_2_0_0/all.json?maxfeatures=1&start=1"]:
    r = requests.get(u, auth=(U.strip(), P.strip()), timeout=120, stream=True, allow_redirects=False)
    print("\n", u, "->", r.status_code, {k: v for k, v in r.headers.items() if k.lower() in ("www-authenticate", "location", "content-type", "content-length")})
    if r.status_code != 200 or "json" in r.headers.get("content-type", ""):
        print(r.raw.read(400))
