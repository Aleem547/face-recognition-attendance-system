"""Research adapter, not an identity or attendance decision system.

Crop geometry adapted from Minivision CropImage at b6d5f04ad78778917853b25c778acef6d5626d15.
Copyright 2020 Minivision; Apache-2.0. Modifications: explicit validation and
memory clearing; OpenCV DNN for pinned yakhyo ONNX exports; no class decisions.
"""
from pathlib import Path
import hashlib
import json
import math

ROOT = Path(__file__).resolve().parent
VERSION = "attendai-pad-minifas-research-v1"


def checked_models():
    items = json.loads((ROOT / "models.json").read_text(encoding="utf-8-sig"))
    expected = {"MiniFASNetV1SE.onnx", "MiniFASNetV2.onnx"}
    if len(items) != 2 or {i["name"] for i in items} != expected:
        raise ValueError("Invalid PAD model manifest.")
    for item in items:
        path = ROOT / "models" / item["name"]
        if path.is_symlink() or not path.is_file() or path.stat().st_size != item["size"]:
            raise ValueError("PAD model missing or wrong size.")
        if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("PAD model checksum mismatch.")
    return items


def crop_box(width, height, bbox, scale):
    if len(bbox) != 4 or scale not in (2.7, 4.0) or min(width, height) < 64:
        raise ValueError("Invalid crop geometry.")
    x, y, w, h = [int(v) for v in bbox]
    if w < 1 or h < 1 or x < 0 or y < 0 or x + w > width or y + h > height:
        raise ValueError("Invalid face rectangle.")
    factor = min((height - 1) / h, (width - 1) / w, scale)
    nw, nh = w * factor, h * factor
    cx, cy = w / 2 + x, h / 2 + y
    left, top, right, bottom = cx - nw / 2, cy - nh / 2, cx + nw / 2, cy + nh / 2
    if left < 0:
        right -= left
        left = 0
    if top < 0:
        bottom -= top
        top = 0
    if right > width - 1:
        left -= right - width + 1
        right = width - 1
    if bottom > height - 1:
        top -= bottom - height + 1
        bottom = height - 1
    result = tuple(int(v) for v in (left, top, right, bottom))
    if not (0 <= result[0] < result[2] < width and 0 <= result[1] < result[3] < height):
        raise ValueError("Crop fell outside the image.")
    return result


def softmax(logits):
    import numpy as np
    values = np.asarray(logits, dtype=np.float64)
    if values.shape != (1, 3) or not np.isfinite(values).all():
        raise ValueError("Invalid PAD output.")
    exp = np.exp(values - values.max(axis=1, keepdims=True))
    values = exp / exp.sum(axis=1, keepdims=True)
    if not np.isfinite(values).all():
        raise ValueError("Invalid PAD output.")
    return values[0]


class PadEngine:
    def __init__(self):
        import cv2 as cv
        cv.setNumThreads(2)
        cv.ocl.setUseOpenCL(False)
        self.models = []
        for item in checked_models():
            net = cv.dnn.readNetFromONNX(str(ROOT / "models" / item["name"]))
            net.setPreferableBackend(cv.dnn.DNN_BACKEND_OPENCV)
            net.setPreferableTarget(cv.dnn.DNN_TARGET_CPU)
            self.models.append((item, net))

    def smoke(self):
        import numpy as np
        result = []
        for item, net in self.models:
            for value in [0, 127]:
                data = np.full((1, 3, 80, 80), value, dtype=np.float32)
                try:
                    net.setInput(data)
                    probs = softmax(net.forward())
                    if abs(float(probs.sum()) - 1) > 1e-10:
                        raise ValueError("Synthetic PAD output failed.")
                finally:
                    data.fill(0)
            result.append(item["name"])
        return result

    def score(self, image, bbox):
        import cv2 as cv
        import numpy as np
        results = []
        height, width = image.shape[:2]
        for item, net in self.models:
            x1, y1, x2, y2 = crop_box(width, height, bbox, item["scale"])
            patch = cv.resize(image[y1:y2 + 1, x1:x2 + 1], (80, 80), interpolation=cv.INTER_LINEAR)
            tensor = np.ascontiguousarray(patch.transpose(2, 0, 1)[None], dtype=np.float32)
            try:
                # Original model expects BGR raw 0..255, float32 NCHW. No RGB swap/division/mean.
                net.setInput(tensor)
                probabilities = softmax(net.forward())
                results.append({"model": item["name"], "class1Score": float(probabilities[1])})
            finally:
                patch.fill(0)
                tensor.fill(0)
        return {"version": VERSION, "models": results,
                "meanClass1Score": sum(r["class1Score"] for r in results) / len(results),
                "decision": "not_calibrated", "readyForAttendance": False}


def analyze(project, data):
    import sys
    sys.path.insert(0, str(Path(project) / "face-engine"))
    from manage import runtime
    runtime()
    from attendai_face.engine import FaceEngine, decode_jpeg
    import cv2 as cv
    image = decode_jpeg(data)
    try:
        h, w = image.shape[:2]
        if max(h, w) > 640 or abs(w / h - 0.75) > 0.005:
            raise ValueError("Use the portrait frame prepared by this research page.")
        # Reuse pinned YuNet single-face/geometry checks. SFace is loaded but no feature is extracted.
        detector = FaceEngine()
        face = detector._one_face(image)
        x, y, fw, fh = map(float, face[:4])
        roi = image[math.ceil(y):math.floor(y + fh), math.ceil(x):math.floor(x + fw)]
        gray = cv.cvtColor(roi, cv.COLOR_BGR2GRAY)
        try:
            blur = float(cv.Laplacian(gray, cv.CV_64F).var())
            brightness = float(gray.mean())
        finally:
            gray.fill(0)
        quality = {"blurVariance": blur, "meanBrightness": brightness,
                   "comparisonQualityChecksMet": blur >= 60 and 40 <= brightness <= 220}
        result = PadEngine().score(image, [int(x), int(y), int(fw), int(fh)])
        result["quality"] = quality
        # Quality is reported, not used as a fake/spoof label or a gate on these research scores.
        return result
    finally:
        image.fill(0)
