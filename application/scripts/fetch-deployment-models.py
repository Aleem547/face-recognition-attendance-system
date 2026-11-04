"""Obtain only manifest-pinned public model weights; never handles face data."""
import hashlib
import json
import os
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "face-engine"))
from attendai_face.models import download, manifest


class CheckedRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname not in {"github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"} or parsed.username or parsed.password:
            raise ValueError("Unexpected model redirect.")
        return super().redirect_request(request, response, code, message, headers, url)


def verify(path, item):
    if path.is_symlink() or not path.is_file() or path.stat().st_size != item["size"] or hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
        raise ValueError("Model checksum or size mismatch; existing files preserved.")


def fetch_pad(directory, item, opener=None):
    directory = Path(directory)
    if directory.is_symlink():
        raise ValueError("Linked model directory refused.")
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / item["name"]
    if destination.exists() or destination.is_symlink():
        verify(destination, item)
        return
    opener = opener or urllib.request.build_opener(CheckedRedirect()).open
    temporary = None
    try:
        with opener(item["source"], timeout=20) as response:
            if response.status != 200:
                raise ValueError("Model download failed.")
            with tempfile.NamedTemporaryFile(dir=directory, delete=False) as target:
                temporary = Path(target.name)
                total, deadline = 0, time.monotonic() + 120
                while block := response.read(256 * 1024):
                    total += len(block)
                    if total > item["size"] or time.monotonic() > deadline:
                        raise ValueError("Model download exceeded its bound.")
                    target.write(block)
                target.flush()
                os.fsync(target.fileno())
        verify(temporary, item)
        try:
            os.link(temporary, destination)
        except FileExistsError:
            verify(destination, item)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    for model in manifest():
        download(model)
    items = json.loads((ROOT / "face-engine/pad/models.json").read_text())
    if sorted(item["name"] for item in items) != ["MiniFASNetV1SE.onnx", "MiniFASNetV2.onnx"]:
        raise ValueError("Unexpected PAD manifest.")
    for item in items:
        if item["source"] != "https://github.com/yakhyo/face-anti-spoofing/releases/download/weights/" + item["name"] or not 1000000 <= item["size"] <= 4000000:
            raise ValueError("Unexpected PAD source or size.")
        fetch_pad(ROOT / "face-engine/pad/models", item)
    print("Four public model weights downloaded and verified against the existing manifests.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Model preparation failed. No unverified model will be used; check upstream availability and retry.", file=sys.stderr)
        sys.exit(1)
