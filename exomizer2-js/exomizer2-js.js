(function(){
/*
 * Exomizer 2 JS: JavaScript port of Exomizer 2 by Magnus Lind.
 *
 * Original Exomizer: Copyright (c) 2002-2015 Magnus Lind — https://bitbucket.org/magli143/exomizer/
 * JavaScript port by Bedazzle, 2026.
 * License: Exomizer non-commercial (compressor) + zlib (decompressor) — see LICENSE file.
 */

const MAX_OFFSET = 65535;
const MAX_LENGTH = 65535;
const MAX_PASSES = 65536;

// ============================================================
// Interval node / encoding table structures
// ============================================================

function intervalNodeCreate(start, depth, flags) {
    return {
        start: start,
        bits: 0,
        prefix: flags >= 0 ? flags : depth + 1,
        depth: depth,
        flags: flags,
        score: -1,
        next: null
    };
}

function intervalNodeClone(node) {
    if (node === null) return null;
    return {
        start: node.start,
        bits: node.bits,
        prefix: node.prefix,
        depth: node.depth,
        flags: node.flags,
        score: node.score,
        next: intervalNodeClone(node.next)
    };
}

// ============================================================
// Encoding table optimizer (port of optimal.c)
// ============================================================

function optimizeIntervalTree(stats, stats2, maxDepth, flags) {
    const cache = new Map();

    function optimize1(start, depth) {
        if (start >= 65536 || stats[start] === 0) {
            return null;
        }
        const key = start * maxDepth + depth;
        if (cache.has(key)) {
            return cache.get(key);
        }

        let bestNode = null;

        for (let i = 0; i < 16; i++) {
            const node = intervalNodeCreate(start, depth, flags);
            node.bits = i;
            const end = start + (1 << i);

            let startCount = 0, endCount = 0;
            if (start < 65536) {
                startCount = stats[start];
                if (end < 65536) {
                    endCount = stats[end];
                }
            }

            node.score = (startCount - endCount) * (node.prefix + node.bits);

            if (endCount > 0) {
                node.next = null;
                if (depth + 1 < maxDepth) {
                    node.next = optimize1(end, depth + 1);
                }
                let penalty = 100000000;
                if (stats2 !== null) {
                    penalty = end < 65536 ? stats2[end] : 100000000;
                }
                if (node.next !== null && node.next.score < penalty) {
                    penalty = node.next.score;
                }
                node.score += penalty;
            } else {
                node.next = null;
            }

            if (bestNode === null || node.score < bestNode.score) {
                bestNode = {
                    start: node.start,
                    bits: node.bits,
                    prefix: node.prefix,
                    depth: node.depth,
                    flags: node.flags,
                    score: node.score,
                    next: node.next
                };
            }
        }

        if (bestNode !== null) {
            cache.set(key, bestNode);
        }
        return bestNode;
    }

    const result = optimize1(1, 0);
    return intervalNodeClone(result);
}

// Encode an integer value using interval tree, returns bit cost.
// Also writes to output if out !== null.
function encodeInt(arg, intervalNode, out) {
    let node = intervalNode;
    let end = 0;
    while (node !== null) {
        end = node.start + (1 << node.bits);
        if (arg >= node.start && arg < end) {
            break;
        }
        node = node.next;
    }

    let cost;
    if (node !== null) {
        cost = node.prefix + node.bits;
    } else {
        cost = 100000000.0 + (arg - end);
    }

    if (out !== null && node !== null) {
        out.outputBits(node.bits, arg - node.start);
        if (node.flags < 0) {
            // gamma-coded prefix
            out.outputGammaCode(node.depth);
        } else {
            // flat prefix bits
            out.outputBits(node.prefix, node.depth);
        }
    }

    return cost;
}

// Score a match using encoding tables, returns bit cost.
// offsetTables: [len1_table, len2_table, len3plus_table]
function encodeMatch(mp, lenTable, offsetTables, out) {
    let bits = 0;
    if (mp.offset === 0) {
        // literal(s)
        bits = 9.0 * mp.len;
    } else {
        bits += 1.0; // the 0-bit signaling a non-literal
        let offsetTable;
        switch (mp.len) {
            case 1: offsetTable = offsetTables[0]; break;
            case 2: offsetTable = offsetTables[1]; break;
            default: offsetTable = offsetTables[2]; break;
        }
        bits += encodeInt(mp.offset, offsetTable, out);
        bits += encodeInt(mp.len, lenTable, out);
    }
    return bits;
}

// ============================================================
// Bitstream output (port of output.c)
// ============================================================

function createOutputCtx() {
    const bytes = [];
    let bitbuf = 1;

    return {
        outputByte(b) {
            bytes.push(b & 0xFF);
        },

        outputBits(count, val) {
            while (count-- > 0) {
                bitbuf <<= 1;
                bitbuf |= val & 1;
                val >>= 1;
                if (bitbuf & 0x100) {
                    bytes.push(bitbuf & 0xFF);
                    bitbuf = 1;
                }
            }
        },

        outputGammaCode(code) {
            this.outputBits(1, 1);
            while (code-- > 0) {
                this.outputBits(1, 0);
            }
        },

        flush() {
            bytes.push(bitbuf & 0xFF);
            if (bitbuf & 0x100) {
                bytes.push(1);
            }
            bitbuf = 1;
        },

        getBytes() {
            return new Uint8Array(bytes);
        },

        getLength() {
            return bytes.length;
        }
    };
}

// ============================================================
// Bitstream input (port of exodec.c get_bits)
// ============================================================

function createInputCtx(data, pos) {
    let inpos = pos || 0;
    let bitbuf = data[inpos++];

    return {
        getByte() {
            if (inpos >= data.length) {
                throw new Error('Unexpected end of compressed data');
            }
            return data[inpos++];
        },

        getBits(count) {
            let val = 0;
            while (count-- > 0) {
                if ((bitbuf & 0x1FF) === 1) {
                    bitbuf = this.getByte() | 0x100;
                }
                val <<= 1;
                val |= bitbuf & 1;
                bitbuf >>= 1;
            }
            return val;
        },

        getGammaCode() {
            let gammaCode = 0;
            while (this.getBits(1) === 0) {
                gammaCode++;
            }
            return gammaCode;
        },

        getCookedCode(tableLo, tableHi, tableBi, index) {
            const base = tableLo[index] | (tableHi[index] << 8);
            return base + this.getBits(tableBi[index]);
        }
    };
}

// ============================================================
// Decompressor (port of exodec.c)
// ============================================================

function decompress(inputData) {
    const data = inputData instanceof Uint8Array ? inputData : new Uint8Array(inputData);
    if (data.length === 0) return new Uint8Array(0);

    const ctx = createInputCtx(data, 0);

    // Constants from exodec.c table_init
    const tableBit = [2, 4, 4];
    const tableOff = [48, 32, 16];

    // Read 52 x 4-bit nibbles to build encoding tables
    const tableLo = new Array(52);
    const tableHi = new Array(52);
    const tableBi = new Array(52);

    let a = 0;
    for (let i = 0; i < 52; i++) {
        if (i & 0xF) {
            a += 1 << tableBi[i - 1];
        } else {
            a = 1;
        }
        tableLo[i] = a & 0xFF;
        tableHi[i] = (a >> 8) & 0xFF;
        tableBi[i] = ctx.getBits(4);
    }

    // Main decompression loop
    const output = [];

    for (;;) {
        if (ctx.getBits(1) === 1) {
            output.push(ctx.getByte());
            continue;
        }

        const gammaCode = ctx.getGammaCode();

        if (gammaCode === 16) {
            break;
        }

        if (gammaCode === 17) {
            const copyLen = ctx.getBits(16);
            for (let j = 0; j < copyLen; j++) {
                output.push(ctx.getByte());
            }
            continue;
        }

        // Sequence: decode length from table
        const len = ctx.getCookedCode(tableLo, tableHi, tableBi, gammaCode);

        // Pick offset table based on length
        let tableIndex;
        if (len === 1) tableIndex = 0;
        else if (len === 2) tableIndex = 1;
        else tableIndex = 2;

        const offsetIdx = tableOff[tableIndex] + ctx.getBits(tableBit[tableIndex]);
        const offset = ctx.getCookedCode(tableLo, tableHi, tableBi, offsetIdx);

        // Copy from output history
        const src = output.length - offset;
        for (let j = 0; j < len; j++) {
            output.push(output[src + j]);
        }
    }

    return new Uint8Array(output);
}

// ============================================================
// Match finder (port of match.c)
// ============================================================

function matchCtxInit(buf, maxLen, maxOffset) {
    const bufLen = buf.length;

    // Compute RLE arrays (same as original match.c)
    // rle[i]: how many consecutive identical bytes precede position i
    const rle = new Int32Array(bufLen + 1);
    // rleR[i]: how many positions forward from i have increasing rle
    const rleR = new Int32Array(bufLen + 1);

    for (let i = 1; i < bufLen; i++) {
        if (buf[i] === buf[i - 1]) {
            let len = rle[i - 1] + 1;
            if (len > maxLen) len = 0;
            rle[i] = len;
        }
    }

    for (let i = bufLen - 2; i >= 0; i--) {
        if (rle[i] < rle[i + 1]) {
            rleR[i] = rleR[i + 1] + 1;
        }
    }

    // Hash chain match finder
    // Chain positions by 3-byte hash for better matching
    const HASH_SIZE = 65536;
    const hashHead = new Int32Array(HASH_SIZE).fill(-1);
    const hashPrev = new Int32Array(bufLen).fill(-1);

    // Build chains: for each position, link to previous position with same digraph
    for (let i = 0; i < bufLen - 1; i++) {
        const h = (buf[i] << 8) | buf[i + 1];
        hashPrev[i] = hashHead[h];
        hashHead[h] = i;
    }

    // For each position, compute all matches
    const matchCache = new Array(bufLen);

    for (let i = 0; i < bufLen; i++) {
        const matches = [];
        // Literal match always available
        matches.push({ len: 1, offset: 0 });

        let bestSeqLen = 0;

        // Search hash chain for matching positions
        if (i < bufLen - 1) {
            const h = (buf[i] << 8) | buf[i + 1];
            let np = hashHead[h];

            while (np !== -1) {
                if (np === i) {
                    np = hashPrev[np];
                    continue;
                }

                const offset = Math.abs(np - i);
                if (offset > maxOffset) {
                    np = hashPrev[np];
                    continue;
                }

                // Determine match source and destination
                // In Exomizer, offset means "go back offset bytes from current output position"
                // During compression, we want: buf[i - k] == buf[i - k - offset] for k=0..len-1
                // Which means np should be < i and offset = i - np
                if (np >= i) {
                    np = hashPrev[np];
                    continue;
                }
                const realOffset = i - np;

                // Extend match forward from position i (and position np)
                let len = 0;
                while (len < maxLen && i + len < bufLen && np + len < bufLen &&
                       buf[i + len] === buf[np + len]) {
                    len++;
                }

                if (len > bestSeqLen) {
                    bestSeqLen = len;
                    matches.push({ len: len, offset: realOffset });
                }

                // Add length-1 match for small offsets (helps the optimizer)
                if (realOffset <= 16 && len >= 1 && bestSeqLen <= 1) {
                    // Already covered by the longer match or literal
                }

                np = hashPrev[np];
                if (bestSeqLen >= maxLen) break;
            }
        }

        // RLE match: if there's a run of identical bytes from position i
        if (i > 0 && i + 1 < bufLen && buf[i] === buf[i - 1]) {
            // rle[i] tells us how many identical bytes precede i
            // For a forward RLE from i: count how many bytes from i match buf[i]
            let rleLen = 1;
            while (i + rleLen < bufLen && buf[i + rleLen] === buf[i] && rleLen < maxLen) {
                rleLen++;
            }
            if (rleLen > 1) {
                matches.push({ len: rleLen, offset: 1 });
            }
        }

        matchCache[i] = matches;
    }

    return {
        buf: buf,
        len: bufLen,
        rle: rle,
        rleR: rleR,
        maxLen: maxLen,
        maxOffset: maxOffset,
        matchCache: matchCache
    };
}

// ============================================================
// Optimal parser / search buffer (port of search.c)
// ============================================================

function searchBuffer(mctx, lenTable, offsetTables, useLiteralSequences) {
    const bufLen = mctx.len;

    // DP array: for each position in the input, store the cheapest way to encode
    // from that position to the end.
    // nodes[i] = best encoding decision at position i
    // nodes[bufLen] = end sentinel (score 0)
    const nodes = new Array(bufLen + 1);
    for (let i = 0; i <= bufLen; i++) {
        nodes[i] = {
            index: i,
            matchLen: 0,
            matchOffset: 0,
            totalScore: (i === bufLen) ? 0 : 1e9,
            totalOffset: 0,
            prev: null // points to the node after this match
        };
    }

    // Literal sequence tracking
    let bestCopyNode = nodes[bufLen];
    let bestCopyLen = 0;

    // Process from end to start (standard backward DP)
    for (let i = bufLen - 1; i >= 0; i--) {
        const matches = mctx.matchCache[i];
        if (!matches) continue;

        // Try each match starting at position i
        for (let mi = 0; mi < matches.length; mi++) {
            const m = matches[mi];
            // Try lengths from m.len down to 1
            for (let tryLen = m.len; tryLen >= 1; tryLen--) {
                const nextIdx = i + tryLen;
                if (nextIdx > bufLen) continue;

                const mp = { len: tryLen, offset: m.offset };
                const score = encodeMatch(mp, lenTable, offsetTables, null);
                const totalScore = nodes[nextIdx].totalScore + score;
                const totalOffset = nodes[nextIdx].totalOffset + m.offset;

                if (totalScore < 100000000.0 &&
                    (nodes[i].matchLen === 0 ||
                     totalScore < nodes[i].totalScore ||
                     (totalScore === nodes[i].totalScore &&
                      (m.offset === 0 ||
                       (nodes[i].matchLen === tryLen &&
                        totalOffset <= nodes[i].totalOffset))))) {
                    nodes[i].matchLen = tryLen;
                    nodes[i].matchOffset = m.offset;
                    nodes[i].totalScore = totalScore;
                    nodes[i].totalOffset = totalOffset;
                    nodes[i].prev = nodes[nextIdx];
                }
            }
        }

        // Literal sequence optimization
        if (useLiteralSequences) {
            const curNode = nodes[i];
            if (bestCopyNode.totalScore + bestCopyLen * 8.0 - curNode.totalScore > 0.0 ||
                bestCopyLen > 65535) {
                bestCopyNode = curNode;
                bestCopyLen = 0;
            } else if (bestCopyLen > 0) {
                // Cost of a literal sequence escape: 1 bit (flag) + gamma(17) + 16 bits (length) + 8*len bits (data)
                const copyScore = bestCopyLen * 8.0 + (1.0 + 17.0 + 17.0);
                const totalCopyScore = bestCopyNode.totalScore + copyScore;
                if (curNode.totalScore > totalCopyScore) {
                    curNode.totalScore = totalCopyScore;
                    curNode.totalOffset = bestCopyNode.totalOffset;
                    curNode.matchLen = bestCopyLen;
                    curNode.matchOffset = 0; // literal sequence
                    curNode.prev = bestCopyNode;
                }
            }
            bestCopyLen++;
        }
    }

    return nodes[0];
}

// ============================================================
// Collect match statistics for table optimization
// ============================================================

function collectStats(startNode) {
    const lenArr = new Int32Array(65536);
    const offsetArr = [new Int32Array(65536), new Int32Array(65536), new Int32Array(65536)];

    let node = startNode;
    while (node !== null && node.prev !== null) {
        if (node.matchOffset > 0 && node.matchLen > 0) {
            lenArr[node.matchLen]++;
            let ti;
            if (node.matchLen === 1) ti = 0;
            else if (node.matchLen === 2) ti = 1;
            else ti = 2;
            if (node.matchOffset < 65536) {
                offsetArr[ti][node.matchOffset]++;
            }
        }
        node = node.prev;
    }

    // Accumulate: make suffix sums (stats[i] = count of values >= i)
    for (let i = 65534; i >= 0; i--) {
        lenArr[i] += lenArr[i + 1];
    }
    for (let t = 0; t < 3; t++) {
        for (let i = 65534; i >= 0; i--) {
            offsetArr[t][i] += offsetArr[t][i + 1];
        }
    }

    return { lenArr, offsetArr };
}

function collectPenaltyStats(startNode, lenTable) {
    const offsetPenalty = [new Int32Array(65536), new Int32Array(65536), new Int32Array(65536)];

    let node = startNode;
    while (node !== null && node.prev !== null) {
        if (node.matchOffset > 0 && node.matchLen > 0) {
            const threshold = node.matchLen * 9 - 1 - encodeInt(node.matchLen, lenTable, null);
            let ti;
            if (node.matchLen === 1) ti = 0;
            else if (node.matchLen === 2) ti = 1;
            else ti = 2;
            if (node.matchOffset < 65536) {
                offsetPenalty[ti][node.matchOffset] += Math.max(0, threshold);
            }
        }
        node = node.prev;
    }

    for (let t = 0; t < 3; t++) {
        for (let i = 65534; i >= 0; i--) {
            offsetPenalty[t][i] += offsetPenalty[t][i + 1];
        }
    }

    return offsetPenalty;
}

// ============================================================
// Encoding tables: export/import as string
// ============================================================

function exportEncoding(lenTable, offsetTables) {
    function helper(node, size) {
        let s = '';
        let count = 0;
        let n = node;
        while (n !== null) {
            s += n.bits.toString(16).toUpperCase();
            n = n.next;
            count++;
        }
        while (count < size) {
            s += '0';
            count++;
        }
        return s;
    }
    return helper(lenTable, 16) + ',' +
           helper(offsetTables[0], 4) + ',' +
           helper(offsetTables[1], 16) + ',' +
           helper(offsetTables[2], 16);
}

function importEncoding(encodingStr) {
    const parts = encodingStr.split(',');
    if (parts.length !== 4) {
        throw new Error('Invalid encoding string');
    }

    function parseTable(s, flags) {
        let head = null;
        let tail = null;
        let start = 1;
        let depth = 0;
        for (let i = 0; i < s.length; i++) {
            const bits = parseInt(s[i], 16);
            const node = intervalNodeCreate(start, depth, flags);
            node.bits = bits;
            depth++;
            start += 1 << bits;
            if (head === null) {
                head = node;
                tail = node;
            } else {
                tail.next = node;
                tail = node;
            }
        }
        return head;
    }

    return {
        lenTable: parseTable(parts[0], -1),
        offsetTables: [
            parseTable(parts[1], 2),
            parseTable(parts[2], 4),
            parseTable(parts[3], 4)
        ]
    };
}

// ============================================================
// Output encoding tables as nibbles to bitstream
// ============================================================

function outputEncodingTables(out, lenTable, offsetTables) {
    function intervalOut(node, size) {
        const nibbles = [];
        let n = node;
        while (n !== null) {
            nibbles.push(n.bits);
            n = n.next;
        }
        while (nibbles.length < size) {
            nibbles.push(0);
        }
        // Write in reverse order within each group (matching C's interval_out)
        for (let i = size - 1; i >= 0; i--) {
            out.outputBits(4, nibbles[i]);
        }
    }

    // Same order as original optimal_out: offset1(4), offset2(16), offset3(16), len(16)
    intervalOut(offsetTables[0], 4);
    intervalOut(offsetTables[1], 16);
    intervalOut(offsetTables[2], 16);
    intervalOut(lenTable, 16);
}

// ============================================================
// Output compressed data from the optimal path
// ============================================================

function doOutput(startNode, lenTable, offsetTables, out, inputData) {
    // Collect path into array (startNode -> ... -> end)
    const path = [];
    let node = startNode;
    while (node !== null) {
        path.push(node);
        node = node.prev;
    }

    let literalSequencesUsed = false;

    // Output in REVERSE order matching C's do_output:
    // 1. EOF marker first (will be last after byte reversal)
    out.outputGammaCode(16);
    out.outputBits(1, 0);

    // 2. Data from end of path to start (C traverses snp->prev backwards)
    for (let i = path.length - 1; i >= 0; i--) {
        const n = path[i];
        if (n.matchLen === 0) continue;

        if (n.matchOffset === 0) {
            // Literal or literal sequence
            if (n.matchLen === 1) {
                // Single literal: byte then 1-bit flag (reversed from read order)
                out.outputByte(inputData[n.index]);
                out.outputBits(1, 1);
            } else {
                // Literal sequence: raw bytes, 16-bit length, gamma(17), 0-bit flag
                for (let j = n.matchLen - 1; j >= 0; j--) {
                    out.outputByte(inputData[n.index + j]);
                }
                out.outputBits(16, n.matchLen);
                out.outputGammaCode(17);
                out.outputBits(1, 0);
                literalSequencesUsed = true;
            }
        } else {
            // Match: encode offset then length (C writes offset first, length second)
            // then 0-bit flag
            let tableIdx;
            if (n.matchLen === 1) tableIdx = 0;
            else if (n.matchLen === 2) tableIdx = 1;
            else tableIdx = 2;

            encodeInt(n.matchOffset, offsetTables[tableIdx], out);
            encodeInt(n.matchLen, lenTable, out);
            out.outputBits(1, 0);
        }
    }

    return literalSequencesUsed;
}

// ============================================================
// Default encoding tables (uniform 4-bit distribution)
// ============================================================

function createDefaultTables() {
    return importEncoding('4444444444444444,4444,4444444444444444,4444444444444444');
}

// ============================================================
// Main compressor (multi-pass optimization)
// ============================================================

function compress(inputData, maxPasses) {
    const data = inputData instanceof Uint8Array ? inputData : new Uint8Array(inputData);

    if (data.length === 0) {
        const out = createOutputCtx();
        const tables = createDefaultTables();
        // Reverse order: EOF first, then tables, then flush
        out.outputGammaCode(16);
        out.outputBits(1, 0);
        outputEncodingTables(out, tables.lenTable, tables.offsetTables);
        out.flush();
        const bytes = out.getBytes();
        reverse(bytes, 0, bytes.length - 1);
        return { data: bytes, encoding: exportEncoding(tables.lenTable, tables.offsetTables) };
    }

    maxPasses = maxPasses || MAX_PASSES;
    const maxLen = Math.min(MAX_LENGTH, data.length);
    const maxOffset = Math.min(MAX_OFFSET, data.length);

    // Build match cache (done once)
    const mctx = matchCtxInit(data, maxLen, maxOffset);

    // Initialize with default tables
    let tables = createDefaultTables();
    let prevEncoding = '';
    let bestPath = null;

    // Multi-pass: optimize tables iteratively until convergence
    for (let pass = 0; pass < maxPasses; pass++) {
        // Find optimal path with current encoding tables
        bestPath = searchBuffer(mctx, tables.lenTable, tables.offsetTables, true);

        // Collect frequency statistics from the optimal path
        const { lenArr, offsetArr } = collectStats(bestPath);

        // Optimize length table
        const newLenTable = optimizeIntervalTree(lenArr, null, 16, -1);
        if (newLenTable === null) break;

        // Collect penalty statistics for offset optimization
        const penaltyStats = collectPenaltyStats(bestPath, newLenTable);

        // Optimize offset tables
        const newOff0 = optimizeIntervalTree(offsetArr[0], penaltyStats[0], 1 << 2, 2);
        const newOff1 = optimizeIntervalTree(offsetArr[1], penaltyStats[1], 1 << 4, 4);
        const newOff2 = optimizeIntervalTree(offsetArr[2], penaltyStats[2], 1 << 4, 4);

        tables.lenTable = newLenTable;
        tables.offsetTables[0] = newOff0;
        tables.offsetTables[1] = newOff1;
        tables.offsetTables[2] = newOff2;

        const encoding = exportEncoding(tables.lenTable, tables.offsetTables);
        if (encoding === prevEncoding) {
            break;
        }
        prevEncoding = encoding;
    }

    // Final output pass with converged tables
    // Re-run search with final tables to get the optimal path for these tables
    bestPath = searchBuffer(mctx, tables.lenTable, tables.offsetTables, true);

    // Output in C's reverse order: EOF, data(end→start), tables, flush
    // Then reverse the byte array for forward decompression
    const out = createOutputCtx();
    const litSeqUsed = doOutput(bestPath, tables.lenTable, tables.offsetTables, out, data);
    outputEncodingTables(out, tables.lenTable, tables.offsetTables);
    out.flush();

    // Reverse byte array: makes the stream readable forward by the decompressor
    const bytes = out.getBytes();
    reverse(bytes, 0, bytes.length - 1);

    return {
        data: bytes,
        encoding: exportEncoding(tables.lenTable, tables.offsetTables),
        literalSequencesUsed: litSeqUsed
    };
}

// ============================================================
// Backwards mode
// ============================================================

function reverse(arr, start, end) {
    while (start < end) {
        const tmp = arr[start];
        arr[start] = arr[end];
        arr[end] = tmp;
        start++;
        end--;
    }
}

function compressBackwards(inputData, maxPasses) {
    const data = inputData instanceof Uint8Array ? inputData : new Uint8Array(inputData);
    const reversed = new Uint8Array(data);
    reverse(reversed, 0, reversed.length - 1);
    const result = compress(reversed, maxPasses);
    reverse(result.data, 0, result.data.length - 1);
    return result;
}

function decompressBackwards(inputData) {
    const data = inputData instanceof Uint8Array ? inputData : new Uint8Array(inputData);
    const reversed = new Uint8Array(data);
    reverse(reversed, 0, reversed.length - 1);
    const result = decompress(reversed);
    reverse(result, 0, result.length - 1);
    return result;
}

// ============================================================
// Array wrappers
// ============================================================

function compressArray(inputArray, backwards, maxPasses) {
    const inputData = inputArray instanceof Uint8Array ? inputArray : new Uint8Array(inputArray);
    if (backwards) {
        return compressBackwards(inputData, maxPasses);
    }
    return compress(inputData, maxPasses);
}

function decompressArray(inputArray, backwards) {
    const inputData = inputArray instanceof Uint8Array ? inputArray : new Uint8Array(inputArray);
    if (backwards) {
        return decompressBackwards(inputData);
    }
    return decompress(inputData);
}

// ============================================================
// Module exports
// ============================================================

if (typeof window !== 'undefined') {
    window.Exomizer2 = {
        compress,
        decompress,
        compressBackwards,
        decompressBackwards,
        compressArray,
        decompressArray,
        MAX_OFFSET,
        MAX_LENGTH
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        compress,
        decompress,
        compressBackwards,
        decompressBackwards,
        compressArray,
        decompressArray,
        MAX_OFFSET,
        MAX_LENGTH
    };
}
})();
