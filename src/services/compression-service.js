import { createReadStream, createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { ZipArchive } from 'archiver';

async function removeQuietly(filePath) {
  await unlink(filePath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

export async function createGzipArchive(sourcePath, targetPath) {
  try {
    await pipeline(createReadStream(sourcePath), createGzip(), createWriteStream(targetPath, { flags: 'wx' }));
  } catch (error) {
    await removeQuietly(targetPath);
    throw error;
  }
}

export async function createZipArchive(sourcePath, targetPath, entryName) {
  const output = createWriteStream(targetPath, { flags: 'wx' });
  const archive = new ZipArchive({ forceZip64: true, zlib: { level: 6 } });
  const completion = new Promise((resolve, reject) => {
    output.once('close', resolve);
    output.once('error', reject);
    archive.once('error', reject);
  });

  archive.pipe(output);
  archive.file(sourcePath, { name: entryName });
  archive.finalize();

  try {
    await completion;
  } catch (error) {
    archive.abort();
    output.destroy();
    await removeQuietly(targetPath);
    throw error;
  }
}