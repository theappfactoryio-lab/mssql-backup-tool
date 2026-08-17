import { createReadStream, createWriteStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { ZipArchive } from 'archiver';

function progressReporter(totalBytes, onProgress) {
  let processedBytes = 0;
  let lastReported = -1;
  return new Transform({
    transform(chunk, encoding, callback) {
      processedBytes += chunk.length;
      const progress = totalBytes === 0 ? 100 : Math.min(100, Math.floor(processedBytes * 100 / totalBytes));
      if (progress === 100 || progress >= lastReported + 5) {
        lastReported = progress;
        onProgress?.({ progress, processedBytes, totalBytes });
      }
      callback(null, chunk);
    },
  });
}

async function removeQuietly(filePath) {
  await unlink(filePath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

export async function createGzipArchive(sourcePath, targetPath, { onProgress } = {}) {
  try {
    const sourceInfo = await stat(sourcePath);
    onProgress?.({ progress: 0, processedBytes: 0, totalBytes: sourceInfo.size });
    await pipeline(
      createReadStream(sourcePath), progressReporter(sourceInfo.size, onProgress),
      createGzip(), createWriteStream(targetPath, { flags: 'wx' }),
    );
  } catch (error) {
    await removeQuietly(targetPath);
    throw error;
  }
}

export async function createZipArchive(sourcePath, targetPath, entryName, { onProgress } = {}) {
  const sourceInfo = await stat(sourcePath);
  const output = createWriteStream(targetPath, { flags: 'wx' });
  const archive = new ZipArchive({ forceZip64: true, zlib: { level: 6 } });
  const completion = new Promise((resolve, reject) => {
    output.once('close', resolve);
    output.once('error', reject);
    archive.once('error', reject);
  });

  archive.pipe(output);
  onProgress?.({ progress: 0, processedBytes: 0, totalBytes: sourceInfo.size });
  archive.append(createReadStream(sourcePath).pipe(progressReporter(sourceInfo.size, onProgress)), { name: entryName });
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