@echo off
setlocal
set "KEEL_USER_DATA_PATH=%~dp0.local-profile"
if not exist "%~dp0out\Keel-win32-x64\Keel.exe" (
    echo Build the application first: npm run package
    exit /b 1
)
start "" "%~dp0out\Keel-win32-x64\Keel.exe"
