import * as core from '@actions/core';
import * as io from '@actions/io';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as fs from 'fs';
import * as path from 'path';

const IS_WINDOWS = process.platform === 'win32';
const IS_MACOS = process.platform === 'darwin';
const toolName = 'AdoptOpenJDK';
const os = getOsString(process.platform);
const tempDirectory = getTempDirectory(process.env['RUNNER_TEMP'] || '');

function getTempDirectory(tempDirectory: string): string {
  if (!tempDirectory) {
    let baseLocation;
    switch (process.platform) {
      case 'win32':
        baseLocation = process.env['USERPROFILE'] || 'C:\\';
        break;
      case 'darwin':
        baseLocation = '/Users';
        break;
      default:
        baseLocation = '/home';
    }
    return path.join(baseLocation, 'actions', 'temp');
  } else {
    return tempDirectory;
  }
}

function getOsString(platform: string): string {
  switch (platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'mac';
    default:
      return 'linux';
  }
}

function getFeatureVersion(version: string): string {
  return version.replace('openjdk', '');
}

function getReleaseType(release_type: string): string {
  switch (release_type) {
    case 'releases':
      return 'ga';
    case 'nightly':
      return 'ea';
    default:
      return release_type;
  }
}

function getAdoptOpenJdkUrl(
  release_type: string,
  version: string,
  jvm_impl: string,
  os: string,
  arch: string,
  heap_size: string,
  release: string
): string {
  const feature_version: string = getFeatureVersion(version);
  const release_type_parsed: string = getReleaseType(release_type);
  if (release == 'latest') {
    return `https://api.adoptopenjdk.net/v3/binary/latest/${feature_version}/${release_type_parsed}/${os}/${arch}/jdk/${jvm_impl}/${heap_size}/adoptopenjdk`;
  } else {
    const release_name = encodeURIComponent(release);
    return `https://api.adoptopenjdk.net/v3/binary/version/${release_name}/${os}/${arch}/jdk/${jvm_impl}/${heap_size}/adoptopenjdk`;
  }
}

export async function getJava(
  release_type: string,
  version: string,
  jvm_impl: string,
  arch: string,
  heap_size: string,
  release: string
): Promise<void> {
  return downloadJavaBinary(
    release_type,
    version,
    jvm_impl,
    os,
    arch,
    heap_size,
    release
  );
}

async function downloadJavaBinary(
  release_type: string,
  version: string,
  jvm_impl: string,
  os: string,
  arch: string,
  heap_size: string,
  release: string
): Promise<void> {
  const versionSpec = getCacheVersionSpec(
    release_type,
    version,
    jvm_impl,
    os,
    heap_size,
    release
  );
  let toolPath = tc.find(toolName, versionSpec, arch);

  if (toolPath) {
    core.debug(`Tool found in cache ${toolPath}`);
  } else {
    core.debug('Downloading JDK from AdoptOpenJDK');
    const release_encoded = encodeURIComponent(release);
    const url: string = getAdoptOpenJdkUrl(
      release_type,
      version,
      jvm_impl,
      os,
      arch,
      heap_size,
      release
    );
    core.info('Downloading JDK from ' + url);
    const jdkFile = await retry(() => tc.downloadTool(url), 10, 1000, true);
    const compressedFileExtension = IS_WINDOWS ? '.zip' : '.tar.gz';

    const tempDir: string = path.join(
      tempDirectory,
      'adoptopenjdk_' + Math.floor(Math.random() * 2000000000)
    );
    const jdkDir = await unzipJavaDownload(
      jdkFile,
      compressedFileExtension,
      tempDir
    );
    core.debug(`JDK extracted to ${jdkDir}`);
    toolPath = await tc.cacheDir(jdkDir, toolName, versionSpec, arch);
  }

  const extendedJavaHome = `JAVA_HOME_${version}_${arch}`;
  core.exportVariable('JAVA_HOME', toolPath);
  core.exportVariable(extendedJavaHome, toolPath);
  core.addPath(path.join(toolPath, 'bin'));
}

/**
 * Retries the given function until it succeeds given a number of retries and an interval between them. They are set
 * by default to retry 5 times with 1sec in between. There's also a flag to make the cooldown time exponential
 * @author Daniel Iñigo <danielinigobanos@gmail.com>
 * @param {Function} fn - Returns a promise
 * @param {Number} retriesLeft - Number of retries. If -1 will keep retrying
 * @param {Number} interval - Millis between retries. If exponential set to true will be doubled each retry
 * @param {Boolean} exponential - Flag for exponential back-off mode
 * @return {Promise<*>}
 */
async function retry(
  fn: Function,
  retriesLeft = 5,
  interval = 1000,
  exponential = false
): Promise<string> {
  try {
    const val = await fn();
    return val;
  } catch (error) {
    if (retriesLeft) {
      core.warning('Download failed because of: ' + error);
      core.warning('Retrying after a grace period of ' + interval + 'ms.');
      core.info(retriesLeft + ' retries left');
      await new Promise(r => setTimeout(r, interval));
      return retry(
        fn,
        retriesLeft - 1,
        exponential ? interval * 2 : interval,
        exponential
      );
    } else throw new Error('Unable to download JDK, max retries reached');
  }
}

function getCacheVersionSpec(
  release_type: string,
  version: string,
  jvm_impl: string,
  os: string,
  heap_size: string,
  release: string
): string {
  return `1.0.0-${release_type}-${version}-${jvm_impl}-${heap_size}-${release}`;
}

async function extractFiles(
  file: string,
  fileEnding: string,
  destinationFolder: string
): Promise<void> {
  const stats = fs.statSync(file);
  if (!stats) {
    throw new Error(`Failed to extract ${file} - it doesn't exist`);
  } else if (stats.isDirectory()) {
    throw new Error(`Failed to extract ${file} - it is a directory`);
  }

  switch (fileEnding) {
    case '.tar':
    case '.tar.gz':
      await tc.extractTar(file, destinationFolder);
      break;
    case '.zip':
      await tc.extractZip(file, destinationFolder);
      break;
    case '.7z':
      await tc.extract7z(file, destinationFolder);
      break;
    default:
      throw new Error(`Failed to extract ${file} - unknown compression`);
  }
}

// This method recursively finds all .pack files under fsPath and unpacks them with the unpack200 tool
async function unpackJars(fsPath: string, javaBinPath: string) {
  if (fs.existsSync(fsPath)) {
    if (fs.lstatSync(fsPath).isDirectory()) {
      for (const file in fs.readdirSync(fsPath)) {
        const curPath = path.join(fsPath, file);
        await unpackJars(curPath, javaBinPath);
      }
    } else if (path.extname(fsPath).toLowerCase() === '.pack') {
      // Unpack the pack file synchonously
      const p = path.parse(fsPath);
      const toolName = IS_WINDOWS ? 'unpack200.exe' : 'unpack200';
      const args = IS_WINDOWS ? '-r -v -l ""' : '';
      const name = path.join(p.dir, p.name);
      await exec.exec(`"${path.join(javaBinPath, toolName)}"`, [
        `${args} "${name}.pack" "${name}.jar"`
      ]);
    }
  }
}

async function unzipJavaDownload(
  repoRoot: string,
  fileEnding: string,
  destinationFolder: string
): Promise<string> {
  // Create the destination folder if it doesn't exist
  await io.mkdirP(destinationFolder);

  const jdkFile = path.normalize(repoRoot);
  const stats = fs.statSync(jdkFile);
  if (stats.isFile()) {
    await extractFiles(jdkFile, fileEnding, destinationFolder);
    const jdkDirectory = getJdkDirectory(destinationFolder);
    await unpackJars(jdkDirectory, path.join(jdkDirectory, 'bin'));
    return jdkDirectory;
  } else {
    throw new Error(`JDK argument ${jdkFile} is not a file`);
  }
}

function getJdkDirectory(destinationFolder: string): string {
  if (IS_MACOS) {
    return path.join(
      destinationFolder,
      fs.readdirSync(destinationFolder)[0],
      'Contents',
      'Home'
    );
  } else {
    return path.join(destinationFolder, fs.readdirSync(destinationFolder)[0]);
  }
}
