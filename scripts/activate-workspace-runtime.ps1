param([Parameter(Mandatory)][string]$Candidate)
$ErrorActionPreference = 'Stop'
$root = (Get-Item -LiteralPath (Join-Path $PSScriptRoot '../..')).FullName
if (-not (Test-Path -LiteralPath (Join-Path $root '.stringcraft-workspace') -PathType Leaf)) {
    throw 'This command requires the managed Stringcraft workspace.'
}
$maintenance = Join-Path $root '.maintenance'
$staged = (Get-Item -LiteralPath $Candidate -ErrorAction Stop).FullName
if (-not $staged.StartsWith($maintenance + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Leaf $staged) -ne 'local-separation') {
    throw 'Prepare the candidate local-separation directory inside .maintenance.'
}
$runtime = Join-Path $root 'runtime'
$current = Join-Path $runtime 'local-separation'
$backup = Join-Path $runtime '.previous'
foreach ($path in @($root, $maintenance, (Split-Path -Parent $staged), $staged, $runtime, $current)) {
    if ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Workspace runtime directories cannot be junctions or symlinks.'
    }
}
if ((Get-ChildItem -LiteralPath $current,$staged -Recurse -Attributes ReparsePoint | Select-Object -First 1) -or
    (Test-Path -LiteralPath $backup)) {
    throw 'Unexpected link or previous replacement. Review the workspace before continuing.'
}
if (Get-Process -Name 'Stringcraft','StringcraftService' -ErrorAction SilentlyContinue) {
    throw 'Exit Stringcraft from the tray before replacing the runtime.'
}
$env:TMP = Join-Path $maintenance 'tmp'
$env:TEMP = $env:TMP
$env:UV_NO_CACHE = '1'
$env:PYTHONNOUSERSITE = '1'
New-Item -Path $env:TMP -ItemType Directory -Force | Out-Null
$python = Join-Path $staged 'python/python.exe'
$uv = Join-Path $root 'private/tools/uv.exe'
& $uv pip install --break-system-packages --link-mode=copy --python $python -r (Join-Path $PSScriptRoot 'requirements-build.txt')
if ($LASTEXITCODE) { throw 'The candidate could not be prepared. The active runtime is unchanged.' }

function Test-WorkspaceRuntime([string]$path) {
    $env:STRINGCRAFT_DATA = Join-Path $root 'data'
    $env:STRINGCRAFT_PLUGIN_DIR = Split-Path -Parent $path
    Push-Location (Join-Path $root 'source')
    try {
        & (Join-Path $path 'python/python.exe') -c 'from backend.server import engine_probe; result=engine_probe(); print(result.get("message")); raise SystemExit(not result.get("ready"))' | Out-Host
        return $LASTEXITCODE -eq 0
    }
    finally { Pop-Location }
}
if (-not (Test-WorkspaceRuntime $staged)) { throw 'Candidate model probe failed.' }
[IO.Directory]::Move($current, $backup)
try {
    [IO.Directory]::Move($staged, $current)
    if (-not (Test-WorkspaceRuntime $current)) { throw 'The model probe failed after replacement.' }
}
catch {
    if (Test-Path -LiteralPath $current) { [IO.Directory]::Move($current, $staged) }
    [IO.Directory]::Move($backup, $current)
    throw
}
if ((Get-Item -LiteralPath $backup).FullName -cne $backup) { throw 'Unexpected previous runtime path.' }
Remove-Item -LiteralPath $backup -Recurse -ErrorAction Stop
