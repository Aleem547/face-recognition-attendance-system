"""One decoded frame and face detection for an optional paired research capture.
No disk image, identity decision, PAD threshold, or attendance write.
"""
import json
import math
import sys
from pathlib import Path

VERSION = 'sface2021dec-yunet2023mar-v1'


def analyze(data):
    from manage import runtime
    runtime()
    import cv2 as cv
    from attendai_face.engine import FaceEngine, FaceError, decode_jpeg, normalized
    sys.path.insert(0, str(Path(__file__).resolve().parent / 'pad'))
    from pad_engine import PadEngine
    image = decode_jpeg(data)
    gray = aligned = embedding = None
    try:
        if max(image.shape[:2]) > 640:
            raise FaceError('image_dimensions_out_of_range')
        engine = FaceEngine()
        face = engine._one_face(image)
        x, y, w, h = map(float, face[:4])
        gray = cv.cvtColor(image[math.ceil(y):math.floor(y+h), math.ceil(x):math.floor(x+w)], cv.COLOR_BGR2GRAY)
        brightness = float(gray.mean())
        blur = float(cv.Laplacian(gray, cv.CV_64F).var())
        # Keep the existing comparison gates; research warnings never certify a spoof.
        if not 40 <= brightness <= 220:
            raise FaceError('lighting_unsuitable')
        if blur < 60:
            raise FaceError('face_blurry')
        pad = PadEngine().score(image, [int(x), int(y), int(w), int(h)])
        aligned = engine._recognizer.alignCrop(image, face)
        embedding = normalized(engine._recognizer.feature(aligned))
        return {'ok': True, 'modelVersion': VERSION,
                'embedding': [float(v) for v in embedding], 'pad': pad}
    finally:
        for value in (image, gray, aligned, embedding):
            if value is not None:
                value.fill(0)


def main():
    data = None
    try:
        data = sys.stdin.buffer.read(1_048_577)
        result = analyze(data)
    except Exception as error:
        allowed = {'invalid_image_size', 'jpeg_required', 'invalid_jpeg', 'image_dimensions_out_of_range',
                   'unsupported_jpeg', 'no_face', 'multiple_faces', 'invalid_face_geometry', 'face_too_small',
                   'face_clipped', 'lighting_unsuitable', 'face_blurry'}
        code = getattr(error, 'code', 'engine_unavailable')
        result = {'ok': False, 'code': code if code in allowed else 'engine_unavailable'}
    finally:
        data = None
    print(json.dumps(result, allow_nan=False, separators=(',', ':')), flush=True)


if __name__ == '__main__':
    if sys.argv[1:] == ['--check']:
        from manage import runtime
        runtime()
        from attendai_face.engine import FaceEngine
        sys.path.insert(0, str(Path(__file__).resolve().parent / 'pad'))
        from pad_engine import PadEngine
        FaceEngine().synthetic_self_test()
        PadEngine().smoke()
        print('PAIRED CPU MODEL CHECK PASSED. Synthetic checks only; no liveness assurance.')
    else:
        main()
