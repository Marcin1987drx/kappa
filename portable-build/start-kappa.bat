@echo off
title Kappa Plannung
setlocal enabledelayedexpansion
set "APP_DIR=%~dp0"
set "NODE_EXE=%APP_DIR%node\node.exe"
set "LOCK_FILE=%APP_DIR%server.lock"
set "PORT=3001"
echo.
echo  ========================================
echo    KAPPA PLANNUNG v1.0 - DRAXLMAIER
echo  ========================================
echo.
if not exist "%NODE_EXE%" (
    echo  [BLAD] Nie znaleziono node\node.exe
    echo  Sprawdz czy folder node istnieje.
    pause
    exit /b 1
)
if not exist "%APP_DIR%backend\node_modules\express" (
    echo  Instaluje zaleznosci...
    cd /d "%APP_DIR%backend"
    "%APP_DIR%node\npm.cmd" install --production
    cd /d "%APP_DIR%"
    echo  Gotowe.
    echo.
)
if not exist "%LOCK_FILE%" goto start_server
set /p SERVER_IP=<"%LOCK_FILE%"
echo  Sprawdzam serwer na !SERVER_IP!...
"%NODE_EXE%" -e "const h=require('http');h.get('http://!SERVER_IP!:%PORT%/api/health',{timeout:3000},r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))" 2>nul
if !errorlevel! equ 0 (
    echo  Serwer dziala - otwieram przegladarke.
    start "" "http://!SERVER_IP!:%PORT%"
    timeout /t 2 >nul
    exit /b 0
)
echo  Serwer nie odpowiada - uruchamiam nowy.
del "%LOCK_FILE%" 2>nul
:start_server
set "MY_IP=localhost"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do set "MY_IP=%%b"
)
echo !MY_IP!> "%LOCK_FILE%"
set "NODE_ENV=production"
cd /d "%APP_DIR%"
start /b "" "%NODE_EXE%" backend/dist/server.js
echo  Uruchamiam serwer...
set "R=0"
:wait
timeout /t 1 /nobreak >nul
set /a R+=1
"%NODE_EXE%" -e "const h=require('http');h.get('http://localhost:%PORT%/api/health',{timeout:2000},r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))" 2>nul
if !errorlevel! neq 0 if !R! lss 15 goto wait
if !R! geq 15 (
    echo  [BLAD] Serwer nie odpowiada.
    del "%LOCK_FILE%" 2>nul
    pause
    exit /b 1
)
start "" "http://!MY_IP!:%PORT%"
echo.
echo  ========================================
echo   Aplikacja dziala: http://!MY_IP!:%PORT%
echo.
echo   *** NIE ZAMYKAJ TEGO OKNA! ***
echo  ========================================
echo.
:keep_alive
timeout /t 10 /nobreak >nul
"%NODE_EXE%" -e "const h=require('http');h.get('http://localhost:%PORT%/api/health',{timeout:2000},()=>{process.exit(0)}).on('error',()=>process.exit(1))" 2>nul
if !errorlevel! equ 0 goto keep_alive
del "%LOCK_FILE%" 2>nul
echo  Serwer zatrzymany.
timeout /t 2 >nul
exit /b 0
