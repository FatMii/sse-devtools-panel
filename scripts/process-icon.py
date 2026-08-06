from PIL import Image
from pathlib import Path

icons_dir = Path(r"D:/workspace/github/eventstream-panel/assets/icons")
sources = [
    p
    for p in icons_dir.glob("*.png")
    if not p.name.startswith("icon-") and not p.name.startswith("sse-devtools-icon-")
]
if not sources:
    raise SystemExit("No source icon found")
source = sources[0]

im = Image.open(source).convert("RGBA")
w, h = im.size

trim_bottom = 40 if h >= 512 else 0
im = im.crop((0, 0, w, h - trim_bottom))
w, h = im.size

side = min(w, h)
left = (w - side) // 2
top = (h - side) // 2
im = im.crop((left, top, left + side, top + side))

master = im.resize((512, 512), Image.Resampling.LANCZOS)
master_path = icons_dir / "sse-devtools-icon-512.png"
master.save(master_path, format="PNG", optimize=True)

for size in (16, 32, 48, 128):
    out = icons_dir / f"icon-{size}.png"
    resized = master.resize((size, size), Image.Resampling.LANCZOS)
    resized.save(out, format="PNG", optimize=True)

for extra in list(icons_dir.glob("c__Users_FFA_*")) + list(icons_dir.glob("_*.png")):
    extra.unlink()

print(f"processed {source.name}")
