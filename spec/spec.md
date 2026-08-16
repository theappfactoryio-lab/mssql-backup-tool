Poniżej znajduje się uporządkowany opis planowanej aplikacji, zgodny z dotychczasowymi ustaleniami. Zakres został celowo ograniczony do prostego narzędzia działającego w jednym kontenerze, bez logowania, kolejki, audytu, bazy konfiguracyjnej i innych elementów niewymaganych w pierwszej wersji.

MSSQLBackupTool
Opis aplikacji

MSSQLBackupTool będzie prostą aplikacją webową służącą do wykonywania i odtwarzania kopii zapasowych baz Microsoft SQL Server.

Aplikacja będzie uruchamiana jako pojedynczy kontener Docker i udostępniana przez przeglądarkę internetową. Kontener aplikacji oraz kontener MSSQL będą korzystać ze wspólnego wolumenu, dzięki czemu SQL Server będzie mógł zapisywać pliki .bak, a aplikacja będzie mogła je kompresować, wyświetlać, udostępniać do pobrania i wykorzystywać podczas odtwarzania.

Aplikacja jest przeznaczona do prostego zastosowania wewnętrznego. Nie będzie posiadać logowania, zarządzania użytkownikami, audytu, harmonogramów ani trwałej historii operacji.

1. Wymagania biznesowe
1.1. Cel biznesowy

Celem aplikacji jest uproszczenie wykonywania i odtwarzania backupów baz MSSQL bez konieczności:

uruchamiania SQL Server Management Studio,
ręcznego wpisywania poleceń T-SQL,
kopiowania plików między kontenerami,
ręcznego kompresowania backupów,
korzystania z terminala podczas typowych operacji.

Wszystkie podstawowe operacje powinny być dostępne z poziomu prostego interfejsu webowego.

1.2. Wykonanie backupu

Użytkownik powinien mieć możliwość:

wybrania serwera MSSQL,
wybrania bazy danych dostępnej na wybranym serwerze,
wybrania sposobu kompresji,
uruchomienia backupu,
otrzymania informacji o powodzeniu albo błędzie operacji.

Backup powinien być wykonywany w natywnym formacie Microsoft SQL Server:

.bak

1.3. Obsługiwane warianty kompresji

Aplikacja powinna oferować cztery opcje:

Bez kompresji

SQL Server tworzy standardowy plik:

NazwaBazy.bak

Natywna kompresja MSSQL

SQL Server wykonuje backup z użyciem natywnej opcji kompresji. Wynikiem nadal jest plik:

NazwaBazy.bak

ZIP

Po wykonaniu backupu aplikacja kompresuje plik .bak do:

NazwaBazy.bak.zip

GZIP

Po wykonaniu backupu aplikacja kompresuje plik .bak do:

NazwaBazy.bak.gz

1.4. Lista plików backupów

Aplikacja powinna wyświetlać pliki znajdujące się we współdzielonym katalogu backupów.

Dla każdego pliku należy wyświetlić co najmniej:

nazwę pliku,
rozmiar,
datę modyfikacji,
format pliku.

Z poziomu listy plików użytkownik powinien mieć możliwość:

pobrania backupu,
wybrania backupu do odtworzenia.
1.5. Pobieranie backupu

Użytkownik powinien móc pobrać wybrany plik backupu przez przeglądarkę.

Pobieranie powinno działać dla plików:

.bak
.bak.zip
.bak.gz

1.6. Upload backupu

Użytkownik powinien mieć możliwość przesłania backupu przez przeglądarkę.

Obsługiwane formaty:

.bak
.bak.zip
.bak.gz
.zip
.gz


Przesłany plik powinien zostać zapisany we współdzielonym katalogu backupów.

Jeśli plik jest skompresowany i został wybrany do odtworzenia, aplikacja powinna go rozpakować przed rozpoczęciem operacji restore.

1.7. Odtwarzanie backupu

Użytkownik powinien mieć możliwość:

wybrania pliku backupu,
wybrania docelowego serwera MSSQL,
wybrania istniejącej bazy docelowej albo podania nazwy nowej bazy,
uruchomienia weryfikacji backupu,
uruchomienia odtwarzania bazy,
otrzymania informacji o wyniku operacji.
1.8. Odtworzenie do istniejącej bazy

Jeśli użytkownik wybierze istniejącą bazę:

aplikacja powinna wymagać zaznaczenia opcji zezwalającej na nadpisanie,
użytkownik powinien otrzymać czytelne ostrzeżenie,
bez zaznaczenia opcji nadpisania operacja nie powinna się rozpocząć.
1.9. Odtworzenie do nowej bazy

Użytkownik powinien mieć możliwość wpisania nazwy bazy, która jeszcze nie istnieje.

W takim przypadku aplikacja powinna odtworzyć backup pod wskazaną nową nazwą.

1.10. Informacja o trwającej operacji

Podczas backupu, kompresji lub restore aplikacja powinna wyświetlać prostą informację:

Operacja w toku


Po zakończeniu należy wyświetlić:

powodzenie operacji albo
treść ostatniego błędu.

Komunikaty nie muszą być zapisywane na stałe.

1.11. Brak operacji równoległych

Aplikacja powinna wykonywać tylko jedną operację administracyjną w danym momencie.

Jeżeli trwa backup, kompresja, restore, usuwanie albo zmniejszanie logu, kolejna operacja powinna zostać zablokowana do czasu zakończenia aktualnej.

Nie jest wymagany system kolejkowy. Wystarczy prosta blokada w ramach procesu aplikacji.

1.12. Metadane i zmniejszanie logów

Lista baz powinna prezentować nazwę, stan, przydzielony rozmiar danych i logu, sumę, liczbę aktywnych połączeń, model odzyskiwania oraz ostatni pełny backup. Brak uprawnień do opcjonalnych metadanych nie może blokować listy.

Po jawnym włączeniu funkcji konfiguracją użytkownik może zwolnić nieaktywny koniec wszystkich plików LDF bez zmiany modelu odzyskiwania albo uruchomić agresywne zmniejszenie każdego LDF do 256 MB. Drugi tryb czasowo ustawia `SIMPLE`, wykonuje `CHECKPOINT`, a następnie próbuje przywrócić wcześniejszy model. Interfejs musi ostrzegać o przerwaniu łańcucha backupów logu. Niedozwolone są `DBCC SHRINKDATABASE`, zmniejszanie plików danych i automatyczne rozłączanie sesji.

2. Wymagania techniczne
2.1. Technologia

Aplikacja zostanie przygotowana w technologii:

Node.js
Express
EJS
HTMX
mssql
Tedious


Pakiet mssql zapewnia obsługę Microsoft SQL Server w Node.js. Domyślnie korzysta ze sterownika Tedious, który jest implementacją protokołu TDS napisaną w JavaScript i działa na systemach Linux bez konieczności instalowania sterownika ODBC.

2.2. Architektura

Aplikacja będzie działała jako prosty monolit:

Przeglądarka
      |
      v
Node.js + Express
      |
      +---- połączenie TCP ----> MSSQL
      |
      +---- wspólny wolumen ---> pliki backupów


Frontend i backend będą znajdowały się w jednej aplikacji.

Nie będzie osobnego:

frontendu React,
serwera API,
serwera Nginx wewnątrz kontenera,
systemu kolejkowego,
procesu roboczego,
serwera Redis,
serwera bazodanowego dla konfiguracji aplikacji.
2.3. Interfejs użytkownika

Interfejs zostanie przygotowany jako HTML renderowany po stronie serwera przy użyciu:

EJS,
HTMX,
CSS.

HTMX będzie odpowiadał za częściowe odświeżanie interfejsu, na przykład:

pobranie listy baz po zmianie serwera,
uruchomienie backupu,
wyświetlenie wyniku operacji,
odświeżenie listy plików,
uruchomienie restore.

Nie będzie wymagane tworzenie osobnej aplikacji typu SPA.

2.4. Połączenie z MSSQL

Do komunikacji z SQL Serverem zostanie wykorzystany pakiet:

mssql


z domyślnym sterownikiem:

Tedious


Tedious komunikuje się z SQL Serverem przez protokół TDS. Pakiet nie wymaga instalowania Microsoft ODBC Driver w kontenerze aplikacji.

Konfiguracja połączenia będzie przekazywana przez zmienne środowiskowe.

Przykładowy zakres konfiguracji:

MSSQL_HOST=mssql
MSSQL_PORT=1433
MSSQL_USER=sa
MSSQL_PASSWORD=haslo
MSSQL_BACKUP_PATH=/var/opt/mssql/backup
APP_BACKUP_PATH=/app/backups

2.5. Konfiguracja serwerów

Jeśli aplikacja będzie obsługiwała jeden serwer MSSQL, konfiguracja zostanie przekazana wyłącznie przez zmienne środowiskowe.

Jeśli potrzebna będzie obsługa kilku serwerów, ich konfiguracja może zostać zapisana w prostym pliku konfiguracyjnym zamontowanym do kontenera.

Aplikacja nie będzie korzystać z bazy danych do przechowywania konfiguracji.

2.6. Współdzielony wolumen

Kontener MSSQL oraz kontener aplikacji będą korzystały z tego samego wolumenu.

SQL Server będzie widział katalog pod ścieżką:

/var/opt/mssql/backup


Aplikacja będzie widziała ten sam katalog pod ścieżką:

/app/backups


Przykładowy układ:

services:
  mssql:
    volumes:
      - backup-data:/var/opt/mssql/backup

  sql-backup-tool:
    volumes:
      - backup-data:/app/backups

volumes:
  backup-data:


W poleceniach T-SQL aplikacja musi używać ścieżki widzianej przez SQL Server. Podczas kompresji, uploadu i pobierania aplikacja będzie używała ścieżki widzianej we własnym kontenerze.

2.7. Wykonywanie backupu

Backup będzie wykonywany przez instrukcję:

BACKUP DATABASE


W zależności od wybranej opcji aplikacja zastosuje:

brak kompresji,
COMPRESSION dla natywnej kompresji MSSQL,
kompresję ZIP po utworzeniu pliku .bak,
kompresję GZIP po utworzeniu pliku .bak.

Backup powinien być wykonywany z poziomu połączenia do bazy systemowej:

master

2.8. Weryfikacja backupu

Przed restore aplikacja powinna wykonać:

RESTORE VERIFYONLY


Do ustalenia zawartości backupu i nazw plików logicznych powinna wykorzystać:

RESTORE HEADERONLY
RESTORE FILELISTONLY


Informacje uzyskane przez RESTORE FILELISTONLY zostaną wykorzystane do przygotowania instrukcji restore z właściwym mapowaniem plików.

2.9. Odtwarzanie bazy

Restore będzie realizowany przez:

RESTORE DATABASE


Aplikacja powinna obsługiwać mapowanie plików za pomocą:

WITH MOVE


W przypadku kontrolowanego nadpisania istniejącej bazy może zostać użyte:

WITH REPLACE


Opcja nadpisania będzie dostępna tylko po świadomym zaznaczeniu jej przez użytkownika.

2.10. Kompresja ZIP

Do tworzenia plików ZIP zostanie wykorzystana biblioteka Node.js obsługująca zapis strumieniowy, na przykład:

archiver


Plik .bak nie powinien być ładowany w całości do pamięci.

Przepływ:

plik .bak
    |
    v
strumień odczytu
    |
    v
ZIP
    |
    v
plik .bak.zip

2.11. Kompresja GZIP

Do GZIP zostanie wykorzystany wbudowany moduł Node.js:

node:zlib


Dodatkowa biblioteka nie będzie potrzebna.

Kompresja będzie wykonywana strumieniowo:

plik .bak
    |
    v
createReadStream
    |
    v
createGzip
    |
    v
createWriteStream

2.12. Upload plików

Upload będzie realizowany jako:

multipart/form-data


Plik powinien być zapisywany bezpośrednio na dysk, bez przechowywania całej zawartości w pamięci.

Podczas uploadu aplikacja powinna:

sprawdzić rozszerzenie,
wygenerować bezpieczną nazwę tymczasową,
zapisać plik w katalogu backupów,
po zakończeniu zmienić nazwę tymczasową na docelową.
2.13. Pobieranie plików

Pliki będą pobierane strumieniowo z katalogu backupów.

Aplikacja nie powinna:

wczytywać całego pliku do pamięci,
tworzyć kopii pliku tylko na potrzeby pobrania.

Odpowiedź HTTP powinna zawierać właściwą nazwę pliku.

2.14. Blokowanie równoległych operacji

Aplikacja będzie działać jako jeden proces Node.js.

W pamięci procesu będzie przechowywana prosta informacja:

operationInProgress = true / false


Blokada będzie dotyczyć:

backupu,
kompresji,
rozpakowania,
weryfikacji,
restore.

W przypadku próby uruchomienia drugiej operacji użytkownik otrzyma komunikat, że inna operacja jest już wykonywana.

2.15. Brak trwałych logów

Aplikacja nie będzie przechowywać historii operacji.

Bieżące informacje techniczne mogą być wysyłane na:

stdout
stderr


W razie potrzeby będzie można je podejrzeć przez:

docker logs sql-backup-tool


Poziom logowania powinien być ograniczony. W logach nie powinny pojawiać się hasła ani pełne dane połączenia.

2.16. Brak uwierzytelniania

Aplikacja nie będzie miała:

ekranu logowania,
użytkowników,
ról,
sesji użytkowników,
integracji z Entra ID,
tokenów dostępowych.

Dostęp do aplikacji będzie ograniczony na poziomie sieci lub konfiguracji Dockera.

2.17. Kontener Docker

Aplikacja będzie uruchamiana w jednym kontenerze opartym na obrazie:

FROM node:24-slim


Kontener będzie uruchamiał jeden proces:

node server.js


Nie będzie używany:

Node.js cluster,
PM2,
osobny worker,
dodatkowy proces harmonogramu.
2.18. Health check

Aplikacja powinna udostępniać prosty endpoint:

GET /health


Endpoint powinien informować, czy proces aplikacji działa.

Health check nie musi wykonywać backupu ani dodatkowych operacji administracyjnych.

3. Propozycja realizacji
3.1. Stos technologiczny

Proponowany zestaw:

Node.js 24
Express 5
EJS
HTMX
mssql
Tedious
Multer
Archiver
node:zlib
Docker

Odpowiedzialność komponentów

Node.js

środowisko uruchomieniowe aplikacji.

Express

routing,
obsługa formularzy,
endpointy download i upload,
obsługa błędów.

EJS

generowanie HTML po stronie serwera,
wspólne szablony i części interfejsu.

HTMX

wysyłanie formularzy bez pełnego przeładowania strony,
odświeżanie listy baz i plików,
wyświetlanie rezultatu operacji.

mssql i Tedious

połączenie z SQL Serverem,
wykonywanie BACKUP DATABASE,
wykonywanie RESTORE VERIFYONLY,
wykonywanie RESTORE FILELISTONLY,
wykonywanie RESTORE DATABASE.

Multer

obsługa uploadu plików na dysk.

Archiver

tworzenie plików ZIP.

node:zlib

tworzenie i rozpakowywanie plików GZIP.
3.2. Proponowana struktura projektu
sql-backup-tool/
├── server.js
├── config.js
├── database.js
├── backup.js
├── restore.js
├── compression.js
├── files.js
├── package.json
├── package-lock.json
├── Dockerfile
├── compose.yaml
├── views/
│   ├── index.ejs
│   ├── backup.ejs
│   ├── restore.ejs
│   ├── files.ejs
│   ├── servers.ejs
│   └── partials/
│       ├── message.ejs
│       └── file-list.ejs
└── public/
    └── app.css


Jeżeli aplikacja ma pozostać bardzo mała, strukturę można ograniczyć do:

sql-backup-tool/
├── server.js
├── database.js
├── files.js
├── package.json
├── package-lock.json
├── Dockerfile
├── compose.yaml
├── views/
│   └── index.ejs
└── public/
    └── app.css

3.3. Proponowane ekrany
Wykonaj backup

Ekran zawiera:

wybór serwera,
wybór bazy,
wybór kompresji,
przycisk wykonania backupu,
komunikat o wyniku.
Odtwórz bazę

Ekran zawiera:

wybór pliku backupu,
wybór serwera docelowego,
wybór trybu odtwarzania,
wybór istniejącej bazy albo wpisanie nazwy nowej,
opcję zezwolenia na nadpisanie,
ostrzeżenie przed nadpisaniem,
przycisk weryfikacji i odtworzenia.
Pliki backupów

Ekran zawiera:

listę plików,
nazwę,
wielkość,
datę,
przycisk pobierania,
przycisk uploadu.
Serwery

Jeżeli aplikacja obsługuje kilka instancji, ekran zawiera:

nazwę serwera,
adres,
przycisk testowania połączenia.

Jeśli aplikacja będzie obsługiwać wyłącznie jeden kontener MSSQL, ekran serwerów można pominąć.

3.4. Proponowane endpointy
GET  /
GET  /databases
POST /backup
GET  /files
GET  /files/:name/download
POST /files/upload
POST /restore/verify
POST /restore
GET  /servers/test
GET  /health


Endpointy mogą zwracać fragmenty HTML przygotowane przez EJS, które HTMX wstawi do odpowiednich sekcji interfejsu.

3.5. Przepływ wykonywania backupu
Użytkownik wybiera serwer
        |
        v
Aplikacja pobiera listę baz
        |
        v
Użytkownik wybiera bazę i kompresję
        |
        v
Aplikacja blokuje nowe operacje
        |
        v
SQL Server wykonuje BACKUP DATABASE
        |
        +---- bez kompresji ------> pozostaje .bak
        |
        +---- kompresja MSSQL ----> pozostaje .bak
        |
        +---- ZIP ----------------> powstaje .bak.zip
        |
        +---- GZIP ---------------> powstaje .bak.gz
        |
        v
Aplikacja zwalnia blokadę
        |
        v
Lista plików zostaje odświeżona

3.6. Przepływ odtwarzania backupu
Użytkownik wybiera plik
        |
        v
Jeśli wymagane, aplikacja rozpakowuje plik
        |
        v
RESTORE VERIFYONLY
        |
        v
RESTORE HEADERONLY
        |
        v
RESTORE FILELISTONLY
        |
        v
Użytkownik wskazuje istniejącą albo nową bazę
        |
        v
Aplikacja przygotowuje WITH MOVE
        |
        v
RESTORE DATABASE
        |
        v
Usunięcie plików tymczasowych
        |
        v
Wyświetlenie wyniku

3.7. Proponowany sposób wdrożenia

Aplikacja i SQL Server będą działać jako dwa kontenery, ale aplikacja sama będzie pojedynczym, małym kontenerem.

mssql
sql-backup-tool


Oba kontenery będą korzystać ze wspólnego wolumenu:

backup-data


Uruchomienie:

docker compose up -d


Interfejs może być dostępny lokalnie pod:

http://localhost:8080

4. Elementy wyłączone z zakresu

Zgodnie z ustaleniami aplikacja nie będzie posiadała:

systemu logowania,
użytkowników,
ról,
uwierzytelniania,
audytu,
trwałej historii operacji,
trwałych logów aplikacyjnych,
systemu kolejkowego,
harmonogramów,
automatycznych backupów,
retencji,
powiadomień,
szyfrowania backupów,
bazy danych aplikacji,
Redis,
osobnego workera,
osobnego frontendu React,
integracji ze storage S3, Azure Blob, SMB lub SFTP.


5. Punkty do rozważenia podczas realizacji

Poniższe elementy nie są nowymi wymaganiami. Są to decyzje techniczne, które warto doprecyzować przed rozpoczęciem implementacji.

5.1. Jeden czy kilka serwerów MSSQL

Należy ustalić, czy aplikacja ma obsługiwać:

dokładnie jeden kontener MSSQL,
czy kilka skonfigurowanych instancji.

Przy jednym serwerze można usunąć wybór serwera oraz zakładkę „Serwery”.
Decyzja: Jeden kontener MSSQL


5.2. Zachowanie pliku .bak po utworzeniu ZIP lub GZIP

Po poprawnej kompresji można:

zachować zarówno .bak, jak i archiwum,
usunąć .bak i pozostawić tylko plik skompresowany.

Drugi wariant zużywa mniej miejsca, ale wymaga rozpakowania przed restore.
Decyzja: Po poprawnej operacji usuwamy .bak, po poprawnym odtworzeniu bazy też.

5.3. Zachowanie przesłanego archiwum po rozpakowaniu

Po uploadzie .zip lub .gz trzeba zdecydować, czy aplikacja:

zachowuje plik archiwum i tworzy tymczasowy .bak tylko podczas restore,
rozpakowuje plik na stałe,
usuwa archiwum po rozpakowaniu.
Decyzja: zachowuje plik archiwum i tworzy tymczasowy .bak tylko podczas restore,

5.4. Maksymalny rozmiar uploadu

Warto określić przewidywany maksymalny rozmiar backupu, na przykład:

10 GB
50 GB
100 GB

Wpłynie to na konfigurację limitów HTTP oraz miejsce wymagane na wolumenie.

Decyzja: Zakładmy max na 50 GB, ale jako parametr do modyfikacji

5.5. Lokalizacja plików danych i logów po restore

Aplikacja, korzystając z RESTORE FILELISTONLY, musi przygotować WITH MOVE.

Trzeba ustalić katalog docelowy używany przez SQL Server dla:

plików danych .mdf i .ndf,
plików logów .ldf.
Decyzja: katalog definiujemy w konfiguracji kontenera

5.6. Nadpisywanie istniejącej bazy

Należy ustalić, czy nadpisanie bazy ma:

automatycznie rozłączać aktywne połączenia,
nie wykonywać restore, jeśli istnieją aktywne połączenia.

Interfejs już zakłada świadome zaznaczenie zgody na nadpisanie.
Decyzja: Urzytkownik musi zaznaczyć świadomie Automatyczne rozłaczenie i/lub nadpisanie

5.7. Dostęp sieciowy

Ponieważ aplikacja nie posiada uwierzytelniania, należy zdecydować, czy port będzie:

dostępny tylko lokalnie,
dostępny w wewnętrznej sieci,
dostępny przez VPN.

Najprostsze ograniczenie lokalne:

ports:
  - "127.0.0.1:8080:8080"

 Decyzja:  dostępny tylko lokalnie

5.8. Reakcja na przerwanie połączenia przeglądarki

Backup lub restore może trwać dłużej niż zwykłe żądanie HTTP. Należy zdecydować, czy zamknięcie karty przeglądarki:

nie wpływa na rozpoczętą operację,
ma próbować anulować operację.

Bez systemu kolejki prostsze będzie pozostawienie operacji po stronie SQL Servera do zakończenia.

 Decyzja: nie wpływa na rozpoczętą operację

5.9. Czyszczenie plików tymczasowych

Po restore skompresowanego backupu może pozostać tymczasowy plik .bak.

Należy ustalić, czy plik ma być:

usuwany zawsze po zakończeniu,
zachowywany po błędzie w celu diagnostyki,
usuwany również po przerwaniu operacji.

 Decyzja: usuwany zawsze po zakończeniu

5.10. Wersje SQL Server

Warto ustalić, które wersje mają być obsługiwane, ponieważ backupu utworzonego na nowszej wersji SQL Servera zazwyczaj nie można odtworzyć na starszej wersji.

 Decyzja: Wystarczy czytelny komunkat o nizgodności wersji

5.11. Nazewnictwo backupów

Należy ustalić ostateczny format nazw, na przykład:

NazwaBazy_2026-08-15_12-30-00.bak
NazwaBazy_2026-08-15_12-30-00.bak.zip
NazwaBazy_2026-08-15_12-30-00.bak.gz

Decyzja: Format NazwaBazy_2026-08-15_12-30-00

Podsumowanie

Docelowym rozwiązaniem będzie jedna lekka aplikacja Node.js, działająca jako jeden proces w jednym kontenerze. Express będzie obsługiwał interfejs i operacje HTTP, EJS oraz HTMX zapewnią prosty interfejs, a pakiet mssql ze sterownikiem Tedious umożliwi wykonywanie poleceń administracyjnych SQL Server bez instalowania ODBC w kontenerze.

Zakres obejmuje wyłącznie:

wybór bazy
→ backup
→ opcjonalna kompresja
→ lista plików
→ pobranie lub upload
→ weryfikacja
→ restore do istniejącej albo nowej bazy


Takie podejście pozostawia aplikację małą, czytelną i możliwą do uruchomienia jednym poleceniem docker compose up -d, bez wprowadzania infrastruktury niewymaganej w ustalonym scenariuszu.