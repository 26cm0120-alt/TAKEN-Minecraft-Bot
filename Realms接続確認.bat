@echo off
cd /d "%~dp0"
set "BOT_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "BOT_NODE=C:\Users\stake\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
"%BOT_NODE%" --env-file=.env index.js
pause
