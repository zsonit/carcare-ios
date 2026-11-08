# -*- coding: utf-8 -*-
"""通过 GitHub Git Data API 提交/推送（本机 git 通道走代理会 502，用 API 绕开）

用法：
  GH_TOKEN=xxx python tools/api_push.py zsonit/carcare-ios "提交说明" [文件1 文件2 ...]
不给文件列表时，自动提交仓库内 git ls-files 的全部文件（含新增）。
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

TOKEN = os.environ["GH_TOKEN"]
REPO = sys.argv[1]
MSG = sys.argv[2] if len(sys.argv) > 2 else "update"
EXPLICIT = sys.argv[3:]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRANCH = "main"


def api(method, path, payload=None):
    url = "https://api.github.com" + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("Content-Type", "application/json")
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                body = r.read().decode()
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            last = e
            if e.code >= 500 and attempt < 3:
                time.sleep(3)
                continue
            detail = e.read().decode()[:400]
            raise RuntimeError(f"HTTP {e.code} {method} {path}: {detail}")
    raise last


def tracked_files():
    if EXPLICIT:
        return EXPLICIT
    out = subprocess.check_output(["git", "ls-files"], cwd=ROOT).decode("utf-8")
    files = [line for line in out.splitlines() if line.strip()]
    # 未跟踪但存在的新文件也一并提交
    out2 = subprocess.check_output(["git", "ls-files", "--others", "--exclude-standard"], cwd=ROOT).decode("utf-8")
    for line in out2.splitlines():
        if line.strip() and line not in files:
            files.append(line)
    return files


def main():
    files = tracked_files()
    try:
        head = api("GET", f"/repos/{REPO}/git/ref/heads/{BRANCH}")
        parent = head["object"]["sha"]
        base_tree = api("GET", f"/repos/{REPO}/git/commits/{parent}")["tree"]["sha"]
        print("parent:", parent[:8], "files:", len(files))
    except RuntimeError:
        parent = None
        base_tree = None
        print("empty repo, creating root commit. files:", len(files))

    entries = []
    for rel in files:
        # 以 del: 开头的参数表示删除该路径
        if rel.startswith("del:"):
            entries.append({"path": rel[4:], "mode": "100644", "type": "blob", "sha": None})
            print("delete:", rel[4:])
            continue
        path = os.path.join(ROOT, rel.replace("/", os.sep))
        if not os.path.isfile(path):
            print("skip missing:", rel)
            continue
        raw = open(path, "rb").read()
        blob = api("POST", f"/repos/{REPO}/git/blobs",
                   {"content": base64.b64encode(raw).decode(), "encoding": "base64"})
        entries.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        print("blob:", rel, len(raw))

    tree_payload = {"tree": entries}
    if base_tree:
        tree_payload["base_tree"] = base_tree
    tree = api("POST", f"/repos/{REPO}/git/trees", tree_payload)

    commit_payload = {"message": MSG, "tree": tree["sha"]}
    if parent:
        commit_payload["parents"] = [parent]
    commit = api("POST", f"/repos/{REPO}/git/commits", commit_payload)

    if parent:
        api("PATCH", f"/repos/{REPO}/git/refs/heads/{BRANCH}", {"sha": commit["sha"], "force": False})
    else:
        api("POST", f"/repos/{REPO}/git/refs", {"ref": f"refs/heads/{BRANCH}", "sha": commit["sha"]})
    print("commit:", commit["sha"])
    print("https://github.com/" + REPO)


if __name__ == "__main__":
    main()
