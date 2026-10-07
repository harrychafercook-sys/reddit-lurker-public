param([Parameter(Mandatory=$true)][string]$Device, [switch]$CheckDownload)
$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $ProjectRoot
$Sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$Tools = Join-Path $Sdk 'build-tools\36.0.0'
$Platform = Join-Path $Sdk 'platforms\android-36\android.jar'
$Java = 'C:\Program Files\Android\Android Studio\jbr\bin'
$TestRoot = Join-Path $ProjectRoot 'artifacts\android-tests'
New-Item -ItemType Directory -Force -Path $TestRoot,(Join-Path $TestRoot 'classes'),(Join-Path $TestRoot 'dex') | Out-Null
function Run([string]$Exe, [string[]]$ToolArgs) { & $Exe @ToolArgs; if ($LASTEXITCODE -ne 0) { throw "$Exe failed ($LASTEXITCODE)." } }
Run (Join-Path $Tools 'aapt2.exe') @('link','-o',(Join-Path $TestRoot 'linked.apk'),'-I',$Platform,'--manifest',(Join-Path $ProjectRoot 'tests\native\AndroidSmokeManifest.xml'),'--min-sdk-version','30','--target-sdk-version','36')
$Classes = Join-Path $ProjectRoot 'android\build\classes'
Run (Join-Path $Java 'javac.exe') @('--release','8','-classpath',($Platform + ';' + $Classes),'-d',(Join-Path $TestRoot 'classes'),(Join-Path $ProjectRoot 'tests\native\AndroidSmokeTests.java'))
Run (Join-Path $Java 'jar.exe') @('cf',(Join-Path $TestRoot 'tests.jar'),'-C',(Join-Path $TestRoot 'classes'),'.')
Run (Join-Path $Tools 'd8.bat') @('--release','--min-api','30','--lib',$Platform,'--classpath',(Join-Path $ProjectRoot 'android\build\classes.jar'),'--output',(Join-Path $TestRoot 'dex'),(Join-Path $TestRoot 'tests.jar'))
Run (Join-Path $Java 'jar.exe') @('uf',(Join-Path $TestRoot 'linked.apk'),'-C',(Join-Path $TestRoot 'dex'),'classes.dex')
Run (Join-Path $Tools 'zipalign.exe') @('-f','-p','4',(Join-Path $TestRoot 'linked.apk'),(Join-Path $TestRoot 'aligned.apk'))
Run (Join-Path $Tools 'apksigner.bat') @('sign','--ks',(Join-Path $env:USERPROFILE '.android\debug.keystore'),'--ks-key-alias','androiddebugkey','--ks-pass','pass:android','--out',(Join-Path $TestRoot 'tests.apk'),(Join-Path $TestRoot 'aligned.apk'))
$Adb = Join-Path $Sdk 'platform-tools\adb.exe'
Run $Adb @('-s',$Device,'install','--no-incremental','-r',(Join-Path $TestRoot 'tests.apk'))
try {
    $TestArgs = @('-s',$Device,'shell','am','instrument','-w')
    if ($CheckDownload) { $TestArgs += @('-e','download','true') }
    $TestArgs += 'com.harry.redditlurker.tests/com.harry.redditlurker.tests.AndroidSmokeTests'
    $Output = @(& $Adb @TestArgs)
    $Output | Set-Content -LiteralPath (Join-Path $TestRoot 'result.txt')
    $Output | Write-Output
    if (($Output -join "`n") -notmatch 'PASS: installed APK') { throw 'Android smoke checks failed.' }
} finally {
    & $Adb -s $Device uninstall com.harry.redditlurker.tests | Out-Null
    & $Adb -s $Device shell am start -n com.harry.redditlurker/.MainActivity | Out-Null
}
