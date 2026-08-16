# Instrukcja użytkownika MSSQLBackupTool

MSSQLBackupTool to aplikacja webowa służąca do tworzenia, przesyłania, pobierania, weryfikowania i odtwarzania kopii zapasowych baz danych Microsoft SQL Server.

> **Ważne:** odtwarzanie, usuwanie bazy danych oraz usuwanie plików backupu może prowadzić do nieodwracalnej utraty danych. Przed zatwierdzeniem operacji zawsze sprawdź nazwę bazy i wybrany plik.

## 1. Otwieranie aplikacji

1. Otwórz w przeglądarce adres podany przez administratora.
2. Poczekaj na załadowanie list baz danych i plików backupów.
3. W sekcji **Środowisko SQL Server** sprawdź stan połączenia:
   - **Połączono** — aplikacja może komunikować się z SQL Serverem;
   - **Brak połączenia** — część funkcji nie będzie dostępna. Odśwież informacje przyciskiem **↻**, a jeśli problem nie ustąpi, skontaktuj się z administratorem.

W prawym górnym rogu można zmienić jasny lub ciemny motyw oraz kolor podstawowy interfejsu. Ustawienia są zapamiętywane w przeglądarce.

## 2. Tworzenie backupu

1. W sekcji **Wykonaj backup** wybierz bazę danych.
2. Wybierz rodzaj kompresji:
   - **Bez kompresji** — tworzy plik `.bak`;
   - **Natywna MSSQL** — tworzy plik `.bak` skompresowany przez SQL Server;
   - **ZIP** — tworzy archiwum ZIP;
   - **GZIP** — tworzy archiwum GZIP.
3. Kliknij **Wykonaj backup**.
4. Obserwuj postęp i log w oknie operacji.
5. Po zakończeniu sprawdź komunikat:
   - **Sukces** — backup został utworzony i pojawi się na liście plików;
   - **Błąd** — przeczytaj treść komunikatu i log operacji.
6. Kliknij **OK**, aby zamknąć okno.

Po udanej kompresji ZIP lub GZIP pośredni plik `.bak` jest automatycznie usuwany.

## 3. Przesyłanie pliku backupu

Obsługiwane są pliki `.bak`, `.bak.zip`, `.zip`, `.bak.gz` i `.gz`.

1. W sekcji **Pliki backupów** kliknij **Wybierz i prześlij plik**.
2. Wybierz plik z komputera.
3. Przesyłanie rozpocznie się automatycznie.
4. Obserwuj wskaźnik postępu.
5. Po zakończeniu sprawdź wynik operacji i kliknij **OK**.

Maksymalny dopuszczalny rozmiar pliku ustala administrator. Nie zamykaj ani nie odświeżaj strony podczas przesyłania.

## 4. Zarządzanie plikami backupów

Tabela **Pliki backupów** zawiera nazwę, format, rozmiar, datę modyfikacji i dostępne akcje.

### Pobieranie pliku

Kliknij ikonę pobierania przy wybranym pliku. Przeglądarka rozpocznie zapis pliku na komputerze.

### Usuwanie pliku

1. Kliknij ikonę kosza przy wybranym pliku.
2. Sprawdź nazwę pliku w oknie potwierdzenia.
3. Kliknij **Usuń plik**.

> Usuniętego pliku nie można odzyskać za pomocą aplikacji.

Aby pobrać aktualną listę plików, kliknij przycisk **↻** obok nagłówka sekcji.

## 5. Weryfikowanie backupu

Weryfikacja sprawdza, czy SQL Server potrafi odczytać backup. Nie zastępuje ona próbnego odtworzenia bazy ani kontroli poprawności danych.

1. W sekcji **Odtwórz bazę** wybierz plik backupu.
2. Kliknij **Zweryfikuj**.
3. Obserwuj log operacji.
4. Po zakończeniu zapoznaj się z wynikiem i kliknij **OK**.

Dla archiwum ZIP lub GZIP aplikacja najpierw bezpiecznie rozpakuje plik `.bak`. Plik tymczasowy zostanie usunięty po zakończeniu operacji, także w przypadku błędu. Oryginalne archiwum pozostanie na liście.

## 6. Odtwarzanie backupu jako nowej bazy

1. W sekcji **Odtwórz bazę** wybierz plik backupu.
2. Zaznacz **Nowa baza**.
3. Wpisz nazwę nowej bazy w polu **Nazwa bazy docelowej**.
4. Opcjonalnie zaznacz **Automatycznie rozłącz aktywne sesje**, jeśli wymaga tego sytuacja.
5. Kliknij **Zweryfikuj i odtwórz**.
6. Obserwuj postęp oraz log operacji.
7. Po powodzeniu sprawdź, czy nowa baza pojawiła się w tabeli **Bazy danych**.

Nazwa docelowa nie może wskazywać istniejącej bazy w trybie **Nowa baza**.

## 7. Nadpisywanie istniejącej bazy

> **Ostrzeżenie:** ta operacja bezpowrotnie zastępuje zawartość wybranej bazy danymi z backupu.

1. W sekcji **Odtwórz bazę** wybierz właściwy plik backupu.
2. Zaznacz **Istniejąca baza**.
3. Wybierz bazę docelową z listy.
4. Upewnij się, że zaznaczona jest opcja **Zezwalam na nadpisanie istniejącej bazy**.
5. Jeżeli baza ma aktywne połączenia i mogą one zostać przerwane, zaznacz **Automatycznie rozłącz aktywne sesje**.
6. Jeszcze raz porównaj nazwę pliku i bazy docelowej.
7. Kliknij **Zweryfikuj i odtwórz**.
8. Obserwuj operację aż do jej zakończenia.

Bez zgody na nadpisanie aplikacja odrzuci żądanie. Jeśli aktywne sesje uniemożliwiają odtworzenie, operacja może się nie powieść, chyba że wybrano ich automatyczne rozłączenie.

## 8. Informacje o bazach danych

Tabela **Bazy danych** prezentuje:

- nazwę i stan bazy;
- przydzielony rozmiar plików danych i logu;
- łączny przydzielony rozmiar;
- liczbę aktywnych połączeń;
- model odzyskiwania;
- datę ostatniego pełnego backupu;
- dostępne akcje administracyjne.

Wyświetlane rozmiary oznaczają miejsce przydzielone plikom, a nie faktycznie wykorzystane dane. Znak **—** oznacza brak informacji lub niewystarczające uprawnienia aplikacji.

Aby odświeżyć tabelę, kliknij przycisk **↻** obok nagłówka sekcji.

## 9. Usuwanie bazy danych

> **Niebezpieczeństwo:** usunięcie bazy powoduje bezpowrotną utratę wszystkich zapisanych w niej danych.

1. Jeśli dane mogą być jeszcze potrzebne, najpierw wykonaj i pobierz backup.
2. W tabeli **Bazy danych** kliknij ikonę kosza przy właściwej bazie.
3. Dokładnie sprawdź nazwę w oknie potwierdzenia.
4. Kliknij **Usuń bazę**.
5. Zaczekaj na zakończenie operacji i sprawdź jej wynik.

## 10. Zmniejszanie logu transakcyjnego

Przyciski zmniejszania logu są widoczne tylko wtedy, gdy administrator włączy tę funkcję. Są przeznaczone do wyjątkowych sytuacji, głównie w środowiskach deweloperskich. Shrink nie powinien być wykonywany jako rutynowa konserwacja.

### Zwolnienie nieaktywnego końca logu

Opcja **Zwolnij nieaktywny koniec logu** zachowuje bieżący model odzyskiwania. Może nie odzyskać miejsca, jeżeli końcowe fragmenty logu są aktywne lub baza oczekuje na backup logu.

1. Kliknij odpowiednią ikonę przy bazie.
2. Przeczytaj ostrzeżenie.
3. Kliknij **Zmniejsz log**, jeśli operacja jest uzasadniona.

### Agresywne zmniejszenie do 256 MB na plik LDF

> **Ostrzeżenie:** tryb agresywny czasowo przełącza bazę na model `SIMPLE` i przerywa łańcuch backupów logu.

Po użyciu tej opcji dla bazy pracującej wcześniej w modelu `FULL` lub `BULK_LOGGED` należy wykonać regularny pełny backup, aby rozpocząć nowy łańcuch backupów logu. W razie wątpliwości skonsultuj operację z administratorem bazy danych.

## 11. Przebieg operacji

Jednocześnie może trwać tylko jedna operacja zmieniająca dane. W tym czasie można nadal pobierać pliki.

Okno operacji pokazuje:

- aktualny stan i opis etapu;
- procent postępu, jeśli jest dostępny;
- log komunikatów aplikacji i SQL Servera;
- końcowy wynik albo opis błędu.

Okna trwającej operacji nie można zamknąć przyciskiem **OK**. Zamknięcie karty przeglądarki nie musi przerwać rozpoczętego backupu lub odtwarzania, jednak utrudnia obserwowanie postępu. Po ponownym otwarciu aplikacja może wyświetlić bieżący status, o ile usługa nie została zrestartowana.

## 12. Najczęstsze problemy

### Brak połączenia z SQL Serverem

- odśwież sekcję **Środowisko SQL Server**;
- odczekaj chwilę i ponów próbę;
- jeśli problem nie ustępuje, przekaż administratorowi skonfigurowany adres i treść błędu.

### Brak bazy lub pliku na liście

- kliknij **↻** przy odpowiedniej sekcji;
- sprawdź, czy inna operacja nadal trwa;
- upewnij się, że poprzednia operacja zakończyła się powodzeniem.

### Nie można odtworzyć backupu

Możliwe przyczyny obejmują:

- backup utworzony przez nowszą wersję SQL Servera niż serwer docelowy;
- brak certyfikatu wymaganego przez backup zaszyfrowany za pomocą TDE;
- aktywne połączenia z bazą docelową;
- brak miejsca na dysku;
- uszkodzony lub nieobsługiwany backup;
- niewystarczające uprawnienia konta używanego przez aplikację.

Przeczytaj końcowy komunikat i log operacji. Przy zgłoszeniu problemu podaj administratorowi czas wystąpienia, nazwę operacji oraz pełną treść komunikatu — bez ujawniania haseł i innych danych poufnych.

### Przesyłanie pliku zostało odrzucone

Sprawdź rozszerzenie i rozmiar pliku. Dozwolony limit może być niższy od rozmiaru wybranego backupu. Nie zmieniaj ręcznie rozszerzenia pliku, aby ominąć kontrolę formatu.

### Żądanie zostało odrzucone

Odśwież stronę i spróbuj ponownie. Komunikat może pojawić się po długim czasie bezczynności, zmianie adresu aplikacji lub ponownym uruchomieniu usługi.

## 13. Ograniczenia

Aplikacja obsługuje jeden pełny zestaw backupu zapisany w jednym pliku. Nie obsługuje między innymi backupów wielozestawowych, rozłożonych na kilka plików, zaszyfrowanych archiwów, FILESTREAM ani In-Memory OLTP.

Backupu utworzonego na nowszej wersji SQL Servera nie można odtworzyć na wersji starszej. Backup bazy chronionej TDE wymaga odpowiedniego certyfikatu na serwerze docelowym.

## 14. Zasady bezpiecznej pracy

- Przed operacją destrukcyjną sprawdź nazwę pliku i bazy co najmniej dwa razy.
- Przed nadpisaniem lub usunięciem ważnej bazy wykonaj backup i pobierz go poza serwer.
- Nie udostępniaj backupów osobom nieuprawnionym — mogą zawierać dane poufne.
- Nie zamykaj strony podczas przesyłania pliku.
- Nie wykonuj zmniejszania logu bez uzasadnienia i znajomości skutków.
- Nie przesyłaj administratorowi haseł, tokenów ani innych sekretów wraz ze zgłoszeniem błędu.
