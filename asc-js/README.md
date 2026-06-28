# ASC-JS — ZX Spectrum screen compressor (LZSS + RLE)

Pure-JavaScript port by Bedazzle (2026) of **ASC v2.9**, the ZX Spectrum screen
compressor by **Andrew Strikes Code** (Andrey Sendetsky), 1997 — the author's *"LZSS/PACK
method"*. The format was reconstructed from a byte-exact disassembly of the original program.

## About

ASC compresses a standard **6912-byte ZX Spectrum screen** (6144 bitmap + 768 attributes)
into a **self-extracting block**: a 194-byte depacker stub followed by an LZSS + RLE token
stream, so a compressed screen unpacks itself.

Because of the Spectrum's interleaved display layout, the 8 pixel rows of a character cell
are 256 bytes apart. Before matching, ASC **reorganises the bitmap into 8×8-character-cell
order** so each cell's 8 pixel rows become 8 *contiguous* bytes (and vertically-adjacent
cells become neighbours) — turning a solid or repeated cell into a single run/match instead
of 8 scattered ones. The 768 attribute bytes are already linear and are appended unchanged.
The depacker performs the inverse remap when painting the screen back to `$4000`.

## Features

- Self-extracting output: `[194-byte depacker stub][token stream]`, byte-compatible with the
  original ASC v2.9 depacker
- 8×8-cell bitmap reordering (de-interleave) for better matches on screen data
- LZSS matches (length 3–18, offset 1–2047), RLE runs (3–66), literal runs (1–63)
- Compression levels 1–9 (greedy / lazy / cost-optimal DP parsing)
- Roundtrip-verified: compress then decompress yields the identical screen
- Bare token-stream mode (no stub) for callers that supply their own depacker

## Usage

### Browser

```html
<script src="asc-js.js"></script>
<script>
    // screen = Uint8Array of exactly 6912 bytes (a standard SCR)

    // Compress to a self-extracting block (level 1-9, default 9)
    const block = ASC.compress(screen, 9);

    // Decompress back to the 6912-byte screen
    const screen2 = ASC.decompress(block);
</script>
```

### Node.js

```javascript
const ASC = require('./asc-js.js');

const block   = ASC.compress(screen, 9);
const screen2 = ASC.decompress(block);
```

## API

### Compression

| Function | Parameters | Returns |
|----------|------------|---------|
| `ASC.compress(screen, level)` | screen: Uint8Array (6912 bytes), level: 1–9 | Uint8Array (stub + tokens) |
| `ASC.compressTokens(screen, level)` | screen: Uint8Array (6912 bytes), level: 1–9 | Uint8Array (tokens only, no stub) |

### Decompression

| Function | Parameters | Returns |
|----------|------------|---------|
| `ASC.decompress(block)` | block: Uint8Array | Uint8Array (6912-byte screen) |
| `ASC.decompressTokens(tokens)` | tokens: Uint8Array | Uint8Array (6912-byte screen) |
| `ASC.hasStub(block)` | block: Uint8Array | boolean |

`decompress` auto-detects and skips the v2.9 self-extracting stub (recognised by its
`$F3 $CD` signature); pass a bare token stream to `decompressTokens` instead.

### Compression levels

| Level | Strategy |
|-------|----------|
| 1–3 | Greedy matching |
| 4–6 | Lazy matching |
| 7–9 | Cost-optimal DP parsing |

### Constants

| Name | Value | Meaning |
|------|-------|---------|
| `ASC.SCREEN_SIZE` | 6912 | required input size |
| `ASC.STUB_SIZE` | 194 | self-extracting depacker length |
| `ASC.MAX_OFFSET` | 2047 | maximum back-reference distance |
| `ASC.MAX_MATCH` | 18 | maximum match length |
| `ASC.MIN_MATCH` | 3 | minimum match length |
| `ASC.MAX_RLE` | 66 | maximum RLE run |
| `ASC.MAX_LIT_RUN` | 63 | maximum literal run |
| `ASC.STUB` | Uint8Array | the 194-byte depacker stub |

## Block format

```
[194 bytes: self-extracting depacker stub ($CDF3 variant)]
[token stream]
```

### Token encoding

The bitmap is de-interleaved into 8×8-cell order, the attributes appended, and the result
encoded as a stream of tokens read by a single lead byte `b`:

| Lead byte `b` | Token | Encoding |
|---------------|-------|----------|
| `$80` | END | stop (an empty literal-run header) |
| `$00–$7F` (bit7=0) | MATCH | length = `((b>>3)&$0F)+3` (3–18); offset = `((b&7)<<8) \| next` (1–2047); copy `length` bytes from `out − offset` |
| `$81–$BF` (bit7=1, bit6=0) | LITERAL run | `b&$3F` literal bytes follow (1–63) |
| `$C0–$FF` (bit7=1, bit6=1) | RLE | repeat the next byte `(b&$3F)+3` times (3–66) |

## Online Demo

Open `asc-js_test.html` in a browser for a GUI:
- Single screen compress / decompress (self-extracting block or bare tokens)
- Batch directory compression with statistics

(The GUI always uses the optimal parse — on a fixed 6912-byte screen it is instant, so there
is no level selector. The `level` argument remains available in the API.)

## Compatibility

Output is byte-compatible with the original ASC v2.9 depacker: a compressed block is
`[stub][tokens]` and decompresses itself on a real ZX Spectrum. This port also decompresses
self-extracting blocks made by ASC v2.9. (Foreign stub variants `$52CD` / `$0418` from other
ASC builds are not handled — pass their token stream to `decompressTokens` if you strip the
stub yourself.)

## Credits

Original ASC v2.9 by **Andrew Strikes Code** (Andrey Sendetsky), Dnepropetrovsk, Ukraine, 1997.

JavaScript port by Bedazzle — 2026.

## License

MIT License — see LICENSE file for details.
