param(
    [string]$Version = "v1.2.0",
    [string]$Title = "Narrato v1.2.0 - Local AI Documentary Studio"
)

$Python = "python"
$VenvPython = Join-Path (Split-Path -Parent $PSScriptRoot) ".venv\Scripts\python.exe"
if (Test-Path $VenvPython) {
    $Python = $VenvPython
}

& $Python (Join-Path $PSScriptRoot "publish_release.py") $Version $Title
