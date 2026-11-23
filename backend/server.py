"""Loopback-only, same-origin local compute host with cancellable subprocess jobs."""
from __future__ import annotations
import argparse
import asyncio
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
import webbrowser
import socket

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1]))
USER_ROOT = Path(os.environ.get('STRINGCRAFT_DATA', Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'Stringcraft'))
PLUGIN_ROOT = Path(os.environ.get('STRINGCRAFT_PLUGIN_DIR', Path(sys.executable).parent / 'runtime_plugins' if getattr(sys, 'frozen', False) else ROOT / 'runtime_plugins'))
RUNTIME = USER_ROOT / 'jobs'
TOKEN = secrets.token_urlsafe(32)
MAX_BYTES = 200 * 1024 * 1024
JOBS: dict[str, dict] = {}
PROCESSES: dict[str, asyncio.subprocess.Process] = {}
TASKS: set[asyncio.Task] = set()

def build_info() -> dict:
    try:
        value = json.loads((ROOT / 'dist' / 'build-info.json').read_text(encoding='utf-8'))
        return {key: value[key] for key in ('appVersion', 'buildSha')}
    except (OSError, ValueError, KeyError):
        return {'appVersion': 'development', 'buildSha': 'local'}

def plugin_python() -> Path:
    override = os.environ.get('STRINGCRAFT_NEURAL_PYTHON')
    if override:
        return Path(override)
    return PLUGIN_ROOT / 'local-separation' / 'python' / ('python.exe' if os.name == 'nt' else 'bin/python3')

def ffmpeg() -> str | None:
    bundled = PLUGIN_ROOT / 'local-separation' / 'bin' / ('ffmpeg.exe' if os.name == 'nt' else 'ffmpeg')
    return str(bundled) if bundled.is_file() else shutil.which('ffmpeg')

async def kill(process):
    if process.returncode is not None:
        return
    if os.name == 'nt':
        killer = await asyncio.create_subprocess_exec('taskkill', '/PID', str(process.pid), '/T', '/F', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
        await killer.wait()
    else:
        import signal
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    await process.wait()

@asynccontextmanager
async def lifespan(app):
    RUNTIME.mkdir(parents=True, exist_ok=True)
    # Only old, server-owned UUID job directories are eligible for cleanup.
    import re
    for path in RUNTIME.iterdir():
        if re.fullmatch(r'[a-f0-9]{32}', path.name) and path.is_dir() and not path.is_symlink() and time.time() - path.stat().st_mtime > 86400:
            shutil.rmtree(path)
    yield
    await asyncio.gather(*(kill(p) for p in list(PROCESSES.values())), return_exceptions=True)
    for task in TASKS:
        task.cancel()

app = FastAPI(title='Stringcraft local compute', version='1.0.0', lifespan=lifespan)

@app.middleware('http')
async def guard(request: Request, call_next):
    from urllib.parse import urlparse
    if request.url.hostname not in ('localhost', '127.0.0.1', 'testserver'):
        return JSONResponse({'detail': 'Loopback host required'}, status_code=403)
    origin = request.headers.get('origin')
    if origin and origin != f'{request.url.scheme}://{request.headers.get("host")}':
        return JSONResponse({'detail': 'Same-origin request required'}, status_code=403)
    if request.url.path.startswith('/api/v1/') and request.url.path not in ('/api/v1/session', '/api/v1/capabilities'):
        if not secrets.compare_digest(request.headers.get('authorization', ''), 'Bearer ' + TOKEN):
            return JSONResponse({'detail': 'Invalid local session'}, status_code=401)
    response = await call_next(request)
    if request.url.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response

@app.get('/api/v1/session')
def session():
    return {'token': TOKEN, 'sdk': 1}

@app.get('/api/v1/capabilities')
def capabilities():
    python = plugin_python()
    return {'sdk': 1, 'local': True, **build_info(), 'plugin': {'id': 'local-separation', 'installed': python.is_file(), 'ffmpeg': bool(ffmpeg())}, 'maxUploadBytes': MAX_BYTES}

async def run_job(identifier: str, source: Path, mode: str):
    job = JOBS[identifier]
    if job['status'] == 'cancelled':
        source.unlink(missing_ok=True)
        return
    job.update(status='running', message='正在启动独立识别环境', progress=.05)
    env = os.environ.copy()
    for key in ('PYTHONPATH', 'PYTHONHOME'):
        env.pop(key, None)
    env.update(PYTHONNOUSERSITE='1', PYTHONIOENCODING='utf-8')
    env['PATH'] = str(Path(ffmpeg()).parent) + os.pathsep + env.get('PATH', '')
    env['TORCH_HOME'] = str(PLUGIN_ROOT / 'local-separation' / 'models' / 'torch')
    env['NUMBA_CACHE_DIR'] = str(USER_ROOT / 'numba_cache')
    try:
        process = await asyncio.create_subprocess_exec(str(plugin_python()), str(ROOT / 'backend' / 'worker.py'), str(source), mode,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, env=env, limit=10*1024*1024,
            **({'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {'start_new_session': True}))
        PROCESSES[identifier] = process
        if job['status'] == 'cancelled':
            await kill(process)
            return
        while True:
            line = await asyncio.wait_for(process.stdout.readline(), timeout=900)
            if not line:
                break
            if len(line) > 10 * 1024 * 1024:
                raise ValueError('Worker output exceeds limit')
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get('type') == 'progress' and job['status'] != 'cancelled':
                job.update(progress=event['progress'], message=event['message'])
            elif event.get('type') == 'result' and job['status'] != 'cancelled':
                (source.parent / 'result.json').write_text(json.dumps(event['result'], allow_nan=False), encoding='utf-8')
                job['result'] = event['result']
        code = await process.wait()
        if job['status'] != 'cancelled':
            if code != 0 or 'result' not in job:
                raise RuntimeError('模型执行失败，请检查环境包、模型下载与输入格式')
            job.update(status='completed', progress=1, message='本地分析完成')
    except asyncio.CancelledError:
        if identifier in PROCESSES:
            await kill(PROCESSES[identifier])
        raise
    except Exception:
        if identifier in PROCESSES:
            await kill(PROCESSES[identifier])
        if job['status'] != 'cancelled':
            job.update(status='failed', error={'code': 'INFERENCE_FAILED', 'message': '本地识别失败或超时。请检查环境包、FFmpeg 与音频文件。'}, message='识别失败')
    finally:
        PROCESSES.pop(identifier, None)
        source.unlink(missing_ok=True)

@app.post('/api/v1/jobs', status_code=202)
async def submit(file: UploadFile = File(...), mode: str = Form('transcribe')):
    if mode not in ('transcribe', 'vocals', 'instrumental'):
        raise HTTPException(400, 'Unknown processing mode')
    if not plugin_python().is_file() or not ffmpeg():
        raise HTTPException(409, '请安装本地增强环境包与 FFmpeg')
    if any(j['status'] in ('queued', 'running') for j in JOBS.values()):
        raise HTTPException(409, '本机已有分析任务，请等待或取消后重试')
    if len(JOBS) >= 100:
        for key in list(JOBS):
            if JOBS[key]['status'] not in ('queued', 'running'):
                JOBS.pop(key)
                break
    identifier = uuid.uuid4().hex
    directory = RUNTIME / identifier
    directory.mkdir(parents=True)
    source = directory / 'source.audio'
    size = 0
    try:
        with source.open('wb') as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, '本地上传上限为 200 MB')
                output.write(chunk)
        if not size:
            raise HTTPException(400, 'Empty audio file')
    except Exception:
        source.unlink(missing_ok=True)
        raise
    JOBS[identifier] = {'id': identifier, 'status': 'queued', 'progress': 0, 'message': '等待分析'}
    task = asyncio.create_task(run_job(identifier, source, mode))
    TASKS.add(task)
    task.add_done_callback(TASKS.discard)
    return JOBS[identifier]

@app.get('/api/v1/jobs/{identifier}')
def read_job(identifier: str):
    if identifier not in JOBS:
        raise HTTPException(404, 'Unknown job')
    return JOBS[identifier]

@app.delete('/api/v1/jobs/{identifier}')
async def cancel_job(identifier: str):
    job = read_job(identifier)
    if job['status'] in ('queued', 'running'):
        job.update(status='cancelled', message='已取消')
        if identifier in PROCESSES:
            await kill(PROCESSES[identifier])
    return job

if (ROOT / 'dist').is_dir():
    app.mount('/', StaticFiles(directory=ROOT / 'dist', html=True), name='workbench')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=18765)
    parser.add_argument('--no-open', action='store_true')
    args = parser.parse_args()
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        listener.bind(('127.0.0.1', args.port))
        listener.listen(128)
    except OSError:
        listener.close()
        # Never silently send the user to a different build occupying this port.
        try:
            import urllib.request
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(f'http://127.0.0.1:{args.port}/api/v1/capabilities', timeout=2) as response:
                existing = json.load(response)
            same = existing.get('local') is True and all(existing.get(k) == v for k, v in build_info().items())
        except Exception:
            same = False
        if same:
            if not args.no_open:
                webbrowser.open(f'http://127.0.0.1:{args.port}/')
            print('This Stringcraft build is already running.')
            return
        message = f'端口 {args.port} 已被旧版本或其他程序占用。请关闭旧窗口后重新启动；未打开其他版本。'
        print(message)
        if os.name == 'nt' and not args.no_open:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, message, 'Stringcraft 本地试用', 0x10)
        raise SystemExit(1)
    if not args.no_open:
        import threading
        def open_when_ready():
            import urllib.request
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            for _ in range(100):
                try:
                    with opener.open(f'http://127.0.0.1:{args.port}/api/v1/capabilities', timeout=.5) as response:
                        json.load(response)
                    webbrowser.open(f'http://127.0.0.1:{args.port}/')
                    return
                except Exception:
                    time.sleep(.1)
        threading.Thread(target=open_when_ready, daemon=True).start()
    try:
        uvicorn.Server(uvicorn.Config(app, log_level='warning')).run(sockets=[listener])
    finally:
        listener.close()

if __name__ == '__main__':
    main()
