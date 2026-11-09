import requests, re, json
U = "https://padlet.com/ludovicrenzi1/techniques-de-communication-et-culture-generale-semestre-1-l-5xmj7pnnapr3vi7o"
H = "5xmj7pnnapr3vi7o"
s = requests.Session(); s.headers["User-Agent"] = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/124 Safari/537.36"
r = s.get(U); print("page", r.status_code, len(r.text))
t = r.text
print("api refs:", sorted(set(re.findall(r'/api/\d+/[a-z_/]+', t)))[:40])
for k in ["wall_id", "wallId", "\"id\":", "hashid", "rss", "feed"]:
    for m in list(re.finditer(re.escape(k), t))[:3]:
        print(k, "=>", t[max(0,m.start()-80):m.start()+120].replace("\n"," "))
ids = re.findall(r'"wall"\s*:\s*\{\s*"id"\s*:\s*(\d+)', t) + re.findall(r'wall_id["\s:=]+(\d+)', t)
print("ids", ids[:5])
cands = [f"https://padlet.com/api/5/wishes?wall_hashid={H}", f"https://padlet.com/api/10/wishes?wall_hashid={H}",
         f"https://padlet.com/api/5/walls/{H}", f"https://padlet.com/padlets/{H}/exports/feed.xml",
         f"https://padlet.com/api/9/wall_sections?wall_hashid={H}", f"https://padlet.com/api/5/wall_sections?wall_hashid={H}"]
for i in ids[:1]:
    cands += [f"https://padlet.com/api/5/wishes?wall_id={i}", f"https://padlet.com/api/10/wishes?wall_id={i}",
              f"https://padlet.com/api/5/wall_sections?wall_id={i}", f"https://padlet.com/api/9/wall_sections?wall_id={i}",
              f"https://padlet.com/padlets/{i}/exports/feed.xml"]
for c in cands:
    try:
        x = s.get(c, headers={"Accept": "application/json"}); print("\nGET", c, x.status_code, x.headers.get("content-type"), len(x.text)); print(x.text[:700])
    except Exception as e: print(c, e)
