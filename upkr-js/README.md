# UPKR-JS - LZ Compression with rANS Entropy Coding

JavaScript implementation of the upkr compression format, originally developed by exoticorn (Dennis Ranke).

## About

upkr is a general-purpose LZ compressor with rANS (Asymmetric Numeral Systems) entropy coding. Initially designed for the MicroW8 fantasy console, it achieves compression ratios competitive with Shrinkler while keeping decompression code extremely small (under 140 bytes for an optimized DOS decompressor).

## Features

- LZ77-style compression with adaptive arithmetic (rANS) entropy coding
- Multiple compression levels (0-9) trading speed for ratio
- Repeated offset optimization for better compression
- Reverse mode for reversed input/output processing
- Configurable format variants for retro platform decompressors (Z80, 6502, ARM, x86-16, RISC-V)
- Config presets for Z80, x86, and x86b unpackers
- Bitstream mode for 8/16-bit CPUs (16-bit rANS state)
- Parity contexts for structured data (ARM instructions, 16-bit samples)

## Usage

### Browser

```html
<script src="upkr-js.js"></script>
<script>
    // Compress (level 0-9, default 1)
    const compressed = UPKR.compress(data, 1);

    // Decompress
    const decompressed = UPKR.decompress(compressed);
</script>
```

### Node.js

```javascript
const UPKR = require('./upkr-js.js');

// Compress (returns Uint8Array)
const compressed = UPKR.compress(data, 1);

// Decompress (returns Uint8Array)
const decompressed = UPKR.decompress(compressed);
```

## API

### Compression Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `UPKR.compress(data, level, config, reverse)` | data: Uint8Array, level: number (0-9), config: object, reverse: boolean | Uint8Array |
| `UPKR.compressArray(data, level, config, reverse)` | data: Array/Uint8Array, level: number, config: object, reverse: boolean | Uint8Array |

### Decompression Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `UPKR.decompress(data, config, reverse)` | data: Uint8Array, config: object, reverse: boolean | Uint8Array |
| `UPKR.decompressArray(data, config, reverse)` | data: Array/Uint8Array, config: object, reverse: boolean | Uint8Array |

### Configuration

| Function | Returns |
|----------|---------|
| `UPKR.defaultConfig()` | Default config object |
| `UPKR.configZ80()` | Z80 preset: big-endian bitstream, inverted bit encoding, simplified prob update |
| `UPKR.configX86()` | x86 preset: bitstream, inverted match/new-offset/continue bits |
| `UPKR.configX86b()` | x86b preset: bitstream, inverted continue bit, no repeated offsets |

### Compression Levels

| Level | Strategy | Notes |
|-------|----------|-------|
| 0 | Greedy | Fastest, takes first best match |
| 1 | Optimal parsing | Default, good balance |
| 2-4 | Optimal with arrivals | Progressively better ratio |
| 5-7 | Optimal with near-matches | Near-match search for better offsets |
| 8-9 | Maximum compression | Most thorough search, slowest |

Higher levels roughly halve compression speed for each increment.

### Config Options

```javascript
const config = UPKR.defaultConfig();
// Returns:
{
    use_bitstream: false,          // Bitstream mode (16-bit rANS state)
    parity_contexts: 1,            // Literal context groups (1, 2, or 4)
    invert_bit_encoding: false,    // Invert rANS bit encoding
    is_match_bit: true,            // Bit value encoding a match
    new_offset_bit: true,          // Bit value encoding a new offset
    continue_value_bit: true,      // Bit value encoding "more bits follow"
    bitstream_is_big_endian: false, // Big-endian bitstream order
    simplified_prob_update: false,  // Simplified probability update (Z80)
    no_repeated_offsets: false,     // Disable repeated offset optimization
    eof_in_length: false,           // EOF marker in length instead of offset
    max_offset: 0x7FFFFFFF,        // Maximum match offset
    max_length: 0x7FFFFFFF          // Maximum match length
}
```

Use `defaultConfig()` for standard upkr format. Custom configs are needed only when targeting specific platform decompressors.

### Bitstream Mode (`use_bitstream`)

Controls how data is fed into the rANS state:

- **Off (default)**: Whole bytes shifted in, 20-bit state. Faster on modern hardware.
- **On**: Single bits shifted in, 16-bit state. Required for 8/16-bit CPUs (Z80, 6502, x86-16) where 20-bit state is expensive.

Both compressor and decompressor must use the same setting.

### Parity Contexts (`parity_contexts`)

Partitions literal contexts by byte position:

- **1 (default)**: All bytes share contexts. General-purpose.
- **2**: Even/odd byte positions get separate contexts. Useful for 16-bit structured data.
- **4**: Four context groups by position mod 4. Designed for 32-bit ARM code where each instruction byte has distinct patterns.

More parity contexts improve compression on structured data but hurt on small or unstructured files.

### Reverse Mode

Reverses input before compression and reverses output after. Equivalent to `upkr -r`. Both compressor and decompressor must use the same setting.

```javascript
const compressed = UPKR.compress(data, 1, null, true);
const decompressed = UPKR.decompress(compressed, null, true);
```

### Config Presets

Pre-configured settings matching the original `upkr.exe` presets for specific platform unpackers:

| Preset | Equivalent CLI | Settings |
|--------|---------------|----------|
| `UPKR.configZ80()` | `upkr --z80` | Big-endian bitstream, inverted bit encoding, simplified prob update (level 9 recommended) |
| `UPKR.configX86()` | `upkr --x86` | Bitstream, inverted match/new-offset/continue bits |
| `UPKR.configX86b()` | `upkr --x86b` | Bitstream, inverted continue bit, no repeated offsets (level 9 recommended) |

```javascript
// Compress for Z80 target
const compressed = UPKR.compress(data, 9, UPKR.configZ80());

// Compress for x86 DOS target
const compressed = UPKR.compress(data, 1, UPKR.configX86());
```

## Online Demo

Open `upkr-js_test.html` in a browser to use the GUI:
- Single file compress/decompress
- Batch directory compression with progress and statistics
- Config presets for Z80, x86, and x86b targets
- All config options exposed: compression level, bitstream mode, parity contexts, reverse, bit inversion flags, max offset/length

## Compatibility

Data compressed with the reference Rust `upkr` tool can be decompressed with this JS implementation and vice versa, when using matching config settings. The default config matches `Config::default()` in the Rust implementation exactly.

## Credits

Original Rust implementation by exoticorn (Dennis Ranke)
https://github.com/exoticorn/upkr

JavaScript port by Bedazzle - 2026

## License

Unlicense (public domain) - See UNLICENSE for details
