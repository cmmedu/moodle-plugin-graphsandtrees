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
      <button type="button" class="qtype_graph-menubtn qtype_graph-exportbtn qtype_graph-exportbtn--icon"
          data-role="image-btn" hidden aria-label="Exportar imagen" title="Exportar imagen">
        <svg class="qtype_graph-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <path d="M21 15l-5-5L5 21"></path>
        </svg>
      </button>
    </div>
    <button type="button"
        class="qtype_graph-menubtn qtype_graph-exportbtn qtype_graph-exportbtn--icon qtype_graph-settingsbtn"
        data-role="canvas-settings-btn" hidden aria-label="Configuración del lienzo" title="Configuración del lienzo">
      <svg class="qtype_graph-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z">
        </path>
      </svg>
    </button>
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
    <div class="qtype_graph-exportpanel" data-role="image-panel" hidden>
      <div class="qtype_graph-menulabel">Exportar imagen</div>
      <div class="qtype_graph-formatrow" data-role="image-format-toggle">
        <button type="button" class="qtype_graph-shapebtn qtype_graph-shapebtn--selected" data-format="png">
          PNG
        </button>
        <button type="button" class="qtype_graph-shapebtn" data-format="svg">
          SVG
        </button>
      </div>
      <div class="qtype_graph-checkboxrow">
        <label class="qtype_graph-checkboxlabel">
          <input type="checkbox" data-role="image-bg-checkbox" checked>
          Fondo
        </label>
        <label class="qtype_graph-checkboxlabel">
          <input type="checkbox" data-role="image-grid-checkbox">
          Cuadrícula
        </label>
        <label class="qtype_graph-checkboxlabel" hidden>
          <input type="checkbox" data-role="image-hiddenlevellabels-checkbox">
          Etiquetas de nivel ocultas
        </label>
      </div>
      <div class="qtype_graph-jsonstatus" data-role="image-status" hidden></div>
      <div class="qtype_graph-exportactions">
        <button type="button" class="qtype_graph-menubtn" data-role="image-download-btn">Descargar</button>
        <button type="button" class="qtype_graph-menubtn" data-role="image-close-btn">Cerrar</button>
      </div>
    </div>
    <div class="qtype_graph-exportpanel" data-role="canvas-settings-panel" hidden>
      <div class="qtype_graph-menulabel">Configuración del lienzo</div>
      <div class="qtype_graph-checkboxrow">
        <label class="qtype_graph-checkboxlabel">
          <input type="checkbox" data-role="canvas-showgrid-checkbox" checked>
          Mostrar cuadrícula
        </label>
        <label class="qtype_graph-checkboxlabel">
          <input type="checkbox" data-role="canvas-showlevellabels-checkbox" checked>
          Mostrar etiquetas de nivel
        </label>
      </div>
      <div class="qtype_graph-checkboxrow">
        <label class="qtype_graph-checkboxlabel">
          <input type="checkbox" data-role="canvas-shownodetrail-checkbox" checked>
          Mostrar recorrido del nodo (en el intento)
        </label>
      </div>
      <div class="qtype_graph-menusection">
        <span class="qtype_graph-menulabel">Color de fondo</span>
        <div class="qtype_graph-textcolorrow">
          <input type="text" data-role="canvas-bgcolor-input" class="qtype_graph-textinput" placeholder="#f8f9fa">
          <input type="color" data-role="canvas-bgcolor-picker" class="qtype_graph-textcolorpicker"
              aria-label="Color de fondo">
        </div>
      </div>
      <div class="qtype_graph-menusection">
        <span class="qtype_graph-menulabel">Color de cuadrícula</span>
        <div class="qtype_graph-textcolorrow">
          <input type="text" data-role="canvas-gridcolor-input" class="qtype_graph-textinput" placeholder="#e2e8f0">
          <input type="color" data-role="canvas-gridcolor-picker" class="qtype_graph-textcolorpicker"
              aria-label="Color de cuadrícula">
        </div>
      </div>
      <div class="qtype_graph-menusection">
        <span class="qtype_graph-menulabel">Tamaño de etiquetas de nivel</span>
        <input type="number" data-role="canvas-levellabelsize-input" class="qtype_graph-textinput" min="8" max="72">
      </div>
      <div class="qtype_graph-exportactions">
        <button type="button" class="qtype_graph-menubtn" data-role="canvas-settings-close-btn">Cerrar</button>
      </div>
    </div>
    <div class="qtype_graph-nodemenu" data-role="node-menu" hidden>
      <div class="qtype_graph-menusection" data-role="node-text-section">
        <span class="qtype_graph-menulabel">Nombre</span>
        <input type="text" data-role="node-text-input" class="qtype_graph-textinput">
      </div>
      <div class="qtype_graph-menusection" data-role="node-select-section" hidden>
        <span class="qtype_graph-menulabel">Opciones [[opt1;opt2]] (puedes agregar texto antes/después de los corchetes)</span>
        <input type="text" data-role="node-select-input" class="qtype_graph-textinput">
      </div>
      <div class="qtype_graph-menusection" data-role="node-color-section">
        <span class="qtype_graph-menulabel">Color</span>
        <div class="qtype_graph-textcolorrow">
          <input type="text" data-role="node-color-input" class="qtype_graph-textinput" placeholder="#423475">
          <input type="color" data-role="node-color-picker" class="qtype_graph-textcolorpicker"
              aria-label="Color">
        </div>
      </div>
      <div class="qtype_graph-menusection" data-role="node-textcolor-section">
        <span class="qtype_graph-menulabel">Color de texto</span>
        <div class="qtype_graph-textcolorrow">
          <input type="text" data-role="node-textcolor-input" class="qtype_graph-textinput" placeholder="#ffffff">
          <input type="color" data-role="node-textcolor-picker" class="qtype_graph-textcolorpicker"
              aria-label="Color de texto">
        </div>
      </div>
      <details class="qtype_graph-collapsible" data-role="node-textalign-section">
        <summary class="qtype_graph-menulabel">Alineación del texto</summary>
        <div class="qtype_graph-formatrow" data-role="textalign-row">
          <button type="button" class="qtype_graph-shapebtn" data-align="left" title="Izquierda" aria-label="Izquierda"><svg class="qtype_graph-aligniconsvg" viewBox="0 0 16 16" aria-hidden="true"><line x1="2" y1="3" x2="14" y2="3"/><line x1="2" y1="6.5" x2="10" y2="6.5"/><line x1="2" y1="10" x2="14" y2="10"/><line x1="2" y1="13.5" x2="8" y2="13.5"/></svg></button>
          <button type="button" class="qtype_graph-shapebtn" data-align="center" title="Centro" aria-label="Centro"><svg class="qtype_graph-aligniconsvg" viewBox="0 0 16 16" aria-hidden="true"><line x1="2" y1="3" x2="14" y2="3"/><line x1="4" y1="6.5" x2="12" y2="6.5"/><line x1="2" y1="10" x2="14" y2="10"/><line x1="5" y1="13.5" x2="11" y2="13.5"/></svg></button>
          <button type="button" class="qtype_graph-shapebtn" data-align="right" title="Derecha" aria-label="Derecha"><svg class="qtype_graph-aligniconsvg" viewBox="0 0 16 16" aria-hidden="true"><line x1="2" y1="3" x2="14" y2="3"/><line x1="6" y1="6.5" x2="14" y2="6.5"/><line x1="2" y1="10" x2="14" y2="10"/><line x1="8" y1="13.5" x2="14" y2="13.5"/></svg></button>
        </div>
      </details>
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
      <button type="button" class="qtype_graph-menubtn" data-role="add-fraction-btn" hidden>Marcar como fracción</button>
      <button type="button" class="qtype_graph-menubtn" data-role="add-floatinglabel-btn" hidden>+ Etiqueta flotante</button>
      <button type="button" class="qtype_graph-menubtn qtype_graph-danger" data-role="delete-node-btn">Eliminar nodo</button>
    </div>
    <div class="qtype_graph-nodemenu" data-role="floatinglabel-menu" hidden>
      <div class="qtype_graph-menusection" data-role="floatinglabel-text-section">
        <span class="qtype_graph-menulabel">Nombre</span>
        <input type="text" data-role="floatinglabel-text-input" class="qtype_graph-textinput">
      </div>
      <div class="qtype_graph-menusection" data-role="floatinglabel-select-section" hidden>
        <span class="qtype_graph-menulabel">Opciones [[opt1;opt2]] (puedes agregar texto antes/después de los corchetes)</span>
        <input type="text" data-role="floatinglabel-select-input" class="qtype_graph-textinput">
      </div>
      <div class="qtype_graph-menusection" data-role="floatinglabel-textcolor-section">
        <span class="qtype_graph-menulabel">Color de texto</span>
        <div class="qtype_graph-textcolorrow">
          <input type="text" data-role="floatinglabel-textcolor-input" class="qtype_graph-textinput" placeholder="#e7e9ee">
          <input type="color" data-role="floatinglabel-textcolor-picker" class="qtype_graph-textcolorpicker"
              aria-label="Color de texto">
        </div>
      </div>
      <details class="qtype_graph-collapsible" data-role="floatinglabel-textalign-section">
        <summary class="qtype_graph-menulabel">Alineación del texto</summary>
        <div class="qtype_graph-formatrow" data-role="floatinglabel-textalign-row">
          <button type="button" class="qtype_graph-shapebtn" data-align="left" title="Izquierda" aria-label="Izquierda"><svg class="qtype_graph-aligniconsvg" viewBox="0 0 16 16" aria-hidden="true"><line x1="2" y1="3" x2="14" y2="3"/><line x1="2" y1="6.5" x2="10" y2="6.5"/><line x1="2" y1="10" x2="14" y2="10"/><line x1="2" y1="13.5" x2="8" y2="13.5"/></svg></button>
          <button type="button" class="qtype_graph-shapebtn" data-align="center" title="Centro" aria-label="Centro"><svg class="qtype_graph-aligniconsvg" viewBox="0 0 16 16" aria-hidden="true"><line x1="2" y1="3" x2="14" y2="3"/><line x1="4" y1="6.5" x2="12" y2="6.5"/><line x1="2" y1="10" x2="14" y2="10"/><line x1="5" y1="13.5" x2="11" y2="13.5"/></svg></button>
          <button type="button" class="qtype_graph-shapebtn" data-align="right" title="Derecha" aria-label="Derecha"><svg class="qtype_graph-aligniconsvg" viewBox="0 0 16 16" aria-hidden="true"><line x1="2" y1="3" x2="14" y2="3"/><line x1="6" y1="6.5" x2="14" y2="6.5"/><line x1="2" y1="10" x2="14" y2="10"/><line x1="8" y1="13.5" x2="14" y2="13.5"/></svg></button>
        </div>
      </details>
      <button type="button" class="qtype_graph-menubtn" data-role="add-floatinglabel-input-btn" hidden>Marcar como input</button>
      <button type="button" class="qtype_graph-menubtn" data-role="add-floatinglabel-select-btn" hidden>Marcar como selector</button>
      <button type="button" class="qtype_graph-menubtn" data-role="add-floatinglabel-fraction-btn" hidden>Marcar como fracción</button>
      <button type="button" class="qtype_graph-menubtn qtype_graph-danger" data-role="delete-floatinglabel-btn">Eliminar etiqueta</button>
    </div>
    <div class="qtype_graph-nodemenu" data-role="levellabel-menu" hidden>
      <div class="qtype_graph-checkboxrow">
        <label class="qtype_graph-checkboxlabel">
          <input type="checkbox" data-role="levellabel-show-checkbox" checked>
          Mostrar etiqueta
        </label>
      </div>
      <div class="qtype_graph-menusection">
        <span class="qtype_graph-menulabel">Texto</span>
        <input type="text" data-role="levellabel-title-input" class="qtype_graph-textinput">
      </div>
      <div class="qtype_graph-menusection">
        <span class="qtype_graph-menulabel">Subtítulo</span>
        <input type="text" data-role="levellabel-subtitle-input" class="qtype_graph-textinput">
      </div>
    </div>
    <div class="qtype_graph-nodemenu" data-role="edge-menu" hidden>
      <div class="qtype_graph-menusection" data-role="edge-text-section">
        <span class="qtype_graph-menulabel">Nombre</span>
        <input type="text" data-role="edge-label-input" class="qtype_graph-textinput" maxlength="80">
      </div>
      <div class="qtype_graph-menusection" data-role="edge-select-section" hidden>
        <span class="qtype_graph-menulabel">Opciones [[opt1;opt2]] (puedes agregar texto antes/después de los corchetes)</span>
        <input type="text" data-role="edge-select-input" class="qtype_graph-textinput">
      </div>
      <div class="qtype_graph-menusection" data-role="edge-value-section" hidden>
        <span class="qtype_graph-menulabel">Respuesta</span>
        <select data-role="edge-value-select" class="qtype_graph-textinput"></select>
      </div>
      <div class="qtype_graph-menusection" data-role="edge-textcolor-section">
        <span class="qtype_graph-menulabel">Color de texto</span>
        <div class="qtype_graph-textcolorrow">
          <input type="text" data-role="edge-textcolor-input" class="qtype_graph-textinput" placeholder="#1f2937">
          <input type="color" data-role="edge-textcolor-picker" class="qtype_graph-textcolorpicker"
              aria-label="Color de texto">
        </div>
      </div>
      <details class="qtype_graph-collapsible" data-role="edge-textalign-section">
        <summary class="qtype_graph-menulabel">Alineación del texto</summary>
        <div class="qtype_graph-formatrow" data-role="edge-textalign-row">
          <button type="button" class="qtype_graph-shapebtn" data-align="left" title="Izquierda" aria-label="Izquierda"><svg class="qtype_graph-aligniconsvg" viewBox="0 0 16 16" aria-hidden="true"><line x1="2" y1="3" x2="14" y2="3"/><line x1="2" y1="6.5" x2="10" y2="6.5"/><line x1="2" y1="10" x2="14" y2="10"/><line x1="2" y1="13.5" x2="8" y2="13.5"/></svg></button>
          <button type="button" class="qtype_graph-shapebtn" data-align="center" title="Centro" aria-label="Centro"><svg class="qtype_graph-aligniconsvg" viewBox="0 0 16 16" aria-hidden="true"><line x1="2" y1="3" x2="14" y2="3"/><line x1="4" y1="6.5" x2="12" y2="6.5"/><line x1="2" y1="10" x2="14" y2="10"/><line x1="5" y1="13.5" x2="11" y2="13.5"/></svg></button>
          <button type="button" class="qtype_graph-shapebtn" data-align="right" title="Derecha" aria-label="Derecha"><svg class="qtype_graph-aligniconsvg" viewBox="0 0 16 16" aria-hidden="true"><line x1="2" y1="3" x2="14" y2="3"/><line x1="6" y1="6.5" x2="14" y2="6.5"/><line x1="2" y1="10" x2="14" y2="10"/><line x1="8" y1="13.5" x2="14" y2="13.5"/></svg></button>
        </div>
      </details>
      <button type="button" class="qtype_graph-menubtn" data-role="add-edge-input-btn" hidden>Marcar como input</button>
      <button type="button" class="qtype_graph-menubtn" data-role="add-edge-select-btn" hidden>Marcar como selector</button>
      <button type="button" class="qtype_graph-menubtn" data-role="add-edge-fraction-btn" hidden>Marcar como fracción</button>
      <button type="button" class="qtype_graph-menubtn qtype_graph-danger" data-role="delete-edge-btn">Eliminar conexión</button>
    </div>
  </div>
</div>
HTML;
    }
}
