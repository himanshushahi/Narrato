# Set TLS 1.2 for secure downloads
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

# Speed optimization: Disable progress bar rendering which slows downloads by up to 10x-50x
$ProgressPreference = 'SilentlyContinue'

# Target paths in AppData
$appdataPath = Join-Path $env:LOCALAPPDATA "RenderFlowStudio"
$binPath = Join-Path $appdataPath "bin"
$nodePath = $binPath

# Terminate any running instances of the app to prevent file lock errors during overwrite
Write-Host "Checking for running instances of RenderFlow Studio..."
Stop-Process -Name "RenderFlowStudio" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# Function to test network connectivity
function Test-InternetConnection {
    try {
        $request = [System.Net.WebRequest]::Create("https://www.google.com")
        $request.Method = "HEAD"
        $request.Timeout = 5000
        $response = $request.GetResponse()
        $response.Close()
        return $true
    } catch {
        return $false
    }
}

# Function to show Windows Form Dialog to Retry or Cancel
function Show-NoInternetDialog {
    Add-Type -AssemblyName System.Windows.Forms
    $msg = "An active internet connection is required to download and install essential application components (FFmpeg, Node.js).`n`n" +
           "Please connect to the internet and click 'Retry'.`n" +
           "Click 'Cancel' to abort the installation."
    $result = [System.Windows.Forms.MessageBox]::Show($msg, "Internet Connection Required", "RetryCancel", "Warning")
    return $result
}

# Custom chunk downloader with progress reporting
function Download-FileWithProgress {
    param (
        [string]$Uri,
        [string]$OutFile,
        [string]$Name
    )
    
    $request = [System.Net.HttpWebRequest]::Create($Uri)
    $request.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    $request.Timeout = 15000
    
    try {
        $response = $request.GetResponse()
    } catch {
        throw "Failed to connect to ${Uri}: $_"
    }
    
    $totalLength = $response.ContentLength
    $responseStream = $response.GetResponseStream()
    $targetStream = [System.IO.File]::Create($OutFile)
    
    # 100 KB buffer
    $buffer = New-Object Byte[] 102400
    $totalRead = 0
    $lastReport = 0
    
    Write-Host "Downloading $Name (Total size: $([Math]::Round($totalLength / 1MB, 1)) MB)..."
    
    try {
        while ($true) {
            $read = $responseStream.Read($buffer, 0, $buffer.Length)
            if ($read -le 0) {
                break
            }
            $targetStream.Write($buffer, 0, $read)
            $totalRead += $read
            
            if ($totalLength -gt 0) {
                $percent = [int](($totalRead / $totalLength) * 100)
                # Report every 5%
                if ($percent -ge ($lastReport + 5)) {
                    $lastReport = $percent
                    $mbRead = [Math]::Round($totalRead / 1MB, 1)
                    $mbTotal = [Math]::Round($totalLength / 1MB, 1)
                    Write-Host "  Progress: $percent% ($mbRead MB / $mbTotal MB)"
                }
            } else {
                $mbRead = [Math]::Round($totalRead / 1MB, 1)
                Write-Host "  Downloaded: $mbRead MB..."
            }
        }
    } finally {
        $targetStream.Close()
        $responseStream.Close()
        $response.Close()
    }
}

# Wrapper for download with automatic retries
function Download-FileWithProgressAndRetry {
    param (
        [string]$Uri,
        [string]$OutFile,
        [string]$Name
    )
    
    $maxAttempts = 3
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        try {
            Download-FileWithProgress -Uri $Uri -OutFile $OutFile -Name $Name
            Write-Host "[SUCCESS] Finished downloading $Name."
            return
        } catch {
            Write-Host "[WARNING] Attempt $attempt to download $Name failed: $_"
            if ($attempt -lt $maxAttempts) {
                Write-Host "Retrying in 5 seconds..."
                Start-Sleep -Seconds 5
            } else {
                throw "Failed to download $Name after $maxAttempts attempts."
            }
        }
    }
}

# 1. Network Validation Loop
Write-Host "Checking for active internet connection..."
while ($true) {
    if (Test-InternetConnection) {
        Write-Host "[SUCCESS] Active internet connection detected."
        break
    } else {
        Write-Host "[WARNING] No internet connection detected."
        $choice = Show-NoInternetDialog
        if ($choice -eq "Cancel") {
            Write-Error "[ERROR] Installation aborted due to lack of internet connection."
            exit 1
        }
    }
}

# Ensure target directories exist
New-Item -ItemType Directory -Path $appdataPath -Force | Out-Null
New-Item -ItemType Directory -Path $binPath -Force | Out-Null
New-Item -ItemType Directory -Path $nodePath -Force | Out-Null

$tempDir = [System.IO.Path]::GetTempPath()

# 2. Download and extract FFmpeg/FFprobe if they do not exist
$ffmpegExists = (Test-Path (Join-Path $binPath "ffmpeg.exe")) -and (Test-Path (Join-Path $binPath "ffprobe.exe"))
if (-not $ffmpegExists) {
    Write-Host "`n--- DOWNLOADING FFMPEG & FFPROBE ---"
    $ffmpegZip = Join-Path $tempDir "ffmpeg.zip"
    $ffmpegExtract = Join-Path $tempDir "ffmpeg_extracted"
    
    if (Test-Path $ffmpegExtract) { Remove-Item -Path $ffmpegExtract -Recurse -Force -ErrorAction SilentlyContinue }
    New-Item -ItemType Directory -Path $ffmpegExtract -Force | Out-Null
    
    try {
        Download-FileWithProgressAndRetry -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $ffmpegZip -Name "FFmpeg/FFprobe Bundle"
        
        Write-Host "Extracting FFmpeg binaries..."
        Expand-Archive -Path $ffmpegZip -DestinationPath $ffmpegExtract -Force
        
        Get-ChildItem -Path $ffmpegExtract -Filter "ffmpeg.exe" -Recurse | Copy-Item -Destination $binPath -Force
        Get-ChildItem -Path $ffmpegExtract -Filter "ffprobe.exe" -Recurse | Copy-Item -Destination $binPath -Force
        
        Write-Host "[SUCCESS] FFmpeg and FFprobe extracted to AppData: $binPath"
    } catch {
        Write-Error "[ERROR] Failed to download or extract FFmpeg: $_"
        exit 1
    } finally {
        if (Test-Path $ffmpegZip) { Remove-Item -Path $ffmpegZip -Force -ErrorAction SilentlyContinue }
        if (Test-Path $ffmpegExtract) { Remove-Item -Path $ffmpegExtract -Recurse -Force -ErrorAction SilentlyContinue }
    }
} else {
    Write-Host "[INFO] FFmpeg and FFprobe already exist in AppData. Skipping download."
}

# 2.5 Download yt-dlp if it does not exist
$ytdlpExists = Test-Path (Join-Path $binPath "yt-dlp.exe")
if (-not $ytdlpExists) {
    Write-Host "`n--- DOWNLOADING YT-DLP ---"
    $ytdlpExe = Join-Path $binPath "yt-dlp.exe"
    try {
        Download-FileWithProgressAndRetry -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile $ytdlpExe -Name "yt-dlp Binary"
        Write-Host "[SUCCESS] yt-dlp downloaded to AppData: $binPath"
    } catch {
        Write-Error "[ERROR] Failed to download yt-dlp: $_"
        exit 1
    }
} else {
    Write-Host "[INFO] yt-dlp already exists in AppData. Skipping download."
}

# 3. Download and extract portable Node.js if it does not exist
$nodeExists = Test-Path (Join-Path $nodePath "node.exe")
if (-not $nodeExists) {
    Write-Host "`n--- DOWNLOADING PORTABLE NODE.JS ---"
    $nodeZip = Join-Path $tempDir "node.zip"
    $nodeExtract = Join-Path $tempDir "node_extracted"
    
    if (Test-Path $nodeExtract) { Remove-Item -Path $nodeExtract -Recurse -Force -ErrorAction SilentlyContinue }
    New-Item -ItemType Directory -Path $nodeExtract -Force | Out-Null
    
    try {
        Download-FileWithProgressAndRetry -Uri "https://nodejs.org/dist/v20.13.1/node-v20.13.1-win-x64.zip" -OutFile $nodeZip -Name "Node.js Portable Package"
        
        Write-Host "Extracting node.exe..."
        Expand-Archive -Path $nodeZip -DestinationPath $nodeExtract -Force
        
        $nodeExeFile = Get-ChildItem -Path $nodeExtract -Filter "node.exe" -Recurse | Select-Object -First 1
        if ($nodeExeFile) {
            Copy-Item -Path $nodeExeFile.FullName -Destination (Join-Path $nodePath "node.exe") -Force
            Write-Host "[SUCCESS] node.exe extracted to: $nodePath"
        } else {
            throw "Failed to locate node.exe inside the downloaded archive."
        }
    } catch {
        Write-Error "[ERROR] Failed to download or extract Node.js: $_"
        exit 1
    } finally {
        if (Test-Path $nodeZip) { Remove-Item -Path $nodeZip -Force -ErrorAction SilentlyContinue }
        if (Test-Path $nodeExtract) { Remove-Item -Path $nodeExtract -Recurse -Force -ErrorAction SilentlyContinue }
    }
} else {
    Write-Host "[INFO] Node.js portable already exists in AppData. Skipping download."
}

Write-Host "`n[SUCCESS] All assets downloaded successfully."
exit 0
