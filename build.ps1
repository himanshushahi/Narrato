Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "      NARRATO BUILD PIPELINE    " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$RootFolder = $PSScriptRoot
$VenvPath = Join-Path $RootFolder ".venv"
$VenvActivate = Join-Path $VenvPath "Scripts\Activate.ps1"
$VenvPython = Join-Path $VenvPath "Scripts\python.exe"

# 1. Ensure Python Virtual Environment
Write-Host "`n=== SETTING UP ENVIRONMENT ===" -ForegroundColor Yellow
if (!(Test-Path $VenvPath)) {
    Write-Host "[INFO] Local virtual environment not found. Creating..." -ForegroundColor Cyan
    python -m venv .venv
    if (!(Test-Path $VenvActivate)) {
        Write-Error "[ERROR] Failed to create virtual environment. Ensure Python is in your PATH."
        exit 1
    }
}

Write-Host "[INFO] Activating Python Virtual Environment..." -ForegroundColor Green
. $VenvActivate

Write-Host "[INFO] Installing/Updating Python dependencies..." -ForegroundColor Cyan
& $VenvPython -m pip install -r requirements.txt

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
& $VenvPython "download_binaries.py"
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
npm install
Write-Host "[INFO] Building production web assets..." -ForegroundColor Cyan
npm run build
Write-Host "[INFO] Pre-bundling Remotion composition..." -ForegroundColor Cyan
npm run build:remotion
Write-Host "[INFO] Compiling production rendering script..." -ForegroundColor Cyan
npm run build:render

# Copy required node_modules for @remotion/renderer to work in production
# These are externalized by esbuild and must be present at runtime
Write-Host "[INFO] Copying required node_modules for production render..." -ForegroundColor Cyan
$NodeModulesDest = Join-Path $FrontendFolder "dist-render/node_modules"
if (Test-Path $NodeModulesDest) {
    Remove-Item -Path $NodeModulesDest -Recurse -Force -ErrorAction SilentlyContinue
}
$RequiredPackages = @(
    "@remotion/renderer",
    "@remotion/bundler",
    "remotion",
    "execa",
    "get-port",
    "zod",
    "dotenv",
    "dotenv-expand"
)
foreach ($Pkg in $RequiredPackages) {
    $Src = Join-Path $FrontendFolder "node_modules/$Pkg"
    $Dest = Join-Path $NodeModulesDest $Pkg
    if (Test-Path $Src) {
        New-Item -ItemType Directory -Path (Split-Path $Dest -Parent) -Force | Out-Null
        Copy-Item -Path $Src -Destination $Dest -Recurse -Force
        Write-Host "  Copied: $Pkg" -ForegroundColor Gray
    }
}
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
