@echo off
setlocal
chcp 65001 >nul
set "PYTHONUTF8=1"
set "SCRIPT_DIR=%~dp0"
set "SITE_DIR=%SCRIPT_DIR%.."
set "PYTHON_EXE=%SITE_DIR%\.venv\Scripts\python.exe"

if exist "%PYTHON_EXE%" (
  "%PYTHON_EXE%" "%SCRIPT_DIR%ajouter_film.py" %*
) else (
  py -3 "%SCRIPT_DIR%ajouter_film.py" %*
)

echo.
pause
