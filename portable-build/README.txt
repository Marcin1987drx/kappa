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

1. Skopiuj caly ten folder na dysk sieciowy
   np. \\serwer\DzialQS\KappaPlannung\

2. Kliknij dwukrotnie "INSTALUJ.bat"
   -> Wszystko pobierze sie i skonfiguruje automatycznie!
   -> Na koniec pojawi sie skrot na pulpicie.

3. Gotowe! Uzyj skrotu "Kappa Plannung" na pulpicie.


=== DLA UZYTKOWNIKOW ===

1. Kliknij dwukrotnie "INSTALUJ.bat" w folderze aplikacji
   (wystarczy raz - pobiera Node.js i tworzy skrot na pulpicie)

2. Od teraz uzywaj skrotu "Kappa Plannung" na pulpicie.

   UWAGA: Jesli INSTALUJ.bat nie moze pobrac Node.js
   (brak internetu / blokada firmy), popros administratora
   aby uruchomil INSTALUJ.bat na komputerze z dostepem do
   internetu - Node.js pobierze sie do folderu wspolnego
   i juz nie trzeba bedzie go pobierac ponownie.


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
