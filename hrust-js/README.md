# HRUST-JS - Hrust 1.3 Compression in JavaScript

Pure-JavaScript port by Bedazzle (2026) of **Hrust 1.3**, the LZ77 compression format by Dmitry Pyankov (ZX Spectrum), reimplemented following OHC (Optimal Hrust Compressor) by Eugene Larchenko.

## About

Hrust 1.3 is an LZ77-based compressor using MSB-first 16-bit control word bitstreams with interleaved data bytes, a variable D register window, RIR (Repeat In Range) tokens, and backward dynamic programming optimal parsing.

## Features

- Backward DP optimal parser minimizing compressed size
- MSB-first 16-bit control word bitstream with interleaved data bytes
- Variable D register (2-8) controlling extended match window
- Six token types: single literal, count=1 match (6 bits), count=2 match (10-13 bits), count>=3 match (variable), RIR, and multi-literal blocks
- Compression levels 1-9 trading speed for ratio
- Compatible with standard Z80 depackers (dehrust)

## Usage

### Browser

```html
<script src="hrust-js.js"></script>
<script>
    // Compress (level 1-9, default 5)
    const compressed = HRUST.compress(data, 5);

    // Decompress
    const decompressed = HRUST.decompress(compressed);
</script>
```

### Node.js

```javascript
const HRUST = require('./hrust-js.js');

// Compress (returns Uint8Array)
const compressed = HRUST.compress(data, 5);

// Decompress (returns Uint8Array)
const decompressed = HRUST.decompress(compressed);
```

## API

### Compression Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `HRUST.compress(data, level)` | data: Uint8Array, level: number (1-9) | Uint8Array |
| `HRUST.compressArray(data, level)` | data: Array/Uint8Array, level: number | Uint8Array |

### Decompression Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `HRUST.decompress(data)` | data: Uint8Array | Uint8Array |
| `HRUST.decompressArray(data)` | data: Array/Uint8Array | Uint8Array |

### Compression Levels

| Level | Max Search Distance | Notes |
|-------|---------------------|-------|
| 1 | 512 | Fastest |
| 3 | 2048 | |
| 5 | 8192 | Default |
| 7 | 32768 | |
| 9 | 65535 | Maximum compression, slowest |

Higher levels increase the match search distance, improving compression ratio at the cost of speed. Input size is limited to 65535 bytes (ZX Spectrum address space).

## Algorithm

Hrust 1.3 uses a backward dynamic programming optimal parser:

1. **Brute-force match finder** scanning backward for matches at each position (sufficient for ZX Spectrum file sizes up to ~48K)
2. **Backward DP** tracking state `(position, D_register)` with D cycling through 2-8, minimizing total compressed bits
3. **Token types** with different cost/reach trade-offs:
   - **Single literal** (9 bits): 1 control bit + 1 raw byte
   - **Count=1 match** (6 bits): 3-bit prefix + 3-bit distance (-1 to -8)
   - **Count=2 match** (10-13 bits): 3-bit prefix + variable distance encoding
   - **Count>=3 match** (variable): pair-encoded count + 4-mode distance encoding
4. **D register** cycling (2->3->4->...->8->1->2) controls the extended match window for distances beyond -512, with each change costing 13 bits
5. **16-bit MSB-first control words** interleaved with raw data bytes in the output stream

## Online Demo

Open `hrust-js_test.html` in a browser to use the GUI:
- Single file compress/decompress
- Batch directory compression with progress and statistics
- Compression level selection (1-9)

## Compatibility

HR format with header: `'H' 'R'` + original size (LE16) + compressed size (LE16) + 6-byte backup. Compatible with the original Hrust 1.3 format and OHC output. Decompressible by standard Z80 depackers (dehrust).

## Credits

Original format by Dmitry Pyankov
OHC (Optimal Hrust Compressor) reference implementation by Eugene Larchenko
https://github.com/specke/ohc

JavaScript port by Bedazzle - 2026

## License

See LICENSE file for the MIT license terms.
