(function(){
/*
 * lzsa2-js — LZSA2 LZ77 compression in JavaScript
 * Original format by Emmanuel Marty — https://github.com/emmanuel-marty/lzsa
 * JavaScript port by Bedazzle, 2026.
 * License: zlib — see LICENSE file.
 */

var MAX_OFFSET = 65535;
var MAX_LEN = 65535;

// ---------------------------------------------------------------------------
// Nibble I/O
// ---------------------------------------------------------------------------

function NibbleReader(data) {
    this.data = data;
    this.pos = 0;
    this.savedNibble = -1;
}

NibbleReader.prototype.readByte = function () {
    return this.data[this.pos++];
};

NibbleReader.prototype.readNibble = function () {
    if (this.savedNibble >= 0) {
        var n = this.savedNibble;
        this.savedNibble = -1;
        return n;
    }
    var b = this.data[this.pos++];
    this.savedNibble = b & 0xF;
    return (b >>> 4) & 0xF;
};

function NibbleWriter() {
    this.output = [];
    this.nibblePos = -1;
    this.hasNibble = false;
}

NibbleWriter.prototype.writeByte = function (value) {
    this.output.push(value & 0xFF);
};

NibbleWriter.prototype.writeNibble = function (n) {
    if (!this.hasNibble) {
        this.nibblePos = this.output.length;
        this.output.push((n & 0xF) << 4);
        this.hasNibble = true;
    } else {
        this.output[this.nibblePos] |= (n & 0xF);
        this.hasNibble = false;
    }
};

NibbleWriter.prototype.finish = function () {
    return new Uint8Array(this.output);
};

// ---------------------------------------------------------------------------
// Cost functions (extra bits beyond token byte)
// ---------------------------------------------------------------------------

function offsetCost(off, lastOff) {
    if (off === lastOff && lastOff > 0) return 0;     // rep
    if (off <= 32) return 4;                            // 5-bit: nibble
    if (off <= 512) return 8;                           // 9-bit: byte
    if (off <= 8704) return 12;                         // 13-bit: nibble + byte
    return 16;                                          // 16-bit: 2 bytes
}

function matchLenCost(len) {
    // min len = 2, encoded as len-2 in MMM field (0-6 fit, 7=extended)
    if (len <= 8) return 0;       // fits in MMM (0-6)
    if (len <= 23) return 4;      // nibble
    if (len <= 255) return 12;    // nibble(15) + byte
    return 28;                    // nibble(15) + byte(233) + 16-bit LE
}

function literalLenCost(count) {
    if (count <= 2) return 0;     // fits in LL (0-2)
    if (count <= 17) return 4;    // nibble
    if (count <= 255) return 12;  // nibble(15) + byte
    return 28;                    // nibble(15) + byte(239) + 16-bit LE
}

// ---------------------------------------------------------------------------
// Length/offset read helpers
// ---------------------------------------------------------------------------

function readLiteralLen(nr, ll) {
    if (ll < 3) return ll;
    var nib = nr.readNibble();
    if (nib < 15) return 3 + nib;
    var b = nr.readByte();
    if (b <= 237) return 18 + b;
    // b === 239 (or any value > 237 that signals 16-bit)
    var lo = nr.readByte();
    var hi = nr.readByte();
    return (hi << 8) | lo;
}

function readMatchLen(nr, mmm) {
    if (mmm < 7) return mmm + 2;
    var nib = nr.readNibble();
    if (nib < 15) return 9 + nib;
    var b = nr.readByte();
    if (b <= 231) return 24 + b;
    if (b === 232) return -1; // EOD marker
    // b === 233 (16-bit)
    var lo = nr.readByte();
    var hi = nr.readByte();
    return (hi << 8) | lo;
}

// ---------------------------------------------------------------------------
// Length/offset write helpers
// ---------------------------------------------------------------------------

function writeLiteralLen(nw, count) {
    // LL field (2 bits) already written in token; this writes extensions
    if (count < 3) return; // fits in LL field
    var extra = count - 3;
    if (extra < 15) {
        nw.writeNibble(extra);
    } else if (count <= 255) {
        nw.writeNibble(15);
        nw.writeByte(count - 18);
    } else {
        nw.writeNibble(15);
        nw.writeByte(239);
        nw.writeByte(count & 0xFF);
        nw.writeByte((count >>> 8) & 0xFF);
    }
}

function writeMatchLen(nw, len) {
    // MMM field (3 bits) already written in token; this writes extensions
    if (len <= 8) return; // fits in MMM field (len-2 = 0-6)
    var extra = len - 9;
    if (extra < 15) {
        nw.writeNibble(extra);
    } else if (len <= 255) {
        nw.writeNibble(15);
        nw.writeByte(len - 24);
    } else {
        nw.writeNibble(15);
        nw.writeByte(233);
        nw.writeByte(len & 0xFF);
        nw.writeByte((len >>> 8) & 0xFF);
    }
}

function writeEOD(nw) {
    // MMM=7 extension: nibble(15), byte(232)
    nw.writeNibble(15);
    nw.writeByte(232);
}

// ---------------------------------------------------------------------------
// Decompressor
// ---------------------------------------------------------------------------

function decompress(inputData) {
    if (inputData.length === 0) return new Uint8Array(0);

    var nr = new NibbleReader(inputData);
    var output = [];
    var lastOffset = 0;

    for (;;) {
        var token = nr.readByte();
        var xyz = (token >>> 5) & 7;
        var ll = (token >>> 3) & 3;
        var mmm = token & 7;

        // Read literal length and copy literals
        var litLen = readLiteralLen(nr, ll);
        for (var i = 0; i < litLen; i++) {
            output.push(nr.readByte());
        }

        // Read offset
        var offset;
        if (xyz === 7) {
            // 111 = rep: reuse lastOffset
            offset = lastOffset;
        } else if (xyz < 2) {
            // 5-bit: 00Z (Z = bit 5 of token = xyz & 1)
            var nibble = nr.readNibble();
            offset = nibble << 1;
            offset |= (xyz & 1);
            offset ^= 0x1E;
            offset++;
            lastOffset = offset;
        } else if (xyz < 4) {
            // 9-bit: 01Z
            var lo = nr.readByte();
            offset = lo;
            offset |= ((xyz & 1) << 8);
            offset ^= 0x0FF;
            offset++;
            lastOffset = offset;
        } else if (xyz < 6) {
            // 13-bit: 10Z
            var nibble = nr.readNibble();
            var lo = nr.readByte();
            offset = lo;
            offset |= (nibble << 9);
            offset |= ((xyz & 1) << 8);
            offset ^= 0x1EFF;
            offset += 513;
            lastOffset = offset;
        } else {
            // 16-bit: 110 (xyz === 6)
            var hi = nr.readByte();
            var lo = nr.readByte();
            offset = (hi << 8) | lo;
            offset ^= 0xFFFF;
            offset++;
            lastOffset = offset;
        }

        // Read match length
        var matchLen = readMatchLen(nr, mmm);
        if (matchLen === -1) break; // EOD

        // Copy match
        for (var i = 0; i < matchLen; i++) {
            output.push(output[output.length - offset]);
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

    return sais(data, n, 256);
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

    if (inputData.length === 0) return new Uint8Array(0);

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

    // Match length cost breakpoints: 2, 8, 9, 23, 24, 255, 256
    var matchLenBreakpoints = [2, 8, 9, 23, 24, 255, 256];

    // Forward DP
    // arrivals[pos] = array of arrival states, limited to maxArrivals per position
    // Each arrival: { cost, lastOffset, fromPos, fromIdx, tokenType, tokenLen, tokenOffset }
    var arrivals = new Array(n + 1);
    for (var i = 0; i <= n; i++) arrivals[i] = [];

    // Seed: position 0, no bytes consumed yet
    arrivals[0].push({
        cost: 0,
        lastOffset: 0,
        fromPos: -1,
        fromIdx: -1,
        tokenType: 'start',
        tokenLen: 0,
        tokenOffset: 0
    });

    for (var pos = 0; pos < n; pos++) {
        var arrAtPos = arrivals[pos];
        if (arrAtPos.length === 0) continue;

        // Precompute matches for this position
        var saMatches = findMatches(data, pos, sa, lcpInfo, maxMatchesPerPos);

        for (var ai = 0; ai < arrAtPos.length; ai++) {
            var arr = arrAtPos[ai];
            var cost = arr.cost;
            var lastOff = arr.lastOffset;

            // --- Literal ---
            tryArrival(arrivals[pos + 1], maxArrivals, {
                cost: cost + 8,
                lastOffset: lastOff,
                fromPos: pos,
                fromIdx: ai,
                tokenType: 'literal',
                tokenLen: 1,
                tokenOffset: 0
            });

            // --- Matches from suffix array ---
            for (var mi = 0; mi < saMatches.length; mi++) {
                var m = saMatches[mi];
                var off = m.offset;
                var mMaxLen = Math.min(m.length, n - pos, MAX_LEN);

                if (mMaxLen < 2) continue;

                // Verify actual match length
                var actualMax = 0;
                while (actualMax < mMaxLen && data[pos + actualMax] === data[pos - off + actualMax]) {
                    actualMax++;
                }
                mMaxLen = actualMax;
                if (mMaxLen < 2) continue;

                // Try breakpoint lengths
                for (var bi = 0; bi < matchLenBreakpoints.length; bi++) {
                    var tryLen = matchLenBreakpoints[bi];
                    if (tryLen < 2) continue;
                    if (tryLen > mMaxLen) break;
                    var c = 8 + offsetCost(off, lastOff) + matchLenCost(tryLen);
                    tryArrival(arrivals[pos + tryLen], maxArrivals, {
                        cost: cost + c,
                        lastOffset: off,
                        fromPos: pos,
                        fromIdx: ai,
                        tokenType: 'match',
                        tokenLen: tryLen,
                        tokenOffset: off
                    });
                }
                // Always try max length
                if (mMaxLen >= 2) {
                    var c = 8 + offsetCost(off, lastOff) + matchLenCost(mMaxLen);
                    tryArrival(arrivals[pos + mMaxLen], maxArrivals, {
                        cost: cost + c,
                        lastOffset: off,
                        fromPos: pos,
                        fromIdx: ai,
                        tokenType: 'match',
                        tokenLen: mMaxLen,
                        tokenOffset: off
                    });
                }
            }

            // --- Rep match ---
            if (lastOff > 0 && pos >= lastOff) {
                var maxRepLen = 0;
                while (pos + maxRepLen < n && data[pos + maxRepLen] === data[pos + maxRepLen - lastOff]) {
                    maxRepLen++;
                }
                if (maxRepLen >= 2) {
                    for (var bi = 0; bi < matchLenBreakpoints.length; bi++) {
                        var tryLen = matchLenBreakpoints[bi];
                        if (tryLen < 2) continue;
                        if (tryLen > maxRepLen) break;
                        var c = 8 + 0 + matchLenCost(tryLen); // rep offset cost = 0
                        tryArrival(arrivals[pos + tryLen], maxArrivals, {
                            cost: cost + c,
                            lastOffset: lastOff,
                            fromPos: pos,
                            fromIdx: ai,
                            tokenType: 'match',
                            tokenLen: tryLen,
                            tokenOffset: lastOff
                        });
                    }
                    // Try max
                    var c = 8 + 0 + matchLenCost(maxRepLen);
                    tryArrival(arrivals[pos + maxRepLen], maxArrivals, {
                        cost: cost + c,
                        lastOffset: lastOff,
                        fromPos: pos,
                        fromIdx: ai,
                        tokenType: 'match',
                        tokenLen: maxRepLen,
                        tokenOffset: lastOff
                    });
                }
            }
        }
    }

    // Find best arrival at end
    var endArrivals = arrivals[n];
    if (endArrivals.length === 0) {
        throw new Error('LZSA2: compression failed - no path to end');
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

    // Group into commands and encode
    return encodeCommands(data, tokens);
}

function tryArrival(destArr, maxArrivals, newArr) {
    // Deduplicate by lastOffset — keep cheaper
    for (var i = 0; i < destArr.length; i++) {
        var existing = destArr[i];
        if (existing.lastOffset === newArr.lastOffset) {
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
// Command encoder (trace-back tokens → grouped commands → LZSA2 stream)
// ---------------------------------------------------------------------------

function encodeCommands(data, tokens) {
    // Group tokens into commands: each command has literals[] + match (or EOD)
    // Collect consecutive literals, then pair with following match
    var commands = [];
    var pendingLiterals = [];
    var lastOffset = 0;

    for (var ti = 0; ti < tokens.length; ti++) {
        var tok = tokens[ti];
        if (tok.tokenType === 'literal') {
            pendingLiterals.push(tok.fromPos);
        } else if (tok.tokenType === 'match') {
            commands.push({
                literals: pendingLiterals,
                matchOffset: tok.tokenOffset,
                matchLen: tok.tokenLen,
                isEOD: false
            });
            pendingLiterals = [];
        }
    }

    // Final command: remaining literals + EOD
    commands.push({
        literals: pendingLiterals,
        matchOffset: 0,
        matchLen: 0,
        isEOD: true
    });

    // Encode commands
    var nw = new NibbleWriter();
    lastOffset = 0;

    for (var ci = 0; ci < commands.length; ci++) {
        var cmd = commands[ci];
        var litCount = cmd.literals.length;

        // Build token byte
        var xyz, llField, mmmField;

        if (cmd.isEOD) {
            // EOD: XYZ=111 (rep), MMM=7
            xyz = 7;
            mmmField = 7;
        } else {
            // Determine XYZ from offset encoding
            xyz = getXYZForOffset(cmd.matchOffset, lastOffset);
            // MMM field
            var mmmVal = cmd.matchLen - 2;
            mmmField = mmmVal <= 6 ? mmmVal : 7;
        }

        // LL field
        llField = litCount <= 2 ? litCount : 3;

        var tokenByte = (xyz << 5) | (llField << 3) | mmmField;
        nw.writeByte(tokenByte);

        // Write literal length extension
        writeLiteralLen(nw, litCount);

        // Write literal bytes
        for (var li = 0; li < litCount; li++) {
            nw.writeByte(data[cmd.literals[li]]);
        }

        if (cmd.isEOD) {
            // Write EOD match extension: nibble(15) + byte(232)
            writeEOD(nw);
            break;
        }

        // Write offset data (and get back actual XYZ - already encoded in token)
        writeOffsetData(nw, cmd.matchOffset, lastOffset);
        lastOffset = cmd.matchOffset;

        // Write match length extension
        writeMatchLen(nw, cmd.matchLen);
    }

    return nw.finish();
}

function getXYZForOffset(offset, lastOffset) {
    if (offset === lastOffset && lastOffset > 0) return 7; // 111 = rep
    if (offset <= 32) {
        // 5-bit: 00Z, Z = inverted bit 0 of (-offset)
        return ((-offset) & 1) ^ 1; // 00Z
    }
    if (offset <= 512) {
        // 9-bit: 01Z, Z = inverted bit 8 of (-offset)
        return 2 | ((((- offset) >>> 8) & 1) ^ 1); // 01Z
    }
    if (offset <= 8704) {
        // 13-bit: 10Z, Z = inverted bit 8 of (-(offset - 512))
        return 4 | (((((-(offset - 512)) | 0) >>> 8) & 1) ^ 1); // 10Z
    }
    return 6; // 110
}

function writeOffsetData(nw, offset, lastOffset) {
    if (offset === lastOffset && lastOffset > 0) return; // rep: no data

    if (offset <= 32) {
        // 5-bit: write nibble = bits 4-1 of (-offset)
        nw.writeNibble(((-offset) & 0x1E) >>> 1);
    } else if (offset <= 512) {
        // 9-bit: write byte = low 8 bits of (-offset)
        nw.writeByte((-offset) & 0xFF);
    } else if (offset <= 8704) {
        // 13-bit: adjusted by -512, then nibble (bits 12-9) + byte (bits 7-0)
        var adj = -(offset - 512);
        nw.writeNibble((adj >>> 9) & 0x0F);
        nw.writeByte(adj & 0xFF);
    } else {
        // 16-bit: write high byte then low byte of (-offset)
        var neg = (-offset) & 0xFFFF;
        nw.writeByte((neg >>> 8) & 0xFF);
        nw.writeByte(neg & 0xFF);
    }
}

// ---------------------------------------------------------------------------
// API + exports
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
    window.LZSA2 = {
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
