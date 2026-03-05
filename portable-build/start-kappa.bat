@echo off
title Kappa Plannung
setlocal enabledelayedexpansion

set "APP_DIR=%~dp0"
set "NODE_DIR=%APP_DIR%node"
set "NODE_EXE=%NODE_DIR%\node.exe"
set "LOCK_FILE=%APP_DIR%server.lock"
set "PORT=3001"
set "NODE_VERSION=v20.11.1"
set "NODE_ZIP=node-%NODE_VERSION%-win-x64.zip"
set "NODE_URL=https://nodejs.org/dist/%NODE_VERSION%/%NODE_ZIP%"

echo.
echo  ========================================
echo    KAPPA PLANNUNG v1.0
echo    DRAXLMAIER
echo  ========================================
echo.

:: ============================================
:: KROK 1: NODE.JS - pobierz jesli brak
:: ============================================
if exist "%NODE_EXE%" goto :check_modules

echo  Pierwsze uruchomienie - pobieram Node.js...
echo  (ok. 30 MB - moze chwile potrwac)
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; ^
   $ProgressPreference = 'SilentlyContinue'; ^
   try { ^
     Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%APP_DIR%%NODE_ZIP%' -UseBasicParsing; ^
     Write-Host '  Pobrano. Rozpakowywanie...' ^
   } catch { ^
     Write-Host '[BLAD] Nie udalo sie pobrac Node.js'; ^
     Write-Host $_.Exception.Message; ^
     exit 1 ^
   }"
if !errorlevel! neq 0 goto :node_error

if not exist "%NODE_DIR%" mkdir "%NODE_DIR%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference = 'SilentlyContinue'; ^
   Expand-Archive -Path '%APP_DIR%%NODE_ZIP%' -DestinationPath '%APP_DIR%_tmp' -Force; ^
   $d = Get-ChildItem '%APP_DIR%_tmp' | Select-Object -First 1; ^
   Copy-Item (Join-Path $d.FullName '*') '%NODE_DIR%' -Recurse -Force; ^
   Remove-Item '%APP_DIR%_tmp' -Recurse -Force"
if !errorlevel! neq 0 goto :node_error

del "%APP_DIR%%NODE_ZIP%" 2>nul

if not exist "%NODE_EXE%" goto :node_error
echo  Node.js zainstalowany.
echo.

:: ============================================
:: KROK 2: ZALEZNOSCI - zainstaluj jesli brak
:: ============================================
:check_modules
if exist "%APP_DIR%backend\node_modules\express" goto :check_server

echo  Instaluje zaleznosci (jednorazowo)...
cd /d "%APP_DIR%backend"
"%NODE_DIR%\npm.cmd" install --production >nul 2>nul
if !errorlevel! neq 0 (
    echo  [BLAD] Instalacja zaleznosci nie powiodla sie.
    pause
    exit /b 1
)
cd /d "%APP_DIR%"
echo  Zaleznosci zainstalowane.
echo.

:: ============================================
:: KROK 3: SPRAWDZ CZY SERWER JUZ DZIALA
:: ============================================
:check_server
if not exist "%LOCK_FILE%" goto :start_server

set /p SERVER_IP=<"%LOCK_FILE%"
echo  Sprawdzam serwer na !SERVER_IP!...

"%NODE_EXE%" -e "const h=require('http');h.get('http://!SERVER_IP!:%PORT%/api/health',{timeout:3000},r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1)).on('timeout',function(){this.destroy();process.exit(1)})" 2>nul

if !errorlevel! equ 0 (
    echo  Serwer dziala - otwieram przegladarke.
    start "" "http://!SERVER_IP!:%PORT%"
    timeout /t 2 >nul
    exit /b 0
)

echo  Serwer nie odpowiada - uruchamiam nowy.
del "%LOCK_FILE%" 2>nul

:: ============================================
:: KROK 4: URUCHOM SERWER
:: ============================================
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
"%NODE_EXE%" -e "const h=require('http');h.get('http://localhost:%PORT%/api/health',{timeout:2000},r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1)).on('timeout',function(){this.destroy();process.exit(1)})" 2>nul
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
"%NODE_EXE%" -e "const h=require('http');h.get('http://localhost:%PORT%/api/health',{timeout:2000},()=>{process.exit(0)}).on('error',()=>process.exit(1)).on('timeout',function(){this.destroy();process.exit(1)})" 2>nul
if !errorlevel! equ 0 goto keep_alive

del "%LOCK_FILE%" 2>nul
echo  Serwer zatrzymany.
timeout /t 2 >nul
exit /b 0

:node_error
echo.
echo  [BLAD] Nie udalo sie zainstalowac Node.js.
echo  Sprawdz polaczenie z internetem lub popros
echo  administratora o pomoc.
echo.
pause
exit /b 1
