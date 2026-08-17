Changelog for new file operations (rename, compress, extract)

Summary
- Added UI actions: Rename, Compress (ZIP/GZIP/7Z), Extract (ZIP/GZIP/7Z).
- Rename preserves file suffix and edits only the base name.
- Compression creates .bak.zip, .bak.gz, or .bak.7z alongside the source; source is preserved.
- Extraction produces a .bak alongside the archive; if the target exists, extraction fails without overwriting it.
- 7Z processing rejects encrypted, multipart, unsafe, linked, or multi-entry archives and enforces fixed resource limits.
- Operations are executed as background operations with the standard operation dialog and are subject to the global operation lock.

User-facing changes
- Files table contains new action icons: Rename, ZIP, GZIP, 7Z, Extract.
- Rename opens a modal allowing editing of the base name (suffix preserved).
- Compress and Extract start background operations and show progress in the operation dialog.

Safety and validation
- Filenames validated as before: 1-200 chars, no paths, no control chars, no leading dot, allowed suffixes.
- ZIP must contain exactly one .bak; no encrypted entries; no paths.
- Extraction enforces configured maxExtractedBytes and maxCompressionRatio for ZIP.
- No overwrite: publish fails with 409 and user must resolve name conflict manually.

Developer notes
- New services: `ArchiveService` orchestrates compression/extraction.
- `FileService.rename` implements safe rename using link+unlink semantics.
- New endpoints: POST /files/rename, /files/compress, /files/extract.
- Tests updated and added under `test/unit` and `test/http`.
