@echo off
chcp 65001 >nul 2>nul
title Kappa Plannung
setlocal enabledelayedexpansion

set "APP_DIR=%~dp0"
set "LOCK_FILE=%APP_DIR%server.lock"
set "NODE_EXE=%APP_DIR%node\node.exe"
set "PORT=3001"

echo.
echo  ╔══════════════════════════════════════╗
echo  ║       KAPPA PLANNUNG v1.0            ║
echo  ║       DRAXLMAIER                     ║
echo  ╚══════════════════════════════════════╝
echo.

:: Sprawdz czy portable Node.js jest dostepny
if not exist "%NODE_EXE%" (
    echo  Node.js nie znaleziony - uruchamiam instalator...
    echo.
    if exist "%APP_DIR%INSTALUJ.bat" (
        call "%APP_DIR%INSTALUJ.bat"
        if not exist "%NODE_EXE%" exit /b 1
    ) else (
        echo  [BLAD] Brak INSTALUJ.bat i node.exe.
        echo  Uruchom INSTALUJ.bat aby skonfigurowac aplikacje.
        pause
        exit /b 1
    )
)

:: ============================================
:: SPRAWDZ CZY SERWER JUZ DZIALA (lock file)
:: ============================================
if exist "%LOCK_FILE%" (
    :: Odczytaj IP z lock file
    set /p SERVER_IP=<"%LOCK_FILE%"

    :: Sprawdz czy serwer rzeczywiscie odpowiada
    echo  Sprawdzam czy serwer juz dziala na !SERVER_IP!:%PORT%...
    "%NODE_EXE%" -e "const http=require('http');const r=http.get('http://!SERVER_IP!:%PORT%/api/health',{timeout:3000},s=>{process.exit(s.statusCode===200?0:1)});r.on('error',()=>process.exit(1));r.on('timeout',()=>{r.destroy();process.exit(1)})" 2>nul

    if !errorlevel! equ 0 (
        echo.
        echo  ╔══════════════════════════════════════╗
        echo  ║  Serwer juz dziala na !SERVER_IP!    ║
        echo  ║  Otwieram przegladarke...            ║
        echo  ╚══════════════════════════════════════╝
        echo.
        start "" "http://!SERVER_IP!:%PORT%"
        timeout /t 3 >nul
        exit /b 0
    ) else (
        echo  Poprzedni serwer nie odpowiada. Usuwam stary lock file...
        del "%LOCK_FILE%" 2>nul
    )
)

:: ============================================
:: INSTALACJA ZALEZNOSCI (tylko za pierwszym razem)
:: ============================================
if not exist "%APP_DIR%backend\node_modules" (
    echo  Pierwsza instalacja - instaluje zaleznosci...
    echo  To moze chwile potrwac...
    echo.
    cd /d "%APP_DIR%backend"
    "%APP_DIR%node\npm.cmd" install --production 2>nul
    if !errorlevel! neq 0 (
        echo  [BLAD] Nie udalo sie zainstalowac zaleznosci.
        pause
        exit /b 1
    )
    cd /d "%APP_DIR%"
    echo  Zaleznosci zainstalowane.
    echo.
)

:: ============================================
:: URUCHOM SERWER (ten komputer jest hostem)
:: ============================================
echo  Uruchamiam serwer na tym komputerze...

:: Pobierz IP tego komputera (ostatni znaleziony IPv4)
set "MY_IP=localhost"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do (
        set "MY_IP=%%b"
    )
)

:: Zapisz IP do lock file
echo !MY_IP!> "%LOCK_FILE%"

echo  Adres serwera: !MY_IP!:%PORT%
echo.

:: Ustaw zmienne srodowiskowe
set "NODE_ENV=production"
set "PORT=%PORT%"

:: Uruchom serwer
cd /d "%APP_DIR%"
start /b "" "%NODE_EXE%" backend/dist/server.js

:: Poczekaj az serwer odpowie
echo  Czekam na uruchomienie serwera...
set "RETRIES=0"
:wait_start
timeout /t 1 /nobreak >nul
set /a RETRIES+=1
"%NODE_EXE%" -e "const http=require('http');const r=http.get('http://localhost:%PORT%/api/health',{timeout:2000},s=>{process.exit(s.statusCode===200?0:1)});r.on('error',()=>process.exit(1));r.on('timeout',()=>{r.destroy();process.exit(1)})" 2>nul
if !errorlevel! neq 0 (
    if !RETRIES! lss 15 goto wait_start
    echo  [BLAD] Serwer nie uruchomil sie w czasie 15 sekund.
    del "%LOCK_FILE%" 2>nul
    pause
    exit /b 1
)

:: Otworz przegladarke
start "" "http://!MY_IP!:%PORT%"

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║  SERWER URUCHOMIONY                         ║
echo  ║                                              ║
echo  ║  Adres: http://!MY_IP!:%PORT%               ║
echo  ║                                              ║
echo  ║  Inni uzytkownicy moga sie polaczyc         ║
echo  ║  klikajac swoj skrot "Kappa Plannung"       ║
echo  ║                                              ║
echo  ║  *** NIE ZAMYKAJ TEGO OKNA! ***             ║
echo  ║  (zamkniecie = zatrzymanie serwera)          ║
echo  ╚══════════════════════════════════════════════╝
echo.
echo  Nacisnij Ctrl+C lub zamknij okno aby zatrzymac serwer.
echo.

:: Czekaj - serwer dziala w tle
:keep_alive
timeout /t 10 /nobreak >nul

:: Sprawdz czy serwer jeszcze zyje
"%NODE_EXE%" -e "const http=require('http');const r=http.get('http://localhost:%PORT%/api/health',{timeout:2000},s=>{process.exit(0)});r.on('error',()=>process.exit(1));r.on('timeout',()=>{r.destroy();process.exit(1)})" 2>nul
if !errorlevel! equ 0 goto keep_alive

:: Serwer zakonczyl prace
:cleanup
echo.
echo  Serwer zatrzymany. Sprzatam...
del "%LOCK_FILE%" 2>nul
echo  Gotowe. Do zobaczenia!
timeout /t 3 >nul
exit /b 0
