"""Public-source audit and local documentation checks. Never reads parent workspace."""
from pathlib import Path
import re
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[1]
result=subprocess.run(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=ROOT,capture_output=True,check=True)
paths=[ROOT/p for p in result.stdout.decode('utf-8').split('\0') if p]
errors=[]
for path in paths:
    if not path.is_file():
        continue
    if any(part in ('neural_env','node_modules','runtime_plugins','.venv','__pycache__') for part in path.relative_to(ROOT).parts):
        errors.append(f'Runtime must not be tracked: {path.relative_to(ROOT)}')
    if path.suffix not in ('.ts','.tsx','.js','.mjs','.py','.json','.md','.yml','.yaml','.ps1','.toml','.html','.txt'):
        continue
    text=path.read_text(encoding='utf-8-sig')
    if re.search(r'(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----)',text):
        errors.append(f'Possible secret: {path.relative_to(ROOT)}')
    if path.suffix=='.md':
        for link in re.findall(r'\]\(([^)]+)\)',text):
            if ':' in link or link.startswith('#'):
                continue
            target=(path.parent/link.split('#')[0])
            if not target.exists():
                errors.append(f'Broken link: {path.relative_to(ROOT)} -> {link}')
if errors:
    print('\n'.join(errors));sys.exit(1)
print(f'Public-source audit and Markdown links passed ({len(paths)} candidate files)')
