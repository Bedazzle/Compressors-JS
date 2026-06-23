(function(){
/*
 * rip-js — RIP (Real Information Packer 0.2x) compression in JavaScript
 * Original format by Roman Petrov (Mesur'a)
 * Z80 depacker reference: uniabis/z80depacker (derip_small.asm, demrip_small.asm)
 * JavaScript port by Bedazzle, 2026.
 * License: BSD-3-Clause — see LICENSE file.
 */

var PRETREE_SYMBOLS = 18;
var PRETREE_BITS = 4;
var MAINTREE_SYMBOLS = 0x120; // 288: 0-255 literals, 256 end marker, 257-287 match lengths
var DISTTREE_SYMBOLS = 32;
var MAX_CODE_LENGTH = 15;

// ---------------------------------------------------------------------------
// BitReader (LSB-first, byte-by-byte, sentinel-based)
// Matches Z80 mWBIT: SRL C / RET NZ / LD C,(IX) / INC IX / RR C / RET
// ---------------------------------------------------------------------------

function BitReader(data, pos) {
    this.data = data;
    this.pos = pos;
    this.buf = 1; // sentinel: when buf===1, buffer is empty
}

BitReader.prototype.readBit = function() {
    if (this.buf <= 1) {
        if (this.pos >= this.data.length) throw new Error('Unexpected end of input');
        this.buf = this.data[this.pos++] | 0x100; // load byte + sentinel at bit 8
    }
    var bit = this.buf & 1;
    this.buf >>>= 1;
    return bit;
};

BitReader.prototype.readBits = function(n) {
    var val = 0;
    for (var i = 0; i < n; i++) {
        val = (val << 1) | this.readBit();
    }
    return val;
};

// ---------------------------------------------------------------------------
// BitWriter (LSB-first, byte-by-byte)
// ---------------------------------------------------------------------------

function BitWriter() {
    this.output = [];
    this.buf = 0;
    this.bitCount = 0;
}

BitWriter.prototype.writeBit = function(bit) {
    this.buf |= (bit & 1) << this.bitCount;
    this.bitCount++;
    if (this.bitCount === 8) {
        this.output.push(this.buf);
        this.buf = 0;
        this.bitCount = 0;
    }
};

BitWriter.prototype.writeBits = function(val, n) {
    for (var i = n - 1; i >= 0; i--) {
        this.writeBit((val >>> i) & 1);
    }
};

BitWriter.prototype.finalize = function() {
    if (this.bitCount > 0) {
        this.output.push(this.buf);
    }
    return new Uint8Array(this.output);
};

// ---------------------------------------------------------------------------
// Canonical Huffman tree builder
// ---------------------------------------------------------------------------

function buildCanonicalTree(codeLengths, numSymbols) {
    var blCount = new Int32Array(MAX_CODE_LENGTH + 1);
    var maxLen = 0;
    for (var i = 0; i < numSymbols; i++) {
        if (codeLengths[i] > 0) {
            blCount[codeLengths[i]]++;
            if (codeLengths[i] > maxLen) maxLen = codeLengths[i];
        }
    }

    if (maxLen === 0) return { codes: new Int32Array(numSymbols), lengths: codeLengths, maxLen: 0 };

    // Compute starting codes (standard canonical Huffman)
    var nextCode = new Int32Array(MAX_CODE_LENGTH + 1);
    var code = 0;
    for (var bits = 1; bits <= maxLen; bits++) {
        code = (code + blCount[bits - 1]) << 1;
        nextCode[bits] = code;
    }

    // Assign codes to symbols in DESCENDING order within each code length
    // (RIP format convention: higher symbols get lower codes at each depth)
    var codes = new Int32Array(numSymbols);
    for (var i = numSymbols - 1; i >= 0; i--) {
        if (codeLengths[i] > 0) {
            codes[i] = nextCode[codeLengths[i]]++;
        }
    }

    return { codes: codes, lengths: codeLengths, maxLen: maxLen };
}

// Build a flat decode table for LSB-first Huffman decoding
function buildDecodeTable(tree, numSymbols) {
    if (tree.maxLen === 0) return null;

    var tableSize = 1 << tree.maxLen;
    var table = new Int16Array(tableSize);
    var lenTable = new Uint8Array(tableSize);

    for (var i = 0; i < tableSize; i++) table[i] = -1;

    for (var sym = 0; sym < numSymbols; sym++) {
        var len = tree.lengths[sym];
        if (len === 0) continue;
        var code = tree.codes[sym];
        // Bit-reverse the code for LSB-first lookup
        var rcode = 0;
        for (var b = 0; b < len; b++) {
            rcode |= ((code >>> (len - 1 - b)) & 1) << b;
        }
        var step = 1 << len;
        for (var idx = rcode; idx < tableSize; idx += step) {
            table[idx] = sym;
            lenTable[idx] = len;
        }
    }

    return { table: table, lenTable: lenTable, maxLen: tree.maxLen };
}

function decodeSymbol(br, dt) {
    // Save state
    var savedBuf = br.buf;
    var savedPos = br.pos;

    // Read maxLen bits (LSB-first)
    var val = 0;
    for (var i = 0; i < dt.maxLen; i++) {
        val |= br.readBit() << i;
    }

    var sym = dt.table[val];
    var len = dt.lenTable[val];

    if (sym < 0) throw new Error('Invalid Huffman code');

    // Put back unused bits by restoring and re-reading only 'len' bits
    var extraBits = dt.maxLen - len;
    if (extraBits > 0) {
        br.buf = savedBuf;
        br.pos = savedPos;
        for (var i = 0; i < len; i++) br.readBit();
    }

    return sym;
}

// Write a Huffman code to LSB-first bitstream
function writeHuffmanCode(bw, tree, symbol) {
    var code = tree.codes[symbol];
    var len = tree.lengths[symbol];
    // Canonical codes are MSB-first; write bit-reversed for LSB-first stream
    for (var i = len - 1; i >= 0; i--) {
        bw.writeBit((code >>> i) & 1);
    }
}

// ---------------------------------------------------------------------------
// LLEN: Variable-length value encoding (used for match lengths and distances)
// ---------------------------------------------------------------------------
// Z80 LLEN routine:
//   ADD A,-5; RET NC  → if code<5: value=code (directly, codes 1-4 map to 1-4)
//   LD L,1; ADC A,L; RRA; RL L → set up initial value and bit count
//   loop: CALL mWBIT; ADC HL,HL; DEC A; JR NZ,loop; INC HL
//
// For code A >= 5:
//   extra_bits = floor((A-3)/2)
//   base = (2 + ((A-3) & 1)) << extra_bits
//   value = base + readBits(extra_bits) + 1

function llenDecode(code, br) {
    if (code <= 0) return 0;
    if (code <= 4) return code;
    var extraBits = (code - 3) >> 1;
    var base = (2 + ((code - 3) & 1)) << extraBits;
    var extra = br.readBits(extraBits);
    return base + extra + 1;
}

function llenEncode(value) {
    if (value <= 0) return { code: 0, extraBits: 0, extraVal: 0 };
    if (value <= 4) return { code: value, extraBits: 0, extraVal: 0 };

    for (var code = 5; code <= 31; code++) {
        var eb = (code - 3) >> 1;
        var base = (2 + ((code - 3) & 1)) << eb;
        if (value >= base + 1 && value <= base + (1 << eb)) {
            return { code: code, extraBits: eb, extraVal: value - base - 1 };
        }
    }
    throw new Error('Value too large for LLEN: ' + value);
}

function llenMaxValue(code) {
    if (code <= 0) return 0;
    if (code <= 4) return code;
    var eb = (code - 3) >> 1;
    var base = (2 + ((code - 3) & 1)) << eb;
    return base + (1 << eb);
}

// ---------------------------------------------------------------------------
// Pre-tree: 18 symbols, 4-bit code lengths
// ---------------------------------------------------------------------------

function readPretree(br, isMrip) {
    var lengths = new Uint8Array(PRETREE_SYMBOLS);
    if (isMrip) {
        for (var i = PRETREE_SYMBOLS - 1; i >= 0; i--) {
            lengths[i] = br.readBits(PRETREE_BITS);
        }
    } else {
        for (var i = 0; i < PRETREE_SYMBOLS; i++) {
            lengths[i] = br.readBits(PRETREE_BITS);
        }
    }
    return lengths;
}

function writePretree(bw, lengths, isMrip) {
    if (isMrip) {
        for (var i = PRETREE_SYMBOLS - 1; i >= 0; i--) {
            bw.writeBits(lengths[i], PRETREE_BITS);
        }
    } else {
        for (var i = 0; i < PRETREE_SYMBOLS; i++) {
            bw.writeBits(lengths[i], PRETREE_BITS);
        }
    }
}

// ---------------------------------------------------------------------------
// Tree code lengths decoding/encoding using pre-tree
// Pre-tree symbols: 0-15 = literal code length, 16 = repeat+stop, 17 = repeat
// Format: 320 combined code lengths (288 main tree + 32 dist tree)
// Symbol 16: repeat last value 2 times, then end sequence
// Symbol 17: repeat last value 2 times, continue
// ---------------------------------------------------------------------------

function readCombinedTreeLengths(br, preDt) {
    // Matches C++ decompress.cpp: reads code lengths until symbol 16 (repeat+stop)
    // Symbol 17 = repeat last value 2 times, continue
    // Symbol 16 = repeat last value 2 times, STOP
    var depths = [];
    var totalNeeded = MAINTREE_SYMBOLS + DISTTREE_SYMBOLS; // 320
    while (true) {
        if (depths.length > totalNeeded + 2) {
            throw new Error('Invalid compressed data: too many code lengths');
        }
        var code = decodeSymbol(br, preDt);
        if (code < 16) {
            depths.push(code);
        } else {
            // code 16 or 17: repeat last value 2 times
            if (depths.length === 0) throw new Error('Invalid compressed data: repeat with no previous');
            var t = depths[depths.length - 1];
            depths.push(t);
            depths.push(t);
            if (code === 16) {
                break; // stop
            }
            // code 17: continue
        }
    }
    if (depths.length < totalNeeded) {
        throw new Error('Invalid compressed data: too few code lengths (' + depths.length + ')');
    }
    var mainLengths = new Uint8Array(MAINTREE_SYMBOLS);
    var distLengths = new Uint8Array(DISTTREE_SYMBOLS);
    for (var i = 0; i < MAINTREE_SYMBOLS; i++) mainLengths[i] = depths[i];
    for (var i = 0; i < DISTTREE_SYMBOLS; i++) distLengths[i] = depths[MAINTREE_SYMBOLS + i];
    return { mainLengths: mainLengths, distLengths: distLengths };
}

function writeCombinedTreeLengths(bw, mainLengths, distLengths, pretree) {
    // Combine 288 main + 32 dist = 320 code lengths
    // Format matches C++ compress.cpp Write_trees:
    //   symbols 0-15 = literal code length
    //   symbol 16 = repeat last value 2 times, STOP (terminator)
    //   symbol 17 = repeat last value 2 times, CONTINUE
    // The sequence MUST end with symbol 16 as terminator.
    // C++ adds 2 fictitious entries equal to last real entry for lookahead.
    var table = [];
    for (var i = 0; i < MAINTREE_SYMBOLS; i++) table.push(mainLengths[i]);
    for (var i = 0; i < DISTTREE_SYMBOLS; i++) table.push(distLengths[i]);
    // Add 2 fictitious entries equal to last value (for symbol 16 termination)
    var last = table[table.length - 1];
    table.push(last);
    table.push(last);

    var totalReal = MAINTREE_SYMBOLS + DISTTREE_SYMBOLS; // 320 (0x140)
    var eosWritten = false;

    for (var i = 0; i < totalReal; ) {
        if (i > 0 && table[i] === table[i - 1] && table[i + 1] === table[i - 1]) {
            if (i + 2 >= totalReal) {
                // At position 318 or 319: use symbol 16 (repeat + stop)
                writeHuffmanCode(bw, pretree, 16);
                i += 2;
                eosWritten = true;
            } else if (pretree.lengths[17] > 0 &&
                       pretree.lengths[17] < 2 * pretree.lengths[table[i]]) {
                // Use symbol 17 (repeat + continue) if it saves bits
                writeHuffmanCode(bw, pretree, 17);
                i += 2;
            } else {
                writeHuffmanCode(bw, pretree, table[i]);
                i++;
            }
        } else {
            writeHuffmanCode(bw, pretree, table[i]);
            i++;
        }
    }

    if (!eosWritten) {
        // All 320 entries written as literals/sym17; append symbol 16 as terminator.
        // This adds 2 fictitious entries (repeating last value), which the
        // decompressor will store but never use (only first 320 matter).
        writeHuffmanCode(bw, pretree, 16);
    }
}

// ---------------------------------------------------------------------------
// Decompressor
// ---------------------------------------------------------------------------

function decompressStream(data, isMrip) {
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data);

    var br = new BitReader(data, 0);

    // Read pre-tree (18 × 4-bit nibbles)
    var pretreeLengths = readPretree(br, isMrip);
    var pretree = buildCanonicalTree(pretreeLengths, PRETREE_SYMBOLS);
    var preDt = buildDecodeTable(pretree, PRETREE_SYMBOLS);

    // Read combined tree code lengths (288 main + 32 dist, terminated by symbol 16)
    var trees = readCombinedTreeLengths(br, preDt);
    var mainTree = buildCanonicalTree(trees.mainLengths, MAINTREE_SYMBOLS);
    var mainDt = buildDecodeTable(mainTree, MAINTREE_SYMBOLS);
    var distTree = buildCanonicalTree(trees.distLengths, DISTTREE_SYMBOLS);
    var distDt = buildDecodeTable(distTree, DISTTREE_SYMBOLS);

    // Main decompression loop
    var output = [];
    var lastOffset = 0;

    while (true) {
        var sym = decodeSymbol(br, mainDt);

        if (sym < 256) {
            output.push(sym);
        } else if (sym === 256) {
            break;
        } else {
            // Match: symbol 257-287
            var lengthCode = sym - 256;
            var matchLength = llenDecode(lengthCode, br);

            var distCode = decodeSymbol(br, distDt);
            var offset;

            if (!isMrip && distCode === 0) {
                // Reuse last offset: no length correction (matches C++ decompressor)
                offset = lastOffset;
            } else {
                offset = llenDecode(distCode, br);
                // Length correction only for newly decoded offsets >= 256
                if (offset >= 256) {
                    matchLength++;
                }
            }

            for (var j = 0; j < matchLength; j++) {
                output.push(output[output.length - offset]);
            }

            lastOffset = offset;
        }
    }

    return new Uint8Array(output);
}

// ---------------------------------------------------------------------------
// Compressor: match finding, greedy/optimal parsing, tree building
// ---------------------------------------------------------------------------

// Greedy parse to collect initial symbol frequencies
function greedyParse(data, isMrip, maxDist) {
    var litFreqs = new Int32Array(MAINTREE_SYMBOLS);
    var distFreqs = new Int32Array(DISTTREE_SYMBOLS);
    var pos = 0;
    var lastOffset = 0;
    var maxMatchLen = llenMaxValue(31);

    while (pos < data.length) {
        var bestMatch = null;
        var limit = pos < maxDist ? pos : maxDist;

        for (var dist = 1; dist <= limit; dist++) {
            var len = 0;
            while (pos + len < data.length && len < maxMatchLen && data[pos + len] === data[pos - dist + len]) {
                len++;
            }
            if (len >= 2) {
                if (!bestMatch || len > bestMatch.len || (len === bestMatch.len && dist < bestMatch.dist)) {
                    bestMatch = { len: len, dist: dist };
                }
            }
        }

        if (bestMatch && bestMatch.len >= 2) {
            var matchLen = bestMatch.len;
            var offset = bestMatch.dist;
            var isReuse = !isMrip && offset === lastOffset;
            // Length correction only for non-reuse offsets >= 256
            // (reuse offset: Z80 skips INC BC, C++ skips count++ in reuse branch)
            var adjLen = matchLen;
            if (!isReuse && offset >= 256) adjLen--;
            if (adjLen < 1) { litFreqs[data[pos]]++; pos++; continue; }

            var lengthEnc = llenEncode(adjLen);
            litFreqs[256 + lengthEnc.code]++;

            if (isReuse) {
                distFreqs[0]++;
            } else {
                var distEnc = llenEncode(offset);
                distFreqs[distEnc.code]++;
            }

            lastOffset = offset;
            pos += matchLen;
        } else {
            litFreqs[data[pos]]++;
            pos++;
        }
    }

    litFreqs[256]++; // end marker
    return { litFreqs: litFreqs, distFreqs: distFreqs };
}

// Greedy parse producing token sequence
function greedyParseTokens(data, isMrip, maxDist) {
    var tokens = [];
    var pos = 0;
    var lastOffset = 0;
    var maxMatchLen = llenMaxValue(31);

    while (pos < data.length) {
        var bestMatch = null;
        var limit = pos < maxDist ? pos : maxDist;

        for (var dist = 1; dist <= limit; dist++) {
            var len = 0;
            while (pos + len < data.length && len < maxMatchLen && data[pos + len] === data[pos - dist + len]) {
                len++;
            }
            if (len >= 2) {
                if (!bestMatch || len > bestMatch.len || (len === bestMatch.len && dist < bestMatch.dist)) {
                    bestMatch = { len: len, dist: dist };
                }
            }
        }

        if (bestMatch && bestMatch.len >= 2) {
            tokens.push({ type: 'match', len: bestMatch.len, dist: bestMatch.dist });
            lastOffset = bestMatch.dist;
            pos += bestMatch.len;
        } else {
            tokens.push({ type: 'lit', value: data[pos] });
            pos++;
        }
    }

    tokens.push({ type: 'end' });
    return tokens;
}

// Build optimal Huffman code lengths from frequencies
function buildHuffmanLengths(freqs, numSymbols, maxLen) {
    var items = [];
    for (var i = 0; i < numSymbols; i++) {
        if (freqs[i] > 0) items.push({ sym: i, freq: freqs[i] });
    }

    if (items.length === 0) return new Uint8Array(numSymbols);

    if (items.length === 1) {
        // Z80 depacker requires at least 2 leaf nodes
        var lengths = new Uint8Array(numSymbols);
        lengths[items[0].sym] = 1;
        // Add a dummy symbol adjacent to the real one
        var dummy = items[0].sym > 0 ? items[0].sym - 1 : items[0].sym + 1;
        if (dummy < numSymbols) lengths[dummy] = 1;
        return lengths;
    }

    // Sort by frequency
    items.sort(function(a, b) { return a.freq - b.freq || a.sym - b.sym; });

    // Build Huffman tree using priority queue (sorted array)
    var nodes = [];
    for (var i = 0; i < items.length; i++) {
        nodes.push({ freq: items[i].freq, depth: 0, syms: [items[i].sym] });
    }

    while (nodes.length > 1) {
        nodes.sort(function(a, b) { return a.freq - b.freq; });
        var left = nodes.shift();
        var right = nodes.shift();
        nodes.push({
            freq: left.freq + right.freq,
            depth: 0,
            left: left,
            right: right,
            syms: []
        });
    }

    // Extract code lengths via tree traversal
    var lengths = new Uint8Array(numSymbols);
    function traverse(node, depth) {
        if (node.syms && node.syms.length > 0) {
            for (var i = 0; i < node.syms.length; i++) {
                lengths[node.syms[i]] = depth;
            }
            return;
        }
        if (node.left) traverse(node.left, depth + 1);
        if (node.right) traverse(node.right, depth + 1);
    }
    traverse(nodes[0], 0);

    // Handle edge case: all same frequency -> depth could be 0 for root
    // For 2+ symbols tree depth should be >= 1
    var hasAny = false;
    for (var i = 0; i < numSymbols; i++) {
        if (lengths[i] > 0) { hasAny = true; break; }
    }
    if (!hasAny && items.length >= 2) {
        // Two-symbol degenerate case
        lengths[items[0].sym] = 1;
        lengths[items[1].sym] = 1;
    }

    // Limit code lengths to maxLen
    var needsFix = false;
    for (var i = 0; i < numSymbols; i++) {
        if (lengths[i] > maxLen) { lengths[i] = maxLen; needsFix = true; }
    }

    if (needsFix) {
        // After clamping, Kraft inequality may be violated (sum > 1)
        // Increase lengths of shortest codes until satisfied
        for (var iter = 0; iter < 200; iter++) {
            var kraft = 0;
            for (var i = 0; i < numSymbols; i++) {
                if (lengths[i] > 0) kraft += 1 << (maxLen - lengths[i]);
            }
            var target = 1 << maxLen;
            if (kraft <= target) break;

            // Find symbol with shortest code length and increase it
            var minLen = maxLen + 1;
            for (var i = 0; i < numSymbols; i++) {
                if (lengths[i] > 0 && lengths[i] < minLen) minLen = lengths[i];
            }
            for (var i = 0; i < numSymbols; i++) {
                if (lengths[i] === minLen) { lengths[i]++; break; }
            }
        }
    }

    // Adjust Kraft sum to equal 1 (fill unused code space by shortening codes)
    for (var iter = 0; iter < 200; iter++) {
        var kraft = 0;
        for (var i = 0; i < numSymbols; i++) {
            if (lengths[i] > 0) kraft += 1 << (maxLen - lengths[i]);
        }
        var target = 1 << maxLen;
        if (kraft >= target) break;

        // Find longest code and shorten it if possible
        var maxFound = 0, maxSym = -1;
        for (var i = 0; i < numSymbols; i++) {
            if (lengths[i] > maxFound) { maxFound = lengths[i]; maxSym = i; }
        }
        if (maxSym < 0 || maxFound <= 1) break;

        var newKraft = kraft - (1 << (maxLen - maxFound)) + (1 << (maxLen - maxFound + 1));
        if (newKraft <= target) {
            lengths[maxSym]--;
        } else {
            break;
        }
    }

    return lengths;
}

// Build pre-tree code lengths from main+dist tree lengths
function buildPretreeLengths(mainLengths, distLengths) {
    var freqs = new Int32Array(PRETREE_SYMBOLS);
    for (var i = 0; i < MAINTREE_SYMBOLS; i++) freqs[mainLengths[i]]++;
    for (var i = 0; i < DISTTREE_SYMBOLS; i++) freqs[distLengths[i]]++;
    freqs[16] = Math.max(freqs[16], 1); // symbol 16 is required as terminator
    return buildHuffmanLengths(freqs, PRETREE_SYMBOLS, MAX_CODE_LENGTH);
}

// Collect frequencies from token sequence
function collectFrequencies(tokens, isMrip) {
    var litFreqs = new Int32Array(MAINTREE_SYMBOLS);
    var distFreqs = new Int32Array(DISTTREE_SYMBOLS);
    var lastOffset = 0;

    for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        if (t.type === 'lit') {
            litFreqs[t.value]++;
        } else if (t.type === 'end') {
            litFreqs[256]++;
        } else if (t.type === 'match') {
            var isReuse = !isMrip && t.dist === lastOffset;
            var adjLen = t.len;
            if (!isReuse && t.dist >= 256) adjLen--;

            var lenEnc = llenEncode(adjLen);
            litFreqs[256 + lenEnc.code]++;

            if (isReuse) {
                distFreqs[0]++;
            } else {
                var distEnc = llenEncode(t.dist);
                distFreqs[distEnc.code]++;
            }
            lastOffset = t.dist;
        }
    }

    return { litFreqs: litFreqs, distFreqs: distFreqs };
}

// Backward DP optimal parser
function optimalParse(data, isMrip, mainTree, distTree, maxDist) {
    var n = data.length;
    var maxMatchLen = llenMaxValue(31);
    var INF = 0x7FFFFFFF;

    var cost = new Int32Array(n + 1);
    var choice = new Array(n + 1);

    // End marker cost
    cost[n] = mainTree.lengths[256] || 1;

    for (var pos = n - 1; pos >= 0; pos--) {
        var bestCost = INF;
        var bestChoice = null;

        // Try literal
        var litLen = mainTree.lengths[data[pos]];
        if (litLen > 0) {
            var c = litLen + cost[pos + 1];
            if (c < bestCost) { bestCost = c; bestChoice = { type: 'lit' }; }
        }

        // Try matches
        var limit = pos < maxDist ? pos : maxDist;
        var scannedBestLen = 0;
        for (var dist = 1; dist <= limit; dist++) {
            var mlen = 0;
            while (pos + mlen < n && mlen < maxMatchLen && data[pos + mlen] === data[pos - dist + mlen]) {
                mlen++;
            }
            if (mlen < 2) continue;
            if (mlen <= scannedBestLen) continue;
            scannedBestLen = mlen;

            for (var len = 2; len <= mlen && pos + len <= n; len++) {
                var adjLen = len;
                if (dist >= 256) adjLen--;
                if (adjLen < 1) continue;

                var lenEnc;
                try { lenEnc = llenEncode(adjLen); } catch(e) { continue; }
                if (lenEnc.code > 31) continue;

                var lenSymbol = 256 + lenEnc.code;
                var lenTreeCost = mainTree.lengths[lenSymbol];
                if (lenTreeCost === 0) continue;

                var distEnc;
                try { distEnc = llenEncode(dist); } catch(e) { continue; }
                if (distEnc.code > 31) continue;

                var distTreeCost = distTree.lengths[distEnc.code];
                if (distTreeCost === 0) continue;

                var totalBits = lenTreeCost + lenEnc.extraBits + distTreeCost + distEnc.extraBits + cost[pos + len];

                if (totalBits < bestCost) {
                    bestCost = totalBits;
                    bestChoice = { type: 'match', len: len, dist: dist };
                }
            }
        }

        if (bestChoice === null) {
            bestCost = 15 + cost[pos + 1]; // worst-case literal
            bestChoice = { type: 'lit' };
        }

        cost[pos] = bestCost;
        choice[pos] = bestChoice;
    }

    // Extract token sequence
    var tokens = [];
    var pos = 0;
    while (pos < n) {
        var ch = choice[pos];
        if (ch.type === 'lit') {
            tokens.push({ type: 'lit', value: data[pos] });
            pos++;
        } else {
            tokens.push({ type: 'match', len: ch.len, dist: ch.dist });
            pos += ch.len;
        }
    }
    tokens.push({ type: 'end' });
    return tokens;
}

// Main compression function
function compressStream(data, isMrip, level) {
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data);

    level = level || 5;
    if (level < 1) level = 1;
    if (level > 9) level = 9;

    var maxDist;
    if (level <= 2) maxDist = 256;
    else if (level <= 4) maxDist = 2048;
    else if (level <= 6) maxDist = 8192;
    else if (level <= 8) maxDist = 32768;
    else maxDist = 49152;

    // Handle empty input
    if (data.length === 0) {
        var litFreqs = new Int32Array(MAINTREE_SYMBOLS);
        litFreqs[256] = 1; // end marker
        var distFreqs = new Int32Array(DISTTREE_SYMBOLS);
        distFreqs[0] = 1; // need at least one dist symbol for valid tree

        var mainLengths = buildHuffmanLengths(litFreqs, MAINTREE_SYMBOLS, MAX_CODE_LENGTH);
        var distLengths = buildHuffmanLengths(distFreqs, DISTTREE_SYMBOLS, MAX_CODE_LENGTH);
        var pretreeLengths = buildPretreeLengths(mainLengths, distLengths);
        var pretree = buildCanonicalTree(pretreeLengths, PRETREE_SYMBOLS);
        var mainTree = buildCanonicalTree(mainLengths, MAINTREE_SYMBOLS);

        var bw = new BitWriter();
        writePretree(bw, pretreeLengths, isMrip);
        writeCombinedTreeLengths(bw, mainLengths, distLengths, pretree);
        writeHuffmanCode(bw, mainTree, 256);
        return bw.finalize();
    }

    // Pass 1: Greedy/optimal parse to collect tokens
    var tokens;
    if (level >= 7) {
        // First pass: greedy parse for initial frequencies
        var freqs = greedyParse(data, isMrip, maxDist);
        var mainLengths = buildHuffmanLengths(freqs.litFreqs, MAINTREE_SYMBOLS, MAX_CODE_LENGTH);
        var distLengths = buildHuffmanLengths(freqs.distFreqs, DISTTREE_SYMBOLS, MAX_CODE_LENGTH);
        var mainTree = buildCanonicalTree(mainLengths, MAINTREE_SYMBOLS);
        var distTree = buildCanonicalTree(distLengths, DISTTREE_SYMBOLS);

        // Optimal parse iteration 1
        tokens = optimalParse(data, isMrip, mainTree, distTree, maxDist);
        var newFreqs = collectFrequencies(tokens, isMrip);
        mainLengths = buildHuffmanLengths(newFreqs.litFreqs, MAINTREE_SYMBOLS, MAX_CODE_LENGTH);
        distLengths = buildHuffmanLengths(newFreqs.distFreqs, DISTTREE_SYMBOLS, MAX_CODE_LENGTH);
        mainTree = buildCanonicalTree(mainLengths, MAINTREE_SYMBOLS);
        distTree = buildCanonicalTree(distLengths, DISTTREE_SYMBOLS);

        // Optimal parse iteration 2
        tokens = optimalParse(data, isMrip, mainTree, distTree, maxDist);
        newFreqs = collectFrequencies(tokens, isMrip);
        mainLengths = buildHuffmanLengths(newFreqs.litFreqs, MAINTREE_SYMBOLS, MAX_CODE_LENGTH);
        distLengths = buildHuffmanLengths(newFreqs.distFreqs, DISTTREE_SYMBOLS, MAX_CODE_LENGTH);
        mainTree = buildCanonicalTree(mainLengths, MAINTREE_SYMBOLS);
        distTree = buildCanonicalTree(distLengths, DISTTREE_SYMBOLS);
    } else {
        tokens = greedyParseTokens(data, isMrip, maxDist);
        var freqs = collectFrequencies(tokens, isMrip);
        var mainLengths = buildHuffmanLengths(freqs.litFreqs, MAINTREE_SYMBOLS, MAX_CODE_LENGTH);
        var distLengths = buildHuffmanLengths(freqs.distFreqs, DISTTREE_SYMBOLS, MAX_CODE_LENGTH);
        var mainTree = buildCanonicalTree(mainLengths, MAINTREE_SYMBOLS);
        var distTree = buildCanonicalTree(distLengths, DISTTREE_SYMBOLS);
    }

    // Build pre-tree
    var pretreeLengths = buildPretreeLengths(mainLengths, distLengths);
    var pretree = buildCanonicalTree(pretreeLengths, PRETREE_SYMBOLS);

    // Encode bitstream
    var bw = new BitWriter();
    writePretree(bw, pretreeLengths, isMrip);
    writeCombinedTreeLengths(bw, mainLengths, distLengths, pretree);

    // Write tokens
    var lastOffset = 0;
    for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        if (t.type === 'lit') {
            writeHuffmanCode(bw, mainTree, t.value);
        } else if (t.type === 'end') {
            writeHuffmanCode(bw, mainTree, 256);
        } else if (t.type === 'match') {
            var isReuse = !isMrip && t.dist === lastOffset;
            var adjLen = t.len;
            if (!isReuse && t.dist >= 256) adjLen--;

            var lenEnc = llenEncode(adjLen);
            writeHuffmanCode(bw, mainTree, 256 + lenEnc.code);
            bw.writeBits(lenEnc.extraVal, lenEnc.extraBits);

            if (isReuse) {
                writeHuffmanCode(bw, distTree, 0);
            } else {
                var distEnc = llenEncode(t.dist);
                writeHuffmanCode(bw, distTree, distEnc.code);
                bw.writeBits(distEnc.extraVal, distEnc.extraBits);
            }

            lastOffset = t.dist;
        }
    }

    return bw.finalize();
}

// ---------------------------------------------------------------------------
// API wrappers
// ---------------------------------------------------------------------------

function compressRip(data, level) {
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
    return compressStream(data, false, level);
}

function decompressRip(data) {
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
    return decompressStream(data, false);
}

function compressMrip(data, level) {
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
    return compressStream(data, true, level);
}

function decompressMrip(data) {
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
    return decompressStream(data, true);
}

function compressArray(data, level) {
    return compressRip(data instanceof Uint8Array ? data : new Uint8Array(data), level);
}

function decompressArray(data) {
    return decompressRip(data instanceof Uint8Array ? data : new Uint8Array(data));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined') {
    window.RIP = {
        compress: compressRip,
        decompress: decompressRip,
        compressMrip: compressMrip,
        decompressMrip: decompressMrip,
        compressArray: compressArray,
        decompressArray: decompressArray
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        compress: compressRip,
        decompress: decompressRip,
        compressMrip: compressMrip,
        decompressMrip: decompressMrip,
        compressArray: compressArray,
        decompressArray: decompressArray
    };
}
})();
