#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from google_sheet_source import (
    DEFAULT_SPREADSHEET_URL,
    PreparedSource,
    SourcePreparationError,
    download_and_prepare_source,
    prepare_source_workbook,
)


TOOLS_DIR = Path(__file__).resolve().parent
SITE_DIR = TOOLS_DIR.parent
SOURCE_XLSX = TOOLS_DIR / "input" / "source.xlsx"


@dataclass(frozen=True)
class Step:
    id: str
    label: str
    script_name: str

    @property
    def script_path(self) -> Path:
        return TOOLS_DIR / self.script_name


STEPS = [
    Step("normalize", "Normaliser le fichier source", "normalize.py"),
    Step("enrich", "Enrichir les films", "enrich_3_0.py"),
    Step("excel_to_json", "Generer programme.json", "excel_to_json.py"),
    Step("prochainement", "Generer prochainement.json", "generate_prochainement_json.py"),
    Step("tableau", "Generer le tableau ingest", "make_tableau_ingest.py"),
]
STEP_INDEX = {step.id: index for index, step in enumerate(STEPS)}
SOURCE_STEPS = {"normalize", "prochainement"}


def resolve_python() -> Path:
    candidates = [
        SITE_DIR / ".venv" / "Scripts" / "python.exe",
        SITE_DIR / ".venv" / "bin" / "python",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return Path(sys.executable)


def select_steps(from_step: str, to_step: str) -> list[Step]:
    start_index = STEP_INDEX[from_step]
    end_index = STEP_INDEX[to_step]
    if start_index > end_index:
        raise SystemExit("--from-step doit etre avant ou egal a --to-step.")
    return STEPS[start_index : end_index + 1]


def build_command(python_exe: Path, step: Step) -> list[str]:
    return [str(python_exe), str(step.script_path)]


def ensure_inputs(selected_steps: list[Step]) -> None:
    if any(step.id in SOURCE_STEPS for step in selected_steps) and not SOURCE_XLSX.exists():
        raise SystemExit(
            "Fichier source manquant. Place d'abord ton Excel dans "
            f"{SOURCE_XLSX}."
        )


def positive_programme_number(value: str) -> int:
    try:
        number = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Le numero de programme doit etre un entier.") from exc
    if number <= 0:
        raise argparse.ArgumentTypeError("Le numero de programme doit etre positif.")
    return number


def source_is_needed(selected_steps: list[Step]) -> bool:
    return any(step.id in SOURCE_STEPS for step in selected_steps)


def prepare_input_source(
    selected_steps: list[Step],
    *,
    programme: int | None,
    spreadsheet_url: str,
    local_source: Path | None,
) -> PreparedSource | None:
    if not source_is_needed(selected_steps):
        return None

    try:
        if local_source is not None:
            prepared = prepare_source_workbook(
                local_source,
                SOURCE_XLSX,
                programme,
                allow_legacy_sheet=True,
            )
        else:
            prepared = download_and_prepare_source(
                spreadsheet_url,
                SOURCE_XLSX,
                programme,
            )
    except SourcePreparationError as exc:
        raise SystemExit(f"Preparation de la source impossible : {exc}") from exc

    label = prepared.programme if prepared.programme is not None else prepared.original_sheet_name
    print(
        f"Source preparee : programme {label} -> {prepared.path}",
        flush=True,
    )
    return prepared


def run_step(
    step_number: int,
    step_count: int,
    python_exe: Path,
    step: Step,
) -> None:
    command = build_command(python_exe, step)
    print(f"[{step_number}/{step_count}] {step.label}", flush=True)
    print(f"    commande: {' '.join(command)}", flush=True)
    started_at = time.perf_counter()
    result = subprocess.run(command, cwd=TOOLS_DIR)
    elapsed = time.perf_counter() - started_at
    if result.returncode != 0:
        raise SystemExit(
            f"Echec de l'etape '{step.id}' (code {result.returncode}) apres {elapsed:.1f}s."
        )
    print(f"    OK en {elapsed:.1f}s", flush=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Telecharge le programme depuis Google Sheets puis enchaine les "
            "operations mensuelles du site."
        )
    )
    parser.add_argument(
        "--from-step",
        choices=[step.id for step in STEPS],
        default=STEPS[0].id,
        help="Etape de debut si tu veux reprendre le flux en cours de route.",
    )
    parser.add_argument(
        "--to-step",
        choices=[step.id for step in STEPS],
        default=STEPS[-1].id,
        help="Etape de fin si tu veux limiter l'execution.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Affiche les etapes et les commandes sans rien executer.",
    )
    parser.add_argument(
        "--programme",
        type=positive_programme_number,
        help=(
            "Numero de l'onglet a traiter (ex. 359). Sans cette option, "
            "le plus grand onglet numerique du Google Sheet est selectionne."
        ),
    )
    parser.add_argument(
        "--spreadsheet-url",
        default=os.environ.get("CINECARBONNE_GOOGLE_SHEET_URL", DEFAULT_SPREADSHEET_URL),
        help=(
            "Adresse du Google Sheet source. Peut aussi etre definie avec "
            "CINECARBONNE_GOOGLE_SHEET_URL."
        ),
    )
    parser.add_argument(
        "--source",
        type=Path,
        help=(
            "Classeur Excel local a utiliser a la place du Google Sheet. "
            "Les anciens fichiers avec une feuille Feuil1 restent acceptes."
        ),
    )
    args = parser.parse_args(argv)

    selected_steps = select_steps(args.from_step, args.to_step)
    python_exe = resolve_python()
    print(f"Python utilise: {python_exe}", flush=True)

    if args.dry_run:
        print("Mode dry-run:", flush=True)
        if source_is_needed(selected_steps):
            if args.source:
                source_label = str(args.source)
            else:
                source_label = args.spreadsheet_url
            programme_label = args.programme if args.programme is not None else "dernier onglet numerique"
            print(f"[source] {source_label} -> {programme_label}", flush=True)
        for index, step in enumerate(selected_steps, start=1):
            command = build_command(python_exe, step)
            print(f"[{index}/{len(selected_steps)}] {step.id}: {' '.join(command)}", flush=True)
        return 0

    prepare_input_source(
        selected_steps,
        programme=args.programme,
        spreadsheet_url=args.spreadsheet_url,
        local_source=args.source,
    )
    ensure_inputs(selected_steps)

    for index, step in enumerate(selected_steps, start=1):
        run_step(index, len(selected_steps), python_exe, step)

    print("Termine.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
