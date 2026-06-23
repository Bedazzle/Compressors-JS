# BitBuster-JS - LZ77 Compression with Elias Gamma Coding

Pure-JavaScript port by Bedazzle (2026) of **BitBuster 1.2 and BitBuster 2**, the LZ77 compression formats by Arjan Bakker (Team Bomba).

## About

BitBuster is an LZ77-based compressor designed for MSX and other Z80 platforms. It uses Elias gamma coding for variable-length match lengths and an 11-bit offset window (max 2048 bytes). Both BitBuster 1.2 and BitBuster 2 share the same token encoding but differ in their container format: BitBuster 1.2 uses a single stream with a 4-byte original-length header, while BitBuster 2 uses independently compressed blocks with a block-count header.

## Features

- Both BitBuster 1.2 and BitBuster 2 format support
- MSB-first bitstream with interleaved literal bytes
- 11-bit offset encoding (7-bit short + 4-bit extension for long offsets)
- Elias gamma coded match lengths (minimum match length 2)
- Compression levels 1-9 (greedy, lazy, optimal DP parsing)
- Roundtrip-verified: compress then decompress yields identical data

## Usage

### Browser

```html
<script src="bitbuster-js.js"></script>
<script>
    // Compress with BitBuster 1.2 (level 1-9, default 5)
    const compressed = BitBuster.compress(data, 5);

    // Decompress BitBuster 1.2
    const decompressed = BitBuster.decompress(compressed);

    // Compress with BitBuster 2
    const compressed2 = BitBuster.compress2(data, 5);

    // Decompress BitBuster 2
    const decompressed2 = BitBuster.decompress2(compressed2);
</script>
```

### Node.js

```javascript
const BitBuster = require('./bitbuster-js.js');

const compressed = BitBuster.compress(data, 5);
const decompressed = BitBuster.decompress(compressed);

const compressed2 = BitBuster.compress2(data, 5);
const decompressed2 = BitBuster.decompress2(compressed2);
```

## API

### Compression Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `BitBuster.compress(data, level)` | data: Uint8Array, level: number (1-9) | Uint8Array |
| `BitBuster.compress2(data, level)` | data: Uint8Array, level: number (1-9) | Uint8Array |

### Decompression Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `BitBuster.decompress(data)` | data: Uint8Array | Uint8Array |
| `BitBuster.decompress2(data)` | data: Uint8Array | Uint8Array |

### Compression Levels

| Level | Strategy |
|-------|----------|
| 1-3 | Greedy matching |
| 4-6 | Lazy matching |
| 7-9 | Optimal DP parsing |

### Constants

- `BitBuster.MAX_OFFSET` = 2048 (maximum back-reference distance)

## File Formats

### BitBuster 1.2

```
[4 bytes: original length, little-endian]
[compressed bitstream]
```

Single continuous stream. File extension: `.pck`

### BitBuster 2

```
[1 byte: number of blocks]
For each block:
  [2 bytes: compressed block length, little-endian]
  [compressed bitstream for this block]
```

Default block size: 32768 bytes. File extension: `.bb2`

### Token Encoding (shared)

- **Literal**: bit 0, then 8-bit raw byte
- **Match (BB1.2)**: bit 1, then offset, then Elias gamma length
- **Match (BB2)**: bit 1, then Elias gamma length, then offset
- **Offset**: 7-bit byte (short, 1-128) or byte with bit 7 set + 4 extension bits (long, 129-2048)
- **EOF**: match flag, then offset 0, then an Elias gamma overflow (16 ones + terminator)

## Online Demo

Open `bitbuster-js_test.html` in a browser to use the GUI:
- Single file compress/decompress (BitBuster 1.2 and BitBuster 2)
- Batch directory compression with progress and statistics
- Compression level selection (1-9)

## Compatibility

Compatible with the original BitBuster tools (packpc.exe for 1.2, BitBuster2.exe for 2) and Z80 depackers.

- BitBuster 1.2: [abekermsx/BitBuster-1.2](https://github.com/abekermsx/BitBuster-1.2)
- BitBuster 2: [abekermsx/Bitbuster-2](https://github.com/abekermsx/Bitbuster-2)

## Credits

Original format and tools by Arjan Bakker (Team Bomba), 2002-2004

JavaScript port by Bedazzle - 2026

## License

MIT License - See LICENSE file for details.
