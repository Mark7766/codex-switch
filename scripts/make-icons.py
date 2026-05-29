#!/usr/bin/env python3
"""生成 Codex Switch 应用图标。
输出：
  build/icon.png        (1024x1024 主图)
  build/icon.iconset/   (多尺寸 PNG，供 iconutil 转 .icns)
  build/icon.ico        (多尺寸合并 ICO)
.icns 需要随后用 macOS 自带 iconutil 转换。
"""
from __future__ import annotations
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
BUILD.mkdir(exist_ok=True)


def make_master(size: int = 1024) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # macOS 图标规范：背景留约 10% padding，与 Codex/系统图标视觉尺寸一致
    pad = int(size * 0.10)
    bg = (37, 99, 235, 255)  # tailwind blue-600
    r = int(size * 0.20)
    draw.rounded_rectangle([(pad, pad), (size - pad, size - pad)], radius=r, fill=bg)

    # 内圈高光（伪渐变：再叠一个稍亮的圆角矩形居中偏上）
    hl = (96, 165, 250, 60)  # blue-400 alpha
    inset = pad + int(size * 0.04)
    draw.rounded_rectangle(
        [(inset, inset), (size - inset, size - inset)],
        radius=r - int(size * 0.04),
        outline=hl,
        width=max(2, size // 80),
    )

    # 中央 "C/" 字样：白色，粗体（用系统字体）
    text = "C/"
    font = None
    for cand in (
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial Bold.ttf",
    ):
        if os.path.exists(cand):
            try:
                font = ImageFont.truetype(cand, int(size * 0.5))
                break
            except OSError:
                continue
    if font is None:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (size - tw) // 2 - bbox[0]
    ty = (size - th) // 2 - bbox[1] - int(size * 0.03)
    draw.text((tx, ty), text, fill=(255, 255, 255, 255), font=font)

    return img


def main() -> None:
    master = make_master(1024)
    master.save(BUILD / "icon.png", "PNG")
    print(f"wrote {BUILD/'icon.png'}")

    # iconset for iconutil
    iconset = BUILD / "icon.iconset"
    iconset.mkdir(exist_ok=True)
    specs = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]
    for size, name in specs:
        master.resize((size, size), Image.LANCZOS).save(iconset / name, "PNG")
    print(f"wrote {iconset}/*.png (10 files)")

    # .ico (multi-size)
    ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    master.save(BUILD / "icon.ico", format="ICO", sizes=ico_sizes)
    print(f"wrote {BUILD/'icon.ico'}")


if __name__ == "__main__":
    main()
