"""Generate the extension's simple, original PiP icon without dependencies."""
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def color(x, y):
    if (x < 18 or x > 110) and (y < 18 or y > 110):
        cx, cy = (18 if x < 18 else 110), (18 if y < 18 else 110)
        if (x - cx) ** 2 + (y - cy) ** 2 > 18 ** 2:
            return (0, 0, 0, 0)
    if 22 <= x < 106 and 30 <= y < 98 and not (29 <= x < 99 and 37 <= y < 91):
        return (255, 255, 255, 255)
    if 62 <= x < 92 and 61 <= y < 84:
        return (255, 255, 255, 255)
    return (145, 70, 255, 255)


(ROOT / "icons").mkdir(exist_ok=True)
for size in (16, 32, 48, 128):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            samples = [color((x + (sx + .5) / 4) * 128 / size,
                             (y + (sy + .5) / 4) * 128 / size)
                       for sx in range(4) for sy in range(4)]
            rows.extend(round(sum(p[c] for p in samples) / 16) for c in range(4))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
    (ROOT / "icons" / f"{size}.png").write_bytes(png)
