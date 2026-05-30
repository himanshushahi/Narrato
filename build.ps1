Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "      RENDERFLOW STUDIO BUILD PIPELINE    " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Detect and activate local python virtual environment
$RootFolder = $PSScriptRoot
$VenvPath = Join-Path $RootFolder ".venv"
$VenvActivate = Join-Path $VenvPath "Scripts\Activate.ps1"

if (Test-Path $VenvActivate) {
    Write-Host "[INFO] Activating Python Virtual Environment..." -ForegroundColor Green
    . $VenvActivate
} else {
    Write-Warning "[WARNING] Local virtual environment (.venv) was not found. Attempting to build with system python."
}

$FrontendFolder = Join-Path $RootFolder "frontend"
$WebFolder = Join-Path $FrontendFolder "dist"
$DistFolder = Join-Path $RootFolder "dist"
$BuildFolder = Join-Path $RootFolder "build"
$BinFolder = Join-Path $RootFolder "bin"

# 2. Clean previous builds
Write-Host "`n=== CLEANING WORKSPACE ===" -ForegroundColor Yellow
$FoldersToClean = @($WebFolder, $DistFolder, $BuildFolder)
foreach ($Folder in $FoldersToClean) {
    if (Test-Path $Folder) {
        Write-Host "[CLEAN] Removing $Folder..." -ForegroundColor DarkGray
        Remove-Item -Path $Folder -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "[SUCCESS] Clean completed." -ForegroundColor Green

# 3. Compile Vite Frontend
Write-Host "`n=== COMPILING VITE FRONTEND ===" -ForegroundColor Yellow
if (!(Test-Path (Join-Path $FrontendFolder "node_modules"))) {
    Write-Host "[INFO] node_modules not found in frontend. Running npm install..." -ForegroundColor Cyan
    Push-Location $FrontendFolder
    npm install
    Pop-Location
}
Write-Host "[INFO] Building production web assets..." -ForegroundColor Cyan
Push-Location $FrontendFolder
npm run build
Pop-Location

if (!(Test-Path $WebFolder)) {
    Write-Error "[ERROR] Web assets build folder was not found at: $WebFolder"
    exit 1
}
Write-Host "[SUCCESS] Vite frontend compiled successfully." -ForegroundColor Green

# 4. Verify auxiliary binaries
Write-Host "`n=== VERIFYING BINARIES ===" -ForegroundColor Yellow
if (!(Test-Path $BinFolder)) {
    New-Item -ItemType Directory -Path $BinFolder -Force | Out-Null
}
$FfmpegPath = Join-Path $BinFolder "ffmpeg.exe"
$FfprobePath = Join-Path $BinFolder "ffprobe.exe"

if (!(Test-Path $FfmpegPath) -or !(Test-Path $FfprobePath)) {
    Write-Warning "[WARNING] Local FFmpeg or FFprobe was not found under: $BinFolder"
    Write-Warning "Please run 'python download_binaries.py' to download them for local packaging."
} else {
    Write-Host "[SUCCESS] FFmpeg and FFprobe binaries are present in bin/ folder." -ForegroundColor Green
}

# 5. Run PyInstaller
Write-Host "`n=== COMPILING BACKEND VIA PYINSTALLER ===" -ForegroundColor Yellow
$VenvPython = Join-Path $VenvPath "Scripts\python.exe"
if (!(Test-Path $VenvPython)) {
    $VenvPython = "python"
}

# Check if PyInstaller is installed
& $VenvPython -c "import PyInstaller" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[INFO] PyInstaller is not installed in the virtual environment. Installing..." -ForegroundColor Cyan
    & $VenvPython -m pip install pyinstaller
}

Write-Host "[INFO] Running PyInstaller..." -ForegroundColor Cyan
& $VenvPython -m PyInstaller --noconfirm (Join-Path $RootFolder "renderflow_studio.spec")

$ExePath = Join-Path $DistFolder "RenderFlowStudio\RenderFlowStudio.exe"
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
    
    $InstallerPath = Join-Path $RootFolder "installer\RenderFlowStudio_Setup.exe"
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
