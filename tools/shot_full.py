# -*- coding: utf-8 -*-
"""整页长截图（开发调试）：python tools/shot_full.py <screen> [h] [tag]"""
import io, os, shutil, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "Resources", "web", "index.html")
CHROME = r"C:/Program Files/Google/Chrome/Application/chrome.exe"
OUT = os.path.join(ROOT, "tools", "_shots")
os.makedirs(OUT, exist_ok=True)
shutil.copy(os.path.join(ROOT, "Resources", "web", "cc-ext.js"), os.path.join(OUT, "cc-ext.js"))

sc = sys.argv[1] if len(sys.argv) > 1 else "reminders"
h = int(sys.argv[2]) if len(sys.argv) > 2 else 2400
tag = sys.argv[3] if len(sys.argv) > 3 else sc
extra = sys.argv[4] if len(sys.argv) > 4 else ''
if extra.startswith('@'):
    extra = io.open(extra[1:], encoding='utf-8').read()
html = io.open(SRC, encoding="utf-8").read()
inj = """
<style>
html,body{max-width:390px;overflow-x:hidden}
nav{right:auto;width:378px;position:fixed;bottom:8px}
.fab{right:auto;left:314px}
.modal{right:auto;width:390px}
.page{right:auto;width:390px}
.page-head{right:auto;width:390px}
.page-body{max-width:390px}
.screen{animation:none!important}
*{transition:none!important}
</style>
<script>
window.confirm=function(){return true};window.alert=function(){};
setTimeout(function(){try{loadDemo();showScreen('%s');%s}catch(e){document.title='ERR '+e.message;}},500);
</script>""" % (sc, extra)
tmp = os.path.join(OUT, "_full_%s.html" % tag)
io.open(tmp, "w", encoding="utf-8").write(html + inj)
png = os.path.join(OUT, "full_%s.png" % tag)
subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                "--force-device-scale-factor=2", "--window-size=390,%d" % h,
                "--virtual-time-budget=3500", "--screenshot=" + png,
                "file:///" + os.path.abspath(tmp).replace("\\", "/")],
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
print("shot:", png, os.path.getsize(png) if os.path.exists(png) else "FAIL")
