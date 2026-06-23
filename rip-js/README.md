# RIP-JS - RIP (Real Information Packer) Compression in JavaScript

Pure-JavaScript port by Bedazzle (2026) of **RIP 0.2x** (Real Information Packer), the LZ77 + Huffman compression format by Roman Petrov (Mesur'a), supporting both RIP and mRIP (modified RIP) variants.

## About

RIP is an LZ77-based compressor with canonical Huffman coding, using a 3-level tree structure (pre-tree, main tree, distance tree) and DEFLATE-style extra bits for lengths and distances. The format was designed for the ZX Spectrum platform.

## Features

- Both RIP and mRIP format support
- LSB-first bitstream with sentinel-based byte reading
- 3-level Huffman tree system: pre-tree (18 symbols) encodes main tree (288 symbols) and distance tree (32 symbols)
- LLEN variable-length encoding for match lengths and distances
- Multi-pass compression: greedy parse for frequency estimation, then optimal DP parsing at high levels
- Compression levels 1-9 trading speed for ratio
- Repeat-last-offset optimization (RIP format)

## Usage

### Browser

```html
<script src="rip-js.js"></script>
<script>
    // Compress RIP (level 1-9, default 5)
    const compressed = RIP.compress(data, 5);

    // Decompress RIP
    const decompressed = RIP.decompress(compressed);

    // Compress mRIP
    const compressedMrip = RIP.compressMrip(data, 5);

    // Decompress mRIP
    const decompressedMrip = RIP.decompressMrip(compressedMrip);
</script>
```

### Node.js

```javascript
const RIP = require('./rip-js.js');

// Compress RIP (returns Uint8Array)
const compressed = RIP.compress(data, 5);

// Decompress RIP (returns Uint8Array)
const decompressed = RIP.decompress(compressed);

// Compress/decompress mRIP
const compressedMrip = RIP.compressMrip(data, 5);
const decompressedMrip = RIP.decompressMrip(compressedMrip);
```

## API

### Compression Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `RIP.compress(data, level)` | data: Uint8Array, level: number (1-9) | Uint8Array |
| `RIP.compressMrip(data, level)` | data: Uint8Array, level: number (1-9) | Uint8Array |
| `RIP.compressArray(data, level)` | data: Array/Uint8Array, level: number | Uint8Array |

### Decompression Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `RIP.decompress(data)` | data: Uint8Array | Uint8Array |
| `RIP.decompressMrip(data)` | data: Uint8Array | Uint8Array |
| `RIP.decompressArray(data)` | data: Array/Uint8Array | Uint8Array |

### Compression Levels

| Level | Max Search Distance | Strategy |
|-------|---------------------|----------|
| 1-2 | 256 | Greedy matching |
| 3-4 | 2048 | Greedy matching |
| 5-6 | 8192 | Greedy matching |
| 7-8 | 32768 | Optimal DP parsing |
| 9 | 49152 | Optimal DP parsing |

### RIP vs mRIP

| Feature | RIP | mRIP |
|---------|-----|------|
| Pre-tree nibble order | forward (0-17) | reverse (17-0) |
| Distance code 0 | repeat last offset | regular LLEN code |
| Z80 depacker size | 228 bytes | 218 bytes |

## Algorithm

RIP uses a 3-level Huffman tree system:

1. **Pre-tree** (18 symbols): Code lengths stored as 4-bit nibbles, used to decode the main and distance trees
2. **Main tree** (288 symbols): Encodes literals (0-255), end marker (256), and match length codes (257-287)
3. **Distance tree** (32 symbols): Encodes distance codes with LLEN extra bits

Match encoding:
- Length and distance values use LLEN variable-length encoding with extra bits
- For offsets >= 256, match length is automatically incremented by 1
- RIP format supports repeat-last-offset via distance code 0

## Online Demo

Open `rip-js_test.html` in a browser to use the GUI:
- Single file compress/decompress (RIP and mRIP)
- Batch directory compression with progress and statistics
- Compression level selection (1-9)

## Compatibility

Raw compressed stream format (no file headers). Compatible with Z80 depackers:
- `derip_small.asm` (228 bytes) for RIP format
- `demrip_small.asm` (218 bytes) for mRIP format

From [uniabis/z80depacker](https://github.com/uniabis/z80depacker)

## Credits

Original format by Roman Petrov (Mesur'a)
Z80 decompressor reference by uniabis

JavaScript port by Bedazzle - 2026

## License

See LICENSE file for the BSD 3-Clause license terms.
