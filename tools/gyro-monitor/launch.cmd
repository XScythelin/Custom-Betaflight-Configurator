@echo off
rem ASCII filename allows launching independently of the Windows console code page.
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" com_tools.py gyro_live.py
) else (
  python com_tools.py gyro_live.py
)
if errorlevel 1 pause
