import fs from 'node:fs';
import archiver from 'archiver';

/**
 * Zip the contents of `srcDir` into `outFile`, nested under a top-level folder
 * named `rootFolderName` (as WordPress expects for a theme/plugin zip).
 * @returns {Promise<string>} outFile
 */
export function zipDir(srcDir, outFile, rootFolderName) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outFile);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(outFile));
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(srcDir, rootFolderName);
    archive.finalize();
  });
}
