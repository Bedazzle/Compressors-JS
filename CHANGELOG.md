# Changelog

All notable changes to **Compressors-JS** are documented here.

## [2026-06-28]

### Added
- **ASC** compressor (`asc-js/`) — pure-JavaScript port of **ASC v2.9**, the ZX Spectrum
  screen compressor by Andrew Strikes Code (Andrey Sendetsky), 1997. LZSS + RLE over an
  8×8-character-cell reorder of the bitmap, emitting a self-extracting block (194-byte
  depacker stub + token stream) that is byte-compatible with the original ASC depacker.
  Includes greedy/lazy/optimal parsing (levels 1–9), bare-token APIs, an interactive
  `asc-js_test.html`, README and MIT LICENSE. Format reconstructed from a byte-exact
  disassembly; roundtrip-verified.
- ASC in the comparison tool (`compressors_compare.html`) as a screen-only method, including
  an **ASM export** button that emits a ready-to-assemble (sjasmplus, ZX-M8XXX `@main`/
  `@entry`) self-extracting depacker for the loaded screen.
- ASC row and overview section in the top-level `README.md`.

### Changed
- `compressors_compare.html`: removed the non-Z80 **UPKR** row (the **UPKR (Z80)** entry
  remains).

### Fixed
- **rip-js**: `RIP`/`mRIP` decompression could throw `"Unexpected end of input"` on some
  streams (observed as mRIP failing the compare-page roundtrip on Undersea at levels 5–6).
  The canonical-Huffman decoder's speculative `maxLen`-bit table lookup overran the
  byte-padded end of the stream; it now treats lookahead bits past EOF as zero. The real
  symbol bits are always present, so decoding is unaffected otherwise.
