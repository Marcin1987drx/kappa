#!/bin/bash
set -e

echo "=== Building Kappa Plannung Electron App ==="

# 1. Build frontend
echo "[1/5] Building frontend..."
npx tsc --noEmit
npx vite build

# 2. Build backend
echo "[2/5] Building backend..."
cd backend
npx tsc
cd ..

# 3. Bundle backend & install production deps
echo "[3/5] Bundling backend..."
cd backend
node esbuild.config.js
npm install --omit=dev
cd ..

# 4. Ensure backend/data directory exists
mkdir -p backend/data

# 5. Build Electron app for Windows
echo "[5/5] Packaging Electron app for Windows..."
npx electron-builder --win --x64

echo ""
echo "=== Build complete! ==="
echo "Output: release/ directory"
ls -lh release/*.exe 2>/dev/null || echo "(Check release/ for output files)"
