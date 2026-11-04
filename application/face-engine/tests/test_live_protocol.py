import importlib.util
import io
import json
from pathlib import Path
import struct
import unittest

spec = importlib.util.spec_from_file_location("attendai_live_protocol", Path(__file__).parents[1] / "live.py")
live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(live)

class Vector(list):
    def fill(self, value):
        for index in range(len(self)):
            self[index] = value

class Engine:
    def __init__(self):
        self.calls = 0
        self.samples = []
    def extract(self, frame):
        self.calls += 1
        if frame[0] == 0:
            error = ValueError("private native diagnostic")
            error.code = "no_face"
            raise error
        if frame[0] == 2:
            raise RuntimeError("private unknown diagnostic")
        sample = type("Sample", (), {"embedding": Vector([1 / (128 ** .5)] * 128)})()
        self.samples.append(sample)
        return sample

def frame(value=1, length=20):
    return struct.pack(">I", length) + bytes([value]) * length

class Protocol(unittest.TestCase):
    def run_frames(self, data):
        engine, output, loads = Engine(), io.StringIO(), []
        def make():
            loads.append(True)
            return engine
        live.serve(io.BytesIO(data), output, make)
        return engine, [json.loads(line) for line in output.getvalue().splitlines()], loads
    def test_models_load_once_for_multiple_frames(self):
        engine, messages, loads = self.run_frames(frame() + frame())
        self.assertEqual(len(loads), 1)
        self.assertEqual(engine.calls, 2)
        self.assertEqual([m["type"] for m in messages], ["ready", "result", "result"])
    def test_features_are_cleared_after_response(self):
        engine, _, _ = self.run_frames(frame())
        self.assertTrue(all(v == 0 for v in engine.samples[0].embedding))
    def test_quality_rejection_allows_next_frame(self):
        engine, messages, _ = self.run_frames(frame(0) + frame())
        self.assertEqual(messages[1]["code"], "no_face")
        self.assertTrue(messages[2]["ok"])
        self.assertEqual(engine.calls, 2)
    def test_unknown_diagnostics_are_not_returned(self):
        _, messages, _ = self.run_frames(frame(2))
        self.assertEqual(messages[1], {"type": "result", "ok": False, "code": "engine_unavailable"})
    def test_clean_input_close_exits(self):
        engine, messages, _ = self.run_frames(b"")
        self.assertEqual(engine.calls, 0)
        self.assertEqual(len(messages), 1)
    def test_truncated_header_is_refused(self):
        with self.assertRaisesRegex(ValueError, "truncated_frame"):
            self.run_frames(b"\x00\x00")
    def test_oversized_frame_is_refused_before_body_read(self):
        with self.assertRaisesRegex(ValueError, "invalid_frame_length"):
            self.run_frames(struct.pack(">I", 1_048_577))
    def test_undersized_frame_is_refused(self):
        with self.assertRaisesRegex(ValueError, "invalid_frame_length"):
            self.run_frames(frame(length=19))
    def test_truncated_body_is_refused(self):
        with self.assertRaisesRegex(ValueError, "truncated_frame"):
            self.run_frames(struct.pack(">I", 20) + b"short")

if __name__ == "__main__":
    unittest.main()
