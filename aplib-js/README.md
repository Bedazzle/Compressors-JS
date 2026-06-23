# aPLib-JS - LZ77 Compression with Modified Elias Gamma Coding

Pure-JavaScript port by Bedazzle (2026) of **aPLib**, the LZ77 compression algorithm by Jørgen Ibsen, with format reimplemented following apultra by Emmanuel Marty.

## About

aPLib is an LZ77 compressor using modified Elias gamma coding with four token types (literals, large matches, 7-bit matches, 4-bit matches), repeated offset optimization, and optimal parsing via forward dynamic programming with multi-arrival tracking.

## Features

- Optimal parsing with multi-arrival forward dynamic programming
- SA-IS suffix array construction for efficient match finding
- Four token types: literals, large matches, 7-bit short matches, 4-bit micro matches
- Repeated offset optimization for back-to-back references
- Compression levels 1-9 trading speed for ratio
- Modified Elias gamma coding for compact offset/length encoding

## Usage

### Browser

```html
<script src="aplib-js.js"></script>
<script>
    // Compress (level 1-9, default 5)
    const compressed = aPLib.compress(data, 5);

    // Decompress
    const decompressed = aPLib.decompress(compressed);
</script>
```

### Node.js

```javascript
const aPLib = require('./aplib-js.js');

// Compress (returns Uint8Array)
const compressed = aPLib.compress(data, 5);

// Decompress (returns Uint8Array)
const decompressed = aPLib.decompress(compressed);
```

## API

### Compression Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `aPLib.compress(data, level)` | data: Uint8Array, level: number (1-9) | Uint8Array |
| `aPLib.compressArray(data, level)` | data: Array/Uint8Array, level: number | Uint8Array |

### Decompression Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `aPLib.decompress(data)` | data: Uint8Array | Uint8Array |
| `aPLib.decompressArray(data)` | data: Array/Uint8Array | Uint8Array |

### Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `aPLib.MAX_OFFSET` | 65535 | Largest back-reference distance |
| `aPLib.MAX_LEN` | 65535 | Largest match length |

### Compression Levels

| Level | Max Arrivals | Max Matches | Notes |
|-------|-------------|-------------|-------|
| 1 | 16 | 32 | Fastest |
| 3 | 32 | 64 | |
| 5 | 64 | 128 | Default |
| 7 | 96 | 200 | |
| 9 | 128 | 256 | Maximum compression, slowest |

Higher levels increase the number of multi-arrival states tracked per position and the thoroughness of suffix array match searching, improving compression ratio at the cost of speed.

## Algorithm

aPLib uses a forward dynamic programming optimal parser:

1. **SA-IS suffix array** construction with Kasai's LCP array for O(n) match finding
2. **Multi-arrival DP** tracking multiple parse states per position, keyed by `(lastOffset, followsLiteral)` for repeated-offset optimization
3. **Four token types** with different cost/reach trade-offs:
   - **Literal** (9 bits): single uncompressed byte
   - **Large match** (variable): offset up to 65535, length up to 65535, gamma-coded
   - **7-bit match** (11 bits): offset 1-127, length 2-3
   - **4-bit match** (7 bits): offset 1-15, length 1 (or emit zero byte)
4. **Gamma2 cost breakpoints** to efficiently explore optimal match lengths
5. **Pareto-filtered matches** keeping only offset-optimal matches per length

The compressed stream uses a shared bitstream where tag bits and raw bytes are interleaved through a sliding tag byte mechanism.

## Online Demo

Open `aplib-js_test.html` in a browser to use the GUI:
- Single file compress/decompress
- Batch directory compression with progress and statistics
- Compression level selection (1-9)

## Compatibility

Raw aPLib streams (no AP32 header). Compatible with the original aPLib depacker, apultra, and Z80/6502/ARM depackers.

## Credits

Original format by Jørgen Ibsen
https://ibsensoftware.com/products_aPLib.html

Reimplemented following apultra by Emmanuel Marty
https://github.com/emmanuel-marty/apultra

JavaScript port by Bedazzle - 2026

## License

See LICENSE file for the zlib license terms.
