"""Export the public dashboard as a self-contained read-only TechBuzz reader."""
import argparse
import base64
import json
import re
import subprocess
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit
from urllib.request import urlopen
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

parser = argparse.ArgumentParser()
parser.add_argument("output", type=Path)
parser.add_argument("--base", default="http://127.0.0.1:19282")
parser.add_argument("--public", action="store_true", help="Export short post excerpts for public distribution")
args = parser.parse_args()
engine = Path(__file__).resolve().parents[2]
base = args.base.rstrip("/")


def read(path):
    with urlopen(base + path, timeout=40) as response:
        return response.read()


def page(path):
    return BeautifulSoup(read(path), "html.parser")


def inline_json(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")


def clean(root):
    for node in root.select("script,iframe,link,style,video,source"):
        node.decompose()
    for a in root.select("a[href]"):
        href = a["href"].removeprefix(base)
        if href.startswith("/") and not href.startswith("//"):
            a["href"] = "#" + href
    for img in root.select("img"):
        if img.get("src") == "/logo.svg":
            img["src"] = logo
        else:
            img.decompose()


data = json.loads(read("/api/dashboard"))
keys = ("generatedAt", "threshold", "scores", "ideas", "trends", "reports", "hot", "singleHot",
        "generation", "topics", "activities", "featured", "posts", "sources", "archivedTrends")
data = {k: data[k] for k in keys if k in data}
post_keys = ("id", "nativeArticleId", "handle", "authorName", "url", "publishedAt", "kind",
             "text", "textZh", "quotedTextZh", "quoted", "article", "repostOf", "replyTo",
             "threadRootId", "contextStatus", "excerpt")
data["posts"] = [{k: p[k] for k in post_keys if k in p} for p in data["posts"]]
if args.public:
    def excerpt(text):
        words = str(text or "").split()
        return " ".join(words[:18])[:40] + ("…" if len(str(text or "")) > 40 else "")
    for post in data["posts"]:
        for key in ("text", "textZh", "quotedTextZh", "excerpt"):
            if key in post:
                post[key] = excerpt(post[key])
        for key in ("quoted", "replyTo", "repostOf", "article"):
            if isinstance(post.get(key), dict):
                post[key] = {k: post[key][k] for k in ("id", "handle", "authorName", "url", "publishedAt", "title") if k in post[key]}
    data["generation"] = {kind: {**value, "status": "snapshot", "error": None} for kind, value in data["generation"].items()}

for row in data["activities"] + data["featured"]:
    row.pop("post", None)
source_keys = ("handle","lastSuccess","lastAttempt","status","coverageStart","coverageEnd",
               "postCount","sampleCount","pendingCount","unavailableCount","pageState")
data["sources"] = [{k:s[k] for k in source_keys if k in s} for s in data["sources"]]
logo = "data:image/svg+xml;base64," + base64.b64encode(read("/logo.svg")).decode()
shell = page("/")
css = read(shell.select_one('link[rel="stylesheet"]')["href"]).decode()
target = shell.select_one("main")
target.clear()
app = shell.new_tag("div", id="offline-app")
target.append(app)
for tag in shell.select("head > *, body > script"):
    tag.decompose()
clean(shell.body)
for button in shell.body.select("button"):
    button["disabled"] = ""
    button["title"] = "快照外观固定；完整功能请运行 Docker 版本"
date = datetime.fromisoformat(data["generatedAt"].replace("Z","+00:00")).astimezone(ZoneInfo("Asia/Shanghai"))
note = shell.new_tag("p", attrs={"class":"text-xs text-ink-4 mb-2"})
note.string = "TechBuzz 研究快照 · " + date.strftime("%Y-%m-%d %H:%M 北京时间") + (" · 帖子为节选，研究结果保留；实时采集、生成和对话请运行 Docker 版。" if args.public else "")
app.insert_before(note)
static = {}
paths = ["/about","/more","/agent"] + ["/daily/"+r["date"] for r in data["reports"]]
for path in paths:
    main = page(path).select_one("main")
    clean(main)
    static[path] = main.decode_contents()
if data["reports"]:
    static["/daily"] = static["/daily/"+max(r["date"] for r in data["reports"])]
with TemporaryDirectory() as folder:
    subprocess.run(["node","scripts/offline/build.mjs",folder],cwd=engine,check=True)
    js = (Path(folder)/"viewer.js").read_text()
head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TechBuzz 科技股研究看板</title>'
head += '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'">'
html = "<!doctype html><html lang='zh-CN'><head>"+head+"<style>"+css+"</style></head>"+str(shell.body)
payload = inline_json({"dashboard":data,"pages":static})
markup = '<script type="application/json" id="snapshot">'+payload+'</script><script>'+re.sub(r"</script",r"<\\/script",js,flags=re.I)+'</script>'
args.output.write_text(html.replace("</body>",markup+"</body>")+"</html>",encoding="utf-8")
print(args.output, date.isoformat(), args.output.stat().st_size)
