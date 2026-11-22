"""Streaming ZIP64 packaging; exclude reproducible bytecode, retain sources/licenses."""
from pathlib import Path
import sys
import time
import zipfile
stage=Path(sys.argv[1]).resolve()
output=Path(sys.argv[2]).resolve()
root=Path(__file__).resolve().parents[1]
if not stage.is_relative_to(root/'artifacts') or not output.is_relative_to(root/'artifacts'):
    raise SystemExit('Package paths must stay inside project artifacts')
if output.exists() and output.stat().st_size:
    raise SystemExit('Refusing to overwrite an existing environment artifact')
files=[p for p in (stage/'runtime_plugins').rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc']
partial=output.with_suffix('.partial.zip')
last=time.monotonic()
with zipfile.ZipFile(partial,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=1,allowZip64=True) as archive:
    for i,path in enumerate(files):
        archive.write(path,path.relative_to(stage))
        if time.monotonic()-last>10:
            print(f'Environment package: {i+1}/{len(files)} files',flush=True);last=time.monotonic()
with zipfile.ZipFile(partial) as archive:
    bad=archive.testzip()
    if bad:
        raise SystemExit('ZIP integrity validation failed')
partial.replace(output)
print(output,flush=True)
