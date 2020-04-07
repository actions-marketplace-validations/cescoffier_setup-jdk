"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const installer = __importStar(require("./installer"));
const path = __importStar(require("path"));
async function run() {
    try {
        // Type of release. Either a release version, known as General Availability ("ga") or an Early Access ("ea")
        const release_type = getInput('release_type', { required: false }) || 'ga';
        // OpenJDK feature release version, example: "8", "11", "13".
        const javaVersion = getInput('java-version', { required: true });
        // OpenJDK implementation, example: "hotspot", "openj9".
        const openjdk_impl = getInput('openjdk_impl', { required: false }) || 'hotspot';
        // Architecture of the JDK, example: "x64", "x32", "arm", "ppc64", "s390x", "ppc64le", "aarch64", "sparcv9".
        const arch = getInput('architecture', { required: false }) || 'x64';
        // Heap size for OpenJ9, example: "normal", "large" (for heaps >=57 GiB).
        const heap_size = getInput('heap_size', { required: false }) || 'normal';
        // Exact release of OpenJDK, example: "latest", "jdk-11.0.4+11.4", "jdk8u172-b00-201807161800".
        const release = getInput('release', { required: false }) || 'latest';
        await installer.getJava(release_type, javaVersion, openjdk_impl, arch, heap_size, release);
        const matchersPath = path.join(__dirname, '..', '.github');
        console.log(`##[add-matcher]${path.join(matchersPath, 'java.json')}`);
    }
    catch (error) {
        core.setFailed(error.message);
    }
}
/**
 * Gets the value of an input.  The value is also trimmed.
 * IMPORTANT: Unlike `core.getInput`, this version also searches to variants where the "-" are replaced
 * by "_".
 * @param     name     name of the input to get
 * @param     options  optional. See InputOptions.
 * @returns   string
 */
function getInput(name, options) {
    let val = process.env[`INPUT_${name
        .replace(/ /g, '_')
        .replace('-', '_')
        .toUpperCase()}`] || '';
    if (!val) {
        val = process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] || '';
    }
    if (options && options.required && !val) {
        throw new Error(`Input required and not supplied: ${name}`);
    }
    return val.trim();
}
run();
