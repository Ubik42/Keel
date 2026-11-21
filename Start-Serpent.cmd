@echo off
setlocal
set "KEEL_USER_DATA_PATH=%~dp0.local-profile"
if not exist "%~dp0out\Serpent-win32-x64\Serpent.exe" (
    echo Build the application first: npm run package
    exit /b 1
)
start "" "%~dp0out\Serpent-win32-x64\Serpent.exe"
