# Kappaplannung - Quick Start Guide 🚀

## 🎯 Pierwsze Kroki

### Krok 1: Uruchom aplikację
```bash
npm run dev
```
Otwórz http://localhost:5173

### Krok 2: Dodaj podstawowe dane

#### W zakładce **Projects** dodaj:

**Klientów (Customers):**
- Porsche
- Tesla
- VW
- Mercedes

**Typy (Types):**
- G3
- Model Y
- 310
- E-Class

**Części (Parts):**
- Abdeckung HUD
- Front Door
- Z Blenda FS LL
- Außenschale HSK

**Testy (Tests):**
- Produkt Audit
- Peel off machine test
- Messlehre

### Krok 3: Utwórz projekty
1. Przejdź do zakładki **Planning**
2. Kliknij **Add Project**
3. Wybierz kombinację: Customer → Type → Part → Test
4. Projekt pojawi się w gridzie

### Krok 4: Wypełnij dane tygodniowe
1. Kliknij na komórkę IST lub SOLL
2. Wprowadź liczbę (np. dla SOLL: 20, dla IST: 15)
3. Komórka zmieni kolor:
   - 🟢 **Zielony**: IST ≥ SOLL (Cel osiągnięty!)
   - 🟠 **Pomarańczowy**: IST ≥ 50% SOLL (W trakcie)
   - 🔴 **Czerwony**: IST < 50% SOLL (Wymaga uwagi!)

## 📊 Przykładowe Dane

Możesz zaimportować ten JSON jako przykład:

```json
{
  "customers": [
    { "id": "c1", "name": "Porsche", "createdAt": 1737972000000 },
    { "id": "c2", "name": "Tesla", "createdAt": 1737972000000 },
    { "id": "c3", "name": "VW", "createdAt": 1737972000000 }
  ],
  "types": [
    { "id": "t1", "name": "G3", "createdAt": 1737972000000 },
    { "id": "t2", "name": "Model Y", "createdAt": 1737972000000 },
    { "id": "t3", "name": "310", "createdAt": 1737972000000 }
  ],
  "parts": [
    { "id": "p1", "name": "Abdeckung HUD / non HUD", "createdAt": 1737972000000 },
    { "id": "p2", "name": "Front Door", "createdAt": 1737972000000 },
    { "id": "p3", "name": "Z Blenda FS LL", "createdAt": 1737972000000 }
  ],
  "tests": [
    { "id": "te1", "name": "Produkt Audit", "createdAt": 1737972000000 },
    { "id": "te2", "name": "Peel off machine test", "createdAt": 1737972000000 },
    { "id": "te3", "name": "Messlehre", "createdAt": 1737972000000 }
  ],
  "projects": [
    {
      "id": "pr1",
      "customerId": "c1",
      "typeId": "t1",
      "partId": "p1",
      "testId": "te1",
      "weeks": {
        "KW04": { "ist": 25, "soll": 26 },
        "KW05": { "ist": 18, "soll": 20 },
        "KW06": { "ist": 32, "soll": 32 }
      },
      "createdAt": 1737972000000,
      "updatedAt": 1737972000000
    },
    {
      "id": "pr2",
      "customerId": "c2",
      "typeId": "t2",
      "partId": "p2",
      "testId": "te2",
      "weeks": {
        "KW04": { "ist": 10, "soll": 25 },
        "KW05": { "ist": 22, "soll": 20 }
      },
      "createdAt": 1737972000000,
      "updatedAt": 1737972000000
    }
  ],
  "settings": {
    "language": "pl",
    "darkMode": true,
    "animations": true,
    "highlightMissing": true,
    "blinkAlerts": true
  }
}
```

### Jak zaimportować przykładowe dane:
1. Skopiuj powyższy JSON
2. Zapisz jako `example-data.json`
3. W aplikacji kliknij **Import**
4. Wybierz plik
5. Gotowe! 🎉

## 🎨 Funkcje Specjalne

### Inteligentne Podświetlenia
- **Migające komórki** - Automatycznie migają gdy IST < 50% SOLL
- **Powiększenie** - Brakujące elementy (IST=0, SOLL>0) są większe
- **Kolory** - Natychmiastowa wizualizacja statusu

### Filtrowanie
- Filtruj według **Customer**, **Type**, **Test**
- **Szukaj** w czasie rzeczywistym
- Kombinuj filtry dla precyzyjnych wyników

### Analityka
- **Karty statystyk** - Szybki przegląd postępów
- **Wykres liniowy** - Trend IST vs SOLL w czasie
- **Wykres kołowy** - Dystrybucja testów

## 🌍 Zmiana Języka

Kliknij menu w prawym górnym rogu:
- **EN** - English
- **DE** - Deutsch
- **PL** - Polski
- **RO** - Română

## 💡 Pro Tips

1. **Szybka edycja**: Double-click na komórkę → wpisz wartość → Enter
2. **Export regularnie**: Backup swoich danych co tydzień
3. **Używaj filtrów**: Przy dużej ilości projektów filtry są niezbędne
4. **Monitoruj Analytics**: Sprawdzaj trendy co tydzień
5. **Kolorowy kod**: Zielony = OK, Pomarańczowy = Uwaga, Czerwony = Akcja!

## 🚨 Ważne!

- Dane są zapisywane **lokalnie** w przeglądarce
- **Nie używaj trybu incognito** - stracisz dane!
- Regularnie **exportuj** dane jako backup
- **Import nadpisuje** wszystkie dane

## 🆘 Pomoc

Problem? Sprawdź:
1. Konsolę przeglądarki (F12)
2. Czy IndexedDB jest włączone
3. Czy używasz najnowszej wersji przeglądarki

---

**Happy Planning! 🎯**
