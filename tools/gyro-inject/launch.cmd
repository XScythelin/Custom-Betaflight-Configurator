@echo off
setlocal
cd /d "%~dp0"
set PYTHONUTF8=1
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" build\gyro_inject.py
) else if exist "..\gyro-monitor\.venv\Scripts\python.exe" (
  "..\gyro-monitor\.venv\Scripts\python.exe" build\gyro_inject.py
) else (
  python build\gyro_inject.py
)
pause
