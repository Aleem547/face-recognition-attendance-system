import contextlib
import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import cv2 as cv
import numpy as np
import enroll
from attendai_face.engine import FaceError

class EnrollmentProtocolChecks(unittest.TestCase):
    def invoke(self, data, outcome=None):
        output=io.StringIO()
        with patch('sys.stdin',SimpleNamespace(buffer=io.BytesIO(data))),contextlib.redirect_stdout(output):
            with patch('manage.runtime'),patch('attendai_face.engine.FaceEngine') as constructor:
                if isinstance(outcome,Exception):constructor.return_value.extract.side_effect=outcome
                elif outcome is not None:constructor.return_value.extract.return_value=outcome
                self.assertEqual(enroll.main(),0)
        return json.loads(output.getvalue()),constructor

    @staticmethod
    def jpeg():
        ok,encoded=cv.imencode('.jpg',np.zeros((128,128,3),dtype=np.uint8))
        assert ok
        return encoded.tobytes()

    def test_oversized_input_is_bounded_before_engine_start(self):
        result,constructor=self.invoke(b'x'*1_048_577)
        self.assertEqual(result,{'ok':False,'code':'invalid_image_size'})
        constructor.assert_not_called()

    def test_small_input_does_not_start_engine(self):
        result,constructor=self.invoke(b'')
        self.assertEqual(result['code'],'invalid_image_size')
        constructor.assert_not_called()

    def test_non_jpeg_never_echoes_input(self):
        result,constructor=self.invoke(b'SYNTHETIC_PRIVATE_INPUT'*4)
        self.assertEqual(result,{'ok':False,'code':'jpeg_required'})
        constructor.assert_not_called()

    def test_success_emits_only_protocol_fields(self):
        sample=SimpleNamespace(embedding=np.full(128,1/np.sqrt(128),dtype=np.float32))
        result,_=self.invoke(self.jpeg(),sample)
        self.assertEqual(set(result),{'ok','embedding','modelVersion'})
        self.assertTrue(result['ok']);self.assertEqual(len(result['embedding']),128)

    def test_known_failure_emits_only_safe_code(self):
        result,_=self.invoke(self.jpeg(),FaceError('multiple_faces'))
        self.assertEqual(result,{'ok':False,'code':'multiple_faces'})

    def test_internal_failure_does_not_expose_exception_text(self):
        result,_=self.invoke(self.jpeg(),RuntimeError('SYNTHETIC_PRIVATE_INTERNAL'))
        self.assertEqual(result,{'ok':False,'code':'engine_unavailable'})
