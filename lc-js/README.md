# LC-JS - Laser Compact 5.2.1 Compression

JavaScript implementation of the Laser Compact 5.2.1 compression algorithm, originally developed by Hrumer (1994-1999), PC version by Nikita Burnashev (2005), improved by Hrumer (2014) and Eugene Larchenko (2026).

## About

Laser Compact is an optimal LZH data compressor originally developed for ZX Spectrum. It supports both forward and backward (reversed) match references, and includes ZX Spectrum screen reordering for improved compression of screen data. This is a JavaScript port allowing compression/decompression directly in the browser or Node.js.

## Features

- Optimal LZH compression with both forward and backward match references
- ZX Spectrum screen pixel reordering for better compression ratios
- Segment support (full screen, 1/3, 2/3 segments)
- Attribute inclusion/exclusion
- LCMP5 file format with header
- Raw data compression mode (without screen reordering)

## Technical Limits

- `MAX_OFFSET`: 0x1700 (5888) bytes - maximum back-reference distance
- `MAX_LEN`: 256 bytes - maximum match length

## Usage

### Browser

```html
<script src="lc-js.js"></script>
<script>
    // Compress ZX Spectrum screen (with reorder + LCMP5 header)
    const result = LC.compressScreen(scrData);
    // result.data = compressed Uint8Array with LCMP5 header

    // Decompress ZX Spectrum screen
    const screen = LC.decompressScreen(compressedData);

    // Compress raw data (no screen reordering)
    const raw = LC.compressArray(data);

    // Decompress raw data
    const decompressed = LC.decompressArray(compressed);
</script>
```

### Node.js

```javascript
const LC = require('./lc-js.js');

// Compress screen
const result = LC.compressScreen(scrData);

// Decompress screen
const screen = LC.decompressScreen(compressedData);

// Compress raw data
const raw = LC.compressArray(data);

// Decompress raw data
const decompressed = LC.decompressArray(compressed);
```

## API

### Screen Functions

These handle the full pipeline: pixel reordering + compression + LCMP5 header.

| Function | Parameters | Returns |
|----------|------------|---------|
| `LC.compressScreen(data, options)` | data: Uint8Array, options: object | `{data}` |
| `LC.decompressScreen(data, options)` | data: Uint8Array, options: object | Uint8Array (6912 bytes) |

#### Screen Options

| Option | Default | Description |
|--------|---------|-------------|
| `start` | `0` | Pixel data start offset |
| `end` | `6144` | Pixel data end offset |
| `attrs` | `true` | Include attribute bytes |
| `header` | `true` | Add/parse LCMP5 file header |

### Raw Compression Functions

These compress/decompress arbitrary data without screen reordering or headers.

| Function | Parameters | Returns |
|----------|------------|---------|
| `LC.compress(data)` | data: Uint8Array | `{data}` |
| `LC.decompress(data)` | data: Uint8Array | Uint8Array |
| `LC.compressArray(data)` | data: Array or Uint8Array | `{data}` |
| `LC.decompressArray(data)` | data: Array or Uint8Array | Uint8Array |

### Utility Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `LC.reorder(scr, start, end, attrs)` | scr: Uint8Array | Uint8Array |
| `LC.deorder(data, start, end, attrs)` | data: Uint8Array | Uint8Array (6912 bytes) |

### Constants

- `LC.MAX_OFFSET` - Maximum offset (0x1700 = 5888)
- `LC.MAX_LEN` - Maximum match length (256)

## Screen Segments

ZX Spectrum screen (6912 bytes) consists of 6144 bytes of pixel data and 768 bytes of attributes. The pixel data is divided into three 2048-byte segments (screen thirds).

| Segment | Pixels | Attributes |
|---------|--------|------------|
| Full screen | 0 - 6144 | 768 bytes |
| Seg 1 | 0 - 2048 | 256 bytes |
| Seg 2 | 2048 - 4096 | 256 bytes |
| Seg 3 | 4096 - 6144 | 256 bytes |
| Seg 1-2 | 0 - 4096 | 512 bytes |
| Seg 2-3 | 2048 - 6144 | 512 bytes |

```javascript
// Compress segment 1 only, with attributes
LC.compressScreen(scrData, { start: 0, end: 2048, attrs: true });

// Compress full screen without attributes
LC.compressScreen(scrData, { attrs: false });

// Compress without LCMP5 header (raw compressed stream)
LC.compressScreen(scrData, { header: false });
```

## Screen Reordering

The ZX Spectrum stores pixel data in a non-linear layout where scan lines are interleaved. The `reorder()` function rearranges pixels so that bytes from the same character cell are adjacent. This significantly improves LZ compression because visually similar data is grouped together.

Without reordering, a typical screen compresses to ~3600 bytes. With reordering, the same screen compresses to ~2800 bytes.

## LCMP5 File Format

Files with LCMP5 header (compatible with laser.exe):

| Offset | Size | Description |
|--------|------|-------------|
| 0 | 5 | Magic: "LCMP5" |
| 5 | 2 | Payload length (LE), includes screen type byte |
| 7 | 1 | Extra info length (0) |
| 8 | 1 | Screen type / segment break |
| 9+ | N | Compressed data |

## Algorithm Details

Laser Compact uses an optimal LZH encoder with these features:

- **Bit packing**: MSB-first, 8 bits per byte with sentinel-based flushing
- **VLC codes**: 1/3/5/7-bit variable-length codes for match lengths and offset high bytes
- **Match types**: Forward (type 2) and backward/reversed (type 3) references
- **Offset encoding**: VLC for high byte + direction bit + negated low byte
- **Optimal parsing**: Dynamic programming to find the globally optimal encoding path

## Online Demo

Open `lc-js_test.html` in a browser to use the GUI:
- Screen compression/decompression with segment and attribute options
- Raw data compression/decompression
- Batch directory compression
- LCMP5 header toggle

## Credits

ZX Spectrum version: packer, depacker by Hrumer, 1994-1999
PC version: Nikita Burnashev, 2005
Bug fixed, improved compression ratio, add depacker: Hrumer, 2014
Add -seg, -noattr options, fix buffer overflow: Eugene Larchenko, 2026

JavaScript port by Bedazzle - 2026

## License

BSD-3 License - See LICENSE file for details
