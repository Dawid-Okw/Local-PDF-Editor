@echo off
rem  One-time setup for Folio PDF Editor:
rem  creates a private Python environment, installs PyMuPDF and adds the desktop shortcut.
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Creating Python environment...
  py -3 -m venv .venv 2>nul || python -m venv .venv
  if errorlevel 1 (
    echo.
    echo Python 3.10+ is required. Install it from https://www.python.org/downloads/ and run Setup.bat again.
    pause
    exit /b 1
  )
)

echo Installing dependencies...
".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
".venv\Scripts\python.exe" -m pip install -r requirements.txt || goto :fail

if not exist "assets\icon.ico" ".venv\Scripts\python.exe" scripts\make_icon.py

echo Creating shortcuts...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\create_shortcut.ps1" || goto :fail

echo.
echo Done! Double-click "Folio PDF Editor" on your desktop to start editing.
pause
exit /b 0

:fail
echo.
echo Setup failed - see the messages above.
pause
exit /b 1
