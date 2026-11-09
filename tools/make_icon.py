# -*- coding: utf-8 -*-
"""生成液态玻璃风格 App 图标（1024x1024）：SVG -> headless Chrome 光栅化

v4「盾 · 光」极简徽章：
  - 不放整车剪影。盾内只留三笔：引擎盖拱线 + 一对大灯线 + 一枚车标点
  - 底色改为哑光黑曜石（近黑径向渐变），光斑极克制，全靠留白与材质对比
  - 盾徽重做为经典徽章比例：顶部圆肩、两侧利落内收、底部圆弧尖
  - 配色只用三色：黑曜石 / 银白 / 香槟金
"""
import base64
import io
import os
import subprocess

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
ASSETS = os.path.join(ROOT, "CarCare", "Assets.xcassets", "AppIcon.appiconset")

# AppIcon.appiconset 里的全部文件与尺寸（缺的补，有的覆盖）
SIZES = {
    "icon-20-ipad.png": 20, "icon-29.png": 29, "icon-29-ipad.png": 29,
    "icon-40.png": 40, "icon-40-ipad.png": 40, "icon-58.png": 58,
    "icon-58-ipad.png": 58, "icon-60.png": 60, "icon-76.png": 76,
    "icon-76-ipad.png": 76, "icon-80.png": 80, "icon-80-ipad.png": 80,
    "icon-87.png": 87, "icon-120.png": 120, "icon-152-ipad.png": 152,
    "icon-167-ipad.png": 167, "icon-180.png": 180, "icon-1024.png": 1024,
}


def shield_path():
    # 经典徽章：顶部平缓圆肩，两侧利落内收，底部短圆弧尖（比例更宽扁稳重）
    return ("M 512 176 C 602 176 670 192 708 224 C 736 248 750 284 750 330 "
            "L 750 498 C 750 606 650 692 512 750 C 374 692 274 606 274 498 "
            "L 274 330 C 274 284 288 248 316 224 C 354 192 422 176 512 176 Z")


# 符号「前路 · 灯」：细长透视道路 + 车道线 + 顶部灯点（寓意照亮前路）
ROAD = "M 503 384 L 521 384 L 600 646 L 424 646 Z"
LANE1 = "M 488 460 L 536 460"
LANE2 = "M 478 520 L 546 520"


def build_svg():
    sh = shield_path()
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
  <!-- 哑光黑曜石底：近黑，中心略透深蓝 -->
  <radialGradient id="bg" cx="0.5" cy="0.42" r="0.78">
    <stop offset="0" stop-color="#0B1521"/>
    <stop offset="0.55" stop-color="#060C15"/>
    <stop offset="1" stop-color="#03060B"/>
  </radialGradient>
  <radialGradient id="ambientCool" cx="0.18" cy="0.12" r="0.5">
    <stop offset="0" stop-color="#7E9CC8" stop-opacity="0.14"/>
    <stop offset="1" stop-color="#7E9CC8" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="ambientWarm" cx="0.86" cy="0.9" r="0.46">
    <stop offset="0" stop-color="#C08A3E" stop-opacity="0.10"/>
    <stop offset="1" stop-color="#C08A3E" stop-opacity="0"/>
  </radialGradient>

  <!-- 玻璃：烟熏暗玻璃，顶部一层柔光 -->
  <linearGradient id="glass" x1="0.2" y1="0" x2="0.72" y2="1">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.16"/>
    <stop offset="0.4" stop-color="#BFD4EC" stop-opacity="0.06"/>
    <stop offset="1" stop-color="#7E9BBF" stop-opacity="0.035"/>
  </linearGradient>
  <linearGradient id="rim" x1="0.1" y1="0" x2="0.55" y2="1">
    <stop offset="0" stop-color="#FFF3D8" stop-opacity="0.96"/>
    <stop offset="0.34" stop-color="#E4C48C" stop-opacity="0.62"/>
    <stop offset="0.62" stop-color="#9C7B45" stop-opacity="0.42"/>
    <stop offset="1" stop-color="#F0D6A6" stop-opacity="0.8"/>
  </linearGradient>

  <!-- 车头线条：银白 -> 香槟金 -->
  <linearGradient id="stroke" x1="0.14" y1="0" x2="0.86" y2="1">
    <stop offset="0" stop-color="#FFFFFF"/>
    <stop offset="0.42" stop-color="#EAF2FB"/>
    <stop offset="0.72" stop-color="#F3DFB6"/>
    <stop offset="1" stop-color="#C79A55"/>
  </linearGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0.34">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/>
    <stop offset="0.34" stop-color="#FFFFFF" stop-opacity="0.30"/>
    <stop offset="0.62" stop-color="#FFFFFF" stop-opacity="0.07"/>
    <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
  </linearGradient>

  <filter id="blur50" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="50"/>
  </filter>
  <filter id="blur16" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="16"/>
  </filter>
  <filter id="blur6" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="6"/>
  </filter>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0"/>
    <feComposite operator="in" in2="SourceGraphic"/>
  </filter>
  <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="5" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>

  <clipPath id="clipShield"><path d="{sh}"/></clipPath>
  <mask id="grainMask"><rect width="1024" height="1024" fill="#fff" filter="url(#grain)"/></mask>
</defs>

<!-- 背景 -->
<rect width="1024" height="1024" fill="url(#bg)"/>
<rect width="1024" height="1024" fill="url(#ambientCool)"/>
<rect width="1024" height="1024" fill="url(#ambientWarm)"/>
<rect width="1024" height="1024" fill="#9DB2CC" opacity="0.035" mask="url(#grainMask)"/>

<!-- 盾徽投影 -->
<ellipse cx="512" cy="802" rx="222" ry="66" fill="#01050B" opacity="0.6" filter="url(#blur50)"/>

<!-- 玻璃盾体 -->
<path d="{sh}" fill="url(#glass)"/>
<g clip-path="url(#clipShield)">
  <ellipse cx="424" cy="282" rx="278" ry="160" fill="#A9CCF2" opacity="0.20" filter="url(#blur50)"/>
  <ellipse cx="512" cy="790" rx="246" ry="100" fill="#02070E" opacity="0.5" filter="url(#blur50)"/>
  <ellipse cx="672" cy="648" rx="172" ry="142" fill="#C08A3E" opacity="0.10" filter="url(#blur50)"/>
  <g transform="rotate(-19 512 430)">
    <rect x="-200" y="216" width="1440" height="82" fill="url(#sheen)" filter="url(#blur6)"/>
  </g>
</g>

<!-- 盾边：香槟金细描边 + 顶部受光 -->
<path d="{sh}" fill="none" stroke="url(#rim)" stroke-width="4.5"/>
<path d="M 356 220 C 406 194 464 186 512 186" fill="none"
      stroke="#FFFFFF" stroke-opacity="0.72" stroke-width="3" stroke-linecap="round"/>
<path d="M 278 470 C 278 292 312 244 388 212" fill="none"
      stroke="#FFFFFF" stroke-opacity="0.14" stroke-width="1.6"/>

<!-- 符号「前路 · 灯」：道路指向顶部灯点 -->
<linearGradient id="road" x1="0.5" y1="0" x2="0.5" y2="1">
  <stop offset="0" stop-color="#F6E3BC" stop-opacity="0.92"/>
  <stop offset="0.3" stop-color="#E7EEF8" stop-opacity="0.38"/>
  <stop offset="1" stop-color="#BDD2EA" stop-opacity="0.10"/>
</linearGradient>
<g filter="url(#softGlow)">
  <path d="{ROAD}" fill="url(#road)"/>
</g>
<path d="{LANE1}" stroke="#FFFFFF" stroke-opacity="0.40" stroke-width="4" stroke-linecap="round"/>
<path d="{LANE2}" stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="3.6" stroke-linecap="round"/>
<circle cx="512" cy="364" r="11" fill="#F6E3BC" opacity="0.97"/>
<circle cx="512" cy="364" r="25" fill="#F0C97E" opacity="0.24" filter="url(#blur6)"/>
</svg>"""


def render_1024(svg):
    html = ("<!DOCTYPE html><html><head><meta charset='utf-8'>"
            "<style>html,body{margin:0;padding:0;width:1024px;height:1024px;overflow:hidden;background:#000}"
            "svg{display:block}</style></head><body>" + svg + "</body></html>")
    html_path = os.path.join(ROOT, "tools", "_icon.html")
    io.open(html_path, "w", encoding="utf-8").write(html)

    png = os.path.join(ROOT, "tools", "icon_new.png")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--force-device-scale-factor=1", "--window-size=1024,1024",
                    "--screenshot=" + png, "file:///" + html_path.replace("\\", "/")],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not os.path.exists(png):
        raise SystemExit("render failed")
    return png


def export_assets(master):
    img = Image.open(master).convert("RGB")
    for name, size in SIZES.items():
        out = os.path.join(ASSETS, name)
        if size == 1024:
            img.save(out)
        else:
            img.resize((size, size), Image.LANCZOS).save(out)
        print("asset:", name)


def main():
    svg = build_svg()
    io.open(os.path.join(ROOT, "tools", "icon.svg"), "w", encoding="utf-8").write(svg)
    master = render_1024(svg)
    export_assets(master)
    print("png:", master, os.path.getsize(master))


if __name__ == "__main__":
    main()
