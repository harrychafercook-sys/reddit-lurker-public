param(
    [string]$SdkRoot = $env:ANDROID_SDK_ROOT,
    [string]$JavaHome = 'C:\Program Files\Android\Android Studio\jbr',
    [string]$Keystore = (Join-Path $env:USERPROFILE '.android\debug.keystore'),
    [ValidatePattern('^\d{1,4}\.\d{1,2}\.\d{1,2}$')][string]$Version,
    [switch]$Install,
    [string]$Device
)
$ErrorActionPreference = 'Stop'
function Run-Tool([string]$Exe, [string[]]$ToolArgs) {
    & $Exe @ToolArgs
    if ($LASTEXITCODE -ne 0) { throw "$Exe failed ($LASTEXITCODE)" }
}
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$AndroidDir = Join-Path $ProjectRoot 'android'
$BuildDir = [IO.Path]::GetFullPath((Join-Path $AndroidDir 'build'))
$OutputDir = Join-Path $ProjectRoot 'artifacts'
if (!$SdkRoot) { $SdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$BuildTools = Join-Path $SdkRoot 'build-tools\36.0.0'
$PlatformJar = Join-Path $SdkRoot 'platforms\android-36\android.jar'
$Aapt = Join-Path $BuildTools 'aapt2.exe'
$D8 = Join-Path $BuildTools 'd8.bat'
$Zipalign = Join-Path $BuildTools 'zipalign.exe'
$Signer = Join-Path $BuildTools 'apksigner.bat'
$Javac = Join-Path $JavaHome 'bin\javac.exe'
$Jar = Join-Path $JavaHome 'bin\jar.exe'
foreach ($Path in @($Aapt, $D8, $Zipalign, $Signer, $Javac, $Jar, $PlatformJar, $Keystore)) {
    if (!(Test-Path -LiteralPath $Path)) { throw "Missing Android build requirement: $Path" }
}
# Resolve and verify the exact generated directory before recursive cleanup.
if ($BuildDir -ne [IO.Path]::GetFullPath((Join-Path $ProjectRoot 'android\build'))) { throw 'Unsafe build directory' }
if (Test-Path -LiteralPath $BuildDir) {
    $Item = Get-Item -LiteralPath $BuildDir -Force
    if ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Build directory must not be a link' }
    if ((Resolve-Path -LiteralPath $BuildDir).Path -ne $BuildDir) { throw 'Unexpected resolved build path' }
    Remove-Item -LiteralPath $BuildDir -Recurse -Force
}
$Folders = @('gen', 'classes', 'dex', 'assets', 'res\drawable')
foreach ($Folder in $Folders) { New-Item -ItemType Directory -Force -Path (Join-Path $BuildDir $Folder) | Out-Null }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Push-Location $ProjectRoot
$PreviousJava = $env:JAVA_HOME
try {
    $env:JAVA_HOME = $JavaHome
    $Package = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
    if (!$Version) { $Version = $Package.version }
    Run-Tool 'npm.cmd' @('run', 'build')
    $VersionParts = $Version.Split('.')
    $VersionCode = [int]$VersionParts[0] * 10000 + [int]$VersionParts[1] * 100 + [int]$VersionParts[2]
    Copy-Item -Path (Join-Path $AndroidDir 'assets\*') -Destination (Join-Path $BuildDir 'assets') -Recurse -Force
    $WebAssets = Join-Path $BuildDir 'assets\www'
    New-Item -ItemType Directory -Path $WebAssets | Out-Null
    # PHP runs on the server; only the complete static app shell goes in the APK.
    foreach ($File in Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'dist') -Recurse -File -Force) {
        $Relative = [IO.Path]::GetRelativePath((Join-Path $ProjectRoot 'dist'), $File.FullName)
        if ($Relative -match '^api[\\/]' -or $Relative -in @('sw.js', '.nojekyll')) { continue }
        $Destination = Join-Path $WebAssets $Relative
        New-Item -ItemType Directory -Force -Path (Split-Path $Destination -Parent) | Out-Null
        Copy-Item -LiteralPath $File.FullName -Destination $Destination
    }
    $NativeHtml = Join-Path $WebAssets 'index.html'
    $Html = [IO.File]::ReadAllText($NativeHtml).Replace('<head>', '<head><script>window.__REDDIT_LURKER_NATIVE__=true;</script>')
    [IO.File]::WriteAllText($NativeHtml, $Html, [Text.UTF8Encoding]::new($false))
    Copy-Item -Path (Join-Path $AndroidDir 'res\*') -Destination (Join-Path $BuildDir 'res') -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $ProjectRoot 'icons\icon-circular-192x192.png') -Destination (Join-Path $BuildDir 'res\drawable\icon.png')
    $Resources = Join-Path $BuildDir 'resources.zip'
    $Linked = Join-Path $BuildDir 'linked.apk'
    Run-Tool $Aapt @('compile', '--dir', (Join-Path $BuildDir 'res'), '-o', $Resources)
    Run-Tool $Aapt @('link', '-o', $Linked, '-I', $PlatformJar, '--manifest', (Join-Path $AndroidDir 'AndroidManifest.xml'),
        '--java', (Join-Path $BuildDir 'gen'), '--min-sdk-version', '30',
        '--target-sdk-version', '36', '--version-code', "$VersionCode", '--version-name', $Version, $Resources)
    $Sources = @(Get-ChildItem -LiteralPath (Join-Path $AndroidDir 'src'), (Join-Path $BuildDir 'gen') -Recurse -Filter '*.java' | Select-Object -ExpandProperty FullName)
    $SourcesFile = Join-Path $BuildDir 'sources.txt'
    $Sources | ForEach-Object { '"' + $_.Replace('\', '/') + '"' } | Set-Content -LiteralPath $SourcesFile -Encoding utf8
    Run-Tool $Javac @('-encoding', 'UTF-8', '--release', '8', '-classpath', $PlatformJar, '-d', (Join-Path $BuildDir 'classes'), "@$SourcesFile")
    $ClassesJar = Join-Path $BuildDir 'classes.jar'
    Run-Tool $Jar @('cf', $ClassesJar, '-C', (Join-Path $BuildDir 'classes'), '.')
    Run-Tool $D8 @('--release', '--min-api', '30', '--lib', $PlatformJar, '--output', (Join-Path $BuildDir 'dex'), $ClassesJar)
    Run-Tool $Jar @('uf', $Linked, '-C', (Join-Path $BuildDir 'dex'), 'classes.dex')
    # aapt2 36 on Windows emits backslashes for nested asset ZIP paths. jar
    # creates portable slash-separated names that Android AssetManager can open.
    Run-Tool $Jar @('uf', $Linked, '-C', $BuildDir, 'assets')
    $Aligned = Join-Path $BuildDir 'aligned.apk'
    Run-Tool $Zipalign @('-f', '-p', '4', $Linked, $Aligned)
    $OutputApk = Join-Path $OutputDir ('Reddit-Lurker-' + $Version + '.apk')
    Run-Tool $Signer @('sign', '--ks', $Keystore, '--ks-key-alias', 'androiddebugkey', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', $OutputApk, $Aligned)
    Run-Tool $Signer @('verify', '--verbose', $OutputApk)
    $Archive = [IO.Compression.ZipFile]::OpenRead($OutputApk)
    try {
        if (@($Archive.Entries | Where-Object { $_.FullName.Contains('\') }).Count) { throw 'APK contains non-portable asset paths' }
        if (!$Archive.GetEntry('assets/www/index.html')) { throw 'APK has no local app shell' }
        $AssetRoot = Join-Path $BuildDir 'assets'
        $Count = 0
        foreach ($File in Get-ChildItem -LiteralPath $AssetRoot -Recurse -File -Force) {
            $Relative = [IO.Path]::GetRelativePath($AssetRoot, $File.FullName).Replace('\', '/')
            $Entry = $Archive.GetEntry('assets/' + $Relative)
            if (!$Entry) { throw "Missing native support asset: $Relative" }
            $Stream = $Entry.Open()
            try { $PackagedHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Stream)) }
            finally { $Stream.Dispose() }
            if ($PackagedHash -ne (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash) { throw "Packaged asset differs: $Relative" }
            $Count++
        }
        Write-Host "Verified $Count packaged assets; HTML, CSS and JavaScript load from the APK."
    } finally { $Archive.Dispose() }
    Write-Host "Built $OutputApk"
    $Update = [ordered]@{
        versionCode = $VersionCode
        versionName = $Version
        url = 'https://english-grammar-homework.com/rlurker-downloads/' + [IO.Path]::GetFileName($OutputApk)
        sha256 = (Get-FileHash -LiteralPath $OutputApk -Algorithm SHA256).Hash.ToLowerInvariant()
        size = (Get-Item -LiteralPath $OutputApk).Length
    }
    [IO.File]::WriteAllText((Join-Path $OutputDir ('update-' + $Version + '.json')), ($Update | ConvertTo-Json) + "`n", [Text.UTF8Encoding]::new($false))
    if ($Install) {
        if (!$Device) { throw 'Pass -Device with the authorized adb serial to install' }
        $Adb = Join-Path $SdkRoot 'platform-tools\adb.exe'
        Run-Tool $Adb @('-s', $Device, 'install', '--no-incremental', '-r', $OutputApk)
        Run-Tool $Adb @('-s', $Device, 'shell', 'am', 'start', '-n', 'com.harry.redditlurker/.MainActivity')
    }
} finally {
    $env:JAVA_HOME = $PreviousJava
    Pop-Location
}
