@echo off
cd /d "%~dp0"
echo [Bot version] search-frontier-20261011
echo [Bot folder] %~dp0
set "AI_PROVIDER=ollama"
set "AI_ENABLED=1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local-ai.ps1"
if errorlevel 1 goto end
set "BOT_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "BOT_NODE=C:\Users\stake\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
"%BOT_NODE%" --env-file=.env index.js
:end
pause

