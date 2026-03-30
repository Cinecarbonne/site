#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


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
    if selected_steps and not SOURCE_XLSX.exists():
        raise SystemExit(
            "Fichier source manquant. Place d'abord ton Excel dans "
            f"{SOURCE_XLSX}."
        )


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


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Enchaine les operations mensuelles du programme cinema a partir de "
            "outils/input/source.xlsx."
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
    args = parser.parse_args()

    selected_steps = select_steps(args.from_step, args.to_step)
    ensure_inputs(selected_steps)

    python_exe = resolve_python()
    print(f"Python utilise: {python_exe}", flush=True)

    if args.dry_run:
        print("Mode dry-run:", flush=True)
        for index, step in enumerate(selected_steps, start=1):
            command = build_command(python_exe, step)
            print(f"[{index}/{len(selected_steps)}] {step.id}: {' '.join(command)}", flush=True)
        return 0

    for index, step in enumerate(selected_steps, start=1):
        run_step(index, len(selected_steps), python_exe, step)

    print("Termine.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
