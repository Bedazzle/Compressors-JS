# Compressors-JS

Pure JavaScript implementations of compression algorithms commonly used on retro platforms (ZX Spectrum, DOS, ARM, Z80, 6502 and others). Each implementation works in both browser and Node.js with no external dependencies.

## Compressors

| Compressor | Algorithm | Original Author | License |
|------------|-----------|-----------------|---------|
| [zx7](zx7/) | Optimal LZ77/LZSS | Einar Saukas | BSD-3-Clause |
| [zx0](zx0/) | Optimal LZ77/LZSS (improved successor to ZX7) | Einar Saukas | BSD-3-Clause |
| [lc](lc/) | Optimal LZH (Laser Compact 5.2.1) | Hrumer, Nikita Burnashev, Eugene Larchenko | BSD-3-Clause |
| [upkr](upkr/) | LZ with rANS entropy coding | exoticorn (Dennis Ranke) | Unlicense |

## Overview

### ZX7

Optimal LZ77/LZSS compressor by Einar Saukas. Generates perfectly optimal encoding with a maximum back-reference distance of 2176 bytes. Supports forward and backward compression, prefix/suffix referencing, and delta calculation for in-place decompression.

- Original: https://spectrumcomputing.co.uk/entry/27996/ZX-Spectrum/ZX7
- Implementation: https://github.com/antoniovillena/zx7b

### ZX0

Successor to ZX7, also by Einar Saukas. Achieves better compression ratios with a larger maximum offset of 32,640 bytes. Supports V1 (classic) and V2 (default) formats, backward compression, quick mode, and prefix/suffix referencing. Fully compatible with files compressed by the original zx0.exe/dzx0.exe tools.

- Original: https://github.com/einar-saukas/ZX0

### Laser Compact (LC)

Optimal LZH compressor originally designed for the ZX Spectrum, developed by Hrumer (1994-1999, 2014), with a PC version by Nikita Burnashev (2005) and improvements by Eugene Larchenko. Features ZX Spectrum screen-specific compression with pixel reordering. Supports the LCMP5 file format compatible with the original laser.exe tool.

### UPKR

General-purpose LZ compressor with rANS (Asymmetric Numeral Systems) entropy coding by exoticorn (Dennis Ranke). Initially designed for the MicroW8 fantasy console. Achieves compression ratios competitive with Shrinkler while keeping decompression code extremely small. Supports compression levels 0-9, configurable format variants for retro platform decompressors (Z80, x86, ARM), bitstream mode, and parity contexts.

- Original: https://github.com/exoticorn/upkr

## Common Features

All implementations share these characteristics:

- Pure JavaScript, no build step or transpilation required
- Work in browser (via `<script>` tag) and Node.js (via `require`)
- No external dependencies
- Uint8Array-based binary I/O
- Interactive HTML test interface for each compressor

## JavaScript ports by Bedazzle - 2026
