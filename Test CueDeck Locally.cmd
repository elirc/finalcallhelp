@echo off
setlocal
cd /d "%~dp0cuedeck"
set "ELECTRON_RUN_AS_NODE="

rem Start the existing local build without waiting for a development rebuild.
if not exist "node_modules\electron\dist\electron.exe" goto development
if not exist ".vite\build\main.js" goto development
if not exist ".vite\renderer\main_window\index.html" goto development

start "" "node_modules\electron\dist\electron.exe" ".vite\build\main.js"
exit /b

:development
call "%~dp0Start CueDeck.cmd"
