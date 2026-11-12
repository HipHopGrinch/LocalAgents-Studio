@echo off
cd /d "%~dp0"
title LocalAgents Studio - Build EXE

echo Installing dependencies...
call npm install
if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
)

echo Typechecking...
call npm run typecheck
if errorlevel 1 (
  echo Typecheck failed.
  pause
  exit /b 1
)

echo Running tests...
call npm test
if errorlevel 1 (
  echo Tests failed.
  pause
  exit /b 1
)

echo Building UI + packaging Windows EXE...
call npm run dist
if errorlevel 1 (
  echo Package failed.
  pause
  exit /b 1
)

echo.
echo Done. Outputs in the release\ folder:
echo   - LocalAgents Studio-*-portable.exe  (self-contained, no install)
echo   - LocalAgents Studio-*-setup.exe     (NSIS installer)
echo.
explorer release
pause
