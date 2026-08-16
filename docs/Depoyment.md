# Budowanie i publikowanie obrazu Docker

Poniższe polecenia należy wykonywać w katalogu głównym projektu, w którym znajdują się `Dockerfile` i `package.json`. Do publikacji potrzebne są Docker Engine oraz konto w [Docker Hub](https://hub.docker.com/).

## 1. Przygotowanie aplikacji

Przed zbudowaniem obrazu zalecane jest zainstalowanie zależności i uruchomienie testów:

```powershell
npm ci
npm test
```

Obraz korzysta z Node.js 24 Alpine, instaluje wyłącznie zależności produkcyjne i uruchamia aplikację jako użytkownik bez uprawnień administratora.

## 2. Zbudowanie obrazu lokalnego

Domyślna nazwa używana w `compose.yaml` to `mssql-backup-tool:latest`:

```powershell
docker build --pull -t mssql-backup-tool:latest .
```

Opcja `--pull` wymusza sprawdzenie, czy dostępna jest nowsza wersja bazowego obrazu `node:24-alpine`.

Po zbudowaniu można sprawdzić obraz:

```powershell
docker image inspect mssql-backup-tool:latest
docker run --rm -p 127.0.0.1:8080:8080 mssql-backup-tool:latest
```

Samo uruchomienie obrazu bez konfiguracji połączenia z SQL Serverem może nie umożliwić korzystania z funkcji backupu i restore. Pełne środowisko lokalne uruchamia się poleceniem:

```powershell
docker compose up -d --build
```

## 3. Zmiana nazwy i wersji obrazu

Pełna nazwa obrazu publikowanego w Docker Hub ma format:

```text
<konto-lub-organizacja>/<repozytorium>:<tag>
```

Nazwy konta i repozytorium powinny być zapisane małymi literami. Przykład dla konta `moje-konto` i wersji `0.1.0`:

```powershell
docker tag mssql-backup-tool:latest moje-konto/mssql-backup-tool:0.1.0
docker tag mssql-backup-tool:latest moje-konto/mssql-backup-tool:latest
```

Można też od razu zbudować obraz pod nazwą docelową:

```powershell
docker build --pull -t moje-konto/mssql-backup-tool:0.1.0 -t moje-konto/mssql-backup-tool:latest .
```

Zalecane jest publikowanie niezmiennego tagu wersji, np. `0.1.0`, oraz opcjonalne aktualizowanie tagu `latest`. Tag `latest` nie oznacza automatycznie najnowszej wersji — jest zwykłym tagiem, który trzeba jawnie opublikować.

Aby zmienić lokalną nazwę używaną przez Compose, należy zmodyfikować pole `image` usługi `sql-backup-tool` w `compose.yaml`, na przykład:

```yaml
image: moje-konto/mssql-backup-tool:0.1.0
```

Sekcja `build: .` nadal spowoduje lokalne budowanie. Jeśli środowisko ma wyłącznie pobierać gotowy obraz z Docker Hub, należy usunąć `build: .` i pozostawić samo `image`.

## 4. Utworzenie repozytorium w Docker Hub

1. Zaloguj się w serwisie Docker Hub.
2. Wybierz **Create repository**.
3. Ustaw nazwę, np. `mssql-backup-tool`.
4. Wybierz widoczność publiczną albo prywatną.
5. Nie umieszczaj haseł, pliku `.env`, backupów ani innych sekretów w obrazie.

Repozytorium może również zostać utworzone automatycznie podczas pierwszego wysłania obrazu, zależnie od ustawień i uprawnień konta. Jawne utworzenie repozytorium pozwala wcześniej ustawić jego widoczność i opis.

## 5. Logowanie do Docker Hub

Najbezpieczniej użyć tokenu dostępu zamiast hasła konta. Token można utworzyć w ustawieniach Docker Hub w sekcji **Personal access tokens**.

Logowanie interaktywne:

```powershell
docker login --username moje-konto
```

Po wyświetleniu monitu należy wkleić token. Nie należy zapisywać tokenu w repozytorium ani przekazywać go bezpośrednio jako argument polecenia.

## 6. Publikacja obrazu

Wyślij tag wersji i tag `latest`:

```powershell
docker push moje-konto/mssql-backup-tool:0.1.0
docker push moje-konto/mssql-backup-tool:latest
```

Następnie zweryfikuj publikację, pobierając obraz:

```powershell
docker pull moje-konto/mssql-backup-tool:0.1.0
docker image inspect moje-konto/mssql-backup-tool:0.1.0
```

W Docker Hub należy sprawdzić, czy oba tagi są widoczne i czy publikacja zakończyła się bez błędów.

## 7. Publikacja obrazu wieloplatformowego

Jeśli obraz ma działać zarówno na komputerach `amd64`, jak i `arm64`, można użyć Buildx. Polecenie buduje manifest wieloplatformowy i od razu publikuje go w Docker Hub:

```powershell
docker buildx create --name mssql-backup-builder --use
docker buildx build --pull --platform linux/amd64,linux/arm64 -t moje-konto/mssql-backup-tool:0.1.0 -t moje-konto/mssql-backup-tool:latest --push .
```

Builder tworzy się tylko raz. Przy kolejnych publikacjach wystarczy wykonać `docker buildx build`. Dostępność architektur obrazu można sprawdzić poleceniem:

```powershell
docker buildx imagetools inspect moje-konto/mssql-backup-tool:0.1.0
```

## 8. Uruchomienie opublikowanego obrazu przez Compose

Po ustawieniu w `compose.yaml`:

```yaml
image: moje-konto/mssql-backup-tool:0.1.0
```

i usunięciu `build: .`, środowisko można zaktualizować poleceniami:

```powershell
docker compose pull sql-backup-tool
docker compose up -d sql-backup-tool
```

W środowisku produkcyjnym zalecane jest używanie konkretnego tagu wersji zamiast `latest`, ponieważ zapewnia to powtarzalne wdrożenia i prostszy powrót do wcześniejszej wersji.

## 9. Publikacja kolejnej wersji

Dla każdej kolejnej wersji należy:

1. Uruchomić testy.
2. Wybrać nowy tag, np. `0.2.0`.
3. Zbudować obraz z nowym tagiem.
4. Przetestować obraz lokalnie.
5. Opublikować tag wersji.
6. Jeśli wersja jest stabilna, zaktualizować i opublikować również `latest`.
7. Ustawić nowy tag w środowisku docelowym i odtworzyć kontener.

Nie należy nadpisywać istniejących tagów wersji, takich jak `0.1.0`. Ułatwia to identyfikację uruchomionego kodu oraz bezpieczne wycofanie wdrożenia.
