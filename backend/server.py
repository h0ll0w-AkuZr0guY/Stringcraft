"""Loopback-only, same-origin local compute host with cancellable subprocess jobs."""

from __future__ import annotations
import zipfile, wave
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
import hashlib

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, Body
from backend.assets import AudioAssets
from backend.bundles import export_bundle, import_bundle, MAX_EXPANDED
from starlette.background import BackgroundTask
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
USER_ROOT = Path(
    os.environ.get(
        "STRINGCRAFT_DATA",
        Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Stringcraft",
    )
)
PLUGIN_ROOT = Path(
    os.environ.get(
        "STRINGCRAFT_PLUGIN_DIR",
        Path(sys.executable).parent / "runtime_plugins"
        if getattr(sys, "frozen", False)
        else ROOT / "runtime_plugins",
    )
)
RUNTIME = USER_ROOT / "jobs"
TOKEN = secrets.token_urlsafe(32)
MAX_BYTES = 200 * 1024 * 1024
JOBS: dict[str, dict] = {}
PROCESSES: dict[str, asyncio.subprocess.Process] = {}
TASKS: set[asyncio.Task] = set()
ENGINE = {"status": "checking", "ready": False}
PIPELINE_VERSION = "audio-harmony-0.4.0-tracks"
ASSETS = AudioAssets(USER_ROOT / "assets")


def engine_probe():
    if not plugin_python().is_file() or not ffmpeg():
        return {
            "status": "missing",
            "ready": False,
            "message": "完整本地模型环境未安装",
        }
    env = os.environ.copy()
    env.update(
        PYTHONNOUSERSITE="1",
        PYTHONIOENCODING="utf-8",
        TORCH_HOME=str(PLUGIN_ROOT / "local-separation/models/torch"),
    )
    try:
        process = subprocess.run(
            [
                str(plugin_python()),
                "-s",
                str(ROOT / "plugins/audio-harmony/pipeline.py"),
                "probe",
                str(PLUGIN_ROOT / "local-separation/models"),
            ],
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=120,
        )
        data = json.loads(process.stdout.strip().splitlines()[-1])
        if process.returncode or not data.get("ready"):
            raise ValueError()
        digest = hashlib.sha256()
        for path in sorted((ROOT / "plugins/audio-harmony").rglob("*.py")):
            digest.update(path.relative_to(ROOT).as_posix().encode())
            digest.update(path.read_bytes())
        data["pluginSha256"] = digest.hexdigest()
        return {**data, "status": "ready", "message": "本地模型与执行设备已检查"}
    except Exception:
        return {
            "status": "error",
            "ready": False,
            "message": "本地模型检查失败，请查看环境完整性；未切换为浏览器冒充增强。",
        }


def build_info() -> dict:
    try:
        value = json.loads(
            (ROOT / "dist" / "build-info.json").read_text(encoding="utf-8")
        )
        return {key: value[key] for key in ("appVersion", "buildSha")}
    except (OSError, ValueError, KeyError):
        return {"appVersion": "development", "buildSha": "local"}


def plugin_python() -> Path:
    override = os.environ.get("STRINGCRAFT_NEURAL_PYTHON")
    if override:
        return Path(override)
    return (
        PLUGIN_ROOT
        / "local-separation"
        / "python"
        / ("python.exe" if os.name == "nt" else "bin/python3")
    )


def ffmpeg() -> str | None:
    bundled = (
        PLUGIN_ROOT
        / "local-separation"
        / "bin"
        / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    )
    return str(bundled) if bundled.is_file() else shutil.which("ffmpeg")


async def kill(process):
    if process.returncode is not None:
        return
    if os.name == "nt":
        killer = await asyncio.create_subprocess_exec(
            "taskkill",
            "/PID",
            str(process.pid),
            "/T",
            "/F",
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
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
        if (
            re.fullmatch(r"[a-f0-9]{32}", path.name)
            and path.is_dir()
            and not path.is_symlink()
            and time.time() - path.stat().st_mtime > 86400
        ):
            shutil.rmtree(path)
        elif (
            path.is_dir()
            and (path / "cache.json").is_file()
            and (path / "result.json").is_file()
        ):
            try:
                meta = json.loads((path / "cache.json").read_text(encoding="utf-8"))
                if meta.get("pipeline") == PIPELINE_VERSION and len(JOBS) < 100:
                    JOBS[path.name] = {
                        "id": path.name,
                        "status": "completed",
                        "progress": 1,
                        "message": "复用本地分离结果",
                        "cacheKey": meta["cacheKey"],
                        "result": json.loads(
                            (path / "result.json").read_text(encoding="utf-8")
                        ),
                    }
            except (ValueError, KeyError, OSError):
                pass

    async def probe():
        global ENGINE
        ENGINE = await asyncio.to_thread(engine_probe)

    probe_task = asyncio.create_task(probe())
    yield
    probe_task.cancel()
    await asyncio.gather(
        *(kill(p) for p in list(PROCESSES.values())), return_exceptions=True
    )
    for task in TASKS:
        task.cancel()


app = FastAPI(title="Stringcraft local compute", version="1.0.0", lifespan=lifespan)


@app.middleware("http")
async def guard(request: Request, call_next):
    from urllib.parse import urlparse

    if request.url.hostname not in ("localhost", "127.0.0.1", "testserver"):
        return JSONResponse({"detail": "Loopback host required"}, status_code=403)
    origin = request.headers.get("origin")
    if origin and origin != f"{request.url.scheme}://{request.headers.get('host')}":
        return JSONResponse({"detail": "Same-origin request required"}, status_code=403)
    if request.url.path.startswith("/api/v1/") and request.url.path not in (
        "/api/v1/session",
        "/api/v1/capabilities",
    ):
        if not secrets.compare_digest(
            request.headers.get("authorization", ""), "Bearer " + TOKEN
        ):
            return JSONResponse({"detail": "Invalid local session"}, status_code=401)
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/api/v1/session")
def session():
    return {"token": TOKEN, "sdk": 1}


@app.get("/api/v1/capabilities")
def capabilities():
    python = plugin_python()
    return {
        "sdk": 1,
        "local": True,
        **build_info(),
        "engine": ENGINE,
        "plugin": {
            "id": "local-separation",
            "installed": python.is_file(),
            "ffmpeg": bool(ffmpeg()),
        },
        "maxUploadBytes": MAX_BYTES,
    }


async def run_job(identifier: str, source: Path, mode: str, settings=None):
    job = JOBS[identifier]
    if job["status"] == "cancelled":
        source.unlink(missing_ok=True)
        return
    job.update(status="running", message="正在启动独立识别环境", progress=0.05)
    env = os.environ.copy()
    for key in ("PYTHONPATH", "PYTHONHOME"):
        env.pop(key, None)
    env.update(PYTHONNOUSERSITE="1", PYTHONIOENCODING="utf-8")
    env["PATH"] = str(Path(ffmpeg()).parent) + os.pathsep + env.get("PATH", "")
    env["TORCH_HOME"] = str(PLUGIN_ROOT / "local-separation" / "models" / "torch")
    env["NUMBA_CACHE_DIR"] = str(USER_ROOT / "numba_cache")
    try:
        process = await asyncio.create_subprocess_exec(
            str(plugin_python()),
            str(ROOT / "backend" / "worker.py"),
            str(source),
            mode,
            str(source.parent),
            json.dumps(settings or {}),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            env=env,
            limit=10 * 1024 * 1024,
            **(
                {"creationflags": subprocess.CREATE_NO_WINDOW}
                if os.name == "nt"
                else {"start_new_session": True}
            ),
        )
        PROCESSES[identifier] = process
        if job["status"] == "cancelled":
            await kill(process)
            return
        while True:
            line = await asyncio.wait_for(process.stdout.readline(), timeout=900)
            if not line:
                break
            if len(line) > 10 * 1024 * 1024:
                raise ValueError("Worker output exceeds limit")
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get("type") == "progress" and job["status"] != "cancelled":
                job.update(progress=event["progress"], message=event["message"])
            elif event.get("type") == "partial" and job["status"] != "cancelled":
                job["partial"] = {
                    "notes": event["notes"],
                    "duration": event["duration"],
                }
            elif event.get("type") == "result" and job["status"] != "cancelled":
                filenames = {
                    "original": "original.wav",
                    "vocal": "vocals.wav",
                    "instrumental": "accompaniment.wav",
                    "bass": "bass.wav",
                    "drums": "drums.wav",
                    "other": "other.wav",
                }
                for track in event["result"].get("tracks", []):
                    filename = filenames.get(track.get("role"))
                    if not filename or track.pop("assetFile", None) != filename:
                        raise ValueError("Invalid stem output")
                    track["asset"] = ASSETS.register(source.parent / filename)
                    if track["role"] == "instrumental":
                        track["harmonyAnalysis"] = event["result"].get(
                            "harmonyAnalysis"
                        )
                (source.parent / "result.json").write_text(
                    json.dumps(event["result"], allow_nan=False), encoding="utf-8"
                )
                job["result"] = event["result"]
                job.pop("partial", None)
        code = await process.wait()
        if job["status"] != "cancelled":
            if code != 0 or "result" not in job:
                raise RuntimeError("模型执行失败，请检查环境包、模型下载与输入格式")
            job.update(status="completed", progress=1, message="本地分析完成")
            if mode == "accompaniment" or mode.startswith("track-"):
                (source.parent / "cache.json").write_text(
                    json.dumps(
                        {"pipeline": PIPELINE_VERSION, "cacheKey": job["cacheKey"]}
                    ),
                    encoding="utf-8",
                )
    except asyncio.CancelledError:
        if identifier in PROCESSES:
            await kill(PROCESSES[identifier])
        raise
    except Exception:
        if identifier in PROCESSES:
            await kill(PROCESSES[identifier])
        if job["status"] != "cancelled":
            job.update(
                status="failed",
                error={
                    "code": "INFERENCE_FAILED",
                    "message": "本地识别失败或超时。请检查环境包、FFmpeg 与音频文件。",
                },
                message="识别失败",
            )
    finally:
        PROCESSES.pop(identifier, None)
        source.unlink(missing_ok=True)


@app.post("/api/v1/jobs", status_code=202)
async def submit(
    file: UploadFile = File(...),
    mode: str = Form("transcribe"),
    offset: float = Form(0),
    seconds: float = Form(1800),
):
    import math

    if mode not in ("transcribe", "vocals", "instrumental", "accompaniment"):
        raise HTTPException(400, "Unknown processing mode")
    if (
        not math.isfinite(offset)
        or offset < 0
        or not math.isfinite(seconds)
        or seconds <= 0
        or seconds > 1800
    ):
        raise HTTPException(400, "Invalid audio range")
    if mode == "accompaniment" and not ENGINE.get("ready"):
        raise HTTPException(409, ENGINE.get("message", "本地模型仍在检查"))
    if not plugin_python().is_file() or not ffmpeg():
        raise HTTPException(409, "请安装本地增强环境包与 FFmpeg")
    if any(j["status"] in ("queued", "running") for j in JOBS.values()):
        raise HTTPException(409, "本机已有分析任务，请等待或取消后重试")
    if len(JOBS) >= 100:
        for key in list(JOBS):
            if JOBS[key]["status"] not in ("queued", "running"):
                JOBS.pop(key)
                break
    identifier = uuid.uuid4().hex
    directory = RUNTIME / identifier
    directory.mkdir(parents=True)
    source = directory / "source.audio"
    # Reserve the single heavy-job slot before awaiting the upload stream.
    JOBS[identifier] = {
        "id": identifier,
        "status": "queued",
        "progress": 0,
        "message": "接收音频",
    }
    size = 0
    try:
        with source.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, "本地上传上限为 200 MB")
                output.write(chunk)
        if not size:
            raise HTTPException(400, "Empty audio file")
    except Exception:
        source.unlink(missing_ok=True)
        JOBS.pop(identifier, None)
        raise
    JOBS[identifier] = {
        "id": identifier,
        "status": "queued",
        "progress": 0,
        "message": "等待分析",
    }
    # Completed jobs are keyed by source content, analysis settings and algorithm version.
    digest = hashlib.sha256()
    with source.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    cache_key = hashlib.sha256(
        (
            digest.hexdigest() + PIPELINE_VERSION + mode + str(offset) + str(seconds)
        ).encode()
    ).hexdigest()
    JOBS[identifier]["cacheKey"] = cache_key
    if mode == "accompaniment":
        for old_id, old in JOBS.items():
            if (
                old_id != identifier
                and old.get("status") == "completed"
                and old.get("cacheKey") == cache_key
                and (RUNTIME / old_id / "accompaniment.wav").is_file()
            ):
                source.unlink(missing_ok=True)
                JOBS.pop(identifier)
                return {**old, "cacheHit": True}
    task = asyncio.create_task(
        run_job(identifier, source, mode, {"offset": offset, "seconds": seconds})
    )
    TASKS.add(task)
    task.add_done_callback(TASKS.discard)
    return JOBS[identifier]


@app.get("/api/v1/assets/{identifier}")
def saved_asset(identifier: str):
    try:
        return FileResponse(ASSETS.path(identifier), media_type="audio/wav")
    except (ValueError, FileNotFoundError):
        raise HTTPException(404, "Audio asset unavailable; relink or analyze again")


@app.post("/api/v1/project-bundles")
def make_bundle(body: dict = Body(...)):
    folder = USER_ROOT / "exports"
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / (uuid.uuid4().hex + ".zip")
    try:
        export_bundle(body.get("project"), ASSETS, target)
    except (ValueError, KeyError, FileNotFoundError):
        target.unlink(missing_ok=True)
        raise HTTPException(400, "Project audio is missing or invalid; relink it first")
    return FileResponse(
        target,
        media_type="application/zip",
        filename="Stringcraft-project.stringcraft.zip",
        background=BackgroundTask(target.unlink, missing_ok=True),
    )


@app.post("/api/v1/project-bundles/import")
async def open_bundle(file: UploadFile = File(...)):
    with tempfile.TemporaryDirectory(prefix="stringcraft-bundle-") as temp:
        source = Path(temp) / "input.zip"
        size = 0
        with source.open("wb") as output:
            while chunk := await file.read(1024**2):
                size += len(chunk)
                if size > MAX_EXPANDED:
                    raise HTTPException(413, "Project archive exceeds 2 GB")
                output.write(chunk)
        try:
            return {"project": import_bundle(source, ASSETS)}
        except (
            ValueError,
            KeyError,
            TypeError,
            OSError,
            EOFError,
            zipfile.BadZipFile,
            wave.Error,
        ):
            raise HTTPException(400, "Invalid project archive or audio digest")


@app.post("/api/v1/assets/references")
def pin_assets(body: dict = Body(...)):
    try:
        ASSETS.pin(body.get("projectId"), body.get("assetIds"))
        return {"saved": True}
    except (ValueError, FileNotFoundError):
        raise HTTPException(400, "Invalid audio asset references")


@app.delete("/api/v1/assets/references/{project}")
def release_assets(project: str):
    try:
        ASSETS.release(project)
        return {"released": True}
    except ValueError:
        raise HTTPException(400, "Invalid project identity")


@app.post("/api/v1/jobs/from-asset", status_code=202)
async def analyze_asset(body: dict = Body(...)):
    operation = body.get("operation")
    if operation not in ("vocal-melody", "transcribe"):
        raise HTTPException(400, "Unknown asset analysis")
    if not ENGINE.get("ready"):
        raise HTTPException(409, "Local models are not ready")
    if any(j["status"] in ("queued", "running") for j in JOBS.values()):
        raise HTTPException(409, "A local analysis is already running")
    try:
        original = ASSETS.path(body.get("assetId"))
        backing = (
            ASSETS.path(body["backingAssetId"]) if body.get("backingAssetId") else None
        )
    except (ValueError, FileNotFoundError):
        raise HTTPException(404, "Audio asset unavailable")
    mode = "track-vocal" if operation == "vocal-melody" else "track-transcribe"
    cache_key = hashlib.sha256(
        (
            body["assetId"]
            + str(body.get("backingAssetId", ""))
            + mode
            + PIPELINE_VERSION
        ).encode()
    ).hexdigest()
    for old in JOBS.values():
        if old.get("status") == "completed" and old.get("cacheKey") == cache_key:
            return {**old, "cacheHit": True}
    identifier = uuid.uuid4().hex
    directory = RUNTIME / identifier
    directory.mkdir(parents=True)
    source = directory / "source.audio"
    shutil.copyfile(original, source)
    JOBS[identifier] = {
        "id": identifier,
        "status": "queued",
        "progress": 0,
        "message": "分析独立轨道",
        "cacheKey": cache_key,
    }
    task = asyncio.create_task(
        run_job(identifier, source, mode, {"backing": str(backing)} if backing else {})
    )
    TASKS.add(task)
    task.add_done_callback(TASKS.discard)
    return JOBS[identifier]


@app.get("/api/v1/jobs/{identifier}/assets/{asset}")
def asset(identifier: str, asset: str):
    if (
        identifier not in JOBS
        or JOBS[identifier]["status"] != "completed"
        or asset
        not in (
            "accompaniment.wav",
            "bass.wav",
            "vocals.wav",
            "original.wav",
            "drums.wav",
            "other.wav",
            "direct-harmony.json",
            "separated-harmony.json",
            "cqt-harmony.json",
        )
    ):
        raise HTTPException(404, "Analysis asset unavailable")
    path = RUNTIME / identifier / asset
    if not path.is_file():
        raise HTTPException(404, "Analysis asset expired; please reanalyse")
    return FileResponse(path)


@app.get("/api/v1/jobs/{identifier}")
def read_job(identifier: str):
    if identifier not in JOBS:
        raise HTTPException(404, "Unknown job")
    return JOBS[identifier]


@app.delete("/api/v1/jobs/{identifier}")
async def cancel_job(identifier: str):
    job = read_job(identifier)
    if job["status"] in ("queued", "running"):
        job.update(status="cancelled", message="已取消")
        if identifier in PROCESSES:
            await kill(PROCESSES[identifier])
    return job


if (ROOT / "dist").is_dir():
    app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="workbench")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=18765)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        listener.bind(("127.0.0.1", args.port))
        listener.listen(128)
    except OSError:
        listener.close()
        # Never silently send the user to a different build occupying this port.
        try:
            import urllib.request

            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(
                f"http://127.0.0.1:{args.port}/api/v1/capabilities", timeout=2
            ) as response:
                existing = json.load(response)
            same = existing.get("local") is True and all(
                existing.get(k) == v for k, v in build_info().items()
            )
        except Exception:
            same = False
        if same:
            if not args.no_open:
                webbrowser.open(f"http://127.0.0.1:{args.port}/")
            print("This Stringcraft build is already running.")
            return
        message = f"端口 {args.port} 已被旧版本或其他程序占用。请关闭旧窗口后重新启动；未打开其他版本。"
        print(message)
        if os.name == "nt" and not args.no_open:
            import ctypes

            ctypes.windll.user32.MessageBoxW(0, message, "Stringcraft 本地试用", 0x10)
        raise SystemExit(1)
    if not args.no_open:
        import threading

        def open_when_ready():
            import urllib.request

            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            for _ in range(100):
                try:
                    with opener.open(
                        f"http://127.0.0.1:{args.port}/api/v1/capabilities", timeout=0.5
                    ) as response:
                        json.load(response)
                    webbrowser.open(f"http://127.0.0.1:{args.port}/")
                    return
                except Exception:
                    time.sleep(0.1)

        threading.Thread(target=open_when_ready, daemon=True).start()
    try:
        uvicorn.Server(uvicorn.Config(app, log_level="warning")).run(sockets=[listener])
    finally:
        listener.close()


if __name__ == "__main__":
    main()
