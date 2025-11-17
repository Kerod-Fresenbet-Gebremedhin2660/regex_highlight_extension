import type { RegexFlags } from './RegexHighlighter';

const HIGHLIGHT_COLORS = [
    '#ffecb3',
    '#c5e1a5',
    '#bbdefb',
    '#f8bbd0',
    '#d1c4e9',
    '#ffe0b2',
    '#b2dfdb',
    '#d7ccc8'
];

const escapeHtml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const buildFlagDescription = (flags: RegexFlags) => {
    const parts: string[] = [];
    if (flags.ignoreCase) parts.push('case-insensitive');
    if (flags.multiline) parts.push('multi-line');
    if (flags.dotAll) parts.push('dot matches newline');
    return parts.length ? ` (${parts.join(', ')})` : '';
};

// Split top-level alternation (outside groups and classes)
const splitAlternation = (input: string): string[] => {
    const parts: string[] = [];
    let buf = '';
    let depth = 0;
    let inClass = false;
    let escaped = false;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (escaped) {
            buf += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            buf += ch;
            escaped = true;
            continue;
        }
        if (!inClass && ch === '(') depth++;
        if (!inClass && ch === ')') depth = Math.max(0, depth - 1);
        if (ch === '[' && !inClass) inClass = true;
        else if (ch === ']' && inClass) inClass = false;
        if (ch === '|' && depth === 0 && !inClass) {
            parts.push(buf);
            buf = '';
        } else {
            buf += ch;
        }
    }
    parts.push(buf);
    return parts;
};

const tokenMap: Array<{ re: RegExp; desc: (m: RegExpMatchArray) => string }> = [
    { re: /^\\d$/, desc: () => 'a digit' },
    { re: /^\\D$/, desc: () => 'a non-digit' },
    { re: /^\\w$/, desc: () => 'a word character' },
    { re: /^\\W$/, desc: () => 'a non-word character' },
    { re: /^\\s$/, desc: () => 'a whitespace character' },
    { re: /^\\S$/, desc: () => 'a non-whitespace character' },
    { re: /^\.$/, desc: () => 'any character' },
    { re: /^\\b$/, desc: () => 'a word boundary' },
    { re: /^\\B$/, desc: () => 'a non-word boundary' }
];

const describeClass = (cls: string): string => {
    const negated = cls.startsWith('^');
    const body = negated ? cls.slice(1) : cls;
    const items: string[] = [];
    if (/[a-z]-[a-z]/.test(body)) items.push('lowercase letters');
    if (/[A-Z]-[A-Z]/.test(body)) items.push('uppercase letters');
    if (/[0-9]-[0-9]/.test(body)) items.push('digits');
    if (/\\s/.test(body)) items.push('whitespace');
    if (/\\w/.test(body)) items.push('word chars');
    if (/\\d/.test(body)) items.push('digits');
    if (/\\p\{[A-Za-z]+\}/.test(body)) items.push('Unicode classes');
    if (!items.length) items.push('listed characters');
    return negated ? `any character except ${items.join(' or ')}` : `any of ${items.join(' or ')}`;
};

const describeLookaround = (type: string, inner: string): string => {
    const core = describeSequence(inner);
    if (type === '?=') return `followed by (${core})`;
    if (type === '?!') return `not followed by (${core})`;
    if (type === '?<=') return `preceded by (${core})`;
    if (type === '?<!') return `not preceded by (${core})`;
    return `(${core})`;
};

const describeAtom = (atom: string, flags?: RegexFlags): string => {
    // Named group
    const named = atom.match(/^\(\?<([A-Za-z_][A-Za-z0-9_]*)>(.*)\)$/s);
    if (named) return `group '${named[1]}' of (${describeSequence(named[2])})`;
    // Lookaround
    const look = atom.match(/^\(\?([!:=]|<[=!])(.*)\)$/s);
    if (look) {
        const tag = look[1] === ':' ? '' : (look[1] as string);
        const inner = look[2];
        if (tag) {
            if (tag === '=' || tag === '!') return describeLookaround(`?${tag}`, inner);
            if (tag === '<=' || tag === '<!') return describeLookaround(`?${tag}`, inner);
        }
    }
    // Inline flags group (?i:...), (?-i:...)
    const inlineFlags = atom.match(/^\(\?([imsuSx\-]+):(.*)\)$/s);
    if (inlineFlags) {
        const inner = inlineFlags[2];
        return `(${describeSequence(inner)}) with inline flags`;
    }
    // Non-capturing group
    const noncap = atom.match(/^\(\?:([\s\S]*)\)$/);
    if (noncap) return describeSequence(noncap[1]);
    // Plain capturing group
    const group = atom.match(/^\(([\s\S]*)\)$/);
    if (group) return describeSequence(group[1]);
    // Character class
    const classMatch = atom.match(/^\[(.*)\]$/s);
    if (classMatch) return describeClass(classMatch[1]);
    // Backreference
    if (/^\\[1-9]\d*$/.test(atom)) return `same text as group ${atom.slice(1)}`;
    const namedBack = atom.match(/^\\k<([A-Za-z_][A-Za-z0-9_]*)>$/);
    if (namedBack) return `same text as group '${namedBack[1]}'`;
    // Escaped or single-char tokens
    for (const t of tokenMap) {
        if (t.re.test(atom)) return t.desc(['' as any] as any);
    }
    if (atom.length === 1) {
        if (atom === '^') return flags?.multiline ? 'start of a line' : 'start of input';
        if (atom === '$') return flags?.multiline ? 'end of a line' : 'end of input';
        return `'${atom}'`;
    }
    // Unicode class
    const uclass = atom.match(/^\\[pP]\{(.+)\}$/);
    if (uclass) return `a ${uclass[1]} character`;
    // Hex/unicode escape
    if (/^\\x[0-9A-Fa-f]{2}$/.test(atom)) return `character 0x${atom.slice(2)}`;
    if (/^\\u[0-9A-Fa-f]{4}$/.test(atom)) return `character U+${atom.slice(2)}`;
    if (/^\\u\{[0-9A-Fa-f]+\}$/.test(atom)) return `character U+${atom.slice(3, -1)}`;
    // Fallback literal
    const literal = atom.replace(/\\(.)/g, '$1');
    return `'${literal}'`;
};

const describeQuantified = (base: string, quant?: string): string => {
    const lazy = quant && /\?\s*$/.test(quant);
    const q = lazy ? quant.replace(/\?\s*$/, '') : quant;
    const baseDesc = describeAtom(base);
    const suffix = lazy ? ' (minimally)' : '';
    if (!q) return baseDesc;
    if (q === '*') return `${baseDesc} zero or more times${suffix}`;
    if (q === '+') return `${baseDesc} one or more times${suffix}`;
    if (q === '?') return `${baseDesc} zero or one time${suffix}`;
    const m = q.match(/^\{(\d+)(?:,(\d+)?)?\}$/);
    if (m) {
        const a = m[1];
        const b = m[2];
        if (b === undefined) return `${baseDesc} exactly ${a} times${suffix}`;
        if (b === '') return `${baseDesc} at least ${a} times${suffix}`;
        return `${baseDesc} between ${a} and ${b} times${suffix}`;
    }
    return `${baseDesc} ${q}${suffix}`;
};

export const describeSequence = (seq: string, flags?: RegexFlags): string => {
    const out: string[] = [];
    let i = 0;
    while (i < seq.length) {
        let ch = seq[i];
        if (ch === '\\') {
            const atom = seq.slice(i, i + 2);
            // Handle longer escapes like \xHH, \uHHHH, \u{...}
            let long = atom;
            const rest = seq.slice(i);
            const longMatch = rest.match(/^\\x[0-9A-Fa-f]{2}|^\\u[0-9A-Fa-f]{4}|^\\u\{[0-9A-Fa-f]+\}|^\\k<[A-Za-z_][A-Za-z0-9_]*>|^\\[1-9]\d*/);
            if (longMatch) {
                long = longMatch[0];
            }
            const nextIdx = i + long.length;
            const next = seq[nextIdx];
            if (next && /[\*\+\?\{]/.test(next)) {
                let quant = next;
                let j = nextIdx + 1;
                if (quant === '{') {
                    while (j < seq.length && seq[j] !== '}') j++;
                    if (seq[j] === '}') quant = seq.slice(nextIdx, j + 1);
                    else quant = '{';
                    if (seq[j + 1] === '?') quant += '?', j++;
                    i = j + 1;
                } else {
                    if (seq[j] === '?') quant += '?', j++;
                    i = j;
                }
                out.push(describeQuantified(long, quant));
            } else {
                out.push(describeQuantified(long));
                i = nextIdx;
            }
            continue;
        }
        if (ch === '[') {
            let j = i + 1, inEsc = false;
            while (j < seq.length) {
                const cj = seq[j];
                if (!inEsc && cj === '\\') { inEsc = true; j++; continue; }
                if (!inEsc && cj === ']') break;
                inEsc = false;
                j++;
            }
            const atom = seq.slice(i, Math.min(seq.length, j + 1));
            const next = seq[j + 1];
            if (next && /[\*\+\?\{]/.test(next)) {
                let quant = next;
                let k = j + 2;
                if (quant === '{') {
                    while (k < seq.length && seq[k] !== '}') k++;
                    if (seq[k] === '}') quant = seq.slice(j + 1, k + 1);
                    else quant = '{';
                    if (seq[k + 1] === '?') quant += '?', k++;
                    i = k + 1;
                } else {
                    if (seq[k] === '?') quant += '?', k++;
                    i = j + 2 + (quant.endsWith('?') ? 1 : 0);
                }
                out.push(describeQuantified(atom, quant));
            } else {
                out.push(describeQuantified(atom));
                i = j + 1;
            }
            continue;
        }
        if (ch === '(') {
            let j = i + 1, depth = 1, inEsc = false;
            while (j < seq.length && depth > 0) {
                const cj = seq[j];
                if (!inEsc && cj === '\\') { inEsc = true; j++; continue; }
                if (!inEsc && cj === '(') depth++;
                else if (!inEsc && cj === ')') depth--;
                inEsc = false;
                j++;
            }
            const atom = seq.slice(i, Math.min(seq.length, j));
            const next = seq[j];
            if (next && /[\*\+\?\{]/.test(next)) {
                let quant = next;
                let k = j + 1;
                if (quant === '{') {
                    while (k < seq.length && seq[k] !== '}') k++;
                    if (seq[k] === '}') quant = seq.slice(j, k + 1);
                    else quant = '{';
                    if (seq[k + 1] === '?') quant += '?', k++;
                    i = k + 1;
                } else {
                    if (seq[k] === '?') quant += '?', k++;
                    i = j + 1 + (quant.endsWith('?') ? 1 : 0);
                }
                out.push(describeQuantified(atom, quant));
            } else {
                out.push(describeQuantified(atom));
                i = j;
            }
            continue;
        }
        // Single char with optional quantifier
        let quant: string | undefined;
        const next = seq[i + 1];
        if (next && /[\*\+\?\{]/.test(next)) {
            if (next === '{') {
                let j = i + 2;
                while (j < seq.length && seq[j] !== '}') j++;
                if (seq[j] === '}') quant = seq.slice(i + 1, j + 1);
                else quant = '{';
                if (seq[j + 1] === '?') { quant += '?'; j++; }
                i = j + 1;
            } else {
                quant = next;
                if (seq[i + 2] === '?') { quant += '?'; i = i + 3; }
                else { i = i + 2; }
            }
        } else {
            i = i + 1;
        }
        out.push(describeQuantified(ch, quant));
    }
    // Merge adjacent literal tokens
    const merged: string[] = [];
    let literalRun: string[] = [];
    const flushRun = () => {
        if (literalRun.length === 0) return;
        const text = literalRun.map((t) => t.slice(1, -1)).join('');
        merged.push(text);
        literalRun = [];
    };
    for (const part of out) {
        const m = part.match(/^'(.*)'$/);
        if (m) {
            literalRun.push(part);
        } else {
            flushRun();
            merged.push(part);
        }
    }
    flushRun();
    return merged.join(', ');
};

export type RegexTranslation = {
    plain: string;
    html: string;
};

export const translateRegex = (pattern: string, flags: RegexFlags): RegexTranslation => {
    const trimmed = pattern.trim();
    if (!trimmed) {
        return { plain: '', html: '' };
    }
    try {
        const parts = splitAlternation(trimmed).filter(Boolean);
        let desc: string;
        let htmlDesc: string;
        let flagSuffix = buildFlagDescription(flags);
        if (parts.length > 1) {
            const alts = parts.map((p) => describeSequence(p, flags));
            const altHtml = alts
                .map((text, index) => {
                    const color = HIGHLIGHT_COLORS[index % HIGHLIGHT_COLORS.length];
                    return `<span style="background-color: ${color}; color: #000; padding: 0 3px; border-radius: 2px; font-weight: 600;">${escapeHtml(
                        text
                    )}</span>`;
                })
                .join(' or ');
            desc = `pattern searches for ${alts.join(' or ')}`;
            htmlDesc = `pattern searches for ${altHtml}`;
        } else {
            const body = trimmed.replace(/^\^/, '').replace(/\$$/, '');
            const anchors: string[] = [];
            if (trimmed.startsWith('^')) anchors.push(flags.multiline ? 'from the start of a line' : 'from the start');
            if (trimmed.endsWith('$')) anchors.push(flags.multiline ? 'to the end of a line' : 'to the end');
            const core = describeSequence(body, flags);
            desc = `pattern searches for ${core}`;
            if (anchors.length) desc += ` (${anchors.join(', ')})`;
            htmlDesc = escapeHtml(desc);
        }
        if (flagSuffix) {
            desc += flagSuffix;
            htmlDesc += escapeHtml(flagSuffix);
        }
        return { plain: desc, html: htmlDesc };
    } catch {
        const escaped = escapeHtml(trimmed);
        return { plain: trimmed, html: escaped };
    }
};

export default translateRegex;


