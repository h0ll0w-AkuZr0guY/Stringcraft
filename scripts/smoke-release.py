"""Extract the actual base artifact and launch its exe, without system Python imports."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request
import uuid
import zipfile
parser=argparse.ArgumentParser()
parser.add_argument('archive')
parser.add_argument('--environment')
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
directory=root/'artifacts'/('release-smoke-'+uuid.uuid4().hex[:8])
directory.mkdir()
with zipfile.ZipFile(args.archive) as archive:
    for name in archive.namelist():
        if not (directory/name).resolve().is_relative_to(directory):
            raise SystemExit('Unsafe archive path')
    assert archive.testzip() is None
    archive.extractall(directory)
exe=directory/'Stringcraft'/'Stringcraft.exe'
if args.environment:
    with zipfile.ZipFile(args.environment) as archive:
        for name in archive.namelist():
            if not (exe.parent/name).resolve().is_relative_to(exe.parent):
                raise SystemExit('Unsafe environment archive path')
        archive.extractall(exe.parent)
environment=os.environ.copy()
environment['PATH']=str(Path(os.environ.get('SystemRoot','C:/Windows'))/'System32')
environment['STRINGCRAFT_DATA']=str(directory/'user-data')
with (directory/'process.log').open('wb') as log:
    process=subprocess.Popen([str(exe),'--port','18767','--no-open'],cwd=exe.parent,stdout=log,stderr=log,env=environment,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    try:
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError('Frozen application exited; see the ignored smoke-test log')
            try:
                with urllib.request.urlopen('http://127.0.0.1:18767/api/v1/capabilities',timeout=1) as response:
                    data=json.load(response)
                break
            except OSError:
                time.sleep(.2)
        else:
            raise RuntimeError('Frozen application did not become ready')
        with urllib.request.urlopen('http://127.0.0.1:18767/',timeout=5) as response:
            assert 'Stringcraft' in response.read().decode()
        with urllib.request.urlopen('http://127.0.0.1:18767/plugins/catalog.json',timeout=5) as response:
            assert len(json.load(response))==7
        print(json.dumps({'frozenApplication':'passed','separateExtraction':True,'capabilities':data,'systemPythonRequired':False}))
        if args.environment:
            assert data['plugin']['installed'] and data['plugin']['ffmpeg']
            import requests
            session=requests.get('http://127.0.0.1:18767/api/v1/session',timeout=5).json()
            headers={'Authorization':'Bearer '+session['token']}
            with (root/'tests/fixtures/audio/clean-melody.wav').open('rb') as f:
                job=requests.post('http://127.0.0.1:18767/api/v1/jobs',headers=headers,files={'file':('fixture.wav',f)},data={'mode':'transcribe'},timeout=15).json()
            for _ in range(360):
                current=requests.get('http://127.0.0.1:18767/api/v1/jobs/'+job['id'],headers=headers,timeout=5).json()
                if current['status'] in ('completed','failed','cancelled'):
                    break
                time.sleep(.5)
            assert current['status']=='completed', current.get('error')
            assert len(current['result']['notes'])==6
            print(json.dumps({'relocatedEnvironment':'passed','realInferenceNotes':6,'systemFFmpegRequired':False}))
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
