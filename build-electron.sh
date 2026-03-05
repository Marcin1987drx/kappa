#!/bin/bash
set -e

echo "=== Building Kappa Plannung Electron App ==="

# 1. Build frontend
echo "[1/4] Building frontend..."
npx tsc --noEmit
npx vite build

# 2. Build backend
echo "[2/4] Building backend..."
cd backend
npx tsc
cd ..

# 3. Install backend production deps
echo "[3/4] Installing backend production dependencies..."
cd backend
npm install --omit=dev
cd ..

# 4. Ensure backend/data directory exists
mkdir -p backend/data

# 5. Build Electron app for Windows
echo "[4/4] Packaging Electron app for Windows..."
npx electron-builder --win --x64

echo ""
echo "=== Build complete! ==="
echo "Output: release/ directory"
ls -lh release/*.exe 2>/dev/null || echo "(Check release/ for output files)"
