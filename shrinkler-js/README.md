# Shrinkler-JS - LZ77 Compression with Range Coding

Pure-JavaScript port by Bedazzle (2026) of **Shrinkler**, the LZ77 + range-coding compression algorithm by Aske Simon Christensen (Blueberry / Loonies).

## About

Shrinkler is an LZ77 compressor with range coding and adaptive probability contexts, originally designed for Amiga executables. It achieves excellent compression ratios through multi-pass optimal parsing with frequency-based cost estimation.

## Features

- LZ77 compression with adaptive range coding (16-bit probabilities)
- Multi-pass optimal parsing with forward dynamic programming
- Repeated offset optimization for back-to-back references
- Compression levels 1-9 trading speed for ratio
- Interleaved Elias gamma variant for offset/length encoding
- Optional parity contexts for structured data (Amiga executables)

## Usage

### Browser

```html
<script src="shrinkler-js.js"></script>
<script>
    // Compress (level 1-9, default 3)
    const compressed = Shrinkler.compress(data, 3);

    // Decompress
    const decompressed = Shrinkler.decompress(compressed);
</script>
```

### Node.js

```javascript
const Shrinkler = require('./shrinkler-js.js');

// Compress (returns Uint8Array)
const compressed = Shrinkler.compress(data, 3);

// Decompress (returns Uint8Array)
const decompressed = Shrinkler.decompress(compressed);
```

## API

### Compression Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `Shrinkler.compress(data, level, options)` | data: Uint8Array, level: number (1-9), options: object | Uint8Array |
| `Shrinkler.compressArray(data, level, options)` | data: Array/Uint8Array, level: number, options: object | Uint8Array |

### Decompression Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `Shrinkler.decompress(data, options)` | data: Uint8Array, options: object | Uint8Array |
| `Shrinkler.decompressArray(data, options)` | data: Array/Uint8Array, options: object | Uint8Array |

### Configuration

| Function | Returns |
|----------|---------|
| `Shrinkler.defaultOptions()` | Default options object |

### Compression Levels

| Level | Iterations | Match Patience | Notes |
|-------|-----------|----------------|-------|
| 1 | 1 | 100 | Fastest |
| 3 | 3 | 300 | Default, matches original Shrinkler defaults |
| 5 | 5 | 500 | Good balance of speed and ratio |
| 9 | 9 | 900 | Maximum compression, slowest |

Higher levels increase the number of multi-pass iterations and the thoroughness of match searching. Each pass refines frequency estimates for better optimal parsing.

### Options

```javascript
const options = Shrinkler.defaultOptions();
// Returns:
{
    parityContext: false    // Separate contexts by byte position parity
}
```

### Parity Context (`parityContext`)

Controls whether literal and kind contexts are split by byte position parity:

- **false (default)**: All byte positions share contexts. General-purpose.
- **true**: Even/odd byte positions get separate contexts. Useful for Amiga executables and other 16-bit structured data where even and odd bytes have distinct patterns.

```javascript
// Compress with parity context for Amiga data
const compressed = Shrinkler.compress(data, 3, { parityContext: true });
const decompressed = Shrinkler.decompress(compressed, { parityContext: true });
```

Both compressor and decompressor must use the same `parityContext` setting.

## Algorithm

Shrinkler uses a multi-pass compression approach:

1. **Suffix array** construction for efficient match finding
2. **Forward dynamic programming** optimal parser that tracks parse states keyed by last-used offset (enabling repeated-offset optimization)
3. **Range coder** with 16-bit adaptive probabilities and carry propagation
4. **Multiple iterations** where each pass uses frequency statistics from the previous pass to estimate coding costs more accurately
5. **Best result selection** across all iterations

The compressed stream uses 1025 adaptive probability contexts:
- 1 context for the repeated-offset flag
- 256 contexts per parity group for literal kind+byte bits (2 groups)
- 256 contexts for offset number encoding
- 256 contexts for length number encoding

## Online Demo

Open `shrinkler-js_test.html` in a browser to use the GUI:
- Single file compress/decompress
- Batch directory compression with progress and statistics
- Compression level selection (1-9)
- Parity context toggle

## Compatibility

The compressed stream is headerless (pure range-coded data), matching the original Shrinkler data mode (`shrinkler -d`). Files compressed with default options by this JS implementation should decompress correctly with the original Shrinkler tool, and vice versa.

## Credits

Original C++ implementation by Aske Simon Christensen (Blueberry / Loonies)
https://github.com/askeksa/Shrinkler

JavaScript port by Bedazzle - 2026

## License

See LICENSE file for the Shrinkler license terms.
