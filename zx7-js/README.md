# ZX7-JS - Optimal LZ77/LZSS Compression

JavaScript implementation of the ZX7 compression algorithm, originally developed by Einar Saukas.

## About

ZX7 is an optimal LZ77/LZSS data compressor that generates perfectly optimal encoding. This is a JavaScript port allowing compression/decompression directly in the browser or Node.js.

## Features

- Optimal LZ77/LZSS compression (guarantees best possible encoding)
- Backward compression for in-place decompression
- Prefix/suffix support for referencing pre-loaded data
- Delta calculation for overlap decompression

## Technical Limits

- `MAX_OFFSET`: 2176 bytes - maximum back-reference within compressed data
- `MAX_LEN`: 65536 bytes - maximum match length

Prefix/suffix can drastically improve compression when you have common data shared across multiple files (e.g., dictionary in a diskmag, common sprites in a game, fonts in an editor).

For typical compression use cases, MAX_OFFSET of 2176 is sufficient without needing prefix/suffix.

## Usage

### Browser

```html
<script src="zx7-js.js"></script>
<script>
    // Compress
    const result = ZX7.compressArray(data);
    // result.data = compressed Uint8Array
    // result.delta = overlap offset needed for in-place decompression

    // Decompress
    const decompressed = ZX7.decompressArray(compressed);
</script>
```

### Node.js

```javascript
const ZX7 = require('./zx7-js.js');

// Compress (returns { data: Uint8Array, delta: number })
const result = ZX7.compressArray(data);

// Decompress (returns Uint8Array)
const decompressed = ZX7.decompressArray(compressed);
```

## API

### Compression Functions

| Function | Parameters | Returns |
|----------|-------------|---------|
| `ZX7.compress(data, skip)` | data: Uint8Array, skip: number | `{data, delta}` |
| `ZX7.compressArray(data, skip, backwards)` | data: Uint8Array, skip: number, backwards: boolean | `{data, delta}` |

### Decompression Functions

| Function | Parameters | Returns |
|----------|-------------|---------|
| `ZX7.decompress(data)` | data: Uint8Array | Uint8Array |
| `ZX7.decompressArray(data, backwards)` | data: Uint8Array, backwards: boolean | Uint8Array |

### Options

- `skip` - Number of bytes to skip from start (for prefix compression)
- `backwards` - Boolean for backwards compression/decompression
- `delta` - In returned result, tells how much extra space is needed at the end for in-place decompression

### Constants

- `ZX7.MAX_OFFSET` - Maximum offset (2176)
- `ZX7.MAX_LEN` - Maximum length (65536)

## Prefix and Suffix Compression

### When to Use Prefix/Suffix

Prefix/suffix is useful when:
1. You have common data (sprites, tilemaps, dictionaries) already loaded in memory
2. Your compressed data can reference that pre-existing data
3. You want better compression ratios by avoiding duplicate storage

Using a prefix can drastically improve compression when you have shared data across multiple files.

### Prefix Compression (Forward)

Allows referencing data that exists BEFORE the decompression address. The first `skip` bytes of the input file are skipped (not compressed) but CAN be referenced by the compressed data:

```
                                        compressed data
                                     |-------------------|
         prefix             decompressed data
    |--------------|---------------------------------|
                 start >>
    <-------------->                                 <--->
          skip                                       delta
```

**How it works:**
1. Create combined file: `type prefix.bin + data.bin > combined.bin`
2. Compress with skip=size_of_prefix: `zx7 +2500 combined.bin`
3. During decompression, prefix data must already exist at memory address immediately BEFORE the decompression target

**Example**: Game with common sprites (2500 bytes) always loaded at address 56000. Each level's data can reference back to these sprites.

```javascript
// Combine prefix + data before compression
const prefix = loadFile('sprites.gfx');  // 2500 bytes
const levelData = loadFile('level1.bin'); // 800 bytes
const combined = new Uint8Array(prefix.length + levelData.length);
combined.set(prefix);
combined.set(levelData, prefix.length);

// Compress with skip=2500
const result = ZX7.compressArray(combined, 2500, false);
// result.delta tells you overlap space needed

// During decompression, sprites.gfx must be at memory immediately before decompression address
```

### Suffix Compression (Backwards)

Allows referencing data that exists AFTER the decompression area (for backward decompression). The last `skip` bytes of the input file are skipped but CAN be referenced:

```
       compressed data
    |-------------------|
                 decompressed data             suffix
        |---------------------------------|--------------|
                                     << start
    <--->                                 <-------------->
    delta                                       skip
```

Use with `backwards: true` option:

```javascript
// For backwards compression with suffix
const result = ZX7.compressArray(data, skipSize, true);
```

**Example**: Game where level-specific data is before generic sprites in memory.

```bash
# Command line with zx7.exe
copy /b level_1.gfx+generic.gfx level_1_suffixed.gfx
zx7 -b +1024 level_1_suffixed.gfx
```

During backwards decompression, suffix data must exist at memory immediately AFTER the decompression area.

## Delta and In-Place Decompression

The `delta` value in compression result tells you how many bytes of additional space are needed at the END of compressed data for safe in-place decompression.

For in-place decompression where compressed data overlaps decompressed data:
- Forward: last byte of compressed must be at least `delta` bytes AFTER last byte of decompressed
- Backwards: first byte of compressed must be at least `delta` bytes BEFORE first byte of decompressed

## Online Demo

Open `zx7-js_test.html` in a browser to use the GUI:
- Single file compress/decompress
- Batch directory compression with progress and statistics
- Backwards mode support
- Prefix skip option

## Helper Scripts

- `zx7_batch.py` - Batch compress all files in a directory using zx7.exe

```bash
python zx7_batch.py <input_dir> <output_dir> [zx7.exe] [args...]
# Example with backwards compression:
python zx7_batch.py in out zx7.exe -b
```

- `move_files.py` - Move files from one directory to another

```bash
python move_files.py <source_dir> <target_dir>
```

## Credits

Original C implementation by Einar Saukas (c) 2012-2016  
https://github.com/einar-saukas/

Alternative implementation (ZX7B) by Antonio Villena  
https://github.com/antoniovillena/zx7b

JavaScript port by Bedazzle - 2026

## License

BSD-3 License - See source file for details