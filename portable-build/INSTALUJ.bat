@echo off
chcp 65001 >nul 2>nul
title Kappa Plannung - Instalacja
setlocal enabledelayedexpansion

set "APP_DIR=%~dp0"
set "NODE_DIR=%APP_DIR%node"
set "NODE_EXE=%NODE_DIR%\node.exe"
set "NODE_VERSION=v20.11.1"
set "NODE_ZIP=node-%NODE_VERSION%-win-x64.zip"
set "NODE_URL=https://nodejs.org/dist/%NODE_VERSION%/%NODE_ZIP%"
set "SHORTCUT=%USERPROFILE%\Desktop\Kappa Plannung.lnk"
set "ICON_PATH=%APP_DIR%kappa.ico"

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║                                          ║
echo  ║   KAPPA PLANNUNG - Instalacja            ║
echo  ║   DRAXLMAIER Group                       ║
echo  ║                                          ║
echo  ╚══════════════════════════════════════════╝
echo.
echo  Ten instalator:
echo    1. Pobierze Node.js (jesli potrzeba)
echo    2. Zainstaluje zaleznosci
echo    3. Wygeneruje ikone
echo    4. Utworzy skrot na pulpicie
echo.
echo  Nacisnij dowolny klawisz aby rozpoczac...
pause >nul

:: ============================================
:: KROK 1: NODE.JS PORTABLE
:: ============================================
echo.
echo  [1/4] Sprawdzam Node.js...

if exist "%NODE_EXE%" (
    echo         Node.js juz zainstalowany. OK
    goto :step2
)

echo         Pobieram Node.js %NODE_VERSION% ...
echo         (ok. 30 MB - moze chwile potrwac)
echo.

:: Pobierz ZIP za pomoca PowerShell
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; ^
   $ProgressPreference = 'SilentlyContinue'; ^
   try { ^
     Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%APP_DIR%%NODE_ZIP%' -UseBasicParsing; ^
     Write-Host '         Pobrano pomyslnie.' ^
   } catch { ^
     Write-Host '  [BLAD] Nie udalo sie pobrac Node.js:'; ^
     Write-Host $_.Exception.Message; ^
     exit 1 ^
   }"

if !errorlevel! neq 0 (
    echo.
    echo  [BLAD] Pobieranie nie powiodlo sie.
    echo  Sprawdz polaczenie z internetem lub pobierz recznie:
    echo  %NODE_URL%
    echo  Rozpakuj zawartosc do folderu: %NODE_DIR%\
    pause
    exit /b 1
)

:: Rozpakuj za pomoca PowerShell
echo         Rozpakowywanie...
if not exist "%NODE_DIR%" mkdir "%NODE_DIR%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference = 'SilentlyContinue'; ^
   try { ^
     Expand-Archive -Path '%APP_DIR%%NODE_ZIP%' -DestinationPath '%APP_DIR%_node_tmp' -Force; ^
     $extracted = Get-ChildItem '%APP_DIR%_node_tmp' ^| Select-Object -First 1; ^
     Copy-Item -Path (Join-Path $extracted.FullName '*') -Destination '%NODE_DIR%' -Recurse -Force; ^
     Remove-Item '%APP_DIR%_node_tmp' -Recurse -Force; ^
     Write-Host '         Rozpakowano pomyslnie.' ^
   } catch { ^
     Write-Host '  [BLAD] Rozpakowywanie nie powiodlo sie:'; ^
     Write-Host $_.Exception.Message; ^
     exit 1 ^
   }"

if !errorlevel! neq 0 (
    echo  [BLAD] Nie udalo sie rozpakowac Node.js.
    pause
    exit /b 1
)

:: Usun pobrany ZIP
del "%APP_DIR%%NODE_ZIP%" 2>nul

:: Weryfikacja
if not exist "%NODE_EXE%" (
    echo  [BLAD] node.exe nie znaleziony po rozpakowaniu.
    pause
    exit /b 1
)

echo         Node.js zainstalowany. OK
echo.

:: ============================================
:: KROK 2: ZALEZNOSCI NPM
:: ============================================
:step2
echo  [2/4] Sprawdzam zaleznosci...

if exist "%APP_DIR%backend\node_modules\express" (
    echo         Zaleznosci juz zainstalowane. OK
    goto :step3
)

echo         Instaluje zaleznosci backendu...
echo         (to moze potrwac ok. 30 sekund)

cd /d "%APP_DIR%backend"
"%NODE_DIR%\npm.cmd" install --production 2>nul

if !errorlevel! neq 0 (
    echo  [BLAD] Instalacja zaleznosci nie powiodla sie.
    pause
    exit /b 1
)
cd /d "%APP_DIR%"
echo         Zaleznosci zainstalowane. OK
echo.

:: ============================================
:: KROK 3: GENEROWANIE IKONY
:: ============================================
:step3
echo  [3/4] Generuje ikone...

if exist "%ICON_PATH%" (
    echo         Ikona juz istnieje. OK
    goto :step4
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Add-Type -AssemblyName System.Drawing; ^
   $size = 256; ^
   $bmp = New-Object System.Drawing.Bitmap($size, $size); ^
   $g = [System.Drawing.Graphics]::FromImage($bmp); ^
   $g.SmoothingMode = 'HighQuality'; ^
   $g.TextRenderingHint = 'AntiAliasGridFit'; ^
   $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0, 82, 147)); ^
   $g.FillRectangle($bgBrush, 0, 0, $size, $size); ^
   $font = New-Object System.Drawing.Font('Segoe UI', 72, [System.Drawing.FontStyle]::Bold); ^
   $sf = New-Object System.Drawing.StringFormat; ^
   $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'; ^
   $rect = New-Object System.Drawing.RectangleF(0, 10, $size, $size); ^
   $shadow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(80, 0, 0, 0)); ^
   $sRect = New-Object System.Drawing.RectangleF(3, 13, $size, $size); ^
   $g.DrawString('KP', $font, $shadow, $sRect, $sf); ^
   $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White); ^
   $g.DrawString('KP', $font, $white, $rect, $sf); ^
   $sf2 = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Regular); ^
   $r2 = New-Object System.Drawing.RectangleF(0, 180, $size, 60); ^
   $g.DrawString('PLANNUNG', $sf2, $white, $r2, $sf); ^
   $g.Dispose(); ^
   $bmp.Save('%ICON_PATH%', [System.Drawing.Imaging.ImageFormat]::Png); ^
   $bmp.Dispose()" 2>nul

if exist "%ICON_PATH%" (
    echo         Ikona wygenerowana. OK
) else (
    echo         [Uwaga] Ikona nie wygenerowana - skrot bedzie bez ikony.
)
echo.

:: ============================================
:: KROK 4: SKROT NA PULPICIE
:: ============================================
:step4
echo  [4/4] Tworzenie skrotu na pulpicie...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $sc = $ws.CreateShortcut('%SHORTCUT%'); ^
   $sc.TargetPath = '%APP_DIR%start-kappa.bat'; ^
   $sc.WorkingDirectory = '%APP_DIR%'; ^
   if (Test-Path '%ICON_PATH%') { $sc.IconLocation = '%ICON_PATH%' }; ^
   $sc.Description = 'Kappa Plannung - DRAXLMAIER'; ^
   $sc.WindowStyle = 1; ^
   $sc.Save()"

if exist "%SHORTCUT%" (
    echo         Skrot utworzony. OK
) else (
    echo         [Uwaga] Nie udalo sie utworzyc skrotu.
    echo         Mozesz uruchomic aplikacje klikajac start-kappa.bat
)

:: ============================================
:: GOTOWE!
:: ============================================
echo.
echo  ╔══════════════════════════════════════════╗
echo  ║                                          ║
echo  ║   INSTALACJA ZAKONCZONA!                 ║
echo  ║                                          ║
echo  ║   Kliknij ikone "Kappa Plannung"         ║
echo  ║   na pulpicie aby uruchomic aplikacje.   ║
echo  ║                                          ║
echo  ╚══════════════════════════════════════════╝
echo.
pause
