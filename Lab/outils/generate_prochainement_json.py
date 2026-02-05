import json
from pathlib import Path

# Dossier où tu mets les affiches "prochainement"
LAB_DIR = Path(__file__).resolve().parent.parent
FOLDER = LAB_DIR / "prochainement"
# Fichier JSON à générer
OUTPUT = LAB_DIR / "prochainement.json"

# Extensions d’images acceptées (tu peux en enlever/ajouter)
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

def main():
    if not FOLDER.is_dir():
        raise SystemExit(f"Dossier introuvable : {str(FOLDER)!r}")

    files = []
    for name in (p.name for p in FOLDER.iterdir() if p.is_file()):
        base, ext = Path(name).stem, Path(name).suffix
        if ext.lower() in EXTS:
            files.append(name)

    # tri pour avoir toujours le même ordre (par nom de fichier)
    files.sort()

    data = [{"poster": f"prochainement/{name}"} for name in files]

    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Généré {OUTPUT} avec {len(data)} image(s).")

if __name__ == "__main__":
    main()
