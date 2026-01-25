#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    print("Erreur: PyMuPDF n'est pas installé. Fais: pip install pymupdf", file=sys.stderr)
    raise


NUM_RE = re.compile(r"\b(\d{3})_")  # ex: "Abonnés 349_2025..." -> 349


def pick_latest_pdf(pdf_dir: Path) -> Path:
    if not pdf_dir.exists() or not pdf_dir.is_dir():
        raise FileNotFoundError(f"Dossier PDFs introuvable: {pdf_dir}")

    best_pdf: Path | None = None
    best_num: int = -1

    for p in pdf_dir.glob("*.pdf"):
        m = NUM_RE.search(p.name)
        if not m:
            continue
        n = int(m.group(1))
        if n > best_num:
            best_num = n
            best_pdf = p

    if not best_pdf:
        # aide au debug
        pdfs = list(pdf_dir.glob("*.pdf"))
        if not pdfs:
            raise FileNotFoundError(f"Aucun PDF trouvé dans: {pdf_dir}")
        raise ValueError(
            "Aucun PDF ne correspond au motif avec numéro '###_' (ex: 'Abonnés 349_...pdf'). "
            f"PDFs trouvés: {[x.name for x in pdfs]}"
        )

    return best_pdf


def render_page_to_jpeg(
    pdf_path: Path,
    out_path: Path,
    page_number_human: int = 8,
    target_width_px: int = 1600,
    quality: int = 85,
) -> None:
    if page_number_human < 1:
        raise ValueError("page_number_human doit être >= 1")

    page_index = page_number_human - 1  # 0-index

    with fitz.open(pdf_path) as doc:
        if page_index >= doc.page_count:
            raise ValueError(
                f"Le PDF '{pdf_path.name}' n'a que {doc.page_count} page(s). "
                f"Impossible d'extraire la page {page_number_human}."
            )

        page = doc.load_page(page_index)
        rect = page.rect
        if rect.width <= 0:
            raise ValueError("Largeur de page invalide (rect.width <= 0).")

        zoom = target_width_px / rect.width
        mat = fitz.Matrix(zoom, zoom)

        pix = page.get_pixmap(matrix=mat, alpha=False)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        pix.save(out_path.as_posix(), output="jpeg", jpg_quality=quality)


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    default_pdf_dir = script_dir / "PDFs"
    default_out = default_pdf_dir / "programme_page8.jpg"  # nom fixe => remplace l'ancien

    p = argparse.ArgumentParser(
        description="Exporte la page 8 du dernier PDF (numéro ### le plus élevé) en JPEG dans Programme/PDFs/."
    )
    p.add_argument("--pdf-dir", type=str, default=str(default_pdf_dir),
                   help="Dossier contenant les PDFs (défaut: Programme/PDFs/)")
    p.add_argument("--out", type=str, default=str(default_out),
                   help="Chemin du JPG de sortie (défaut: Programme/PDFs/programme_page8.jpg)")
    p.add_argument("--page", type=int, default=8, help="Numéro de page (1-index, défaut=8)")
    p.add_argument("--width", type=int, default=1600, help="Largeur cible en px (défaut=1600)")
    p.add_argument("--quality", type=int, default=85, help="Qualité JPEG 1-100 (défaut=85)")

    args = p.parse_args()

    pdf_dir = Path(args.pdf_dir)
    out_path = Path(args.out)

    try:
        latest_pdf = pick_latest_pdf(pdf_dir)
        render_page_to_jpeg(
            pdf_path=latest_pdf,
            out_path=out_path,
            page_number_human=args.page,
            target_width_px=args.width,
            quality=args.quality,
        )
    except Exception as e:
        print(f"Erreur: {e}", file=sys.stderr)
        return 1

    print(f"OK: PDF sélectionné: {latest_pdf.name}")
    print(f"OK: JPEG généré:     {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
