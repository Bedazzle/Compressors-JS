# LZSA2-JS - LZ77 Compression with Byte-Aligned Nibble Encoding

Pure-JavaScript port by Bedazzle (2026) of **LZSA2**, the byte-aligned LZ77 compression algorithm by Emmanuel Marty.

## About

LZSA2 is an LZ77 compressor using byte-aligned nibble encoding with five offset modes (5/9/13/16-bit + repeated offset), optimal parsing via forward dynamic programming with multi-arrival tracking, and compact variable-length encoding for literals and match lengths.

## Features

- Optimal parsing with multi-arrival forward dynamic programming
- SA-IS suffix array construction for efficient match finding
- Five offset encoding modes: 5-bit, 9-bit, 13-bit, 16-bit, and repeated offset
- Byte-aligned nibble encoding (no bit-level I/O)
- Compression levels 1-9 trading speed for ratio
- Compact literal and match length encoding with nibble extensions

## Usage

### Browser

```html
<script src="lzsa2-js.js"></script>
<script>
    // Compress (level 1-9, default 5)
    const compressed = LZSA2.compress(data, 5);

    // Decompress
    const decompressed = LZSA2.decompress(compressed);
</script>
```

### Node.js

```javascript
const LZSA2 = require('./lzsa2-js.js');

// Compress (returns Uint8Array)
const compressed = LZSA2.compress(data, 5);

// Decompress (returns Uint8Array)
const decompressed = LZSA2.decompress(compressed);
```

## API

### Compression Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `LZSA2.compress(data, level)` | data: Uint8Array, level: number (1-9) | Uint8Array |
| `LZSA2.compressArray(data, level)` | data: Array/Uint8Array, level: number | Uint8Array |

### Decompression Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `LZSA2.decompress(data)` | data: Uint8Array | Uint8Array |
| `LZSA2.decompressArray(data)` | data: Array/Uint8Array | Uint8Array |

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

LZSA2 uses a forward dynamic programming optimal parser:

1. **SA-IS suffix array** construction with Kasai's LCP array for O(n) match finding
2. **Multi-arrival DP** tracking multiple parse states per position, keyed by `lastOffset` for repeated-offset optimization
3. **Command structure**: each command consists of a token byte, optional literal length extension, literal bytes, offset data, and optional match length extension
4. **Five offset modes** with different cost/reach trade-offs:
   - **5-bit** (4 extra bits): offset 1-32
   - **9-bit** (8 extra bits): offset 1-512
   - **13-bit** (12 extra bits): offset 513-8704
   - **16-bit** (16 extra bits): offset 1-65535
   - **Rep** (0 extra bits): reuses previous offset
5. **Nibble-packed encoding**: nibbles share bytes (first nibble gets high 4 bits, second gets low 4 bits)
6. **Pareto-filtered matches** keeping only offset-optimal matches per length

## Online Demo

Open `lzsa2-js_test.html` in a browser to use the GUI:
- Single file compress/decompress
- Batch directory compression with progress and statistics
- Compression level selection (1-9)

## Compatibility

Raw LZSA2 block format (no framing headers). Compatible with the original `lzsa` tool (`-f2 -r` mode) and all platform depackers (Z80, 6502, 8088, 68000).

## Credits

Original format and lzsa tool by Emmanuel Marty
https://github.com/emmanuel-marty/lzsa

JavaScript port by Bedazzle - 2026

## License

See LICENSE file for the zlib license terms.
