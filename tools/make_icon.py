# -*- coding: utf-8 -*-
"""生成液态玻璃风格 App 图标（1024x1024）：SVG -> headless Chrome 光栅化

v3「黑曜石 · 银辉 · 琥珀」：
  - 底色改深邃黑曜石蓝，极光光斑更克制，叠加细噪点防色带
  - 玻璃盾重做成利落的现代徽章形，香槟金 rim 受光 + 镜面高光带
  - 删掉金色油滴，改为极简银白车侧影 + 盾底一道琥珀金光弧
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
    # 现代徽章形：顶部平缓圆肩，两肩利落，底部收成圆弧尖
    return ("M 512 176 C 622 176 704 197 750 238 C 788 272 802 318 802 380 "
            "L 802 540 C 802 650 694 736 512 792 C 330 736 222 650 222 540 "
            "L 222 380 C 222 318 236 272 274 238 C 320 197 402 176 512 176 Z")


# 车身侧影（右向朝前的溜背轿跑），局部坐标 0..436 x 0..170（轮拱底 y=140）
CAR = """
M 26 140
L 26 118
C 26 106 33 100 47 98
L 76 95
C 102 92 122 88 142 82
C 174 48 212 34 254 34
C 286 36 310 44 332 62
C 350 76 374 88 398 94
C 424 98 434 106 436 118
L 436 140
L 380 140
A 34 34 0 0 0 312 140
L 152 140
A 34 34 0 0 0 84 140
Z
"""


def build_svg():
    sh = shield_path()
    car = " ".join(CAR.split())
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
  <linearGradient id="bg" x1="0.06" y1="0" x2="0.88" y2="1">
    <stop offset="0" stop-color="#030A16"/>
    <stop offset="0.5" stop-color="#081B33"/>
    <stop offset="1" stop-color="#0F355E"/>
  </linearGradient>
  <radialGradient id="glow1" cx="0.08" cy="0.92" r="0.55">
    <stop offset="0" stop-color="#2BD9C7" stop-opacity="0.38"/>
    <stop offset="1" stop-color="#2BD9C7" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="glow2" cx="0.95" cy="0.05" r="0.5">
    <stop offset="0" stop-color="#7B5CFF" stop-opacity="0.30"/>
    <stop offset="1" stop-color="#7B5CFF" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="glow3" cx="0.88" cy="0.95" r="0.4">
    <stop offset="0" stop-color="#E8A23C" stop-opacity="0.20"/>
    <stop offset="1" stop-color="#E8A23C" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="glass" x1="0.16" y1="0" x2="0.74" y2="1">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.40"/>
    <stop offset="0.42" stop-color="#D8E9FF" stop-opacity="0.16"/>
    <stop offset="1" stop-color="#A6C6F2" stop-opacity="0.07"/>
  </linearGradient>
  <linearGradient id="rim" x1="0.12" y1="0" x2="0.5" y2="1">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.95"/>
    <stop offset="0.45" stop-color="#DDEBFA" stop-opacity="0.34"/>
    <stop offset="1" stop-color="#F2E4C4" stop-opacity="0.85"/>
  </linearGradient>
  <linearGradient id="rimGold" x1="0.7" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FFE9B0" stop-opacity="0.9"/>
    <stop offset="0.55" stop-color="#EFB45C" stop-opacity="0.5"/>
    <stop offset="1" stop-color="#C98A2E" stop-opacity="0.85"/>
  </linearGradient>
  <linearGradient id="streak" x1="0" y1="0" x2="1" y2="0.3">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/>
    <stop offset="0.3" stop-color="#FFFFFF" stop-opacity="0.5"/>
    <stop offset="0.6" stop-color="#FFFFFF" stop-opacity="0.16"/>
    <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="silver" x1="0.2" y1="0" x2="0.62" y2="1">
    <stop offset="0" stop-color="#FFFFFF"/>
    <stop offset="0.5" stop-color="#EEF5FD"/>
    <stop offset="1" stop-color="#BDD2EA"/>
  </linearGradient>
  <linearGradient id="goldArc" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#C98A2E" stop-opacity="0.25"/>
    <stop offset="0.28" stop-color="#FFD98A"/>
    <stop offset="0.55" stop-color="#F0A32C"/>
    <stop offset="0.85" stop-color="#FFD98A"/>
    <stop offset="1" stop-color="#C98A2E" stop-opacity="0.25"/>
  </linearGradient>

  <filter id="blur46" x="-45%" y="-45%" width="190%" height="190%">
    <feGaussianBlur stdDeviation="46"/>
  </filter>
  <filter id="blur20" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="20"/>
  </filter>
  <filter id="blur12" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="12"/>
  </filter>
  <filter id="blur7" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="7"/>
  </filter>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0"/>
    <feComposite operator="in" in2="SourceGraphic"/>
  </filter>
  <filter id="carShadow" x="-25%" y="-25%" width="150%" height="160%">
    <feDropShadow dx="0" dy="8" stdDeviation="9" flood-color="#02101F" flood-opacity="0.42"/>
  </filter>

  <clipPath id="clipShield"><path d="{sh}"/></clipPath>
  <mask id="grainMask"><rect width="1024" height="1024" fill="#fff" filter="url(#grain)"/></mask>
</defs>

<!-- 背景 -->
<rect width="1024" height="1024" fill="url(#bg)"/>
<rect width="1024" height="1024" fill="url(#glow1)"/>
<rect width="1024" height="1024" fill="url(#glow2)"/>
<rect width="1024" height="1024" fill="url(#glow3)"/>
<rect width="1024" height="1024" fill="#8FA9C9" opacity="0.045" mask="url(#grainMask)"/>

<!-- 玻璃盾牌 -->
<ellipse cx="512" cy="848" rx="242" ry="86" fill="#010913" opacity="0.45" filter="url(#blur46)"/>
<path d="{sh}" fill="url(#glass)"/>
<g clip-path="url(#clipShield)">
  <ellipse cx="398" cy="302" rx="300" ry="192" fill="#9FD9FF" opacity="0.36" filter="url(#blur46)"/>
  <ellipse cx="705" cy="655" rx="205" ry="195" fill="#3FE0CB" opacity="0.14" filter="url(#blur46)"/>
  <ellipse cx="512" cy="830" rx="270" ry="120" fill="#04101F" opacity="0.34" filter="url(#blur46)"/>
  <g transform="rotate(-20 512 430)">
    <rect x="-160" y="196" width="1400" height="104" fill="url(#streak)" filter="url(#blur7)"/>
    <rect x="-160" y="336" width="1400" height="14" fill="#FFFFFF" opacity="0.13" filter="url(#blur7)"/>
  </g>
  <path d="{sh}" fill="none" stroke="#06213D" stroke-opacity="0.30" stroke-width="26" filter="url(#blur12)"/>
</g>
<path d="{sh}" fill="none" stroke="url(#rim)" stroke-width="5"/>
<path d="{sh}" fill="none" stroke="url(#rimGold)" stroke-width="3" opacity="0.85"/>
<path d="{sh}" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="1.4"
      transform="translate(4 3) scale(0.992)" transform-origin="512 484"/>

<!-- 车身（极简侧影，金属银白） -->
<ellipse cx="512" cy="598" rx="240" ry="22" fill="#04101F" opacity="0.42" filter="url(#blur12)"/>
<g transform="translate(263 403) scale(1.08)">
  <path d="{car}" fill="url(#silver)" filter="url(#carShadow)"/>
  <circle cx="118" cy="140" r="30" fill="#0B1A2C"/>
  <circle cx="346" cy="140" r="30" fill="#0B1A2C"/>
  <circle cx="118" cy="140" r="11" fill="#DCE9F8" opacity="0.9"/>
  <circle cx="346" cy="140" r="11" fill="#DCE9F8" opacity="0.9"/>
  <path d="M 96 104 C 200 96 330 92 420 100" fill="none" stroke="#FFFFFF"
        stroke-opacity="0.3" stroke-width="3" stroke-linecap="round"/>
</g>

<!-- 琥珀金光弧（托底） -->
<path d="M 302 660 Q 512 588 722 660" fill="none" stroke="url(#goldArc)" stroke-width="22"
      stroke-linecap="round" opacity="0.28" filter="url(#blur12)"/>
<path d="M 302 660 Q 512 588 722 660" fill="none" stroke="url(#goldArc)" stroke-width="9"
      stroke-linecap="round"/>
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
