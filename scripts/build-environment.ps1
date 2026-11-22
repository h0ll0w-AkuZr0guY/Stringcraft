param([switch]$WithModels, [string]$ResumeStage)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$taskStage = Join-Path $taskRoot "artifacts\environment-$taskStamp"
if ($ResumeStage) {
  $taskStage = (Resolve-Path -LiteralPath $ResumeStage).Path
  if (-not $taskStage.StartsWith((Join-Path $taskRoot 'artifacts') + [IO.Path]::DirectorySeparatorChar)) { throw 'Resume stage must be inside project artifacts' }
}
$taskPlugin = Join-Path $taskStage 'runtime_plugins\local-separation'
$taskPythonCache = Join-Path $taskRoot '.cache\managed-python'
New-Item -ItemType Directory -Force $taskPlugin,$taskPythonCache | Out-Null
$taskExisting = & uv python find 3.11 --managed-python --no-python-downloads 2>$null
if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $taskExisting)) {
  $taskDistributionPath = Split-Path -Parent $taskExisting
} else {
  & uv python install 3.11 --install-dir $taskPythonCache --no-bin --no-registry
  if ($LASTEXITCODE -ne 0) { throw 'Portable Python download failed' }
  $taskDistribution = Get-ChildItem -LiteralPath $taskPythonCache -Directory -Filter 'cpython-3.11*-windows-x86_64-none' | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $taskDistribution) { throw 'Portable Python distribution was not found' }
  $taskDistributionPath = $taskDistribution.FullName
}
# Copy the relocatable standard runtime only; never copy user-installed packages.
& robocopy $taskDistributionPath (Join-Path $taskPlugin 'python') /E /XD (Join-Path $taskDistributionPath 'Lib\site-packages') '__pycache__' 'Scripts' /XF '*.pyc' /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -gt 7) { throw 'Portable runtime copy failed' }
New-Item -ItemType Directory -Force (Join-Path $taskPlugin 'python\Lib\site-packages') | Out-Null
$taskPython = Join-Path $taskPlugin 'python\python.exe'
& uv pip install --link-mode=copy --break-system-packages --python $taskPython --index-url 'https://download.pytorch.org/whl/cpu' 'torch==2.5.1' 'torchaudio==2.5.1'
if ($LASTEXITCODE -ne 0) { throw 'CPU Torch installation failed' }
& uv pip install --link-mode=copy --break-system-packages --python $taskPython -r (Join-Path $taskRoot 'plugins\local-separation\requirements.txt') 'imageio-ffmpeg==0.6.0'
if ($LASTEXITCODE -ne 0) { throw 'Music environment installation failed' }
& uv pip install --link-mode=copy --break-system-packages --python $taskPython --no-deps 'basic-pitch==0.4.0'
if ($LASTEXITCODE -ne 0) { throw 'Basic Pitch ONNX adapter installation failed' }
New-Item -ItemType Directory -Force (Join-Path $taskPlugin 'bin') | Out-Null
$taskFfmpeg = & $taskPython (Join-Path $PSScriptRoot 'environment-tools.py') ffmpeg
Copy-Item -LiteralPath $taskFfmpeg -Destination (Join-Path $taskPlugin 'bin\ffmpeg.exe')
Copy-Item -LiteralPath (Join-Path $taskRoot 'plugins\local-separation\manifest.json') -Destination $taskPlugin
Copy-Item -LiteralPath (Join-Path $taskRoot 'NOTICE') -Destination $taskPlugin
$env:TORCH_HOME = Join-Path $taskPlugin 'models\torch'
if ($WithModels) {
  & $taskPython (Join-Path $PSScriptRoot 'environment-tools.py') models
  if ($LASTEXITCODE -ne 0) { throw 'Model download failed' }
}
& uv pip freeze --python $taskPython | Out-File -LiteralPath (Join-Path $taskPlugin 'installed-requirements.txt') -Encoding utf8
& $taskPython (Join-Path $PSScriptRoot 'environment-tools.py') verify
if ($LASTEXITCODE -ne 0) { throw 'Environment validation failed' }
$taskArchive = Join-Path $taskRoot 'artifacts\Stringcraft-local-music-0.1.0-windows-x64.zip'
if (Test-Path -LiteralPath $taskArchive) { throw 'Archive already exists; retain the old artifact and choose a new version before rebuilding' }
& $taskPython (Join-Path $PSScriptRoot 'pack-environment.py') $taskStage $taskArchive
if ($LASTEXITCODE -ne 0) { throw 'Environment archive verification failed' }
Get-FileHash -LiteralPath $taskArchive -Algorithm SHA256
Write-Output $taskArchive
