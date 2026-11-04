"""Development CLI. Prints readiness metadata only; never captures a face."""
from __future__ import annotations

import argparse
import importlib.metadata
import json
import platform
import struct
import sys
import unittest
from pathlib import Path

from attendai_face.models import DEFAULT_MODELS, ModelError, download, manifest, verified_paths

ROOT = Path(__file__).resolve().parent


def runtime() -> dict:
    if sys.implementation.name != "cpython" or sys.version_info[:2] != (3, 12) or struct.calcsize("P") != 8:
        raise ModelError("Use 64-bit CPython 3.12 in the dedicated .venv-face environment.")
    versions = {}
    for package, expected in [("numpy", "2.3.5"), ("opencv-python-headless", "4.13.0.92")]:
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            raise ModelError("Install face-engine/requirements.lock in .venv-face first.") from None
        if versions[package] != expected:
            raise ModelError("The face-engine dependency versions differ from requirements.lock.")
    for alternative in ["opencv-python", "opencv-contrib-python", "opencv-contrib-python-headless"]:
        try:
            importlib.metadata.version(alternative)
        except importlib.metadata.PackageNotFoundError:
            continue
        raise ModelError("Another OpenCV distribution is installed. Use a fresh dedicated .venv-face.")
    return {"python": platform.python_version(), "packages": versions, "backend": "opencv_cpu"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["models", "doctor", "test", "smoke"])
    args = parser.parse_args()
    try:
        if args.action == "models":
            for model in manifest():
                created = download(model)
                print(model.name + (": downloaded and SHA-256 verified" if created else ": existing SHA-256 verified"), flush=True)
            return 0
        state = runtime()
        if args.action == "test":
            suite = unittest.defaultTestLoader.discover(str(ROOT / "tests"))
            result = unittest.TextTestRunner(verbosity=2).run(suite)
            return 0 if result.wasSuccessful() else 1
        paths = verified_paths()
        state["models"] = sorted(paths)
        if args.action == "smoke":
            from attendai_face.engine import FaceEngine
            state["synthetic_checks"] = FaceEngine().synthetic_self_test()
            state["engine_ready"] = True
        else:
            state["files_verified"] = True
        state["web_enrollment_configuration"] = "checked_by_nextjs"
        state["attendance_writes_enabled"] = False
        print(json.dumps(state, indent=2))
        return 0
    except (ModelError, ImportError, OSError) as error:
        if isinstance(error, ModelError):
            print(str(error), file=sys.stderr)
        else:
            print("Face-engine setup failed. Check the dedicated environment and model files.", file=sys.stderr)
        return 1
    except Exception as error:
        # No input image, embedding, environment contents, or traceback in CLI output.
        code = getattr(error, "code", "self_test_failed")
        print("Face-engine check failed: " + str(code), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
