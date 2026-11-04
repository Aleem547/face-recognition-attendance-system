import sys
from pathlib import Path
import unittest
from unittest.mock import patch
import numpy as np
import cv2 as cv
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import joint
sys.path.insert(0, str(Path(joint.__file__).parent / 'pad'))
import pad_engine
from attendai_face.engine import FaceEngine, FaceError

class JointChecks(unittest.TestCase):
    def test_real_cpu_models(self):
        self.assertEqual(len(pad_engine.PadEngine().smoke()), 2)
        self.assertEqual(FaceEngine().synthetic_self_test(), 3)

    def pipeline(self, fail=False, blurry=False):
        image=np.zeros((480,640,3),dtype=np.uint8) if blurry else np.random.default_rng(7).integers(50,200,(480,640,3),dtype=np.uint8)
        calls=[]
        class Recognizer:
            def alignCrop(self, im, face):
                self_outer.assertIs(im,image);calls.append('align');return im[100:212,100:212].copy()
            def feature(self, im):return np.ones(128,dtype=np.float32)
        class Detector:
            _recognizer=Recognizer()
            def _one_face(self, im):
                self_outer.assertIs(im,image);calls.append('detect');return np.array([100,100,120,120]+[0]*11)
        class Pad:
            def score(self, im, box):
                self_outer.assertIs(im,image);self_outer.assertEqual(box,[100,100,120,120]);calls.append('pad')
                if fail:raise ValueError('synthetic PAD error')
                return {'decision':'not_calibrated','readyForAttendance':False}
        self_outer=self
        with patch('attendai_face.engine.decode_jpeg',return_value=image) as decode,patch('attendai_face.engine.FaceEngine',Detector),patch('pad_engine.PadEngine',Pad):
            if fail or blurry:
                with self.assertRaises((ValueError,FaceError)):joint.analyze(b'bounded-synthetic-test')
            else:
                result=joint.analyze(b'bounded-synthetic-test')
                self.assertEqual(len(result['embedding']),128)
                self.assertEqual(calls,['detect','pad','align'])
            self.assertEqual(decode.call_count,1)
            self.assertFalse(image.any())
        return calls
    def test_one_decode_one_face_same_image(self):self.pipeline()
    def test_pad_failure_clears_frame_and_prevents_embedding(self):self.assertEqual(self.pipeline(fail=True),['detect','pad'])
    def test_comparison_blur_gate_preserved(self):self.assertEqual(self.pipeline(blurry=True),['detect'])
    def test_blank_real_frame_rejected(self):
        ok,encoded=cv.imencode('.jpg',np.zeros((480,640,3),dtype=np.uint8))
        with self.assertRaises(FaceError) as raised:joint.analyze(encoded.tobytes())
        self.assertEqual(raised.exception.code,'no_face')
    def test_invalid_jpeg_rejected(self):
        with self.assertRaises(FaceError):joint.analyze(b'invalid bytes')

if __name__=='__main__':unittest.main()
