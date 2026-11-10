import base64, os, requests
U, P = os.environ.get("GL_USER", "").strip(), os.environ.get("GL_PASS", "").strip()
print("caractères non-ASCII dans le mdp:", any(ord(c) > 127 for c in P), "| majuscules dans l'e-mail:", U != U.lower(),
      "| guillemets autour:", P[:1] in "\"'" and P[-1:] in "\"'")
u = "https://data.grandlyon.com/fr/datapusher/ws/rdata/tcl_sytral.tclpassagearret/all.json?maxfeatures=1&start=1"
for name, user, pw in [("utf-8", U, P), ("e-mail minuscule", U.lower(), P), ("sans guillemets", U, P.strip("\"'"))]:
    h = "Basic " + base64.b64encode(f"{user}:{pw}".encode("utf-8")).decode()
    r = requests.get(u, headers={"Authorization": h}, timeout=60)
    print(name, "->", r.status_code, r.text[:120])
