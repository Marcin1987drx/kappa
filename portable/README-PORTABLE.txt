╔══════════════════════════════════════════╗
║       KAPPA PLANNUNG v1.0                ║
║       DRAXLMAIER Group                   ║
║       Instrukcja instalacji              ║
╚══════════════════════════════════════════╝

=== CO TO JEST? ===

Kappa Plannung to aplikacja do planowania Kappa.
Dziala w przegladarce internetowej (Chrome, Edge, Firefox).
Nie wymaga instalacji - wystarczy kliknac skrot.


=== PIERWSZE URUCHOMIENIE (ADMINISTRATOR) ===

1. Pobierz Node.js portable:
   https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip

2. Rozpakuj archiwum ZIP.

3. Skopiuj ZAWARTOSC rozpakowanego folderu (node.exe, npm.cmd, itp.)
   do podfolderu "node\" w tym katalogu.

   Struktura powinna wygladac tak:
   KappaPlannung\
   ├── node\
   │   ├── node.exe         <-- TEN PLIK MUSI TU BYC
   │   ├── npm.cmd
   │   ├── node_modules\
   │   └── ...
   ├── backend\
   ├── dist\
   ├── start-kappa.bat
   ├── zainstaluj-skrot.bat
   └── README.txt

4. Kliknij "zainstaluj-skrot.bat" aby utworzyc skrot na pulpicie.

5. Kliknij skrot "Kappa Plannung" na pulpicie - gotowe!


=== DLA UZYTKOWNIKOW ===

1. Kliknij dwukrotnie "zainstaluj-skrot.bat"
   (wystarczy raz - tworzy skrot na pulpicie)

2. Od teraz uzywaj skrotu "Kappa Plannung" na pulpicie.


=== JAK TO DZIALA? ===

- Pierwsza osoba ktora kliknie "Kappa Plannung" uruchomi serwer
  na swoim komputerze. Zobaczy czarne okienko z informacja
  "SERWER URUCHOMIONY" - NIE ZAMYKAC TEGO OKNA!

- Kazda kolejna osoba ktora kliknie skrot, automatycznie
  polaczy sie z juz dzialajacym serwerem (otworzy przegladarke).

- Gdy osoba ktora uruchomila serwer zamknie czarne okienko,
  serwer sie wylacza. Nastepna osoba ktora kliknie skrot
  automatycznie uruchomi nowy serwer na swoim komputerze.


=== WAZNE UWAGI ===

- Osoba z "czarnym okienkiem" musi je miec otwarte
  przez caly czas uzywania aplikacji.

- Jezeli pojawi sie pytanie firewalla Windows:
  "Czy zezwolic node.exe na dostep do sieci?"
  -> Kliknij: "Zezwol w sieci prywatnej/domowej"

- Dane sa przechowywane w folderze backend\data\
  na dysku sieciowym. Regularne kopie zapasowe sa tworzone
  automatycznie.


=== ROZWIAZYWANIE PROBLEMOW ===

Problem: "Nie znaleziono node.exe"
Rozwiazanie: Pobierz Node.js portable i umiesc w folderze node\
             (patrz punkt "PIERWSZE URUCHOMIENIE")

Problem: "Serwer nie uruchomil sie"
Rozwiazanie: Sprawdz czy port 3001 nie jest zajety.
             Zamknij inne kopie Kappa Plannung.

Problem: "Nie moge sie polaczyc z serwerem innej osoby"
Rozwiazanie: Firewall moze blokowac polaczenie.
             Popros administratora IT o odblokowanie portu 3001
             lub uruchom serwer na swoim komputerze
             (usun plik server.lock i kliknij skrot ponownie).

Problem: Plik "server.lock" istnieje ale nikt nie ma serwera
Rozwiazanie: Usun plik server.lock recznie i sprobuj ponownie.


=== KONTAKT ===

W razie problemow skontaktuj sie z administratorem aplikacji.
