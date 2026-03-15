@echo off
title SmartConsent Guard — Backend Server
color 0A
echo.
echo  ============================================
echo   SmartConsent Guard Backend Server
echo  ============================================
echo.

REM Navigate to backend directory
cd /d "%~dp0backend"

REM Check if virtual environment exists
if not exist ".venv\Scripts\activate.bat" (
    echo [*] Creating virtual environment...
    python -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        echo         Make sure Python 3.9+ is installed and in PATH.
        pause
        exit /b 1
    )
    echo [OK] Virtual environment created.
)

REM Activate virtual environment
echo [*] Activating virtual environment...
call .venv\Scripts\activate.bat

REM Install dependencies if needed
echo [*] Installing / verifying dependencies...
pip install -r requirements.txt --quiet

echo.
echo [*] Starting FastAPI server on http://127.0.0.1:8000
echo     Press Ctrl+C to stop.
echo.

uvicorn main:app --host 127.0.0.1 --port 8000 --reload

pause
