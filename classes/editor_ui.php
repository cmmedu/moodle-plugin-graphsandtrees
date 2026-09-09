<?php
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

namespace qtype_graph;

/**
 * Builds the HTML skeleton for the graph editor widget.
 *
 * Shared between the question edit form (full editor) and the attempt
 * renderer (teacher graph + student additions), so both get the exact same
 * markup that amd/src/editor.js expects to find inside the container.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class editor_ui {
    /**
     * Render the container markup for one graph editor instance.
     *
     * @param string $id the DOM id to give the outer container.
     * @param array $dataattrs extra data-* attributes to set on the container element
     *              (name => value, name without the "data-" prefix) - a way for a caller
     *              to hand editor.js small settings without bloating a js_call_amd()
     *              argument list (Moodle warns via debugging() past ~1KB of arguments;
     *              see renderer.php's use of this for newnodecontenttype and friends).
     * @return string HTML.
     */
    public static function render(string $id, array $dataattrs = []): string {
        $attrshtml = '';
        foreach ($dataattrs as $name => $value) {
            $attrshtml .= ' data-' . $name . '="' . s($value) . '"';
        }
        return <<<HTML
<div id="{$id}" class="qtype_graph-container"{$attrshtml}>
  <div class="qtype_graph-toolbar">
    <div class="qtype_graph-modecontrols">
      <div class="qtype_graph-segmented" data-role="mode-toggle">
        <button type="button" class="active" data-mode="graph">Modo grafo</button>
        <button type="button" data-mode="tree">Modo árbol</button>
      </div>
      <div class="qtype_graph-segmented" data-role="orientation-toggle" hidden>
        <button type="button" class="active" data-orientation="vertical">V</button>
        <button type="button" data-orientation="horizontal">H</button>
      </div>
      <div class="qtype_graph-segmented" data-role="linestyle-toggle">
        <button type="button" class="active" data-line-style="straight">/</button>
        <button type="button" data-line-style="orthogonal">⌐</button>
      </div>
      <div class="qtype_graph-segmented qtype_graph-zoomcontrols" data-role="zoom-controls">
        <button type="button" data-role="zoom-out" aria-label="-">-</button>
        <button type="button" data-role="zoom-reset">100%</button>
        <button type="button" data-role="zoom-in" aria-label="+">+</button>
      </div>
      <button type="button" class="qtype_graph-menubtn qtype_graph-exportbtn" data-role="json-btn" hidden>
        JSON
      </button>
    </div>
  </div>
  <div class="qtype_graph-canvas" data-role="canvas">
    <div class="qtype_graph-content" data-role="content">
      <svg class="qtype_graph-edges" data-role="edges"></svg>
    </div>
    <div class="qtype_graph-exportpanel" data-role="json-panel" hidden>
      <div class="qtype_graph-menulabel">JSON del grafo</div>
      <textarea class="qtype_graph-exporttextarea" data-role="json-textarea"></textarea>
      <div class="qtype_graph-jsonstatus" data-role="json-status" hidden></div>
      <div class="qtype_graph-exportactions">
        <button type="button" class="qtype_graph-menubtn" data-role="json-build-btn"
            data-confirm="Esto reemplazará el grafo actual por el contenido del JSON. ¿Continuar?">
          Construir grafo
        </button>
        <button type="button" class="qtype_graph-menubtn" data-role="json-copy-btn">Copiar al portapapeles</button>
        <button type="button" class="qtype_graph-menubtn" data-role="json-close-btn">Cerrar</button>
      </div>
    </div>
    <div class="qtype_graph-nodemenu" data-role="node-menu" hidden>
      <div class="qtype_graph-menusection" data-role="node-text-section">
        <span class="qtype_graph-menulabel">Texto</span>
        <input type="text" data-role="node-text-input" class="qtype_graph-textinput">
      </div>
      <div class="qtype_graph-menusection" data-role="node-select-section" hidden>
        <span class="qtype_graph-menulabel">Opciones (separadas por coma)</span>
        <input type="text" data-role="node-select-input" class="qtype_graph-textinput">
      </div>
      <div class="qtype_graph-menusection" data-role="node-color-section">
        <span class="qtype_graph-menulabel">Color</span>
        <div class="qtype_graph-colorrow" data-role="color-row"></div>
      </div>
      <details class="qtype_graph-collapsible" data-role="node-shape-section">
        <summary class="qtype_graph-menulabel">Forma</summary>
        <div class="qtype_graph-shaperow" data-role="shape-row">
          <button type="button" class="qtype_graph-shapebtn" data-shape="rounded">
            <span class="qtype_graph-shapeicon qtype_graph-shapeicon--rounded"></span>
            Redondeada
          </button>
          <button type="button" class="qtype_graph-shapebtn" data-shape="circle">
            <span class="qtype_graph-shapeicon qtype_graph-shapeicon--circle"></span>
            Círculo
          </button>
          <button type="button" class="qtype_graph-shapebtn" data-shape="rectangle">
            <span class="qtype_graph-shapeicon qtype_graph-shapeicon--rectangle"></span>
            Rectángulo
          </button>
          <button type="button" class="qtype_graph-shapebtn" data-shape="oval">
            <span class="qtype_graph-shapeicon qtype_graph-shapeicon--oval"></span>
            Óvalo
          </button>
        </div>
      </details>
      <button type="button" class="qtype_graph-menubtn" data-role="add-connected-btn">+ Nodo conectado</button>
      <button type="button" class="qtype_graph-menubtn" data-role="add-input-btn" hidden>Marcar como input</button>
      <button type="button" class="qtype_graph-menubtn" data-role="add-select-btn" hidden>Marcar como selector</button>
      <button type="button" class="qtype_graph-menubtn qtype_graph-danger" data-role="delete-node-btn">Eliminar nodo</button>
    </div>
    <div class="qtype_graph-nodemenu" data-role="edge-menu" hidden>
      <div class="qtype_graph-menusection" data-role="edge-text-section">
        <span class="qtype_graph-menulabel">Etiqueta</span>
        <input type="text" data-role="edge-label-input" class="qtype_graph-textinput" maxlength="40">
      </div>
      <div class="qtype_graph-menusection" data-role="edge-select-section" hidden>
        <span class="qtype_graph-menulabel">Opciones (separadas por coma)</span>
        <input type="text" data-role="edge-select-input" class="qtype_graph-textinput">
      </div>
      <div class="qtype_graph-menusection" data-role="edge-value-section" hidden>
        <span class="qtype_graph-menulabel">Respuesta</span>
        <select data-role="edge-value-select" class="qtype_graph-textinput"></select>
      </div>
      <button type="button" class="qtype_graph-menubtn" data-role="add-edge-input-btn" hidden>Marcar como input</button>
      <button type="button" class="qtype_graph-menubtn" data-role="add-edge-select-btn" hidden>Marcar como selector</button>
      <button type="button" class="qtype_graph-menubtn qtype_graph-danger" data-role="delete-edge-btn">Eliminar conexión</button>
    </div>
  </div>
</div>
HTML;
    }
}
