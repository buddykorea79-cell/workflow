@echo off
cd /d "%~dp0"
if not exist "node_modules\next\dist\bin\next" (
  echo Please run npm install in this folder first.
  pause
  exit /b 1
)
echo Starting Ieum at http://127.0.0.1:3000
echo Keep this window open while using the app. Press Ctrl+C to stop.
if exist ".next\BUILD_ID" (
  call npm start
) else (
  call npm run dev
)
pause
