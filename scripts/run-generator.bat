@echo off
REM Launched by Windows Task Scheduler at 12:00 AM Central.
REM Logs to scripts\generator.log.

cd /d "%~dp0\.."

REM Load ANTHROPIC_API_KEY from scripts\.env if present
if exist "scripts\.env" (
  for /f "usebackq tokens=1,* delims==" %%a in ("scripts\.env") do (
    if not "%%a"=="" set %%a=%%b
  )
)

echo ==== %DATE% %TIME% ==== >> scripts\generator.log
node scripts\generate-posts.mjs >> scripts\generator.log 2>&1
echo. >> scripts\generator.log
