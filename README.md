# Kappaplannung 2025 - DRÄXLMAIER 🚀

Nowoczesna aplikacja webowa do zarządzania planowaniem tygodniowym w stylu korporacyjnym DRÄXLMAIER.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Funkcje

### 📅 Planowanie Tygodniowe
- **Dynamiczny grid 52 tygodni** (KW01-KW52)
- Kolumny **IST/SOLL** dla każdego tygodnia
- **Edycja in-place** - kliknij komórkę aby edytować
- **Kolorowe statusy**:
  - 🟢 Zielony: Cel osiągnięty (IST ≥ SOLL)
  - 🟠 Pomarańczowy: W trakcie (IST ≥ 50% SOLL)
  - 🔴 Czerwony: Opóźnienie (IST < 50% SOLL)
- **Inteligentne alerty**:
  - Migające elementy dla krytycznych braków
  - Podświetlenie brakujących pozycji
  - Powiększanie ważnych elementów

### 🗂️ Zarządzanie Projektami
- Dodawanie/edycja/usuwanie:
  - Klientów (Kunde)
  - Typów (Typ)
  - Części (Teil)
  - Testów (Prüfung)
- Szybkie tworzenie projektów

### 📊 Analityka i Statystyki
- **Karty statystyk**:
  - Całkowita liczba projektów
  - Ukończone testy
  - Oczekujące testy
  - Opóźnione testy
- **Wykresy**:
  - Wykres liniowy postępu tygodniowego (IST vs SOLL)
  - Wykres kołowy dystrybucji testów

### 🌍 Wielojęzyczność
Pełne wsparcie dla 4 języków:
- 🇵🇱 Polski
- 🇩🇪 Niemiecki
- 🇬🇧 Angielski
- 🇷🇴 Rumuński

### 💾 Zarządzanie Danymi
- **Lokalna baza IndexedDB** - wszystkie dane przechowywane lokalnie
- **Export/Import JSON** - łatwe backupy i przenoszenie danych
- Filtrowanie i wyszukiwanie
- Czyszczenie danych

### 🎨 Projekt
- **Kolory korporacyjne DRÄXLMAIER**:
  - Primary: #0097AC (Turkusowy)
  - Secondary: #0B0F10 (Ciemny grafit)
  - White: #FFFFFF
- Ciemny motyw (Dark Mode)
- Płynne animacje i przejścia
- Responsywny design

## 🚀 Szybki Start

### Wymagania
- Node.js 18+ i npm

### Instalacja

```bash
# Zainstaluj zależności
npm install

# Uruchom serwer deweloperski
npm run dev

# Aplikacja będzie dostępna pod http://localhost:5173
```

### Build produkcyjny

```bash
npm run build
```

Pliki produkcyjne zostaną wygenerowane w folderze `dist/`.

### Podgląd buildu

```bash
npm run preview
```

## 📱 Konwersja na EXE

### Opcja 1: Electron

1. Zainstaluj Electron:
```bash
npm install --save-dev electron electron-builder
```

2. Dodaj plik `electron.js`:
```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadFile('dist/index.html');
}

app.whenReady().then(createWindow);
```

3. Dodaj do `package.json`:
```json
"main": "electron.js",
"scripts": {
  "electron": "electron .",
  "pack": "electron-builder --dir",
  "dist": "electron-builder"
}
```

4. Build:
```bash
npm run build
npm run dist
```

### Opcja 2: Tauri (Lżejsza alternatywa)

```bash
# Zainstaluj Tauri CLI
npm install --save-dev @tauri-apps/cli

# Inicjalizuj Tauri
npx tauri init

# Build EXE
npm run tauri build
```

## 🎯 Użycie

### 1. Dodaj podstawowe dane
- Przejdź do zakładki **Projects**
- Dodaj klientów, typy, części i testy

### 2. Utwórz projekty
- W zakładce **Planning** kliknij **Add Project**
- Wybierz klienta, typ, część i test
- Projekt pojawi się w gridzie

### 3. Wypełnij plan tygodniowy
- Kliknij na komórkę IST lub SOLL
- Wprowadź wartość
- Komórki automatycznie zmienią kolor według statusu

### 4. Monitoruj postępy
- Zakładka **Analytics** pokazuje statystyki i wykresy
- Filtruj dane według klienta, typu lub testu
- Używaj wyszukiwania do szybkiego znalezienia projektów

## 🛠️ Technologie

- **TypeScript 5.3** - Type-safe development
- **Vite 5** - Super szybki build tool
- **IndexedDB** (via idb 8.0) - Lokalna baza danych
- **Chart.js 4.4** - Wykresy i wizualizacje
- **CSS3** - Modern styling z animacjami
- **HTML5** - Semantic markup

## 📁 Struktura Projektu

```
kappa/
├── src/
│   ├── database/
│   │   └── index.ts          # IndexedDB wrapper
│   ├── i18n/
│   │   └── index.ts          # System tłumaczeń
│   ├── styles/
│   │   └── main.css          # Style DRÄXLMAIER
│   ├── types/
│   │   └── index.ts          # TypeScript interfaces
│   └── main.ts               # Główna logika aplikacji
├── index.html                # Entry point
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## 🎨 Kolory Korporacyjne

```css
--color-primary: #0097AC;      /* Turkusowy DRÄXLMAIER */
--color-secondary: #0B0F10;    /* Ciemny grafit */
--color-white: #FFFFFF;        /* Biały */
--color-success: #4CAF50;      /* Zielony (Cel osiągnięty) */
--color-warning: #FF9800;      /* Pomarańczowy (W trakcie) */
--color-danger: #F44336;       /* Czerwony (Opóźnienie) */
```

## 🔧 Konfiguracja

### Ustawienia dostępne w UI:
- **Dark Mode** - Tryb ciemny (domyślnie włączony)
- **Animations** - Animacje i przejścia
- **Highlight Missing** - Podświetlanie brakujących elementów
- **Blink Alerts** - Migające alerty dla krytycznych pozycji

### Persystencja danych:
Wszystkie dane są automatycznie zapisywane w IndexedDB przeglądarki. Dane pozostają po zamknięciu aplikacji.

## 📤 Export/Import

### Export danych:
1. Kliknij **Export** w zakładce Planning
2. Plik JSON zostanie pobrany automatycznie

### Import danych:
1. Kliknij **Import** w zakładce Planning
2. Wybierz wcześniej wyeksportowany plik JSON
3. Dane zostaną załadowane (nadpisując istniejące)

## 🐛 Troubleshooting

### Problem: Aplikacja nie uruchamia się
```bash
# Wyczyść cache i zainstaluj ponownie
rm -rf node_modules package-lock.json
npm install
npm run dev
```

### Problem: Brak danych po odświeżeniu
- Sprawdź czy przeglądarka ma włączone cookies/IndexedDB
- Nie używaj trybu incognito

### Problem: Wykresy się nie wyświetlają
- Odśwież stronę (Ctrl+F5)
- Sprawdź konsolę przeglądarki (F12)

## 🚀 Pomysły na Rozwój

- [ ] **Backend API** - Synchronizacja między urządzeniami
- [ ] **Autentykacja** - Multi-user support
- [ ] **Raporty PDF** - Export do PDF
- [ ] **Excel Import** - Import z istniejących plików Excel
- [ ] **Notyfikacje** - Desktop notifications
- [ ] **Dark/Light Theme Toggle** - Przełącznik motywów
- [ ] **Drag & Drop** - Przenoszenie projektów
- [ ] **Timeline View** - Widok osi czasu
- [ ] **Mobile App** - React Native/Flutter
- [ ] **Offline Mode** - Progressive Web App (PWA)

## 📝 Licencja

MIT License - użyj jak chcesz!

## 👨‍💻 Autor

Stworzone dla DRÄXLMAIER Group  
Powered by GitHub Copilot 🤖

---

**Enjoy planning! 🎉**