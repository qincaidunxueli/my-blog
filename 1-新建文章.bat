@echo off
chcp 65001 >nul
cd /d "%~dp0"
node "tools\new-post.js"
if errorlevel 1 echo.
echo.
pause >nul
