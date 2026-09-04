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
    const COLORS = ['#5b8cff', '#ff6b6b', '#4ade80', '#facc15', '#c084fc', '#38bdf8'];
    const CLICK_THRESHOLD = 4;
    // Nodes can be up to 240px wide (.qtype_graph-node's max-width) and grow tall
    // with wrapped/multi-blank content, so these need real margin beyond that or
    // adjacent-level/sibling nodes can end up edge-to-edge with no visible
    // connecting line between them.
    const TREE_LEVEL_SPACING = {vertical: 170, horizontal: 300};
    const TREE_SIBLING_SPACING = 200;
    const TREE_MARGIN = 80;
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
    // Extracts each quoted answer out of a result-graph {{"a";"b"}} answer
    // list - unrelated to BLANK_TOKEN_RE above; see parseAcceptedAnswers().
    const BLANK_ANSWER_RE = /"([^"]*)"/g;

    const BLANK_MARKER = '{{T_INPUT}}';

    // Matches a [[option1,option2,...]] dropdown blank marker - "Marcar como
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
    const ANSWER_LIST_RE = /^\{\{\s*(?:"[^"]*"\s*;?\s*)+\}\}$/;
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
        return text.indexOf(BLANK_MARKER) !== -1 || SELECT_TOKEN_RE.test(text);
    }

    /**
     * Split a comma-separated options string into a trimmed, non-empty option list.
     *
     * @param {string} optionsCsv
     * @return {Array}
     */
    function splitOptions(optionsCsv) {
        return (optionsCsv || '').split(',').map((opt) => opt.trim()).filter((opt) => opt !== '');
    }

    /**
     * Does this label consist of exactly one [[option1,option2,...]] marker (the
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
     * Build a [[option1,option2,...]] marker from a comma-separated options string,
     * as typed into the node/edge menu's options field.
     *
     * @param {string} optionsCsv
     * @return {string}
     */
    function buildSelectMarker(optionsCsv) {
        return `[[${splitOptions(optionsCsv).join(',')}]]`;
    }

    /**
     * Split a node/edge label into alternating plain-text and blank segments - a
     * blank is either a free-text {{T_INPUT}} marker or a [[option1,option2,...]]
     * dropdown marker.
     *
     * @param {string} text raw label text.
     * @return {Array} [{type:'text', value}, {type:'blank', index, kind:'text'|'select', options}, ...]
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
        SELECT_TOKEN_RE.lastIndex = 0;
        while ((match = SELECT_TOKEN_RE.exec(text)) !== null) {
            matches.push({index: match.index, length: match[0].length, kind: 'select', options: splitOptions(match[1])});
        }
        matches.sort((a, b) => a.index - b.index);

        let lastIndex = 0;
        let blankIndex = 0;
        matches.forEach((m) => {
            if (m.index < lastIndex) {
                // Overlapping match (shouldn't happen - the two token grammars don't
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
            input.addEventListener('mousedown', (e) => e.stopPropagation());
            input.addEventListener('click', (e) => e.stopPropagation());
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                }
            });
            input.addEventListener('input', () => {
                if (onBlankChange) {
                    onBlankChange(blankId, input.value);
                }
            });
            container.appendChild(input);
        });
    }

    /**
     * Parse a result-graph node/edge's text into the answer-field grammar
     * documented in CLAUDE.md: empty means "not authored yet", {{T_ANY}} /
     * {{T_ANY_N_EMPTY}} are the wildcard markers, {{"a";"b"}} is a list of
     * accepted answers, and any other text is a single accepted answer.
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
        if (ANSWER_LIST_RE.test(trimmed)) {
            const answers = [];
            let match;
            BLANK_ANSWER_RE.lastIndex = 0;
            while ((match = BLANK_ANSWER_RE.exec(trimmed)) !== null) {
                answers.push(match[1]);
            }
            return {type: 'exact', answers};
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
        const allowAddNodes = opts.allowAddNodes !== false;
        const allowDeleteNodes = opts.allowDeleteNodes !== false;
        const onChange = opts.onChange || function() {};
        const attemptMode = opts.mode === 'attempt';
        const enableAddInput = !!opts.enableAddInput;
        const addInputTargetContainerId = opts.addInputTargetContainerId || null;
        // What a STUDENT's own new node/connection looks like (attempt mode only) -
        // 'input' (today's free-text box, value used as its placeholder), 'select'
        // (a dropdown built from value's comma-separated options), or 'text' (fixed,
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
        const nodeTextInput = root.querySelector('[data-role="node-text-input"]');
        const colorRow = root.querySelector('[data-role="color-row"]');
        const addConnectedBtn = root.querySelector('[data-role="add-connected-btn"]');
        const addInputBtn = root.querySelector('[data-role="add-input-btn"]');
        const addSelectBtn = root.querySelector('[data-role="add-select-btn"]');
        const deleteNodeBtn = root.querySelector('[data-role="delete-node-btn"]');
        const edgeMenu = root.querySelector('[data-role="edge-menu"]');
        const edgeTextSection = root.querySelector('[data-role="edge-text-section"]');
        const edgeSelectSection = root.querySelector('[data-role="edge-select-section"]');
        const edgeSelectInput = root.querySelector('[data-role="edge-select-input"]');
        const edgeValueSection = root.querySelector('[data-role="edge-value-section"]');
        const edgeValueSelect = root.querySelector('[data-role="edge-value-select"]');
        const addEdgeInputBtn = root.querySelector('[data-role="add-edge-input-btn"]');
        const addEdgeSelectBtn = root.querySelector('[data-role="add-edge-select-btn"]');
        const deleteEdgeBtn = root.querySelector('[data-role="delete-edge-btn"]');
        const edgeLabelInput = root.querySelector('[data-role="edge-label-input"]');

        if (enableAddInput) {
            addInputBtn.hidden = false;
            addEdgeInputBtn.hidden = false;
            addSelectBtn.hidden = false;
            addEdgeSelectBtn.hidden = false;
        }

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

        if (lockLayout) {
            [...modeToggle.children, ...orientationToggle.children].forEach((btn) => {
                btn.disabled = true;
            });
        }

        // The result graph never chooses its own mode/orientation/line-style: it always
        // mirrors the default graph's (see setLayout() below and initEditor()'s pre-hydrate
        // override), so its copies of these controls are permanently hidden rather than just
        // disabled.
        if (hideLayoutControls) {
            modeToggle.hidden = true;
            orientationToggle.hidden = true;
            lineStyleToggle.hidden = true;
        }

        let nodeCounter = 0;
        let edgeCounter = 0;
        const nodes = new Map();
        const edges = [];
        let activeNodeId = null;
        let activeEdge = null;
        let mode = 'graph';
        let orientation = 'vertical';
        let lineStyle = 'straight';
        let zoom = 1;
        let panX = 0;
        let panY = 0;
        let suppress = false;

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
        // opts.mode = 'editor', see initEditor()), never on the student attempt
        // canvas (opts.mode = 'attempt').
        if (opts.mode === 'editor') {
            jsonBtn.hidden = false;
        }

        function showJsonStatus(message, isError) {
            jsonStatus.textContent = message;
            jsonStatus.hidden = !message;
            jsonStatus.classList.toggle('qtype_graph-jsonstatus--error', !!isError);
        }

        function openJsonPanel() {
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

        canvas.addEventListener('wheel', (e) => {
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
                fo.setAttribute('x', lx - w / 2);
                fo.setAttribute('y', ly - h / 2);
                fo.setAttribute('width', w);
                fo.setAttribute('height', h);
            } else {
                edge.textEl.setAttribute('x', lx);
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

        function relayoutTree() {
            if (mode !== 'tree' || nodes.size === 0) {
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
                return;
            }

            const depthOf = new Map();
            const breadthOf = new Map();
            let nextLeaf = 0;

            const assign = (id, depth) => {
                depthOf.set(id, depth);
                const children = childrenMap.get(id) || [];
                let breadth;
                if (children.length === 0) {
                    breadth = nextLeaf;
                    nextLeaf += 1;
                } else {
                    const values = children.map((childId) => assign(childId, depth + 1));
                    breadth = (Math.min(...values) + Math.max(...values)) / 2;
                }
                breadthOf.set(id, breadth);
                return breadth;
            };

            roots.forEach((rootId) => assign(rootId, 0));

            const breadthValues = [...breadthOf.values()];
            const breadthCenter = (Math.min(...breadthValues) + Math.max(...breadthValues)) / 2;
            const canvasRect = canvas.getBoundingClientRect();

            const finalPos = new Map();

            nodes.forEach((record, id) => {
                const depth = depthOf.get(id) ?? 0;
                const breadth = (breadthOf.get(id) ?? 0) - breadthCenter;
                const w = record.el.offsetWidth;
                const h = record.el.offsetHeight;
                let left;
                let top;
                if (orientation === 'vertical') {
                    left = canvasRect.width / 2 + breadth * TREE_SIBLING_SPACING - w / 2;
                    top = TREE_MARGIN + depth * TREE_LEVEL_SPACING.vertical;
                } else {
                    left = TREE_MARGIN + depth * TREE_LEVEL_SPACING.horizontal;
                    top = canvasRect.height / 2 + breadth * TREE_SIBLING_SPACING - h / 2;
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
        }

        function createEdge(fromId, toId, label, locked, id) {
            if (!id) {
                edgeCounter += 1;
                id = `edge-${Date.now().toString(36)}-${edgeCounter}`;
            }

            const group = document.createElementNS(SVG_NS, 'g');
            group.classList.add('qtype_graph-edge-group');
            if (locked) {
                group.classList.add('qtype_graph-edge-group--locked');
            }

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
            if (activeNodeId && nodes.has(activeNodeId)) {
                nodes.get(activeNodeId).el.classList.remove('qtype_graph-node--menuopen');
            }
            activeNodeId = null;
        }

        function closeEdgeMenu() {
            edgeMenu.hidden = true;
            if (activeEdge) {
                activeEdge.group.classList.remove('qtype_graph-edge-group--selected');
            }
            activeEdge = null;
        }

        function closeMenus() {
            closeMenu();
            closeEdgeMenu();
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
            edgeLabelInput.value = edge.label;
            edgeLabelInput.readOnly = attemptMode && !edge.locked && newEdgeContentType === 'text';
            edgeSelectInput.value = selectOptions ? selectOptions.join(', ') : '';
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
            activeEdge.label = buildSelectMarker(edgeSelectInput.value);
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

        addEdgeInputBtn.addEventListener('click', () => {
            if (!activeEdge) {
                return;
            }
            activeEdge.label = BLANK_MARKER;
            activeEdge.textEl.textContent = BLANK_MARKER;
            edgeLabelInput.value = BLANK_MARKER;
            edgeTextSection.hidden = false;
            edgeSelectSection.hidden = true;
            notifyChange();
            getAddInputTargets().forEach((target) => target.setEdgeLabel(activeEdge.id, ''));
        });

        addEdgeSelectBtn.addEventListener('click', () => {
            if (!activeEdge) {
                return;
            }
            const defaultOptions = 'Opción 1, Opción 2';
            activeEdge.label = buildSelectMarker(defaultOptions);
            activeEdge.textEl.textContent = activeEdge.label;
            edgeSelectInput.value = defaultOptions;
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

        addInputBtn.addEventListener('click', () => {
            if (!activeNodeId) {
                return;
            }
            const record = nodes.get(activeNodeId);
            setRecordText(record, BLANK_MARKER);
            nodeTextInput.value = BLANK_MARKER;
            nodeTextSection.hidden = false;
            nodeSelectSection.hidden = true;
            notifyChange();
            getAddInputTargets().forEach((target) => target.setNodeText(activeNodeId, ''));
        });

        addSelectBtn.addEventListener('click', () => {
            if (!activeNodeId) {
                return;
            }
            const record = nodes.get(activeNodeId);
            const defaultOptions = 'Opción 1, Opción 2';
            setRecordText(record, buildSelectMarker(defaultOptions));
            nodeSelectInput.value = defaultOptions;
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
            const record = nodes.get(activeNodeId);
            setRecordText(record, buildSelectMarker(nodeSelectInput.value));
            notifyChange();
        });

        nodeSelectInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                nodeSelectInput.blur();
            }
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
            addConnectedBtn.hidden = !allowAddNodes;
            deleteNodeBtn.hidden = !canDeleteThisNode;

            if (!locked) {
                if (!attemptRestricted) {
                    nodeTextInput.value = getRecordText(record);
                    nodeSelectInput.value = selectOptions ? selectOptions.join(', ') : '';
                }

                const currentColor = getComputedStyle(record.el).getPropertyValue('--node-color').trim();
                colorRow.innerHTML = '';
                COLORS.forEach((color) => {
                    const swatch = document.createElement('button');
                    swatch.type = 'button';
                    swatch.className = 'qtype_graph-colorswatch';
                    swatch.style.background = color;
                    if (color.toLowerCase() === currentColor.toLowerCase()) {
                        swatch.classList.add('qtype_graph-colorswatch--selected');
                    }
                    swatch.addEventListener('click', () => {
                        record.el.style.setProperty('--node-color', color);
                        notifyChange();
                        openMenu(nodeId);
                    });
                    colorRow.appendChild(swatch);
                });
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
            const siblingIndex = edges.filter((edge) => edge.fromId === activeNodeId).length;
            const {left, top} = positionForNewNode(parent, siblingIndex);
            // Fixed-content nodes/edges (question-level newNodeContentType/newEdgeContentType)
            // get their content baked in right at creation - select/input modes start empty,
            // filled in later by the student via the inline element or the edge's menu.
            const seedNodeText = (attemptMode && newNodeContentType === 'text') ? newNodeContentValue :
                    (attemptMode ? '' : 'Nuevo nodo');
            const newId = createNode(left, top, seedNodeText, COLORS[0], false);
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
            orientationToggle.hidden = hideLayoutControls || mode !== 'tree';
            [...modeToggle.children].forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.mode === mode);
            });
            closeMenus();
            if (mode === 'tree') {
                resetView();
                relayoutTree();
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

        function positionForNewNode(parentEl, siblingIndex) {
            return {
                left: parentEl.offsetLeft + parentEl.offsetWidth + 60,
                top: parentEl.offsetTop + 20 + siblingIndex * 70,
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

        function createNode(left, top, text, color, locked, id) {
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
            el.style.setProperty('--node-color', color || COLORS[0]);

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
            graphContent.appendChild(el);

            const record = {id, el, textEl, edges: new Set(), locked: !!locked};
            nodes.set(id, record);
            setupNode(record);
            return id;
        }

        function setupNode(record) {
            const node = record.el;

            if (!editable) {
                return;
            }

            if (record.locked) {
                // Locked (teacher-authored) nodes can only be used as a connection
                // anchor - no drag, no text/color edit, no delete.
                node.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openMenu(record.id);
                });
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
        }

        function serialize() {
            return {
                mode,
                orientation,
                lineStyle,
                nodes: [...nodes.values()].map((record) => ({
                    id: record.id,
                    left: parseFloat(record.el.style.left) || 0,
                    top: parseFloat(record.el.style.top) || 0,
                    text: getRecordText(record),
                    color: getComputedStyle(record.el).getPropertyValue('--node-color').trim(),
                    locked: !!record.locked,
                })),
                edges: edges.map((edge) => ({
                    id: edge.id, from: edge.fromId, to: edge.toId, label: edge.label, locked: !!edge.locked,
                })),
            };
        }

        function hydrate(data) {
            suppress = true;
            clear();
            const nodeList = Array.isArray(data.nodes) ? data.nodes : [];
            nodeList.forEach((n) => {
                createNode(n.left || 0, n.top || 0, n.text, n.color, !!n.locked, n.id);
            });
            const edgeList = Array.isArray(data.edges) ? data.edges : [];
            edgeList.forEach((e) => {
                if (nodes.has(e.from) && nodes.has(e.to)) {
                    createEdge(e.from, e.to, e.label || '', !!e.locked, e.id);
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
         * Draw correct/incorrect feedback markers (a colored outline on a node, a
         * colored/dashed stroke on an edge) on top of whatever nodes/edges the caller
         * identifies by id - never anything else, since a plain structural node/edge
         * has no "answer" to mark right or wrong. Only ever called in attempt mode,
         * once per feedback render, so any markers from a previous render are cleared
         * first rather than accumulated.
         *
         * @param {Object} [feedback] {nodes: {id: bool}, edges: {id: bool}} - true = correct, false = incorrect.
         */
        function markFeedback(feedback) {
            nodes.forEach((record) => {
                record.el.classList.remove('qtype_graph-node--feedback-correct', 'qtype_graph-node--feedback-incorrect');
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
        }

        const api = {hydrate, serialize, setNodeText, setEdgeLabel, setLayout, markFeedback, addSyncTarget};
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
            };
        } catch (e) {
            return {nodes: [], edges: []};
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
     */
    function checkAnswerField(itemDescription, acceptedRaw, issues) {
        const spec = parseAcceptedAnswers(acceptedRaw);
        const trimmed = typeof acceptedRaw === 'string' ? acceptedRaw.trim() : '';
        if (spec.type === 'unset') {
            issues.push({severity: 'error', message: `${itemDescription} no tiene ninguna respuesta definida en el grafo de respuesta.`});
            return;
        }
        if (trimmed === BLANK_MARKER) {
            issues.push({severity: 'error',
                    message: `${itemDescription} todavía tiene el marcador {{T_INPUT}} sin completar en el grafo de respuesta.`});
            return;
        }
        if (WHOLE_SELECT_RE.test(trimmed)) {
            issues.push({severity: 'error', message: `${itemDescription} todavía tiene la lista de opciones ` +
                    '[[...]] sin reemplazar por la respuesta aceptada en el grafo de respuesta.'});
            return;
        }
        if (spec.type === 'exact' && spec.answers.some((a) => a.trim() === '')) {
            issues.push({severity: 'warning',
                    message: `${itemDescription} tiene una respuesta vacía dentro de su lista de respuestas aceptadas.`});
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

        defaultData.nodes.forEach((node) => {
            // A blank node's own text is just its marker ({{T_INPUT}} or [[opt1,opt2,...]]),
            // not a human-readable label - show its id instead.
            const label = hasBlankTokens(node.text) ? node.id : (node.text || node.id);
            const resultNode = resultNodes.get(node.id);
            if (!resultNode) {
                issues.push({severity: 'info',
                        message: `El nodo "${label}" no existe en el grafo de respuesta: se espera que el alumno lo elimine.`});
                return;
            }
            if (hasBlankTokens(node.text)) {
                checkAnswerField(`El input del nodo "${label}"`, resultNode.text, issues);
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
                checkAnswerField(`El input de la conexión "${label}"`, resultEdge.label, issues);
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
     */
    function initEditor(containerId, hiddenFieldId, resetButtonId, sourceHiddenFieldId, addInputTargetContainerId) {
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
                nodes: [{id: 'node-1', left: 120, top: 220, text: 'Nuevo nodo', color: COLORS[0], locked: false}],
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
     */
    function initAttempt(containerId, hiddenFieldId, readOnly, allowAddNodes, allowDeleteNodes) {
        const root = document.getElementById(containerId);
        const hidden = document.getElementById(hiddenFieldId);
        if (!root || !hidden) {
            return;
        }

        const attempt = createAttemptEditor(root, root.dataset.teacherjson, {
            readOnly,
            allowAddNodes,
            allowDeleteNodes,
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
                                text: 'Nuevo nodo', color: COLORS[0], locked: false}],
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
    };
});
