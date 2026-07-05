@echo off
REM Double-click to start the local AI CORS proxy for CircuiTikZ-Designer.
REM Leave this window open while you use the in-app AI chat / Detect-from-image.
cd /d "%~dp0"
echo Starting AI CORS proxy on http://localhost:8787 ...
echo In Settings - AI Provider, set Base URL = http://localhost:8787/v1
echo (Keep this window open. Close it to stop the proxy.)
echo.
node scripts\ai-proxy.mjs
echo.
echo Proxy stopped. Press any key to close.
pause >nul
