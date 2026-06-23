(function(){
/*
 * hrust-js — Hrust 1.3 LZ77 compression in JavaScript
 * Original format by Dmitry Pyankov; reimplemented per OHC by Eugene Larchenko — https://github.com/specke/ohc
 * JavaScript port by Bedazzle, 2026.
 * License: MIT — see LICENSE file.
 */

var MAX_OFFSET = 65535;
var MAX_LEN = 3839;
var INITIAL_D = 2;
var CHANGE_D_LEN = 13;
var IMPOSSIBLE = 0x0FFFFFFF;

// encodedCntLen[cnt] includes the prefix '0' bit of the match3+ token
var encodedCntLen = [-1, -1, -1, 3, 5, 5, 7, 7, 7, 9, 9, 9, 11, 11, 11, 11];

// ---------------------------------------------------------------------------
// BitReader (16-bit MSB-first control words, LE byte order)
// ---------------------------------------------------------------------------

function BitReader(data, pos) {
    this.data = data;
    this.pos = pos;
    this.bits = 0;
    this.bitsLeft = 0;
}

BitReader.prototype.loadWord = function () {
    this.bits = this.data[this.pos] | (this.data[this.pos + 1] << 8);
    this.pos += 2;
    this.bitsLeft = 16;
};

BitReader.prototype.readBit = function () {
    if (this.bitsLeft === 0) this.loadWord();
    this.bitsLeft--;
    var bit = (this.bits >>> this.bitsLeft) & 1;
    if (this.bitsLeft === 0) this.loadWord();
    return bit;
};

BitReader.prototype.readByte = function () {
    return this.data[this.pos++];
};

BitReader.prototype.readBits = function (n) {
    var val = 0;
    for (var i = 0; i < n; i++) val = (val << 1) | this.readBit();
    return val;
};

// ---------------------------------------------------------------------------
// BitWriter (16-bit MSB-first control words, LE byte order)
// ---------------------------------------------------------------------------

function BitWriter() {
    this.output = [];
    this.controlWord = 0;
    this.controlBitsCnt = 0;
    this.controlPos = -1;
}

BitWriter.prototype.allocateControlWord = function () {
    this.controlPos = this.output.length;
    this.output.push(0, 0);
    this.controlWord = 0;
    this.controlBitsCnt = 0;
};

BitWriter.prototype.emitBit = function (bit) {
    if (this.controlPos < 0) this.allocateControlWord();
    this.controlWord = this.controlWord * 2 + (bit & 1);
    this.controlBitsCnt++;
    if (this.controlBitsCnt === 16) {
        this.output[this.controlPos] = this.controlWord & 0xFF;
        this.output[this.controlPos + 1] = (this.controlWord >>> 8) & 0xFF;
        this.allocateControlWord();
    }
};

BitWriter.prototype.emitByte = function (v) { this.output.push(v & 0xFF); };

BitWriter.prototype.emitBits = function (v, n) {
    for (var i = n - 1; i >= 0; i--) this.emitBit((v >>> i) & 1);
};

BitWriter.prototype.finalize = function () {
    if (this.controlPos >= 0 && this.controlBitsCnt > 0 && this.controlBitsCnt < 16) {
        var w = this.controlWord << (16 - this.controlBitsCnt);
        this.output[this.controlPos] = w & 0xFF;
        this.output[this.controlPos + 1] = (w >>> 8) & 0xFF;
    }
    return new Uint8Array(this.output);
};

// ---------------------------------------------------------------------------
// D register
// ---------------------------------------------------------------------------

function nextD(d) { return (d & 7) + 1; }

function dChangeSteps(from, to) {
    var n = 0, d = from;
    while (d !== to && n < 8) { d = nextD(d); n++; }
    return n;
}

// ---------------------------------------------------------------------------
// Cost calculation (matches OHC GetEncodedLen)
// ---------------------------------------------------------------------------

function backrefCost(count, dist, D) {
    if (count === 1) return dist >= -8 ? 6 : IMPOSSIBLE;
    if (count === 2) {
        if (dist >= -32) return 10;
        if (dist >= -768) return 13;
        return IMPOSSIBLE;
    }
    var cntBits = count < 16 ? encodedCntLen[count] : count < 128 ? 14 : 22;
    var distBits;
    if (dist >= -32) distBits = 7;
    else if (dist >= -512) distBits = 10;
    else {
        if ((dist >> 8) < -(1 << D)) return IMPOSSIBLE;
        distBits = 2 + D + 8;
    }
    return cntBits + distBits;
}

// ---------------------------------------------------------------------------
// Count encoding (emitLargeCnt) - follows OHC exactly
// cnt=3: "10"; cnt 4-15: pair algorithm; cnt>=16: "110000"+7bits[+8bits]
// ---------------------------------------------------------------------------

function emitLargeCnt(bw, cnt) {
    if (cnt === 3) { bw.emitBit(1); bw.emitBit(0); return; }
    if (cnt < 16) {
        var r = cnt;
        for (var i = 0; i < 5 && r >= 0; i++) {
            var t = r < 3 ? r : 3;
            bw.emitBit(t >> 1); bw.emitBit(t & 1);
            r -= 3;
        }
        return;
    }
    bw.emitBit(1); bw.emitBit(1); bw.emitBit(0); bw.emitBit(0); bw.emitBit(0); bw.emitBit(0);
    if (cnt < 128) { bw.emitBits(cnt, 7); }
    else { bw.emitBits(cnt >>> 8, 7); bw.emitByte(cnt & 0xFF); }
}

// readLargeCnt: called after reading the first "0" token bit and "1" (b1=1).
// We've consumed bits "01" already. Now we continue reading largeCnt:
// Next bit c0:
//   c0=0: completes "10" -> cnt=3
//   c0=1: first pair was (1,1)=3, continue accumulation
function readLargeCntAfter01(br) {
    var c0 = br.readBit();
    if (c0 === 0) return 3; // "10" -> cnt=3

    // First pair (1,1)=3, accumulate
    var sum = 3;
    for (var pairs = 1; pairs < 5; pairs++) {
        var h = br.readBit(), l = br.readBit();
        var t = h * 2 + l;
        if (t < 3) {
            sum += t;
            if (sum === 3) {
                // Extended: "1100" prefix. Next bits determine subtype:
                var s0 = br.readBit();
                if (s0 === 1) {
                    // RIR short: "0 11001..." - read 4-bit dist + middle byte
                    return { rir_short: true, firstBit: br.readBit() };
                }
                var s1 = br.readBit();
                if (s1 === 1) {
                    // Multi-literal: "0 110001..." - read 4-bit cnt + bytes
                    return { multi_lit: true };
                }
                // Extended format: "0 110000..." - read 7-bit value
                var val = br.readBits(7);
                if (val === 15) return -1; // end of stream
                if (val >= 16) return val; // direct count 16-127
                // 2-byte count
                return (val << 8) | br.readByte();
            }
            return sum;
        }
        sum += 3;
    }
    return sum; // 5 pairs of (1,1) => cnt=15
}

// ---------------------------------------------------------------------------
// LongDist encoding/decoding (for count>=3 matches)
// ---------------------------------------------------------------------------

function emitLongDist(bw, dist, D) {
    if (dist >= -32) {
        bw.emitBit(1); bw.emitBit(0); bw.emitBits(dist & 0x1F, 5);
    } else if (dist >= -256) {
        bw.emitBit(0); bw.emitBit(1); bw.emitByte(dist & 0xFF);
    } else if (dist >= -512) {
        bw.emitBit(0); bw.emitBit(0); bw.emitByte(dist & 0xFF);
    } else {
        bw.emitBit(1); bw.emitBit(1);
        var H = dist >> 8;
        for (var i = D - 1; i >= 0; i--) bw.emitBit((H >>> i) & 1);
        bw.emitByte(dist & 0xFF);
    }
}

function readLongDist(br, D) {
    var b0 = br.readBit(), b1 = br.readBit();
    if (b0 === 1 && b1 === 0) {
        return br.readBits(5) - 32;
    }
    if (b0 === 0 && b1 === 1) return (br.readByte() | 0xFFFFFF00) >> 0;
    if (b0 === 0 && b1 === 0) return (0xFFFFFE00 | br.readByte()) >> 0;
    // 11: D-bit high + 8-bit low
    var H = br.readBits(D), lo = br.readByte();
    H -= (1 << D);
    return ((H << 8) | lo) >> 0;
}

// ---------------------------------------------------------------------------
// Match2 dist encoding/decoding
// ---------------------------------------------------------------------------

function emitMatch2Dist(bw, dist) {
    if (dist >= -32) {
        bw.emitBit(1); bw.emitBit(1); bw.emitBits(dist & 0x1F, 5);
    } else if (dist >= -256) {
        bw.emitBit(1); bw.emitBit(0); bw.emitByte(dist & 0xFF);
    } else if (dist >= -512) {
        bw.emitBit(0); bw.emitBit(1); bw.emitByte(dist & 0xFF);
    } else {
        bw.emitBit(0); bw.emitBit(0); bw.emitByte(dist & 0xFF);
    }
}

function readMatch2Dist(br) {
    var b0 = br.readBit(), b1 = br.readBit();
    if (b0 === 1 && b1 === 1) {
        return br.readBits(5) - 32;
    }
    if (b0 === 1 && b1 === 0) return (br.readByte() | 0xFFFFFF00) >> 0;
    if (b0 === 0 && b1 === 1) return (0xFFFFFE00 | br.readByte()) >> 0;
    return (0xFFFFFD00 | br.readByte()) >> 0;
}

// ---------------------------------------------------------------------------
// Decompressor
// ---------------------------------------------------------------------------

function decompress(data) {
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
    if (data.length < 12) throw new Error('Invalid Hrust data: too short');
    if (data[0] !== 0x48 || data[1] !== 0x52)
        throw new Error('Invalid Hrust header: missing HR signature');

    var origSize = data[2] | (data[3] << 8);
    if (origSize < 7) throw new Error('Invalid Hrust data: original size too small');

    var output = new Uint8Array(origSize);
    var endPos = origSize - 6;

    // Copy backup of last 6 bytes
    for (var i = 0; i < 6; i++) output[origSize - 6 + i] = data[6 + i];

    var br = new BitReader(data, 12);
    br.loadWord();
    var outPos = 0;

    // First byte simply copied
    output[outPos++] = br.readByte();

    var D = INITIAL_D;

    mainLoop:
    while (outPos < endPos) {
        // Bit 1 = literal
        if (br.readBit() === 1) {
            output[outPos++] = br.readByte();
            continue;
        }

        // Bit 0: read next bit
        var b1 = br.readBit();
        if (b1 === 0) {
            // "00": read third bit
            var b2 = br.readBit();
            if (b2 === 0) {
                // "000": count=1 match
                var d = br.readBits(3) - 8;
                output[outPos] = output[outPos + d];
                outPos++;
            } else {
                // "001": count=2 or D-change
                var r0 = br.readBit(), r1 = br.readBit();
                if (r0 === 1 && r1 === 0) {
                    // Range "10": check for D-change (byte 0xFE)
                    var bv = br.readByte();
                    if (bv === 0xFE) { D = nextD(D); continue; }
                    var dist = (bv | 0xFFFFFF00) >> 0;
                    var src = outPos + dist;
                    output[outPos] = output[src]; output[outPos + 1] = output[src + 1];
                    outPos += 2;
                } else if (r0 === 1 && r1 === 1) {
                    var dist = br.readBits(5) - 32;
                    var src = outPos + dist;
                    output[outPos] = output[src]; output[outPos + 1] = output[src + 1];
                    outPos += 2;
                } else if (r0 === 0 && r1 === 1) {
                    var dist = (0xFFFFFE00 | br.readByte()) >> 0;
                    var src = outPos + dist;
                    output[outPos] = output[src]; output[outPos + 1] = output[src + 1];
                    outPos += 2;
                } else {
                    var dist = (0xFFFFFD00 | br.readByte()) >> 0;
                    var src = outPos + dist;
                    output[outPos] = output[src]; output[outPos + 1] = output[src + 1];
                    outPos += 2;
                }
            }
        } else {
            // "01": count>=3 or special (RIR short, multi-literal, end-of-stream)
            var result = readLargeCntAfter01(br);

            if (result === -1) break; // end of stream

            if (typeof result === 'object') {
                if (result.rir_short) {
                    // RIR short distance
                    var distBits = ((result.firstBit << 3) | br.readBits(3)) - 16;
                    var middleByte = br.readByte();
                    var src = outPos + distBits;
                    output[outPos] = output[src];
                    output[outPos + 1] = middleByte;
                    output[outPos + 2] = output[src + 2];
                    outPos += 3;
                } else if (result.multi_lit) {
                    var cntField = br.readBits(4);
                    var cnt = cntField * 2 + 12;
                    for (var j = 0; j < cnt; j++) output[outPos++] = br.readByte();
                }
                continue;
            }

            // Normal count>=3 match
            var cnt = result;
            var dist = readLongDist(br, D);
            var src = outPos + dist;
            for (var j = 0; j < cnt; j++) output[outPos + j] = output[src + j];
            outPos += cnt;
        }
    }

    return output;
}

// ---------------------------------------------------------------------------
// Compressor - Backward DP optimal parser
// ---------------------------------------------------------------------------

function compress(inputData, level) {
    if (!(inputData instanceof Uint8Array)) inputData = new Uint8Array(inputData);

    level = level || 5;
    if (level < 1) level = 1;
    if (level > 9) level = 9;

    var inputSize = inputData.length;
    if (inputSize < 7) throw new Error('Input too small (minimum 7 bytes)');
    if (inputSize > 65535) throw new Error('Input too large (maximum 65535 bytes)');

    var endPos = inputSize - 6;
    var maxSearchDist = level <= 1 ? 512 : level <= 3 ? 2048 : level <= 5 ? 8192 :
                        level <= 7 ? 32768 : 65535;

    // DP arrays: cost[pos][D-1], solution[pos][D-1]
    var cost = new Array(endPos + 1);
    var solution = new Array(endPos + 1);
    for (var i = 0; i <= endPos; i++) {
        cost[i] = new Int32Array(8);
        solution[i] = new Array(8);
    }
    for (var d = 0; d < 8; d++) cost[endPos][d] = 0;

    // Backward DP
    for (var pos = endPos - 1; pos >= 1; pos--) {
        for (var Di = 0; Di < 8; Di++) {
            var best = IMPOSSIBLE, bestCmd = null;
            var Dval = Di + 1;

            // Single literal (9 bits)
            var lc = 9 + cost[pos + 1][Di];
            if (lc < best) { best = lc; bestCmd = { t: 0 }; }

            // Count=1 match (6 bits, dist -1..-8)
            for (var dd = -1; dd >= -8 && pos + dd >= 0; dd--) {
                if (inputData[pos] === inputData[pos + dd]) {
                    var c = 6 + cost[pos + 1][Di];
                    if (c < best) { best = c; bestCmd = { t: 1, d: dd }; }
                    break;
                }
            }

            // Count=2 match
            if (pos + 2 <= endPos) {
                var lim2 = pos < 768 ? pos : 768;
                if (lim2 > maxSearchDist) lim2 = maxSearchDist;
                for (var dd = 1; dd <= lim2; dd++) {
                    if (inputData[pos] === inputData[pos - dd] &&
                        inputData[pos + 1] === inputData[pos - dd + 1]) {
                        var dist = -dd;
                        var bc = backrefCost(2, dist, Dval);
                        if (bc < IMPOSSIBLE) {
                            var c = bc + cost[pos + 2][Di];
                            if (c < best) { best = c; bestCmd = { t: 2, d: dist }; }
                        }
                    }
                }
            }

            // Count>=3 matches
            var mlim = pos < maxSearchDist ? pos : maxSearchDist;
            var bestLen = 0;
            for (var dd = 1; dd <= mlim; dd++) {
                var ml = 0;
                while (pos + ml < endPos && ml < MAX_LEN &&
                       inputData[pos + ml] === inputData[pos - dd + ml]) ml++;
                if (ml <= bestLen) continue;
                bestLen = ml;

                var dist = -dd;
                for (var cnt = 3; cnt <= ml && pos + cnt <= endPos; cnt++) {
                    for (var nDi = 0; nDi < 8; nDi++) {
                        var nD = nDi + 1;
                        var bc = backrefCost(cnt, dist, nD);
                        if (bc >= IMPOSSIBLE) continue;
                        var steps = dChangeSteps(Dval, nD);
                        var c = steps * CHANGE_D_LEN + bc + cost[pos + cnt][nDi];
                        if (c < best) { best = c; bestCmd = { t: 3, n: cnt, d: dist, D: nD }; }
                    }
                }
            }

            cost[pos][Di] = best;
            solution[pos][Di] = bestCmd;
        }
    }

    // Forward pass: emit tokens
    var bw = new BitWriter();

    // Header: 'HR' + origSize(LE16) + compSize placeholder(LE16)
    bw.emitByte(0x48); bw.emitByte(0x52);
    bw.emitByte(inputSize & 0xFF); bw.emitByte((inputSize >>> 8) & 0xFF);
    bw.emitByte(0); bw.emitByte(0);

    // Backup last 6 bytes
    for (var i = 0; i < 6; i++) bw.emitByte(inputData[inputSize - 6 + i]);

    // First control word + first literal byte
    bw.allocateControlWord();
    bw.emitByte(inputData[0]);

    var pos = 1, D = INITIAL_D;

    while (pos < endPos) {
        var cmd = solution[pos][D - 1];
        if (!cmd) throw new Error('No solution at pos ' + pos);

        switch (cmd.t) {
            case 0: // literal
                bw.emitBit(1);
                bw.emitByte(inputData[pos]);
                pos++;
                break;
            case 1: // match1
                bw.emitBit(0); bw.emitBit(0); bw.emitBit(0);
                bw.emitBits(cmd.d & 7, 3);
                pos++;
                break;
            case 2: // match2
                bw.emitBit(0); bw.emitBit(0); bw.emitBit(1);
                emitMatch2Dist(bw, cmd.d);
                pos += 2;
                break;
            case 3: // match3+
                while (D !== cmd.D) {
                    D = nextD(D);
                    bw.emitBit(0); bw.emitBit(0); bw.emitBit(1); bw.emitBit(1); bw.emitBit(0);
                    bw.emitByte(0xFE);
                }
                bw.emitBit(0);
                emitLargeCnt(bw, cmd.n);
                emitLongDist(bw, cmd.d, D);
                pos += cmd.n;
                break;
        }
    }

    // End of stream: "0110000" + 7-bit value 15 (0001111)
    bw.emitBit(0); bw.emitBit(1); bw.emitBit(1);
    bw.emitBit(0); bw.emitBit(0); bw.emitBit(0); bw.emitBit(0);
    bw.emitBits(15, 7);

    var compressed = bw.finalize();
    compressed[4] = compressed.length & 0xFF;
    compressed[5] = (compressed.length >>> 8) & 0xFF;
    return compressed;
}

// ---------------------------------------------------------------------------
// Wrapper functions and exports
// ---------------------------------------------------------------------------

function compressArray(data, level) {
    return compress(data instanceof Uint8Array ? data : new Uint8Array(data), level);
}

function decompressArray(data) {
    return decompress(data instanceof Uint8Array ? data : new Uint8Array(data));
}

if (typeof window !== 'undefined') {
    window.HRUST = {
        compress: compress, decompress: decompress,
        compressArray: compressArray, decompressArray: decompressArray,
        MAX_OFFSET: MAX_OFFSET, MAX_LEN: MAX_LEN
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        compress: compress, decompress: decompress,
        compressArray: compressArray, decompressArray: decompressArray,
        MAX_OFFSET: MAX_OFFSET, MAX_LEN: MAX_LEN
    };
}
})();
