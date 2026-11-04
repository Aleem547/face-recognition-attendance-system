"""Pinned, bounded model downloads; this module uses only the standard library."""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ENGINE_ROOT / "models.lock.json"
DEFAULT_MODELS = ENGINE_ROOT / "models"


class ModelError(RuntimeError):
    """A model is missing, untrusted, or could not be downloaded completely."""


@dataclass(frozen=True)
class Model:
    name: str
    filename: str
    repository_path: str
    sha256: str
    size: int
    commit: str

    @property
    def url(self) -> str:
        return ("https://media.githubusercontent.com/media/opencv/opencv_zoo/"
                + self.commit + "/" + self.repository_path)


def manifest(path: Path = MANIFEST_PATH) -> tuple[Model, ...]:
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        commit = data["repository_commit"]
        if data["schema"] != 1 or not re.fullmatch(r"[a-f0-9]{40}", commit):
            raise ValueError()
        result = []
        for item in data["models"]:
            name, filename = item["name"], item["filename"]
            if name not in {"yunet", "sface"} or not re.fullmatch(r"[a-z0-9_]+\.onnx", filename):
                raise ValueError()
            expected = f"models/face_{'detection_yunet' if name == 'yunet' else 'recognition_sface'}/{filename}"
            if item["repository_path"] != expected or not re.fullmatch(r"[a-f0-9]{64}", item["sha256"]):
                raise ValueError()
            if type(item["size"]) is not int or not 100_000 <= item["size"] <= 50_000_000:
                raise ValueError()
            result.append(Model(name, filename, expected, item["sha256"], item["size"], commit))
        if sorted(x.name for x in result) != ["sface", "yunet"]:
            raise ValueError()
        return tuple(result)
    except (OSError, ValueError, KeyError, TypeError):
        raise ModelError("The model manifest is invalid. Reinstall the verified Phase 3B1 package.") from None


def verify(model: Model, path: Path) -> None:
    if path.is_symlink() or not path.is_file():
        raise ModelError(f"{model.name}: model missing or linked; run npm run face:models.")
    if path.stat().st_size != model.size:
        raise ModelError(f"{model.name}: model size mismatch. Preserve it for review before replacing it.")
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(256 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != model.sha256:
        raise ModelError(f"{model.name}: model checksum mismatch. Inference is disabled.")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ModelError("The pinned model download redirected unexpectedly.")


def download(model: Model, directory: Path = DEFAULT_MODELS, *, opener=None) -> bool:
    """Return False for a verified existing file; never overwrite an unknown file."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / model.filename
    if destination.exists() or destination.is_symlink():
        verify(model, destination)
        return False
    request = urllib.request.Request(model.url, headers={"User-Agent": "Face Recognition Attendance System-model-setup/0.1"})
    opener = opener or urllib.request.build_opener(NoRedirect()).open
    temporary = None
    try:
        deadline = time.monotonic() + 180
        with opener(request, timeout=20) as response:
            if response.status != 200:
                raise ModelError(f"{model.name}: download did not return HTTP 200.")
            advertised = response.headers.get("Content-Length")
            if advertised is not None and (not advertised.isdecimal() or int(advertised) != model.size):
                raise ModelError(f"{model.name}: unexpected download size.")
            with tempfile.NamedTemporaryFile(prefix=".attendai-model-", suffix=".part", dir=directory, delete=False) as target:
                temporary = Path(target.name)
                total = 0
                while block := response.read(256 * 1024):
                    total += len(block)
                    if total > model.size or time.monotonic() > deadline:
                        raise ModelError(f"{model.name}: model download exceeded its limits.")
                    target.write(block)
                target.flush()
                os.fsync(target.fileno())
        verify(model, temporary)
        # A second concurrent setup must not replace another process's file.
        # Hard-link publication is atomic and refuses an existing destination.
        try:
            os.link(temporary, destination)
        except FileExistsError:
            verify(model, destination)
            return False
        return True
    except ModelError:
        raise
    except (OSError, ValueError):
        raise ModelError(f"{model.name}: download failed. Check the connection and retry; incomplete files are not used.") from None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def verified_paths(directory: Path = DEFAULT_MODELS) -> dict[str, Path]:
    result = {}
    for model in manifest():
        path = directory / model.filename
        verify(model, path)
        result[model.name] = path
    return result
