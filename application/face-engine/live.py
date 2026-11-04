"""Bounded sequential live frames. One model load; no files or camera access."""
from __future__ import annotations
import json
import struct
import sys

MODEL_VERSION = "sface2021dec-yunet2023mar-v1"
MAX_BYTES = 1_048_576
ALLOWED = {"invalid_image_size", "jpeg_required", "invalid_jpeg", "image_dimensions_out_of_range",
           "unsupported_jpeg", "no_face", "multiple_faces", "invalid_face_geometry", "face_too_small",
           "face_clipped", "lighting_unsuitable", "face_blurry", "inference_failed", "invalid_feature"}

def read_exact(source, length):
    chunks = bytearray()
    while len(chunks) < length:
        chunk = source.read(length - len(chunks))
        if not chunk:
            if not chunks:
                return None
            raise ValueError("truncated_frame")
        chunks.extend(chunk)
    return chunks

def emit(sink, value):
    sink.write(json.dumps(value, allow_nan=False, separators=(",", ":")) + "\n")
    sink.flush()

def serve(source, sink, make_engine):
    engine = make_engine()
    emit(sink, {"type": "ready", "modelVersion": MODEL_VERSION})
    while True:
        header = read_exact(source, 4)
        if header is None:
            return 0
        length = struct.unpack(">I", header)[0]
        header[:] = b"\0" * len(header)
        if not 20 <= length <= MAX_BYTES:
            raise ValueError("invalid_frame_length")
        data = read_exact(source, length)
        if data is None:
            raise ValueError("truncated_frame")
        sample = None
        try:
            sample = engine.extract(bytes(data))
            emit(sink, {"type": "result", "ok": True, "modelVersion": MODEL_VERSION,
                        "embedding": [float(value) for value in sample.embedding]})
        except Exception as error:
            code = getattr(error, "code", "engine_unavailable")
            emit(sink, {"type": "result", "ok": False,
                        "code": code if code in ALLOWED else "engine_unavailable"})
        finally:
            data[:] = b"\0" * len(data)
            if sample is not None:
                sample.embedding.fill(0)
            del sample, data

def main():
    try:
        from manage import runtime
        runtime()
        from attendai_face.engine import FaceEngine
        return serve(sys.stdin.buffer, sys.stdout, FaceEngine)
    except Exception:
        emit(sys.stdout, {"type": "fatal", "code": "engine_unavailable"})
        return 1

if __name__ == "__main__":
    sys.exit(main())
