"""Bounded JPEG input, single-face checks, and CPU embeddings for future use.

This module performs inference only. It cannot enroll identities, save images,
call the database, mark attendance, or prove that a face is live.
"""
from __future__ import annotations

import math
import struct
import threading
from dataclasses import dataclass
from pathlib import Path

import cv2 as cv
import numpy as np

from .models import DEFAULT_MODELS, ModelError, verified_paths

MAX_IMAGE_BYTES = 1_048_576
MAX_DIMENSION = 2048
MAX_PIXELS = 4_194_304
FEATURE_SIZE = 128


class FaceError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def jpeg_dimensions(data: bytes) -> tuple[int, int]:
    """Read the bounded JPEG header before asking a native decoder to allocate."""
    if not isinstance(data, bytes) or not 20 <= len(data) <= MAX_IMAGE_BYTES:
        raise FaceError("invalid_image_size")
    if not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9"):
        raise FaceError("jpeg_required")
    offset, found, segments = 2, None, 0
    while offset < len(data) and offset < 65_536:
        if data[offset] != 0xFF:
            raise FaceError("invalid_jpeg")
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1
        if offset >= len(data):
            break
        marker = data[offset]
        offset += 1
        segments += 1
        if segments > 256:
            raise FaceError("invalid_jpeg")
        if marker == 0xDA:  # start of scan: the decoder checks compressed data
            if found is None:
                raise FaceError("invalid_jpeg")
            return found
        if marker in (0x00, 0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            raise FaceError("invalid_jpeg")
        if offset + 2 > len(data):
            raise FaceError("invalid_jpeg")
        length = struct.unpack_from(">H", data, offset)[0]
        if length < 2 or offset + length > len(data):
            raise FaceError("invalid_jpeg")
        if marker in (0xC0, 0xC2):  # 8-bit baseline or progressive JPEG only
            if found is not None or length < 8:
                raise FaceError("invalid_jpeg")
            precision, height, width, components = struct.unpack_from(">BHHB", data, offset + 2)
            if precision != 8 or components not in (1, 3) or length != 8 + 3 * components:
                raise FaceError("invalid_jpeg")
            if not (64 <= width <= MAX_DIMENSION and 64 <= height <= MAX_DIMENSION) or width * height > MAX_PIXELS:
                raise FaceError("image_dimensions_out_of_range")
            found = (width, height)
        elif marker in (0xC1, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            raise FaceError("unsupported_jpeg")
        offset += length
    raise FaceError("invalid_jpeg")


def decode_jpeg(data: bytes) -> np.ndarray:
    width, height = jpeg_dimensions(data)
    image = cv.imdecode(np.frombuffer(data, dtype=np.uint8), cv.IMREAD_COLOR | cv.IMREAD_IGNORE_ORIENTATION)
    if image is None or image.dtype != np.uint8 or image.shape != (height, width, 3):
        raise FaceError("invalid_jpeg")
    return image


def normalized(vector) -> np.ndarray:
    try:
        value = np.asarray(vector, dtype=np.float64).reshape(-1)
    except (TypeError, ValueError, OverflowError):
        raise FaceError("invalid_feature") from None
    if value.shape != (FEATURE_SIZE,) or not np.isfinite(value).all():
        raise FaceError("invalid_feature")
    norm = float(np.linalg.norm(value))
    if not math.isfinite(norm) or norm <= 1e-12:
        raise FaceError("invalid_feature")
    return (value / norm).astype(np.float32)


def cosine_similarity(reference, probe) -> float:
    """Similarity is a score, not calibrated confidence or a live-person proof."""
    left, right = normalized(reference), normalized(probe)
    return float(np.clip(np.dot(left.astype(np.float64), right.astype(np.float64)), -1, 1))


@dataclass(frozen=True)
class FaceSample:
    embedding: np.ndarray
    blur_variance: float
    mean_brightness: float
    detector_score: float


class FaceEngine:
    def __init__(self, directory: Path = DEFAULT_MODELS):
        paths = verified_paths(directory)
        cv.setNumThreads(2)
        cv.ocl.setUseOpenCL(False)
        self._lock = threading.Lock()
        try:
            self._detector = cv.FaceDetectorYN.create(
                str(paths["yunet"]), "", (320, 320), 0.9, 0.3, 500,
                cv.dnn.DNN_BACKEND_OPENCV, cv.dnn.DNN_TARGET_CPU)
            self._recognizer = cv.FaceRecognizerSF.create(
                str(paths["sface"]), "", cv.dnn.DNN_BACKEND_OPENCV, cv.dnn.DNN_TARGET_CPU)
        except cv.error:
            raise ModelError("OpenCV could not load the verified CPU models.") from None

    def _one_face(self, image: np.ndarray) -> np.ndarray:
        height, width = image.shape[:2]
        self._detector.setInputSize((width, height))
        _, faces = self._detector.detect(image)
        if faces is None or len(faces) == 0:
            raise FaceError("no_face")
        if len(faces) != 1:
            raise FaceError("multiple_faces")
        face = np.asarray(faces[0], dtype=np.float32)
        if face.shape != (15,) or not np.isfinite(face).all():
            raise FaceError("invalid_face_geometry")
        x, y, w, h = map(float, face[:4])
        if w < 96 or h < 96:
            raise FaceError("face_too_small")
        if x < 0 or y < 0 or x + w > width or y + h > height:
            raise FaceError("face_clipped")
        points = face[4:14].reshape(5, 2)
        if not ((points[:, 0] >= x).all() and (points[:, 0] <= x+w).all()
                and (points[:, 1] >= y).all() and (points[:, 1] <= y+h).all()
                and 0.9 <= float(face[14]) <= 1.0):
            raise FaceError("invalid_face_geometry")
        return face

    def extract(self, data: bytes) -> FaceSample:
        image = decode_jpeg(data)
        try:
            with self._lock:
                face = self._one_face(image)
                x, y, w, h = map(float, face[:4])
                roi = image[math.ceil(y):math.floor(y+h), math.ceil(x):math.floor(x+w)]
                gray = cv.cvtColor(roi, cv.COLOR_BGR2GRAY)
                brightness = float(gray.mean())
                blur = float(cv.Laplacian(gray, cv.CV_64F).var())
                if not 40 <= brightness <= 220:
                    raise FaceError("lighting_unsuitable")
                if blur < 60:
                    raise FaceError("face_blurry")
                aligned = self._recognizer.alignCrop(image, face)
                embedding = normalized(self._recognizer.feature(aligned))
                return FaceSample(embedding, blur, brightness, float(face[14]))
        except cv.error:
            raise FaceError("inference_failed") from None

    def synthetic_self_test(self) -> int:
        """Exercise real networks without a camera, a person, or enrollment."""
        blank = np.zeros((320, 320, 3), dtype=np.uint8)
        with self._lock:
            try:
                self._one_face(blank)
            except FaceError as error:
                if error.code != "no_face":
                    raise
            else:
                raise FaceError("synthetic_detector_check_failed")
            patch = np.random.default_rng(547).integers(20, 235, (112, 112, 3), dtype=np.uint8)
            first = normalized(self._recognizer.feature(patch))
            second = normalized(self._recognizer.feature(patch))
        if cosine_similarity(first, second) < 0.9999:
            raise FaceError("synthetic_feature_check_failed")
        return 3  # blank-frame rejection, finite normalized feature, repeatability
