@echo off
chcp 65001 >nul 2>nul
setlocal enabledelayedexpansion

set "APP_DIR=%~dp0"
set "APP_BAT=%APP_DIR%start-kappa.bat"
set "APP_ICON=%APP_DIR%kappa.ico"
set "SHORTCUT=%USERPROFILE%\Desktop\Kappa Plannung.lnk"

echo.
echo  ╔══════════════════════════════════════╗
echo  ║  Instalator skrotu Kappa Plannung    ║
echo  ╚══════════════════════════════════════╝
echo.

:: Sprawdz czy istnieje start-kappa.bat
if not exist "%APP_BAT%" (
    echo  [BLAD] Nie znaleziono start-kappa.bat
    echo  Upewnij sie ze uruchamiasz ten skrypt z folderu aplikacji.
    pause
    exit /b 1
)

:: Sprawdz czy skrot juz istnieje
if exist "%SHORTCUT%" (
    echo  Skrot juz istnieje na pulpicie.
    set /p OVERWRITE="  Czy chcesz go nadpisac? (T/N): "
    if /i not "!OVERWRITE!"=="T" (
        echo  Anulowano.
        pause
        exit /b 0
    )
)

:: Generuj ikone jesli nie istnieje
if not exist "%APP_ICON%" (
    echo  Generuje ikone aplikacji...
    call "%APP_DIR%generuj-ikone.bat" 2>nul
)

:: Tworzenie skrotu za pomoca PowerShell
echo  Tworzenie skrotu na pulpicie...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $sc = $ws.CreateShortcut('%SHORTCUT%'); ^
   $sc.TargetPath = '%APP_BAT%'; ^
   $sc.WorkingDirectory = '%APP_DIR%'; ^
   if (Test-Path '%APP_ICON%') { $sc.IconLocation = '%APP_ICON%' }; ^
   $sc.Description = 'Kappa Plannung - DRAXLMAIER'; ^
   $sc.WindowStyle = 1; ^
   $sc.Save()"

if exist "%SHORTCUT%" (
    echo.
    echo  ╔══════════════════════════════════════╗
    echo  ║  Skrot utworzony na pulpicie!         ║
    echo  ║                                      ║
    echo  ║  Kliknij ikone "Kappa Plannung"      ║
    echo  ║  na pulpicie aby uruchomic.          ║
    echo  ╚══════════════════════════════════════╝
) else (
    echo  [BLAD] Nie udalo sie utworzyc skrotu.
    echo  Sprobuj umiescic skrot recznie:
    echo  Kliknij PPM na start-kappa.bat -^> Wyslij do -^> Pulpit
)
echo.
pause
