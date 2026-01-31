# 🚀 Kappaplannung 2025 - Kompletna Dokumentacja

## 📋 Spis Treści
1. [Przegląd](#przegląd)
2. [Architektura](#architektura)
3. [Funkcjonalności](#funkcjonalności)
4. [API i Struktura Danych](#api-i-struktura-danych)
5. [Deployment](#deployment)
6. [Konwersja na EXE](#konwersja-na-exe)
7. [Rozwój](#rozwój)

---

## 🎯 Przegląd

Kappaplannung to nowoczesna aplikacja webowa stworzona dla DRÄXLMAIER Group do zarządzania planowaniem tygodniowym projektów automotive. Zastępuje nieporęczne arkusze Excel profesjonalnym interfejsem z zaawansowanymi funkcjami.

### Kluczowe Cechy
- ✅ **Zero zależności serwerowych** - działa 100% lokalnie
- ✅ **Offline-first** - IndexedDB jako baza danych
- ✅ **Wielojęzyczna** - PL/DE/EN/RO out-of-the-box
- ✅ **Responsive** - działa na desktop i tablet
- ✅ **Kolorystyka DRÄXLMAIER** - zgodna z corporate identity
- ✅ **Real-time updates** - natychmiastowa aktualizacja UI

---

## 🏗️ Architektura

### Tech Stack
```
┌─────────────────────────────────────┐
│         Frontend Layer               │
│  TypeScript + HTML5 + CSS3           │
│  Vite (Build Tool)                   │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│      Application Layer               │
│  - State Management (AppState)       │
│  - Event Handlers                    │
│  - View Rendering                    │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│       Data Layer                     │
│  - IndexedDB (idb wrapper)           │
│  - Import/Export (JSON)              │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│    Visualization Layer               │
│  Chart.js (Analytics)                │
└─────────────────────────────────────┘
```

### Struktura Plików
```
src/
├── main.ts              # Entry point + Main App Class
├── types/
│   └── index.ts        # TypeScript interfaces
├── database/
│   └── index.ts        # IndexedDB wrapper + CRUD
├── i18n/
│   └── index.ts        # Translations (4 languages)
└── styles/
    └── main.css        # DRÄXLMAIER styles
```

### Data Flow
```
User Action → Event Handler → State Update → Database Write → UI Re-render
     ↑                                                              ↓
     └──────────────────────────────────────────────────────────────┘
```

---

## ⚙️ Funkcjonalności

### 1. Planning View (Widok Planowania)
**Grid tygodniowy:**
- 52 tygodnie × 2 kolumny (IST/SOLL) = 104 kolumny danych
- 4 kolumny statyczne: Kunde, Typ, Teil, Prüfung
- **Edycja inline**: Click → Input → Enter/Blur → Save
- **Auto-color coding**:
  ```typescript
  if (ist === 0) → Gray (Empty)
  else if (ist >= soll) → Green (Success)
  else if (ist >= soll * 0.5) → Orange (Warning)
  else → Red (Danger)
  ```

**Filtrowanie:**
- Customer dropdown
- Type dropdown
- Test dropdown
- Search input (full-text)

**Akcje:**
- Add Project (modal)
- Export Data (JSON download)
- Import Data (file upload)

### 2. Projects View (Zarządzanie)
**4 sekcje:**
- Customers (Kunden)
- Types (Typen)
- Parts (Teile)
- Tests (Prüfungen)

**CRUD operations:**
- ➕ Add: Modal z inputem
- ✏️ Edit: Modal z pre-filled data
- 🗑️ Delete: Confirm dialog

### 3. Analytics View (Analityka)
**Stat Cards:**
```typescript
Total Projects: count(projects)
Completed: count(weeks where ist >= soll)
Pending: count(weeks where ist < soll && week >= current)
Overdue: count(weeks where ist < soll && week < current)
```

**Charts:**
1. **Line Chart** (Weekly Progress):
   - X-axis: Weeks (KW01-KW52)
   - Y-axis: Values
   - 2 lines: IST (green) vs SOLL (blue)

2. **Doughnut Chart** (Test Distribution):
   - Sectors: Test types
   - Values: Project count per test

### 4. Settings View (Ustawienia)
**Toggles:**
- Dark Mode (default: ON)
- Animations (default: ON)
- Highlight Missing (default: ON)
- Blink Alerts (default: ON)

**Data Management:**
- Clear All Data (confirmation required)

---

## 📊 API i Struktura Danych

### Database Schema

```typescript
interface Customer {
  id: string;           // UUID
  name: string;
  createdAt: number;    // timestamp
}

interface Type {
  id: string;
  name: string;
  createdAt: number;
}

interface Part {
  id: string;
  name: string;
  createdAt: number;
}

interface Test {
  id: string;
  name: string;
  createdAt: number;
}

interface WeekData {
  ist: number;
  soll: number;
}

interface Project {
  id: string;
  customerId: string;   // FK → Customer
  typeId: string;       // FK → Type
  partId: string;       // FK → Part
  testId: string;       // FK → Test
  weeks: {
    [key: string]: WeekData;  // "KW01", "KW02", ...
  };
  createdAt: number;
  updatedAt: number;
}

interface AppSettings {
  language: 'en' | 'de' | 'pl' | 'ro';
  darkMode: boolean;
  animations: boolean;
  highlightMissing: boolean;
  blinkAlerts: boolean;
}
```

### Database Methods

```typescript
// Customers
await db.getCustomers(): Promise<Customer[]>
await db.addCustomer(customer): Promise<void>
await db.updateCustomer(customer): Promise<void>
await db.deleteCustomer(id): Promise<void>

// Types
await db.getTypes(): Promise<Type[]>
await db.addType(type): Promise<void>
await db.updateType(type): Promise<void>
await db.deleteType(id): Promise<void>

// Parts
await db.getParts(): Promise<Part[]>
await db.addPart(part): Promise<void>
await db.updatePart(part): Promise<void>
await db.deletePart(id): Promise<void>

// Tests
await db.getTests(): Promise<Test[]>
await db.addTest(test): Promise<void>
await db.updateTest(test): Promise<void>
await db.deleteTest(id): Promise<void>

// Projects
await db.getProjects(): Promise<Project[]>
await db.addProject(project): Promise<void>
await db.updateProject(project): Promise<void>
await db.deleteProject(id): Promise<void>

// Settings
await db.getSettings(): Promise<AppSettings>
await db.updateSettings(settings): Promise<void>

// Utility
await db.clearAll(): Promise<void>
await db.exportData(): Promise<string>
await db.importData(json): Promise<void>
```

---

## 🚀 Deployment

### Development
```bash
npm install
npm run dev
# → http://localhost:5173
```

### Production Build
```bash
npm run build
# Output: dist/
```

### Hosting Options

#### 1. Static Hosting (Proste)
Deploy folder `dist/` na:
- **Netlify**: Drag & drop folder
- **Vercel**: `vercel deploy`
- **GitHub Pages**: Push to gh-pages branch
- **AWS S3**: Upload + CloudFront CDN

#### 2. Własny Serwer
```bash
# Build
npm run build

# Serve with nginx
location / {
  root /var/www/kappaplannung/dist;
  try_files $uri $uri/ /index.html;
}
```

#### 3. Docker
```dockerfile
FROM nginx:alpine
COPY dist/ /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

```bash
docker build -t kappaplannung .
docker run -p 80:80 kappaplannung
```

---

## 💻 Konwersja na EXE

### Opcja A: Electron (Popularne)

#### 1. Instalacja
```bash
npm install --save-dev electron electron-builder
```

#### 2. Utworzenie `electron.js`
```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    title: 'Kappaplannung 2025',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false
    }
  });

  mainWindow.loadFile('dist/index.html');
  
  // Open DevTools in development
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
```

#### 3. Konfiguracja `package.json`
```json
{
  "name": "kappaplannung",
  "version": "1.0.0",
  "main": "electron.js",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "electron": "electron .",
    "electron:build": "npm run build && electron-builder"
  },
  "build": {
    "appId": "com.draxlmaier.kappaplannung",
    "productName": "Kappaplannung 2025",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "electron.js"
    ],
    "win": {
      "target": ["nsis"],
      "icon": "icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true
    }
  }
}
```

#### 4. Build EXE
```bash
# Build web app
npm run build

# Build Windows EXE
npm run electron:build

# Output: release/Kappaplannung Setup 1.0.0.exe
```

**Rozmiar EXE:** ~150-200 MB (zawiera Chromium)

---

### Opcja B: Tauri (Lżejsze)

#### 1. Instalacja
```bash
# Wymagania: Rust + System dependencies
npm install --save-dev @tauri-apps/cli
```

#### 2. Inicjalizacja
```bash
npx tauri init
# Follow prompts:
# - App name: Kappaplannung
# - Window title: Kappaplannung 2025
# - Web assets: ../dist
# - Dev server: http://localhost:5173
# - Before dev: npm run dev
# - Before build: npm run build
```

#### 3. Konfiguracja `src-tauri/tauri.conf.json`
```json
{
  "package": {
    "productName": "Kappaplannung",
    "version": "1.0.0"
  },
  "build": {
    "distDir": "../dist",
    "devPath": "http://localhost:5173",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "tauri": {
    "bundle": {
      "active": true,
      "identifier": "com.draxlmaier.kappaplannung",
      "icon": [
        "icons/icon.ico"
      ],
      "targets": ["msi", "nsis"]
    },
    "windows": [{
      "title": "Kappaplannung 2025",
      "width": 1600,
      "height": 900
    }]
  }
}
```

#### 4. Build EXE
```bash
npm run tauri build
# Output: src-tauri/target/release/bundle/
```

**Rozmiar EXE:** ~15-30 MB (używa system WebView)

---

### Opcja C: Neutralino.js (Najlżejsze)

**Rozmiar EXE:** ~3-5 MB
```bash
npm install -g @neutralinojs/neu
neu create kappaplannung
# Configure + Build
```

---

## 🔧 Rozwój i Customizacja

### Dodawanie Nowych Języków

1. Edytuj `src/i18n/index.ts`:
```typescript
export const translations = {
  // ...existing languages
  cs: {  // Czech
    nav: {
      planning: 'Plánování',
      // ...
    }
  }
};

export type Language = 'en' | 'de' | 'pl' | 'ro' | 'cs';
```

2. Dodaj opcję w HTML:
```html
<select id="languageSelect">
  <option value="cs">CZ</option>
</select>
```

### Customizacja Kolorów

Edytuj `src/styles/main.css`:
```css
:root {
  --color-primary: #YOUR_COLOR;
  --color-secondary: #YOUR_COLOR;
  /* ... */
}
```

### Dodawanie Nowych Pól do Projektu

1. Zaktualizuj interface w `src/types/index.ts`:
```typescript
interface Project {
  // ...existing fields
  priority?: 'low' | 'medium' | 'high';
  notes?: string;
}
```

2. Dodaj do UI w `src/main.ts`:
```typescript
private showAddProjectModal(): void {
  modalBody.innerHTML = `
    <!-- ...existing fields -->
    <div class="form-group">
      <label>Priority</label>
      <select id="projectPriority">
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
    </div>
  `;
}
```

### Backend Integration (Future)

Przykład REST API wrapper:
```typescript
// src/api/index.ts
class ApiClient {
  private baseUrl = 'https://api.example.com';

  async syncProjects(): Promise<void> {
    const projects = await db.getProjects();
    await fetch(`${this.baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(projects)
    });
  }

  async fetchProjects(): Promise<Project[]> {
    const response = await fetch(`${this.baseUrl}/projects`);
    return response.json();
  }
}
```

---

## 🐛 Debugging

### Włącz DevTools
```typescript
// src/main.ts
if (import.meta.env.DEV) {
  console.log('Development mode - Debug enabled');
  (window as any).__KAPPA_DEBUG__ = {
    db,
    state: this.state,
    i18n
  };
}
```

### Sprawdź IndexedDB
1. F12 → Application → IndexedDB → kappaplannung
2. Zobacz stores: customers, types, parts, tests, projects, settings

### Logi
```typescript
// Enable in main.ts
private logAction(action: string, data?: any): void {
  if (import.meta.env.DEV) {
    console.log(`[Kappa] ${action}`, data);
  }
}
```

---

## 📈 Performance Optimization

### 1. Virtual Scrolling (dla dużych gridów)
```bash
npm install @tanstack/virtual-core
```

### 2. Web Workers (dla obliczeń)
```typescript
// worker.ts
self.onmessage = (e) => {
  const { projects } = e.data;
  const stats = calculateStatistics(projects);
  self.postMessage(stats);
};
```

### 3. IndexedDB Indexing
```typescript
// database/index.ts
upgrade(db) {
  const projectStore = db.createObjectStore('projects', { keyPath: 'id' });
  projectStore.createIndex('customerId', 'customerId');
  projectStore.createIndex('testId', 'testId');
}
```

---

## 🔒 Security

### CSP Headers (dla production)
```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               style-src 'self' 'unsafe-inline'; 
               script-src 'self';">
```

### Data Encryption (opcjonalne)
```bash
npm install crypto-js
```

```typescript
import CryptoJS from 'crypto-js';

async exportData(): Promise<string> {
  const data = await super.exportData();
  const encrypted = CryptoJS.AES.encrypt(data, 'secret-key').toString();
  return encrypted;
}
```

---

## 📞 Support i Kontakt

**Issues:** GitHub Issues  
**Dokumentacja:** README.md + QUICKSTART.md  
**Email:** support@example.com

---

**Zbudowano z ❤️ dla DRÄXLMAIER Group**  
**Powered by TypeScript, Vite, IndexedDB, Chart.js**

*Enjoy planning! 🚀*
