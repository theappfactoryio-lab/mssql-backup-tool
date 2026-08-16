# Building and Publishing the Docker Image

Run the commands below from the project root directory, where `Dockerfile` and `package.json` are located. Local builds require Docker Engine, while publishing to [Docker Hub](https://hub.docker.com/) is handled automatically by GitHub Actions.

## 1. Preparing the Application

Before building the image, it is recommended to install the dependencies and run the tests:

```powershell
npm ci
npm test
```

The image uses Node.js 24 Alpine, installs production dependencies only, and runs the application as a non-root user.

## 2. Building the Image Locally

The default image name used in `compose.yaml` is `mssql-backup-tool:latest`:

```powershell
docker build --pull -t mssql-backup-tool:latest .
```

The `--pull` option checks whether a newer version of the `node:24-alpine` base image is available.

After the build, you can inspect and run the image:

```powershell
docker image inspect mssql-backup-tool:latest
docker run --rm -p 127.0.0.1:8080:8080 mssql-backup-tool:latest
```

Running the image without the SQL Server connection configuration and `AUTH_USERNAME`/`AUTH_PASSWORD` credentials will not start a fully functional application. HTTP Basic authentication is enabled by default; it can be explicitly disabled with `AUTH_ENABLED=false`. The default language is configured with `APP_LANGUAGE` (`en`, `de`, `es`, or `pl`; the default is `en`); a language selected in the UI is stored separately in the browser. Start the complete local environment with:

```powershell
docker compose up -d --build
```

When exposing the web interface outside localhost, terminate TLS at a reverse proxy and use HTTPS only. After changing the login credentials, recreate or restart the application container.

## 3. Automatic Publishing with GitHub Actions

Images are built and published automatically by the `.github/workflows/docker-image.yml` workflow. There is no need to log in to Docker Hub locally, tag images manually, or run `docker push`.

The target image repository is:

```text
theappfactoryio/mssql-backup-tool
```

The workflow runs in two cases:

- after every push to the `main` branch, it publishes an image with the `latest` tag and a tag containing the commit SHA;
- after a Git tag in the `vMAJOR.MINOR.PATCH` format, such as `v1.2.3`, is pushed, it publishes versioned image tags.

Docker Buildx is used for building. Image layers are stored in the GitHub Actions cache, which speeds up subsequent workflow runs.

## 4. Configuring Docker Hub and GitHub Secrets

The `theappfactoryio/mssql-backup-tool` repository must exist on Docker Hub, and the account used by the workflow must have permission to push to it.

Create an access token in Docker Hub under **Account settings → Personal access tokens**. Then configure two secrets in the GitHub repository under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `DOCKER_USERNAME` | The Docker Hub user or organization name used for authentication |
| `DOCKER_TOKEN` | A Docker Hub token with permission to push the image |

The token must not be stored in the source code, `.env` file, documentation, or Git history. The workflow passes the secrets directly to `docker/login-action`.

## 5. Published Image Tags

A push to `main` publishes:

- `latest` — the newest image from the `main` branch;
- `sha-<commit>` — an image associated with a specific commit.

The Git tag `v1.2.3` publishes:

- `1.2.3` — the exact, immutable release version;
- `1.2` — the newest patch release in the `1.2` series;
- `1` — the newest release in the `1` major-version series;
- `sha-<commit>` — an image associated with a specific commit.

The `v` prefix is used only in the Git tag and is removed from the Docker image tag. For reproducible deployments, use a complete version such as `1.2.3` instead of `latest`, `1`, or `1.2`.

## 6. Publishing `latest`

Run the tests before pushing changes:

```powershell
npm ci
npm test
```

Then commit the changes and push them to `main`:

```powershell
git add .
git commit -m "Describe the changes"
git push origin main
```

The push starts the **Build and Push Docker Image** workflow and updates:

```text
theappfactoryio/mssql-backup-tool:latest
```

The `latest` tag points to the current code from `main`; it is not an immutable release version.

## 7. Publishing a Version

The project uses semantic versioning in the `MAJOR.MINOR.PATCH` format:

- `MAJOR` — backward-incompatible changes;
- `MINOR` — backward-compatible features;
- `PATCH` — backward-compatible bug fixes.

To publish version `1.2.3`, for example:

1. Ensure that all changes are on `main` and that the tests pass.
2. Pull the latest state of the branch.
3. Create an annotated Git tag.
4. Push the tag to GitHub.

```powershell
git switch main
git pull origin main
npm ci
npm test
git tag -a v1.2.3 -m "Release 1.2.3"
git push origin v1.2.3
```

After the tag is pushed, GitHub Actions automatically builds and publishes the `1.2.3`, `1.2`, `1`, and `sha-<commit>` images.

Do not reuse or move a published version tag. If version `1.2.3` requires a fix, publish a new version such as `1.2.4`.

## 8. Verifying the Publication

You can monitor the publication in the GitHub repository under **Actions → Build and Push Docker Image**. All workflow steps should complete successfully.

After the workflow completes, check the tags on Docker Hub or pull a specific version:

```powershell
docker pull theappfactoryio/mssql-backup-tool:1.2.3
docker image inspect theappfactoryio/mssql-backup-tool:1.2.3
```

You can also run the versioned image locally with the appropriate environment configuration.

## 9. Running the Published Image with Compose

To use the image from Docker Hub, set the complete version in `compose.yaml`:

```yaml
image: theappfactoryio/mssql-backup-tool:1.2.3
```

If the environment should only pull the prebuilt image, remove the `build: .` field from the `sql-backup-tool` service. Then pull the image and recreate the container:

```powershell
docker compose pull sql-backup-tool
docker compose up -d sql-backup-tool
```

Use an exact version tag in target environments. This provides reproducible deployments and makes rolling back to an earlier version straightforward.

## 10. Publishing the Next Version

For each subsequent release:

1. Commit and push the changes to `main`.
2. Check the tests and the workflow result for `main`.
3. Choose a new SemVer number, such as `1.2.4`, `1.3.0`, or `2.0.0`.
4. Create a Git tag with the `v` prefix.
5. Push the tag to GitHub.
6. Check the workflow and the published tags on Docker Hub.
7. Update the exact image version in the target environment.

Example of the next patch release:

```powershell
git tag -a v1.2.4 -m "Release 1.2.4"
git push origin v1.2.4
```

GitHub Actions handles image publishing, tagging, and authentication with Docker Hub.
