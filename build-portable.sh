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

echo "  ✓ Backend skopiowany (zaleznosci zainstaluje INSTALUJ.bat na Windows)"

# 5. Kopiuj pliki portable
echo "📁 [5/5] Kopiowanie plikow uruchomieniowych..."
cp portable/start-kappa.bat "$OUTPUT_DIR/"
cp portable/zainstaluj-skrot.bat "$OUTPUT_DIR/"
cp portable/generuj-ikone.bat "$OUTPUT_DIR/"
cp portable/INSTALUJ.bat "$OUTPUT_DIR/"

# Kopiuj README
cp portable/README-PORTABLE.txt "$OUTPUT_DIR/README.txt"

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║  ✓ Paczka portable zbudowana w: $OUTPUT_DIR/             ║"
echo "║                                                           ║"
echo "║  Nastepne kroki:                                          ║"
echo "║  1. Skopiuj folder $OUTPUT_DIR na dysk sieciowy          ║"
echo "║  2. Kazdy uzytkownik klika INSTALUJ.bat (raz)            ║"
echo "║     -> Wszystko pobierze sie i skonfiguruje samo!        ║"
echo "║  3. Potem uzywac skrotu 'Kappa Plannung' na pulpicie    ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
