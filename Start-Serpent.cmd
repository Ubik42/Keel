@echo off
setlocal
set "SERPENT_USER_DATA_PATH=%~dp0.local-profile"
set "SERPENT_DISTRIBUTION=development"
if not exist "%~dp0out\Serpent-win32-x64\Serpent.exe" (
    echo Build the application first: npm run package
    exit /b 1
)
start "" "%~dp0out\Serpent-win32-x64\Serpent.exe"
