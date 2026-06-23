# LgK-JS

Pure-JavaScript port by Bedazzle (2026) of **LgK v1.1rs** (Lethargeek Kompakt, Row-Sequence edition), a ZX Spectrum screen image compressor by Lethargeek.

## Features

- Tile-based XOR prediction with 8 transform modes (vertical, horizontal, inverse, equal-ref, etc.)
- Exhaustive configuration search for optimal output size
- Huffman coding for mode selection
- Attribute RLE with palette optimization and 3/5-predictor modes
- Reference tile reuse (equal and inverted matches)
- Interleaved (mixed) attribute packing for progressive on-screen display
- Partial screen compression (configurable row range)
- Optional attribute optimization via ink/paper swap
- Visually lossless compression (exploits hidden pixels for better ratios)
- Pure JavaScript, works in browser and Node.js with no dependencies

## What it does

Compresses and decompresses ZX Spectrum `.scr` screen files (6912 bytes: 6144 pixel + 768 attribute bytes) using tile-based XOR prediction, Huffman coding, and attribute RLE. The compressor performs an exhaustive search over configuration parameters to find the smallest output.

SFX (self-extracting Z80 executable) generation is not included in the JS port.

## Usage

### Browser

```html
<script src="lgk-js.js"></script>
<script>
  // scrData is a Uint8Array of a 6912-byte .scr file
  const compressed = LgK.compress(scrData, { mixed: true });
  const restored = LgK.decompress(compressed);
</script>
```

### Node.js

```js
const LgK = require('./lgk-js.js');
const fs = require('fs');

const scr = new Uint8Array(fs.readFileSync('image.scr'));
const bin = LgK.compress(scr, { mixed: true });
fs.writeFileSync('image.lgk', bin);

const restored = LgK.decompress(bin);
fs.writeFileSync('restored.scr', restored);
```

## API

### `LgK.compress(scrData, [options])`

Compresses a ZX Spectrum screen.

- **scrData** `Uint8Array` -- input screen data (6912 bytes)
- **options.rows** `number` -- character rows to compress (1-24, default 24)
- **options.start** `number` -- starting character row (0-23, default 0)
- **options.mixed** `boolean` -- pack attributes interleaved with pixel data (default false). When false, attributes are stored in a separate block after all pixel data, which generally compresses better. When true, each tile's attribute is stored immediately after its pixel data, which allows a ZX Spectrum depacker to display the image progressively with correct colors as it decompresses. The decompressor detects this automatically from the header -- no option needed on the decompress side.
- **options.optimizeAttrs** `boolean` -- pre-compression pass that attempts to improve compression by selectively inverting bitmap pixels and swapping ink/paper in character cells (default false). The decision is based on boundary pixel matching with neighbouring cells and attribute coherence. The visual appearance is unchanged because the ink/paper swap compensates for the pixel inversion. Cells where ink equals paper (hidden) or flash is set are left untouched. Note: this can produce smaller output for some images, but not all — LgK's tile-based XOR prediction already handles most cases well on its own. Try with and without to compare.
- Returns `Uint8Array` -- compressed data

### `LgK.decompress(binData, [options])`

Decompresses a LgK-compressed file.

- **binData** `Uint8Array` -- compressed data
- **options.rows** `number` -- character rows (1-24, default 24)
- **options.start** `number` -- starting character row (0-23, default 0)
- **options.mono** `boolean` -- output pixel data only, no attributes (default false)
- Returns `Uint8Array` -- decompressed screen data (6912 bytes, or 6144 if mono)

## Note on hidden pixels

Compression is **visually lossless** but not necessarily bit-exact. In character cells where ink and paper colors are the same (e.g. attribute 0x2D = cyan on cyan), pixel data is invisible on screen. The compressor exploits this by choosing whichever pixel pattern yields the best compression for these cells, since the visual result is identical regardless of the actual pixel bits. As a result, a compress/decompress round-trip may produce pixel bytes that differ from the original in such hidden cells, while the on-screen image remains identical.

## Files

| File | Description |
|------|-------------|
| `lgk-js.js` | Compressor/decompressor library |
| `lgk-js_test.html` | Browser test/demo UI |

## Online Demo

Open `lgk-js_test.html` in a browser for a UI that supports single-file and batch compress/decompress with drag-and-drop folder support and ZIP output.

## Fixes

- **Sequential-refs quick-fix consistency** — when the optimizer disables repeated
  references (`CFRPR`), the model is now fully rebuilt (`buildModeCosts` →
  `optimizeHuffman` → `buildXorBuffer` → attribute cost) instead of only adjusting the
  size estimate. The previous estimate-only path emitted Huffman tables / XOR buffer
  that disagreed with the header, producing an internally inconsistent bitstream that
  mis-depacked on some screens (verified via the Z80 depacker roundtrip in `tests/`).
  This follows the same logic as the native LgK v1.1rs "seq refs" fix.

  **Note:** the fix changes the compressed output for affected screens (it now
  re-optimizes after the flag change), so the bytes differ from the previous JS
  build — and the JS packer's output is **not** guaranteed bit-identical to the
  original `LgK.exe`. Output streams are valid and depack correctly on the standard
  Z80 depacker; existing compressed files are unaffected (decompression is unchanged).

## Credits

Original C implementation by Lethargeek
JavaScript port by Bedazzle - 2026

## License

BSD-3-Clause - See LICENSE file for details