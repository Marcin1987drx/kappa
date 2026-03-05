#!/bin/bash
# ==============================================
# Skrypt budujący paczkę portable Kappa Plannung
# Uruchom w katalogu głównym projektu (kappa/)
# ==============================================

set -e

echo ""
echo "╔══════════════════════════════════════╗"
echo "║  Budowanie paczki portable           ║"
echo "║  Kappa Plannung                      ║"
echo "╚══════════════════════════════════════╝"
echo ""

OUTPUT_DIR="portable-build"

# Wyczyść poprzedni build
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/node"
mkdir -p "$OUTPUT_DIR/backend/dist"
mkdir -p "$OUTPUT_DIR/backend/data"

# 1. Buduj frontend
echo "📦 [1/5] Budowanie frontendu..."
npm run build
echo "  ✓ Frontend zbudowany"

# 2. Buduj backend
echo "📦 [2/5] Budowanie backendu..."
cd backend
npm run build
cd ..
echo "  ✓ Backend zbudowany"

# 3. Kopiuj zbudowany frontend
echo "📁 [3/5] Kopiowanie frontendu..."
cp -r dist/* "$OUTPUT_DIR/dist/" 2>/dev/null || cp -r dist "$OUTPUT_DIR/"
echo "  ✓ Frontend skopiowany"

# 4. Kopiuj zbudowany backend + zaleznosci
echo "📁 [4/5] Kopiowanie backendu..."
cp -r backend/dist/* "$OUTPUT_DIR/backend/dist/"
cp backend/package.json "$OUTPUT_DIR/backend/"
cp backend/package-lock.json "$OUTPUT_DIR/backend/" 2>/dev/null || true

# Instaluj tylko produkcyjne zaleznosci
cd "$OUTPUT_DIR/backend"
npm install --omit=dev --ignore-scripts 2>/dev/null || npm install --production --ignore-scripts 2>/dev/null
cd ../..

echo "  ✓ Backend skopiowany"

# 5. Kopiuj pliki portable
echo "📁 [5/5] Kopiowanie plikow uruchomieniowych..."
cp portable/start-kappa.bat "$OUTPUT_DIR/"
cp portable/zainstaluj-skrot.bat "$OUTPUT_DIR/"
cp portable/generuj-ikone.bat "$OUTPUT_DIR/"

# Kopiuj README
cp portable/README-PORTABLE.txt "$OUTPUT_DIR/README.txt"

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  ✓ Paczka portable zbudowana w: $OUTPUT_DIR/             ║"
echo "║                                                           ║"
echo "║  Nastepne kroki:                                          ║"
echo "║  1. Pobierz Node.js portable (Windows x64):              ║"
echo "║     https://nodejs.org/dist/v20.11.1/                    ║"
echo "║     -> node-v20.11.1-win-x64.zip                         ║"
echo "║                                                           ║"
echo "║  2. Rozpakuj ZAWARTOSC folderu node-v20.11.1-win-x64     ║"
echo "║     do: $OUTPUT_DIR/node/                                 ║"
echo "║                                                           ║"
echo "║  3. Skopiuj caly folder $OUTPUT_DIR na dysk sieciowy     ║"
echo "║                                                           ║"
echo "║  4. Uzytkownicy: klikaja zainstaluj-skrot.bat (raz)      ║"
echo "║     potem uzywaja skrotu na pulpicie                      ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
