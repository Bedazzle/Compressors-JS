(function(){
/*
 * rcs-js — RCS (Re-ordered Compressed Screen) ZX Spectrum screen transform in JavaScript
 * Original RCS by Einar Saukas — https://github.com/einar-saukas/RCS
 * Transform ported from the SpectraLab project (picture_format.js).
 * JavaScript port by Bedazzle, 2026.
 * License: BSD-3-Clause — see LICENSE file.
 */

const SCREEN_SIZE = 6912;  // full SCR: 6144 bitmap + 768 attributes
const BITMAP_SIZE = 6144;  // bitmap area only

// ---------------------------------------------------------------------------
// Core reorder transform (lossless bijection on the 6144 bitmap bytes)
// ---------------------------------------------------------------------------

/**
 * Reorder standard SCR data to RCS layout.
 * Rearranges the 6144 bitmap bytes for better compression; attributes unchanged.
 * @param {Uint8Array|ArrayLike<number>} scrBytes - 6912-byte standard SCR data
 * @returns {Uint8Array} 6912-byte RCS-ordered data
 */
function reorderScrToRcs(scrBytes) {
    const scr = scrBytes instanceof Uint8Array ? scrBytes : new Uint8Array(scrBytes);
    if (scr.length !== SCREEN_SIZE) {
        throw new Error('RCS: expected ' + SCREEN_SIZE + ' bytes, got ' + scr.length);
    }
    const output = new Uint8Array(SCREEN_SIZE);
    let i = 0;
    for (let s = 0; s < 3; s++) {          // sector (screen third)
        for (let c = 0; c < 32; c++) {     // column
            for (let r = 0; r < 8; r++) {  // character row within third
                for (let l = 0; l < 8; l++) {  // pixel line within character
                    output[i++] = scr[s * 2048 + l * 256 + r * 32 + c];
                }
            }
        }
    }
    // Copy attributes unchanged
    output.set(scr.subarray(BITMAP_SIZE, SCREEN_SIZE), BITMAP_SIZE);
    return output;
}

/**
 * Reorder RCS data back to standard SCR layout (inverse of reorderScrToRcs).
 * @param {Uint8Array|ArrayLike<number>} rcsBytes - 6912-byte RCS-ordered data
 * @returns {Uint8Array} 6912-byte standard SCR data
 */
function reorderRcsToScr(rcsBytes) {
    const rcs = rcsBytes instanceof Uint8Array ? rcsBytes : new Uint8Array(rcsBytes);
    if (rcs.length !== SCREEN_SIZE) {
        throw new Error('RCS: expected ' + SCREEN_SIZE + ' bytes, got ' + rcs.length);
    }
    const output = new Uint8Array(SCREEN_SIZE);
    let i = 0;
    for (let s = 0; s < 3; s++) {
        for (let c = 0; c < 32; c++) {
            for (let r = 0; r < 8; r++) {
                for (let l = 0; l < 8; l++) {
                    output[s * 2048 + l * 256 + r * 32 + c] = rcs[i++];
                }
            }
        }
    }
    output.set(rcs.subarray(BITMAP_SIZE, SCREEN_SIZE), BITMAP_SIZE);
    return output;
}

// ---------------------------------------------------------------------------
// ZX0 / ZX7 combo wrappers (resolve the codecs from the host environment)
// ---------------------------------------------------------------------------

const root = (typeof globalThis !== 'undefined') ? globalThis
    : (typeof window !== 'undefined') ? window
    : (typeof self !== 'undefined') ? self : this;

function resolveCodec(name) {
    if (root && root[name]) return root[name];
    if (typeof require === 'function') {
        try { return require('../' + name.toLowerCase() + '-js/' + name.toLowerCase() + '-js.js'); }
        catch (e) { /* fall through */ }
    }
    throw new Error('RCS: ' + name + ' codec not loaded (load ' + name.toLowerCase() + '-js.js first)');
}

/**
 * RCS + ZX7: reorder then ZX7-compress.
 * @param {Uint8Array} scrBytes - 6912-byte SCR screen
 * @param {boolean} [backwards=false] - emit a backwards ZX7 stream
 * @returns {Uint8Array} compressed data
 */
function compressZX7(scrBytes, backwards) {
    const ZX7 = resolveCodec('ZX7');
    const rcs = reorderScrToRcs(scrBytes);
    const r = backwards ? ZX7.compressBackwards(rcs) : ZX7.compress(rcs);
    return r.data || r;
}

/**
 * Inverse of compressZX7: ZX7-decompress then un-reorder to a 6912-byte screen.
 */
function decompressZX7(data, backwards) {
    const ZX7 = resolveCodec('ZX7');
    const rcs = backwards ? ZX7.decompressBackwards(data) : ZX7.decompress(data);
    return reorderRcsToScr(rcs);
}

/**
 * RCS + ZX0: reorder then ZX0-compress.
 * @param {Uint8Array} scrBytes - 6912-byte SCR screen
 * @param {boolean} [backwards=false] - emit a backwards ZX0 stream
 * @returns {Uint8Array} compressed data
 */
function compressZX0(scrBytes, backwards) {
    const ZX0 = resolveCodec('ZX0');
    const rcs = reorderScrToRcs(scrBytes);
    const r = ZX0.compress(rcs, 0, !!backwards);
    return r.data || r;
}

/**
 * Inverse of compressZX0: ZX0-decompress then un-reorder to a 6912-byte screen.
 */
function decompressZX0(data, backwards) {
    const ZX0 = resolveCodec('ZX0');
    const rcs = ZX0.decompress(data, !!backwards);
    return reorderRcsToScr(rcs);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const RCS = {
    reorderScrToRcs,
    reorderRcsToScr,
    compressZX7,
    decompressZX7,
    compressZX0,
    decompressZX0,
    SCREEN_SIZE,
    BITMAP_SIZE
};

if (typeof window !== 'undefined') {
    window.RCS = RCS;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RCS;
}
})();
