param([Parameter(Mandatory=$true)][string]$LibraryPath)
$ErrorActionPreference='Stop'
$tool=$PSScriptRoot
$python=(Get-Command python).Source
@{python=$python;library=$LibraryPath} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $tool 'launcher.json') -Encoding utf8
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$project=Split-Path (Split-Path $tool -Parent) -Parent
& $compiler /nologo /target:exe /codepage:65001 /reference:System.Web.Extensions.dll "/win32icon:$project\assets\icons\app.ico" "/out:$tool\更新手机照片.exe" (Join-Path $tool 'Launcher.cs')
if($LASTEXITCODE -ne 0) {throw '更新入口编译失败'}
$shell=New-Object -ComObject WScript.Shell
foreach($path in @((Join-Path ([Environment]::GetFolderPath('Desktop')) '更新手机照片.lnk'),(Join-Path $LibraryPath '更新手机照片.lnk'))) {
 $shortcut=$shell.CreateShortcut($path);$shortcut.TargetPath=Join-Path $tool '更新手机照片.exe';$shortcut.WorkingDirectory=$tool;$shortcut.Description='连接手机后增量更新 Serpent 手机照片库';$shortcut.IconLocation=Join-Path $project 'assets\icons\app.ico';$shortcut.Save()
}
Write-Output (Join-Path $tool '更新手机照片.exe')
