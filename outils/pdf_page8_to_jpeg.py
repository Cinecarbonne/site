#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    print("Erreur: PyMuPDF n'est pas installe. Fais: pip install pymupdf", file=sys.stderr)
    raise


NUM_RE = re.compile(r"\b(\d{3,})_")  # ex: "Abonnes 349_2025..." -> 349
PDF_REF_RE = re.compile(
    r"(?P<numero>\d{3,})_(?P<debut>\d{8})-(?P<fin>\d{8})\.pdf$",
    re.IGNORECASE,
)


def pick_latest_pdf(pdf_dir: Path) -> Path:
    if not pdf_dir.exists() or not pdf_dir.is_dir():
        raise FileNotFoundError(f"Dossier PDFs introuvable: {pdf_dir}")

    best_pdf: Path | None = None
    best_num = -1

    for pdf_path in pdf_dir.glob("*.pdf"):
        match = NUM_RE.search(pdf_path.name)
        if not match:
            continue
        numero = int(match.group(1))
        if numero > best_num or (
            numero == best_num and best_pdf is not None and pdf_path.name > best_pdf.name
        ):
            best_num = numero
            best_pdf = pdf_path

    if not best_pdf:
        pdfs = [p.name for p in pdf_dir.glob("*.pdf")]
        if not pdfs:
            raise FileNotFoundError(f"Aucun PDF trouve dans: {pdf_dir}")
        raise ValueError(
            "Aucun PDF ne correspond au motif '###_' "
            "(ex: 'Abonnes 349_...pdf'). "
            f"PDFs trouves: {pdfs}"
        )

    return best_pdf


def render_page_to_jpeg(
    pdf_path: Path,
    out_path: Path,
    page_number_human: int | None = None,
    target_width_px: int = 1600,
    quality: int = 85,
) -> None:
    with fitz.open(pdf_path) as doc:
        if page_number_human is None:
            page_number_human = doc.page_count

        if page_number_human < 1:
            raise ValueError("page_number_human doit etre >= 1")

        page_index = page_number_human - 1  # 0-index
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


def _resolve_arg_path(value: str, base: Path) -> Path:
    path = Path(value)
    if not path.is_absolute():
        return (base / path).resolve()
    return path


def _yyyymmdd_to_iso(text: str) -> str:
    return f"{text[0:4]}-{text[4:6]}-{text[6:8]}"


def build_pdf_reference(pdf_path: Path) -> dict[str, object]:
    match = PDF_REF_RE.search(pdf_path.name)
    if not match:
        raise ValueError(
            "Nom de PDF invalide pour maj de PDFs.json. "
            "Format attendu: '... ###_YYYYMMDD-YYYYMMDD.pdf'. "
            f"Recu: {pdf_path.name}"
        )

    debut = match.group("debut")
    fin = match.group("fin")
    return {
        "numero": int(match.group("numero")),
        "fichier": pdf_path.name,
        "debut": _yyyymmdd_to_iso(debut),
        "fin": _yyyymmdd_to_iso(fin),
    }


def _load_pdfs_index(json_path: Path) -> list[dict[str, object]]:
    if not json_path.exists():
        return []

    raw = json_path.read_text(encoding="utf-8")
    data = json.loads(raw)
    if not isinstance(data, list):
        raise ValueError(f"{json_path} doit contenir une liste JSON.")

    entries: list[dict[str, object]] = []
    for entry in data:
        if isinstance(entry, dict):
            entries.append(dict(entry))
    return entries


def _numero_key(entry: dict[str, object]) -> int:
    value = entry.get("numero")
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return -1


def upsert_pdf_reference(json_path: Path, pdf_path: Path) -> tuple[bool, dict[str, object]]:
    new_ref = build_pdf_reference(pdf_path)
    existing = _load_pdfs_index(json_path)
    updated = [dict(entry) for entry in existing]

    target_index: int | None = None
    for i, entry in enumerate(updated):
        same_file = entry.get("fichier") == new_ref["fichier"]
        same_numero = str(entry.get("numero")) == str(new_ref["numero"])
        if same_file or same_numero:
            target_index = i
            break

    if target_index is None:
        updated.append(new_ref)
    else:
        updated[target_index] = new_ref

    updated.sort(key=_numero_key, reverse=True)

    changed = updated != existing
    if changed:
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(
            json.dumps(updated, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    return changed, new_ref


def main() -> int:
    site_dir = Path(__file__).resolve().parent.parent
    default_pdf_dir = site_dir / "PDFs"
    default_out = default_pdf_dir / "programme_page8.jpg"  # nom fixe => remplace l'ancien
    default_pdfs_json = site_dir / "PDFs.json"

    parser = argparse.ArgumentParser(
        description=(
            "Exporte la derniere page du dernier PDF de PDFs/ en JPEG, "
            "puis met a jour PDFs.json."
        )
    )
    parser.add_argument(
        "--pdf-dir",
        type=str,
        default=str(default_pdf_dir),
        help="Dossier contenant les PDFs (defaut: PDFs/ a la racine du site)",
    )
    parser.add_argument(
        "--out",
        type=str,
        default=str(default_out),
        help="Chemin du JPG de sortie (defaut: PDFs/programme_page8.jpg)",
    )
    parser.add_argument(
        "--pdfs-json",
        type=str,
        default=str(default_pdfs_json),
        help="Fichier index JSON des PDFs (defaut: PDFs.json a la racine du site)",
    )
    parser.add_argument(
        "--page",
        type=int,
        default=None,
        help="Numero de page (1-index, par defaut: derniere page)",
    )
    parser.add_argument("--width", type=int, default=1600, help="Largeur cible en px (defaut: 1600)")
    parser.add_argument("--quality", type=int, default=85, help="Qualite JPEG 1-100 (defaut: 85)")

    args = parser.parse_args()

    pdf_dir = _resolve_arg_path(args.pdf_dir, site_dir)
    out_path = _resolve_arg_path(args.out, site_dir)
    pdfs_json_path = _resolve_arg_path(args.pdfs_json, site_dir)

    try:
        latest_pdf = pick_latest_pdf(pdf_dir)
        render_page_to_jpeg(
            pdf_path=latest_pdf,
            out_path=out_path,
            page_number_human=args.page,
            target_width_px=args.width,
            quality=args.quality,
        )
        json_changed, new_ref = upsert_pdf_reference(pdfs_json_path, latest_pdf)
    except Exception as exc:
        print(f"Erreur: {exc}", file=sys.stderr)
        return 1

    print(f"OK: PDF selectionne: {latest_pdf.name}")
    print(f"OK: JPEG genere:     {out_path}")
    if json_changed:
        print(f"OK: PDFs.json mis a jour: {pdfs_json_path} (numero {new_ref['numero']})")
    else:
        print(f"OK: PDFs.json deja a jour: {pdfs_json_path} (numero {new_ref['numero']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
