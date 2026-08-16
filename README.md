# MSSQLBackupTool

Lokalna aplikacja webowa do wykonywania, pobierania, przesyłania, weryfikowania i odtwarzania backupów Microsoft SQL Server.

## Opis biznesowy

MSSQLBackupTool upraszcza obsługę kopii zapasowych baz Microsoft SQL Server w lokalnych środowiskach deweloperskich i testowych. Udostępnia w jednym panelu czynności, które zwykle wymagają korzystania z SQL Server Management Studio, skryptów T-SQL oraz ręcznego zarządzania plikami. Użytkownik może utworzyć backup, skompresować go, pobrać lub przesłać, sprawdzić jego poprawność, a następnie odtworzyć go jako nową bazę albo zastąpić istniejącą bazę.

Aplikacja powstała, aby ujednolicić i przyspieszyć powtarzalny proces wymiany baz pomiędzy członkami zespołu oraz odtwarzania danych na potrzeby programowania, testów i diagnostyki. Ogranicza ryzyko pomyłek wynikających z ręcznego wpisywania poleceń, zapewnia czytelny podgląd postępu i błędów oraz skupia pliki backupów i podstawowe operacje administracyjne w jednym miejscu. Kontrolowane potwierdzenia operacji destrukcyjnych pomagają dodatkowo chronić przed przypadkowym nadpisaniem lub usunięciem danych.

Narzędzie jest przeznaczone przede wszystkim do środowisk lokalnych i nie zastępuje firmowego systemu automatycznych backupów, retencji, monitoringu ani planu odtwarzania awaryjnego dla środowisk produkcyjnych.

## Uruchomienie

Wymagane są Docker Engine z Compose oraz co najmniej około 110 GiB wolnego miejsca dla domyślnych limitów.

1. Skopiuj `.env.example` jako `.env`.
2. Ustaw silne, zgodne wartości `MSSQL_SA_PASSWORD` i `MSSQL_PASSWORD`.
3. Uruchom:

```powershell
docker compose up -d --build
```

Panel będzie dostępny pod adresem <http://localhost:8080>. Port jest publikowany wyłącznie na interfejsie lokalnym.

## Konfiguracja

Konfigurację należy umieścić w pliku `.env` obok `compose.yaml`. Punktem wyjścia jest `.env.example`. Compose wczytuje ten plik automatycznie, a wartości podane bezpośrednio w środowisku procesu mają pierwszeństwo. Po zmianie konfiguracji kontenery należy odtworzyć poleceniem `docker compose up -d --build`.

### Inicjalizacja wolumenu backupów

Entrypoint obrazu aplikacji uruchamia się na moment jako `root`, tworzy katalogi `.incoming` i `.work` oraz ustawia dla nich właściciela `10001:0` i prawa `0770`. Następnie przez `su-exec` uruchamia Node.js jako nieuprzywilejowany użytkownik `10001:0`. Zapobiega to błędom `EACCES` dla nowych i istniejących wolumenów bez dodatkowego kontenera inicjalizacyjnego. Operacja nie wykonuje rekursywnej zmiany właściciela plików backupów.

### Usługa SQL Server (`mssql`)

| Parametr Compose | Wartość | Znaczenie |
|---|---|---|
| `image` | `mcr.microsoft.com/mssql/server:2022-latest` | Oficjalny obraz SQL Server 2022. Tag `latest` może wskazać nowszą rewizję obrazu przy kolejnym pobraniu. |
| `ACCEPT_EULA` | `Y` | Akceptuje licencję obrazu SQL Server; parametr wymagany przez obraz. |
| `MSSQL_PID` | `Developer` | Uruchamia bezpłatną edycję Developer, przeznaczoną wyłącznie do programowania i testów. |
| `MSSQL_SA_PASSWORD` | wartość z `.env` | Hasło konta `sa` ustawiane podczas inicjalizacji SQL Servera. Musi spełniać politykę złożoności SQL Servera. |
| `backup-data:/var/opt/mssql/backup` | wolumen nazwany | Udostępnia SQL Serverowi katalog backupów, współdzielony z aplikacją. |
| `sql-data:/var/opt/mssql` | wolumen nazwany | Trwale przechowuje bazy systemowe, bazy użytkownika, logi i konfigurację instancji. Usunięcie wolumenu usuwa dane SQL Servera. |
| `ports: 1433:1433` | host → kontener | Publikuje SQL Server na wszystkich interfejsach hosta na porcie 1433. Jeśli dostęp z sieci nie jest potrzebny, można użyć `127.0.0.1:1433:1433` albo usunąć publikację portu. Aplikacja komunikuje się z SQL Serverem przez sieć Compose. |
| `healthcheck.test` | `sqlcmd ... SELECT 1` | Sprawdza możliwość zalogowania i wykonania zapytania. Podwójny znak `$$` pozostawia rozwinięcie hasła kontenerowi zamiast Compose. |
| `healthcheck.interval` | `10s` | Odstęp pomiędzy kolejnymi kontrolami stanu. |
| `healthcheck.timeout` | `5s` | Maksymalny czas pojedynczej kontroli. |
| `healthcheck.retries` | `20` | Liczba kolejnych niepowodzeń przed oznaczeniem kontenera jako niesprawnego. |
| `healthcheck.start_period` | `20s` | Okres rozruchowy, w którym niepowodzenia nie wliczają się do limitu prób. |
| `restart` | `unless-stopped` | Automatycznie uruchamia kontener ponownie po awarii lub restarcie Dockera, chyba że został zatrzymany ręcznie. |

### Usługa aplikacji (`sql-backup-tool`)

| Parametr Compose | Wartość | Znaczenie |
|---|---|---|
| `image` | `mssql-backup-tool:latest` | Lokalna nazwa i tag obrazu aplikacji. |
| `build` | `.` | Buduje obraz z `Dockerfile` i kontekstu bieżącego katalogu. |
| `init` | `true` | Uruchamia mały proces init, który przekazuje sygnały i usuwa osierocone procesy. |
| `volumes` | `backup-data:/app/backups` | Montuje współdzielony wolumen backupów pod ścieżką widzianą przez aplikację. |
| `ports` | `127.0.0.1:8080:8080` | Udostępnia panel wyłącznie lokalnie na porcie 8080. Zmiana `PORT` wymaga odpowiedniej zmiany portu kontenera po prawej stronie mapowania. |
| `depends_on` | `mssql: condition: service_healthy` | Uruchamia aplikację dopiero po pozytywnym healthchecku SQL Servera. Nie gwarantuje dostępności serwera przez cały czas działania. |
| `restart` | `unless-stopped` | Automatycznie wznawia aplikację po awarii lub restarcie Dockera, o ile nie zatrzymano jej ręcznie. |

### Zmienne aplikacji

Składnia `${NAZWA:-wartość}` oznacza wartość domyślną, gdy zmienna jest nieustawiona lub pusta. Składnia `${NAZWA:?komunikat}` przerywa uruchamianie Compose, gdy wymaganej wartości brakuje.

| Zmienna | Domyślnie w Compose | Znaczenie |
|---|---:|---|
| `PORT` | `8080` | Port HTTP nasłuchiwany wewnątrz kontenera; dozwolony zakres to 1–65535. |
| `APP_HOST` | `0.0.0.0` | Adres nasłuchu wewnątrz kontenera. `0.0.0.0` jest wymagane, aby przekierowanie portu Dockera działało. |
| `PUBLIC_ORIGIN` | `http://localhost:8080` | Publiczny origin aplikacji: schemat, host i opcjonalny port. Jest używany do kontroli pochodzenia żądań modyfikujących; przy reverse proxy musi odpowiadać adresowi widzianemu przez użytkownika. |
| `MSSQL_HOST` | `mssql` | Nazwa hosta SQL Servera. W Compose jest to nazwa usługi rozwiązywana przez wewnętrzny DNS. |
| `MSSQL_PORT` | `1433` | Port TCP SQL Servera, od 1 do 65535. Jest to port w sieci Compose, nie port publikowany na hoście. |
| `MSSQL_USER` | `sa` | Login SQL Servera używany przez aplikację. |
| `MSSQL_PASSWORD` | brak — wymagane | Hasło loginu z `MSSQL_USER`. W typowej konfiguracji powinno być zgodne z `MSSQL_SA_PASSWORD`, jeśli używany jest login `sa`. |
| `MSSQL_ENCRYPT` | `false` | Włącza szyfrowanie połączenia TDS tylko dla dokładnej wartości `true`. W środowisku zdalnym zalecane jest `true`. |
| `MSSQL_TRUST_SERVER_CERTIFICATE` | `true` | Dla `true` akceptuje certyfikat bez weryfikacji łańcucha zaufania. W produkcji zalecane jest `false` i zaufany certyfikat serwera. |
| `MSSQL_BACKUP_PATH` | `/var/opt/mssql/backup` | Bezwzględna ścieżka POSIX do wspólnego katalogu backupów widziana przez proces SQL Servera. |
| `MSSQL_DATA_PATH` | `/var/opt/mssql/data` | Bezwzględny katalog po stronie SQL Servera, w którym restore utworzy pliki MDF/NDF za pomocą `RESTORE ... WITH MOVE`. |
| `MSSQL_LOG_PATH` | `/var/opt/mssql/data` | Bezwzględny katalog po stronie SQL Servera, w którym restore utworzy pliki LDF za pomocą `RESTORE ... WITH MOVE`. |
| `APP_BACKUP_PATH` | `/app/backups` | Bezwzględna ścieżka POSIX do tej samej zawartości backupów widziana przez kontener aplikacji. Musi odpowiadać punktowi montowania `backup-data`. |
| `MAX_UPLOAD_BYTES` | `53687091200` | Maksymalny rozmiar przesyłanego pliku w bajtach, domyślnie 50 GiB. Wartość musi być dodatnią liczbą całkowitą. |
| `MAX_EXTRACTED_BYTES` | `107374182400` | Maksymalny rozmiar rozpakowanego pliku `.bak` w bajtach, domyślnie 100 GiB. Chroni przed nadmiernie dużymi archiwami. |
| `MAX_COMPRESSION_RATIO` | `200` | Maksymalny stosunek rozmiaru po rozpakowaniu do rozmiaru archiwum. Chroni przed archiwami typu zip bomb; minimum wynosi 1. |
| `TEMP_MAX_AGE_HOURS` | `24` | Maksymalny wiek plików tymczasowych przed ich usunięciem podczas sprzątania; dodatnia liczba pełnych godzin. |
| `ENABLE_SHRINK_LOG` | `false` | Udostępnia administracyjne akcje zmniejszania logów. Akceptuje wyłącznie `true` albo `false`. |

Aplikacja obsługuje również opcjonalne zmienne niewystawione domyślnie w `compose.yaml`:

| Zmienna | Domyślnie | Znaczenie |
|---|---:|---|
| `HTTP_REQUEST_TIMEOUT_MS` | `0` | Limit czasu żądania HTTP w milisekundach; `0` wyłącza limit, co umożliwia długie operacje backupu i restore. |
| `MSSQL_CONNECTION_TIMEOUT_MS` | `15000` | Limit nawiązania połączenia z SQL Serverem w milisekundach; musi być większy od zera. |
| `MSSQL_REQUEST_TIMEOUT_MS` | `0` | Limit wykonania pojedynczego żądania SQL w milisekundach; `0` wyłącza limit. |

Aby ich użyć, należy dodać je do sekcji `environment` usługi `sql-backup-tool`, na przykład w formie `HTTP_REQUEST_TIMEOUT_MS: ${HTTP_REQUEST_TIMEOUT_MS:-0}`.

### Wolumeny i ścieżki

Wolumen `backup-data` jest montowany jednocześnie jako `/var/opt/mssql/backup` w kontenerze SQL Servera i `/app/backups` w kontenerze aplikacji. Obie ścieżki wskazują tę samą zawartość, dlatego wartości `MSSQL_BACKUP_PATH`, `APP_BACKUP_PATH` oraz punkty montowania muszą pozostać ze sobą zgodne. Przy każdym starcie entrypoint aplikacji koryguje prawa katalogu wolumenu i katalogów roboczych bez usuwania jego zawartości.

Wolumen `sql-data` przechowuje `/var/opt/mssql`, a więc dane instancji niezależnie od cyklu życia kontenera. Polecenie `docker compose down` zachowuje wolumeny, natomiast `docker compose down -v` usuwa je wraz ze wszystkimi bazami i backupami.

`MSSQL_DATA_PATH` i `MSSQL_LOG_PATH` są potrzebne, ponieważ ścieżki zapisane w backupie mogą pochodzić z innego serwera i nie istnieć w środowisku docelowym. Aplikacja wyznacza na ich podstawie nowe lokalizacje plików i przekazuje je do polecenia `RESTORE` jako mapowanie `MOVE`. Muszą wskazywać istniejące katalogi, w których konto uruchamiające SQL Server ma prawo zapisu. Nie są to ścieżki widziane wyłącznie przez kontener aplikacji.

### Hasła i uprawnienia

`MSSQL_SA_PASSWORD` inicjalizuje konto `sa` w kontenerze SQL Servera, natomiast `MSSQL_PASSWORD` służy aplikacji do logowania. Przy `MSSQL_USER=sa` wartości powinny być identyczne. Zmiana samego `MSSQL_SA_PASSWORD` po utworzeniu wolumenu `sql-data` nie zmienia automatycznie hasła istniejącej instancji.

Pliku `.env` nie należy dodawać do repozytorium ani udostępniać. W środowisku innym niż lokalne zalecane jest użycie mechanizmu sekretów zamiast zwykłych zmiennych środowiskowych.

Jeżeli używany jest login inny niż `sa`, musi mieć uprawnienia do listowania baz, `BACKUP DATABASE`, `RESTORE`, tworzenia i modyfikowania baz oraz odczytu `sys.master_files`. Licznik aktywnych połączeń wymaga widoczności `sys.dm_exec_sessions`, a ostatni backup — odczytu historii `msdb.dbo.backupset`; bez tych uprawnień aplikacja wyświetli `—`. `DBCC SHRINKFILE` wymaga członkostwa w `sysadmin` albo `db_owner` wybranej bazy.

## Metadane i zmniejszanie logów

Lista baz pokazuje stan, model odzyskiwania, aktywne połączenia, ostatni pełny backup oraz przydzielone rozmiary plików danych i logu. Rozmiary nie oznaczają faktycznie wykorzystanego miejsca wewnątrz plików.

Po ustawieniu `ENABLE_SHRINK_LOG=true` dostępne są dwa tryby:

- **Zwolnij log** — zachowuje model odzyskiwania i używa `DBCC SHRINKFILE(..., TRUNCATEONLY)` dla każdego LDF. Wynik może wynieść 0 B, jeżeli końcowe fragmenty logu są aktywne albo baza czeka np. na backup logu.
- **Do 256 MB/LDF** — czasowo przełącza bazę na `SIMPLE`, wykonuje `CHECKPOINT`, zmniejsza każdy LDF do docelowych 256 MB i próbuje przywrócić poprzedni model.

Tryb agresywny przerywa łańcuch backupów logu. Po powrocie do `FULL` lub `BULK_LOGGED` należy wykonać regularny, nie-`COPY_ONLY` pełny backup. Shrink nie jest rutynową konserwacją: może zwiększać obciążenie, powodować ponowny wzrost pliku i pogarszać układ VLF. Aplikacja nie zmniejsza plików danych, nie używa `DBCC SHRINKDATABASE` i nie rozłącza użytkowników podczas shrinku.

## Zachowanie

- Dostępne formaty to `.bak`, `.bak.zip`, `.bak.gz`, `.zip` i `.gz`.
- Backup może być nieskompresowany, kompresowany natywnie przez MSSQL, ZIP lub GZIP.
- Po udanej kompresji ZIP/GZIP źródłowy `.bak` jest usuwany.
- Archiwum przesłane przez użytkownika pozostaje na wolumenie. Tymczasowy `.bak` jest usuwany po verify lub restore także przy błędzie.
- Jednocześnie może trwać jedna operacja mutująca. Pobieranie pozostaje dostępne.
- Zamknięcie karty nie przerywa rozpoczętego backupu lub restore. Restart kontenera usuwa pamięciowy status i może przerwać połączenie TDS.
- Restore do istniejącej bazy wymaga zgody na nadpisanie. Automatyczne rozłączenie aktywnych sesji jest osobną opcją.

## Ograniczenia

Pierwsza wersja obsługuje jeden pełny backup set zapisany w jednym pliku. Backupy wielozestawowe, stripe, FILESTREAM, In-Memory OLTP i zaszyfrowane archiwa są odrzucane. Backup zaszyfrowany TDE wymaga odpowiedniego certyfikatu po stronie SQL Servera. Backupu z nowszej wersji SQL Servera nie można odtworzyć na starszej; aplikacja zwraca czytelny błąd otrzymany z serwera.

## Testy

```powershell
npm ci
npm test
```

Docelowym środowiskiem jest Node.js 24. Testy integracyjne wymagające rzeczywistego SQL Servera wykonuje się po uruchomieniu Compose.