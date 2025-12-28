@echo off
setlocal

REM Build single-file EXE (PyInstaller) for hotkey-ws
REM - Creates venv if missing
REM - Activates venv
REM - Installs requirements.txt
REM - Installs pyinstaller
REM - Builds onefile/windowed exe with icon hotkey_ws.ico

cd /d "%~dp0"

set "VENV_DIR=venv"
set "PYTHON_IN_VENV=%VENV_DIR%\Scripts\python.exe"

if not exist "%PYTHON_IN_VENV%" (
  echo [build] venv not found. Creating venv...
  python -m venv "%VENV_DIR%"
  if errorlevel 1 (
    echo [build] ERROR: failed to create venv. Ensure Python is installed and on PATH.
    exit /b 1
  )
)

echo [build] Activating venv...
call "%VENV_DIR%\Scripts\activate.bat"
if errorlevel 1 (
  echo [build] ERROR: failed to activate venv.
  exit /b 1
)

echo [build] Upgrading pip...
python -m pip install --upgrade pip
if errorlevel 1 exit /b 1

echo [build] Installing requirements...
pip install -r requirements.txt
if errorlevel 1 exit /b 1

echo [build] Installing pyinstaller...
pip install pyinstaller
if errorlevel 1 exit /b 1

echo [build] Cleaning previous build outputs...
if exist "dist" rmdir /s /q "dist"
if exist "build" rmdir /s /q "build"
if exist "hotkey-ws.spec" del /q "hotkey-ws.spec"

echo [build] Building onefile EXE...
pyinstaller --noconfirm --clean --onefile --windowed ^
  --name "hotkey-ws" ^
  --icon "hotkey_ws.ico" ^
  --add-data "hotkey_ws.ico;." ^
  "hotkey_ws_server.py"

if errorlevel 1 (
  echo [build] ERROR: pyinstaller build failed.
  exit /b 1
)

echo [build] DONE: dist\hotkey-ws.exe
endlocal


