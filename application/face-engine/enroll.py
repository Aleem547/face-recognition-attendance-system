"""One enrollment inference over bounded stdin. No files, camera, or database."""
from __future__ import annotations
import json
import sys

MODEL_VERSION = "sface2021dec-yunet2023mar-v1"

def main() -> int:
    try:
        data = sys.stdin.buffer.read(1_048_577)
        if not 20 <= len(data) <= 1_048_576:
            result = {"ok": False, "code": "invalid_image_size"}
        else:
            from manage import runtime
            runtime()
            from attendai_face.engine import FaceEngine, jpeg_dimensions
            jpeg_dimensions(data)
            sample = FaceEngine().extract(data)
            result = {"ok": True, "modelVersion": MODEL_VERSION,
                      "embedding": [float(value) for value in sample.embedding]}
        print(json.dumps(result, allow_nan=False, separators=(",", ":")), flush=True)
        return 0
    except Exception as error:
        allowed = {"invalid_image_size", "jpeg_required", "invalid_jpeg", "image_dimensions_out_of_range",
                   "unsupported_jpeg", "no_face", "multiple_faces", "invalid_face_geometry", "face_too_small",
                   "face_clipped", "lighting_unsuitable", "face_blurry", "inference_failed", "invalid_feature"}
        code = getattr(error, "code", "engine_unavailable")
        print(json.dumps({"ok": False, "code": code if code in allowed else "engine_unavailable"}), flush=True)
        return 0

if __name__ == "__main__":
    sys.exit(main())
