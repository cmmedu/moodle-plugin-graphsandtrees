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
    const TREE_LEVEL_SPACING = {vertical: 130, horizontal: 240};
    const TREE_SIBLING_SPACING = 170;
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

    /**
     * Create one graph editor instance bound to a container element.
     *
     * @param {Element} root the .qtype_graph-container element.
     * @param {Object} opts {editable: bool, lockLayout: bool, allowAddNodes: bool, allowDeleteNodes: bool,
     *                       onChange: function(serializedState)}
     * @return {Object} {hydrate, serialize}
     */
    function createGraphEditor(root, opts) {
        const editable = !!opts.editable;
        const lockLayout = !!opts.lockLayout;
        const allowAddNodes = opts.allowAddNodes !== false;
        const allowDeleteNodes = opts.allowDeleteNodes !== false;
        const onChange = opts.onChange || function() {};

        const canvas = root.querySelector('[data-role="canvas"]');
        const graphContent = root.querySelector('[data-role="content"]');
        const edgesLayer = root.querySelector('[data-role="edges"]');
        const menu = root.querySelector('[data-role="node-menu"]');
        const nodeTextSection = root.querySelector('[data-role="node-text-section"]');
        const nodeColorSection = root.querySelector('[data-role="node-color-section"]');
        const nodeTextInput = root.querySelector('[data-role="node-text-input"]');
        const colorRow = root.querySelector('[data-role="color-row"]');
        const addConnectedBtn = root.querySelector('[data-role="add-connected-btn"]');
        const deleteNodeBtn = root.querySelector('[data-role="delete-node-btn"]');
        const edgeMenu = root.querySelector('[data-role="edge-menu"]');
        const deleteEdgeBtn = root.querySelector('[data-role="delete-edge-btn"]');
        const edgeLabelInput = root.querySelector('[data-role="edge-label-input"]');
        const modeToggle = root.querySelector('[data-role="mode-toggle"]');
        const orientationToggle = root.querySelector('[data-role="orientation-toggle"]');
        const lineStyleToggle = root.querySelector('[data-role="linestyle-toggle"]');
        const zoomInBtn = root.querySelector('[data-role="zoom-in"]');
        const zoomOutBtn = root.querySelector('[data-role="zoom-out"]');
        const zoomResetBtn = root.querySelector('[data-role="zoom-reset"]');

        if (lockLayout) {
            [...modeToggle.children, ...orientationToggle.children].forEach((btn) => {
                btn.disabled = true;
            });
        }

        let nodeCounter = 0;
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

        function setEdgeGeometry(edge, x1, y1, x2, y2) {
            const {d, lx, ly} = computeEdgeGeometry(x1, y1, x2, y2, lineStyle, mode, orientation);
            edge.hitPath.setAttribute('d', d);
            edge.visiblePath.setAttribute('d', d);
            edge.textEl.setAttribute('x', lx);
            edge.textEl.setAttribute('y', ly);
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

        function createEdge(fromId, toId, label) {
            const group = document.createElementNS(SVG_NS, 'g');
            group.classList.add('qtype_graph-edge-group');

            const hitPath = document.createElementNS(SVG_NS, 'path');
            hitPath.classList.add('qtype_graph-edge-hit');
            const visiblePath = document.createElementNS(SVG_NS, 'path');
            visiblePath.classList.add('qtype_graph-edge-line');
            const textEl = document.createElementNS(SVG_NS, 'text');
            textEl.classList.add('qtype_graph-edge-label');
            textEl.setAttribute('text-anchor', 'middle');
            textEl.setAttribute('dominant-baseline', 'middle');
            textEl.textContent = label || '';

            group.appendChild(hitPath);
            group.appendChild(visiblePath);
            group.appendChild(textEl);
            edgesLayer.appendChild(group);

            const edge = {group, hitPath, visiblePath, textEl, fromId, toId, label: label || ''};
            edges.push(edge);
            nodes.get(fromId).edges.add(edge);
            nodes.get(toId).edges.add(edge);
            updateEdgesFor(fromId);

            if (editable) {
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
            edgeLabelInput.value = edge.label;

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

            edgeLabelInput.focus();
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

        deleteEdgeBtn.addEventListener('click', () => {
            if (!activeEdge) {
                return;
            }
            removeEdge(activeEdge);
            relayoutTree();
            notifyChange();
        });

        deleteNodeBtn.addEventListener('click', () => {
            if (!activeNodeId) {
                return;
            }
            deleteNode(activeNodeId);
        });

        function openMenu(nodeId) {
            closeMenus();
            activeNodeId = nodeId;
            const record = nodes.get(nodeId);
            record.el.classList.add('qtype_graph-node--menuopen');

            const locked = record.locked;
            const canDeleteThisNode = locked ? allowDeleteNodes : true;
            nodeTextSection.hidden = locked;
            nodeColorSection.hidden = locked;
            addConnectedBtn.hidden = !allowAddNodes;
            deleteNodeBtn.hidden = !canDeleteThisNode;

            if (!locked) {
                nodeTextInput.value = record.textEl.textContent;

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
            record.textEl.textContent = limited;
            notifyChange();
        });

        nodeTextInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                nodeTextInput.blur();
            }
        });

        nodeTextInput.addEventListener('blur', () => {
            if (!activeNodeId) {
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
            const newId = createNode(left, top, 'Nuevo nodo', COLORS[0], false);
            createEdge(activeNodeId, newId, '');
            closeMenus();
            relayoutTree();
            notifyChange();
        });

        function setMode(nextMode, silent) {
            if (mode === nextMode) {
                return;
            }
            mode = nextMode;
            canvas.classList.toggle('qtype_graph-canvas--tree', mode === 'tree');
            orientationToggle.hidden = mode !== 'tree';
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
            }
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

            const textEl = document.createElement('span');
            textEl.className = 'qtype_graph-node-text';
            textEl.contentEditable = 'false';
            textEl.dataset.maxWords = String(DEFAULT_MAX_WORDS);
            textEl.textContent = text || 'Nuevo nodo';

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
                    text: record.textEl.textContent,
                    color: getComputedStyle(record.el).getPropertyValue('--node-color').trim(),
                    locked: !!record.locked,
                })),
                edges: edges.map((edge) => ({from: edge.fromId, to: edge.toId, label: edge.label})),
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
                    createEdge(e.from, e.to, e.label || '');
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

        return {hydrate, serialize};
    }

    /**
     * Full editing widget for the question edit form. Nothing is locked.
     *
     * @param {string} containerId id of the .qtype_graph-container element.
     * @param {string} hiddenFieldId id of the hidden form field to write the graph JSON into.
     */
    function initEditor(containerId, hiddenFieldId) {
        const root = document.getElementById(containerId);
        const hidden = document.getElementById(hiddenFieldId);
        if (!root || !hidden) {
            return;
        }

        const editor = createGraphEditor(root, {
            editable: true,
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

        editor.hydrate(initial);
        hidden.value = JSON.stringify(editor.serialize());
    }

    /**
     * Attempt-page widget: teacher graph locked, student additions editable.
     *
     * @param {string} containerId id of the .qtype_graph-container element.
     * @param {string} hiddenFieldId id of the response hidden field (nodesjson).
     * @param {string} teacherJson the teacher-authored graph, as JSON.
     * @param {boolean} readOnly true if the question is being displayed read-only (e.g. review).
     * @param {boolean} allowAddNodes true if the student may add new nodes.
     * @param {boolean} allowDeleteNodes true if the student may delete the teacher-authored nodes.
     */
    function initAttempt(containerId, hiddenFieldId, teacherJson, readOnly, allowAddNodes, allowDeleteNodes) {
        const root = document.getElementById(containerId);
        const hidden = document.getElementById(hiddenFieldId);
        if (!root || !hidden) {
            return;
        }

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
        if (hidden.value) {
            try {
                const parsed = JSON.parse(hidden.value);
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
                        (e) => !removedTeacherIds.has(e.from) && !removedTeacherIds.has(e.to)),
                ...(studentData.edges || []),
            ],
            mode: teacherData.mode || 'graph',
            orientation: teacherData.orientation || 'vertical',
            lineStyle: teacherData.lineStyle || 'straight',
        };

        const editor = createGraphEditor(root, {
            editable: !readOnly,
            lockLayout: true,
            allowAddNodes: allowAddNodes !== false,
            allowDeleteNodes: allowDeleteNodes !== false,
            onChange: (data) => {
                const liveIds = new Set(data.nodes.map((n) => n.id));
                teacherIds.forEach((id) => {
                    if (!liveIds.has(id)) {
                        removedTeacherIds.add(id);
                    }
                });
                const studentNodes = data.nodes.filter((n) => !teacherIds.has(n.id));
                const studentEdges = data.edges.filter(
                        (e) => !(teacherIds.has(e.from) && teacherIds.has(e.to)));
                hidden.value = JSON.stringify({
                    nodes: studentNodes,
                    edges: studentEdges,
                    removednodes: [...removedTeacherIds],
                });
                const form = root.closest('form');
                if (form) {
                    FormChangeChecker.markFormAsDirty(form);
                }
            },
        });

        editor.hydrate(merged);

        if (readOnly) {
            root.classList.add('qtype_graph-container--readonly');
        }
    }

    return {
        initEditor,
        initAttempt,
    };
});
