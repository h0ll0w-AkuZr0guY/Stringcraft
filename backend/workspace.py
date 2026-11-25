"""Locate the optional one-directory Stringcraft workspace."""

from pathlib import Path
import os
import sys


def find_workspace(start: Path) -> Path | None:
    start = start.resolve()
    return next(
        (path for path in (start, *start.parents)
         if (path / ".stringcraft-workspace").is_file()),
        None,
    )


def managed_path(workspace: Path, path: Path) -> Path:
    destination = path.resolve()
    if not destination.is_relative_to(workspace):
        raise ValueError("Stringcraft's managed paths must stay inside the workspace.")
    return destination


def runtime_workspace() -> Path | None:
    start = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).parent
    return find_workspace(start)


def use_local_temporary_files(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for name in ("TMP", "TEMP", "TMPDIR"):
        os.environ[name] = str(directory)
