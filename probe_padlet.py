import requests, json
s = requests.Session(); s.headers["User-Agent"] = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36"
s.headers["Accept"] = "application/json"
sec = s.get("https://padlet.com/api/5/wall_sections?wall_id=201830617", timeout=30); print("sections", sec.status_code)
titles = {int(x["id"]): x["attributes"]["title"] for x in sec.json()["data"]}
print(list(titles.values()))
r = s.get("https://padlet.com/api/10/wishes?wall_hashid=board_wY7WyVlwZRRMn52P&page_start=", timeout=30); print("wishes", r.status_code)
j = r.json(); print("top keys", list(j.keys()), "links", j.get("links"), "meta", j.get("meta"))
d = j["data"]; print("n", len(d))
print("attr keys", sorted(d[0]["attributes"].keys()))
print("wish_content keys", sorted((d[0]["attributes"].get("wish_content") or {}).keys()))
for w in d:
    a = w["attributes"]; wc = a.get("wish_content") or {}
    print("--", titles.get(a.get("wall_section_id")), "|", a.get("subject"), "|", a.get("created_at"), "| body", len(a.get("body") or ""))
    print("   att:", a.get("attachment"), "| wc:", json.dumps({k: v for k, v in wc.items() if k not in ("body","subject")}, ensure_ascii=False)[:500])
