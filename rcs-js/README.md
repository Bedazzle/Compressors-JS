# rcs-js

Pure-JavaScript port by Bedazzle (2026) of **RCS (Re-ordered Compressed Screen)**
by Einar Saukas — a byte-reordering transform for ZX Spectrum screens that makes
them compress roughly **10% smaller** with ZX0/ZX7, at no cost to the
decompressed result.

RCS is **not a compressor of its own**: it reorders the 6144 bitmap bytes of a
standard `SCR` screen (the 768 attribute bytes are left unchanged), and the
reordered 6912-byte buffer is then fed to a normal ZX0 or ZX7 compressor. RCS
defines no file format or header.

- Original: https://github.com/einar-saukas/RCS

## How it works

A standard ZX Spectrum screen stores bitmap bytes interleaved by the hardware
address layout (third → pixel-line → char-row → column). RCS rewrites the
bitmap in `sector → column → char-row → pixel-line` (S→C→R→L) order, which
groups visually-adjacent bytes together and exposes longer matches to the LZ
compressor. The transform is a lossless bijection, so the original screen is
recovered exactly after un-reordering.

On Z80, the **"smart"** depackers (`dzx0_smartRCS`, `dzx7_smartRCS`) fuse the
LZ decompression with the un-reorder in a single pass, and only apply the
reorder when the destination is the screen. This port reproduces the identical
end-to-end result in two steps.

## Usage

The combo helpers require `zx0-js` and/or `zx7-js` to be loaded first.

### Browser

```html
<script src="zx0-js/zx0-js.js"></script>
<script src="zx7-js/zx7-js.js"></script>
<script src="rcs-js/rcs-js.js"></script>
<script>
  // scr = Uint8Array(6912)  -- a standard SCR screen
  const packed = RCS.compressZX0(scr);           // RCS reorder + ZX0
  const screen = RCS.decompressZX0(packed);      // ZX0 + un-reorder -> 6912 bytes

  const packed7 = RCS.compressZX7(scr, true);    // RCS + ZX7 backwards
  const screen7 = RCS.decompressZX7(packed7, true);
</script>
```

### Node.js

```js
const RCS = require('./rcs-js/rcs-js.js');

// Pure transform (no codec needed):
const rcs = RCS.reorderScrToRcs(scr);   // 6912 -> 6912, reordered
const scr2 = RCS.reorderRcsToScr(rcs);  // exact inverse
```

## API

| Function | Description |
|----------|-------------|
| `RCS.reorderScrToRcs(scr)` | Standard SCR → RCS layout (6912→6912). |
| `RCS.reorderRcsToScr(rcs)` | RCS layout → standard SCR (inverse). |
| `RCS.compressZX0(scr, backwards?)` | RCS reorder, then ZX0 compress. |
| `RCS.decompressZX0(data, backwards?)` | ZX0 decompress, then un-reorder. |
| `RCS.compressZX7(scr, backwards?)` | RCS reorder, then ZX7 compress. |
| `RCS.decompressZX7(data, backwards?)` | ZX7 decompress, then un-reorder. |
| `RCS.SCREEN_SIZE` | `6912` |
| `RCS.BITMAP_SIZE` | `6144` |

Inputs must be exactly 6912 bytes (a full SCR screen).

## Z80 depacker sizes

For reference (used in the comparison tool):

| Variant | Depacker | Bytes |
|---------|----------|-------|
| RCS + ZX0 | `dzx0_smartRCS` | 112 |
| RCS + ZX0 backwards | `dzx0_smartRCS_back` | 113 |
| RCS + ZX7 | `dzx7_smartRCS` | 110 |
| RCS + ZX7 backwards | `dzx7_smartRCS_back` | 110 |

## Credits

- RCS transform and Z80 depackers: **Einar Saukas** — https://github.com/einar-saukas/RCS
- JavaScript port: Bedazzle, 2026 (transform ported from the SpectraLab project).
