"""Package only runtime files and the Russian installation guide."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
destination = root / "dist" / "twitch-picture-in-picture.zip"
destination.parent.mkdir(exist_ok=True)
files = [root / name for name in ("manifest.json", "app.js", "background.js", "README.md")]
files.extend(sorted((root / "icons").glob("*.png")))
with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
    for file in files:
        archive.write(file, file.relative_to(root))
print(destination)
