(function(){
/*
 * aplib-js — aPLib LZ77 compression in JavaScript
 * Original format by Jørgen Ibsen; reimplemented per apultra by Emmanuel Marty
 * https://ibsensoftware.com/products_aPLib.html
 * JavaScript port by Bedazzle, 2026.
 * License: zlib — see LICENSE file.
 */

const MAX_OFFSET = 65535;
const MAX_LEN = 65535;

// ---------------------------------------------------------------------------
// Bit I/O
// ---------------------------------------------------------------------------

function BitReader(data) {
    this.data = data;
    this.pos = 0;
    this.tag = 0;
    this.bitsLeft = 0;
}

BitReader.prototype.readBit = function () {
    if (this.bitsLeft === 0) {
        this.tag = this.data[this.pos++];
        this.bitsLeft = 8;
    }
    this.bitsLeft--;
    return (this.tag >>> this.bitsLeft) & 1;
};

BitReader.prototype.readByte = function () {
    return this.data[this.pos++];
};

BitReader.prototype.readGamma2 = function () {
    var result = 1;
    do {
        result = (result << 1) | this.readBit();
    } while (this.readBit());
    return result;
};

function BitWriter() {
    this.output = [];
    this.tagPos = -1;
    this.tag = 0;
    this.bitCount = 0;
}

BitWriter.prototype.writeBit = function (bit) {
    if (this.bitCount === 0) {
        this.tagPos = this.output.length;
        this.output.push(0);
        this.bitCount = 8;
    }
    this.bitCount--;
    if (bit) {
        this.tag |= (1 << this.bitCount);
    }
    if (this.bitCount === 0) {
        this.output[this.tagPos] = this.tag;
        this.tag = 0;
    }
};

BitWriter.prototype.writeByte = function (value) {
    this.output.push(value & 0xFF);
};

BitWriter.prototype.writeGamma2 = function (value) {
    var bits = [];
    var v = value;
    while (v > 1) {
        bits.push(v & 1);
        v >>>= 1;
    }
    for (var i = bits.length - 1; i >= 0; i--) {
        this.writeBit(bits[i]);
        this.writeBit(i > 0 ? 1 : 0);
    }
};

BitWriter.prototype.finish = function () {
    if (this.bitCount > 0) {
        this.output[this.tagPos] = this.tag;
    }
    return new Uint8Array(this.output);
};

// ---------------------------------------------------------------------------
// Cost functions
// ---------------------------------------------------------------------------

function gamma2Cost(value) {
    var bits = 0;
    var v = value;
    while (v > 1) {
        bits += 2;
        v >>>= 1;
    }
    return bits;
}

function literalCost() {
    return 9; // 1 tag bit + 8 raw bits
}

function largeCost(offset, len, followsLiteral) {
    var high = (offset >>> 8) + 2 + (followsLiteral ? 1 : 0);
    var cost = 1 + 1 + gamma2Cost(high) + 8; // tag '10' + gamma2(high) + raw byte(low)
    var adjLen = len;
    if (offset >= 1280) adjLen--;
    if (offset >= 32000) adjLen--;
    cost += gamma2Cost(adjLen);
    return cost;
}

function repCost(len) {
    // rep match via '10': 2 tag bits + gamma2(2) + gamma2(len) = 2 + 2 + gamma2(len)
    return 4 + gamma2Cost(len);
}

function sevenBitCost() {
    return 11; // 3 tag bits '110' + 8 raw bits
}

function fourBitCost() {
    return 7; // 3 tag bits '111' + 4 payload bits
}

function minMatchLen(offset) {
    if (offset < 1280) return 2;
    if (offset < 32000) return 3;
    return 4;
}

// ---------------------------------------------------------------------------
// Decompressor
// ---------------------------------------------------------------------------

function decompress(inputData) {
    if (inputData.length === 0) return new Uint8Array(0);

    var br = new BitReader(inputData);
    var output = [];
    var lastOffset = 0;
    var followsLiteral = 1;

    // First byte is always a literal
    output.push(br.readByte());

    for (;;) {
        if (br.readBit() === 0) {
            // Literal
            output.push(br.readByte());
            followsLiteral = 1;
            continue;
        }

        if (br.readBit() === 0) {
            // Large match or rep match via '10'
            var g = br.readGamma2();
            if (g === 2 && followsLiteral) {
                // Rep match
                var len = br.readGamma2();
                for (var i = 0; i < len; i++) {
                    output.push(output[output.length - lastOffset]);
                }
                followsLiteral = 0;
                continue;
            }

            var high = g - 2 - (followsLiteral ? 1 : 0);
            var low = br.readByte();
            var offset = (high << 8) | low;

            if (offset === 0) {
                // End marker
                break;
            }

            var len = br.readGamma2();
            if (offset >= 1280) len++;
            if (offset >= 32000) len++;

            lastOffset = offset;
            for (var i = 0; i < len; i++) {
                output.push(output[output.length - offset]);
            }
            followsLiteral = 0;
        } else {
            if (br.readBit() === 0) {
                // 7-bit match '110'
                var cmd = br.readByte();
                if (cmd === 0) {
                    // End marker
                    break;
                }
                var offset = cmd >>> 1;
                var len = (cmd & 1) + 2;
                lastOffset = offset;
                for (var i = 0; i < len; i++) {
                    output.push(output[output.length - offset]);
                }
                followsLiteral = 0;
            } else {
                // 4-bit match '111'
                var nybble = (br.readBit() << 3) | (br.readBit() << 2) | (br.readBit() << 1) | br.readBit();
                if (nybble === 0) {
                    // Output zero byte
                    output.push(0);
                    followsLiteral = 1;
                } else {
                    // 4-bit offset, copy 1 byte (does NOT update lastOffset)
                    output.push(output[output.length - nybble]);
                    followsLiteral = 0;
                }
            }
        }
    }

    return new Uint8Array(output);
}

// ---------------------------------------------------------------------------
// SA-IS suffix array construction (O(n))
// ---------------------------------------------------------------------------

function buildSuffixArray(data) {
    var n = data.length;
    if (n === 0) return new Int32Array(0);
    if (n === 1) return new Int32Array([0]);

    var sa = sais(data, n, 256);
    return sa;
}

function sais(T, n, alphabetSize) {
    var SA = new Int32Array(n);
    var t = new Uint8Array(n); // 0=S, 1=L

    // Classify suffixes
    t[n - 1] = 0; // sentinel is S-type
    for (var i = n - 2; i >= 0; i--) {
        if (T[i] < T[i + 1]) {
            t[i] = 0;
        } else if (T[i] > T[i + 1]) {
            t[i] = 1;
        } else {
            t[i] = t[i + 1];
        }
    }

    // Build bucket boundaries
    var bucketSizes = new Int32Array(alphabetSize);
    for (var i = 0; i < n; i++) bucketSizes[T[i]]++;

    var bucketStarts = new Int32Array(alphabetSize);
    var bucketEnds = new Int32Array(alphabetSize);

    function getBuckets(end) {
        var sum = 0;
        for (var i = 0; i < alphabetSize; i++) {
            if (end) {
                sum += bucketSizes[i];
                bucketEnds[i] = sum - 1;
            } else {
                bucketStarts[i] = sum;
                sum += bucketSizes[i];
            }
        }
    }

    // Find LMS suffixes
    var lmsPositions = [];
    for (var i = 1; i < n; i++) {
        if (t[i] === 0 && t[i - 1] === 1) {
            lmsPositions.push(i);
        }
    }

    // Induce sort LMS suffixes
    SA.fill(-1);
    getBuckets(true);
    for (var i = lmsPositions.length - 1; i >= 0; i--) {
        SA[bucketEnds[T[lmsPositions[i]]]--] = lmsPositions[i];
    }

    // Induce L-type
    getBuckets(false);
    for (var i = 0; i < n; i++) {
        if (SA[i] > 0 && t[SA[i] - 1] === 1) {
            SA[bucketStarts[T[SA[i] - 1]]++] = SA[i] - 1;
        }
    }

    // Induce S-type
    getBuckets(true);
    for (var i = n - 1; i >= 0; i--) {
        if (SA[i] > 0 && t[SA[i] - 1] === 0) {
            SA[bucketEnds[T[SA[i] - 1]]--] = SA[i] - 1;
        }
    }

    if (lmsPositions.length <= 1) return SA;

    // Compact sorted LMS substrings
    var n1 = 0;
    for (var i = 0; i < n; i++) {
        if (SA[i] > 0 && t[SA[i]] === 0 && t[SA[i] - 1] === 1) {
            SA[n1++] = SA[i];
        }
    }

    // Name LMS substrings
    var names = new Int32Array(n).fill(-1);
    var name = 0;
    var prev = -1;
    for (var i = 0; i < n1; i++) {
        var pos = SA[i];
        var diff = false;
        if (prev === -1) {
            diff = true;
        } else {
            // Compare LMS substrings
            for (var d = 0; ; d++) {
                var isLMS1 = d > 0 && t[pos + d] === 0 && t[pos + d - 1] === 1;
                var isLMS2 = d > 0 && t[prev + d] === 0 && t[prev + d - 1] === 1;
                if (isLMS1 || isLMS2) {
                    if (isLMS1 !== isLMS2 || T[pos + d] !== T[prev + d]) diff = true;
                    if (isLMS1 && isLMS2) break;
                }
                if (d > 0 && (isLMS1 !== isLMS2 || T[pos + d] !== T[prev + d])) {
                    diff = true;
                    break;
                }
            }
        }
        if (diff) {
            name++;
            prev = pos;
        }
        names[pos] = name - 1;
    }

    // Build reduced string
    var reducedString = new Int32Array(n1);
    var j = 0;
    for (var i = 0; i < n; i++) {
        if (names[i] >= 0) {
            reducedString[j++] = names[i];
        }
    }

    // Solve recursively or directly
    var SA1;
    if (name < n1) {
        SA1 = sais(reducedString, n1, name);
    } else {
        SA1 = new Int32Array(n1);
        for (var i = 0; i < n1; i++) {
            SA1[reducedString[i]] = i;
        }
    }

    // Map back to original positions
    var lmsMapped = new Int32Array(n1);
    for (var i = 0; i < n1; i++) {
        lmsMapped[i] = lmsPositions[SA1[i]];
    }

    // Final induced sort
    SA.fill(-1);
    getBuckets(true);
    for (var i = n1 - 1; i >= 0; i--) {
        SA[bucketEnds[T[lmsMapped[i]]]--] = lmsMapped[i];
    }

    getBuckets(false);
    for (var i = 0; i < n; i++) {
        if (SA[i] > 0 && t[SA[i] - 1] === 1) {
            SA[bucketStarts[T[SA[i] - 1]]++] = SA[i] - 1;
        }
    }

    getBuckets(true);
    for (var i = n - 1; i >= 0; i--) {
        if (SA[i] > 0 && t[SA[i] - 1] === 0) {
            SA[bucketEnds[T[SA[i] - 1]]--] = SA[i] - 1;
        }
    }

    return SA;
}

// ---------------------------------------------------------------------------
// LCP array (Kasai's algorithm)
// ---------------------------------------------------------------------------

function buildLCPArray(data, sa) {
    var n = data.length;
    var rank = new Int32Array(n);
    for (var i = 0; i < n; i++) rank[sa[i]] = i;

    var lcp = new Int32Array(n);
    var h = 0;
    for (var i = 0; i < n; i++) {
        if (rank[i] > 0) {
            var j = sa[rank[i] - 1];
            while (i + h < n && j + h < n && data[i + h] === data[j + h]) h++;
            lcp[rank[i]] = h;
            if (h > 0) h--;
        } else {
            h = 0;
        }
    }
    return { lcp: lcp, rank: rank };
}

// ---------------------------------------------------------------------------
// Match finder (SA bidirectional walk)
// ---------------------------------------------------------------------------

function findMatches(data, pos, sa, lcpInfo, maxMatches) {
    var n = data.length;
    var rank = lcpInfo.rank;
    var lcp = lcpInfo.lcp;
    var r = rank[pos];
    var matches = [];

    // Walk left
    var minLcp = n + 1;
    for (var i = r - 1; i >= 0 && matches.length < maxMatches; i--) {
        minLcp = Math.min(minLcp, lcp[i + 1]);
        if (minLcp === 0) break;
        var matchPos = sa[i];
        if (matchPos < pos) {
            var offset = pos - matchPos;
            if (offset <= MAX_OFFSET) {
                matches.push({ offset: offset, length: minLcp });
            }
        }
    }

    // Walk right
    minLcp = n + 1;
    for (var i = r + 1; i < n && matches.length < maxMatches; i++) {
        minLcp = Math.min(minLcp, lcp[i]);
        if (minLcp === 0) break;
        var matchPos = sa[i];
        if (matchPos < pos) {
            var offset = pos - matchPos;
            if (offset <= MAX_OFFSET) {
                matches.push({ offset: offset, length: minLcp });
            }
        }
    }

    // Sort by length descending, then offset ascending (Pareto-filter)
    matches.sort(function (a, b) {
        return b.length - a.length || a.offset - b.offset;
    });

    // Pareto filter: for decreasing lengths, keep only matches with smaller offsets
    var filtered = [];
    var bestOffset = MAX_OFFSET + 1;
    for (var i = 0; i < matches.length; i++) {
        if (matches[i].offset < bestOffset) {
            filtered.push(matches[i]);
            bestOffset = matches[i].offset;
        }
    }

    return filtered;
}

// ---------------------------------------------------------------------------
// Optimal parser (forward DP, multi-arrival)
// ---------------------------------------------------------------------------

function compress(inputData, level) {
    if (typeof level === 'undefined') level = 5;
    if (level < 1) level = 1;
    if (level > 9) level = 9;

    if (inputData.length === 0) {
        return new Uint8Array(0);
    }

    var maxArrivals, maxMatchesPerPos;
    if (level <= 1) { maxArrivals = 16; maxMatchesPerPos = 32; }
    else if (level <= 3) { maxArrivals = 32; maxMatchesPerPos = 64; }
    else if (level <= 5) { maxArrivals = 64; maxMatchesPerPos = 128; }
    else if (level <= 7) { maxArrivals = 96; maxMatchesPerPos = 200; }
    else { maxArrivals = 128; maxMatchesPerPos = 256; }

    var data = inputData;
    var n = data.length;

    // Build suffix array and LCP
    var sa = buildSuffixArray(data);
    var lcpInfo = buildLCPArray(data, sa);

    // Gamma2 cost breakpoints: try only lengths at cost-change boundaries
    var gamma2Breakpoints = [2, 3];
    var v = 4;
    while (v <= MAX_LEN) {
        gamma2Breakpoints.push(v);
        gamma2Breakpoints.push(v * 2 - 1);
        v *= 2;
    }

    // Forward DP
    // arrivals[pos] = array of arrival states, limited to maxArrivals per position
    // Each arrival: { cost, lastOffset, followsLiteral, fromPos, fromIdx, tokenType, tokenLen, tokenOffset }
    var arrivals = new Array(n + 1);
    for (var i = 0; i <= n; i++) arrivals[i] = [];

    // Seed: position 0 gets a single arrival after reading the initial literal
    // First byte is a raw literal (no tag bit), costs 8 bits
    arrivals[1].push({
        cost: 8,
        lastOffset: 0,
        followsLiteral: 1,
        fromPos: 0,
        fromIdx: 0,
        tokenType: 'initial',
        tokenLen: 1,
        tokenOffset: 0
    });

    for (var pos = 1; pos < n; pos++) {
        var arrAtPos = arrivals[pos];
        if (arrAtPos.length === 0) continue;

        // Precompute matches for this position
        var saMatches = findMatches(data, pos, sa, lcpInfo, maxMatchesPerPos);

        for (var ai = 0; ai < arrAtPos.length; ai++) {
            var arr = arrAtPos[ai];
            var cost = arr.cost;
            var lastOff = arr.lastOffset;
            var fL = arr.followsLiteral;

            // --- Literal ---
            if (pos + 1 <= n) {
                tryArrival(arrivals[pos + 1], maxArrivals, {
                    cost: cost + 9,
                    lastOffset: lastOff,
                    followsLiteral: 1,
                    fromPos: pos,
                    fromIdx: ai,
                    tokenType: 'literal',
                    tokenLen: 1,
                    tokenOffset: 0
                });
            }

            // --- 4-bit zero ---
            if (data[pos] === 0) {
                tryArrival(arrivals[pos + 1], maxArrivals, {
                    cost: cost + 7,
                    lastOffset: lastOff,
                    followsLiteral: 1,
                    fromPos: pos,
                    fromIdx: ai,
                    tokenType: 'fourbit_zero',
                    tokenLen: 1,
                    tokenOffset: 0
                });
            }

            // --- 4-bit match (offset 1-15, len=1) ---
            for (var off4 = 1; off4 <= 15; off4++) {
                if (pos - off4 < 0) break;
                if (data[pos] === data[pos - off4]) {
                    tryArrival(arrivals[pos + 1], maxArrivals, {
                        cost: cost + 7,
                        lastOffset: lastOff,  // Does NOT update lastOffset
                        followsLiteral: 0,
                        fromPos: pos,
                        fromIdx: ai,
                        tokenType: 'fourbit',
                        tokenLen: 1,
                        tokenOffset: off4
                    });
                }
            }

            // --- 7-bit match (offset 1-127, len 2-3) ---
            for (var off7 = 1; off7 <= 127 && off7 <= pos; off7++) {
                var maxL7 = Math.min(3, n - pos);
                if (maxL7 < 2) break;
                // Check if at least 2 bytes match
                if (data[pos] !== data[pos - off7] || data[pos + 1] !== data[pos + 1 - off7]) continue;
                for (var len7 = 2; len7 <= maxL7; len7++) {
                    if (len7 === 3 && data[pos + 2] !== data[pos + 2 - off7]) break;
                    tryArrival(arrivals[pos + len7], maxArrivals, {
                        cost: cost + 11,
                        lastOffset: off7,
                        followsLiteral: 0,
                        fromPos: pos,
                        fromIdx: ai,
                        tokenType: 'sevenbit',
                        tokenLen: len7,
                        tokenOffset: off7
                    });
                }
            }

            // --- Rep match via '10' (requires followsLiteral=1) ---
            if (lastOff > 0 && fL && pos - lastOff >= 0) {
                var maxRepLen = 0;
                while (pos + maxRepLen < n && data[pos + maxRepLen] === data[pos + maxRepLen - lastOff]) {
                    maxRepLen++;
                }
                if (maxRepLen >= 2) {
                    for (var bi = 0; bi < gamma2Breakpoints.length; bi++) {
                        var tryLen = gamma2Breakpoints[bi];
                        if (tryLen < 2) continue;
                        if (tryLen > maxRepLen) break;
                        tryArrival(arrivals[pos + tryLen], maxArrivals, {
                            cost: cost + repCost(tryLen),
                            lastOffset: lastOff,
                            followsLiteral: 0,
                            fromPos: pos,
                            fromIdx: ai,
                            tokenType: 'rep',
                            tokenLen: tryLen,
                            tokenOffset: lastOff
                        });
                    }
                    // Always try max length
                    tryArrival(arrivals[pos + maxRepLen], maxArrivals, {
                        cost: cost + repCost(maxRepLen),
                        lastOffset: lastOff,
                        followsLiteral: 0,
                        fromPos: pos,
                        fromIdx: ai,
                        tokenType: 'rep',
                        tokenLen: maxRepLen,
                        tokenOffset: lastOff
                    });
                }
            }

            // --- Large matches from suffix array ---
            for (var mi = 0; mi < saMatches.length; mi++) {
                var m = saMatches[mi];
                var off = m.offset;
                var mMin = minMatchLen(off);
                var mMaxLen = Math.min(m.length, n - pos);

                if (mMaxLen < mMin) continue;

                // Verify actual match length (LCP may overcount across positions)
                var actualMax = 0;
                while (actualMax < mMaxLen && data[pos + actualMax] === data[pos - off + actualMax]) {
                    actualMax++;
                }
                mMaxLen = actualMax;
                if (mMaxLen < mMin) continue;

                // Use gamma2 breakpoints for length
                for (var bi = 0; bi < gamma2Breakpoints.length; bi++) {
                    var tryLen = gamma2Breakpoints[bi];
                    if (tryLen < mMin) continue;
                    if (tryLen > mMaxLen) break;
                    var c = largeCost(off, tryLen, fL);
                    tryArrival(arrivals[pos + tryLen], maxArrivals, {
                        cost: cost + c,
                        lastOffset: off,
                        followsLiteral: 0,
                        fromPos: pos,
                        fromIdx: ai,
                        tokenType: 'large',
                        tokenLen: tryLen,
                        tokenOffset: off
                    });
                }
                // Always try max length
                if (mMaxLen >= mMin) {
                    var c = largeCost(off, mMaxLen, fL);
                    tryArrival(arrivals[pos + mMaxLen], maxArrivals, {
                        cost: cost + c,
                        lastOffset: off,
                        followsLiteral: 0,
                        fromPos: pos,
                        fromIdx: ai,
                        tokenType: 'large',
                        tokenLen: mMaxLen,
                        tokenOffset: off
                    });
                }
            }
        }
    }

    // Find best arrival at end
    var endArrivals = arrivals[n];
    if (endArrivals.length === 0) {
        throw new Error('aPLib: compression failed - no path to end');
    }
    var bestIdx = 0;
    for (var i = 1; i < endArrivals.length; i++) {
        if (endArrivals[i].cost < endArrivals[bestIdx].cost) {
            bestIdx = i;
        }
    }

    // Trace back the optimal path
    var tokens = [];
    var curPos = n;
    var curIdx = bestIdx;
    while (curPos > 0) {
        var a = arrivals[curPos][curIdx];
        tokens.push(a);
        curIdx = a.fromIdx;
        curPos = a.fromPos;
    }
    tokens.reverse();

    // Encode tokens
    return encodeTokens(data, tokens);
}

function tryArrival(destArr, maxArrivals, newArr) {
    // Deduplicate by (lastOffset, followsLiteral) — keep cheaper
    for (var i = 0; i < destArr.length; i++) {
        var existing = destArr[i];
        if (existing.lastOffset === newArr.lastOffset && existing.followsLiteral === newArr.followsLiteral) {
            if (newArr.cost < existing.cost) {
                destArr[i] = newArr;
            }
            return;
        }
    }

    // If not full, just add
    if (destArr.length < maxArrivals) {
        destArr.push(newArr);
        return;
    }

    // If full, replace the worst if we are better
    var worstIdx = 0;
    for (var i = 1; i < destArr.length; i++) {
        if (destArr[i].cost > destArr[worstIdx].cost) {
            worstIdx = i;
        }
    }
    if (newArr.cost < destArr[worstIdx].cost) {
        destArr[worstIdx] = newArr;
    }
}

// ---------------------------------------------------------------------------
// Token encoder
// ---------------------------------------------------------------------------

function encodeTokens(data, tokens) {
    var bw = new BitWriter();
    var followsLiteral = 1; // track for encoding

    for (var ti = 0; ti < tokens.length; ti++) {
        var tok = tokens[ti];

        switch (tok.tokenType) {
            case 'initial':
                // First byte: raw literal, no tag bit
                bw.writeByte(data[tok.fromPos]);
                followsLiteral = 1;
                break;

            case 'literal':
                bw.writeBit(0);
                bw.writeByte(data[tok.fromPos]);
                followsLiteral = 1;
                break;

            case 'fourbit_zero':
                bw.writeBit(1);
                bw.writeBit(1);
                bw.writeBit(1);
                bw.writeBit(0);
                bw.writeBit(0);
                bw.writeBit(0);
                bw.writeBit(0);
                followsLiteral = 1;
                break;

            case 'fourbit':
                bw.writeBit(1);
                bw.writeBit(1);
                bw.writeBit(1);
                bw.writeBit((tok.tokenOffset >>> 3) & 1);
                bw.writeBit((tok.tokenOffset >>> 2) & 1);
                bw.writeBit((tok.tokenOffset >>> 1) & 1);
                bw.writeBit(tok.tokenOffset & 1);
                followsLiteral = 0;
                break;

            case 'sevenbit': {
                var cmd = (tok.tokenOffset << 1) | (tok.tokenLen - 2);
                bw.writeBit(1);
                bw.writeBit(1);
                bw.writeBit(0);
                bw.writeByte(cmd);
                followsLiteral = 0;
                break;
            }

            case 'rep':
                bw.writeBit(1);
                bw.writeBit(0);
                bw.writeGamma2(2);
                bw.writeGamma2(tok.tokenLen);
                followsLiteral = 0;
                break;

            case 'large': {
                var offset = tok.tokenOffset;
                var len = tok.tokenLen;
                var high = (offset >>> 8) + 2 + (followsLiteral ? 1 : 0);
                var low = offset & 0xFF;
                var adjLen = len;
                if (offset >= 1280) adjLen--;
                if (offset >= 32000) adjLen--;

                bw.writeBit(1);
                bw.writeBit(0);
                bw.writeGamma2(high);
                bw.writeByte(low);
                bw.writeGamma2(adjLen);
                followsLiteral = 0;
                break;
            }
        }
    }

    // Write end marker: 7-bit match with cmd=0
    bw.writeBit(1);
    bw.writeBit(1);
    bw.writeBit(0);
    bw.writeByte(0x00);

    return bw.finish();
}

// ---------------------------------------------------------------------------
// Level presets + API + exports
// ---------------------------------------------------------------------------

function compressArray(inputArray, level) {
    var inputData = inputArray instanceof Uint8Array ? inputArray : new Uint8Array(inputArray);
    return compress(inputData, level);
}

function decompressArray(inputArray) {
    var inputData = inputArray instanceof Uint8Array ? inputArray : new Uint8Array(inputArray);
    return decompress(inputData);
}

if (typeof window !== 'undefined') {
    window.aPLib = {
        compress: compress,
        decompress: decompress,
        compressArray: compressArray,
        decompressArray: decompressArray,
        MAX_OFFSET: MAX_OFFSET,
        MAX_LEN: MAX_LEN
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        compress: compress,
        decompress: decompress,
        compressArray: compressArray,
        decompressArray: decompressArray,
        MAX_OFFSET: MAX_OFFSET,
        MAX_LEN: MAX_LEN
    };
}
})();
