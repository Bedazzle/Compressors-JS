# Exomizer 2 JS - Optimal LZ77 Compression with Adaptive Encoding Tables

Pure-JavaScript port by Bedazzle (2026) of **Exomizer 2**, the optimal LZ77 compression algorithm with adaptive encoding tables by Magnus Lind.

## About

Exomizer 2 is an optimal LZ77 compressor with Huffman-like adaptive encoding tables, widely used on retro platforms (C64, ZX Spectrum, Amiga, etc.) for packing data and creating self-extracting executables. This is a JavaScript port allowing compression/decompression directly in the browser or Node.js.

## Features

- Optimal LZ77 compression with multi-pass encoding table optimization
- Three separate offset encoding tables (for lengths 1, 2, and 3+)
- Gamma-coded length table with 16 entries
- Literal sequence escape for incompressible regions
- Backward compression for in-place decompression
- Iterative convergence of encoding tables for best compression ratio

## Technical Limits

- `MAX_OFFSET`: 65535 bytes - maximum back-reference distance
- `MAX_LENGTH`: 65535 bytes - maximum match length

## Usage

### Browser

```html
<script src="exomizer2-js.js"></script>
<script>
    // Compress
    const result = Exomizer2.compressArray(data);
    // result.data = compressed Uint8Array
    // result.encoding = encoding table string

    // Decompress
    const decompressed = Exomizer2.decompressArray(compressed);
</script>
```

### Node.js

```javascript
const Exomizer2 = require('./exomizer2-js.js');

// Compress (returns { data: Uint8Array, encoding: string })
const result = Exomizer2.compressArray(data);

// Decompress (returns Uint8Array)
const decompressed = Exomizer2.decompressArray(compressed);
```

## API

### Compression Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `Exomizer2.compress(data, maxPasses)` | data: Uint8Array, maxPasses: number | `{data, encoding, literalSequencesUsed}` |
| `Exomizer2.compressBackwards(data, maxPasses)` | data: Uint8Array, maxPasses: number | `{data, encoding, literalSequencesUsed}` |
| `Exomizer2.compressArray(data, backwards, maxPasses)` | data: Uint8Array, backwards: boolean, maxPasses: number | `{data, encoding, literalSequencesUsed}` |

### Decompression Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `Exomizer2.decompress(data)` | data: Uint8Array | Uint8Array |
| `Exomizer2.decompressBackwards(data)` | data: Uint8Array | Uint8Array |
| `Exomizer2.decompressArray(data, backwards)` | data: Uint8Array, backwards: boolean | Uint8Array |

### Options

- `backwards` - Boolean for backwards compression/decompression
- `maxPasses` - Maximum optimization passes (default: 65536, converges in 2-4 typically)
- `encoding` - In result, the encoding table configuration string

### Constants

- `Exomizer2.MAX_OFFSET` - Maximum offset (65535)
- `Exomizer2.MAX_LENGTH` - Maximum match length (65535)

## Encoding Tables

Exomizer uses four encoding tables serialized as 52 x 4-bit nibbles in the compressed stream header:

- **Offset table 1** (4 entries): for matches of length 1, prefix 2 bits
- **Offset table 2** (16 entries): for matches of length 2, prefix 4 bits
- **Offset table 3** (16 entries): for matches of length >= 3, prefix 4 bits
- **Length table** (16 entries): gamma-coded prefix for match lengths

Each table entry specifies a number of extra bits to read. The base value for each entry is computed from the cumulative sum of previous entry ranges.

## Online Demo

Open `exomizer2-js_test.html` in a browser to use the GUI:
- Single file compress/decompress
- Batch directory compression with progress and statistics
- Backwards mode support

## Credits

Original C implementation by Magnus Lind (c) 2002-2015
https://bitbucket.org/magli143/exomizer/

JavaScript port by Bedazzle - 2026

## License

The compressor code is provided under the original Exomizer non-commercial license. The decompressor/decrunch code is provided under the permissive zlib license. See LICENSE file for full details.
