@echo off
chcp 65001 >nul 2>nul
echo  Generowanie ikony Kappa Plannung...

set "ICON_PATH=%~dp0kappa.ico"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Add-Type -AssemblyName System.Drawing; ^
   $size = 256; ^
   $bmp = New-Object System.Drawing.Bitmap($size, $size); ^
   $g = [System.Drawing.Graphics]::FromImage($bmp); ^
   $g.SmoothingMode = 'HighQuality'; ^
   $g.TextRenderingHint = 'AntiAliasGridFit'; ^
   ^
   $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(0, 82, 147)); ^
   $g.FillRectangle($bgBrush, 0, 0, $size, $size); ^
   ^
   $font = New-Object System.Drawing.Font('Segoe UI', 72, [System.Drawing.FontStyle]::Bold); ^
   $sf = New-Object System.Drawing.StringFormat; ^
   $sf.Alignment = 'Center'; ^
   $sf.LineAlignment = 'Center'; ^
   $rect = New-Object System.Drawing.RectangleF(0, 10, $size, $size); ^
   ^
   $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(80, 0, 0, 0)); ^
   $shadowRect = New-Object System.Drawing.RectangleF(3, 13, $size, $size); ^
   $g.DrawString('KP', $font, $shadowBrush, $shadowRect, $sf); ^
   ^
   $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White); ^
   $g.DrawString('KP', $font, $textBrush, $rect, $sf); ^
   ^
   $subFont = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Regular); ^
   $subRect = New-Object System.Drawing.RectangleF(0, 180, $size, 60); ^
   $g.DrawString('PLANNUNG', $subFont, $textBrush, $subRect, $sf); ^
   ^
   $g.Dispose(); ^
   $bmp.Save('%ICON_PATH%', [System.Drawing.Imaging.ImageFormat]::Png); ^
   $bmp.Dispose(); ^
   Write-Host '  Ikona zapisana jako kappa.ico'"

if exist "%ICON_PATH%" (
    echo  Ikona wygenerowana pomyslnie.
) else (
    echo  [UWAGA] Nie udalo sie wygenerowac ikony.
    echo  Mozesz uzyc wlasnej ikony - zapisz ja jako kappa.ico w tym folderze.
)
