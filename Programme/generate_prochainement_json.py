import os
import json

# Dossier où tu mets les affiches "prochainement"
FOLDER = "prochainement"
# Fichier JSON à générer
OUTPUT = "prochainement.json"

# Extensions d’images acceptées (tu peux en enlever/ajouter)
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

def main():
    if not os.path.isdir(FOLDER):
        raise SystemExit(f"Dossier introuvable : {FOLDER!r}")

    files = []
    for name in os.listdir(FOLDER):
        base, ext = os.path.splitext(name)
        if ext.lower() in EXTS:
            files.append(name)

    # tri pour avoir toujours le même ordre (par nom de fichier)
    files.sort()

    data = [{"poster": f"{FOLDER}/{name}"} for name in files]

    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Généré {OUTPUT} avec {len(data)} image(s).")

if __name__ == "__main__":
    main()
