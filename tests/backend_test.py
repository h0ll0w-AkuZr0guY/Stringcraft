"""Run with python -m unittest discover -s tests -p '*_test.py'."""
import os
import tempfile
import unittest
os.environ['STRINGCRAFT_DATA'] = tempfile.mkdtemp(prefix='stringcraft-test-')
from fastapi.testclient import TestClient
from backend.server import app

class LocalHostTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.headers = {'Authorization': 'Bearer ' + self.client.get('/api/v1/session').json()['token']}
    def test_cross_origin_refused(self):
        self.assertEqual(self.client.get('/api/v1/session', headers={'Origin':'https://untrusted.example'}).status_code,403)
    def test_unknown_host_refused(self):
        self.assertEqual(self.client.get('/api/v1/session', headers={'Host':'untrusted.example'}).status_code,403)
    def test_capability_is_truthful(self):
        data = self.client.get('/api/v1/capabilities').json()
        self.assertTrue(data['local'])
        self.assertEqual(data['sdk'],1)
        self.assertIsInstance(data['appVersion'],str)
        self.assertIsInstance(data['buildSha'],str)
    def test_job_authentication_required(self):
        self.assertEqual(self.client.get('/api/v1/jobs/missing').status_code,401)
    def test_unknown_job_is_not_redirected(self):
        self.assertEqual(self.client.get('/api/v1/jobs/missing',headers=self.headers).status_code,404)
    def test_unknown_mode_refused(self):
        self.assertEqual(self.client.post('/api/v1/jobs',headers=self.headers,files={'file':('test.wav',b'audio')},data={'mode':'invalid'}).status_code,400)

if __name__=='__main__':
    unittest.main()
