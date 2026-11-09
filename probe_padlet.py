import json
from playwright.sync_api import sync_playwright
U = "https://padlet.com/ludovicrenzi1/techniques-de-communication-et-culture-generale-semestre-1-l-5xmj7pnnapr3vi7o"
seen = []
with sync_playwright() as p:
    b = p.chromium.launch()
    c = b.new_context(user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", locale="fr-FR")
    pg = c.new_page()
    def on(r):
        if "/api/" in r.url:
            try: body = r.text()
            except Exception: body = ""
            seen.append((r.url, r.status, body))
    pg.on("response", on)
    pg.goto(U, wait_until="networkidle", timeout=90000); pg.wait_for_timeout(5000)
    print("title:", pg.title())
    print("text:", pg.inner_text("body")[:1500])
    b.close()
for u, s, body in seen:
    print("\nAPI", s, u, len(body)); print(body[:1200])
