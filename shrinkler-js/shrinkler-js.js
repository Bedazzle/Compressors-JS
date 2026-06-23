(function(){
/*
 * shrinkler-js — LZ77 compression with range coding and adaptive contexts in JavaScript
 * Original C++ implementation by Aske Simon Christensen (Blueberry / Loonies) — https://github.com/askeksa/Shrinkler
 * JavaScript port by Bedazzle, 2026.
 * License: Shrinkler license (permissive) — see LICENSE file.
 */

// ===== Constants =====

const ADJUST_SHIFT = 4;
const INIT_PROB = 0x8000;
const NUM_SINGLE_CONTEXTS = 1;
const CONTEXT_GROUP_SIZE = 256;
const NUM_CONTEXT_GROUPS = 4;
const NUM_CONTEXTS = NUM_SINGLE_CONTEXTS + NUM_CONTEXT_GROUPS * CONTEXT_GROUP_SIZE; // 1025
const CONTEXT_KIND = 0;
const CONTEXT_GROUP_OFFSET = 2;
const CONTEXT_GROUP_LENGTH = 3;
const BIT_PRECISION = 6;
const MIN_SIZE = 2;
const MAX_SIZE = 12 << BIT_PRECISION;

// ===== Range Encoder =====

function createRangeEncoder() {
    return {
        intervalsize: 0x8000,
        intervalmin: 0,
        outputBytes: [],
        destBit: -1
    };
}

function encoderAddBit(enc) {
    // Carry propagation: add 1 to the bit just before dest_bit, propagating carry backward
    let pos = enc.destBit - 1;
    while (pos >= 0) {
        const bytepos = pos >>> 3;
        const bitmask = 0x80 >>> (pos & 7);
        while (enc.outputBytes.length <= bytepos) enc.outputBytes.push(0);
        enc.outputBytes[bytepos] ^= bitmask;
        if (enc.outputBytes[bytepos] & bitmask) return; // Bit set to 1, no further carry
        pos--;
    }
}

function encoderCode(enc, contexts, context, bit) {
    const prob = contexts[context];
    const threshold = (enc.intervalsize * prob) >>> 16;
    if (bit === 0) {
        enc.intervalmin += threshold;
        if (enc.intervalmin & 0x10000) {
            encoderAddBit(enc);
        }
        enc.intervalsize -= threshold;
        contexts[context] = prob - (prob >>> ADJUST_SHIFT);
    } else {
        enc.intervalsize = threshold;
        contexts[context] = prob + ((0xffff - prob) >>> ADJUST_SHIFT);
    }
    while (enc.intervalsize < 0x8000) {
        enc.destBit++;
        enc.intervalsize <<= 1;
        enc.intervalmin <<= 1;
        if (enc.intervalmin & 0x10000) {
            encoderAddBit(enc);
        }
    }
    enc.intervalmin &= 0xffff;
}

function encoderFinish(enc) {
    const intervalmax = enc.intervalmin + enc.intervalsize;
    let finalMin = 0;
    let finalSize = 0x10000;
    while (finalMin < enc.intervalmin || finalMin + finalSize >= intervalmax) {
        if (finalMin + finalSize < intervalmax) {
            encoderAddBit(enc);
            finalMin += finalSize;
        }
        enc.destBit++;
        finalSize >>= 1;
    }
    while ((enc.destBit - 1) >>> 3 >= enc.outputBytes.length) {
        enc.outputBytes.push(0);
    }
    const numBytes = enc.outputBytes.length;
    return new Uint8Array(enc.outputBytes.slice(0, numBytes));
}

// ===== Range Decoder =====

function createRangeDecoder(data) {
    return {
        data: data,
        intervalsize: 1,
        intervalvalue: 0,
        bitIndex: 0
    };
}

function decoderGetBit(dec) {
    const byteIndex = dec.bitIndex >>> 3;
    const bitInByte = (~dec.bitIndex) & 7;
    dec.bitIndex++;
    if (byteIndex >= dec.data.length) return 0;
    return (dec.data[byteIndex] >>> bitInByte) & 1;
}

function decoderDecode(dec, contexts, context) {
    while (dec.intervalsize < 0x8000) {
        dec.intervalsize = (dec.intervalsize << 1) & 0xffff;
        dec.intervalvalue = ((dec.intervalvalue << 1) | decoderGetBit(dec)) & 0xffff;
    }
    const prob = contexts[context];
    const threshold = (dec.intervalsize * prob) >>> 16;
    if (dec.intervalvalue >= threshold) {
        dec.intervalvalue -= threshold;
        dec.intervalsize -= threshold;
        contexts[context] = prob - (prob >>> ADJUST_SHIFT);
        return 0;
    } else {
        dec.intervalsize = threshold;
        contexts[context] = prob + ((0xffff - prob) >>> ADJUST_SHIFT);
        return 1;
    }
}

// ===== Counting Coder =====

function createCountingCoder() {
    return new Int32Array(NUM_CONTEXTS * 2);
}

function countingCode(coder, _unused, context, bit) {
    coder[context * 2 + (bit ? 1 : 0)]++;
}

function countingMix(oldCoder, newCoder) {
    const result = new Int32Array(NUM_CONTEXTS * 2);
    for (let i = 0; i < NUM_CONTEXTS * 2; i++) {
        result[i] = (oldCoder[i] * 3 + newCoder[i] + 2) >>> 2;
    }
    return result;
}

// ===== Size Measuring Coder =====

function createSizeMeasurer(countingCoder) {
    const sizes = new Int32Array(NUM_CONTEXTS * 2);
    const measurer = { sizes: sizes, totalSize: 0 };
    if (countingCoder === null) {
        sizes.fill(1 << BIT_PRECISION);
        return measurer;
    }
    for (let ctx = 0; ctx < NUM_CONTEXTS; ctx++) {
        const c0 = countingCoder[ctx * 2 + 0] + 1;
        const c1 = countingCoder[ctx * 2 + 1] + 1;
        const total = c0 + c1;
        const s0 = Math.round(Math.log2(total / c0) * (1 << BIT_PRECISION));
        const s1 = Math.round(Math.log2(total / c1) * (1 << BIT_PRECISION));
        sizes[ctx * 2 + 0] = Math.max(MIN_SIZE, Math.min(MAX_SIZE, s0));
        sizes[ctx * 2 + 1] = Math.max(MIN_SIZE, Math.min(MAX_SIZE, s1));
    }
    return measurer;
}

function sizeMeasurerCode(measurer, _unused, context, bit) {
    measurer.totalSize += measurer.sizes[context * 2 + (bit ? 1 : 0)];
}

// ===== Number Encode/Decode =====

function encodeNumber(coder, coderFn, contexts, baseContext, number) {
    let i = 0;
    while ((4 << i) <= number) {
        coderFn(coder, contexts, baseContext + i * 2 + 2, 1);
        i++;
    }
    coderFn(coder, contexts, baseContext + i * 2 + 2, 0);
    while (i >= 0) {
        coderFn(coder, contexts, baseContext + i * 2 + 1, (number >>> i) & 1);
        i--;
    }
}

function decodeNumber(dec, contexts, baseContext) {
    let i = 0;
    while (decoderDecode(dec, contexts, baseContext + i * 2 + 2) === 1) {
        i++;
    }
    let number = 1;
    while (i >= 0) {
        number = (number << 1) | decoderDecode(dec, contexts, baseContext + i * 2 + 1);
        i--;
    }
    return number;
}

function measureNumberCost(measurer, baseContext, number) {
    const saved = measurer.totalSize;
    measurer.totalSize = 0;
    let i = 0;
    while ((4 << i) <= number) {
        sizeMeasurerCode(measurer, null, baseContext + i * 2 + 2, 1);
        i++;
    }
    sizeMeasurerCode(measurer, null, baseContext + i * 2 + 2, 0);
    while (i >= 0) {
        sizeMeasurerCode(measurer, null, baseContext + i * 2 + 1, (number >>> i) & 1);
        i--;
    }
    const cost = measurer.totalSize;
    measurer.totalSize = saved;
    return cost;
}

// ===== Literal Cost Measurement =====

function measureLiteral(measurer, byte, parityOffset) {
    let cost = measurer.sizes[(NUM_SINGLE_CONTEXTS + parityOffset + CONTEXT_KIND) * 2 + 0];
    let ctx = 1;
    for (let i = 7; i >= 0; i--) {
        const bit = (byte >>> i) & 1;
        cost += measurer.sizes[(NUM_SINGLE_CONTEXTS + parityOffset + ctx) * 2 + (bit ? 1 : 0)];
        ctx = (ctx << 1) | bit;
    }
    return cost;
}

function measureLiteralFirst(measurer, byte, parityOffset) {
    let cost = 0;
    let ctx = 1;
    for (let i = 7; i >= 0; i--) {
        const bit = (byte >>> i) & 1;
        cost += measurer.sizes[(NUM_SINGLE_CONTEXTS + parityOffset + ctx) * 2 + (bit ? 1 : 0)];
        ctx = (ctx << 1) | bit;
    }
    return cost;
}

// ===== Decompressor =====

function decompressData(data, parityContext) {
    if (data.length === 0) return new Uint8Array(0);
    const dec = createRangeDecoder(data);
    const contexts = new Uint16Array(NUM_CONTEXTS);
    contexts.fill(INIT_PROB);
    const output = [];
    let afterFirst = false;
    let prevWasRef = false;
    let lastOffset = 0;
    let parity = 0;

    while (true) {
        const parityOffset = parityContext ? ((parity & 1) * CONTEXT_GROUP_SIZE) : 0;

        if (!afterFirst || decoderDecode(dec, contexts, NUM_SINGLE_CONTEXTS + parityOffset + CONTEXT_KIND) === 0) {
            // Literal
            afterFirst = true;
            let ctx = 1;
            let byte = 0;
            for (let i = 7; i >= 0; i--) {
                const bit = decoderDecode(dec, contexts, NUM_SINGLE_CONTEXTS + parityOffset + ctx);
                byte |= bit << i;
                ctx = (ctx << 1) | bit;
            }
            output.push(byte);
            parity++;
            prevWasRef = false;
        } else {
            // Reference
            let offset;
            if (!prevWasRef) {
                const repeated = decoderDecode(dec, contexts, 0);
                if (repeated) {
                    offset = lastOffset;
                } else {
                    offset = decodeNumber(dec, contexts, NUM_SINGLE_CONTEXTS + CONTEXT_GROUP_OFFSET * CONTEXT_GROUP_SIZE) - 2;
                    if (offset === 0) break; // EOF
                    lastOffset = offset;
                }
            } else {
                offset = decodeNumber(dec, contexts, NUM_SINGLE_CONTEXTS + CONTEXT_GROUP_OFFSET * CONTEXT_GROUP_SIZE) - 2;
                if (offset === 0) break; // EOF
                lastOffset = offset;
            }
            const length = decodeNumber(dec, contexts, NUM_SINGLE_CONTEXTS + CONTEXT_GROUP_LENGTH * CONTEXT_GROUP_SIZE);
            for (let i = 0; i < length; i++) {
                output.push(output[output.length - offset]);
            }
            parity += length;
            prevWasRef = true;
        }
    }
    return new Uint8Array(output);
}

// ===== Suffix Array (O(n log^2 n) construction) =====

function buildSuffixArray(input) {
    const n = input.length;
    if (n === 0) return { sa: new Int32Array(0), rank: new Int32Array(0), lcp: new Int32Array(0) };

    const sa = new Int32Array(n);
    const rank = new Int32Array(n);
    const tmp = new Int32Array(n);

    for (let i = 0; i < n; i++) {
        sa[i] = i;
        rank[i] = input[i];
    }

    for (let k = 1; k < n; k <<= 1) {
        const kk = k;
        const r = rank;
        const cmp = (a, b) => {
            if (r[a] !== r[b]) return r[a] - r[b];
            const ra = a + kk < n ? r[a + kk] : -1;
            const rb = b + kk < n ? r[b + kk] : -1;
            return ra - rb;
        };
        sa.sort(cmp);
        tmp[sa[0]] = 0;
        for (let i = 1; i < n; i++) {
            tmp[sa[i]] = tmp[sa[i - 1]] + (cmp(sa[i - 1], sa[i]) < 0 ? 1 : 0);
        }
        for (let i = 0; i < n; i++) rank[i] = tmp[i];
        if (rank[sa[n - 1]] === n - 1) break;
    }

    // Build LCP using Kasai's algorithm
    const lcp = new Int32Array(n);
    let h = 0;
    for (let i = 0; i < n; i++) {
        const r = rank[i];
        if (r > 0) {
            const j = sa[r - 1];
            while (i + h < n && j + h < n && input[i + h] === input[j + h]) h++;
            lcp[r] = h;
            if (h > 0) h--;
        } else {
            h = 0;
        }
    }

    return { sa, rank, lcp };
}

// ===== Match Finder =====

function findMatches(input, sa, rank, lcp, pos, matchPatience, maxSameLength) {
    const matches = [];
    const n = sa.length;
    if (pos >= input.length) return matches;

    const r = rank[pos];
    let leftIdx = r - 1;
    let rightIdx = r + 1;
    let leftLen = (leftIdx >= 0) ? lcp[r] : 0;
    let rightLen = (rightIdx < n) ? lcp[rightIdx] : 0;
    let patience = matchPatience;
    let lastLength = -1;
    let sameCount = 0;

    while ((leftIdx >= 0 || rightIdx < n) && patience > 0) {
        let chooseLeft;
        if (leftIdx < 0) chooseLeft = false;
        else if (rightIdx >= n) chooseLeft = true;
        else chooseLeft = leftLen >= rightLen;

        let matchLen, matchPos;
        if (chooseLeft) {
            matchLen = leftLen;
            matchPos = sa[leftIdx];
            leftIdx--;
            if (leftIdx >= 0) leftLen = Math.min(leftLen, lcp[leftIdx + 1]);
        } else {
            matchLen = rightLen;
            matchPos = sa[rightIdx];
            rightIdx++;
            if (rightIdx < n) rightLen = Math.min(rightLen, lcp[rightIdx]);
        }

        if (matchLen < 2) break;
        if (matchPos >= pos) { patience--; continue; } // Must reference backwards

        const offset = pos - matchPos;

        if (matchLen !== lastLength) {
            lastLength = matchLen;
            sameCount = 1;
            matches.push({ offset, length: matchLen });
        } else {
            sameCount++;
            if (sameCount <= maxSameLength) {
                matches.push({ offset, length: matchLen });
            } else {
                patience--;
            }
        }
    }

    return matches;
}

// ===== Optimal Parser (Shrinkler-style reference graph) =====

function optimalParse(input, sa, rank, lcp, sizeMeasurer, params, parityContext) {
    const n = input.length;
    if (n === 0) return [];

    const parityMask = parityContext ? 1 : 0;
    const baseCtxOff = NUM_SINGLE_CONTEXTS + CONTEXT_GROUP_OFFSET * CONTEXT_GROUP_SIZE;
    const baseCtxLen = NUM_SINGLE_CONTEXTS + CONTEXT_GROUP_LENGTH * CONTEXT_GROUP_SIZE;

    // Precompute cumulative literal cost from each position to end
    const literalSize = new Float64Array(n + 1);
    {
        let size = 0;
        let parity = 0;
        for (let i = 0; i < n; i++) {
            literalSize[i] = size;
            const parityOff = (parity & parityMask) * CONTEXT_GROUP_SIZE;
            size += (i === 0)
                ? measureLiteralFirst(sizeMeasurer, input[i], parityOff)
                : measureLiteral(sizeMeasurer, input[i], parityOff);
            parity++;
        }
        literalSize[n] = size;
    }

    // Measure reference cost given state
    function measureRefCost(pos, prevWasRef, lastOffset, offset, length) {
        const parityOff = (pos & parityMask) * CONTEXT_GROUP_SIZE;
        let cost = sizeMeasurer.sizes[(NUM_SINGLE_CONTEXTS + parityOff + CONTEXT_KIND) * 2 + 1];
        const isRepeated = (!prevWasRef && offset === lastOffset && lastOffset > 0);
        if (!prevWasRef) {
            cost += sizeMeasurer.sizes[0 * 2 + (isRepeated ? 1 : 0)];
        }
        if (!isRepeated) {
            cost += measureNumberCost(sizeMeasurer, baseCtxOff, offset + 2);
        }
        cost += measureNumberCost(sizeMeasurer, baseCtxLen, length);
        return cost;
    }

    // Measure EOF cost from state
    function measureEofCost(pos, prevWasRef) {
        const parityOff = (pos & parityMask) * CONTEXT_GROUP_SIZE;
        let cost = sizeMeasurer.sizes[(NUM_SINGLE_CONTEXTS + parityOff + CONTEXT_KIND) * 2 + 1];
        if (!prevWasRef) {
            cost += sizeMeasurer.sizes[0 * 2 + 0];
        }
        cost += measureNumberCost(sizeMeasurer, baseCtxOff, 2);
        return cost;
    }

    // Reference edge: {pos, offset, length, totalSize, source, heapIdx}
    // totalSize = cost-to-reach-pos + ref-cost + literal-cost-from-target-to-end
    // edges_to_pos[target] = Map<offset, edge> (best edge per offset reaching this target)
    const edgesToPos = new Array(n + 1);
    for (let i = 0; i <= n; i++) edgesToPos[i] = new Map();

    // bestForOffset = Map<offset, edge> (best source edge per offset at current position)
    let bestForOffset = new Map();

    // Heap for pruning (max-heap by totalSize)
    let rootEdges = []; // array of edges, managed as a binary max-heap
    let edgeCount = 0;
    const maxEdges = params.references;

    function heapSwap(a, b) {
        const t = rootEdges[a]; rootEdges[a] = rootEdges[b]; rootEdges[b] = t;
        rootEdges[a].heapIdx = a;
        rootEdges[b].heapIdx = b;
    }
    function heapUp(i) {
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (rootEdges[i].totalSize > rootEdges[p].totalSize) { heapSwap(i, p); i = p; }
            else break;
        }
    }
    function heapDown(i) {
        const len = rootEdges.length;
        while (true) {
            let largest = i;
            const l = 2 * i + 1, r = 2 * i + 2;
            if (l < len && rootEdges[l].totalSize > rootEdges[largest].totalSize) largest = l;
            if (r < len && rootEdges[r].totalSize > rootEdges[largest].totalSize) largest = r;
            if (largest !== i) { heapSwap(i, largest); i = largest; }
            else break;
        }
    }
    function heapInsert(edge) {
        edge.heapIdx = rootEdges.length;
        rootEdges.push(edge);
        heapUp(edge.heapIdx);
    }
    function heapRemove(edge) {
        const idx = edge.heapIdx;
        if (idx < 0) return;
        edge.heapIdx = -1;
        const last = rootEdges.length - 1;
        if (idx === last) {
            rootEdges.pop();
        } else {
            rootEdges[idx] = rootEdges[last];
            rootEdges[idx].heapIdx = idx;
            rootEdges.pop();
            heapUp(idx);
            heapDown(idx);
        }
    }
    function heapPeek() { return rootEdges.length > 0 ? rootEdges[0] : null; }

    function putByOffset(container, edge) {
        const existing = container.get(edge.offset);
        if (!existing) {
            container.set(edge.offset, edge);
            heapInsert(edge);
            edgeCount++;
        } else if (edge.totalSize < existing.totalSize) {
            heapRemove(existing);
            edgeCount--;
            container.set(edge.offset, edge);
            heapInsert(edge);
            edgeCount++;
        }
        // else: edge is worse, discard
    }

    function cleanWorstEdge(pos, exclude) {
        if (rootEdges.length === 0) return false;
        const worst = rootEdges[0]; // max-heap: worst (largest totalSize) is at top
        // Always remove from heap first (matches original C++ remove_largest)
        heapRemove(worst);
        if (worst === best || worst === exclude) return true;
        const target = worst.pos + worst.length;
        const container = target > pos ? edgesToPos[target] : bestForOffset;
        if (container.size > 1 && container.has(worst.offset) && container.get(worst.offset) === worst) {
            container.delete(worst.offset);
            edgeCount--;
        }
        return true;
    }

    function newEdge(source, pos, offset, length) {
        // Skip if same offset ending at same position as source
        if (source && offset === source.offset && pos === source.pos + source.length) return;

        const prevTarget = source ? source.pos + source.length : 0;
        const newTarget = pos + length;
        const prevWasRef = source ? (pos === prevTarget) : false;
        const lastOffset = source ? source.offset : 0;

        const sizeBefore = (source ? source.totalSize : literalSize[n]) - (literalSize[n] - literalSize[pos]);
        const refCost = measureRefCost(pos, prevWasRef, lastOffset, offset, length);
        const sizeAfter = literalSize[n] - literalSize[newTarget];
        const totalSize = sizeBefore + refCost + sizeAfter;

        // Prune before allocating
        while (edgeCount >= maxEdges) {
            if (!cleanWorstEdge(pos, source)) break;
        }

        const edge = {
            pos: pos, offset: offset, length: length,
            totalSize: totalSize, source: source, heapIdx: -1
        };
        putByOffset(edgesToPos[newTarget], edge);
    }

    // The "best" parse: initially all-literals
    let best = {
        pos: 0, offset: 0, length: 0,
        totalSize: literalSize[n], source: null, heapIdx: -1
    };

    // Main parse loop
    for (let pos = 1; pos <= n; pos++) {
        // Assimilate edges ending at this position
        const arriving = edgesToPos[pos];
        for (const [off, edge] of arriving) {
            if (edge.totalSize < best.totalSize) {
                best = edge;
            }
            heapRemove(edge);
            putByOffset(bestForOffset, edge);
        }
        arriving.clear();

        // Generate new reference edges from matches at this position
        if (pos < n) {
            const matches = findMatches(input, sa, rank, lcp, pos, params.matchPatience, params.maxSameLength);
            let maxMatchLength = 0;
            for (const m of matches) {
                const mlen = Math.min(m.length, n - pos);
                if (mlen > maxMatchLength) maxMatchLength = mlen;

                const minLen = mlen > params.skipLength ? mlen : 2;
                for (let len = minLen; len <= mlen; len++) {
                    // From the global best parse
                    newEdge(best, pos, m.offset, len);
                    // From the best edge with the same offset (repeated offset optimization)
                    if (best.offset !== m.offset) {
                        const byOff = bestForOffset.get(m.offset);
                        if (byOff && byOff.pos + byOff.length <= pos) {
                            newEdge(byOff, pos, m.offset, len);
                        }
                    }
                }
            }

            // Skip-ahead for very long matches
            if (maxMatchLength >= params.skipLength && edgesToPos[pos + maxMatchLength].size > 0) {
                rootEdges = [];
                for (const [, e] of bestForOffset) {
                    e.heapIdx = -1;
                    edgeCount--;
                }
                bestForOffset.clear();
                const targetPos = pos + maxMatchLength;
                let skipPos = pos + 1;
                while (skipPos < targetPos) {
                    const edges = edgesToPos[skipPos];
                    for (const [, e] of edges) {
                        e.heapIdx = -1;
                        edgeCount--;
                    }
                    edges.clear();
                    skipPos++;
                }
                best = { pos: 0, offset: 0, length: 0, totalSize: literalSize[n], source: null, heapIdx: -1 };
                pos = targetPos - 1; // loop will increment to targetPos
            }
        }
    }

    // Trace back from best to reconstruct operations
    const ops = [];
    let edge = best;
    while (edge && edge.length > 0) {
        ops.push({ type: 'ref', offset: edge.offset, length: edge.length, pos: edge.pos });
        edge = edge.source;
    }
    ops.reverse();

    // Now build the full operation list including literals between references
    const result = [];
    let cursor = 0;
    for (const op of ops) {
        // Emit literals from cursor to op.pos
        while (cursor < op.pos) {
            result.push({ type: 'lit', byte: input[cursor] });
            cursor++;
        }
        result.push({ type: 'ref', offset: op.offset, length: op.length });
        cursor += op.length;
    }
    // Remaining literals after last reference
    while (cursor < n) {
        result.push({ type: 'lit', byte: input[cursor] });
        cursor++;
    }
    return result;
}

// ===== Encoder with Counting =====

function encodeOpsWithCounting(input, ops, parityContext) {
    const enc = createRangeEncoder();
    const contexts = new Uint16Array(NUM_CONTEXTS);
    contexts.fill(INIT_PROB);
    const counting = createCountingCoder();

    let lastOffset = 0;
    let prevWasRef = false;
    let parity = 0;
    let opIdx = 0;

    function encBit(ctx, bit) {
        encoderCode(enc, contexts, ctx, bit);
        countingCode(counting, null, ctx, bit);
    }

    function encNumber(baseCtx, number) {
        let i = 0;
        while ((4 << i) <= number) {
            encBit(baseCtx + i * 2 + 2, 1);
            i++;
        }
        encBit(baseCtx + i * 2 + 2, 0);
        while (i >= 0) {
            encBit(baseCtx + i * 2 + 1, (number >>> i) & 1);
            i--;
        }
    }

    const baseCtxOff = NUM_SINGLE_CONTEXTS + CONTEXT_GROUP_OFFSET * CONTEXT_GROUP_SIZE;
    const baseCtxLen = NUM_SINGLE_CONTEXTS + CONTEXT_GROUP_LENGTH * CONTEXT_GROUP_SIZE;

    // First op must be literal, encoded without KIND bit
    if (ops.length > 0 && ops[0].type === 'lit') {
        const parityOff = parityContext ? ((parity & 1) * CONTEXT_GROUP_SIZE) : 0;
        let ctx = 1;
        for (let i = 7; i >= 0; i--) {
            const bit = (ops[0].byte >>> i) & 1;
            encBit(NUM_SINGLE_CONTEXTS + parityOff + ctx, bit);
            ctx = (ctx << 1) | bit;
        }
        parity++;
        opIdx = 1;
    }

    for (; opIdx < ops.length; opIdx++) {
        const op = ops[opIdx];
        const parityOff = parityContext ? ((parity & 1) * CONTEXT_GROUP_SIZE) : 0;

        if (op.type === 'lit') {
            encBit(NUM_SINGLE_CONTEXTS + parityOff + CONTEXT_KIND, 0);
            let ctx = 1;
            for (let i = 7; i >= 0; i--) {
                const bit = (op.byte >>> i) & 1;
                encBit(NUM_SINGLE_CONTEXTS + parityOff + ctx, bit);
                ctx = (ctx << 1) | bit;
            }
            parity++;
            prevWasRef = false;
        } else {
            encBit(NUM_SINGLE_CONTEXTS + parityOff + CONTEXT_KIND, 1);
            if (!prevWasRef) {
                const isRepeated = (op.offset === lastOffset && lastOffset > 0) ? 1 : 0;
                encBit(0, isRepeated);
                if (isRepeated) {
                    encNumber(baseCtxLen, op.length);
                    parity += op.length;
                    prevWasRef = true;
                    continue;
                }
            }
            encNumber(baseCtxOff, op.offset + 2);
            encNumber(baseCtxLen, op.length);
            lastOffset = op.offset;
            parity += op.length;
            prevWasRef = true;
        }
    }

    // EOF
    const parityOff = parityContext ? ((parity & 1) * CONTEXT_GROUP_SIZE) : 0;
    encBit(NUM_SINGLE_CONTEXTS + parityOff + CONTEXT_KIND, 1);
    if (!prevWasRef) encBit(0, 0);
    encNumber(baseCtxOff, 2);

    const result = encoderFinish(enc);
    return { data: result, counting };
}

// ===== Multi-Pass Compressor =====

function compressData(input, level, parityContext) {
    if (input.length === 0) {
        return new Uint8Array(0);
    }

    const params = getLevelParams(level);
    const { sa, rank, lcp } = buildSuffixArray(input);

    let countingCoder = null;
    let bestResult = null;
    let bestSize = Infinity;

    for (let iter = 0; iter < params.iterations; iter++) {
        const sizeMeasurer = createSizeMeasurer(countingCoder);
        const ops = optimalParse(input, sa, rank, lcp, sizeMeasurer, params, parityContext);
        const { data, counting } = encodeOpsWithCounting(input, ops, parityContext);

        if (data.length < bestSize) {
            bestSize = data.length;
            bestResult = data;
        }

        countingCoder = (countingCoder === null) ? counting : countingMix(countingCoder, counting);
    }

    return bestResult;
}

// ===== Level Presets =====

function getLevelParams(level) {
    level = Math.max(1, Math.min(9, level));
    return {
        iterations: level,
        lengthMargin: level,
        maxSameLength: level * 10,
        matchPatience: level * 100,
        skipLength: level * 1000,
        references: Math.round(50000 * Math.pow(2, (level - 1) / 2))
    };
}

// ===== Default Options =====

function defaultOptions() {
    return { parityContext: false };
}

// ===== Public API =====

function compress(data, level, options) {
    if (!(data instanceof Uint8Array)) throw new Error('Input must be Uint8Array');
    level = (level != null) ? level : 3;
    options = options || defaultOptions();
    return compressData(data, level, !!options.parityContext);
}

function decompress(data, options) {
    if (!(data instanceof Uint8Array)) throw new Error('Input must be Uint8Array');
    options = options || defaultOptions();
    return decompressData(data, !!options.parityContext);
}

function compressArray(data, level, options) {
    if (data instanceof Uint8Array) return compress(data, level, options);
    return compress(new Uint8Array(data), level, options);
}

function decompressArray(data, options) {
    if (data instanceof Uint8Array) return decompress(data, options);
    return decompress(new Uint8Array(data), options);
}

// ===== Module Exports =====

if (typeof window !== 'undefined') {
    window.Shrinkler = {
        compress,
        decompress,
        compressArray,
        decompressArray,
        defaultOptions
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        compress,
        decompress,
        compressArray,
        decompressArray,
        defaultOptions
    };
}
})();
