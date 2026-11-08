# -*- coding: utf-8 -*-
"""本地用 headless Chrome 截取各页面，检查新 UI 效果（仅开发调试用）"""
import io
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "Resources", "web", "index.html")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUT = os.path.join(ROOT, "tools", "_shots")

screens = sys.argv[1].split(",") if len(sys.argv) > 1 else ["reminders"]
extra = sys.argv[2] if len(sys.argv) > 2 else ""
tag = sys.argv[3] if len(sys.argv) > 3 else ""

os.makedirs(OUT, exist_ok=True)
html = io.open(SRC, encoding="utf-8").read()

for sc in screens:
    inject = """
<style id="harnes">
html,body{max-width:390px;overflow-x:hidden}
/* 无头浏览器最小视口 504px，把悬浮元素手动收回 390px 画布内，便于看真实效果 */
nav{right:auto;width:378px}
.fab{right:auto;left:314px}
.modal{right:auto;width:390px}
.modal .sheet{max-width:390px;animation:none!important}
.screen{animation:none!important}
*{transition:none!important}
.toast{left:195px}
</style>
<script>
window.confirm=function(){return true};
window.alert=function(){};
setTimeout(function(){
  try{
    loadDemo();
    showScreen('%s');
    %s
  }catch(e){document.title='ERR '+e.message;}
},500);
</script>""" % (sc, extra)
    tmp = os.path.join(OUT, "_%s.html" % (tag or sc))
    io.open(tmp, "w", encoding="utf-8").write(html + inject)
    png = os.path.join(OUT, "%s.png" % (tag or sc))
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--force-device-scale-factor=2", "--window-size=390,860",
                    "--virtual-time-budget=3500", "--screenshot=" + png,
                    "file:///" + tmp.replace("\\", "/")],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("shot:", png, os.path.getsize(png) if os.path.exists(png) else "FAIL")
