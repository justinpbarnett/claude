import json
import os
import subprocess
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
PACKAGE = str(REPO / "packages" / "quality-autoresearch")


def run_script(script: str, *args: str, settings_file: Path) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PI_SETTINGS_FILE"] = str(settings_file)
    return subprocess.run(
        [str(REPO / script), *args],
        cwd=REPO,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )


def read_json(path: Path) -> dict:
    return json.loads(path.read_text())


def test_install_pi_adds_quality_package_without_losing_existing_settings(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"model": "example", "packages": ["npm:already-installed"]}))

    run_script("install.sh", "pi", settings_file=settings)

    data = read_json(settings)
    assert data["model"] == "example"
    assert data["packages"] == ["npm:already-installed", PACKAGE]


def test_install_pi_is_idempotent(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"packages": [PACKAGE]}))

    run_script("install.sh", "pi", settings_file=settings)
    run_script("install.sh", "pi", settings_file=settings)

    assert read_json(settings)["packages"] == [PACKAGE]


def test_uninstall_pi_removes_only_quality_package(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"packages": ["npm:keep", PACKAGE], "theme": "green"}))

    run_script("uninstall.sh", "pi", settings_file=settings)

    data = read_json(settings)
    assert data == {"packages": ["npm:keep"], "theme": "green"}
