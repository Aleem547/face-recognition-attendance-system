import hashlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[2] / 'scripts/fetch-deployment-models.py'
spec = importlib.util.spec_from_file_location('deployment_model_fetch', MODULE)
fetch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch)


class Response(io.BytesIO):
    status = 200


class DeploymentModelChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data = b'public synthetic model fixture' * 50
        self.item = {'name': 'MiniFASNetV1SE.onnx', 'source': 'https://github.com/fixture',
                     'size': len(self.data), 'sha256': hashlib.sha256(self.data).hexdigest()}

    def tearDown(self):
        self.temp.cleanup()

    def test_verified_model_is_published_atomically_and_reused(self):
        fetch.fetch_pad(self.root, self.item, lambda *a, **k: Response(self.data))
        fetch.fetch_pad(self.root, self.item, lambda *a, **k: self.fail('Already verified file was downloaded again'))
        self.assertEqual((self.root / self.item['name']).read_bytes(), self.data)
        self.assertEqual(len(list(self.root.iterdir())), 1)

    def test_oversized_and_corrupt_downloads_are_not_installed(self):
        for data in [self.data + b'oversized', b'x' * len(self.data), self.data[:-1]]:
            with self.assertRaises(ValueError):
                fetch.fetch_pad(self.root, self.item, lambda *a, **k: Response(data))
            self.assertEqual(list(self.root.iterdir()), [])

    def test_unknown_existing_model_is_preserved(self):
        target = self.root / self.item['name']
        target.write_bytes(b'preserve unknown local file')
        with self.assertRaises(ValueError):
            fetch.fetch_pad(self.root, self.item)
        self.assertEqual(target.read_bytes(), b'preserve unknown local file')

    def test_redirects_reject_http_and_unapproved_hosts(self):
        for url in ['http://github.com/model', 'https://unapproved.example/model', 'https://user:secret@github.com/model']:
            with self.assertRaises(ValueError):
                fetch.CheckedRedirect().redirect_request(None, None, 302, '', {}, url)


if __name__ == '__main__':
    unittest.main()
