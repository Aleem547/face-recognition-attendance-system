import math
import struct
import threading
import unittest
from unittest.mock import patch

import cv2 as cv
import numpy as np

from attendai_face.engine import (
    FaceEngine, FaceError, MAX_IMAGE_BYTES, cosine_similarity,
    decode_jpeg, jpeg_dimensions, normalized,
)


def jpeg(value):
    ok, data = cv.imencode('.jpg', value)
    assert ok
    return data.tobytes()


def geometry():
    return np.array([100, 100, 160, 160, 145, 145, 210, 145,
                     180, 180, 150, 220, 210, 220, 0.99], dtype=np.float32)


class Detector:
    def __init__(self, faces): self.faces = faces; self.size = None
    def setInputSize(self, size): self.size = size
    def detect(self, _): return 1, self.faces


class Recognizer:
    def __init__(self, feature=None): self.value = np.arange(1, 129, dtype=np.float32) if feature is None else feature
    def alignCrop(self, image, face): return image[100:212, 100:212]
    def feature(self, _): return self.value


def engine(faces, feature=None):
    # Isolate the policy checks from model accuracy and model downloads.
    value = object.__new__(FaceEngine)
    value._lock = threading.Lock()
    value._detector = Detector(faces)
    value._recognizer = Recognizer(feature)
    return value


class ImageChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pattern = np.random.default_rng(7).integers(60, 200, (320, 320, 3), dtype=np.uint8)
        cls.encoded = jpeg(cls.pattern)

    def assert_code(self, code, fn):
        with self.assertRaises(FaceError) as caught: fn()
        self.assertEqual(caught.exception.code, code)

    def test_baseline_jpeg_header_and_decode(self):
        self.assertEqual(jpeg_dimensions(self.encoded), (320, 320))
        self.assertEqual(decode_jpeg(self.encoded).shape, (320, 320, 3))

    def test_progressive_jpeg(self):
        ok, data = cv.imencode('.jpg', self.pattern, [cv.IMWRITE_JPEG_PROGRESSIVE, 1])
        self.assertTrue(ok)
        self.assertEqual(decode_jpeg(data.tobytes()).shape, (320, 320, 3))

    def test_non_jpeg_and_truncation_rejected(self):
        self.assert_code('jpeg_required', lambda: decode_jpeg(b'not a JPEG image at all' * 3))
        self.assert_code('jpeg_required', lambda: decode_jpeg(self.encoded[:-1]))

    def test_compressed_size_is_bounded_before_native_decode(self):
        with patch('attendai_face.engine.cv.imdecode', side_effect=AssertionError('decoder called')):
            self.assert_code('invalid_image_size', lambda: decode_jpeg(b'x' * (MAX_IMAGE_BYTES + 1)))

    def test_huge_dimensions_rejected_before_native_decode(self):
        data = bytearray(self.encoded)
        marker = data.index(b'\xff\xc0')
        data[marker+7:marker+9] = struct.pack('>H', 4096)
        with patch('attendai_face.engine.cv.imdecode', side_effect=AssertionError('decoder called')):
            self.assert_code('image_dimensions_out_of_range', lambda: decode_jpeg(bytes(data)))

    def test_duplicate_frame_header_rejected(self):
        data = self.encoded
        marker = data.index(b'\xff\xc0')
        length = struct.unpack_from('>H', data, marker+2)[0]
        extra = data[marker:marker+2+length]
        self.assert_code('invalid_jpeg', lambda: decode_jpeg(data[:marker]+extra+data[marker:]))

    def test_decoded_dimensions_must_match_header(self):
        with patch('attendai_face.engine.cv.imdecode', return_value=np.zeros((64,64,3), dtype=np.uint8)):
            self.assert_code('invalid_jpeg', lambda: decode_jpeg(self.encoded))

    def test_no_face_and_multiple_faces_rejected(self):
        self.assert_code('no_face', lambda: engine(None).extract(self.encoded))
        self.assert_code('multiple_faces', lambda: engine(np.stack([geometry(), geometry()])).extract(self.encoded))

    def test_small_or_clipped_face_rejected(self):
        face = geometry(); face[2] = 70
        self.assert_code('face_too_small', lambda: engine([face]).extract(self.encoded))
        face = geometry(); face[0] = -1
        self.assert_code('face_clipped', lambda: engine([face]).extract(self.encoded))

    def test_bad_geometry_landmarks_or_score_rejected(self):
        for index, value in [(4, float('nan')), (4, 400), (14, 0.5), (14, 1.1)]:
            with self.subTest(index=index, value=value):
                face = geometry(); face[index] = value
                self.assert_code('invalid_face_geometry', lambda: engine([face]).extract(self.encoded))

    def test_dark_and_blurry_face_rejected(self):
        dark = jpeg(np.zeros((320,320,3), dtype=np.uint8))
        flat = jpeg(np.full((320,320,3), 128, dtype=np.uint8))
        self.assert_code('lighting_unsuitable', lambda: engine([geometry()]).extract(dark))
        self.assert_code('face_blurry', lambda: engine([geometry()]).extract(flat))

    def test_single_suitable_face_yields_finite_normalized_feature(self):
        value = engine([geometry()]); sample = value.extract(self.encoded)
        self.assertEqual(value._detector.size, (320, 320))
        self.assertEqual(sample.embedding.shape, (128,))
        self.assertTrue(np.isfinite(sample.embedding).all())
        self.assertAlmostEqual(float(np.linalg.norm(sample.embedding)), 1.0, places=6)
        self.assertGreater(sample.blur_variance, 60)

    def test_invalid_network_feature_rejected(self):
        for feature in [np.zeros(128), np.ones(127), np.full(128, float('nan'))]:
            self.assert_code('invalid_feature', lambda: engine([geometry()], feature).extract(self.encoded))

    def test_network_failure_is_sanitized(self):
        value = engine([geometry()])
        with patch.object(value._detector, 'detect', side_effect=cv.error('internal fixture failure')):
            self.assert_code('inference_failed', lambda: value.extract(self.encoded))


class SimilarityChecks(unittest.TestCase):
    def test_equal_opposite_and_orthogonal_scores(self):
        a = np.zeros(128); a[0] = 1
        b = np.zeros(128); b[1] = 1
        self.assertAlmostEqual(cosine_similarity(a, a), 1)
        self.assertAlmostEqual(cosine_similarity(a, -a), -1)
        self.assertAlmostEqual(cosine_similarity(a, b), 0)

    def test_scaling_does_not_change_similarity(self):
        a = np.arange(1,129)
        self.assertAlmostEqual(cosine_similarity(a, a*500), 1, places=6)

    def test_invalid_vectors_fail_closed(self):
        for a in [None, [], [1]*127, [0]*128, ['invalid']*128, [float('inf')]*128]:
            with self.subTest(value=type(a).__name__):
                with self.assertRaises(FaceError): normalized(a)


if __name__ == '__main__': unittest.main()
