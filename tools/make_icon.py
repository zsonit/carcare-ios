# -*- coding: utf-8 -*-
"""生成液态玻璃风格 App 图标（1024x1024）：SVG -> headless Chrome 光栅化"""
import base64
import io
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"


def car_data_uri():
    raw = open(os.path.join(ROOT, "tools", "car_front.png"), "rb").read()
    return "data:image/png;base64," + base64.b64encode(raw).decode()


# 车身剪影（右侧朝前），局部坐标 0..420 x 0..172
CAR = """
M 16 122
L 16 100
C 16 90 21 85 30 84
L 80 80
C 86 60 99 47 120 46
L 252 43
C 271 43 284 48 292 58
L 336 84
L 376 90
C 396 94 408 102 410 114
L 410 122
L 362 122
A 34 34 0 0 0 294 122
L 144 122
A 34 34 0 0 0 76 122
Z
"""


def shield_path():
    # 盾牌：宽肩、侧边近直、底部收成圆弧尖
    return ("M 296 214 C 356 200 430 192 512 192 C 594 192 668 200 728 214 "
            "C 772 226 794 252 794 300 L 794 520 C 794 620 700 702 512 766 "
            "C 324 702 230 620 230 520 L 230 300 C 230 252 252 226 296 214 Z")


def build_svg():
    sh = shield_path()
    car_uri = car_data_uri()
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
  <linearGradient id="bg" x1="0.08" y1="0" x2="0.86" y2="1">
    <stop offset="0" stop-color="#06182F"/>
    <stop offset="0.46" stop-color="#0F3A72"/>
    <stop offset="1" stop-color="#1A5FA8"/>
  </linearGradient>
  <radialGradient id="glow1" cx="0.1" cy="0.94" r="0.6">
    <stop offset="0" stop-color="#25E3C4" stop-opacity="0.6"/>
    <stop offset="1" stop-color="#25E3C4" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="glow2" cx="0.94" cy="0.04" r="0.58">
    <stop offset="0" stop-color="#8A63FF" stop-opacity="0.55"/>
    <stop offset="1" stop-color="#8A63FF" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="glow4" cx="0.92" cy="0.9" r="0.46">
    <stop offset="0" stop-color="#FFA92E" stop-opacity="0.34"/>
    <stop offset="1" stop-color="#FFA92E" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="glass" x1="0.18" y1="0" x2="0.72" y2="1">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.44"/>
    <stop offset="0.42" stop-color="#DCEBFF" stop-opacity="0.18"/>
    <stop offset="1" stop-color="#A9C8F5" stop-opacity="0.09"/>
  </linearGradient>
  <linearGradient id="rim" x1="0.1" y1="0" x2="0.4" y2="1">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.95"/>
    <stop offset="0.4" stop-color="#FFFFFF" stop-opacity="0.34"/>
    <stop offset="1" stop-color="#E4F1FF" stop-opacity="0.8"/>
  </linearGradient>
  <linearGradient id="streak" x1="0" y1="0" x2="1" y2="0.3">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/>
    <stop offset="0.3" stop-color="#FFFFFF" stop-opacity="0.42"/>
    <stop offset="0.6" stop-color="#FFFFFF" stop-opacity="0.14"/>
    <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="gold" x1="0.2" y1="0.02" x2="0.8" y2="1">
    <stop offset="0" stop-color="#FFEDB4"/>
    <stop offset="0.3" stop-color="#FFC963"/>
    <stop offset="0.7" stop-color="#F09A22"/>
    <stop offset="1" stop-color="#B3630B"/>
  </linearGradient>
  <linearGradient id="carBody" x1="0.2" y1="0" x2="0.6" y2="1">
    <stop offset="0" stop-color="#FFFFFF"/>
    <stop offset="0.55" stop-color="#F4F9FF"/>
    <stop offset="1" stop-color="#D8E6F8"/>
  </linearGradient>
  <radialGradient id="dropGlow" cx="0.5" cy="0.6" r="0.55">
    <stop offset="0" stop-color="#FFB43C" stop-opacity="0.5"/>
    <stop offset="1" stop-color="#FFB43C" stop-opacity="0"/>
  </radialGradient>

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
  <filter id="carShadow" x="-25%" y="-25%" width="150%" height="160%">
    <feDropShadow dx="0" dy="9" stdDeviation="10" flood-color="#02121F" flood-opacity="0.38"/>
  </filter>

  <linearGradient id="carTint" x1="0.2" y1="0" x2="0.55" y2="1">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/>
    <stop offset="0.55" stop-color="#DCEBFF" stop-opacity="0.35"/>
    <stop offset="1" stop-color="#A9C6EC" stop-opacity="0.85"/>
  </linearGradient>
  <mask id="carMask"><image x="297" y="278" width="430" height="267" href="{car_uri}"/></mask>
  <clipPath id="clipShield"><path d="{sh}"/></clipPath>
</defs>

<!-- 背景 -->
<rect width="1024" height="1024" fill="url(#bg)"/>
<rect width="1024" height="1024" fill="url(#glow1)"/>
<rect width="1024" height="1024" fill="url(#glow2)"/>
<rect width="1024" height="1024" fill="url(#glow4)"/>

<!-- 玻璃盾牌 -->
<path d="{sh}" fill="url(#glass)"/>
<g clip-path="url(#clipShield)">
  <ellipse cx="352" cy="284" rx="286" ry="200" fill="#A6DCFF" opacity="0.44" filter="url(#blur46)"/>
  <ellipse cx="712" cy="690" rx="210" ry="200" fill="#3FE0CB" opacity="0.17" filter="url(#blur46)"/>
  <ellipse cx="512" cy="786" rx="250" ry="86" fill="#FFFFFF" opacity="0.13" filter="url(#blur20)"/>
  <g transform="rotate(-22 512 440)">
    <rect x="-160" y="176" width="1400" height="94" fill="url(#streak)" filter="url(#blur7)"/>
    <rect x="-160" y="312" width="1400" height="20" fill="#FFFFFF" opacity="0.12" filter="url(#blur7)"/>
  </g>
  <path d="{sh}" fill="none" stroke="#0A2A4E" stroke-opacity="0.32" stroke-width="28" filter="url(#blur12)"/>
  <ellipse cx="512" cy="916" rx="250" ry="130" fill="#08223F" opacity="0.32" filter="url(#blur46)"/>
</g>
<path d="{sh}" fill="none" stroke="url(#rim)" stroke-width="5"/>
<path d="{sh}" fill="none" stroke="#FFFFFF" stroke-opacity="0.45" stroke-width="1.3"
      transform="translate(5 4) scale(0.99)" transform-origin="512 500"/>

<!-- 车身（正面剪影） -->
<ellipse cx="512" cy="548" rx="214" ry="20" fill="#061F39" opacity="0.4" filter="url(#blur12)"/>
<image x="297" y="278" width="430" height="267" href="{car_uri}"
       filter="url(#carShadow)"/>
<rect x="297" y="278" width="430" height="267" fill="url(#carTint)" mask="url(#carMask)" opacity="0.75"/>

<!-- 金色油滴 -->
<g>
  <ellipse cx="512" cy="620" rx="104" ry="92" fill="url(#dropGlow)" filter="url(#blur20)"/>
  <path d="M 512 570 C 512 570 568 646 568 682 C 568 716 543 738 512 738
           C 481 738 456 716 456 682 C 456 646 512 570 512 570 Z" fill="url(#gold)"/>
  <path d="M 512 570 C 512 570 568 646 568 682 C 568 716 543 738 512 738
           C 481 738 456 716 456 682 C 456 646 512 570 512 570 Z"
        fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2.6"/>
  <ellipse cx="495" cy="668" rx="12" ry="20" fill="#FFFFFF" opacity="0.72" transform="rotate(-14 495 668)" filter="url(#blur7)"/>
  <ellipse cx="536" cy="712" rx="16" ry="9" fill="#FF9A2E" opacity="0.4" filter="url(#blur12)"/>
</g>
</svg>"""


def main():
    svg = build_svg()
    svg_path = os.path.join(ROOT, "tools", "icon.svg")
    io.open(svg_path, "w", encoding="utf-8").write(svg)

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
    print("png:", png, os.path.getsize(png) if os.path.exists(png) else "FAIL")


if __name__ == "__main__":
    main()
