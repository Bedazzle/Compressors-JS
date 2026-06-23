# tests — Z80 depacker × JS packer roundtrip

This harness proves that the **real Z80 depackers** correctly decode what the
**JavaScript packers** in this repo emit — the end-to-end guarantee that matters
for actually shipping compressed data to a ZX Spectrum.

For each test screen and every compressor that ships a Z80 depacker, it:

1. packs the screen with the JS packer (headless browser),
2. assembles the matching Z80 depacker with **ZX-M8XXX**'s `sjasmplus-js`,
3. executes it on **ZX-M8XXX**'s Z80 CPU core, and
4. compares the decompressed `$4000–$5AFF` against the original screen.

A pass means: *JS-compressed → genuine Z80-decompressed → byte-identical screen.*

## Prerequisites

- **Python 3.8+**
- A **Chromium-based browser** (Chrome / Edge / Chromium) — used headlessly via
  `--dump-dom`. Auto-detected from `PATH` and common install locations; override
  with the `BROWSER` environment variable.
- A **ZX-M8XXX** checkout — <https://github.com/Bedazzle/ZX-M8XXX> — which provides
  the Z80 core (`core/z80.js`) and the assembler (`sjasmplus/assembler.js`). By
  default it's expected as a **sibling** of this repo:

  ```
  some-dir/
  ├── Compressors-JS/   ← this repo
  └── ZX-M8XXX/         ← cloned alongside
  ```

  Override the location with `ZX_M8XXX_DIR=/path/to/ZX-M8XXX`.
  (ZX-M8XXX is GPL-3.0, so it is referenced as an external dependency rather than
  vendored into this BSD-licensed repo.)
- **Test screens**: `tests/fixtures/*.scr` listed in `tests/fixtures/manifest.json`.
  Drop in any 6912-byte `.scr` and add it to the manifest.

## Run

```sh
python tests/run_depacker_roundtrip.py
```

With overrides:

```sh
BROWSER=/usr/bin/chromium ZX_M8XXX_DIR=../ZX-M8XXX python tests/run_depacker_roundtrip.py
```

Exit code `0` = all OK, `1` = at least one mismatch/failure, `2` = setup error.

You can also open `tests/depacker-roundtrip.html` directly in a browser **served
over HTTP** (ES-module imports don't work over `file://`). Optional query params:
`?m8xxx=<url>`, `?screens=<json [[name,url],…]>`, `?level=N`.

## Result statuses

| Status      | Meaning                                                              |
|-------------|----------------------------------------------------------------------|
| `OK`        | Z80 depacker reproduced the screen byte-for-byte.                    |
| `OK-ATTRS`  | Depacked fine; packer intentionally rewrote attributes (LgK `optimizeAttrs`) so an exact compare is skipped by design. |
| `MISMATCH`  | Decoded screen differs from the original (`diff@N` = first byte).     |
| `timeout`   | Didn't reach `HALT` within the instruction budget (raise `BUDGET`).   |
| `assemble-*`| The depacker `.asm` failed to assemble.                              |
| `pack-error`| The JS packer threw.                                                 |
| `no-asm`    | Compressor has no embedded Z80 depacker to test.                     |

## How it fits together

The harness reuses `../compressors_compare.html` (loaded in a hidden iframe) for
both the packers and the per-compressor depacker-ASM generation, via the
`window.__packAndAsm(id, screenBytes, level)` and `window.__asmInfoKeys()` hooks
exposed there. Keeping a single source of depacker ASM means the comparison tool
and this test never drift apart.
