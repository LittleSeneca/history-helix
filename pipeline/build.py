#!/usr/bin/env python3
"""Build orchestrator — runs the full data pipeline.

For now, just calls the demographics script. A-5 adds events.
"""

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    print("=== History Helix — Data Build ===", flush=True)

    # Demographics
    demo_script = REPO_ROOT / "pipeline" / "fetch_demographics.py"
    print(f"Running {demo_script}...", flush=True)
    result = subprocess.run(
        [sys.executable, str(demo_script)],
        cwd=REPO_ROOT,
        capture_output=False,
    )
    if result.returncode != 0:
        print("ERROR: demographics pipeline failed", file=sys.stderr)
        sys.exit(result.returncode)

    # Events
    events_script = REPO_ROOT / "pipeline" / "fetch_events.py"
    print(f"Running {events_script}...", flush=True)
    result = subprocess.run(
        [sys.executable, str(events_script)],
        cwd=REPO_ROOT,
        capture_output=False,
    )
    if result.returncode != 0:
        print("ERROR: events pipeline failed", file=sys.stderr)
        sys.exit(result.returncode)

    # People
    people_script = REPO_ROOT / "pipeline" / "fetch_people.py"
    print(f"Running {people_script}...", flush=True)
    result = subprocess.run(
        [sys.executable, str(people_script)],
        cwd=REPO_ROOT,
        capture_output=False,
    )
    if result.returncode != 0:
        print("ERROR: people pipeline failed", file=sys.stderr)
        sys.exit(result.returncode)

    print("Build complete.", flush=True)


if __name__ == "__main__":
    main()