"""Build Windows base ZIP in a new stage; does not include heavy music dependencies."""
from pathlib import Path
import datetime
import json
import shutil
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'package.json').read_text())['version']
stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
stage=ROOT/'artifacts'/f'build-{stamp}'
stage.mkdir(parents=True)
if not (ROOT/'dist'/'index.html').is_file():
    raise SystemExit('Run npm run build first')
env=ROOT/'.venv-build'
if not env.is_dir():
    subprocess.run([sys.executable,'-m','venv',str(env)],check=True)
python=env/'Scripts'/'python.exe'
subprocess.run([str(python),'-m','pip','install','-r',str(ROOT/'backend'/'requirements.txt'),'pyinstaller==6.19.0'],check=True)
subprocess.run([str(python),'-m','PyInstaller','--noconfirm','--name','Stringcraft','--onedir',
    '--paths',str(ROOT),'--distpath',str(stage),'--workpath',str(stage/'work'),'--specpath',str(stage),
    '--collect-submodules','uvicorn','--add-data',f'{ROOT / "dist"};dist',
    '--add-data',f'{ROOT / "backend" / "worker.py"};backend',str(ROOT/'backend'/'launcher.py')],check=True,cwd=ROOT)
bundle=stage/'Stringcraft'
for name in ('LICENSE','NOTICE','README.md'):
    shutil.copy2(ROOT/name,bundle/name)
shutil.copy2(ROOT/'dist'/'build-info.json', bundle/'build-info.json')
shutil.copy2(ROOT/'docs'/'LOCAL_TRIAL.md', bundle/'使用说明.md')
shutil.copytree(ROOT/'docs',bundle/'docs')
(bundle/'runtime_plugins').mkdir(exist_ok=True)
(bundle/'runtime_plugins'/'README.txt').write_text('Extract the local music environment here. The base application does not require it.\n',encoding='utf-8')
archive=shutil.make_archive(str(ROOT/'artifacts'/f'Stringcraft-{VERSION}-preview-windows-x64'),'zip',root_dir=stage,base_dir='Stringcraft')
import hashlib
archive_path = Path(archive)
archive_path.with_suffix('.zip.sha256').write_text(hashlib.sha256(archive_path.read_bytes()).hexdigest() + '  ' + archive_path.name + '\n', encoding='utf-8')
print(archive)
