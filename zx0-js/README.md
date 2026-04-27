# ZX0-JS - Optimal LZ77/LZSS Compression

JavaScript implementation of the ZX0 compression algorithm, originally developed by Einar Saukas.

## About

ZX0 is an optimal data compressor for a custom LZ77/LZSS based compression format, that provides a tradeoff between high compression ratio, and extremely simple fast decompression. Therefore it's especially appropriate for low-end platforms, including 8-bit computers like the ZX Spectrum.

This is a JavaScript port allowing compression/decompression directly in the browser.

100% compatible with `zx0.exe` and `dzx0.exe` — files compressed with the JS version can be decompressed with the original tools and vice versa.

## Features

- Optimal LZ77/LZSS compression (guarantees best possible encoding)
- V2 format (default) and classic V1 format support
- Backward compression for in-place decompression from end of memory
- Quick non-optimal mode for faster compression during development
- Prefix/suffix support for referencing pre-loaded data
- Delta calculation for overlap decompression

## Technical Details

- `MAX_OFFSET_ZX0`: 32640 bytes — maximum back-reference distance (default)
- `MAX_OFFSET_ZX7`: 2176 bytes — maximum back-reference distance (quick mode)

The maximum offset of 32640 allows a ~32KB sliding window. Quick mode limits this to 2176 (same as ZX7), producing larger compressed output but compressing almost instantly.

## File Format

The ZX0 compressed format has only 3 types of blocks:

- **Literal** (copy next N bytes from compressed file)
```
0  Elias(length)  byte[1]  byte[2]  ...  byte[N]
```

- **Copy from last offset** (repeat N bytes from last offset)
```
0  Elias(length)
```

- **Copy from new offset** (repeat N bytes from new offset)
```
1  Elias(MSB(offset)+1)  LSB(offset)  Elias(length-1)
```

ZX0 needs only 1 bit to distinguish between these blocks, because literal blocks cannot be consecutive, and reusing last offset can only happen after a literal block. The first block is always a literal, so the first bit is omitted.

The offset MSB and all lengths are stored using interlaced Elias Gamma Coding. When offset MSB equals 256 it means EOF. The offset LSB is stored using 7 bits instead of 8, because it produces better results in most practical cases.

**WARNING**: The ZX0 file format was changed in version 2. This new format allows decompressors to be slightly smaller and run slightly faster. If you need to compress a file to the old "classic" file format from version 1, use the classic option.

## Usage

### Browser

```html
<script src="zx0-js.js"></script>
<script>
    // Compress (v2 format, forward)
    const result = ZX0.compress(data);
    // result.data = compressed Uint8Array
    // result.delta = overlap offset needed for in-place decompression

    // Decompress
    const decompressed = ZX0.decompress(compressed);
</script>
```

## API

### Compression

```javascript
ZX0.compress(data, skip, backwards, classic, quick)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `data` | Uint8Array or Array | — | Input data to compress |
| `skip` | number | `0` | Bytes to skip (for prefix compression) |
| `backwards` | boolean | `false` | Compress backwards |
| `classic` | boolean | `false` | Use classic V1 format |
| `quick` | boolean | `false` | Quick non-optimal compression |

Returns `{ data: Uint8Array, delta: number }`

### Decompression

```javascript
ZX0.decompress(data, backwards, classic)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `data` | Uint8Array or Array | — | Compressed data |
| `backwards` | boolean | `false` | Decompress backwards |
| `classic` | boolean | `false` | Classic V1 format |

Returns `Uint8Array`

### Constants

- `ZX0.MAX_OFFSET_ZX0` — Maximum offset in normal mode (32640)
- `ZX0.MAX_OFFSET_ZX7` — Maximum offset in quick mode (2176)

## Performance

The ZX0 optimal compressor algorithm is fairly complex, thus compressing typical files can take a few seconds. During development, you can speed up this process using the `quick` option. This will produce a non-optimal larger compressed file but execute almost instantly.

Using quick mode will only affect the size of the compressed file, not its format. Therefore all decompressor routines will continue to work exactly the same way.

## Delta and In-Place Decompression

The `delta` value in compression result tells you how many bytes of additional space are needed for safe in-place decompression (where compressed data overlaps decompressed data).

For forward decompression, the last byte of compressed data must be at least `delta` bytes higher than the last byte of decompressed data:

```
                       |------------------|    compressed data
    |---------------------------------|       decompressed data
  start >>                            <--->
                                      delta
```

For backward decompression, the first byte of compressed data must be at least `delta` bytes lower than the first byte of decompressed data:

```
     compressed data    |------------------|
    decompressed data       |---------------------------------|
                        <--->                            << start
                        delta
```

## Prefix Compression (Forward)

Allows referencing data that exists BEFORE the decompression address. The first `skip` bytes of the input are skipped (not compressed) but CAN be referenced by the compressed data:

```
                                        compressed data
                                     |-------------------|
         prefix             decompressed data
    |--------------|---------------------------------|
                 start >>
    <-------------->                                 <--->
          skip                                       delta
```

```javascript
// Combine prefix + data before compression
const prefix = loadFile('sprites.gfx');  // 2500 bytes
const levelData = loadFile('level1.bin');
const combined = new Uint8Array(prefix.length + levelData.length);
combined.set(prefix);
combined.set(levelData, prefix.length);

// Compress with skip = prefix size
const result = ZX0.compress(combined, prefix.length);
```

During decompression, the prefix data must already exist in memory immediately BEFORE the decompression target address. Be careful to ensure prefix content does not change between compression and decompression.

## Suffix Compression (Backwards)

Both prefix and backwards features can be used together. A file can be compressed backwards, with a suffix of `skip` bytes at the end that is skipped (not compressed but possibly referenced):

```
       compressed data
    |-------------------|
                 decompressed data             suffix
        |---------------------------------|--------------|
                                     << start
    <--->                                 <-------------->
    delta                                       skip
```

```javascript
// Combine data + suffix
const levelData = loadFile('level1.gfx');
const suffix = loadFile('generic.gfx');  // 1024 bytes
const combined = new Uint8Array(levelData.length + suffix.length);
combined.set(levelData);
combined.set(suffix, levelData.length);

// Compress backwards with skip = suffix size
const result = ZX0.compress(combined, suffix.length, true);
```

During backwards decompression, the suffix data must exist in memory immediately AFTER the decompression area.

## Online Demo

Open `zx0-js_test.html` in a browser to use the GUI:
- Single file compress/decompress
- Batch directory compression with progress and statistics
- Backwards mode, classic format, and quick mode options
- Prefix skip support

## Helper Scripts

- `zx0_batch.py` — Batch compress all files in a directory using zx0.exe

```bash
python zx0_batch.py <input_dir> <output_dir> [zx0.exe] [args...]
# Example with backwards compression:
python zx0_batch.py in out zx0.exe -b
# Example with classic format and prefix skip:
python zx0_batch.py in out zx0.exe -c +2500
```

## Credits

Original C implementation by Einar Saukas (c) 2021
https://github.com/einar-saukas/ZX0

JavaScript port by Bedazzle — 2026

## License

BSD-3 License — See source file for details
