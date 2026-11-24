param([string]$Destination,[switch]$WithModels,[string]$UvPath,[string]$TorchWheel)
$ErrorActionPreference = 'Stop'
$info = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime.json') -Raw | ConvertFrom-Json
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -or $info.device -notin 'cpu','cu124') { throw 'Requires Windows x64.' }
if (-not $env:UV_HTTP_TIMEOUT) { $env:UV_HTTP_TIMEOUT = '180' }
if (-not $env:UV_HTTP_RETRIES) { $env:UV_HTTP_RETRIES = '5' }
if (-not $Destination) {
  Add-Type -AssemblyName System.Windows.Forms
  $picker = New-Object Windows.Forms.FolderBrowserDialog
  $picker.Description = 'Select the folder containing Stringcraft.exe'
  if ($picker.ShowDialog() -ne 'OK') { exit }
  if (-not (Test-Path -LiteralPath (Join-Path $picker.SelectedPath 'Stringcraft.exe'))) { throw 'Stringcraft.exe was not found.' }
  $Destination = Join-Path $picker.SelectedPath 'runtime_plugins'
  $WithModels = (Read-Host 'Download the original model checkpoints now? [Y/N]') -eq 'Y'
}
$root = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $root | Out-Null
$target = Join-Path $root 'local-separation'
if (Test-Path -LiteralPath $target) { throw 'A runtime already exists. Choose a new destination and update the app model directory.' }
$stage = Join-Path $root ('.install-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
if (-not $UvPath) {
  $uvDir = Join-Path $env:LOCALAPPDATA 'Stringcraft/runtime-setup/uv-0.8.0'
  New-Item -ItemType Directory -Force -Path $uvDir | Out-Null
  $zip = Join-Path $uvDir 'official.zip'
  $sha='bad5afed0c18bd7f6c5125f5c7ab89ac830a3db7340c96d50a50527e9880cdfe'
  if (-not (Test-Path -LiteralPath $zip) -or (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $sha) {
    $part = Join-Path $uvDir ('uv-' + [Guid]::NewGuid().ToString('N') + '.zip')
    Invoke-WebRequest -UseBasicParsing 'https://github.com/astral-sh/uv/releases/download/0.8.0/uv-x86_64-pc-windows-msvc.zip' -OutFile $part
    if ((Get-FileHash -LiteralPath $part -Algorithm SHA256).Hash -ne $sha) { throw 'uv signature digest mismatch.' }
    Move-Item -LiteralPath $part -Destination $zip -Force
  }
  $uvExtract = Join-Path $uvDir ([Guid]::NewGuid().ToString('N'))
  Expand-Archive -LiteralPath $zip -DestinationPath $uvExtract
  $UvPath = (Get-ChildItem -LiteralPath $uvExtract -Recurse -Filter 'uv.exe' | Select-Object -First 1).FullName
}
if (-not (Test-Path -LiteralPath $UvPath -PathType Leaf)) { throw 'uv executable not found.' }
$managed = & $UvPath python find 3.11.13 --managed-python --no-python-downloads 2>$null
if ($LASTEXITCODE -ne 0 -or -not $managed) {
  & $UvPath python install 3.11.13 --no-bin --no-registry
  if ($LASTEXITCODE -ne 0) { throw 'Portable Python download failed.' }
  $managed = & $UvPath python find 3.11.13 --managed-python --no-python-downloads
  if ($LASTEXITCODE -ne 0) { throw 'Portable Python not found.' }
}
$source = Split-Path -Parent ($managed | Select-Object -Last 1)
$pythonRoot = Join-Path $stage 'python'
& robocopy $source $pythonRoot /E /XD (Join-Path $source 'Lib/site-packages') '__pycache__' 'Scripts' /XF '*.pyc' /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -gt 7) { throw 'Portable Python copy failed.' }
$python = Join-Path $pythonRoot 'python.exe'
New-Item -ItemType Directory -Force -Path (Join-Path $pythonRoot 'Lib/site-packages'),(Join-Path $stage 'bin') | Out-Null
$torchDigests = @{
  cpu = @('81531d4d5ca74163dc9574b87396531e546a60cceb6253303c7db6a21e867fdf','e08047b9f1997bd303ea6528e5b8009719665a55516a49b6acc359dac20c474d')
  cu124 = @('6c8a7003ef1327479ede284b6e5ab3527d3900c2b2d401af15bcc50f2245a59f','b3d75f4e6efc5412fe78c7f2787ee4f39cea1317652e1a47785879cde109f5c4')
}
$wheelBase = "https://download-r2.pytorch.org/whl/$($info.device)"
$wheelSuffix = "2.5.1%2B$($info.device)-cp311-cp311-win_amd64.whl"
$wheelHashes = $torchDigests[$info.device]
$torch = "$wheelBase/torch-$wheelSuffix#sha256=$($wheelHashes[0])"
$torchaudio = "$wheelBase/torchaudio-$wheelSuffix#sha256=$($wheelHashes[1])"
if ($TorchWheel) {
  $localWheel = Get-Item -LiteralPath $TorchWheel -ErrorAction Stop
  $expectedName = 'torch-' + [Uri]::UnescapeDataString($wheelSuffix)
  if ($localWheel.PSIsContainer -or $localWheel.Name -ne $expectedName -or
      (Get-FileHash -LiteralPath $localWheel.FullName -Algorithm SHA256).Hash -ne $wheelHashes[0]) {
    throw 'The supplied PyTorch wheel filename or SHA-256 does not match this release.'
  }
  $torch = $localWheel.FullName
  Write-Host 'Using the verified local PyTorch wheel.'
}
& $UvPath pip install --link-mode=copy --break-system-packages --python $python --index-url https://pypi.org/simple $torch $torchaudio -r (Join-Path $PSScriptRoot 'requirements.txt') 'imageio-ffmpeg==0.6.0'
if ($LASTEXITCODE -ne 0) { throw 'Music runtime installation failed. For interrupted PyTorch downloads, see MUSIC_RUNTIME in the included instructions.' }
& $UvPath pip install --link-mode=copy --break-system-packages --python $python --index-url https://pypi.org/simple --no-deps 'basic-pitch==0.4.0'
if ($LASTEXITCODE -ne 0) { throw 'Basic Pitch installation failed.' }
$tools = Join-Path $PSScriptRoot 'runtime-tools.py'
$ffmpeg = & $python $tools 'ffmpeg'
if ($LASTEXITCODE -ne 0 -or -not $ffmpeg) { throw 'FFmpeg executable unavailable.' }
Copy-Item -LiteralPath $ffmpeg -Destination (Join-Path $stage 'bin/ffmpeg.exe')
Copy-Item -LiteralPath $tools,(Join-Path $PSScriptRoot 'btc-LICENSE.txt'),(Join-Path $PSScriptRoot 'runtime.json') -Destination $stage
& $python $tools verify $info.device
if ($LASTEXITCODE -ne 0) { throw 'Music runtime self-check failed.' }
if ($WithModels) {
  & $python $tools models $stage
  if ($LASTEXITCODE -ne 0) { throw 'Model initialization failed.' }
}
& $UvPath pip freeze --python $python | Set-Content -LiteralPath (Join-Path $stage 'installed-requirements.txt') -Encoding UTF8
if ($LASTEXITCODE -ne 0) { throw 'Could not record runtime dependencies.' }
if (Test-Path -LiteralPath $target) { throw 'Another installer completed first. Existing runtime preserved.' }
[IO.Directory]::Move($stage,$target)
Write-Host "Ready at $target. Restart Stringcraft after choosing this runtime_plugins path."
