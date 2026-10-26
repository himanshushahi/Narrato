param([switch]$Gpu)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "      NARRATO BUILD PIPELINE    " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$RootFolder = $PSScriptRoot
# Never depend on the caller's current directory — all paths below resolve
# from the script's own location.
Set-Location $RootFolder

# Build variant: default = slim CPU edition (GPU runtime downloadable in-app);
# -Gpu = fat build with CUDA torch baked in (uses the dev .venv as before).
if ($Gpu) {
    $VenvPath = Join-Path $RootFolder ".venv"
    $ReqFile = Join-Path $RootFolder "requirements.txt"
    Write-Host "[INFO] GPU build variant (torch==2.12.0+cu126)" -ForegroundColor Cyan
} else {
    $VenvPath = Join-Path $RootFolder ".venv-build-cpu"
    $ReqFile = Join-Path $RootFolder "requirements-cpu.txt"
    Write-Host "[INFO] CPU build variant (slim; GPU support downloadable in-app)" -ForegroundColor Cyan
}
$VenvActivate = Join-Path $VenvPath "Scripts\Activate.ps1"
$VenvPython = Join-Path $VenvPath "Scripts\python.exe"

# 1. Ensure Python Virtual Environment
Write-Host "`n=== SETTING UP ENVIRONMENT ===" -ForegroundColor Yellow
if (!(Test-Path $VenvPath)) {
    Write-Host "[INFO] Local virtual environment not found. Creating..." -ForegroundColor Cyan
    # Must be Python 3.14: the in-app GPU runtime wheel is pinned to cp314
    # (backend/core/gpu_runtime.py), so a 3.11 build could never load it.
    # Create from the dev .venv's 3.14 interpreter when available, else via uv.
    $DevVenvPython = Join-Path $RootFolder ".venv\Scripts\python.exe"
    if (Test-Path $DevVenvPython) {
        & $DevVenvPython -m venv $VenvPath
    } elseif (Get-Command uv -ErrorAction SilentlyContinue) {
        uv venv --python 3.14 $VenvPath
    } else {
        python -m venv $VenvPath
    }
    if (!(Test-Path $VenvActivate)) {
        Write-Error "[ERROR] Failed to create virtual environment. Ensure Python is in your PATH."
        exit 1
    }
}

Write-Host "[INFO] Activating Python Virtual Environment..." -ForegroundColor Green
. $VenvActivate

Write-Host "[INFO] Installing/Updating Python dependencies..." -ForegroundColor Cyan
& $VenvPython -m pip install -r $ReqFile

# Ensure pyinstaller is installed
Write-Host "[INFO] Ensuring PyInstaller is installed..." -ForegroundColor Cyan
& $VenvPython -m pip install pyinstaller

$FrontendFolder = Join-Path $RootFolder "frontend"
$WebFolder = Join-Path $FrontendFolder "dist"
$DistFolder = Join-Path $RootFolder "dist"
$BuildFolder = Join-Path $RootFolder "build"
$BinFolder = Join-Path $RootFolder "bin"

# 2. Ensure auxiliary binaries are downloaded
Write-Host "`n=== VERIFYING BINARIES ===" -ForegroundColor Yellow
if (!(Test-Path $BinFolder)) {
    New-Item -ItemType Directory -Path $BinFolder -Force | Out-Null
}

Write-Host "[INFO] Running download_binaries.py..." -ForegroundColor Cyan
& $VenvPython (Join-Path $RootFolder "download_binaries.py")
if ($LASTEXITCODE -ne 0) {
    Write-Error "[ERROR] Failed to download required binaries."
    exit 1
}
Write-Host "[SUCCESS] Binaries verification completed." -ForegroundColor Green

# 3. Clean previous builds
Write-Host "`n=== CLEANING WORKSPACE ===" -ForegroundColor Yellow
$FoldersToClean = @($WebFolder, $DistFolder, $BuildFolder)
foreach ($Folder in $FoldersToClean) {
    if (Test-Path $Folder) {
        Write-Host "[CLEAN] Removing $Folder..." -ForegroundColor DarkGray
        Remove-Item -Path $Folder -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "[SUCCESS] Clean completed." -ForegroundColor Green

# 4. Compile Vite Frontend
Write-Host "`n=== COMPILING VITE FRONTEND ===" -ForegroundColor Yellow
Write-Host "[INFO] Installing frontend dependencies..." -ForegroundColor Cyan
Push-Location $FrontendFolder
npm ci
if ($LASTEXITCODE -ne 0) { Write-Error "[ERROR] npm ci failed."; exit 1 }

Write-Host "[INFO] Building production web assets..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error "[ERROR] npm run build failed."; exit 1 }

Write-Host "[INFO] Pre-bundling Remotion composition..." -ForegroundColor Cyan
npm run build:remotion
if ($LASTEXITCODE -ne 0) { Write-Error "[ERROR] npm run build:remotion failed."; exit 1 }

Write-Host "[INFO] Compiling production rendering script..." -ForegroundColor Cyan
npm run build:render
if ($LASTEXITCODE -ne 0) { Write-Error "[ERROR] npm run build:render failed."; exit 1 }

# Generate package.json with versions from frontend/package.json and install deps
# The render.mjs imports @remotion/renderer at runtime (externalized by esbuild).
# Let npm resolve the full dependency tree including peer deps (react, react-dom)
# and platform-specific optional deps (compositor binary) instead of a fragile
# hand-maintained Copy-Item list.
Write-Host "[INFO] Installing render script production dependencies..." -ForegroundColor Cyan
$DistRenderDir = Join-Path $FrontendFolder "dist-render"
$RenderPkgJson = Join-Path $DistRenderDir "package.json"

# Read versions from frontend/package.json to avoid version drift
$FrontendPkg = Get-Content (Join-Path $FrontendFolder "package.json") | ConvertFrom-Json
$RendererVer = $FrontendPkg.devDependencies.'@remotion/renderer'
$ReactVer    = $FrontendPkg.dependencies.react
$ReactDomVer = $FrontendPkg.dependencies.'react-dom'

@"
{
  "name": "narrato-render",
  "private": true,
  "type": "module",
  "dependencies": {
    "@remotion/renderer": "$RendererVer",
    "react": "$ReactVer",
    "react-dom": "$ReactDomVer"
  }
}
"@ | Out-File -Encoding utf8 $RenderPkgJson
Push-Location $DistRenderDir
npm install --production --prefer-offline --no-audit --no-fund
Pop-Location
Pop-Location

if (!(Test-Path $WebFolder)) {
    Write-Error "[ERROR] Web assets build folder was not found at: $WebFolder"
    exit 1
}
Write-Host "[SUCCESS] Vite frontend compiled successfully." -ForegroundColor Green

# 5. Run PyInstaller
Write-Host "`n=== COMPILING BACKEND VIA PYINSTALLER ===" -ForegroundColor Yellow
Write-Host "[INFO] Running PyInstaller..." -ForegroundColor Cyan
& $VenvPython -m PyInstaller --noconfirm (Join-Path $RootFolder "narrato.spec")

$ExePath = Join-Path $DistFolder "Narrato\Narrato.exe"
if (!(Test-Path $ExePath)) {
    Write-Error "[ERROR] PyInstaller compilation failed to produce output executable."
    exit 1
}
Write-Host "[SUCCESS] Standalone app compiled: $ExePath" -ForegroundColor Green

# 6. Compile NSIS Setup Installer
Write-Host "`n=== GENERATING NSIS INSTALLER ===" -ForegroundColor Yellow
$MakeNsisPath = Get-Command makensis -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if (!$MakeNsisPath) {
    $NsisDefaults = @(
        "C:\Program Files (x86)\NSIS\makensis.exe",
        "C:\Program Files\NSIS\makensis.exe"
    )
    foreach ($P in $NsisDefaults) {
        if (Test-Path $P) {
            $MakeNsisPath = $P
            break
        }
    }
}

if ($MakeNsisPath) {
    Write-Host "[INFO] Found makensis at: $MakeNsisPath" -ForegroundColor Cyan
    $NsiScript = Join-Path $RootFolder "installer\installer.nsi"
    & $MakeNsisPath $NsiScript
    
    $InstallerPath = Join-Path $RootFolder "installer\Narrato_Setup.exe"
    if (Test-Path $InstallerPath) {
        Write-Host "[SUCCESS] NSIS installer compiled successfully: $InstallerPath" -ForegroundColor Green
    } else {
        Write-Error "[ERROR] NSIS installer compilation failed."
        exit 1
    }
} else {
    Write-Warning "[WARNING] 'makensis' was not found in PATH or default Windows installation folders."
    Write-Warning "Please download and install NSIS from: https://nsis.sourceforge.io/"
    Write-Warning "Once installed, you can generate the final setup installer manually by running:"
    Write-Warning "  makensis installer/installer.nsi"
}

Write-Host "`n=== BUILD PROCESS FINISHED ===" -ForegroundColor Cyan
