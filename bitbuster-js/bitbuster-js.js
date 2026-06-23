(function(){
/*
 * bitbuster-js — BitBuster 1.2 + BitBuster 2 LZ77 compression in JavaScript
 * Original format by Arjan Bakker (Team Bomba), 2002-2004 — https://github.com/abekermsx/BitBuster-1.2
 * JavaScript port by Bedazzle, 2026.
 * License: MIT — see LICENSE file.
 */

var MAX_OFFSET = 2048;  // 11-bit offset: (15 << 7) | 127 + 1 = 2048
var MAX_LEN = 65535;

// ---------------------------------------------------------------------------
// BitReader (MSB-first, 8-bit byte buffer)
// ---------------------------------------------------------------------------

function BitReader(data) {
    this.data = data;
    this.pos = 0;
    this.bitData = 0;
    this.bitCount = 8; // forces load on first read
}

BitReader.prototype.readBit = function() {
    if (this.bitCount === 8) {
        this.bitData = this.data[this.pos++];
        this.bitCount = 0;
    }
    this.bitCount++;
    var bit = (this.bitData & 128) >> 7;
    this.bitData = (this.bitData << 1) & 0xFF;
    return bit;
};

BitReader.prototype.readByte = function() {
    return this.data[this.pos++];
};

// ---------------------------------------------------------------------------
// BitWriter (MSB-first, 8-bit byte buffer with deferred bit-byte placement)
// ---------------------------------------------------------------------------

function BitWriter() {
    this.output = [];
    this.bitData = 0;
    this.bitCount = 0;
    this.bitPos = 0; // position in output where current bit byte lives
    // Reserve first byte for bits
    this.output.push(0);
}

BitWriter.prototype.writeBit = function(value) {
    if (this.bitCount === 8) {
        // Finalize current bit byte
        this.output[this.bitPos] = this.bitData;
        // New bit byte position is at end
        this.bitPos = this.output.length;
        this.output.push(0);
        this.bitCount = 0;
        this.bitData = 0;
    }
    this.bitData = (this.bitData << 1) | (value ? 1 : 0);
    this.bitCount++;
};

BitWriter.prototype.writeByte = function(value) {
    this.output.push(value & 0xFF);
};

BitWriter.prototype.finalize = function() {
    if (this.bitCount > 0 && this.bitCount < 8) {
        this.bitData <<= (8 - this.bitCount);
    }
    this.output[this.bitPos] = this.bitData & 0xFF;
    return new Uint8Array(this.output);
};

// ---------------------------------------------------------------------------
// Elias Gamma coding - BitBuster 1.2 (sequential: prefix 1's, 0, value bits)
// ---------------------------------------------------------------------------
// The BB1.2 Z80 depacker counts all prefix 1-bits first (determining the
// bit-width), then reads that many value bits in a separate pass.
//
// Encoding:
// 0       -> "0"
// 1,2     -> "10x"       (prefix=1, term=0, 1 value bit)
// 3-6     -> "110xx"     (prefix=11, term=0, 2 value bits)
// 7-14    -> "1110xxx"   (prefix=111, term=0, 3 value bits)
// etc.

function gammaSize(value) {
    var size = 1;
    while (value) {
        value--;
        size += 2;
        value >>= 1;
    }
    return size;
}

function writeGammaSeq(bw, value) {
    var bitSize = gammaSize(value);
    bitSize--;
    bitSize = bitSize >> 1; // number of prefix 1-bits

    for (var c = 0; c < bitSize; c++) {
        bw.writeBit(1);
    }
    bw.writeBit(0);

    value++;
    var mask = 1 << (bitSize - 1);
    for (var b = 0; b < bitSize; b++) {
        bw.writeBit(value & mask);
        mask >>= 1;
    }
}

// Read sequential gamma. Returns -1 for EOF (overflow).
function readGammaSeq(br) {
    var numBits = 0;
    while (br.readBit()) {
        numBits++;
        if (numBits >= 16) return -1; // overflow = EOF
    }
    var value = 1;
    for (var i = 0; i < numBits; i++) {
        value = (value << 1) | br.readBit();
    }
    value++;
    return value;
}

// ---------------------------------------------------------------------------
// Elias Gamma coding - BitBuster 2 (interleaved: cont, val, cont, val, ..., 0)
// ---------------------------------------------------------------------------
// The BB2 C++ encoder/decoder interleaves continuation and value bits:
//   while (bit==1) { value <<= 1; value += nextBit; } value++;
//
// Encoding:
// 0       -> "0"
// 1,2     -> "1x0"       (cont=1, val=x, term=0)
// 3-6     -> "1x1y0"     (cont=1, val=x, cont=1, val=y, term=0)
// etc.

function writeGammaInterleaved(bw, value) {
    value++;
    // Find the highest bit position
    var mask = 1;
    while (mask * 2 <= value) mask *= 2;
    // Write from MSB-1 down to bit 0
    while (true) {
        if (mask === 1) {
            bw.writeBit(0); // terminator
            return;
        }
        mask >>= 1;
        bw.writeBit(1); // continuation
        bw.writeBit(value & mask); // value bit
    }
}

// Read interleaved gamma. Returns -1 for EOF (overflow).
function readGammaInterleaved(br) {
    var value = 1;
    while (br.readBit()) {
        value <<= 1;
        value += br.readBit();
        if (value >= 65535) return -1; // overflow = EOF
    }
    value++;
    return value;
}

// ---------------------------------------------------------------------------
// Offset encoding/decoding
// ---------------------------------------------------------------------------

// Cost of encoding an offset (in bits): 8 for short, 12 for long
function offsetBits(offset) {
    // offset is 1-based (1..2048)
    var off0 = offset - 1; // 0-based (0..2047)
    return off0 < 128 ? 8 : 12;
}

function writeOffset(bw, offset) {
    var off0 = offset - 1; // 0-based
    if (off0 >= 128) {
        // Long offset: write low byte with bit 7 forced on, then 4 high bits MSB-first
        bw.writeByte(off0 | 128);
        var high = off0 >> 7;
        bw.writeBit(high & 8);
        bw.writeBit(high & 4);
        bw.writeBit(high & 2);
        bw.writeBit(high & 1);
    } else {
        // Short offset: write low 7 bits (bit 7 = 0)
        bw.writeByte(off0);
    }
}

function readOffset(br) {
    var low = br.readByte();
    if (low & 128) {
        low &= 127;
        var high = 0;
        high += br.readBit() << 3;
        high += br.readBit() << 2;
        high += br.readBit() << 1;
        high += br.readBit();
        return ((high << 7) | low) + 1;
    } else {
        return low + 1;
    }
}

// ---------------------------------------------------------------------------
// Match finder (brute-force backward scan, max 2048 window)
// ---------------------------------------------------------------------------

// Find best match at position (greedy)
function findBestMatch(data, pos, maxOffset) {
    var len = data.length;
    var maxBack = Math.min(pos, maxOffset);
    var bestLen = 1;
    var bestOff = 0;

    for (var dist = 1; dist <= maxBack; dist++) {
        var matchLen = 0;
        while (pos + matchLen < len && data[pos + matchLen] === data[pos - dist + matchLen]) {
            matchLen++;
            if (matchLen >= MAX_LEN) break;
        }
        if (matchLen > bestLen) {
            bestLen = matchLen;
            bestOff = dist;
        }
    }
    if (bestLen >= 2) return { offset: bestOff, length: bestLen };
    return null;
}

// ---------------------------------------------------------------------------
// Cost model for optimal parsing
// ---------------------------------------------------------------------------

function literalCost() { return 9; } // 1 flag bit + 8 data bits

function matchCost(offset, length) {
    // 1 flag bit + offset bits + gamma(length-2) bits
    return 1 + offsetBits(offset) + gammaSize(length - 2);
}

// ---------------------------------------------------------------------------
// Optimal parser (forward DP)
// ---------------------------------------------------------------------------

function optimalParse(data, maxOffset) {
    var n = data.length;
    if (n === 0) return [];

    // cost[i] = minimum bit cost to encode data[0..i-1]
    var cost = new Array(n + 1);
    var choice = new Array(n + 1);
    cost[0] = 0;
    choice[0] = null;

    for (var i = 0; i < n; i++) {
        // Literal option
        var litCost = cost[i] + literalCost();
        if (cost[i + 1] === undefined || litCost < cost[i + 1]) {
            cost[i + 1] = litCost;
            choice[i + 1] = { type: 'lit', pos: i };
        }

        // Match options
        var maxBack = Math.min(i, maxOffset);
        for (var dist = 1; dist <= maxBack; dist++) {
            var matchLen = 0;
            while (i + matchLen < n && data[i + matchLen] === data[i - dist + matchLen]) {
                matchLen++;
                if (matchLen >= MAX_LEN) break;
            }
            if (matchLen >= 2) {
                // Try all lengths from 2 to matchLen
                for (var ml = 2; ml <= matchLen; ml++) {
                    var mc = cost[i] + matchCost(dist, ml);
                    if (cost[i + ml] === undefined || mc < cost[i + ml]) {
                        cost[i + ml] = mc;
                        choice[i + ml] = { type: 'match', pos: i, offset: dist, length: ml };
                    }
                }
            }
        }
    }

    // Trace back to get token list
    var tokens = [];
    var pos = n;
    while (pos > 0) {
        var ch = choice[pos];
        if (ch.type === 'lit') {
            tokens.push({ type: 'lit', value: data[ch.pos] });
            pos = ch.pos;
        } else {
            tokens.push({ type: 'match', offset: ch.offset, length: ch.length });
            pos = ch.pos;
        }
    }
    tokens.reverse();
    return tokens;
}

// ---------------------------------------------------------------------------
// Greedy parser
// ---------------------------------------------------------------------------

function greedyParse(data, maxOffset, lazy) {
    var tokens = [];
    var pos = 0;
    var n = data.length;

    while (pos < n) {
        var m = findBestMatch(data, pos, maxOffset);
        if (m && lazy && pos + 1 < n) {
            // Lazy evaluation: check if next position gives a better match
            var m2 = findBestMatch(data, pos + 1, maxOffset);
            if (m2 && m2.length > m.length + 1) {
                // Better to emit literal now and use next match
                tokens.push({ type: 'lit', value: data[pos] });
                pos++;
                continue;
            }
        }
        if (m) {
            tokens.push({ type: 'match', offset: m.offset, length: m.length });
            pos += m.length;
        } else {
            tokens.push({ type: 'lit', value: data[pos] });
            pos++;
        }
    }
    return tokens;
}

// ---------------------------------------------------------------------------
// Parse dispatcher by level
// ---------------------------------------------------------------------------

function parseData(data, level) {
    if (!level || level < 1) level = 5;
    if (level > 9) level = 9;

    if (level <= 3) {
        return greedyParse(data, MAX_OFFSET, false);
    } else if (level <= 6) {
        return greedyParse(data, MAX_OFFSET, true);
    } else {
        return optimalParse(data, MAX_OFFSET);
    }
}

// ---------------------------------------------------------------------------
// BitBuster 1.2 Compressor
// ---------------------------------------------------------------------------

// Token order for BB1.2: flag(1) -> offset -> gamma_seq(length-2)
function compressBB12(data, level) {
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
    var n = data.length;

    // Empty input
    if (n === 0) {
        var bw = new BitWriter();
        bw.writeBit(1); // match flag
        bw.writeByte(0); // offset 0
        for (var i = 0; i < 16; i++) bw.writeBit(1);
        bw.writeBit(0);
        var stream = bw.finalize();
        var result = new Uint8Array(4 + stream.length);
        result[0] = result[1] = result[2] = result[3] = 0;
        result.set(stream, 4);
        return result;
    }

    var tokens = parseData(data, level);

    var bw = new BitWriter();

    for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        if (t.type === 'lit') {
            bw.writeBit(0);
            bw.writeByte(t.value);
        } else {
            bw.writeBit(1);
            writeOffset(bw, t.offset);
            writeGammaSeq(bw, t.length - 2);
        }
    }

    // EOF marker: match flag + offset 0 + gamma overflow (16 ones + terminator)
    bw.writeBit(1);
    bw.writeByte(0);
    for (var i = 0; i < 16; i++) bw.writeBit(1);
    bw.writeBit(0);

    var stream = bw.finalize();

    // Build output: 4-byte LE length + compressed stream
    var result = new Uint8Array(4 + stream.length);
    result[0] = n & 0xFF;
    result[1] = (n >> 8) & 0xFF;
    result[2] = (n >> 16) & 0xFF;
    result[3] = (n >> 24) & 0xFF;
    result.set(stream, 4);
    return result;
}

// ---------------------------------------------------------------------------
// BitBuster 1.2 Decompressor
// ---------------------------------------------------------------------------

function decompressBB12(data) {
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data);

    // Read 4-byte LE original length
    var origLen = data[0] | (data[1] << 8) | (data[2] << 16) | ((data[3] << 24) >>> 0);

    if (origLen === 0) return new Uint8Array(0);

    var br = new BitReader(data.subarray(4));
    var output = new Uint8Array(origLen);
    var pos = 0;

    while (pos < origLen) {
        if (br.readBit() === 0) {
            // Literal
            output[pos++] = br.readByte();
        } else {
            // Match: offset first, then sequential gamma length (BB1.2 order)
            var offset = readOffset(br);
            var matchLen = readGammaSeq(br);

            if (matchLen === -1) break; // EOF (gamma overflow)

            for (var j = 0; j < matchLen; j++) {
                output[pos] = output[pos - offset];
                pos++;
            }
        }
    }

    return output;
}

// ---------------------------------------------------------------------------
// BitBuster 2 Compressor
// ---------------------------------------------------------------------------

// Token order for BB2: flag(1) -> gamma_interleaved(length-2) -> offset
function compressBlock2(data, level) {
    if (data.length === 0) {
        // Empty block: just EOF marker
        var bw = new BitWriter();
        bw.writeBit(1); // match flag
        for (var i = 0; i < 32; i++) bw.writeBit(1);
        return bw.finalize();
    }

    var tokens = parseData(data, level);
    var bw = new BitWriter();

    for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        if (t.type === 'lit') {
            bw.writeBit(0);
            bw.writeByte(t.value);
        } else {
            bw.writeBit(1);
            writeGammaInterleaved(bw, t.length - 2);
            writeOffset(bw, t.offset);
        }
    }

    // EOF marker: match flag + interleaved gamma overflow (32 one-bits)
    bw.writeBit(1);
    for (var i = 0; i < 32; i++) bw.writeBit(1);

    return bw.finalize();
}

function compressBB2(data, level, blockSize) {
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
    if (!blockSize) blockSize = 32768;
    if (blockSize < 128) blockSize = 128;
    if (blockSize > 32768) blockSize = 32768;

    var n = data.length;
    var numBlocks = n === 0 ? 1 : Math.ceil(n / blockSize);

    // Compress each block
    var blocks = [];
    for (var b = 0; b < numBlocks; b++) {
        var start = b * blockSize;
        var end = Math.min(start + blockSize, n);
        var blockData = data.subarray(start, end);
        var compressed = compressBlock2(blockData, level);
        blocks.push(compressed);
    }

    // Calculate total size: 1 (block count) + sum(2 + block.length)
    var totalSize = 1;
    for (var b = 0; b < blocks.length; b++) {
        totalSize += 2 + blocks[b].length;
    }

    var result = new Uint8Array(totalSize);
    var pos = 0;

    // Block count
    result[pos++] = numBlocks & 0xFF;

    // Each block: 2-byte LE length + data
    for (var b = 0; b < blocks.length; b++) {
        var blen = blocks[b].length;
        result[pos++] = blen & 0xFF;
        result[pos++] = (blen >> 8) & 0xFF;
        result.set(blocks[b], pos);
        pos += blen;
    }

    return result;
}

// ---------------------------------------------------------------------------
// BitBuster 2 Decompressor
// ---------------------------------------------------------------------------

function decompressBlock2(blockData) {
    var br = new BitReader(blockData);
    var output = [];

    while (true) {
        if (br.readBit() === 0) {
            // Literal
            output.push(br.readByte());
        } else {
            // Match: interleaved gamma length first, then offset (BB2 order)
            var matchLen = readGammaInterleaved(br);
            if (matchLen === -1) break; // EOF

            var offset = readOffset(br);

            var outPos = output.length;
            for (var j = 0; j < matchLen; j++) {
                output.push(output[outPos - offset + j]);
            }
        }
    }

    return output;
}

function decompressBB2(data) {
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data);

    var pos = 0;
    var blockCount = data[pos++];
    var output = [];

    for (var b = 0; b < blockCount; b++) {
        var blockLen = data[pos] | (data[pos + 1] << 8);
        pos += 2;
        var blockData = data.subarray(pos, pos + blockLen);
        pos += blockLen;

        var decompressed = decompressBlock2(blockData);
        for (var i = 0; i < decompressed.length; i++) {
            output.push(decompressed[i]);
        }
    }

    return new Uint8Array(output);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

var api = {
    compress: compressBB12,
    decompress: decompressBB12,
    compress2: compressBB2,
    decompress2: decompressBB2,
    MAX_OFFSET: MAX_OFFSET
};

if (typeof window !== 'undefined') window.BitBuster = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;

})();
