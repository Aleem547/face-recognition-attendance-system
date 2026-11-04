import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from attendai_face.models import Model, ModelError, NoRedirect, download, manifest, verify


class Response(io.BytesIO):
    status = 200
    def __init__(self, data, advertised=None):
        super().__init__(data)
        self.headers = {} if advertised is None else {'Content-Length': str(advertised)}


class ModelChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data = b'synthetic ONNX download fixture'
        self.model = Model('yunet', 'fixture.onnx', 'models/face_detection_yunet/fixture.onnx',
                           hashlib.sha256(self.data).hexdigest(), len(self.data), '1'*40)

    def tearDown(self): self.temp.cleanup()

    def test_manifest_pins_two_models_and_a_repository_commit(self):
        models = manifest()
        self.assertEqual(sorted(m.name for m in models), ['sface','yunet'])
        self.assertEqual(sum(m.size for m in models), 38_928_942)
        self.assertTrue(all(m.url.startswith('https://media.githubusercontent.com/media/opencv/opencv_zoo/') for m in models))

    def test_verified_download_is_atomic_and_repeat_does_not_download(self):
        self.assertTrue(download(self.model, self.root, opener=lambda *a,**k: Response(self.data, len(self.data))))
        self.assertEqual((self.root/'fixture.onnx').read_bytes(), self.data)
        self.assertFalse(download(self.model, self.root, opener=lambda *a,**k: self.fail('downloaded again')))
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ['fixture.onnx'])

    def test_corrupt_existing_model_is_preserved_and_rejected(self):
        path = self.root/'fixture.onnx'; path.write_bytes(b'corrupt')
        with self.assertRaises(ModelError): download(self.model, self.root, opener=lambda *a,**k: self.fail('downloaded'))
        self.assertEqual(path.read_bytes(), b'corrupt')

    def test_same_length_wrong_checksum_is_rejected(self):
        path = self.root/'fixture.onnx'; path.write_bytes(b'x'*len(self.data))
        with self.assertRaises(ModelError): verify(self.model, path)

    def test_truncated_oversized_and_wrong_content_downloads_leave_no_files(self):
        for data in [self.data[:-1], self.data+b'extra', b'x'*len(self.data)]:
            with self.subTest(size=len(data)):
                with self.assertRaises(ModelError): download(self.model, self.root, opener=lambda *a,**k: Response(data))
                self.assertEqual(list(self.root.iterdir()), [])

    def test_wrong_advertised_size_is_rejected(self):
        with self.assertRaises(ModelError): download(self.model, self.root, opener=lambda *a,**k: Response(self.data, 999))
        self.assertEqual(list(self.root.iterdir()), [])

    def test_network_failure_leaves_no_partial_model(self):
        def fail(*a,**k): raise OSError('synthetic connection failure')
        with self.assertRaises(ModelError): download(self.model, self.root, opener=fail)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_redirect_is_rejected(self):
        with self.assertRaises(ModelError): NoRedirect().redirect_request(None,None,302,'redirect',{},'http://example.test/')

    def test_missing_and_linked_model_rejected(self):
        with self.assertRaises(ModelError): verify(self.model,self.root/'missing.onnx')
        target=self.root/'target';target.write_bytes(self.data)
        linked=self.root/'linked.onnx'
        try: linked.symlink_to(target)
        except OSError: self.skipTest('Symlink creation unavailable on this machine')
        with self.assertRaises(ModelError): verify(self.model,linked)

    def test_manifest_path_traversal_duplicate_models_and_bad_digest_rejected(self):
        valid = json.loads(Path(__file__).parents[1].joinpath('models.lock.json').read_text())
        for change in ['path','duplicate','digest']:
            value=json.loads(json.dumps(valid))
            if change=='path':value['models'][0]['filename']='../outside.onnx'
            elif change=='duplicate':value['models'].append(value['models'][0])
            else:value['models'][0]['sha256']='invalid'
            path=self.root/'manifest.json';path.write_text(json.dumps(value))
            with self.assertRaises(ModelError):manifest(path)


if __name__ == '__main__': unittest.main()
