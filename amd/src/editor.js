// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Node/edge graph editor for the graph question type.
 *
 * Two entry points are exposed:
 * - initEditor: full editing widget used by the question edit form (teacher
 *   authoring - nothing is locked).
 * - initAttempt: attempt-page widget used by the renderer - the teacher's
 *   graph is hydrated locked (view + "add connected node" only), and
 *   whatever the student has already added is hydrated unlocked (fully
 *   editable by them). Only the student-added delta is written back into
 *   the response hidden field.
 *
 * @module     qtype_graph/editor
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
define(['core_form/changechecker'], function(FormChangeChecker) {

    const SVG_NS = 'http://www.w3.org/2000/svg';
    // Each entry is {bg, border} - border is optional: when omitted, the node
    // falls back to a CSS-computed darkened shade of bg (see .qtype_graph-node's
    // border rule in styles.css), which is enough for most colors. A handful
    // need a deliberately different (not just darker) border, so it's stored
    // explicitly here instead.
    const COLORS = [
        {bg: '#423475'},
        {bg: '#ff6b6b'},
        {bg: '#4ade80'},
        {bg: '#facc15'},
        {bg: '#c084fc'},
        {bg: '#38bdf8'},
        {bg: '#dddddd'},
        {bg: '#c94f5c', border: '#e68c11'},
        {bg: '#f0a33a', border: '#af3643'},
        {bg: '#61b89a'},
        {bg: '#5b95d1', border: '#2e6fa7'},
        {bg: '#69bd61', border: '#69bd61'},
        {bg: '#009ab6', border: '#016a7d'},
    ];
    const SHAPES = ['rounded', 'circle', 'rectangle', 'oval'];
    const DEFAULT_SHAPE = SHAPES[0];
    // Per-node text alignment (node menu's "Alineación del texto" section) -
    // centered matches .qtype_graph-node's own text-align default in styles.css.
    const TEXT_ALIGNS = ['left', 'center', 'right'];
    const DEFAULT_TEXT_ALIGN = 'center';
    const CLICK_THRESHOLD = 4;
    // Nodes can be 240px wide or more (.qtype_graph-node wraps phrases at 240px but
    // widens past it for a single long word) and grow tall
    // with wrapped/multi-blank content (e.g. a multi-blank label, or the
    // free-text/select input a student's own node renders), so these need real
    // margin beyond that or adjacent-level/sibling nodes can end up edge-to-edge
    // with no visible connecting line between them. TREE_LEVEL_MIN_PITCH is only
    // a floor - relayoutTree grows the actual per-level/per-sibling pitch from
    // real rendered node sizes so unusually tall/wide content can't overlap the
    // next level or a sibling regardless of how many nodes are on the tree.
    const TREE_LEVEL_MIN_PITCH = {vertical: 170, horizontal: 300};
    const TREE_LEVEL_GAP = 60;
    // Minimum gap between the edges of two adjacent sibling nodes. Sibling pitch
    // itself is computed per-layout from each node's actual rendered size (see
    // relayoutTree), since a fixed pitch can't accommodate content-driven node
    // widths once several siblings share a parent.
    const TREE_SIBLING_GAP = 70;
    const TREE_MARGIN = 80;
    // Gap between a level label and the nearest edge of that level's row
    // (vertical orientation) / column (horizontal orientation) - see
    // renderLevelLabels() below.
    const LEVEL_LABEL_GAP = 28;
    const ZOOM_MIN = 0.4;
    const ZOOM_MAX = 2;
    const ZOOM_STEP = 0.1;
    const DEFAULT_MAX_WORDS = 10;

    /**
     * Compute the SVG path + label position for an edge between two points.
     *
     * @param {number} x1
     * @param {number} y1
     * @param {number} x2
     * @param {number} y2
     * @param {string} lineStyle 'straight' or 'orthogonal'
     * @param {string} mode 'graph' or 'tree'
     * @param {string} orientation 'vertical' or 'horizontal'
     * @return {{d: string, lx: number, ly: number}}
     */
    function computeEdgeGeometry(x1, y1, x2, y2, lineStyle, mode, orientation) {
        if (lineStyle === 'straight') {
            return {d: `M ${x1} ${y1} L ${x2} ${y2}`, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2};
        }
        const useHorizontal = mode === 'tree' ? orientation === 'horizontal' : Math.abs(x2 - x1) >= Math.abs(y2 - y1);
        if (useHorizontal) {
            const midX = (x1 + x2) / 2;
            return {d: `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`, lx: midX, ly: (y1 + y2) / 2};
        }
        const midY = (y1 + y2) / 2;
        return {d: `M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`, lx: (x1 + x2) / 2, ly: midY};
    }

    // Matches the bare blank marker a locked node/edge label can contain in
    // attempt mode. Only ever parsed client-side on text the server already
    // sanitized (renderer.php runs blank_token.php::strip_answers() on
    // graphjson before it reaches the student's browser), so this only needs
    // to recognize the bare marker "Marcar como input" writes - not the
    // legacy {{T_INPUT;"a";"b"}} embedded-answer form blank_token.php strips
    // server-side. Must match classes/blank_token.php's SANITIZED_MARKER.
    const BLANK_TOKEN_RE = /\{\{T_INPUT\}\}/g;
    const BLANK_MARKER = '{{T_INPUT}}';

    // Numeric blank marker ("Marcar como input → Número") - a free-text blank whose
    // student value must be a number and is graded numerically (see
    // classes/answer_matcher.php's NUMERIC_MARKER/matches()). A separate marker,
    // not a variant of {{T_INPUT}}, so existing graphs keep grading unchanged.
    const NUMERIC_TOKEN_RE = /\{\{N_INPUT\}\}/g;
    const NUMERIC_BLANK_MARKER = '{{N_INPUT}}';

    // A number as typed by a student/teacher: '.' or ',' decimal separator,
    // optional sign/exponent. Must match classes/answer_matcher.php's NUMBER_PATTERN.
    const NUMBER_RE = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/;

    // Matches a [[option1;option2;...]] dropdown blank marker - "Marcar como
    // selector"'s counterpart to BLANK_TOKEN_RE/BLANK_MARKER above. Unlike
    // {{T_INPUT}}, this marker's content is not secret (it is the list of
    // choices, not the accepted answer) so blank_token.php never strips it -
    // must match classes/answer_matcher.php's SELECT_TOKEN_PATTERN.
    const SELECT_TOKEN_RE = /\[\[([^\]]*)\]\]/g;
    // Same pattern anchored to the WHOLE string (not global/capturing-in-a-loop) -
    // used by the node/edge menu to detect "this label IS a select blank" (the
    // convention "Marcar como selector" always creates), as opposed to
    // parseLabelSegments() below, which recognizes the marker anywhere in text.
    const WHOLE_SELECT_RE = /^\[\[([^\]]*)\]\]$/;

    // Result-graph answer-field grammar (see CLAUDE.md "Planned answer-field
    // grammar") - these describe what a *result* graph node/edge's text means
    // for a blank, as opposed to BLANK_TOKEN_RE/BLANK_MARKER above, which
    // describe the *default* graph's blank marker.
    // Matches a whole result-graph field that is a {{...}} multi-answer list - either the
    // original quoted-items form {{"a";"b"}} or the plainer unquoted form {{a;b}} (same
    // semicolon convention as a [[a;b]] select-options list). Must match
    // classes/answer_matcher.php's ANSWER_LIST_PATTERN; see splitAnswerList() below for
    // the actual per-item extraction.
    const ANSWER_LIST_RE = /^\{\{([\s\S]*)\}\}$/;
    const ANY_ANSWER_MARKER = '{{T_ANY}}';
    const ANY_OR_EMPTY_ANSWER_MARKER = '{{T_ANY_N_EMPTY}}';

    // Keyed by container id, populated by every createGraphEditor instance on
    // this page - lets one editor (the default graph) reach into another (the
    // result graph) by container id at click time, regardless of which was
    // created first.
    const editorRegistry = new Map();

    /**
     * Quick existence check for a fill-in-the-blank marker (free-text or select) in a label.
     *
     * @param {string} text
     * @return {boolean}
     */
    function hasBlankTokens(text) {
        if (typeof text !== 'string') {
            return false;
        }
        SELECT_TOKEN_RE.lastIndex = 0;
        return text.indexOf(BLANK_MARKER) !== -1 || text.indexOf(NUMERIC_BLANK_MARKER) !== -1 ||
                SELECT_TOKEN_RE.test(text);
    }

    /**
     * Is a default-graph label's (only graded, index-0) blank a numeric {{N_INPUT}} one?
     * Must match classes/answer_matcher.php's is_numeric_blank().
     *
     * @param {string} text
     * @return {boolean}
     */
    function isNumericBlank(text) {
        if (typeof text !== 'string') {
            return false;
        }
        const match = BLANK_SPAN_RE.exec(text);
        return !!match && match[0] === NUMERIC_BLANK_MARKER;
    }

    /**
     * Parse a typed number, accepting '.' or ',' as the decimal separator. Must match
     * classes/answer_matcher.php's parse_number().
     *
     * @param {string} value
     * @return {number|null} null if value is not a number.
     */
    function parseNumber(value) {
        const trimmed = typeof value === 'string' ? value.trim() : '';
        return NUMBER_RE.test(trimmed) ? parseFloat(trimmed.replace(',', '.')) : null;
    }

    /**
     * Is this one accepted numeric answer well-formed - "valor" or Cloze-style
     * "valor:tolerancia" (tolerance >= 0)? Must match classes/answer_matcher.php's
     * parse_numeric_answer().
     *
     * @param {string} answer
     * @return {boolean}
     */
    function isValidNumericAnswer(answer) {
        const parts = answer.split(':');
        if (parts.length > 2 || parseNumber(parts[0]) === null) {
            return false;
        }
        if (parts.length === 2) {
            const tolerance = parseNumber(parts[1]);
            return tolerance !== null && tolerance >= 0;
        }
        return true;
    }

    /**
     * Split a semicolon-separated options string into a trimmed, non-empty option
     * list. Semicolon (not comma) so an option's own text can itself contain a
     * comma without being split apart. A string with no semicolon at all is
     * treated as legacy comma-separated data (from before this was semicolon),
     * so already-authored newnodecontentvalue/newedgecontentvalue values and
     * [[...]] select-blank markers keep working without a DB migration.
     *
     * @param {string} optionsCsv
     * @return {Array}
     */
    function splitOptions(optionsCsv) {
        const raw = optionsCsv || '';
        const delimiter = raw.includes(';') ? ';' : ',';
        return raw.split(delimiter).map((opt) => opt.trim()).filter((opt) => opt !== '');
    }

    /**
     * Does this label consist of exactly one [[option1;option2;...]] marker (the
     * convention "Marcar como selector" always creates)? Used by the node/edge menu
     * to decide whether to show the options field instead of the plain text field -
     * not used by parseLabelSegments() below, which recognizes the marker anywhere
     * in a label, for parity with how a hand-typed {{T_INPUT}} is handled there.
     *
     * @param {string} text
     * @return {Array|null} the option list, or null if text is not exactly one select marker.
     */
    function parseWholeSelectOptions(text) {
        if (typeof text !== 'string') {
            return null;
        }
        const match = text.trim().match(WHOLE_SELECT_RE);
        return match ? splitOptions(match[1]) : null;
    }

    /**
     * Build a [[option1;option2;...]] marker from a semicolon-separated options
     * string, as typed into the node/edge menu's options field.
     *
     * @param {string} optionsCsv
     * @return {string}
     */
    function buildSelectMarker(optionsCsv) {
        return `[[${splitOptions(optionsCsv).join(';')}]]`;
    }

    // Matches the FULL span of the (only graded, see classes/grading.php's docblock)
    // index-0 blank marker in a default-graph label - used positionally by
    // stripDefaultContext() below. Must match classes/answer_matcher.php's
    // BLANK_SPAN_PATTERN.
    const BLANK_SPAN_RE = /\{\{T_INPUT\b[^}]*\}\}|\{\{N_INPUT\}\}|\[\[[^\]]*\]\]/;

    /**
     * JS mirror of classes/answer_matcher.php's strip_default_context() - see its
     * docblock. Strips the decorative prefix/suffix text around a default-graph
     * blank marker (e.g. "antes [[opt1;opt2]] despues") off the matching
     * result-graph field, wherever the result field actually carries that same
     * prefix/suffix verbatim, before it's parsed/checked as an accepted-answer
     * expression - the student's typed/picked value for the blank itself never
     * includes that surrounding text either (renderLabelSegments() only ever
     * feeds the input/select's own value into the response's `blanks` map).
     *
     * @param {string} defaultText the default-graph node/edge's raw text.
     * @param {string} resultText the matching result-graph node/edge's raw text.
     * @return {string} resultText with the default label's prefix/suffix stripped
     *      off, wherever present.
     */
    function stripDefaultContext(defaultText, resultText) {
        if (typeof defaultText !== 'string' || typeof resultText !== 'string') {
            return typeof resultText === 'string' ? resultText : '';
        }
        const match = BLANK_SPAN_RE.exec(defaultText);
        if (!match) {
            return resultText;
        }
        const prefix = defaultText.slice(0, match.index);
        const suffix = defaultText.slice(match.index + match[0].length);
        let stripped = resultText;
        if (prefix !== '' && stripped.startsWith(prefix)) {
            stripped = stripped.slice(prefix.length);
        }
        if (suffix !== '' && stripped.endsWith(suffix)) {
            stripped = stripped.slice(0, stripped.length - suffix.length);
        }
        return stripped;
    }

    /**
     * Split a node/edge label into alternating plain-text and blank segments - a
     * blank is a free-text {{T_INPUT}} marker, a numeric {{N_INPUT}} marker, or a
     * [[option1;option2;...]] dropdown marker.
     *
     * @param {string} text raw label text.
     * @return {Array} [{type:'text', value}, {type:'blank', index, kind:'text'|'number'|'select', options}, ...]
     */
    function parseLabelSegments(text) {
        const segments = [];
        if (typeof text !== 'string' || text === '') {
            return segments;
        }
        // BLANK_TOKEN_RE/SELECT_TOKEN_RE both need 'g' to scan repeatedly, but neither
        // can drive the loop alone since a label may contain either kind - merge their
        // matches into one combined, position-sorted pass instead of interleaving two
        // regex objects (which .lastIndex bookkeeping makes easy to get wrong).
        const matches = [];
        BLANK_TOKEN_RE.lastIndex = 0;
        let match;
        while ((match = BLANK_TOKEN_RE.exec(text)) !== null) {
            matches.push({index: match.index, length: match[0].length, kind: 'text', options: null});
        }
        NUMERIC_TOKEN_RE.lastIndex = 0;
        while ((match = NUMERIC_TOKEN_RE.exec(text)) !== null) {
            matches.push({index: match.index, length: match[0].length, kind: 'number', options: null});
        }
        SELECT_TOKEN_RE.lastIndex = 0;
        while ((match = SELECT_TOKEN_RE.exec(text)) !== null) {
            matches.push({index: match.index, length: match[0].length, kind: 'select', options: splitOptions(match[1])});
        }
        matches.sort((a, b) => a.index - b.index);

        let lastIndex = 0;
        let blankIndex = 0;
        matches.forEach((m) => {
            if (m.index < lastIndex) {
                // Overlapping match (shouldn't happen - the token grammars don't
                // share any characters - but skip defensively rather than corrupt output).
                return;
            }
            if (m.index > lastIndex) {
                segments.push({type: 'text', value: text.slice(lastIndex, m.index)});
            }
            segments.push({type: 'blank', index: blankIndex, kind: m.kind, options: m.options});
            blankIndex += 1;
            lastIndex = m.index + m.length;
        });
        if (lastIndex < text.length) {
            segments.push({type: 'text', value: text.slice(lastIndex)});
        }
        return segments;
    }

    /**
     * Render a label's segments (plain text + fillable inputs/selects) into a
     * container. Used identically for locked node text and locked edge labels
     * in attempt mode.
     *
     * @param {Element} container element to fill (its previous content is discarded).
     * @param {string} text raw label text.
     * @param {string} ownerKind 'node' or 'edge'.
     * @param {string} ownerId the node/edge's stable id.
     * @param {boolean} editableInputs whether the generated inputs should be editable.
     * @param {Function} [getBlankValue] (blankId) => initial value.
     * @param {Function} [onBlankChange] (blankId, value) => void, called on input/change.
     */
    /**
     * Auto-grows a free-text <input>'s width to fit its current value (or its
     * placeholder, while still empty), in ch units, instead of a one-size-fits-all
     * fixed width - a short answer no longer sits in a box padded out with empty
     * space, and a long one isn't clipped either. The input's own CSS class still
     * sets min-width: 45px as a floor this can never shrink below. Only for the
     * free-text blank/node inputs (.qtype_graph-blank-input,
     * .qtype_graph-node-text-input) - a <select> already sizes itself to its
     * widest option natively, with no help needed.
     *
     * @param {Element} input
     */
    function autosizeTextInput(input) {
        const content = input.value || input.placeholder || '';
        input.style.width = `${content.length + 1}ch`;
    }

    function renderLabelSegments(container, text, ownerKind, ownerId, editableInputs, getBlankValue, onBlankChange) {
        container.innerHTML = '';
        parseLabelSegments(text).forEach((seg) => {
            if (seg.type === 'text') {
                container.appendChild(document.createTextNode(seg.value));
                return;
            }
            const blankId = `${ownerKind}:${ownerId}:${seg.index}`;
            if (seg.kind === 'select') {
                const select = document.createElement('select');
                select.className = 'qtype_graph-blank-select';
                select.dataset.blankId = blankId;
                select.disabled = !editableInputs;
                const currentValue = (getBlankValue && getBlankValue(blankId)) || '';
                const placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.textContent = '—';
                select.appendChild(placeholder);
                seg.options.forEach((opt) => {
                    const optionEl = document.createElement('option');
                    optionEl.value = opt;
                    optionEl.textContent = opt;
                    select.appendChild(optionEl);
                });
                select.value = seg.options.includes(currentValue) ? currentValue : '';
                select.addEventListener('mousedown', (e) => e.stopPropagation());
                select.addEventListener('click', (e) => e.stopPropagation());
                select.addEventListener('change', () => {
                    if (onBlankChange) {
                        onBlankChange(blankId, select.value);
                    }
                });
                container.appendChild(select);
                return;
            }
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'qtype_graph-blank-input';
            input.dataset.blankId = blankId;
            input.readOnly = !editableInputs;
            input.value = (getBlankValue && getBlankValue(blankId)) || '';
            // A numeric blank stays a text input (not type="number", which would reject
            // a ',' decimal separator and hide what was typed) - just flagged when its
            // value is not a number. Non-numbers are still saved; grading marks them wrong.
            const numeric = seg.kind === 'number';
            const checkNumeric = () => {
                const invalid = input.value.trim() !== '' && parseNumber(input.value) === null;
                input.classList.toggle('qtype_graph-blank-input--invalid', invalid);
                input.title = invalid ? 'Ingresa un número' : '';
            };
            if (numeric) {
                input.inputMode = 'decimal';
                input.classList.add('qtype_graph-blank-input--numeric');
                checkNumeric();
            }
            autosizeTextInput(input);
            input.addEventListener('mousedown', (e) => e.stopPropagation());
            input.addEventListener('click', (e) => e.stopPropagation());
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                }
            });
            input.addEventListener('input', () => {
                autosizeTextInput(input);
                if (numeric) {
                    checkNumeric();
                }
                if (onBlankChange) {
                    onBlankChange(blankId, input.value);
                }
            });
            container.appendChild(input);
        });
    }

    /**
     * Split a {{...}}-wrapped answer list's inner content into individual accepted
     * answers, on ';' - each item may optionally be wrapped in double quotes (stripped
     * here), for backward compatibility with the original {{"a";"b"}} authoring
     * convention; an item can just as well be left bare, e.g. {{a;b}}. A blank item
     * (stray/trailing semicolon, or "") is dropped rather than treated as "empty answer
     * accepted" - {{T_ANY_N_EMPTY}} already exists for that. Must match
     * classes/answer_matcher.php's split_answer_list().
     *
     * @param {string} inner the content between the outer {{ and }}.
     * @return {Array}
     */
    function splitAnswerList(inner) {
        return inner.split(';')
                .map((item) => item.trim())
                .map((item) => (item.length >= 2 && item[0] === '"' && item[item.length - 1] === '"') ?
                        item.slice(1, -1) : item)
                .filter((item) => item !== '');
    }

    /**
     * Parse a result-graph node/edge's text into the answer-field grammar
     * documented in CLAUDE.md: empty means "not authored yet", {{T_ANY}} /
     * {{T_ANY_N_EMPTY}} are the wildcard markers, {{a;b}} (items optionally
     * quoted) is a list of accepted answers, and any other text is a single
     * accepted answer.
     *
     * Used by checkAnswerField() (authoring-time validation) below.
     *
     * @param {string} text raw result-graph field text.
     * @return {{type: string, answers: Array}} type is one of 'unset', 'any',
     *         'any_or_empty', 'exact'; answers is only populated for 'exact'.
     */
    function parseAcceptedAnswers(text) {
        const trimmed = typeof text === 'string' ? text.trim() : '';
        if (trimmed === '') {
            return {type: 'unset', answers: []};
        }
        if (trimmed === ANY_ANSWER_MARKER) {
            return {type: 'any', answers: []};
        }
        if (trimmed === ANY_OR_EMPTY_ANSWER_MARKER) {
            return {type: 'any_or_empty', answers: []};
        }
        const listMatch = trimmed.match(ANSWER_LIST_RE);
        if (listMatch) {
            return {type: 'exact', answers: splitAnswerList(listMatch[1])};
        }
        return {type: 'exact', answers: [trimmed]};
    }

    /**
     * Normalize a value for answer comparison: trim whitespace, lowercase.
     *
     * Not called anywhere yet - a building block for the future grading pass.
     *
     * @param {string} value
     * @return {string}
     */
    function normalize(value) {
        return typeof value === 'string' ? value.trim().toLowerCase() : '';
    }

    // XML namespace for the plain HTML wrapper a graph snapshot's foreignObject
    // holds - see buildGraphSvgMarkup() below. SVG_NS (declared at the top of this
    // module) is reused for the SVG side of that same markup.
    const XHTML_NS = 'http://www.w3.org/1999/xhtml';

    /**
     * Resolves every element's live computed style onto its clone, in document
     * order, so a detached clone (e.g. inside an SVG <foreignObject>, which can't
     * apply this page's own stylesheet) still renders identically to the live
     * element - including CSS custom properties (--qtype-graph-*), which
     * getComputedStyle() resolves to their concrete values same as everything
     * else.
     *
     * @param {Element} sourceRoot
     * @param {Element} cloneRoot
     */
    function inlineComputedStyles(sourceRoot, cloneRoot) {
        const sourceEls = [sourceRoot, ...sourceRoot.querySelectorAll('*')];
        const cloneEls = [cloneRoot, ...cloneRoot.querySelectorAll('*')];
        sourceEls.forEach((sourceEl, i) => {
            const computed = window.getComputedStyle(sourceEl);
            let cssText = '';
            for (let j = 0; j < computed.length; j++) {
                const prop = computed[j];
                cssText += `${prop}:${computed.getPropertyValue(prop)};`;
            }
            cloneEls[i].setAttribute('style', cssText);
        });
    }

    /**
     * Every font family (lowercased, unquoted) that any element under root is
     * actually rendered with, per its computed font-family list.
     *
     * @param {Element} root
     * @return {Set<string>}
     */
    function collectUsedFontFamilies(root) {
        const families = new Set();
        [root, ...root.querySelectorAll('*')].forEach((el) => {
            window.getComputedStyle(el).fontFamily.split(',').forEach((family) => {
                families.add(family.trim().replace(/^["']|["']$/g, '').toLowerCase());
            });
        });
        return families;
    }

    /**
     * @param {Blob} blob
     * @return {Promise<string>} the blob as a data: URL.
     */
    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    // Cache for buildEmbeddedFontCss(), keyed by the sorted used-family list -
    // the page's @font-face rules never change after load, so each font file is
    // fetched and base64-encoded at most once per page, not on every export.
    const embeddedFontCssCache = new Map();

    /**
     * Self-contained @font-face CSS (every url() inlined as a data: URL) for
     * each web font the canvas actually uses. An SVG rendered as an image (the
     * PNG path draws it through an <img>, and a downloaded .svg is opened the
     * same way) can't load any external resource, so without this every web
     * font silently falls back to a system font - e.g. the Stream theme's
     * `* {font-family: 'Nunito', Verdana, ...}` rule exports as Verdana, whose
     * wider glyphs no longer fit the node widths inlineComputedStyles() froze
     * from the live (Nunito) layout: text re-wraps differently and overflowing
     * lines lose their centering.
     *
     * Best effort: a cross-origin stylesheet (cssRules throws) or a font that
     * fails to fetch is skipped, leaving that family to fall back as before.
     *
     * @param {Element} canvasEl the .qtype_graph-canvas element.
     * @return {Promise<string>} CSS text, '' if no web font is used.
     */
    function buildEmbeddedFontCss(canvasEl) {
        const families = collectUsedFontFamilies(canvasEl);
        const cacheKey = [...families].sort().join('|');
        if (embeddedFontCssCache.has(cacheKey)) {
            return embeddedFontCssCache.get(cacheKey);
        }
        const faces = [];
        [...document.styleSheets].forEach((sheet) => {
            let rules;
            try {
                rules = sheet.cssRules;
            } catch (e) {
                return;
            }
            [...(rules || [])].forEach((rule) => {
                if (!(rule instanceof CSSFontFaceRule)) {
                    return;
                }
                const family = rule.style.getPropertyValue('font-family').trim()
                        .replace(/^["']|["']$/g, '').toLowerCase();
                if (families.has(family)) {
                    faces.push({cssText: rule.cssText, base: sheet.href || document.baseURI});
                }
            });
        });
        const promise = Promise.all(faces.map((face) => {
            const urls = [...face.cssText.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)];
            return Promise.all(urls.map((match) => {
                if (match[2].startsWith('data:')) {
                    return Promise.resolve([match[0], match[0]]);
                }
                return fetch(new URL(match[2], face.base).href, {credentials: 'same-origin'})
                    .then((response) => {
                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}`);
                        }
                        return response.blob();
                    })
                    .then(blobToDataUrl)
                    .then((dataUrl) => [match[0], `url("${dataUrl}")`]);
            })).then((replacements) => replacements.reduce(
                    (css, [from, to]) => css.split(from).join(to), face.cssText), () => '');
        })).then((cssParts) => cssParts.filter(Boolean).join('\n'));
        embeddedFontCssCache.set(cacheKey, promise);
        return promise;
    }

    /**
     * Swaps every form control in a detached clone for a plain <span> showing
     * the live control's current value - a student's typed answer in a
     * free-text blank, or the chosen option's label in a select blank.
     *
     * Setting the clone's .value isn't enough: that's a live JS property, not
     * an attribute, and XMLSerializer (buildGraphSvgMarkup()) only serializes
     * attributes, so the exported image showed every blank empty. Plain text is
     * also more reliable than hoping a form control renders inside an SVG image
     * at all. The span keeps the control's own inlined computed style (border,
     * padding, width, colors - see inlineComputedStyles(), which must run
     * first), so it still reads as a filled-in blank. Both trees have identical
     * structure right after cloning, so matching controls positionally is safe.
     *
     * @param {Element} sourceRoot
     * @param {Element} cloneRoot
     */
    function replaceFormControlsWithText(sourceRoot, cloneRoot) {
        const sourceControls = sourceRoot.querySelectorAll('input, select, textarea');
        const cloneControls = cloneRoot.querySelectorAll('input, select, textarea');
        sourceControls.forEach((sourceControl, i) => {
            const cloneControl = cloneControls[i];
            let text = sourceControl.value;
            let isPlaceholder = false;
            if (sourceControl.tagName === 'SELECT') {
                const option = sourceControl.options[sourceControl.selectedIndex];
                text = option ? option.textContent : '';
            } else if (!text && sourceControl.placeholder) {
                text = sourceControl.placeholder;
                isPlaceholder = true;
            }
            const span = document.createElementNS(XHTML_NS, 'span');
            span.setAttribute('style', cloneControl.getAttribute('style') || '');
            span.className = cloneControl.className;
            const computed = window.getComputedStyle(sourceControl);
            if (computed.display !== 'none') {
                // Inputs center their single line vertically on their own; a span
                // needs flex for that, and justify-content to honour text-align.
                span.style.display = 'inline-flex';
                span.style.alignItems = 'center';
                span.style.justifyContent = {
                    left: 'flex-start', start: 'flex-start', right: 'flex-end', end: 'flex-end',
                }[computed.textAlign] || 'center';
            }
            span.style.whiteSpace = 'pre';
            span.style.overflow = 'hidden';
            span.style.verticalAlign = 'middle';
            if (isPlaceholder) {
                span.style.opacity = '0.55';
            }
            span.textContent = text;
            cloneControl.replaceWith(span);
        });
    }

    /**
     * How much of the graph's own untransformed (zoom 1, pan 0) coordinate space
     * a canvas's current CSS transform represents - lets computeGraphContentBounds()
     * below convert each element's on-screen rect back to that fixed space,
     * regardless of whatever zoom/pan the user has left the live view at.
     *
     * @param {Element} contentEl the .qtype_graph-content element.
     * @return {{zoom: number, panX: number, panY: number}}
     */
    function readContentTransform(contentEl) {
        const transform = window.getComputedStyle(contentEl).transform;
        // Only ever translate()+scale() (see setZoom()/panning in createGraphEditor) -
        // never rotation or skew - so a 2D matrix(a, b, c, d, e, f) always has a === d
        // (uniform zoom) and b === c === 0; 'none' (identity) happens before the first
        // pan/zoom interaction.
        const match = /^matrix\(([^,]+),[^,]+,[^,]+,[^,]+,([^,]+),([^)]+)\)$/.exec(transform || '');
        if (!match) {
            return {zoom: 1, panX: 0, panY: 0};
        }
        return {
            zoom: parseFloat(match[1]) || 1,
            panX: parseFloat(match[2]) || 0,
            panY: parseFloat(match[3]) || 0,
        };
    }

    /**
     * Union of every node/edge/label's rendered extent, in the canvas's own
     * untransformed coordinate space - i.e. what the graph's full bounding box is
     * at zoom 1, pan 0, independent of whether some of it is currently
     * scrolled/zoomed out of the visible canvas viewport. Nodes/floating
     * labels/level labels are plain positioned HTML, read via
     * getBoundingClientRect() (accurate even while clipped by the live canvas's
     * overflow:hidden, since that only affects paint, not layout) and converted
     * back through readContentTransform()'s pan/zoom; each edge's <g> (path +
     * label) is read via SVG getBBox() instead, which is already in that same
     * untransformed space with no conversion needed - see createEdge() above.
     *
     * @param {Element} canvasEl the .qtype_graph-canvas element.
     * @param {Element} contentEl its .qtype_graph-content child.
     * @return {{left: number, top: number, width: number, height: number}}
     */
    function computeGraphContentBounds(canvasEl, contentEl, includeHiddenLevelLabels) {
        const canvasRect = canvasEl.getBoundingClientRect();
        const t = readContentTransform(contentEl);
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        const includeRect = (left, top, width, height) => {
            if (width <= 0 && height <= 0) {
                return;
            }
            minX = Math.min(minX, left);
            minY = Math.min(minY, top);
            maxX = Math.max(maxX, left + width);
            maxY = Math.max(maxY, top + height);
        };

        contentEl.querySelectorAll('.qtype_graph-node, .qtype_graph-floatinglabel, .qtype_graph-levellabel')
                .forEach((el) => {
                    if (!includeHiddenLevelLabels && el.classList.contains('qtype_graph-levellabel--hidden')) {
                        return;
                    }
                    const r = el.getBoundingClientRect();
                    // Mid tree-relayout animation a node's (and its floating label's)
                    // on-screen rect lags behind its target position - shift it by
                    // that lag so the bounds match what buildGraphSvgMarkup() exports.
                    const node = el.closest('.qtype_graph-node');
                    const lagX = node ? (parseFloat(node.style.left) || 0) - node.offsetLeft : 0;
                    const lagY = node ? (parseFloat(node.style.top) || 0) - node.offsetTop : 0;
                    includeRect((r.left - canvasRect.left - t.panX) / t.zoom + lagX,
                            (r.top - canvasRect.top - t.panY) / t.zoom + lagY,
                            r.width / t.zoom, r.height / t.zoom);
                });

        contentEl.querySelectorAll('[data-role="edges"] > g').forEach((g) => {
            const bbox = g.getBBox();
            includeRect(bbox.x, bbox.y, bbox.width, bbox.height);
        });

        if (!isFinite(minX)) {
            // Nothing on the canvas yet - fall back to whatever the viewport itself shows.
            return {left: 0, top: 0, width: Math.max(1, canvasRect.width), height: Math.max(1, canvasRect.height)};
        }
        return {left: minX, top: minY, width: maxX - minX, height: maxY - minY};
    }

    /**
     * Builds a standalone SVG snapshot of one graph canvas's current content -
     * the WHOLE graph (see computeGraphContentBounds() above), never just what's
     * visible in the viewport at the current pan/zoom, and never any UI chrome
     * (menus, the JSON/image panels) - the editing grid and background color are
     * each stripped or kept per options (see below). Shared by both export
     * formats: the SVG path downloads this markup as-is, the PNG path
     * additionally draws it onto a real <canvas> to rasterize - see
     * exportCanvasAsSvg()/exportCanvasAsPng() below.
     *
     * Works by cloning the canvas DOM and resolving every element's live
     * computed style onto its clone, since a <foreignObject> can't apply this
     * page's own stylesheet, then wrapping the clone in an SVG <foreignObject>
     * and serializing with XMLSerializer (unlike string-concatenated outerHTML,
     * it self-closes void elements like <input> so the SVG stays valid XML).
     *
     * @param {Element} canvasEl the .qtype_graph-canvas element.
     * @param {Element} contentEl its .qtype_graph-content child.
     * @param {Object} [options]
     * @param {boolean} [options.includeBackground] false makes the canvas's own
     *                  background color transparent instead (still doesn't affect
     *                  the grid - see includeGrid). Defaults to true.
     * @param {boolean} [options.includeGrid] true keeps the editing grid pattern
     *                  in the export instead of stripping it. Defaults to false.
     * @param {boolean} [options.includeHiddenLevelLabels] true also exports level
     *                  labels the teacher switched off ("Mostrar" unchecked), which
     *                  the owner canvas still draws faded so they stay clickable
     *                  (.qtype_graph-levellabel--hidden) - exported at full opacity,
     *                  like a shown label. Defaults to false: left out entirely.
     * @param {string} [fontCss] @font-face CSS to embed - see buildEmbeddedFontCss().
     * @return {{markup: string, width: number, height: number}}
     */
    function buildGraphSvgMarkup(canvasEl, contentEl, options, fontCss) {
        const includeBackground = !options || options.includeBackground !== false;
        const includeGrid = !!(options && options.includeGrid);
        const includeHiddenLevelLabels = !!(options && options.includeHiddenLevelLabels);
        const PADDING = 40;
        const bounds = computeGraphContentBounds(canvasEl, contentEl, includeHiddenLevelLabels);
        const width = Math.max(1, Math.round(bounds.width + PADDING * 2));
        const height = Math.max(1, Math.round(bounds.height + PADDING * 2));

        const clone = canvasEl.cloneNode(true);
        inlineComputedStyles(canvasEl, clone);
        replaceFormControlsWithText(canvasEl, clone);
        clone.style.transition = 'none';
        // The editing grid and the canvas's own background color are each only
        // exported when their matching image-panel checkbox (see editor_ui.php) is
        // on - both default to what "just the graph" means: no grid, but the
        // background kept (a fully transparent PNG is the opt-in, not the default).
        if (!includeGrid) {
            clone.style.backgroundImage = 'none';
        }
        if (!includeBackground) {
            clone.style.backgroundColor = 'transparent';
        }
        // Chrome that lives inside .qtype_graph-canvas alongside the graph itself
        // (see editor_ui.php) but has no place in a snapshot of it - stripped
        // outright rather than relied upon to already be hidden (e.g. a menu the
        // teacher happened to leave open).
        clone.querySelectorAll(
                '[data-role="json-panel"], [data-role="image-panel"], [data-role="canvas-settings-panel"], ' +
                '[data-role="node-menu"], [data-role="levellabel-menu"], ' +
                '[data-role="floatinglabel-menu"], [data-role="edge-menu"]'
        ).forEach((el) => el.remove());
        clone.querySelectorAll('.qtype_graph-levellabel--hidden').forEach((el) => {
            if (includeHiddenLevelLabels) {
                el.style.opacity = '1';
            } else {
                el.remove();
            }
        });
        // Override the baked-in (live) viewport size/clipping and pan/zoom transform
        // that inlineComputedStyles() just copied, so the clone renders the full
        // bounds computed above instead of reproducing the live view's crop.
        clone.style.overflow = 'visible';
        clone.style.width = `${width}px`;
        clone.style.height = `${height}px`;
        // A tree relayout animates each node's left/top (see .qtype_graph-node's
        // transition in styles.css) while edges jump straight to their final
        // geometry, so an export taken mid-animation would freeze nodes at their
        // computed, still-moving positions, detached from their edges. Use each
        // node's target (inline) position instead - the one the edges already use.
        const liveNodes = contentEl.querySelectorAll('.qtype_graph-node');
        // The inlined computed style also carries the logical inset-* longhands
        // (same mid-animation values), declared after left/top, so they would
        // still win unless removed.
        clone.querySelectorAll('.qtype_graph-node').forEach((node, i) => {
            node.style.transition = 'none';
            ['inset-inline-start', 'inset-inline-end', 'inset-block-start', 'inset-block-end', 'right', 'bottom']
                    .forEach((prop) => node.style.removeProperty(prop));
            node.style.left = liveNodes[i].style.left;
            node.style.top = liveNodes[i].style.top;
        });
        const cloneContent = clone.querySelector('[data-role="content"]');
        if (cloneContent) {
            cloneContent.style.transition = 'none';
            cloneContent.style.transform = `translate(${PADDING - bounds.left}px, ${PADDING - bounds.top}px) scale(1)`;
        }

        const wrapper = document.createElementNS(XHTML_NS, 'div');
        wrapper.setAttribute('style', `width:${width}px;height:${height}px;overflow:hidden;`);
        wrapper.appendChild(clone);

        const svgRoot = document.createElementNS(SVG_NS, 'svg');
        svgRoot.setAttribute('xmlns', SVG_NS);
        svgRoot.setAttribute('width', String(width));
        svgRoot.setAttribute('height', String(height));
        if (fontCss) {
            const style = document.createElementNS(SVG_NS, 'style');
            style.textContent = fontCss;
            svgRoot.appendChild(style);
        }
        const foreignObject = document.createElementNS(SVG_NS, 'foreignObject');
        foreignObject.setAttribute('width', '100%');
        foreignObject.setAttribute('height', '100%');
        foreignObject.appendChild(wrapper);
        svgRoot.appendChild(foreignObject);

        return {markup: new XMLSerializer().serializeToString(svgRoot), width, height};
    }

    /**
     * Triggers a browser download of a Blob.
     *
     * @param {Blob} blob
     * @param {string} filename
     */
    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Downloads a PNG snapshot of one graph canvas - see buildGraphSvgMarkup().
     * The SVG is rasterized at devicePixelRatio so the download is crisp on
     * HiDPI screens, not just a 1:1 copy of CSS pixels.
     *
     * @param {Element} canvasEl the .qtype_graph-canvas element.
     * @param {Element} contentEl its .qtype_graph-content child.
     * @param {Object} [options] see buildGraphSvgMarkup().
     * @return {Promise}
     */
    function exportCanvasAsPng(canvasEl, contentEl, options) {
        return buildEmbeddedFontCss(canvasEl).then((fontCss) => new Promise((resolve, reject) => {
            const svg = buildGraphSvgMarkup(canvasEl, contentEl, options, fontCss);
            const svgUrl = URL.createObjectURL(new Blob([svg.markup], {type: 'image/svg+xml;charset=utf-8'}));
            const img = new Image();
            img.onload = () => {
                const scale = window.devicePixelRatio || 1;
                const outCanvas = document.createElement('canvas');
                outCanvas.width = Math.round(svg.width * scale);
                outCanvas.height = Math.round(svg.height * scale);
                const ctx = outCanvas.getContext('2d');
                ctx.scale(scale, scale);
                ctx.drawImage(img, 0, 0, svg.width, svg.height);
                URL.revokeObjectURL(svgUrl);
                outCanvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('No se pudo generar el PNG.'));
                        return;
                    }
                    downloadBlob(blob, 'grafo.png');
                    resolve();
                }, 'image/png');
            };
            img.onerror = () => {
                URL.revokeObjectURL(svgUrl);
                reject(new Error('No se pudo generar la imagen intermedia del lienzo.'));
            };
            img.src = svgUrl;
        }));
    }

    /**
     * Downloads an SVG snapshot of one graph canvas - see buildGraphSvgMarkup().
     *
     * @param {Element} canvasEl the .qtype_graph-canvas element.
     * @param {Element} contentEl its .qtype_graph-content child.
     * @param {Object} [options] see buildGraphSvgMarkup().
     * @return {Promise}
     */
    function exportCanvasAsSvg(canvasEl, contentEl, options) {
        return buildEmbeddedFontCss(canvasEl).then((fontCss) => {
            const svg = buildGraphSvgMarkup(canvasEl, contentEl, options, fontCss);
            downloadBlob(new Blob([svg.markup], {type: 'image/svg+xml;charset=utf-8'}), 'grafo.svg');
            return svg;
        });
    }

    /**
     * Create one graph editor instance bound to a container element.
     *
     * @param {Element} root the .qtype_graph-container element.
     * @param {Object} opts {editable: bool, lockLayout: bool, hideLayoutControls: bool, allowAddNodes: bool,
     *                       allowDeleteNodes: bool, onChange: function(serializedState)}
     * @return {Object} {hydrate, serialize}
     */
    function createGraphEditor(root, opts) {
        const editable = !!opts.editable;
        const lockLayout = !!opts.lockLayout;
        const hideLayoutControls = !!opts.hideLayoutControls;
        // The one EDITOR-mode canvas that owns this question's shared style
        // settings (the default graph's initEditor() call; never the result
        // graph or an alternate, both of which already set hideLayoutControls
        // for the same "mirrors the default, doesn't own its own" reason - and
        // never an attempt-mode canvas, which is always styled from the DB via
        // renderer.php's data-* attributes, never from embedded JSON or its own
        // gear panel) - gates the canvas gear button/panel below, and whether
        // hydrate()/serialize() read or write showGrid/bgColor/gridColor at all.
        // True on the standalone helper page too (its single canvas has no
        // sibling to mirror), even though that page has no form to persist the
        // choice into - see canvasSettingsFieldIds below.
        const isCanvasSettingsOwner = opts.mode === 'editor' && !hideLayoutControls;
        // {showGrid, bgColor, gridColor} mform hidden-field ids (see
        // edit_graph_form.php) - only ever passed by the Moodle edit form, never
        // the standalone helper page (index.html's own initEditor() call has no
        // form to write into). The gear panel still shows and live-restyles every
        // canvas via editorRegistry either way (isCanvasSettingsOwner above); this
        // only gates the extra step of also writing the resolved value into a
        // hidden field so it round-trips through a real save.
        const canvasSettingsFieldIds = (isCanvasSettingsOwner && opts.canvasSettingsFieldIds) || null;
        // Assigned inside the isCanvasSettingsOwner block below (see there for why
        // it isn't just a local const) - applies the gear panel's current
        // showgrid/bgcolor/gridcolor controls AND persists them (hidden mform
        // fields + form-dirty), unlike setCanvasStyle() alone. null everywhere
        // else, where the panel doesn't exist. hydrate() below and the "Construir
        // grafo" button both need to call this from outside that block.
        let applyCanvasSettings = null;
        // Same reasoning as applyCanvasSettings above, but for level-label
        // overrides - persists levelLabelOverrides (mutated directly by clicking a
        // label on the canvas, see openLevelLabelMenu() below) into the hidden
        // levellabelsjson mform field and broadcasts it to editorRegistry.
        let applyLevelLabelOverrides = null;
        const allowAddNodes = opts.allowAddNodes !== false;
        const allowDeleteNodes = opts.allowDeleteNodes !== false;
        const onChange = opts.onChange || function() {};
        const attemptMode = opts.mode === 'attempt';
        // Teacher-authored canvases (mode: 'editor') always keep full control over
        // layout - these three only ever restrict the STUDENT attempt canvas, gated
        // on qtype_graph_options.allowchangegraphtype/allowchangeorientation/
        // allowchangelinestyle (off by default - see edit_graph_form.php), and hide
        // the matching toolbar button outright rather than merely disabling it
        // (setMode()/the hideLayoutControls block below).
        const allowChangeGraphType = !attemptMode || !!opts.allowChangeGraphType;
        const allowChangeOrientation = !attemptMode || !!opts.allowChangeOrientation;
        const allowChangeLineStyle = !attemptMode || !!opts.allowChangeLineStyle;
        const enableAddInput = !!opts.enableAddInput;
        const addInputTargetContainerId = opts.addInputTargetContainerId || null;
        // What a STUDENT's own new node/connection looks like (attempt mode only) -
        // 'input' (today's free-text box, value used as its placeholder), 'select'
        // (a dropdown built from value's semicolon-separated options), or 'text' (fixed,
        // non-editable content equal to value). See createNode()'s attempt-mode
        // branch and openEdgeMenu() below. Unrelated to enableAddInput/
        // addInputTargetContainerId above, which govern the teacher-authoring
        // {{T_INPUT}}/[[...]] blank markers on the DEFAULT graph, not this.
        const newNodeContentType = opts.newNodeContentType || 'input';
        const newNodeContentValue = opts.newNodeContentValue || '';
        const newEdgeContentType = opts.newEdgeContentType || 'input';
        const newEdgeContentValue = opts.newEdgeContentValue || '';

        const canvas = root.querySelector('[data-role="canvas"]');
        const graphContent = root.querySelector('[data-role="content"]');
        const edgesLayer = root.querySelector('[data-role="edges"]');
        const menu = root.querySelector('[data-role="node-menu"]');
        const nodeTextSection = root.querySelector('[data-role="node-text-section"]');
        const nodeSelectSection = root.querySelector('[data-role="node-select-section"]');
        const nodeSelectInput = root.querySelector('[data-role="node-select-input"]');
        const nodeColorSection = root.querySelector('[data-role="node-color-section"]');
        const nodeTextColorSection = root.querySelector('[data-role="node-textcolor-section"]');
        const nodeTextColorInput = root.querySelector('[data-role="node-textcolor-input"]');
        const nodeTextColorPicker = root.querySelector('[data-role="node-textcolor-picker"]');
        const nodeShapeSection = root.querySelector('[data-role="node-shape-section"]');
        const nodeTextInput = root.querySelector('[data-role="node-text-input"]');
        const nodeColorInput = root.querySelector('[data-role="node-color-input"]');
        const nodeColorPicker = root.querySelector('[data-role="node-color-picker"]');
        const shapeRow = root.querySelector('[data-role="shape-row"]');
        const nodeTextAlignSection = root.querySelector('[data-role="node-textalign-section"]');
        const textAlignRow = root.querySelector('[data-role="textalign-row"]');
        const addConnectedBtn = root.querySelector('[data-role="add-connected-btn"]');
        const addInputMenuBtn = root.querySelector('[data-role="add-input-menu-btn"]');
        const addInputSubmenu = root.querySelector('[data-role="add-input-submenu"]');
        const addInputBtn = root.querySelector('[data-role="add-input-btn"]');
        const addNumericBtn = root.querySelector('[data-role="add-numeric-btn"]');
        const addSelectBtn = root.querySelector('[data-role="add-select-btn"]');
        const addFloatingLabelBtn = root.querySelector('[data-role="add-floatinglabel-btn"]');
        const deleteNodeBtn = root.querySelector('[data-role="delete-node-btn"]');
        const floatingLabelMenu = root.querySelector('[data-role="floatinglabel-menu"]');
        const floatingLabelTextSection = root.querySelector('[data-role="floatinglabel-text-section"]');
        const floatingLabelTextInput = root.querySelector('[data-role="floatinglabel-text-input"]');
        const floatingLabelSelectSection = root.querySelector('[data-role="floatinglabel-select-section"]');
        const floatingLabelSelectInput = root.querySelector('[data-role="floatinglabel-select-input"]');
        const floatingLabelTextColorInput = root.querySelector('[data-role="floatinglabel-textcolor-input"]');
        const floatingLabelTextColorPicker = root.querySelector('[data-role="floatinglabel-textcolor-picker"]');
        const floatingLabelTextAlignRow = root.querySelector('[data-role="floatinglabel-textalign-row"]');
        const addFloatingLabelInputMenuBtn = root.querySelector('[data-role="add-floatinglabel-input-menu-btn"]');
        const addFloatingLabelInputSubmenu = root.querySelector('[data-role="add-floatinglabel-input-submenu"]');
        const addFloatingLabelInputBtn = root.querySelector('[data-role="add-floatinglabel-input-btn"]');
        const addFloatingLabelNumericBtn = root.querySelector('[data-role="add-floatinglabel-numeric-btn"]');
        const addFloatingLabelSelectBtn = root.querySelector('[data-role="add-floatinglabel-select-btn"]');
        const deleteFloatingLabelBtn = root.querySelector('[data-role="delete-floatinglabel-btn"]');
        const levelLabelMenu = root.querySelector('[data-role="levellabel-menu"]');
        const levelLabelShowCheckbox = root.querySelector('[data-role="levellabel-show-checkbox"]');
        const levelLabelTitleInput = root.querySelector('[data-role="levellabel-title-input"]');
        const levelLabelSubtitleInput = root.querySelector('[data-role="levellabel-subtitle-input"]');
        const edgeMenu = root.querySelector('[data-role="edge-menu"]');
        const edgeTextSection = root.querySelector('[data-role="edge-text-section"]');
        const edgeSelectSection = root.querySelector('[data-role="edge-select-section"]');
        const edgeSelectInput = root.querySelector('[data-role="edge-select-input"]');
        const edgeValueSection = root.querySelector('[data-role="edge-value-section"]');
        const edgeValueSelect = root.querySelector('[data-role="edge-value-select"]');
        const edgeTextColorSection = root.querySelector('[data-role="edge-textcolor-section"]');
        const edgeTextColorInput = root.querySelector('[data-role="edge-textcolor-input"]');
        const edgeTextColorPicker = root.querySelector('[data-role="edge-textcolor-picker"]');
        const edgeTextAlignSection = root.querySelector('[data-role="edge-textalign-section"]');
        const edgeTextAlignRow = root.querySelector('[data-role="edge-textalign-row"]');
        const addEdgeInputMenuBtn = root.querySelector('[data-role="add-edge-input-menu-btn"]');
        const addEdgeInputSubmenu = root.querySelector('[data-role="add-edge-input-submenu"]');
        const addEdgeInputBtn = root.querySelector('[data-role="add-edge-input-btn"]');
        const addEdgeNumericBtn = root.querySelector('[data-role="add-edge-numeric-btn"]');
        const addEdgeSelectBtn = root.querySelector('[data-role="add-edge-select-btn"]');
        const deleteEdgeBtn = root.querySelector('[data-role="delete-edge-btn"]');
        const edgeLabelInput = root.querySelector('[data-role="edge-label-input"]');

        if (enableAddInput) {
            // "Marcar como input ▸" opens a submenu to the right of its menu with two
            // options - Texto ({{T_INPUT}}) and Número ({{N_INPUT}}); see wireInputSubmenu().
            addInputMenuBtn.hidden = false;
            addEdgeInputMenuBtn.hidden = false;
            addFloatingLabelInputMenuBtn.hidden = false;
            addSelectBtn.hidden = false;
            addEdgeSelectBtn.hidden = false;
            addFloatingLabelSelectBtn.hidden = false;
        }

        /**
         * Populates a hex text+swatch color pair (node fill, or "Color de texto"
         * on the node/edge/floating-label menus) from a stored value. The text
         * field always shows the raw value (including '' - "no color of its
         * own"); the swatch only updates when it's a valid 6-digit hex, since a
         * native <input type=color> can't represent "unset" and would otherwise
         * just snap to black - same reasoning as wireColorPair() in
         * initCanvasSettings() below.
         *
         * @param {Element} textInput
         * @param {Element} picker
         * @param {string} value
         */
        function populateColorField(textInput, picker, value) {
            textInput.value = value || '';
            if (/^#[0-9a-fA-F]{6}$/.test(value)) {
                picker.value = value;
            }
        }

        /**
         * Wires a hex text+swatch color pair (node fill, or "Color de texto" on
         * the node/edge/floating-label menus) so either control updates the
         * other and calls setColor() with the resulting value - setColor is a
         * closure that looks up whichever node/edge/floating label is currently
         * active at the time of the edit (activeNodeId/activeEdge/
         * activeFloatingLabelNodeId), since this is wired once at editor setup,
         * long before any specific one is selected.
         *
         * @param {Element} textInput
         * @param {Element} picker
         * @param {function(string)} setColor
         */
        function wireColorField(textInput, picker, setColor) {
            textInput.addEventListener('input', () => {
                const value = textInput.value.trim();
                if (/^#[0-9a-fA-F]{6}$/.test(value)) {
                    picker.value = value;
                }
                setColor(value);
                notifyChange();
            });
            picker.addEventListener('input', () => {
                textInput.value = picker.value;
                setColor(picker.value);
                notifyChange();
            });
        }

        wireColorField(nodeColorInput, nodeColorPicker, (color) => {
            if (activeNodeId) {
                applyNodeColors(nodes.get(activeNodeId).el, color);
            }
        });

        wireColorField(nodeTextColorInput, nodeTextColorPicker, (color) => {
            if (activeNodeId) {
                applyNodeTextColor(nodes.get(activeNodeId).el, color);
            }
        });

        wireColorField(edgeTextColorInput, edgeTextColorPicker, (color) => {
            if (activeEdge) {
                applyEdgeTextColor(activeEdge.group, color);
            }
        });

        wireColorField(floatingLabelTextColorInput, floatingLabelTextColorPicker, (color) => {
            if (activeFloatingLabelNodeId) {
                applyFloatingLabelTextColor(nodes.get(activeFloatingLabelNodeId).floatingLabelWrap, color);
            }
        });

        // Sibling editors (by container id) this instance pushes fill-in-the-blank
        // clears and layout changes into: starts with addInputTargetContainerId (the
        // primary answer graph, wired up front by initEditor()) and grows via
        // addSyncTarget() as alternate answer graphs are added later (see
        // initAltAnswers()) - a node/edge marked as input, or a layout change, must
        // reach every answer graph, not just the one known when this editor was built.
        const syncTargetIds = new Set();
        if (addInputTargetContainerId) {
            syncTargetIds.add(addInputTargetContainerId);
        }

        /**
         * Resolve every registered sync target to its live editor api.
         *
         * @return {Array}
         */
        function getAddInputTargets() {
            return [...syncTargetIds].map((id) => editorRegistry.get(id)).filter(Boolean);
        }

        /**
         * Register another editor (by container id) to receive this editor's future
         * "Marcar como input" clears and layout changes, alongside whatever target(s)
         * it already has. Used to wire a newly-added alternate answer graph into the
         * default graph's existing sync mechanism.
         *
         * @param {string} containerId
         */
        function addSyncTarget(containerId) {
            syncTargetIds.add(containerId);
        }
        const modeToggle = root.querySelector('[data-role="mode-toggle"]');
        const orientationToggle = root.querySelector('[data-role="orientation-toggle"]');
        const lineStyleToggle = root.querySelector('[data-role="linestyle-toggle"]');
        const zoomInBtn = root.querySelector('[data-role="zoom-in"]');
        const zoomOutBtn = root.querySelector('[data-role="zoom-out"]');
        const zoomResetBtn = root.querySelector('[data-role="zoom-reset"]');
        const jsonBtn = root.querySelector('[data-role="json-btn"]');
        const jsonPanel = root.querySelector('[data-role="json-panel"]');
        const jsonTextarea = root.querySelector('[data-role="json-textarea"]');
        const jsonStatus = root.querySelector('[data-role="json-status"]');
        const jsonBuildBtn = root.querySelector('[data-role="json-build-btn"]');
        const jsonCopyBtn = root.querySelector('[data-role="json-copy-btn"]');
        const jsonCloseBtn = root.querySelector('[data-role="json-close-btn"]');
        const imageBtn = root.querySelector('[data-role="image-btn"]');
        const imagePanel = root.querySelector('[data-role="image-panel"]');
        const imageFormatButtons = [...root.querySelectorAll('[data-role="image-format-toggle"] button')];
        const imageBgCheckbox = root.querySelector('[data-role="image-bg-checkbox"]');
        const imageGridCheckbox = root.querySelector('[data-role="image-grid-checkbox"]');
        const imageHiddenLevelLabelsCheckbox = root.querySelector('[data-role="image-hiddenlevellabels-checkbox"]');
        const imageStatus = root.querySelector('[data-role="image-status"]');
        const imageDownloadBtn = root.querySelector('[data-role="image-download-btn"]');
        const imageCloseBtn = root.querySelector('[data-role="image-close-btn"]');
        const canvasSettingsBtn = root.querySelector('[data-role="canvas-settings-btn"]');
        const canvasSettingsPanel = root.querySelector('[data-role="canvas-settings-panel"]');
        const canvasShowGridCheckbox = root.querySelector('[data-role="canvas-showgrid-checkbox"]');
        const canvasBgColorInput = root.querySelector('[data-role="canvas-bgcolor-input"]');
        const canvasBgColorPicker = root.querySelector('[data-role="canvas-bgcolor-picker"]');
        const canvasGridColorInput = root.querySelector('[data-role="canvas-gridcolor-input"]');
        const canvasGridColorPicker = root.querySelector('[data-role="canvas-gridcolor-picker"]');
        const canvasLevelLabelSizeInput = root.querySelector('[data-role="canvas-levellabelsize-input"]');
        const canvasShowLevelLabelsCheckbox = root.querySelector('[data-role="canvas-showlevellabels-checkbox"]');
        const canvasShowNodeTrailCheckbox = root.querySelector('[data-role="canvas-shownodetrail-checkbox"]');
        const canvasSettingsCloseBtn = root.querySelector('[data-role="canvas-settings-close-btn"]');

        if (lockLayout) {
            [...modeToggle.children, ...orientationToggle.children].forEach((btn) => {
                btn.disabled = true;
            });
        }

        // Declared here, ahead of setCanvasStyle() below, since its very first call
        // (immediately after its own definition) already reads/writes mode and
        // showLevelLabels, and (via relayoutTree()/clearLevelLabels()) nodes, edges
        // and levelLabelsLayer too - referencing any of these before their let/const
        // declaration runs throws a ReferenceError (temporal dead zone) that would
        // abort createGraphEditor() entirely before a single node gets created.
        let nodeCounter = 0;
        let edgeCounter = 0;
        const nodes = new Map();
        const edges = [];
        let activeNodeId = null;
        let activeEdge = null;
        // The leaf node whose floating label popup (floatingLabelMenu) is currently open -
        // separate from activeNodeId (the node-menu's own state) since either menu can be
        // open independently, and openFloatingLabelMenu() below never touches activeNodeId.
        let activeFloatingLabelNodeId = null;
        // The tree depth whose level-label popup (levelLabelMenu) is currently
        // open - same reasoning as activeFloatingLabelNodeId above. 0 is a valid
        // depth, so null (not falsy-0) means "none".
        let activeLevelLabelDepth = null;
        // "Show node trail" (qtype_graph_options.shownodetrail) - only ever true in
        // attempt mode (opts.showNodeTrail is not even passed by initEditor()'s editor
        // canvases). See showTrailFrom()/clearTrail() below.
        const showTrail = attemptMode && !!opts.showNodeTrail;
        let trailNodeIds = new Set();
        let trailEdgeSet = new Set();
        // "Show level labels" (qtype_graph_options.showlevellabels) - unlike showTrail
        // above, this applies uniformly to every canvas (editor and attempt alike),
        // the same way showGrid/bgColor/gridColor do - see setCanvasStyle() below.
        let showLevelLabels = true;
        // Per-depth {show, title, subtitle} overrides (index = depth), decoded from
        // qtype_graph_options.levellabelsjson - see setLevelLabelOverrides() below.
        // Applies uniformly like showLevelLabels above, same reasoning.
        let levelLabelOverrides = [];
        // Level-label DOM layer ("Etapa 0", "Etapa 1", ...), created lazily on first
        // use since the shared editor_ui.php markup (used by every graph canvas -
        // default, result, every alternate, and the attempt canvas) has no dedicated
        // slot for it, unlike edgesLayer above. Lives inside graphContent so it pans
        // and zooms together with the nodes/edges it labels - see
        // ensureLevelLabelsLayer() below.
        let levelLabelsLayer = null;
        let mode = 'graph';
        let orientation = 'vertical';
        let lineStyle = 'straight';
        let zoom = 1;
        let panX = 0;
        let panY = 0;
        let suppress = false;

        // Persistent per-editor canvas style state, merged into by setCanvasStyle()
        // below rather than replaced outright - each caller only ever owns, and
        // only ever patches, a subset of these keys (the canvas gear panel owns
        // showGrid/bgColor/gridColor, initCanvasSettings() in the edit form still
        // owns showLevelLabels/textColor/levelLabelSize - see each call site), so
        // one side patching its keys can never reset the other's.
        let canvasStyle = {
            showGrid: true,
            bgColor: '',
            gridColor: '',
            showLevelLabels: true,
            textColor: '',
            levelLabelSize: '',
        };

        /**
         * Show/hide the canvas's background grid and set its background/grid-line/
         * text colors and level-label size, merging `patch` into this editor's
         * persistent canvasStyle state (see above) instead of requiring every
         * caller to know the current value of every other setting. Called live
         * from the canvas gear panel and initCanvasSettings() below whenever the
         * teacher changes any of these.
         *
         * @param {Object} patch
         * @param {boolean} [patch.showGrid]
         * @param {string} [patch.bgColor] a CSS color, or '' to fall back to the default theme color.
         * @param {string} [patch.gridColor] a CSS color, or '' to fall back to the default theme color.
         * @param {boolean} [patch.showLevelLabels] whether tree mode's "Etapa 0"/"Etapa 1"/...
         *                  depth labels are shown - see renderLevelLabels() below.
         * @param {string} [patch.textColor] a CSS color for node text and connection labels, or ''
         *                  to fall back to each one's own default (white / dark respectively -
         *                  see .qtype_graph-node/.qtype_graph-edge-label in styles.css).
         * @param {number|string} [patch.levelLabelSize] font size (px) of every level label's
         *                  title (and, proportionally, its subtitle - see styles.css), or ''
         *                  to fall back to the default 16px. Applies uniformly to every
         *                  depth - see levelLabelOverrides above for per-depth color only.
         */
        function setCanvasStyle(patch) {
            Object.assign(canvasStyle, patch);
            canvas.classList.toggle('qtype_graph-canvas--nogrid', !canvasStyle.showGrid);
            if (canvasStyle.bgColor) {
                canvas.style.setProperty('--qtype-graph-canvas-bg', canvasStyle.bgColor);
            } else {
                canvas.style.removeProperty('--qtype-graph-canvas-bg');
            }
            if (canvasStyle.gridColor) {
                canvas.style.setProperty('--qtype-graph-grid', canvasStyle.gridColor);
            } else {
                canvas.style.removeProperty('--qtype-graph-grid');
            }
            if (canvasStyle.textColor) {
                canvas.style.setProperty('--qtype-graph-canvas-text', canvasStyle.textColor);
            } else {
                canvas.style.removeProperty('--qtype-graph-canvas-text');
            }
            if (canvasStyle.levelLabelSize) {
                canvas.style.setProperty('--qtype-graph-levellabel-size', `${parseInt(canvasStyle.levelLabelSize, 10)}px`);
            } else {
                canvas.style.removeProperty('--qtype-graph-levellabel-size');
            }
            showLevelLabels = !!canvasStyle.showLevelLabels;
            if (mode === 'tree') {
                relayoutTree();
            } else {
                clearLevelLabels();
            }
        }
        setCanvasStyle({
            showGrid: root.dataset.showgrid !== '0',
            bgColor: root.dataset.bgcolor || '',
            gridColor: root.dataset.gridcolor || '',
            showLevelLabels: root.dataset.showlevellabels !== '0',
            textColor: root.dataset.textcolor || '',
            levelLabelSize: root.dataset.levellabelsize || '',
        });

        /**
         * Set the per-depth level-label overrides (show/title/subtitle, one entry
         * per tree depth) and re-render them if currently in tree mode. Read
         * generically off the container's own data-levellabelsjson (same reasoning
         * as setCanvasStyle() above) at setup, and called live via editorRegistry
         * broadcast (applyLevelLabelOverrides() above) whenever the teacher clicks
         * a level label open and edits it (openLevelLabelMenu() below).
         *
         * @param {Array} overrides index = depth, each {show, title, subtitle} or absent.
         */
        function setLevelLabelOverrides(overrides) {
            levelLabelOverrides = Array.isArray(overrides) ? overrides : [];
            if (mode === 'tree') {
                relayoutTree();
            } else {
                clearLevelLabels();
            }
        }
        setLevelLabelOverrides(safeParseLevelLabelOverrides(root.dataset.levellabelsjson));

        // The result graph never chooses its own mode/orientation/line-style: it always
        // mirrors the default graph's (see setLayout() below and initEditor()'s pre-hydrate
        // override), so its copies of these controls are permanently hidden rather than just
        // disabled.
        if (hideLayoutControls) {
            modeToggle.hidden = true;
            orientationToggle.hidden = true;
            lineStyleToggle.hidden = true;
        } else {
            if (!allowChangeGraphType) {
                modeToggle.hidden = true;
            }
            if (!allowChangeLineStyle) {
                lineStyleToggle.hidden = true;
            }
        }

        function notifyChange() {
            if (!suppress) {
                onChange(serialize());
            }
        }

        function limitWords(el) {
            const max = parseInt(el.dataset.maxWords, 10) || DEFAULT_MAX_WORDS;
            const words = el.textContent.split(/\s+/).filter(Boolean);
            if (words.length > max) {
                el.textContent = words.slice(0, max).join(' ');
                placeCaretAtEnd(el);
            }
        }

        function limitWordsPlain(text, maxWords) {
            const words = text.split(/\s+/).filter(Boolean);
            if (words.length > maxWords) {
                return words.slice(0, maxWords).join(' ');
            }
            return text;
        }

        function placeCaretAtEnd(el) {
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }

        function getCenter(nodeEl) {
            return {
                x: nodeEl.offsetLeft + nodeEl.offsetWidth / 2,
                y: nodeEl.offsetTop + nodeEl.offsetHeight / 2,
            };
        }

        function applyTransform() {
            graphContent.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
            zoomResetBtn.textContent = `${Math.round(zoom * 100)}%`;
        }

        function setZoom(next) {
            zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
            applyTransform();
        }

        function resetView() {
            zoom = 1;
            panX = 0;
            panY = 0;
            applyTransform();
        }

        zoomInBtn.addEventListener('click', () => setZoom(zoom + ZOOM_STEP));
        zoomOutBtn.addEventListener('click', () => setZoom(zoom - ZOOM_STEP));
        zoomResetBtn.addEventListener('click', () => resetView());

        // The JSON panel (export + import combined) is only offered on the teacher
        // authoring canvases (both the default graph and the result graph use
        // opts.mode = 'editor', see initEditor()) - never on the student attempt
        // canvas (opts.mode = 'attempt'), since "Construir grafo" lets you replace
        // the whole graph from pasted JSON, which a student could use to cheat.
        // The image export panel is read-only (just a PNG/SVG download), so it's
        // safe to also offer on the attempt canvas - gated on the teacher's own
        // "Allow students to download their graph as an image" setting
        // (qtype_graph_options.allowdownloadimage, opts.allowDownloadImage here -
        // see initAttempt() below), off by default.
        if (opts.mode === 'editor') {
            jsonBtn.hidden = false;
            imageBtn.hidden = false;
            // Only the canvas that owns this question's shared grid/background
            // settings gets the gear button - see isCanvasSettingsOwner above.
            if (isCanvasSettingsOwner) {
                canvasSettingsBtn.hidden = false;
            }
        } else if (attemptMode && opts.allowDownloadImage) {
            imageBtn.hidden = false;
        }

        function showJsonStatus(message, isError) {
            jsonStatus.textContent = message;
            jsonStatus.hidden = !message;
            jsonStatus.classList.toggle('qtype_graph-jsonstatus--error', !!isError);
        }

        // The JSON panel, the image export panel, and the canvas settings panel
        // all share the same fixed spot over the canvas (see .qtype_graph-exportpanel
        // in styles.css), so opening any one of them closes the other two rather
        // than letting them stack on top of each other.
        function openJsonPanel() {
            imagePanel.hidden = true;
            canvasSettingsPanel.hidden = true;
            jsonPanel.hidden = false;
            showJsonStatus('', false);
        }

        jsonBtn.addEventListener('click', () => {
            jsonTextarea.value = JSON.stringify(serialize(), null, 2);
            openJsonPanel();
            jsonTextarea.focus();
            jsonTextarea.select();
        });
        jsonCloseBtn.addEventListener('click', () => {
            jsonPanel.hidden = true;
        });
        jsonBuildBtn.addEventListener('click', () => {
            let data;
            try {
                data = JSON.parse(jsonTextarea.value);
            } catch (e) {
                showJsonStatus('JSON inválido: revisa la sintaxis.', true);
                return;
            }
            if (!data || !Array.isArray(data.nodes)) {
                showJsonStatus('El JSON debe tener un array "nodes".', true);
                return;
            }
            if (jsonBuildBtn.dataset.confirm && !window.confirm(jsonBuildBtn.dataset.confirm)) {
                return;
            }
            hydrate(data);
            // hydrate() above only ever applies embedded showGrid/bgColor/
            // gridColor/levelLabelSize/showLevelLabels/showNodeTrail/
            // levelLabelOverrides visually (see its own comment) - pasting JSON
            // here is a real, user-initiated change, so
            // also persist whatever it just applied into the hidden mform fields,
            // same as if the teacher had set it from the gear panel or the
            // level-label click-menu directly.
            if (applyCanvasSettings) {
                applyCanvasSettings();
            }
            if (applyLevelLabelOverrides) {
                applyLevelLabelOverrides();
            }
            notifyChange();
            const form = root.closest('form');
            if (form) {
                FormChangeChecker.markFormAsDirty(form);
            }
            showJsonStatus('Grafo construido correctamente.', false);
        });
        jsonCopyBtn.addEventListener('click', () => {
            const restoreLabel = jsonCopyBtn.textContent;
            const showCopied = () => {
                jsonCopyBtn.textContent = 'Copiado';
                setTimeout(() => {
                    jsonCopyBtn.textContent = restoreLabel;
                }, 1500);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(jsonTextarea.value).then(showCopied, () => {
                    jsonTextarea.focus();
                    jsonTextarea.select();
                });
                return;
            }
            jsonTextarea.focus();
            jsonTextarea.select();
            try {
                document.execCommand('copy');
                showCopied();
            } catch (e) {
                // Selection is left in place so the user can still copy manually.
                // Silently ignored: no execCommand support and no Clipboard API.
            }
        });

        // Which format the image panel's "Descargar" button currently produces -
        // toggled by the PNG/SVG buttons below, PNG first by default (matches
        // whichever button carries qtype_graph-shapebtn--selected in the markup).
        let imageFormat = 'png';

        /**
         * @param {string} message
         * @param {boolean} isError
         */
        function showImageStatus(message, isError) {
            imageStatus.textContent = message;
            imageStatus.hidden = !message;
            imageStatus.classList.toggle('qtype_graph-jsonstatus--error', !!isError);
        }

        /**
         * See openJsonPanel() above - same fixed-spot-over-the-canvas reasoning.
         */
        function openImagePanel() {
            jsonPanel.hidden = true;
            canvasSettingsPanel.hidden = true;
            imagePanel.hidden = false;
            showImageStatus('', false);
            // Only offered when this canvas actually has a switched-off level label
            // to include - see renderLevelLabels(), which only draws those on the
            // canvas owning the question's shared style settings.
            imageHiddenLevelLabelsCheckbox.closest('label').hidden =
                    !graphContent.querySelector('.qtype_graph-levellabel--hidden');
        }

        imageBtn.addEventListener('click', () => {
            openImagePanel();
        });
        imageCloseBtn.addEventListener('click', () => {
            imagePanel.hidden = true;
        });
        imageFormatButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                imageFormat = btn.dataset.format;
                imageFormatButtons.forEach((b) =>
                        b.classList.toggle('qtype_graph-shapebtn--selected', b === btn));
            });
        });
        imageDownloadBtn.addEventListener('click', () => {
            showImageStatus('Generando...', false);
            const exportFn = imageFormat === 'svg' ? exportCanvasAsSvg : exportCanvasAsPng;
            const options = {
                includeBackground: imageBgCheckbox.checked,
                includeGrid: imageGridCheckbox.checked,
                includeHiddenLevelLabels: imageHiddenLevelLabelsCheckbox.checked,
            };
            exportFn(canvas, graphContent, options).then(() => {
                showImageStatus(imageFormat === 'svg' ? 'SVG descargado.' : 'PNG descargado.', false);
            }, () => {
                showImageStatus('No se pudo generar la imagen.', true);
            });
        });

        // Only the canvas that owns this question's shared style settings
        // (isCanvasSettingsOwner - see its declaration above) actually drives
        // them; every other canvas's gear button stays permanently hidden, so
        // its copy of this panel's controls is never reachable and needs no
        // wiring. Live-restyling every canvas works the same way whether or not
        // there's a form to also persist into (canvasSettingsFieldIds, null on
        // the standalone helper page) - see applyCanvasSettings() below.
        if (isCanvasSettingsOwner) {
            const showGridField = canvasSettingsFieldIds && document.getElementById(canvasSettingsFieldIds.showGrid);
            const bgColorField = canvasSettingsFieldIds && document.getElementById(canvasSettingsFieldIds.bgColor);
            const gridColorField = canvasSettingsFieldIds && document.getElementById(canvasSettingsFieldIds.gridColor);
            const levelLabelSizeField = canvasSettingsFieldIds &&
                    document.getElementById(canvasSettingsFieldIds.levelLabelSize);
            const showLevelLabelsField = canvasSettingsFieldIds &&
                    document.getElementById(canvasSettingsFieldIds.showLevelLabels);
            const showNodeTrailField = canvasSettingsFieldIds &&
                    document.getElementById(canvasSettingsFieldIds.showNodeTrail);

            // Seeded from this editor's already-resolved initial canvasStyle state
            // (see setCanvasStyle() above), not by re-reading the hidden mform
            // fields directly - both start out equal, since that initial call was
            // itself seeded from the same server-rendered data-* attributes those
            // hidden fields carry.
            canvasShowGridCheckbox.checked = canvasStyle.showGrid;
            canvasBgColorInput.value = canvasStyle.bgColor;
            if (/^#[0-9a-fA-F]{6}$/.test(canvasStyle.bgColor)) {
                canvasBgColorPicker.value = canvasStyle.bgColor;
            }
            canvasGridColorInput.value = canvasStyle.gridColor;
            if (/^#[0-9a-fA-F]{6}$/.test(canvasStyle.gridColor)) {
                canvasGridColorPicker.value = canvasStyle.gridColor;
            }
            canvasLevelLabelSizeInput.value = canvasStyle.levelLabelSize;
            canvasShowLevelLabelsCheckbox.checked = canvasStyle.showLevelLabels;
            // Not part of canvasStyle - shownodetrail only ever affects the
            // student attempt canvas (see showTrail below), never this one, so
            // there's no live style state to seed from; read the same data-*
            // attribute setCanvasStyle()'s own initial call reads the others
            // from instead.
            canvasShowNodeTrailCheckbox.checked = root.dataset.shownodetrail !== '0';

            /**
             * Applies the panel's current showgrid/bgcolor/gridcolor/level-label-
             * size/show-level-labels/show-node-trail controls: restyles every
             * canvas belonging to this question (same broadcast reasoning as
             * initCanvasSettings() above) - always, live preview or not (except
             * showNodeTrail, which never visually affects this canvas - see its
             * own seeding comment above). On the Moodle edit form
             * (showGridField/bgColorField/gridColorField/levelLabelSizeField/
             * showLevelLabelsField/showNodeTrailField non-null) it also writes
             * the resolved values into the hidden mform fields so they're what
             * actually gets submitted on save, and marks the form dirty - the
             * same two things editing the graph itself does via notifyChange(),
             * just for these settings instead of graphjson. On the standalone
             * helper page (no form at all) those six are null, so this is
             * preview-only there. Assigns the outer applyCanvasSettings binding
             * (declared above, before this block) rather than a local const,
             * since hydrate() and the "Construir grafo" button need to call this
             * too - see there.
             */
            applyCanvasSettings = () => {
                const showGrid = canvasShowGridCheckbox.checked;
                const bgColor = canvasBgColorInput.value;
                const gridColor = canvasGridColorInput.value;
                const levelLabelSize = canvasLevelLabelSizeInput.value;
                const showLevelLabels = canvasShowLevelLabelsCheckbox.checked;
                const showNodeTrail = canvasShowNodeTrailCheckbox.checked;
                editorRegistry.forEach((editor) =>
                        editor.setCanvasStyle({showGrid, bgColor, gridColor, levelLabelSize, showLevelLabels}));
                if (showGridField) {
                    showGridField.value = showGrid ? '1' : '0';
                }
                if (bgColorField) {
                    bgColorField.value = bgColor;
                }
                if (gridColorField) {
                    gridColorField.value = gridColor;
                }
                if (levelLabelSizeField) {
                    levelLabelSizeField.value = levelLabelSize;
                }
                if (showLevelLabelsField) {
                    showLevelLabelsField.value = showLevelLabels ? '1' : '0';
                }
                if (showNodeTrailField) {
                    showNodeTrailField.value = showNodeTrail ? '1' : '0';
                }
                const form = root.closest('form');
                if (form) {
                    FormChangeChecker.markFormAsDirty(form);
                }
            };

            /**
             * Two-way-syncs a plain hex text field with its paired native
             * color-swatch picker, same pattern as wireColorField() above but
             * without notifyChange() - these aren't part of the graph itself,
             * see applyCanvasSettings() instead.
             *
             * @param {Element} textField
             * @param {Element} picker
             */
            const wireCanvasColorField = (textField, picker) => {
                textField.addEventListener('input', () => {
                    if (/^#[0-9a-fA-F]{6}$/.test(textField.value)) {
                        picker.value = textField.value;
                    }
                    applyCanvasSettings();
                });
                picker.addEventListener('input', () => {
                    textField.value = picker.value;
                    applyCanvasSettings();
                });
            };

            canvasShowGridCheckbox.addEventListener('change', applyCanvasSettings);
            wireCanvasColorField(canvasBgColorInput, canvasBgColorPicker);
            wireCanvasColorField(canvasGridColorInput, canvasGridColorPicker);
            canvasLevelLabelSizeInput.addEventListener('input', applyCanvasSettings);
            canvasShowLevelLabelsCheckbox.addEventListener('change', applyCanvasSettings);
            canvasShowNodeTrailCheckbox.addEventListener('change', applyCanvasSettings);

            const levelLabelOverridesField = canvasSettingsFieldIds &&
                    document.getElementById(canvasSettingsFieldIds.levelLabelOverrides);

            /**
             * Persists the current levelLabelOverrides state (mutated directly by
             * openLevelLabelMenu()'s controls, see below) - broadcasts it to every
             * canvas belonging to this question via editorRegistry (same reasoning
             * as applyCanvasSettings() above), writes it into the hidden
             * levellabelsjson mform field so it's what actually gets submitted on
             * save, and marks the form dirty. Assigns the outer
             * applyLevelLabelOverrides binding for the same reason
             * applyCanvasSettings does.
             */
            applyLevelLabelOverrides = () => {
                editorRegistry.forEach((editor) => editor.setLevelLabelOverrides(levelLabelOverrides));
                if (levelLabelOverridesField) {
                    levelLabelOverridesField.value = JSON.stringify(levelLabelOverrides);
                }
                const form = root.closest('form');
                if (form) {
                    FormChangeChecker.markFormAsDirty(form);
                }
            };
        }

        /**
         * See openJsonPanel() above - same fixed-spot-over-the-canvas reasoning.
         */
        function openCanvasSettingsPanel() {
            jsonPanel.hidden = true;
            imagePanel.hidden = true;
            canvasSettingsPanel.hidden = false;
        }

        canvasSettingsBtn.addEventListener('click', () => {
            openCanvasSettingsPanel();
        });
        canvasSettingsCloseBtn.addEventListener('click', () => {
            canvasSettingsPanel.hidden = true;
        });

        // Menus are only clamped inside the canvas when they open (see openMenu()
        // and friends), so expanding a collapsible section afterwards could push
        // one past the canvas's bottom edge. Re-clamp on every section toggle
        // ('toggle' doesn't bubble, hence the capture listener); past the
        // canvas's own height the menu scrolls instead (max-height in styles.css).
        canvas.addEventListener('toggle', (e) => {
            const openMenuEl = e.target.closest && e.target.closest('.qtype_graph-nodemenu');
            if (!openMenuEl || openMenuEl.hidden) {
                return;
            }
            const overflow = openMenuEl.offsetTop + openMenuEl.offsetHeight - (canvas.clientHeight - 8);
            if (overflow > 0) {
                openMenuEl.style.top = `${Math.max(0, openMenuEl.offsetTop - overflow)}px`;
            }
        }, true);

        canvas.addEventListener('wheel', (e) => {
            // Over a popup menu/panel (which scrolls on its own once it's taller
            // than the canvas - see .qtype_graph-nodemenu's max-height), let the
            // wheel scroll it instead of zooming the graph behind it.
            if (e.target.closest('.qtype_graph-nodemenu, .qtype_graph-exportpanel')) {
                return;
            }
            e.preventDefault();
            setZoom(zoom + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP));
        }, {passive: false});

        let panState = null;

        canvas.addEventListener('mousedown', (e) => {
            if (e.target !== canvas && e.target !== graphContent) {
                return;
            }
            closeMenus();
            panState = {
                startX: e.clientX,
                startY: e.clientY,
                startPanX: panX,
                startPanY: panY,
                moved: false,
            };
        });

        window.addEventListener('mousemove', (e) => {
            if (!panState) {
                return;
            }
            const dx = e.clientX - panState.startX;
            const dy = e.clientY - panState.startY;
            if (!panState.moved && Math.hypot(dx, dy) > CLICK_THRESHOLD) {
                panState.moved = true;
                graphContent.classList.add('qtype_graph-panning');
            }
            if (!panState.moved) {
                return;
            }
            panX = panState.startPanX + dx;
            panY = panState.startPanY + dy;
            applyTransform();
        });

        window.addEventListener('mouseup', () => {
            if (!panState) {
                return;
            }
            graphContent.classList.remove('qtype_graph-panning');
            panState = null;
        });

        // The foreignObject starts pinned to this generous upper-bound box so its
        // HTML content always has room to lay out and be measured (a foreignObject
        // with no size yet can fail to render its content in some browsers), then
        // setEdgeGeometry shrinks it to fit the label's actual rendered size on
        // every reposition - a short/empty blank must not claim a big fixed
        // footprint that blots out the connecting line underneath it.
        const EDGE_LABEL_FO_MAX_WIDTH = 220;
        const EDGE_LABEL_FO_MAX_HEIGHT = 60;
        const EDGE_LABEL_FO_MIN_WIDTH = 24;
        const EDGE_LABEL_FO_MIN_HEIGHT = 20;
        const EDGE_LABEL_FO_PADDING = 8;
        // Gap between the line's midpoint and a left/right-aligned connection
        // label - see applyEdgeTextAlign().
        const EDGE_LABEL_ALIGN_OFFSET = 6;

        function setEdgeGeometry(edge, x1, y1, x2, y2) {
            const {d, lx, ly} = computeEdgeGeometry(x1, y1, x2, y2, lineStyle, mode, orientation);
            edge.hitPath.setAttribute('d', d);
            edge.visiblePath.setAttribute('d', d);
            if (edge.htmlLabel) {
                const {fo, div} = edge.htmlLabel;
                const w = Math.min(
                        Math.max(div.offsetWidth + EDGE_LABEL_FO_PADDING, EDGE_LABEL_FO_MIN_WIDTH),
                        EDGE_LABEL_FO_MAX_WIDTH);
                const h = Math.min(
                        Math.max(div.offsetHeight + EDGE_LABEL_FO_PADDING, EDGE_LABEL_FO_MIN_HEIGHT),
                        EDGE_LABEL_FO_MAX_HEIGHT);
                let foX = lx - w / 2;
                if (edge.textAlign === 'left') {
                    foX = lx - w - EDGE_LABEL_ALIGN_OFFSET;
                } else if (edge.textAlign === 'right') {
                    foX = lx + EDGE_LABEL_ALIGN_OFFSET;
                }
                fo.setAttribute('x', foX);
                fo.setAttribute('y', ly - h / 2);
                fo.setAttribute('width', w);
                fo.setAttribute('height', h);
            } else {
                // Left = label ends just before the midpoint, right = starts just
                // after it, center = centered on it - see applyEdgeTextAlign().
                const anchor = {left: 'end', right: 'start'}[edge.textAlign] || 'middle';
                const offset = {left: -EDGE_LABEL_ALIGN_OFFSET, right: EDGE_LABEL_ALIGN_OFFSET}[edge.textAlign] || 0;
                edge.textEl.setAttribute('text-anchor', anchor);
                edge.textEl.setAttribute('x', lx + offset);
                edge.textEl.setAttribute('y', ly);
            }
        }

        function positionEdge(edge) {
            const fromRecord = nodes.get(edge.fromId);
            const toRecord = nodes.get(edge.toId);
            if (!fromRecord || !toRecord) {
                return;
            }
            const c1 = getCenter(fromRecord.el);
            const c2 = getCenter(toRecord.el);
            setEdgeGeometry(edge, c1.x, c1.y, c2.x, c2.y);
        }

        function updateEdgesFor(nodeId) {
            const record = nodes.get(nodeId);
            if (!record) {
                return;
            }
            record.edges.forEach(positionEdge);
        }

        function rerouteAllEdges() {
            if (mode === 'tree') {
                relayoutTree();
                return;
            }
            edges.forEach(positionEdge);
        }

        /**
         * Create (once) and return the level-labels layer, appending it to
         * graphContent on first use.
         *
         * @return {Element}
         */
        function ensureLevelLabelsLayer() {
            if (!levelLabelsLayer) {
                levelLabelsLayer = document.createElement('div');
                levelLabelsLayer.className = 'qtype_graph-levellabels';
                graphContent.appendChild(levelLabelsLayer);
            }
            return levelLabelsLayer;
        }

        /**
         * Remove every level label - called whenever the graph leaves tree mode,
         * has no nodes, or has no root to lay out from (see relayoutTree() below).
         */
        function clearLevelLabels() {
            if (levelLabelsLayer) {
                levelLabelsLayer.innerHTML = '';
            }
        }

        /**
         * Render "Etapa 0"/"Etapa 1"/... labels along the tree's depth axis - one
         * per level, positioned above each column in horizontal orientation, or to
         * the left of each row in vertical orientation (the root, depth 0, is
         * always "Etapa 0" unless overridden - see levelLabelOverrides above).
         *
         * A depth whose override has show === false is skipped ENTIRELY on any
         * canvas that isn't isCanvasSettingsOwner (result graph, an alternate, or
         * the student attempt) - unchanged from before. On the owning canvas,
         * that depth instead gets a dimmed "ghost" placeholder
         * (.qtype_graph-levellabel--hidden) that's still clickable - otherwise,
         * once a label is hidden, there would be no on-canvas element left to
         * click to un-hide it again. Every rendered label on the owning canvas is
         * clickable (openLevelLabelMenu() below); elsewhere labels stay
         * read-only, same as before (see styles.css for how --clickable alone
         * grants pointer-events, since the wrapping .qtype_graph-levellabels
         * layer itself stays pointer-events: none).
         *
         * Only ever called from relayoutTree() below, once every node's final
         * position for this layout pass is known.
         *
         * @param {number[]} depthPixelPos depthPixelPos[d] is that depth's shared
         *                    top (vertical orientation) or left (horizontal) pixel
         *                    position - same array relayoutTree() positions nodes with.
         * @param {Map} maxExtentByDepth depth -> tallest/widest rendered node size at
         *              that depth, used to center each label on its row/column the
         *              same way relayoutTree() paces levels apart.
         * @param {number} maxDepth
         * @param {Map} finalPos node id -> {left, top, w, h} - used to find the edge
         *              of the tree's overall bounding box the label column/row sits
         *              just outside of.
         */
        function renderLevelLabels(depthPixelPos, maxExtentByDepth, maxDepth, finalPos) {
            const layer = ensureLevelLabelsLayer();
            layer.innerHTML = '';
            const positions = [...finalPos.values()];
            if (!positions.length) {
                return;
            }
            const vertical = orientation === 'vertical';
            const edge = vertical ?
                Math.min(...positions.map((p) => p.left)) - LEVEL_LABEL_GAP :
                Math.min(...positions.map((p) => p.top)) - LEVEL_LABEL_GAP;
            for (let d = 0; d <= maxDepth; d++) {
                const override = levelLabelOverrides[d];
                const hidden = !!(override && override.show === false);
                if (hidden && !isCanvasSettingsOwner) {
                    continue;
                }
                const label = document.createElement('div');
                label.className = 'qtype_graph-levellabel';
                if (hidden) {
                    label.classList.add('qtype_graph-levellabel--hidden');
                }
                const titleEl = document.createElement('div');
                titleEl.className = 'qtype_graph-levellabel-title';
                titleEl.textContent = (override && override.title) ? override.title : `Etapa ${d}`;
                label.appendChild(titleEl);
                if (!hidden && override && override.subtitle) {
                    const subtitleEl = document.createElement('div');
                    subtitleEl.className = 'qtype_graph-levellabel-subtitle';
                    subtitleEl.textContent = override.subtitle;
                    label.appendChild(subtitleEl);
                }
                const center = depthPixelPos[d] + (maxExtentByDepth.get(d) || 0) / 2;
                if (vertical) {
                    label.style.left = `${edge}px`;
                    label.style.top = `${center}px`;
                } else {
                    label.classList.add('qtype_graph-levellabel--horizontal');
                    label.style.left = `${center}px`;
                    label.style.top = `${edge}px`;
                }
                if (isCanvasSettingsOwner) {
                    label.classList.add('qtype_graph-levellabel--clickable');
                    // Same mousedown/click stopPropagation as the floating-label
                    // wrap above - without it, the mousedown would also start a
                    // canvas pan (see canvas's own mousedown listener below).
                    label.addEventListener('mousedown', (e) => e.stopPropagation());
                    label.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openLevelLabelMenu(d, label);
                    });
                }
                layer.appendChild(label);
            }
        }

        /**
         * A "leaf" for the floating-label feature: a node with no outgoing edge, only
         * meaningful in tree mode (see CLAUDE.md, "Floating labels on leaf nodes").
         *
         * @param {string} id
         * @return {boolean}
         */
        function isLeafNode(id) {
            return mode === 'tree' && !edges.some((edge) => edge.fromId === id);
        }

        /**
         * Show/hide one node's floating label and pick its below/right positioning class,
         * without touching its content - safe to call on every layout change (edge add/
         * remove, node add/remove, mode/orientation toggle, hydrate) even mid-attempt,
         * since it never disturbs a student's in-progress input/select inside the label.
         * Content is set once at creation (createNode()) or via setRecordFloatingLabelText()
         * (editor mode only).
         *
         * @param {Object} record
         */
        function updateFloatingLabelVisibility(record) {
            const show = isLeafNode(record.id) && (record.floatingLabel || '').trim() !== '';
            record.floatingLabelWrap.hidden = !show;
            record.floatingLabelWrap.classList.toggle('qtype_graph-floatinglabel--horizontal',
                    orientation === 'horizontal');
        }

        /**
         * Refresh every node's floating label visibility - called from relayoutTree()
         * (covers edge/node add/remove, hydrate, orientation change) and from setMode()'s
         * graph-mode branch (the one path that changes leaf-relevant state - mode - without
         * calling relayoutTree()).
         */
        function refreshAllFloatingLabelVisibility() {
            nodes.forEach(updateFloatingLabelVisibility);
        }

        function relayoutTree() {
            if (mode !== 'tree' || nodes.size === 0) {
                refreshAllFloatingLabelVisibility();
                clearLevelLabels();
                return;
            }

            const childrenMap = new Map();
            const childSet = new Set();
            edges.forEach(({fromId, toId}) => {
                if (!childrenMap.has(fromId)) {
                    childrenMap.set(fromId, []);
                }
                childrenMap.get(fromId).push(toId);
                childSet.add(toId);
            });
            const roots = [...nodes.keys()].filter((id) => !childSet.has(id));
            if (roots.length === 0) {
                clearLevelLabels();
                return;
            }

            const depthOf = new Map();
            const breadthOf = new Map();
            const leafOrder = [];
            let nextLeaf = 0;

            const assign = (id, depth) => {
                depthOf.set(id, depth);
                const children = childrenMap.get(id) || [];
                let breadth;
                if (children.length === 0) {
                    breadth = nextLeaf;
                    leafOrder.push(id);
                    nextLeaf += 1;
                } else {
                    const values = children.map((childId) => assign(childId, depth + 1));
                    breadth = (Math.min(...values) + Math.max(...values)) / 2;
                }
                breadthOf.set(id, breadth);
                return breadth;
            };

            roots.forEach((rootId) => assign(rootId, 0));

            // Leaves are assigned sequential integer slots above. Convert those slots
            // into pixel positions using each leaf's actual rendered size along the
            // sibling axis (width when stacking siblings horizontally, height when
            // stacking them vertically), so the pitch between siblings always fits
            // their real content instead of a fixed guess that overlaps once nodes
            // grow wide/tall or several siblings share a parent.
            const leafExtent = (id) => {
                const el = nodes.get(id).el;
                return orientation === 'vertical' ? el.offsetWidth : el.offsetHeight;
            };
            const leafPixelPos = [];
            leafOrder.forEach((id, i) => {
                if (i === 0) {
                    leafPixelPos.push(0);
                } else {
                    const prevExtent = leafExtent(leafOrder[i - 1]);
                    const extent = leafExtent(id);
                    leafPixelPos.push(leafPixelPos[i - 1] + prevExtent / 2 + TREE_SIBLING_GAP + extent / 2);
                }
            });

            const breadthToPixel = (breadth) => {
                const n = leafPixelPos.length;
                if (n === 0) {
                    return 0;
                }
                const clamped = Math.min(Math.max(breadth, 0), n - 1);
                const lower = Math.floor(clamped);
                const upper = Math.min(lower + 1, n - 1);
                const frac = clamped - lower;
                return leafPixelPos[lower] + (leafPixelPos[upper] - leafPixelPos[lower]) * frac;
            };

            const breadthCenter = leafPixelPos.length ?
                (leafPixelPos[0] + leafPixelPos[leafPixelPos.length - 1]) / 2 : 0;
            const canvasRect = canvas.getBoundingClientRect();

            // All nodes at the same depth share the same top (vertical) / left
            // (horizontal) edge, so a level's pitch must clear the tallest/widest
            // node actually rendered at the level above it - a fixed pitch (the old
            // TREE_LEVEL_SPACING) overlaps as soon as any node's real height/width
            // exceeds it, which can happen with as few as two nodes (one parent,
            // one child) once the child renders something taller than plain text.
            const minPitch = orientation === 'vertical' ? TREE_LEVEL_MIN_PITCH.vertical : TREE_LEVEL_MIN_PITCH.horizontal;
            const levelExtent = (record) => orientation === 'vertical' ? record.el.offsetHeight : record.el.offsetWidth;
            const maxExtentByDepth = new Map();
            nodes.forEach((record, id) => {
                const depth = depthOf.get(id) ?? 0;
                maxExtentByDepth.set(depth, Math.max(maxExtentByDepth.get(depth) || 0, levelExtent(record)));
            });
            const maxDepth = Math.max(...depthOf.values());
            const depthPixelPos = [TREE_MARGIN];
            for (let d = 1; d <= maxDepth; d++) {
                const pitch = Math.max((maxExtentByDepth.get(d - 1) || 0) + TREE_LEVEL_GAP, minPitch);
                depthPixelPos.push(depthPixelPos[d - 1] + pitch);
            }

            const finalPos = new Map();

            nodes.forEach((record, id) => {
                const depth = depthOf.get(id) ?? 0;
                const breadth = breadthToPixel(breadthOf.get(id) ?? 0) - breadthCenter;
                const w = record.el.offsetWidth;
                const h = record.el.offsetHeight;
                let left;
                let top;
                if (orientation === 'vertical') {
                    left = canvasRect.width / 2 + breadth - w / 2;
                    top = depthPixelPos[depth];
                } else {
                    left = depthPixelPos[depth];
                    top = canvasRect.height / 2 + breadth - h / 2;
                }
                record.el.style.left = `${left}px`;
                record.el.style.top = `${top}px`;
                finalPos.set(id, {left, top, w, h});
            });

            edges.forEach((edge) => {
                const from = finalPos.get(edge.fromId);
                const to = finalPos.get(edge.toId);
                if (!from || !to) {
                    return;
                }
                const x1 = from.left + from.w / 2;
                const y1 = from.top + from.h / 2;
                const x2 = to.left + to.w / 2;
                const y2 = to.top + to.h / 2;
                setEdgeGeometry(edge, x1, y1, x2, y2);
            });

            if (showLevelLabels) {
                renderLevelLabels(depthPixelPos, maxExtentByDepth, maxDepth, finalPos);
            } else {
                clearLevelLabels();
            }

            refreshAllFloatingLabelVisibility();
        }

        function createEdge(fromId, toId, label, locked, id, textColor, textAlign) {
            if (!id) {
                edgeCounter += 1;
                id = `edge-${Date.now().toString(36)}-${edgeCounter}`;
            }

            const group = document.createElementNS(SVG_NS, 'g');
            group.classList.add('qtype_graph-edge-group');
            if (locked) {
                group.classList.add('qtype_graph-edge-group--locked');
            }
            applyEdgeTextColor(group, textColor || '');

            const hitPath = document.createElementNS(SVG_NS, 'path');
            hitPath.classList.add('qtype_graph-edge-hit');
            const visiblePath = document.createElementNS(SVG_NS, 'path');
            visiblePath.classList.add('qtype_graph-edge-line');
            const textEl = document.createElementNS(SVG_NS, 'text');
            textEl.classList.add('qtype_graph-edge-label');
            textEl.setAttribute('text-anchor', 'middle');
            textEl.setAttribute('dominant-baseline', 'middle');

            group.appendChild(hitPath);
            group.appendChild(visiblePath);
            group.appendChild(textEl);

            let htmlLabel = null;
            if (locked && attemptMode && hasBlankTokens(label)) {
                const fo = document.createElementNS(SVG_NS, 'foreignObject');
                fo.classList.add('qtype_graph-edge-label-fo');
                const div = document.createElement('div');
                div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
                div.className = 'qtype_graph-edge-label-html';
                fo.setAttribute('width', EDGE_LABEL_FO_MAX_WIDTH);
                fo.setAttribute('height', EDGE_LABEL_FO_MAX_HEIGHT);
                fo.appendChild(div);
                renderLabelSegments(div, label, 'edge', id, editable, opts.getBlankValue, opts.onBlankChange);
                group.appendChild(fo);
                htmlLabel = {fo, div};
            } else {
                textEl.textContent = label || '';
            }

            edgesLayer.appendChild(group);

            const edge = {
                id, group, hitPath, visiblePath, textEl, htmlLabel,
                fromId, toId, label: label || '', locked: !!locked,
                textAlign: TEXT_ALIGNS.includes(textAlign) ? textAlign : DEFAULT_TEXT_ALIGN,
            };
            edges.push(edge);
            nodes.get(fromId).edges.add(edge);
            nodes.get(toId).edges.add(edge);
            updateEdgesFor(fromId);

            if (editable && !locked) {
                hitPath.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openEdgeMenu(edge, e.clientX, e.clientY);
                });
            }

            return edge;
        }

        function removeEdge(edge) {
            const idx = edges.indexOf(edge);
            if (idx !== -1) {
                edges.splice(idx, 1);
            }
            const fromRecord = nodes.get(edge.fromId);
            if (fromRecord) {
                fromRecord.edges.delete(edge);
            }
            const toRecord = nodes.get(edge.toId);
            if (toRecord) {
                toRecord.edges.delete(edge);
            }
            edge.group.remove();
            if (activeEdge === edge) {
                closeEdgeMenu();
            }
        }

        function deleteNode(id) {
            const record = nodes.get(id);
            if (!record) {
                return;
            }
            if (record.locked && !allowDeleteNodes) {
                return;
            }
            [...record.edges].forEach(removeEdge);
            record.el.remove();
            nodes.delete(id);
            if (activeNodeId === id) {
                closeMenu();
            }
            relayoutTree();
            notifyChange();
        }

        function closeMenu() {
            menu.hidden = true;
            addInputSubmenu.hidden = true;
            if (activeNodeId && nodes.has(activeNodeId)) {
                nodes.get(activeNodeId).el.classList.remove('qtype_graph-node--menuopen');
            }
            activeNodeId = null;
        }

        function closeEdgeMenu() {
            edgeMenu.hidden = true;
            addEdgeInputSubmenu.hidden = true;
            if (activeEdge) {
                activeEdge.group.classList.remove('qtype_graph-edge-group--selected');
            }
            activeEdge = null;
        }

        /**
         * Hide the floating-label popup (openFloatingLabelMenu()) and clear its own
         * active-node tracking - the floating-label counterpart of closeMenu()/
         * closeEdgeMenu() above.
         */
        function closeFloatingLabelMenu() {
            floatingLabelMenu.hidden = true;
            addFloatingLabelInputSubmenu.hidden = true;
            activeFloatingLabelNodeId = null;
        }

        /**
         * Hide the level-label popup (openLevelLabelMenu()) and clear its own
         * active-depth tracking - the level-label counterpart of
         * closeFloatingLabelMenu() above.
         */
        function closeLevelLabelMenu() {
            levelLabelMenu.hidden = true;
            activeLevelLabelDepth = null;
        }

        function closeMenus() {
            closeMenu();
            closeEdgeMenu();
            closeFloatingLabelMenu();
            closeLevelLabelMenu();
            clearTrail();
        }

        /**
         * Clear whatever node-trail highlight showTrailFrom() below currently shows,
         * without touching menu/selection state - closeMenus() above calls this
         * alongside closing the node/edge menus (e.g. a click on empty canvas), and
         * clear() calls it directly since by then every node/edge it references has
         * already been removed from the DOM.
         */
        function clearTrail() {
            trailNodeIds.forEach((id) => {
                const record = nodes.get(id);
                if (record) {
                    record.el.classList.remove('qtype_graph-node--trail');
                }
            });
            trailEdgeSet.forEach((edge) => edge.group.classList.remove('qtype_graph-edge-group--trail'));
            trailNodeIds = new Set();
            trailEdgeSet = new Set();
            root.classList.remove('qtype_graph-container--trailactive');
        }

        /**
         * "Show node trail": highlight every node/edge on the path from the clicked
         * node back to its origin node(s) - the ancestor(s) reached by repeatedly
         * following an edge backwards (toId -> fromId) until none remains. This is
         * the same "root" definition relayoutTree() above uses for tree mode (a node
         * that never appears as an edge's toId), so "origin" means the same thing
         * whether the question is laid out as a graph or a tree. A node with more
         * than one incoming edge highlights every such path at once, since there is
         * no single unambiguous one to pick.
         *
         * @param {string} nodeId the clicked node's id.
         */
        function showTrailFrom(nodeId) {
            clearTrail();
            if (!nodes.has(nodeId)) {
                return;
            }
            const visited = new Set([nodeId]);
            const pathEdges = [];
            const queue = [nodeId];
            while (queue.length) {
                const current = queue.shift();
                for (const edge of edges) {
                    if (edge.toId === current && !visited.has(edge.fromId)) {
                        visited.add(edge.fromId);
                        pathEdges.push(edge);
                        queue.push(edge.fromId);
                    }
                }
            }
            trailNodeIds = visited;
            trailEdgeSet = new Set(pathEdges);
            trailNodeIds.forEach((id) => {
                const record = nodes.get(id);
                if (record) {
                    record.el.classList.add('qtype_graph-node--trail');
                }
            });
            trailEdgeSet.forEach((edge) => edge.group.classList.add('qtype_graph-edge-group--trail'));
            root.classList.add('qtype_graph-container--trailactive');
        }

        function openEdgeMenu(edge, clientX, clientY) {
            closeMenus();
            activeEdge = edge;
            edge.group.classList.add('qtype_graph-edge-group--selected');
            // Same reasoning as openMenu() above: a student's own new connection
            // (attempt mode) with content type 'text' is read-only, and 'select' is
            // answered via edgeValueSelect (below) instead of the free-text/marker
            // fields, which stay authoring-only ([[...]] marker parsing skipped
            // entirely in attempt mode, for the same reason as openMenu()).
            const attemptRestricted = attemptMode && !edge.locked && newEdgeContentType !== 'input';
            const attemptSelect = attemptMode && !edge.locked && newEdgeContentType === 'select';
            const selectOptions = (!attemptMode && !edge.locked) ? parseWholeSelectOptions(edge.label) : null;
            edgeTextSection.hidden = attemptRestricted || !!selectOptions;
            edgeSelectSection.hidden = !selectOptions;
            edgeValueSection.hidden = !attemptSelect;
            // Same locked-based visibility as node-color-section (openMenu() below) -
            // in practice always visible here, since a locked edge never even gets the
            // click listener that reaches this menu (see createEdge()).
            edgeTextColorSection.hidden = edge.locked;
            populateColorField(edgeTextColorInput, edgeTextColorPicker,
                    edge.group.style.getPropertyValue('--item-text-color').trim());
            edgeTextAlignSection.hidden = edge.locked;
            markSelectedTextAlign(edgeTextAlignRow, edge.textAlign);
            edgeLabelInput.value = edge.label;
            edgeLabelInput.readOnly = attemptMode && !edge.locked && newEdgeContentType === 'text';
            // Shown WITH its [[...]] brackets (unlike a plain options list) so text typed
            // immediately before/after them in this same field becomes prefix/suffix text
            // around the marker (e.g. "text before [[opt1;opt2]] after") - see the plain
            // assignment in this field's 'input' handler below, which no longer re-wraps
            // the whole value through buildSelectMarker().
            edgeSelectInput.value = selectOptions ? edge.label : '';
            if (attemptSelect) {
                const options = splitOptions(newEdgeContentValue);
                edgeValueSelect.innerHTML = '';
                const placeholderOpt = document.createElement('option');
                placeholderOpt.value = '';
                placeholderOpt.textContent = '—';
                edgeValueSelect.appendChild(placeholderOpt);
                options.forEach((opt) => {
                    const optionEl = document.createElement('option');
                    optionEl.value = opt;
                    optionEl.textContent = opt;
                    edgeValueSelect.appendChild(optionEl);
                });
                edgeValueSelect.value = options.includes(edge.label) ? edge.label : '';
            }

            const canvasRect = canvas.getBoundingClientRect();
            let left = clientX - canvasRect.left + 10;
            let top = clientY - canvasRect.top + 10;
            edgeMenu.style.left = `${left}px`;
            edgeMenu.style.top = `${top}px`;
            edgeMenu.hidden = false;

            const menuRect = edgeMenu.getBoundingClientRect();
            if (menuRect.right > canvasRect.right) {
                left = clientX - canvasRect.left - menuRect.width - 10;
            }
            if (menuRect.bottom > canvasRect.bottom) {
                top = clientY - canvasRect.top - menuRect.height - 10;
            }
            edgeMenu.style.left = `${left}px`;
            edgeMenu.style.top = `${top}px`;

            let focusTarget = edgeLabelInput;
            if (selectOptions) {
                focusTarget = edgeSelectInput;
            } else if (attemptSelect) {
                focusTarget = edgeValueSelect;
            }
            focusTarget.focus();
        }

        edgeLabelInput.addEventListener('input', () => {
            if (!activeEdge) {
                return;
            }
            activeEdge.label = edgeLabelInput.value;
            activeEdge.textEl.textContent = activeEdge.label;
            notifyChange();
        });

        edgeLabelInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                edgeLabelInput.blur();
            }
        });

        edgeSelectInput.addEventListener('input', () => {
            if (!activeEdge) {
                return;
            }
            // Raw assignment (like edgeLabelInput above) rather than buildSelectMarker() -
            // this field now displays the [[...]] marker literally, so re-wrapping it would
            // double-bracket it and would discard any prefix/suffix text typed around it.
            activeEdge.label = edgeSelectInput.value;
            activeEdge.textEl.textContent = activeEdge.label;
            notifyChange();
        });

        edgeSelectInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                edgeSelectInput.blur();
            }
        });

        edgeValueSelect.addEventListener('mousedown', (e) => e.stopPropagation());
        edgeValueSelect.addEventListener('click', (e) => e.stopPropagation());
        edgeValueSelect.addEventListener('change', () => {
            if (!activeEdge) {
                return;
            }
            activeEdge.label = edgeValueSelect.value;
            activeEdge.textEl.textContent = activeEdge.label;
            notifyChange();
        });

        deleteEdgeBtn.addEventListener('click', () => {
            if (!activeEdge) {
                return;
            }
            removeEdge(activeEdge);
            relayoutTree();
            notifyChange();
        });

        /**
         * Wire a "Marcar como input ▸" button to its Texto/Número submenu: toggles the
         * submenu open beside its parent menu - to the right, or to the left when there
         * is no room on the right of the canvas - aligned with the button. The submenu
         * is a sibling of the menu (not a child) because the menu itself scrolls and
         * would clip it.
         *
         * @param {Element} parentMenu the node/edge/floating-label menu holding the button.
         * @param {Element} triggerBtn the "Marcar como input ▸" button.
         * @param {Element} submenu the Texto/Número submenu.
         * @param {Array} options [[button, handler], ...] - each hides the submenu once picked.
         */
        function wireInputSubmenu(parentMenu, triggerBtn, submenu, options) {
            triggerBtn.addEventListener('click', () => {
                if (!submenu.hidden) {
                    submenu.hidden = true;
                    return;
                }
                submenu.hidden = false;
                const gap = 6;
                let left = parentMenu.offsetLeft + parentMenu.offsetWidth + gap;
                if (left + submenu.offsetWidth > canvas.clientWidth) {
                    left = Math.max(0, parentMenu.offsetLeft - submenu.offsetWidth - gap);
                }
                let top = parentMenu.offsetTop + triggerBtn.offsetTop - parentMenu.scrollTop;
                top = Math.max(0, Math.min(top, canvas.clientHeight - submenu.offsetHeight));
                submenu.style.left = `${left}px`;
                submenu.style.top = `${top}px`;
            });
            options.forEach(([button, handler]) => {
                button.addEventListener('click', () => {
                    submenu.hidden = true;
                    handler();
                });
            });
        }

        /**
         * "Marcar como input ▸" Texto/Número on the active edge.
         *
         * @param {string} marker BLANK_MARKER or NUMERIC_BLANK_MARKER.
         */
        function markActiveEdgeAsInput(marker) {
            if (!activeEdge) {
                return;
            }
            activeEdge.label = marker;
            activeEdge.textEl.textContent = marker;
            edgeLabelInput.value = marker;
            edgeTextSection.hidden = false;
            edgeSelectSection.hidden = true;
            notifyChange();
            getAddInputTargets().forEach((target) => target.setEdgeLabel(activeEdge.id, ''));
        }

        wireInputSubmenu(edgeMenu, addEdgeInputMenuBtn, addEdgeInputSubmenu, [
            [addEdgeInputBtn, () => markActiveEdgeAsInput(BLANK_MARKER)],
            [addEdgeNumericBtn, () => markActiveEdgeAsInput(NUMERIC_BLANK_MARKER)],
        ]);

        addEdgeSelectBtn.addEventListener('click', () => {
            if (!activeEdge) {
                return;
            }
            const defaultOptions = 'Opción 1, Opción 2';
            activeEdge.label = buildSelectMarker(defaultOptions);
            activeEdge.textEl.textContent = activeEdge.label;
            edgeSelectInput.value = activeEdge.label;
            edgeTextSection.hidden = true;
            edgeSelectSection.hidden = false;
            notifyChange();
            getAddInputTargets().forEach((target) => target.setEdgeLabel(activeEdge.id, ''));
            edgeSelectInput.focus();
        });

        deleteNodeBtn.addEventListener('click', () => {
            if (!activeNodeId) {
                return;
            }
            deleteNode(activeNodeId);
        });

        /**
         * "Marcar como input ▸" Texto/Número on the active node.
         *
         * @param {string} marker BLANK_MARKER or NUMERIC_BLANK_MARKER.
         */
        function markActiveNodeAsInput(marker) {
            if (!activeNodeId) {
                return;
            }
            const record = nodes.get(activeNodeId);
            setRecordText(record, marker);
            nodeTextInput.value = marker;
            nodeTextSection.hidden = false;
            nodeSelectSection.hidden = true;
            notifyChange();
            getAddInputTargets().forEach((target) => target.setNodeText(activeNodeId, ''));
        }

        wireInputSubmenu(menu, addInputMenuBtn, addInputSubmenu, [
            [addInputBtn, () => markActiveNodeAsInput(BLANK_MARKER)],
            [addNumericBtn, () => markActiveNodeAsInput(NUMERIC_BLANK_MARKER)],
        ]);

        addSelectBtn.addEventListener('click', () => {
            if (!activeNodeId) {
                return;
            }
            const record = nodes.get(activeNodeId);
            const defaultOptions = 'Opción 1, Opción 2';
            setRecordText(record, buildSelectMarker(defaultOptions));
            nodeSelectInput.value = getRecordText(record);
            nodeTextSection.hidden = true;
            nodeSelectSection.hidden = false;
            notifyChange();
            getAddInputTargets().forEach((target) => target.setNodeText(activeNodeId, ''));
            nodeSelectInput.focus();
        });

        nodeSelectInput.addEventListener('input', () => {
            if (!activeNodeId) {
                return;
            }
            // Raw assignment (like nodeTextInput below) rather than buildSelectMarker() -
            // this field now displays the [[...]] marker literally, so re-wrapping it would
            // double-bracket it and would discard any prefix/suffix text typed around it.
            const record = nodes.get(activeNodeId);
            setRecordText(record, nodeSelectInput.value);
            notifyChange();
        });

        nodeSelectInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                nodeSelectInput.blur();
            }
        });

        // "+ Etiqueta flotante" only creates one (seeded with a placeholder the teacher
        // is expected to overwrite) and immediately opens its own popup to edit it - see
        // openFloatingLabelMenu() below, which is also reachable later by clicking the
        // label itself on the canvas (setupNode()'s floatingLabelWrap click handler).
        addFloatingLabelBtn.addEventListener('click', () => {
            if (!activeNodeId) {
                return;
            }
            const record = nodes.get(activeNodeId);
            setRecordFloatingLabelText(record, 'Etiqueta');
            notifyChange();
            openFloatingLabelMenu(activeNodeId);
        });

        /**
         * Open the popup for editing one leaf node's floating label (text/input/selector),
         * positioned next to the label itself on the canvas - the on-canvas counterpart to
         * openMenu()/openEdgeMenu() above, kept as its own menu (rather than folded into
         * the node menu) since it's reached by clicking the label directly, independently
         * of whether the node's own menu is open.
         *
         * @param {string} nodeId
         */
        function openFloatingLabelMenu(nodeId) {
            closeMenus();
            activeFloatingLabelNodeId = nodeId;
            const record = nodes.get(nodeId);

            const text = getRecordFloatingLabelText(record);
            const selectOptions = parseWholeSelectOptions(text);
            floatingLabelTextSection.hidden = !!selectOptions;
            floatingLabelSelectSection.hidden = !selectOptions;
            floatingLabelTextInput.value = text;
            // Shown WITH its [[...]] brackets (see nodeSelectInput above for why).
            floatingLabelSelectInput.value = selectOptions ? text : '';
            // 'initial' is applyFloatingLabelTextColor()'s own sentinel for "no color
            // of its own" (see that function's docblock) - never shown as a real value.
            const rawTextColor = record.floatingLabelWrap.style.getPropertyValue('--item-text-color').trim();
            populateColorField(floatingLabelTextColorInput, floatingLabelTextColorPicker,
                    rawTextColor === 'initial' ? '' : rawTextColor);
            markSelectedTextAlign(floatingLabelTextAlignRow,
                    record.floatingLabelWrap.dataset.textalign || DEFAULT_TEXT_ALIGN);

            const wrapRect = record.floatingLabelWrap.getBoundingClientRect();
            const canvasRect = canvas.getBoundingClientRect();
            let left = wrapRect.right - canvasRect.left + 12;
            let top = wrapRect.top - canvasRect.top;
            floatingLabelMenu.style.left = `${left}px`;
            floatingLabelMenu.style.top = `${top}px`;
            floatingLabelMenu.hidden = false;

            const menuRect = floatingLabelMenu.getBoundingClientRect();
            if (menuRect.right > canvasRect.right) {
                left = wrapRect.left - canvasRect.left - menuRect.width - 12;
            }
            if (menuRect.bottom > canvasRect.bottom) {
                top = Math.max(0, canvasRect.height - menuRect.height - 8);
            }
            floatingLabelMenu.style.left = `${left}px`;
            floatingLabelMenu.style.top = `${top}px`;
        }

        /**
         * Open the popup for editing one tree depth's level label (shown/text/
         * subtitle), positioned next to the label itself on the canvas - the
         * level-label counterpart of openFloatingLabelMenu() above. Only ever
         * reachable on the canvas that owns these settings
         * (isCanvasSettingsOwner - see renderLevelLabels(), the only place this
         * is called from).
         *
         * @param {number} depth
         * @param {Element} labelEl the clicked .qtype_graph-levellabel element.
         */
        function openLevelLabelMenu(depth, labelEl) {
            closeMenus();
            activeLevelLabelDepth = depth;
            const override = levelLabelOverrides[depth] || {};
            levelLabelShowCheckbox.checked = override.show !== false;
            levelLabelTitleInput.value = override.title || '';
            levelLabelTitleInput.placeholder = `Etapa ${depth}`;
            levelLabelSubtitleInput.value = override.subtitle || '';

            const labelRect = labelEl.getBoundingClientRect();
            const canvasRect = canvas.getBoundingClientRect();
            let left = labelRect.right - canvasRect.left + 12;
            let top = labelRect.top - canvasRect.top;
            levelLabelMenu.style.left = `${left}px`;
            levelLabelMenu.style.top = `${top}px`;
            levelLabelMenu.hidden = false;

            const menuRect = levelLabelMenu.getBoundingClientRect();
            if (menuRect.right > canvasRect.right) {
                left = labelRect.left - canvasRect.left - menuRect.width - 12;
            }
            if (menuRect.bottom > canvasRect.bottom) {
                top = Math.max(0, canvasRect.height - menuRect.height - 8);
            }
            levelLabelMenu.style.left = `${left}px`;
            levelLabelMenu.style.top = `${top}px`;
        }

        /**
         * Applies the level-label popup's current show/title/subtitle controls
         * to the depth it's currently open for: updates
         * levelLabelOverrides[depth] in place (a sparse entry - only the keys
         * that differ from "no override at all" are stored, same shape the old
         * edit-form rows produced), re-renders (relayoutTree(), the only path
         * to renderLevelLabels()), and persists via applyLevelLabelOverrides()
         * - always non-null here, since this popup is only ever reachable on
         * the canvas that owns these settings, the same canvas that assigns
         * applyLevelLabelOverrides (see its declaration above).
         */
        function applyActiveLevelLabelChange() {
            if (activeLevelLabelDepth === null) {
                return;
            }
            const depth = activeLevelLabelDepth;
            const entry = {};
            if (!levelLabelShowCheckbox.checked) {
                entry.show = false;
            }
            const title = levelLabelTitleInput.value.trim();
            if (title) {
                entry.title = title;
            }
            const subtitle = levelLabelSubtitleInput.value.trim();
            if (subtitle) {
                entry.subtitle = subtitle;
            }
            levelLabelOverrides[depth] = entry;
            if (mode === 'tree') {
                relayoutTree();
            }
            if (applyLevelLabelOverrides) {
                applyLevelLabelOverrides();
            }
        }

        levelLabelShowCheckbox.addEventListener('change', applyActiveLevelLabelChange);
        levelLabelTitleInput.addEventListener('input', applyActiveLevelLabelChange);
        levelLabelSubtitleInput.addEventListener('input', applyActiveLevelLabelChange);

        /**
         * "Marcar como input ▸" Texto/Número on the active floating label.
         *
         * @param {string} marker BLANK_MARKER or NUMERIC_BLANK_MARKER.
         */
        function markActiveFloatingLabelAsInput(marker) {
            if (!activeFloatingLabelNodeId) {
                return;
            }
            const record = nodes.get(activeFloatingLabelNodeId);
            setRecordFloatingLabelText(record, marker);
            floatingLabelTextInput.value = marker;
            floatingLabelTextSection.hidden = false;
            floatingLabelSelectSection.hidden = true;
            notifyChange();
            getAddInputTargets().forEach((target) => target.setFloatingLabel(activeFloatingLabelNodeId, ''));
        }

        wireInputSubmenu(floatingLabelMenu, addFloatingLabelInputMenuBtn, addFloatingLabelInputSubmenu, [
            [addFloatingLabelInputBtn, () => markActiveFloatingLabelAsInput(BLANK_MARKER)],
            [addFloatingLabelNumericBtn, () => markActiveFloatingLabelAsInput(NUMERIC_BLANK_MARKER)],
        ]);

        addFloatingLabelSelectBtn.addEventListener('click', () => {
            if (!activeFloatingLabelNodeId) {
                return;
            }
            const record = nodes.get(activeFloatingLabelNodeId);
            const defaultOptions = 'Opción 1, Opción 2';
            setRecordFloatingLabelText(record, buildSelectMarker(defaultOptions));
            floatingLabelSelectInput.value = getRecordFloatingLabelText(record);
            floatingLabelTextSection.hidden = true;
            floatingLabelSelectSection.hidden = false;
            notifyChange();
            getAddInputTargets().forEach((target) => target.setFloatingLabel(activeFloatingLabelNodeId, ''));
            floatingLabelSelectInput.focus();
        });

        floatingLabelSelectInput.addEventListener('input', () => {
            if (!activeFloatingLabelNodeId) {
                return;
            }
            // Raw assignment, same reasoning as nodeSelectInput above.
            const record = nodes.get(activeFloatingLabelNodeId);
            setRecordFloatingLabelText(record, floatingLabelSelectInput.value);
            notifyChange();
        });

        floatingLabelSelectInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                floatingLabelSelectInput.blur();
            }
        });

        floatingLabelTextInput.addEventListener('input', () => {
            if (!activeFloatingLabelNodeId) {
                return;
            }
            const record = nodes.get(activeFloatingLabelNodeId);
            setRecordFloatingLabelText(record, floatingLabelTextInput.value);
            notifyChange();
        });

        floatingLabelTextInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                floatingLabelTextInput.blur();
            }
        });

        deleteFloatingLabelBtn.addEventListener('click', () => {
            if (!activeFloatingLabelNodeId) {
                return;
            }
            const record = nodes.get(activeFloatingLabelNodeId);
            setRecordFloatingLabelText(record, '');
            notifyChange();
            closeMenus();
        });

        function openMenu(nodeId) {
            closeMenus();
            activeNodeId = nodeId;
            const record = nodes.get(nodeId);
            record.el.classList.add('qtype_graph-node--menuopen');

            const locked = record.locked;
            const canDeleteThisNode = locked ? allowDeleteNodes : true;
            // A student's own new node (attempt mode) with content type 'select' or 'text'
            // is edited entirely via its own inline element on the canvas (a <select> or
            // fixed <span> - see createNode()), never via this menu - the menu's free-text
            // field would otherwise let the student bypass that constraint. [[...]] marker
            // parsing (editor-mode authoring only) must never run against a student's own
            // typed answer either, so it's skipped entirely in attempt mode.
            const attemptRestricted = attemptMode && !locked && newNodeContentType !== 'input';
            const selectOptions = (!attemptMode && !locked) ? parseWholeSelectOptions(getRecordText(record)) : null;
            nodeTextSection.hidden = locked || attemptRestricted || !!selectOptions;
            nodeSelectSection.hidden = locked || !selectOptions;
            nodeColorSection.hidden = locked;
            nodeTextColorSection.hidden = locked;
            nodeShapeSection.hidden = locked;
            nodeTextAlignSection.hidden = locked;
            addConnectedBtn.hidden = !allowAddNodes;

            // "+ Etiqueta flotante": only offered on a leaf node (no outgoing edge) in tree
            // mode - see isLeafNode()/CLAUDE.md - and only while it doesn't have one yet;
            // once created, it's edited via its own popup (openFloatingLabelMenu()),
            // opened by clicking the label itself on the canvas, not from here.
            const isLeaf = isLeafNode(nodeId);
            const hasFloatingLabel = isLeaf && getRecordFloatingLabelText(record).trim() !== '';
            addFloatingLabelBtn.hidden = attemptMode || locked || !isLeaf || hasFloatingLabel;
            deleteNodeBtn.hidden = !canDeleteThisNode;

            // A locked (teacher-authored) node with add/delete both disabled offers
            // nothing here - every section/button above ends up hidden. Rather than
            // pop open a visibly empty menu, back out of the openMenu() we started
            // (closeMenus() above already ran, and activeNodeId/menuopen class were
            // just set) and leave the node non-interactive.
            const hasVisibleContent = !nodeTextSection.hidden || !nodeSelectSection.hidden ||
                    !nodeColorSection.hidden || !nodeTextColorSection.hidden || !nodeShapeSection.hidden ||
                    !nodeTextAlignSection.hidden ||
                    !addConnectedBtn.hidden || !addInputMenuBtn.hidden || !addSelectBtn.hidden ||
                    !addFloatingLabelBtn.hidden || !deleteNodeBtn.hidden;
            if (!hasVisibleContent) {
                closeMenu();
                return;
            }

            if (!locked) {
                if (!attemptRestricted) {
                    nodeTextInput.value = getRecordText(record);
                    // Shown WITH its [[...]] brackets (see edgeSelectInput above for why).
                    nodeSelectInput.value = selectOptions ? getRecordText(record) : '';
                }

                populateColorField(nodeTextColorInput, nodeTextColorPicker,
                        record.el.style.getPropertyValue('--item-text-color').trim());

                populateColorField(nodeColorInput, nodeColorPicker,
                        record.el.style.getPropertyValue('--node-color').trim());

                const currentShape = record.el.dataset.shape || DEFAULT_SHAPE;
                [...shapeRow.children].forEach((btn) => {
                    btn.classList.toggle('qtype_graph-shapebtn--selected', btn.dataset.shape === currentShape);
                });

                markSelectedTextAlign(textAlignRow, record.el.dataset.textalign || DEFAULT_TEXT_ALIGN);
            }

            if (canDeleteThisNode) {
                deleteNodeBtn.disabled = nodes.size <= 1;
                deleteNodeBtn.title = deleteNodeBtn.disabled ? 'No puedes eliminar el único nodo' : '';
            }

            const nodeRect = record.el.getBoundingClientRect();
            const canvasRect = canvas.getBoundingClientRect();
            let left = nodeRect.right - canvasRect.left + 12;
            let top = nodeRect.top - canvasRect.top;
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
            menu.hidden = false;

            const menuRect = menu.getBoundingClientRect();
            if (menuRect.right > canvasRect.right) {
                left = nodeRect.left - canvasRect.left - menuRect.width - 12;
            }
            if (menuRect.bottom > canvasRect.bottom) {
                top = Math.max(0, canvasRect.height - menuRect.height - 8);
            }
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
        }

        shapeRow.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-shape]');
            if (!btn || !activeNodeId) {
                return;
            }
            const record = nodes.get(activeNodeId);
            applyShape(record.el, btn.dataset.shape);
            notifyChange();
            openMenu(activeNodeId);
        });

        edgeTextAlignRow.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-align]');
            if (!btn || !activeEdge) {
                return;
            }
            applyEdgeTextAlign(activeEdge, btn.dataset.align);
            markSelectedTextAlign(edgeTextAlignRow, activeEdge.textAlign);
            notifyChange();
        });

        floatingLabelTextAlignRow.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-align]');
            if (!btn || !activeFloatingLabelNodeId) {
                return;
            }
            const wrap = nodes.get(activeFloatingLabelNodeId).floatingLabelWrap;
            applyFloatingLabelTextAlign(wrap, btn.dataset.align);
            markSelectedTextAlign(floatingLabelTextAlignRow, wrap.dataset.textalign);
            notifyChange();
        });

        textAlignRow.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-align]');
            if (!btn || !activeNodeId) {
                return;
            }
            const record = nodes.get(activeNodeId);
            applyTextAlign(record.el, btn.dataset.align);
            notifyChange();
            openMenu(activeNodeId);
        });

        nodeTextInput.addEventListener('input', () => {
            if (!activeNodeId) {
                return;
            }
            const record = nodes.get(activeNodeId);
            const maxWords = parseInt(record.textEl.dataset.maxWords, 10) || DEFAULT_MAX_WORDS;
            const limited = limitWordsPlain(nodeTextInput.value, maxWords);
            if (limited !== nodeTextInput.value) {
                nodeTextInput.value = limited;
            }
            setRecordText(record, limited);
            notifyChange();
        });

        nodeTextInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                nodeTextInput.blur();
            }
        });

        nodeTextInput.addEventListener('blur', () => {
            // Attempt-mode nodes use an <input> (no .textContent) and are allowed
            // to stay empty - the "restore default text" behavior below is
            // teacher-authoring-only.
            if (!activeNodeId || attemptMode) {
                return;
            }
            const record = nodes.get(activeNodeId);
            if (!record.textEl.textContent.trim()) {
                record.textEl.textContent = 'Nuevo nodo';
                nodeTextInput.value = 'Nuevo nodo';
                notifyChange();
            }
        });

        addConnectedBtn.addEventListener('click', () => {
            if (!activeNodeId) {
                return;
            }
            const parent = nodes.get(activeNodeId).el;
            const {left, top} = positionForNewNode(parent, activeNodeId);
            // Fixed-content nodes/edges (question-level newNodeContentType/newEdgeContentType)
            // get their content baked in right at creation - select/input modes start empty,
            // filled in later by the student via the inline element or the edge's menu.
            const seedNodeText = (attemptMode && newNodeContentType === 'text') ? newNodeContentValue :
                    (attemptMode ? '' : 'Nuevo nodo');
            const newId = createNode(left, top, seedNodeText, COLORS[0].bg, false, null, null, COLORS[0].border);
            const seedEdgeLabel = (attemptMode && newEdgeContentType === 'text') ? newEdgeContentValue : '';
            createEdge(activeNodeId, newId, seedEdgeLabel, false);
            closeMenus();
            relayoutTree();
            notifyChange();
        });

        function propagateLayout() {
            getAddInputTargets().forEach((target) => {
                if (target.setLayout) {
                    target.setLayout(mode, orientation, lineStyle);
                }
            });
        }

        function setMode(nextMode, silent) {
            if (mode === nextMode) {
                return;
            }
            mode = nextMode;
            canvas.classList.toggle('qtype_graph-canvas--tree', mode === 'tree');
            orientationToggle.hidden = hideLayoutControls || mode !== 'tree' || !allowChangeOrientation;
            [...modeToggle.children].forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.mode === mode);
            });
            closeMenus();
            if (mode === 'tree') {
                resetView();
                relayoutTree();
            } else {
                clearLevelLabels();
                refreshAllFloatingLabelVisibility();
            }
            if (!silent) {
                notifyChange();
                propagateLayout();
            }
        }

        function setOrientation(nextOrientation, silent) {
            if (orientation === nextOrientation) {
                return;
            }
            orientation = nextOrientation;
            [...orientationToggle.children].forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.orientation === orientation);
            });
            relayoutTree();
            if (!silent) {
                notifyChange();
                propagateLayout();
            }
        }

        function setLineStyle(nextLineStyle, silent) {
            if (lineStyle === nextLineStyle) {
                return;
            }
            lineStyle = nextLineStyle;
            [...lineStyleToggle.children].forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.lineStyle === lineStyle);
            });
            rerouteAllEdges();
            if (!silent) {
                notifyChange();
                propagateLayout();
            }
        }

        /**
         * Force this editor's mode/orientation/line-style to match another editor's
         * (the default graph), bypassing its own toggle UI. Used by a sibling editor
         * that owns the layout controls to keep this one (the result graph, which has
         * hideLayoutControls set) permanently in sync. Writes through to this editor's
         * hidden field like any other change, but as a single combined update.
         *
         * @param {string} nextMode
         * @param {string} nextOrientation
         * @param {string} nextLineStyle
         */
        function setLayout(nextMode, nextOrientation, nextLineStyle) {
            setMode(nextMode || 'graph', true);
            setOrientation(nextOrientation || 'vertical', true);
            setLineStyle(nextLineStyle || 'straight', true);
            notifyChange();
        }

        modeToggle.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-mode]');
            if (btn) {
                setMode(btn.dataset.mode);
            }
        });

        orientationToggle.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-orientation]');
            if (btn) {
                setOrientation(btn.dataset.orientation);
            }
        });

        lineStyleToggle.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-line-style]');
            if (btn) {
                setLineStyle(btn.dataset.lineStyle);
            }
        });

        function positionForNewNode(parentEl, parentId) {
            // Stack new siblings using the real rendered height of whatever
            // children the parent already has, not a fixed pitch guess - a
            // fixed pitch overlaps as soon as a sibling's actual height (e.g.
            // an input-carrying node wrapping onto more than one line) exceeds
            // it, which relayoutTree already accounts for in tree mode but
            // this manual "add connected node" placement did not in graph mode.
            let top = parentEl.offsetTop + 20;
            edges.filter((edge) => edge.fromId === parentId).forEach((edge) => {
                const siblingEl = nodes.get(edge.toId) && nodes.get(edge.toId).el;
                top += (siblingEl ? siblingEl.offsetHeight : 70) + TREE_SIBLING_GAP;
            });
            return {
                left: parentEl.offsetLeft + parentEl.offsetWidth + 60,
                top,
            };
        }

        function getRecordText(record) {
            const tag = record.textEl.tagName;
            return (tag === 'INPUT' || tag === 'SELECT') ? record.textEl.value : record.textEl.textContent;
        }

        function setRecordText(record, value) {
            const tag = record.textEl.tagName;
            if (tag === 'INPUT' || tag === 'SELECT') {
                record.textEl.value = value;
            } else {
                record.textEl.textContent = value;
            }
        }

        /**
         * Read a node's floating label raw text - always just `record.floatingLabel`
         * (unlike getRecordText() above, a floating label's DOM element is never a live
         * INPUT/SELECT the canonical value must be read back from: in editor mode it's a
         * plain span kept in sync by setRecordFloatingLabelText() below, and in attempt
         * mode the student's own typed/picked value lives in the response's `blanks` map,
         * never written back into this field).
         *
         * @param {Object} record
         * @return {string}
         */
        function getRecordFloatingLabelText(record) {
            return record.floatingLabel || '';
        }

        /**
         * Set a node's floating label raw text (editor mode only - see
         * getRecordFloatingLabelText() above) and refresh its on-canvas visibility, since
         * an edit here can be exactly what makes an empty label start (or stop) showing.
         *
         * @param {Object} record
         * @param {string} value
         */
        function setRecordFloatingLabelText(record, value) {
            record.floatingLabel = value;
            record.floatingLabelEl.textContent = value;
            updateFloatingLabelVisibility(record);
        }

        function applyShape(el, shape) {
            el.dataset.shape = SHAPES.includes(shape) ? shape : DEFAULT_SHAPE;
            el.classList.toggle('qtype_graph-node--shape-circle', el.dataset.shape === 'circle');
            el.classList.toggle('qtype_graph-node--shape-rectangle', el.dataset.shape === 'rectangle');
            el.classList.toggle('qtype_graph-node--shape-oval', el.dataset.shape === 'oval');
        }

        /**
         * Sets one node's text alignment. Only a non-default value is written as an
         * inline style, so a centered node keeps inheriting .qtype_graph-node's own
         * text-align rule from styles.css. Noticeable on wrapped (multi-line) text,
         * or a short label sitting in the node's default minimum width.
         *
         * @param {Element} el the .qtype_graph-node element.
         * @param {string} [align] one of TEXT_ALIGNS; anything else means DEFAULT_TEXT_ALIGN.
         */
        function applyTextAlign(el, align) {
            el.dataset.textalign = TEXT_ALIGNS.includes(align) ? align : DEFAULT_TEXT_ALIGN;
            if (el.dataset.textalign === DEFAULT_TEXT_ALIGN) {
                el.style.removeProperty('text-align');
            } else {
                el.style.textAlign = el.dataset.textalign;
            }
        }

        /**
         * Highlights the button matching align in one of the node/edge/floating-label
         * menus' "Alineación del texto" rows.
         *
         * @param {Element} row the [data-role$="textalign-row"] container.
         * @param {string} align
         */
        function markSelectedTextAlign(row, align) {
            [...row.children].forEach((btn) => {
                btn.classList.toggle('qtype_graph-shapebtn--selected', btn.dataset.align === align);
            });
        }

        /**
         * Sets one connection's label alignment. A connection label is a single
         * line, so this positions it relative to the line's midpoint instead of
         * aligning lines inside a box: left = the label ends at the midpoint,
         * right = it starts there, center = centered on it (the default).
         *
         * @param {Object} edge an edges[] entry.
         * @param {string} [align] one of TEXT_ALIGNS; anything else means DEFAULT_TEXT_ALIGN.
         */
        function applyEdgeTextAlign(edge, align) {
            edge.textAlign = TEXT_ALIGNS.includes(align) ? align : DEFAULT_TEXT_ALIGN;
            positionEdge(edge);
        }

        /**
         * Sets one floating label's alignment. Also single-line, so like
         * applyEdgeTextAlign() this positions the chip relative to its node: in
         * vertical orientation (label below the node) left/right line it up with
         * the node's left/right edge; in horizontal orientation (label to the
         * node's right) the same choices map to top/bottom edge instead. See the
         * .qtype_graph-floatinglabel--align-* rules in styles.css.
         *
         * @param {Element} wrap the .qtype_graph-floatinglabel element.
         * @param {string} [align] one of TEXT_ALIGNS; anything else means DEFAULT_TEXT_ALIGN.
         */
        function applyFloatingLabelTextAlign(wrap, align) {
            wrap.dataset.textalign = TEXT_ALIGNS.includes(align) ? align : DEFAULT_TEXT_ALIGN;
            wrap.classList.toggle('qtype_graph-floatinglabel--align-left', wrap.dataset.textalign === 'left');
            wrap.classList.toggle('qtype_graph-floatinglabel--align-right', wrap.dataset.textalign === 'right');
        }

        /**
         * Sets a node's fill (--node-color) and, if given, an explicit border color
         * that overrides the CSS default (a darkened shade of the fill - see
         * .qtype_graph-node's border rule in styles.css) - some COLORS entries pair
         * a fill with a deliberately different, not just darker, border.
         *
         * @param {Element} el the .qtype_graph-node element.
         * @param {string} bgColor
         * @param {string} [borderColor]
         */
        function applyNodeColors(el, bgColor, borderColor) {
            el.style.setProperty('--node-color', bgColor || COLORS[0].bg);
            if (borderColor) {
                el.style.setProperty('--node-border-color', borderColor);
            } else {
                el.style.removeProperty('--node-border-color');
            }
        }

        /**
         * Sets (or clears) one node's own text color, read by .qtype_graph-node
         * and everything nested inside it (its text/select/blank inputs) via the
         * shared --item-text-color custom property - see styles.css. Falls back to
         * --qtype-graph-canvas-text (the question-level default) when cleared.
         *
         * @param {Element} el the .qtype_graph-node element.
         * @param {string} color hex color, or '' to clear.
         */
        function applyNodeTextColor(el, color) {
            if (color) {
                el.style.setProperty('--item-text-color', color);
            } else {
                el.style.removeProperty('--item-text-color');
            }
        }

        /**
         * Sets (or clears) one edge's own label text color, the same
         * --item-text-color mechanism as applyNodeTextColor() above, set on the
         * edge's own <g> instead of a node.
         *
         * @param {SVGElement} group the edge's .qtype_graph-edge-group <g>.
         * @param {string} color hex color, or '' to clear.
         */
        function applyEdgeTextColor(group, color) {
            if (color) {
                group.style.setProperty('--item-text-color', color);
            } else {
                group.style.removeProperty('--item-text-color');
            }
        }

        /**
         * Sets (or clears) one floating label's own text color. Unlike
         * applyNodeTextColor()/applyEdgeTextColor() above, clearing always writes
         * the literal 'initial' rather than removing the property outright - the
         * floating label wrap is a CHILD of its node's own element (see
         * createNode()), so a plain removeProperty() would let --item-text-color
         * inherit from the node instead, bleeding the node's own text color into
         * this visually unrelated chip (see styles.css's
         * .qtype_graph-floatinglabel-text comment). 'initial' resets the
         * inherited value too, forcing var() back to its own fallback.
         *
         * @param {Element} wrap the .qtype_graph-floatinglabel element.
         * @param {string} color hex color, or '' to clear.
         */
        function applyFloatingLabelTextColor(wrap, color) {
            wrap.style.setProperty('--item-text-color', color || 'initial');
        }

        function createNode(left, top, text, color, locked, id, shape, borderColor, floatingLabel,
                textColor, floatingLabelTextColor, textAlign, floatingLabelTextAlign) {
            if (!id) {
                nodeCounter += 1;
                id = `node-${Date.now().toString(36)}-${nodeCounter}`;
            }

            const el = document.createElement('div');
            el.className = 'qtype_graph-node';
            if (locked) {
                el.classList.add('qtype_graph-node--locked');
            }
            el.style.left = `${left}px`;
            el.style.top = `${top}px`;
            applyNodeColors(el, color, borderColor);
            applyNodeTextColor(el, textColor || '');
            applyShape(el, shape);
            applyTextAlign(el, textAlign);

            let textEl;
            if (locked && attemptMode && hasBlankTokens(text)) {
                textEl = document.createElement('span');
                textEl.className = 'qtype_graph-node-text';
                textEl.dataset.maxWords = String(DEFAULT_MAX_WORDS);
                renderLabelSegments(textEl, text, 'node', id, editable, opts.getBlankValue, opts.onBlankChange);
            } else if (!locked && attemptMode && newNodeContentType === 'text') {
                // Fixed, non-editable content (question-level "New node content" setting) -
                // the student cannot type or choose anything for this node; only whether
                // they add it, and how they connect it, is part of their answer. text is
                // whatever was seeded at creation (see addConnectedBtn) or previously saved.
                textEl = document.createElement('span');
                textEl.className = 'qtype_graph-node-text';
                textEl.contentEditable = 'false';
                textEl.textContent = text || newNodeContentValue;
            } else if (!locked && attemptMode && newNodeContentType === 'select') {
                textEl = document.createElement('select');
                textEl.className = 'qtype_graph-node-text qtype_graph-node-text-select';
                textEl.disabled = !editable;
                const options = splitOptions(newNodeContentValue);
                const placeholderOpt = document.createElement('option');
                placeholderOpt.value = '';
                placeholderOpt.textContent = '—';
                textEl.appendChild(placeholderOpt);
                options.forEach((opt) => {
                    const optionEl = document.createElement('option');
                    optionEl.value = opt;
                    optionEl.textContent = opt;
                    textEl.appendChild(optionEl);
                });
                textEl.value = options.includes(text) ? text : '';
                textEl.addEventListener('mousedown', (e) => e.stopPropagation());
                textEl.addEventListener('click', (e) => e.stopPropagation());
                textEl.addEventListener('change', () => {
                    notifyChange();
                });
            } else if (!locked && attemptMode) {
                // 'input' - today's free-text behaviour; newNodeContentValue (if set)
                // becomes the placeholder instead of the hardcoded "Nuevo nodo".
                textEl = document.createElement('input');
                textEl.type = 'text';
                textEl.className = 'qtype_graph-node-text qtype_graph-node-text-input';
                textEl.placeholder = newNodeContentValue || 'Nuevo nodo';
                textEl.dataset.maxWords = String(DEFAULT_MAX_WORDS);
                textEl.value = text || '';
                textEl.readOnly = !editable;
                autosizeTextInput(textEl);
                textEl.addEventListener('mousedown', (e) => e.stopPropagation());
                textEl.addEventListener('click', (e) => e.stopPropagation());
                textEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        textEl.blur();
                    }
                });
                textEl.addEventListener('input', () => {
                    const maxWords = parseInt(textEl.dataset.maxWords, 10) || DEFAULT_MAX_WORDS;
                    const limited = limitWordsPlain(textEl.value, maxWords);
                    if (limited !== textEl.value) {
                        textEl.value = limited;
                    }
                    autosizeTextInput(textEl);
                    if (activeNodeId === id) {
                        nodeTextInput.value = textEl.value;
                    }
                    notifyChange();
                });
            } else {
                textEl = document.createElement('span');
                textEl.className = 'qtype_graph-node-text';
                textEl.contentEditable = 'false';
                textEl.dataset.maxWords = String(DEFAULT_MAX_WORDS);
                textEl.textContent = text || 'Nuevo nodo';
            }

            el.appendChild(textEl);

            // "Floating label": an optional extra piece of content next to a leaf node
            // (no outgoing edge) in tree mode - see isLeafNode()/updateFloatingLabelVisibility()
            // below. Appended as a CHILD of `el` (position: absolute in styles.css) rather than
            // a separate canvas-level overlay like .qtype_graph-levellabel uses, so it tracks
            // this node's position/drag/relayout automatically via plain CSS, no relayout math
            // needed. Follows the exact same {{T_INPUT}}/[[opt1;opt2]] blank grammar as node
            // text - see CLAUDE.md.
            const floatingLabelText = floatingLabel || '';
            const floatingLabelWrap = document.createElement('div');
            floatingLabelWrap.className = 'qtype_graph-floatinglabel';
            applyFloatingLabelTextColor(floatingLabelWrap, floatingLabelTextColor || '');
            applyFloatingLabelTextAlign(floatingLabelWrap, floatingLabelTextAlign);
            const floatingLabelEl = document.createElement('span');
            floatingLabelEl.className = 'qtype_graph-floatinglabel-text';
            if (attemptMode && hasBlankTokens(floatingLabelText)) {
                renderLabelSegments(floatingLabelEl, floatingLabelText, 'floatingLabel', id,
                        editable, opts.getBlankValue, opts.onBlankChange);
            } else {
                floatingLabelEl.textContent = floatingLabelText;
            }
            floatingLabelWrap.appendChild(floatingLabelEl);
            if (!attemptMode) {
                // Editor mode only - opens openFloatingLabelMenu() (see its own click-vs-
                // node-drag stopPropagation reasoning below). In attempt mode the wrap either
                // holds plain read-only text or blank inputs/selects that already
                // stopPropagation themselves (renderLabelSegments()), so no listener here.
                floatingLabelWrap.classList.add('qtype_graph-floatinglabel--clickable');
                floatingLabelWrap.addEventListener('mousedown', (e) => e.stopPropagation());
                floatingLabelWrap.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openFloatingLabelMenu(id);
                });
            }
            el.appendChild(floatingLabelWrap);

            graphContent.appendChild(el);

            const record = {
                id, el, textEl, edges: new Set(), locked: !!locked,
                floatingLabel: floatingLabelText, floatingLabelWrap, floatingLabelEl,
            };
            nodes.set(id, record);
            setupNode(record);
            updateFloatingLabelVisibility(record);
            return id;
        }

        function setupNode(record) {
            const node = record.el;

            if (!editable) {
                // Read-only (e.g. quiz review): nothing is clickable at all, except
                // the trail highlight below, which has nothing to do with editing.
                if (showTrail) {
                    node.addEventListener('click', (e) => {
                        e.stopPropagation();
                        showTrailFrom(record.id);
                    });
                }
                return;
            }

            if (record.locked) {
                // Locked (teacher-authored) nodes can only be used as a connection
                // anchor - no drag, no text/color edit, no delete.
                node.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openMenu(record.id);
                });
                // Registered after the listener above so it fires after openMenu()'s own
                // closeMenus() call - otherwise that call would clear the highlight this
                // same click just set.
                if (showTrail) {
                    node.addEventListener('click', (e) => {
                        e.stopPropagation();
                        showTrailFrom(record.id);
                    });
                }
                return;
            }

            const textEl = record.textEl;
            let dragState = null;

            node.addEventListener('mousedown', (e) => {
                if (node.classList.contains('qtype_graph-node--editing')) {
                    return;
                }
                e.stopPropagation();
                dragState = {
                    startX: e.clientX,
                    startY: e.clientY,
                    startLeft: node.offsetLeft,
                    startTop: node.offsetTop,
                    moved: false,
                };
                e.preventDefault();
            });

            window.addEventListener('mousemove', (e) => {
                if (!dragState) {
                    return;
                }
                const dx = e.clientX - dragState.startX;
                const dy = e.clientY - dragState.startY;
                if (!dragState.moved && Math.hypot(dx, dy) > CLICK_THRESHOLD) {
                    dragState.moved = true;
                    if (mode === 'graph') {
                        node.classList.add('qtype_graph-node--dragging');
                        node.style.transition = 'none';
                    }
                    closeMenus();
                }
                if (!dragState.moved || mode !== 'graph') {
                    return;
                }

                node.style.left = `${dragState.startLeft + dx / zoom}px`;
                node.style.top = `${dragState.startTop + dy / zoom}px`;
                updateEdgesFor(record.id);
            });

            window.addEventListener('mouseup', () => {
                if (!dragState) {
                    return;
                }
                if (dragState.moved) {
                    node.classList.remove('qtype_graph-node--dragging');
                    node.style.transition = '';
                    notifyChange();
                } else {
                    openMenu(record.id);
                }
                dragState = null;
            });

            if (!attemptMode) {
                node.addEventListener('dblclick', () => {
                    closeMenus();
                    node.classList.add('qtype_graph-node--editing');
                    textEl.contentEditable = 'true';
                    textEl.focus();
                    placeCaretAtEnd(textEl);
                });

                textEl.addEventListener('input', () => {
                    limitWords(textEl);
                    if (activeNodeId === record.id) {
                        nodeTextInput.value = textEl.textContent;
                    }
                });

                textEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        textEl.blur();
                    }
                });

                textEl.addEventListener('blur', () => {
                    node.classList.remove('qtype_graph-node--editing');
                    textEl.contentEditable = 'false';
                    if (!textEl.textContent.trim()) {
                        textEl.textContent = 'Nuevo nodo';
                    }
                    if (activeNodeId === record.id) {
                        nodeTextInput.value = textEl.textContent;
                    }
                    notifyChange();
                });
            }

            // Registered last so it fires after the mouseup handler above's own
            // openMenu()/closeMenus() call - see the locked-node branch's comment above.
            if (showTrail) {
                node.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showTrailFrom(record.id);
                });
            }
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeMenus();
            }
        });

        function clear() {
            nodes.forEach((record) => record.el.remove());
            nodes.clear();
            edges.splice(0, edges.length).forEach((edge) => edge.group.remove());
            closeMenus();
            clearLevelLabels();
        }

        function serialize() {
            return {
                mode,
                orientation,
                lineStyle,
                // Only the canvas that owns this question's shared style settings
                // (isCanvasSettingsOwner - see its declaration above) embeds them
                // here - purely so they travel along when this JSON is copy/pasted
                // or exported/imported elsewhere (the standalone helper page's
                // "Copiar al portapapeles"/"Guardar como .json", or Moodle's own
                // JSON panel "Construir grafo" - see hydrate() below), never as a
                // second source of truth: the Moodle edit form's hidden
                // showgrid/bgcolor/gridcolor/levellabelsize/showlevellabels/
                // shownodetrail/levellabelsjson fields (written by the gear
                // panel and the level-label click-menu) remain what actually
                // gets saved. Irrelevant to grading - classes/grading.php and
                // answer_matcher.php only ever read nodes/edges off this object,
                // never these.
                ...(isCanvasSettingsOwner ? {
                    showGrid: canvasStyle.showGrid,
                    bgColor: canvasStyle.bgColor,
                    gridColor: canvasStyle.gridColor,
                    levelLabelSize: canvasStyle.levelLabelSize,
                    showLevelLabels: canvasStyle.showLevelLabels,
                    // Not part of canvasStyle - see its own seeding comment above.
                    showNodeTrail: canvasShowNodeTrailCheckbox.checked,
                    levelLabelOverrides,
                } : {}),
                nodes: [...nodes.values()].map((record) => ({
                    id: record.id,
                    left: parseFloat(record.el.style.left) || 0,
                    top: parseFloat(record.el.style.top) || 0,
                    text: getRecordText(record),
                    color: getComputedStyle(record.el).getPropertyValue('--node-color').trim(),
                    // Read off the inline style (not getComputedStyle) so an unset override
                    // serializes as '' rather than locking in whatever shade the CSS fallback
                    // (a darkened --node-color, see styles.css) computed to at save time.
                    bordercolor: record.el.style.getPropertyValue('--node-border-color').trim(),
                    shape: record.el.dataset.shape || DEFAULT_SHAPE,
                    textalign: record.el.dataset.textalign || DEFAULT_TEXT_ALIGN,
                    locked: !!record.locked,
                    floatingLabel: record.floatingLabel || '',
                    textcolor: record.el.style.getPropertyValue('--item-text-color').trim(),
                    // 'initial' is applyFloatingLabelTextColor()'s own sentinel for "no color
                    // of its own" (see that function's docblock) - never a real saved value.
                    floatingLabelTextColor: (() => {
                        const raw = record.floatingLabelWrap.style.getPropertyValue('--item-text-color').trim();
                        return raw === 'initial' ? '' : raw;
                    })(),
                    floatingLabelTextAlign: record.floatingLabelWrap.dataset.textalign || DEFAULT_TEXT_ALIGN,
                })),
                edges: edges.map((edge) => ({
                    id: edge.id, from: edge.fromId, to: edge.toId, label: edge.label, locked: !!edge.locked,
                    textcolor: edge.group.style.getPropertyValue('--item-text-color').trim(),
                    textalign: edge.textAlign || DEFAULT_TEXT_ALIGN,
                })),
            };
        }

        function hydrate(data) {
            suppress = true;
            clear();
            const nodeList = Array.isArray(data.nodes) ? data.nodes : [];
            nodeList.forEach((n) => {
                createNode(n.left || 0, n.top || 0, n.text, n.color, !!n.locked, n.id, n.shape, n.bordercolor,
                        n.floatingLabel, n.textcolor, n.floatingLabelTextColor, n.textalign,
                        n.floatingLabelTextAlign);
            });
            const edgeList = Array.isArray(data.edges) ? data.edges : [];
            edgeList.forEach((e) => {
                if (nodes.has(e.from) && nodes.has(e.to)) {
                    createEdge(e.from, e.to, e.label || '', !!e.locked, e.id, e.textcolor, e.textalign);
                }
            });
            if (data.mode === 'tree') {
                setMode('tree', true);
            }
            if (data.orientation === 'horizontal') {
                setOrientation('horizontal', true);
            }
            if (data.lineStyle === 'orthogonal') {
                setLineStyle('orthogonal', true);
            }
            // Embedded showGrid/bgColor/gridColor/levelLabelSize/showLevelLabels/
            // showNodeTrail (see serialize() above) - only read on the one canvas
            // that owns these settings, and only ever
            // applied visually here (broadcast to every canvas via
            // editorRegistry, same as applyCanvasSettings() below, but never the
            // hidden-field write or form-dirty mark that function also does).
            // Deliberately inert that way, since hydrate() also runs on plain
            // page load (initEditor()'s initial hydrate(), which must never mark
            // the form dirty just from loading) - the "Construir grafo" button,
            // the only caller where a user actually asked to apply pasted JSON,
            // explicitly calls applyCanvasSettings() itself right after hydrate()
            // to persist what this just applied visually.
            if (isCanvasSettingsOwner) {
                const stylePatch = {};
                if (typeof data.showGrid === 'boolean') {
                    stylePatch.showGrid = data.showGrid;
                    if (canvasShowGridCheckbox) {
                        canvasShowGridCheckbox.checked = data.showGrid;
                    }
                }
                if (typeof data.bgColor === 'string') {
                    stylePatch.bgColor = data.bgColor;
                    if (canvasBgColorInput) {
                        canvasBgColorInput.value = data.bgColor;
                        if (canvasBgColorPicker && /^#[0-9a-fA-F]{6}$/.test(data.bgColor)) {
                            canvasBgColorPicker.value = data.bgColor;
                        }
                    }
                }
                if (typeof data.gridColor === 'string') {
                    stylePatch.gridColor = data.gridColor;
                    if (canvasGridColorInput) {
                        canvasGridColorInput.value = data.gridColor;
                        if (canvasGridColorPicker && /^#[0-9a-fA-F]{6}$/.test(data.gridColor)) {
                            canvasGridColorPicker.value = data.gridColor;
                        }
                    }
                }
                if (typeof data.levelLabelSize === 'number' || typeof data.levelLabelSize === 'string') {
                    stylePatch.levelLabelSize = data.levelLabelSize;
                    if (canvasLevelLabelSizeInput) {
                        canvasLevelLabelSizeInput.value = data.levelLabelSize;
                    }
                }
                if (typeof data.showLevelLabels === 'boolean') {
                    stylePatch.showLevelLabels = data.showLevelLabels;
                    if (canvasShowLevelLabelsCheckbox) {
                        canvasShowLevelLabelsCheckbox.checked = data.showLevelLabels;
                    }
                }
                if (Object.keys(stylePatch).length) {
                    editorRegistry.forEach((editor) => editor.setCanvasStyle(stylePatch));
                }
                // showNodeTrail isn't part of setCanvasStyle() either (it has no
                // visual effect on this canvas at all - see its own seeding
                // comment above) - just seed the checkbox here; applyCanvasSettings()
                // is what the "Construir grafo" button calls afterward to persist it.
                if (typeof data.showNodeTrail === 'boolean' && canvasShowNodeTrailCheckbox) {
                    canvasShowNodeTrailCheckbox.checked = data.showNodeTrail;
                }
                // levelLabelOverrides isn't part of setCanvasStyle()'s patch (a
                // separate editor API method, setLevelLabelOverrides() above) -
                // same visual-only, broadcast-but-don't-persist treatment as the
                // rest of this block; applyLevelLabelOverrides() (see its
                // declaration above) is what the "Construir grafo" button calls
                // afterward to persist it.
                if (Array.isArray(data.levelLabelOverrides)) {
                    editorRegistry.forEach((editor) => editor.setLevelLabelOverrides(data.levelLabelOverrides));
                }
            }
            applyTransform();
            suppress = false;
        }

        /**
         * Directly set one node's text by id, without a full hydrate (keeps this
         * editor's own zoom/pan/menu state untouched). Used by a sibling editor's
         * "Marcar como input" button to clear the matching node here. No-ops if
         * no node with this id exists in this editor.
         *
         * @param {string} id
         * @param {string} text
         * @return {boolean} whether a matching node was found and updated.
         */
        function setNodeText(id, text) {
            const record = nodes.get(id);
            if (!record) {
                return false;
            }
            setRecordText(record, text);
            notifyChange();
            return true;
        }

        /**
         * Directly set one edge's label by id, without a full hydrate. Same
         * purpose/caller as setNodeText above, for edges.
         *
         * @param {string} id
         * @param {string} text
         * @return {boolean} whether a matching edge was found and updated.
         */
        function setEdgeLabel(id, text) {
            const edge = edges.find((e) => e.id === id);
            if (!edge) {
                return false;
            }
            edge.label = text;
            edge.textEl.textContent = text;
            notifyChange();
            return true;
        }

        /**
         * Directly set one node's floating label by id, without a full hydrate. Same
         * purpose/caller as setNodeText/setEdgeLabel above ("Marcar como input/selector"
         * sync, see addSyncTarget()), for the floating-label menu's own pair of buttons.
         *
         * @param {string} id
         * @param {string} text
         * @return {boolean} whether a matching node was found and updated.
         */
        function setFloatingLabel(id, text) {
            const record = nodes.get(id);
            if (!record) {
                return false;
            }
            setRecordFloatingLabelText(record, text);
            notifyChange();
            return true;
        }

        /**
         * Draw correct/incorrect feedback markers (a colored outline on a node, a
         * colored/dashed stroke on an edge, or on a leaf node's floating label) on top of
         * whatever nodes/edges/labels the caller identifies by id - never anything else,
         * since a plain structural node/edge has no "answer" to mark right or wrong. Only
         * ever called in attempt mode, once per feedback render, so any markers from a
         * previous render are cleared first rather than accumulated.
         *
         * @param {Object} [feedback] {nodes: {id: bool}, edges: {id: bool}, floatingLabels: {id: bool}} -
         *      true = correct, false = incorrect.
         */
        function markFeedback(feedback) {
            nodes.forEach((record) => {
                record.el.classList.remove('qtype_graph-node--feedback-correct', 'qtype_graph-node--feedback-incorrect');
                record.floatingLabelWrap.classList.remove(
                        'qtype_graph-floatinglabel--feedback-correct', 'qtype_graph-floatinglabel--feedback-incorrect');
            });
            edges.forEach((edge) => {
                edge.group.classList.remove(
                        'qtype_graph-edge-group--feedback-correct', 'qtype_graph-edge-group--feedback-incorrect');
            });
            if (!feedback) {
                return;
            }
            Object.entries(feedback.nodes || {}).forEach(([id, correct]) => {
                const record = nodes.get(id);
                if (record) {
                    record.el.classList.add(correct ?
                            'qtype_graph-node--feedback-correct' : 'qtype_graph-node--feedback-incorrect');
                }
            });
            Object.entries(feedback.edges || {}).forEach(([id, correct]) => {
                const edge = edges.find((e) => e.id === id);
                if (edge) {
                    edge.group.classList.add(correct ?
                            'qtype_graph-edge-group--feedback-correct' : 'qtype_graph-edge-group--feedback-incorrect');
                }
            });
            Object.entries(feedback.floatingLabels || {}).forEach(([id, correct]) => {
                const record = nodes.get(id);
                if (record) {
                    record.floatingLabelWrap.classList.add(correct ?
                            'qtype_graph-floatinglabel--feedback-correct' : 'qtype_graph-floatinglabel--feedback-incorrect');
                }
            });
        }

        const api = {
            hydrate, serialize, setNodeText, setEdgeLabel, setFloatingLabel, setLayout, markFeedback, addSyncTarget,
            setCanvasStyle, setLevelLabelOverrides,
        };
        editorRegistry.set(root.id, api);
        return api;
    }

    /**
     * Parse a hidden field's raw JSON value into a {nodes, edges} shape,
     * tolerating malformed/empty JSON (returns empty arrays instead).
     *
     * @param {string} value raw hidden-field value.
     * @return {{nodes: Array, edges: Array}}
     */
    function safeParseGraph(value) {
        try {
            const data = JSON.parse(value || '{}');
            return {
                nodes: Array.isArray(data.nodes) ? data.nodes : [],
                edges: Array.isArray(data.edges) ? data.edges : [],
                mode: data.mode || 'graph',
            };
        } catch (e) {
            return {nodes: [], edges: [], mode: 'graph'};
        }
    }

    /**
     * Parse a level-label overrides hidden/data field's raw JSON value into an
     * array, tolerating malformed/empty JSON (returns [] instead) - see
     * setLevelLabelOverrides()/renderLevelLabels() in createGraphEditor() above.
     *
     * @param {string} value raw JSON value.
     * @return {Array}
     */
    function safeParseLevelLabelOverrides(value) {
        try {
            const data = JSON.parse(value || '[]');
            return Array.isArray(data) ? data : [];
        } catch (e) {
            return [];
        }
    }

    /**
     * Index a list of {id: ...} records by id.
     *
     * @param {Array} items
     * @return {Map}
     */
    function indexById(items) {
        const map = new Map();
        items.forEach((item) => {
            if (item && item.id) {
                map.set(item.id, item);
            }
        });
        return map;
    }

    /**
     * Check one result-graph answer field for the usual authoring mistakes
     * and push any problem found onto `issues`.
     *
     * @param {string} itemDescription human-readable "el nodo \"X\"" / "la conexión \"X\"" prefix.
     * @param {string} acceptedRaw the result-graph node/edge's text for this blank.
     * @param {Array} issues {severity, message} objects to push onto.
     * @param {boolean} [numeric] whether the default-graph blank is a numeric {{N_INPUT}} one.
     */
    function checkAnswerField(itemDescription, acceptedRaw, issues, numeric) {
        const spec = parseAcceptedAnswers(acceptedRaw);
        const trimmed = typeof acceptedRaw === 'string' ? acceptedRaw.trim() : '';
        if (spec.type === 'unset') {
            issues.push({severity: 'error', message: `${itemDescription} no tiene ninguna respuesta definida en el grafo de respuesta.`});
            return;
        }
        if (trimmed === BLANK_MARKER || trimmed === NUMERIC_BLANK_MARKER) {
            issues.push({severity: 'error',
                    message: `${itemDescription} todavía tiene el marcador ${trimmed} sin completar en el grafo de respuesta.`});
            return;
        }
        if (WHOLE_SELECT_RE.test(trimmed)) {
            issues.push({severity: 'error', message: `${itemDescription} todavía tiene la lista de opciones ` +
                    '[[...]] sin reemplazar por la respuesta aceptada en el grafo de respuesta.'});
            return;
        }
        if (spec.type === 'exact' && ANSWER_LIST_RE.test(trimmed) && spec.answers.length === 0) {
            issues.push({severity: 'warning',
                    message: `${itemDescription} tiene una lista de respuestas aceptadas {{...}} sin ningún ` +
                            'valor dentro.'});
        }
        if (numeric && spec.type === 'exact') {
            const invalid = spec.answers.filter((answer) => !isValidNumericAnswer(answer));
            if (invalid.length > 0) {
                issues.push({severity: 'error',
                        message: `${itemDescription} es numérico, pero su respuesta aceptada no es un número válido ` +
                                `(usa valor o valor:tolerancia, p. ej. 3,14:0,01): ${invalid.join('; ')}`});
            }
        }
    }

    /**
     * Find the result-graph edge that anchors a result-graph-only node to a
     * node id that DOES exist in the default graph. Mirrors
     * classes/grading.php's find_anchor() (which only needs the anchor id;
     * this also returns the edge itself, so callers can avoid double-flagging
     * it as an unrelated "orphan edge").
     *
     * @param {string} nodeId the result-only node's id.
     * @param {Array} resultEdges the result graph's raw edges list.
     * @param {Set} defaultNodeIds ids present in the default graph.
     * @return {Object|null} the anchoring edge, or null if none found.
     */
    function findAnchorEdge(nodeId, resultEdges, defaultNodeIds) {
        for (const edge of resultEdges) {
            if (edge.from === nodeId && defaultNodeIds.has(edge.to)) {
                return edge;
            }
            if (edge.to === nodeId && defaultNodeIds.has(edge.from)) {
                return edge;
            }
        }
        return null;
    }

    /**
     * Traverse the default graph and result graph together, matched by id,
     * and report every mismatch the "Automatic grading" design (see
     * CLAUDE.md) would silently misgrade or ignore.
     *
     * @param {{nodes: Array, edges: Array}} defaultData
     * @param {{nodes: Array, edges: Array}} resultData
     * @param {boolean} allowAddNodes whether this question allows students to add new nodes.
     * @return {Array} {severity: 'error'|'warning'|'info', message} objects.
     */
    function validateGraphs(defaultData, resultData, allowAddNodes) {
        const issues = [];
        const resultNodes = indexById(resultData.nodes);
        const resultEdges = indexById(resultData.edges);
        const defaultNodeIds = new Set(defaultData.nodes.map((n) => n.id));
        const defaultEdgeIds = new Set(defaultData.edges.map((e) => e.id));
        // Leaf = no outgoing edge - see isLeafNode() in createGraphEditor() above; a
        // floating label only ever applies to one, and only in tree mode.
        const parentIds = new Set(defaultData.edges.map((e) => e.from));

        defaultData.nodes.forEach((node) => {
            // A blank node's own text is just its marker ({{T_INPUT}}, {{N_INPUT}} or [[opt1,opt2,...]]),
            // not a human-readable label - show its id instead.
            const label = hasBlankTokens(node.text) ? node.id : (node.text || node.id);
            const resultNode = resultNodes.get(node.id);
            if (!resultNode) {
                issues.push({severity: 'info',
                        message: `El nodo "${label}" no existe en el grafo de respuesta: se espera que el alumno lo elimine.`});
                return;
            }
            if (hasBlankTokens(node.text)) {
                checkAnswerField(`El input del nodo "${label}"`, stripDefaultContext(node.text, resultNode.text), issues,
                        isNumericBlank(node.text));
            }
            const isLeaf = defaultData.mode === 'tree' && !parentIds.has(node.id);
            if (isLeaf && hasBlankTokens(node.floatingLabel)) {
                checkAnswerField(`La etiqueta flotante del nodo "${label}"`,
                        stripDefaultContext(node.floatingLabel, resultNode.floatingLabel), issues,
                        isNumericBlank(node.floatingLabel));
            }
        });

        defaultData.edges.forEach((edge) => {
            const label = hasBlankTokens(edge.label) ? edge.id : (edge.label || edge.id);
            const resultEdge = resultEdges.get(edge.id);
            if (!resultEdge) {
                issues.push({severity: 'info', message: `La conexión "${label}" no existe en el grafo de respuesta: ` +
                        'se espera que el alumno la elimine (borrando uno de sus nodos).'});
                return;
            }
            if (hasBlankTokens(edge.label)) {
                checkAnswerField(`El input de la conexión "${label}"`,
                        stripDefaultContext(edge.label, resultEdge.label), issues, isNumericBlank(edge.label));
            }
        });

        // Tracks anchor edges consumed below, so the generic orphan-edge check further down
        // doesn't also flag "this edge is ignored" on the very edge that makes a new-node
        // item gradable.
        const usedAnchorEdgeIds = new Set();

        resultData.nodes.forEach((node) => {
            if (defaultNodeIds.has(node.id)) {
                return;
            }
            const label = node.text || node.id;
            if (!allowAddNodes) {
                issues.push({severity: 'warning', message: `El nodo nuevo "${label}" del grafo de respuesta nunca podrá ` +
                        'calificarse: esta pregunta no permite que los alumnos agreguen nodos nuevos.'});
                return;
            }
            const anchorEdge = findAnchorEdge(node.id, resultData.edges, defaultNodeIds);
            if (!anchorEdge) {
                issues.push({severity: 'warning', message: `El nodo nuevo "${label}" del grafo de respuesta no está ` +
                        'conectado a ningún nodo existente: no se puede calificar automáticamente (las cadenas de ' +
                        'varios nodos nuevos conectados entre sí todavía no son compatibles).'});
                return;
            }
            usedAnchorEdgeIds.add(anchorEdge.id);
            const anchorId = anchorEdge.from === node.id ? anchorEdge.to : anchorEdge.from;
            issues.push({severity: 'info', message: `El nodo nuevo "${label}" se calificará correcto si el alumno ` +
                    `agrega un nodo con esa respuesta, conectado al nodo "${anchorId}".`});
        });
        resultData.edges.forEach((edge) => {
            if (!defaultEdgeIds.has(edge.id) && !usedAnchorEdgeIds.has(edge.id)) {
                issues.push({severity: 'warning', message: `El grafo de respuesta tiene una conexión "${edge.label || edge.id}" ` +
                        'que no existe en el grafo por defecto: se ignorará al calificar.'});
            }
        });

        return issues;
    }

    /**
     * Render the result of validateGraphs() into an output container.
     *
     * @param {Element} output
     * @param {Array} issues
     */
    function renderValidationIssues(output, issues) {
        output.innerHTML = '';
        if (issues.length === 0) {
            const p = document.createElement('p');
            p.className = 'text-success';
            p.textContent = 'No se encontraron problemas.';
            output.appendChild(p);
            return;
        }
        const severityLabel = {error: 'Error', warning: 'Aviso', info: 'Info'};
        const severityClass = {error: 'text-danger', warning: 'text-warning', info: 'text-info'};
        const list = document.createElement('ul');
        issues.forEach((issue) => {
            const li = document.createElement('li');
            li.className = severityClass[issue.severity] || '';
            li.textContent = `${severityLabel[issue.severity] || ''}: ${issue.message}`;
            list.appendChild(li);
        });
        output.appendChild(list);
    }

    /**
     * Wire up a "validate" button that traverses the default graph and the
     * result graph together (see validateGraphs()) and prints the findings
     * into an output container. Purely an authoring-time aid - does not
     * affect grading, which runs server-side in classes/grading.php.
     *
     * @param {string} buttonId
     * @param {string} outputId
     * @param {string} defaultHiddenFieldId id of the default graph's hidden field.
     * @param {string} resultHiddenFieldId id of the result graph's hidden field.
     * @param {string} allowAddNodesFieldId id of the "allow students to add new nodes" checkbox.
     */
    function initValidation(buttonId, outputId, defaultHiddenFieldId, resultHiddenFieldId, allowAddNodesFieldId) {
        const button = document.getElementById(buttonId);
        const output = document.getElementById(outputId);
        const defaultField = document.getElementById(defaultHiddenFieldId);
        const resultField = document.getElementById(resultHiddenFieldId);
        const allowAddNodesField = document.getElementById(allowAddNodesFieldId);
        if (!button || !output || !defaultField || !resultField) {
            return;
        }
        button.addEventListener('click', (e) => {
            e.preventDefault();
            const allowAddNodes = !allowAddNodesField || allowAddNodesField.checked;
            const issues = validateGraphs(safeParseGraph(defaultField.value), safeParseGraph(resultField.value), allowAddNodes);
            renderValidationIssues(output, issues);
        });
    }

    /**
     * Wires the edit form's remaining node/connection text color control so
     * changing it immediately restyles every canvas belonging to this
     * question (default graph, result graph, and every alternate answer
     * graph, including ones added later via initAltAnswers) - not just the
     * one saved to the DB on next submit. Broadcasts to every editor
     * currently in editorRegistry rather than tracking specific container
     * ids, since alternates are created and removed dynamically after this
     * runs. Show grid/background color/grid color/level-label size/show
     * level labels have all moved off the edit form into the canvas's own
     * gear panel (see canvasSettingsFieldIds in createGraphEditor()) - each
     * side only ever patches the setCanvasStyle() keys it owns, see that
     * function's docblock.
     *
     * @param {string} [textColorFieldId] id of the node/connection text color text field.
     * @param {string} [textColorPickerId] id of its paired <input type="color"> swatch.
     */
    function initCanvasSettings(textColorFieldId, textColorPickerId) {
        const textColorField = document.getElementById(textColorFieldId);
        if (!textColorField) {
            return;
        }

        function broadcast() {
            editorRegistry.forEach((editor) => editor.setCanvasStyle({textColor: textColorField.value}));
        }

        const picker = document.getElementById(textColorPickerId);
        textColorField.addEventListener('input', () => {
            if (picker && /^#[0-9a-fA-F]{6}$/.test(textColorField.value)) {
                picker.value = textColorField.value;
            }
            broadcast();
        });
        if (picker) {
            picker.addEventListener('input', () => {
                textColorField.value = picker.value;
                broadcast();
            });
        }
    }

    /**
     * Full editing widget for the question edit form. Nothing is locked.
     *
     * @param {string} containerId id of the .qtype_graph-container element.
     * @param {string} hiddenFieldId id of the hidden form field to write the graph JSON into.
     * @param {string} [resetButtonId] id of a button that, when clicked, overwrites this editor's
     *                 graph with a copy of the graph currently held in `sourceHiddenFieldId`.
     * @param {string} [sourceHiddenFieldId] id of the hidden field to copy from on reset.
     * @param {string} [addInputTargetContainerId] container id of a sibling editor (typically the
     *                 result graph) whose matching node/edge gets cleared to '' whenever a node/edge
     *                 here is marked as a fill-in-the-blank input via the node/edge menu button.
     *                 Passing this also reveals that "Marcar como input" button in this editor's menus.
     *                 Whenever the mode/orientation/line-style toggles change here, the same values are
     *                 also pushed onto this sibling (see setLayout()), which is how the result graph
     *                 stays in lockstep with the default graph despite never exposing its own controls.
     * @param {Object} [canvasSettingsFieldIds] {showGrid, bgColor, gridColor, levelLabelSize,
     *                 showLevelLabels, showNodeTrail, levelLabelOverrides} mform hidden-field ids
     *                 (edit_graph_form.php) - only ever passed on the default graph's own initEditor()
     *                 call (never the result graph's, which already sets hasLayoutSource below), since
     *                 these are one shared setting for the whole question, edited from the canvas gear
     *                 panel and broadcast to every canvas via editorRegistry - see
     *                 canvasSettingsFieldIds in createGraphEditor().
     */
    function initEditor(containerId, hiddenFieldId, resetButtonId, sourceHiddenFieldId, addInputTargetContainerId,
            canvasSettingsFieldIds) {
        const root = document.getElementById(containerId);
        const hidden = document.getElementById(hiddenFieldId);
        if (!root || !hidden) {
            return;
        }

        // A source hidden field is only ever passed for the result graph's own initEditor()
        // call, which is also our signal that this editor must never choose its own
        // mode/orientation/line-style - it always mirrors whatever the source (default) graph
        // currently has (see the override below, and setLayout() for keeping it live afterwards).
        const hasLayoutSource = !!sourceHiddenFieldId;

        const editor = createGraphEditor(root, {
            editable: true,
            mode: 'editor',
            enableAddInput: !!addInputTargetContainerId,
            addInputTargetContainerId: addInputTargetContainerId || null,
            hideLayoutControls: hasLayoutSource,
            canvasSettingsFieldIds,
            onChange: (data) => {
                hidden.value = JSON.stringify(data);
            },
        });

        let initial = null;
        if (hidden.value) {
            try {
                const parsed = JSON.parse(hidden.value);
                if (parsed && Array.isArray(parsed.nodes) && parsed.nodes.length) {
                    initial = parsed;
                }
            } catch (e) {
                initial = null;
            }
        }
        if (!initial) {
            initial = {
                nodes: [{id: 'node-1', left: 120, top: 220, text: 'Nuevo nodo',
                        color: COLORS[0].bg, bordercolor: COLORS[0].border || '', locked: false}],
                edges: [],
                mode: 'graph',
                orientation: 'vertical',
                lineStyle: 'straight',
            };
        }

        if (hasLayoutSource) {
            let sourceGraph = {};
            try {
                sourceGraph = JSON.parse(document.getElementById(sourceHiddenFieldId).value || '{}') || {};
            } catch (e) {
                sourceGraph = {};
            }
            initial.mode = sourceGraph.mode || 'graph';
            initial.orientation = sourceGraph.orientation || 'vertical';
            initial.lineStyle = sourceGraph.lineStyle || 'straight';
        }

        editor.hydrate(initial);
        hidden.value = JSON.stringify(editor.serialize());

        if (resetButtonId && sourceHiddenFieldId) {
            const btn = document.getElementById(resetButtonId);
            const sourceHidden = document.getElementById(sourceHiddenFieldId);
            if (btn && sourceHidden) {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (btn.dataset.confirm && !window.confirm(btn.dataset.confirm)) {
                        return;
                    }
                    let data;
                    try {
                        data = JSON.parse(sourceHidden.value);
                    } catch (err) {
                        return;
                    }
                    if (!data || !Array.isArray(data.nodes)) {
                        return;
                    }
                    editor.hydrate(data);
                    hidden.value = JSON.stringify(editor.serialize());
                    const form = root.closest('form');
                    if (form) {
                        FormChangeChecker.markFormAsDirty(form);
                    }
                });
            }
        }
    }

    /**
     * Build the "teacher graph locked, student additions editable" widget
     * used by initAttempt() (the quiz attempt page). Merges the locked
     * teacherData with whatever response the caller seeds it with, and
     * exposes getResponse() to read back the current response payload (the
     * same {nodes, edges, removednodes, blanks} shape
     * classes/grading.php's evaluate() expects) at any time.
     *
     * @param {Element} root the .qtype_graph-container element.
     * @param {string} teacherJson the teacher-authored graph, as JSON.
     * @param {Object} opts
     * @param {boolean} [opts.readOnly] true to render non-editable.
     * @param {boolean} [opts.allowAddNodes] true if new nodes may be added.
     * @param {boolean} [opts.allowDeleteNodes] true if teacher-authored nodes may be deleted.
     * @param {boolean} [opts.showNodeTrail] true if clicking a node should highlight the
     *                  path (nodes/edges) back to its origin node - see showTrailFrom() in
     *                  createGraphEditor().
     * @param {boolean} [opts.allowDownloadImage] true to show the image-export (PNG/SVG)
     *                  button on this canvas's toolbar.
     * @param {boolean} [opts.allowChangeGraphType] true to show the graph/tree mode toggle.
     * @param {boolean} [opts.allowChangeOrientation] true to show the tree-mode orientation
     *                  (V/H) toggle.
     * @param {boolean} [opts.allowChangeLineStyle] true to show the connection line-style
     *                  (straight/orthogonal) toggle.
     * @param {string} [opts.initialResponseJson] a previously-saved response to seed from.
     * @param {Function} [opts.onResponseChange] (response) => void, called whenever the
     *                    response changes as a result of user interaction (never for the
     *                    initial render - callers needing the initial value should call
     *                    getResponse() themselves right after this returns).
     * @return {{editor: Object, getResponse: Function}}
     */
    function createAttemptEditor(root, teacherJson, opts) {
        opts = opts || {};
        const onResponseChange = opts.onResponseChange || null;

        let teacherData = {nodes: [], edges: []};
        try {
            const parsed = JSON.parse(teacherJson || '{}');
            if (parsed && Array.isArray(parsed.nodes)) {
                teacherData = parsed;
            }
        } catch (e) {
            teacherData = {nodes: [], edges: []};
        }
        const teacherIds = new Set(teacherData.nodes.map((n) => n.id));

        let studentData = {nodes: [], edges: []};
        if (opts.initialResponseJson) {
            try {
                const parsed = JSON.parse(opts.initialResponseJson);
                if (parsed && Array.isArray(parsed.nodes)) {
                    studentData = parsed;
                }
            } catch (e) {
                studentData = {nodes: [], edges: []};
            }
        }

        // Teacher nodes/edges the student has already deleted (only possible when
        // allowdeletenodes was on at the time). Kept out of every future hydrate so
        // they do not reappear, since teacherData is always re-merged in fresh.
        const removedTeacherIds = new Set(
                Array.isArray(studentData.removednodes) ?
                        studentData.removednodes.filter((id) => teacherIds.has(id)) : []);

        const merged = {
            nodes: [
                ...teacherData.nodes.filter((n) => !removedTeacherIds.has(n.id))
                        .map((n) => Object.assign({}, n, {locked: true})),
                ...studentData.nodes.map((n) => Object.assign({}, n, {locked: false})),
            ],
            edges: [
                ...(teacherData.edges || []).filter(
                        (e) => !removedTeacherIds.has(e.from) && !removedTeacherIds.has(e.to))
                        .map((e) => Object.assign({}, e, {locked: true})),
                ...(studentData.edges || []).map((e) => Object.assign({}, e, {locked: false})),
            ],
            mode: teacherData.mode || 'graph',
            orientation: teacherData.orientation || 'vertical',
            lineStyle: teacherData.lineStyle || 'straight',
        };

        let blankValues = (studentData && studentData.blanks && typeof studentData.blanks === 'object') ?
                Object.assign({}, studentData.blanks) : {};

        let lastResponse = null;

        function computeResponse(data) {
            const liveIds = new Set(data.nodes.map((n) => n.id));
            teacherIds.forEach((id) => {
                if (!liveIds.has(id)) {
                    removedTeacherIds.add(id);
                }
            });
            const studentNodes = data.nodes.filter((n) => !teacherIds.has(n.id));
            const studentEdges = data.edges.filter(
                    (e) => !(teacherIds.has(e.from) && teacherIds.has(e.to)));
            return {
                nodes: studentNodes,
                edges: studentEdges,
                removednodes: [...removedTeacherIds],
                blanks: blankValues,
            };
        }

        function updateResponse(data) {
            lastResponse = computeResponse(data);
            if (onResponseChange) {
                onResponseChange(lastResponse);
            }
        }

        const editor = createGraphEditor(root, {
            editable: !opts.readOnly,
            lockLayout: true,
            mode: 'attempt',
            allowAddNodes: opts.allowAddNodes !== false,
            allowDeleteNodes: opts.allowDeleteNodes !== false,
            showNodeTrail: !!opts.showNodeTrail,
            allowDownloadImage: !!opts.allowDownloadImage,
            allowChangeGraphType: !!opts.allowChangeGraphType,
            allowChangeOrientation: !!opts.allowChangeOrientation,
            allowChangeLineStyle: !!opts.allowChangeLineStyle,
            newNodeContentType: opts.newNodeContentType,
            newNodeContentValue: opts.newNodeContentValue,
            newEdgeContentType: opts.newEdgeContentType,
            newEdgeContentValue: opts.newEdgeContentValue,
            getBlankValue: (blankId) => blankValues[blankId],
            onBlankChange: (blankId, value) => {
                blankValues[blankId] = value;
                updateResponse(editor.serialize());
            },
            onChange: (data) => updateResponse(data),
        });

        editor.hydrate(merged);
        // Not routed through updateResponse()/onResponseChange: the initial render is not
        // a user-driven change, and initAttempt()'s caller relies on the hidden field being
        // left untouched (and the form not marked dirty) purely from loading the page.
        lastResponse = computeResponse(editor.serialize());

        return {editor, getResponse: () => lastResponse};
    }

    /**
     * Attempt-page widget: teacher graph locked, student additions editable.
     *
     * @param {string} containerId id of the .qtype_graph-container element. teacherjson,
     *                 feedback, and newnodecontenttype/newnodecontentvalue/
     *                 newedgecontenttype/newedgecontentvalue are all read from this
     *                 element's data-* attributes (set by renderer.php via
     *                 editor_ui::render()'s $dataattrs param) rather than taken as
     *                 arguments here, to keep this call's js_call_amd() payload well
     *                 under Moodle's ~1KB debugging() warning threshold - a graph of
     *                 any real size, or a sizeable feedback breakdown, crosses that
     *                 easily on its own.
     * @param {string} hiddenFieldId id of the response hidden field (nodesjson).
     * @param {boolean} readOnly true if the question is being displayed read-only (e.g. review).
     * @param {boolean} allowAddNodes true if the student may add new nodes.
     * @param {boolean} allowDeleteNodes true if the student may delete the teacher-authored nodes.
     * @param {boolean} showNodeTrail true if clicking a node should highlight the path
     *                  (nodes/edges) back to its origin node.
     * @param {boolean} allowDownloadImage true to show the image-export (PNG/SVG) button.
     * @param {boolean} allowChangeGraphType true to show the graph/tree mode toggle.
     * @param {boolean} allowChangeOrientation true to show the tree-mode orientation toggle.
     * @param {boolean} allowChangeLineStyle true to show the connection line-style toggle.
     */
    function initAttempt(containerId, hiddenFieldId, readOnly, allowAddNodes, allowDeleteNodes, showNodeTrail,
            allowDownloadImage, allowChangeGraphType, allowChangeOrientation, allowChangeLineStyle) {
        const root = document.getElementById(containerId);
        const hidden = document.getElementById(hiddenFieldId);
        if (!root || !hidden) {
            return;
        }

        const attempt = createAttemptEditor(root, root.dataset.teacherjson, {
            readOnly,
            allowAddNodes,
            allowDeleteNodes,
            showNodeTrail,
            allowDownloadImage,
            allowChangeGraphType,
            allowChangeOrientation,
            allowChangeLineStyle,
            newNodeContentType: root.dataset.newnodecontenttype,
            newNodeContentValue: root.dataset.newnodecontentvalue,
            newEdgeContentType: root.dataset.newedgecontenttype,
            newEdgeContentValue: root.dataset.newedgecontentvalue,
            initialResponseJson: hidden.value,
            onResponseChange: (response) => {
                hidden.value = JSON.stringify(response);
                const form = root.closest('form');
                if (form) {
                    FormChangeChecker.markFormAsDirty(form);
                }
            },
        });

        if (root.dataset.feedback) {
            let feedback = null;
            try {
                feedback = JSON.parse(root.dataset.feedback);
            } catch (e) {
                feedback = null;
            }
            if (feedback) {
                // newnodes is keyed by the student's own (teacher-unknown) node id, which
                // never collides with a teacher blank's id, so it can share the node bucket.
                attempt.editor.markFeedback({
                    nodes: Object.assign({}, feedback.nodes, feedback.newnodes),
                    edges: feedback.edges,
                    floatingLabels: feedback.floatinglabels,
                });
            }
        }

        if (readOnly) {
            root.classList.add('qtype_graph-container--readonly');
        }
    }

    /**
     * Wire up the edit form's "Alternate answer graphs" tool: an "add" button
     * that spins up extra fully-editable answer-graph canvases alongside the
     * primary one (id_resultgraphjson), for questions where more than one
     * final graph should be accepted as correct. Every alternate is stored as
     * one entry in a single JSON array hidden field (altHiddenFieldId) -
     * classes/grading.php grades the response against the primary graph and
     * every alternate, and keeps whichever gives the best score (see this
     * plugin's CLAUDE.md).
     *
     * Each alternate behaves exactly like the primary result graph: its own
     * mode/orientation/line-style controls are hidden and always mirror the
     * default graph's (via createGraphEditor's hideLayoutControls + the
     * default editor's addSyncTarget()), it has no "Marcar como input"
     * button of its own - only the default graph creates blanks, and doing so
     * there clears the matching node/edge in the primary graph AND every
     * alternate, since addSyncTarget() registers each one as a target - and
     * its own "Reiniciar al grafo por defecto" button overwrites just that
     * one alternate with a copy of the live default graph (mirroring the
     * primary result graph's reset button, wired separately in initEditor()).
     *
     * @param {string} addButtonId id of the "add alternate answer graph" button.
     * @param {string} listId id of the container alternate canvases are appended to.
     * @param {string} templateId id of the <template> holding one editor_ui::render() skeleton.
     * @param {string} altHiddenFieldId id of the hidden field holding the JSON array of alternates.
     * @param {string} defaultContainerId id of the default graph's .qtype_graph-container element -
     *                 looked up in editorRegistry to register each alternate as a sync target.
     * @param {string} defaultHiddenFieldId id of the default graph's hidden field, read for the
     *                 live mode/orientation/line-style every new alternate should start mirroring.
     */
    function initAltAnswers(addButtonId, listId, templateId, altHiddenFieldId, defaultContainerId,
            defaultHiddenFieldId) {
        const addButton = document.getElementById(addButtonId);
        const list = document.getElementById(listId);
        const template = document.getElementById(templateId);
        const altField = document.getElementById(altHiddenFieldId);
        const defaultField = document.getElementById(defaultHiddenFieldId);
        if (!addButton || !list || !template || !altField || !defaultField) {
            return;
        }

        const entries = [];
        let counter = 0;

        function writeAltField() {
            altField.value = JSON.stringify(entries.map((entry) => entry.editor.serialize()));
            const form = list.closest('form');
            if (form) {
                FormChangeChecker.markFormAsDirty(form);
            }
        }

        /**
         * @param {Object|null} initialGraph a previously-saved alternate to hydrate from, or
         *                       null for a brand new one.
         * @param {boolean} silent true to skip writeAltField() - used when rendering alternates
         *                   already present in altField.value on page load, so loading the page
         *                   does not itself mark the form dirty.
         */
        function addAltCanvas(initialGraph, silent) {
            counter += 1;

            const wrapper = document.createElement('div');
            wrapper.className = 'qtype_graph-altanswer';

            const heading = document.createElement('div');
            heading.className = 'qtype_graph-altanswer-heading';
            const title = document.createElement('span');
            title.className = 'qtype_graph-altanswer-title';
            title.textContent = `Grafo de respuesta alterna ${counter}`;
            const resetBtn = document.createElement('button');
            resetBtn.type = 'button';
            resetBtn.className = 'btn btn-outline-danger btn-sm';
            resetBtn.textContent = 'Reiniciar al grafo por defecto';
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'btn btn-outline-danger btn-sm';
            removeBtn.textContent = 'Quitar';
            const buttons = document.createElement('div');
            buttons.className = 'qtype_graph-altanswer-buttons';
            buttons.appendChild(resetBtn);
            buttons.appendChild(removeBtn);
            heading.appendChild(title);
            heading.appendChild(buttons);
            wrapper.appendChild(heading);

            const canvasRoot = template.content.firstElementChild.cloneNode(true);
            canvasRoot.id = `qtype_graph_alt_${Date.now()}_${counter}`;
            wrapper.appendChild(canvasRoot);

            list.appendChild(wrapper);

            const editor = createGraphEditor(canvasRoot, {
                editable: true,
                mode: 'editor',
                hideLayoutControls: true,
                onChange: () => writeAltField(),
            });

            const initial = (initialGraph && Array.isArray(initialGraph.nodes) && initialGraph.nodes.length) ?
                    initialGraph :
                    {
                        nodes: [{id: `node-${Date.now().toString(36)}`, left: 120, top: 220,
                                text: 'Nuevo nodo', color: COLORS[0].bg, bordercolor: COLORS[0].border || '',
                                locked: false}],
                        edges: [],
                    };
            let sourceGraph = {};
            try {
                sourceGraph = JSON.parse(defaultField.value || '{}') || {};
            } catch (e) {
                sourceGraph = {};
            }
            initial.mode = sourceGraph.mode || 'graph';
            initial.orientation = sourceGraph.orientation || 'vertical';
            initial.lineStyle = sourceGraph.lineStyle || 'straight';

            editor.hydrate(initial);

            const entry = {editor};
            entries.push(entry);

            const defaultEditor = editorRegistry.get(defaultContainerId);
            if (defaultEditor) {
                defaultEditor.addSyncTarget(canvasRoot.id);
            }

            resetBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (!window.confirm('Esto reemplazará este grafo alterno por una copia del grafo por defecto, ' +
                        'descartando los cambios hechos en él. ¿Continuar?')) {
                    return;
                }
                let data;
                try {
                    data = JSON.parse(defaultField.value);
                } catch (err) {
                    return;
                }
                if (!data || !Array.isArray(data.nodes)) {
                    return;
                }
                editor.hydrate(data);
                writeAltField();
            });

            removeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                wrapper.remove();
                const idx = entries.indexOf(entry);
                if (idx !== -1) {
                    entries.splice(idx, 1);
                }
                writeAltField();
            });

            if (!silent) {
                writeAltField();
            }
        }

        let initialAlts = [];
        try {
            const parsed = JSON.parse(altField.value || '[]');
            if (Array.isArray(parsed)) {
                initialAlts = parsed;
            }
        } catch (e) {
            initialAlts = [];
        }
        initialAlts.forEach((graph) => addAltCanvas(graph, true));

        addButton.addEventListener('click', (e) => {
            e.preventDefault();
            addAltCanvas(null, false);
        });
    }

    return {
        initEditor,
        initAttempt,
        initValidation,
        initAltAnswers,
        initCanvasSettings,
    };
});
