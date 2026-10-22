<?php
// This file is part of qtype_graph, a question type plugin for Moodle - http://moodle.org/
//
// Released under the MIT License. See the LICENSE file at the root of this plugin.

/**
 * Strings for component 'qtype_graph', language 'es'.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    https://opensource.org/licenses/MIT MIT
 */

$string['pluginname'] = 'Grafo';
$string['pluginname_help'] = 'Al estudiante se le muestra un grafo (nodos y conexiones) construido por el profesor, y puede añadir sus propios nodos conectados a él. Se califica automáticamente una vez que el profesor ha construido un grafo de resultado, y manualmente en caso contrario.';
$string['pluginnameadding'] = 'Añadiendo una pregunta de Grafo';
$string['pluginnameediting'] = 'Editando una pregunta de Grafo';
$string['pluginnamesummary'] = 'El profesor construye un grafo (nodos y conexiones); los estudiantes lo visualizan y añaden sus propios nodos conectados como respuesta. Se califica automáticamente una vez configurado un grafo de resultado, y manualmente en caso contrario.';
$string['graphjson'] = 'Grafo por defecto';
$string['graphjson_help'] = 'Construye el grafo o árbol que verá el estudiante. Haz clic en un nodo o conexión para editar su texto/color, añadir nodos conectados o eliminarlo. Para convertir un nodo o conexión en un espacio para completar, haz clic en él y elige "Marcar como input" - esto reemplaza toda su etiqueta por una casilla vacía en la que escribe el estudiante. El espacio en blanco en sí no contiene la respuesta correcta: eso se define aparte más abajo, en el Grafo de respuesta, en el nodo/conexión con el mismo id (al hacer clic en "Marcar como input" se limpia automáticamente allí, listo para completarlo).';
$string['err_emptygraph'] = 'El grafo debe tener al menos un nodo.';
$string['invalidresponse'] = 'No se envió una respuesta de grafo válida.';
$string['resultgraphjson'] = 'Grafo de respuesta';
$string['resultgraphjson_help'] = 'Construye el grafo o árbol que representa la respuesta final correcta/esperada, emparejado con el grafo por defecto de arriba por id de nodo/conexión - usa "Restablecer al grafo por defecto" para partir de una copia de este. Cada nodo/conexión aquí se comprueba automáticamente: elimina uno aquí para marcarlo como algo que se espera que el estudiante elimine; para uno que marcaste como "Marcar como input" arriba, escribe aquí la respuesta aceptada en su lugar - una sola respuesta (p. ej. Madrid), varias con {{respuesta1;respuesta2}} (las comillas son opcionales, p. ej. {{"respuesta1";"respuesta2"}}), {{T_ANY}} para aceptar cualquier valor no vacío, o {{T_ANY_N_EMPTY}} para aceptar cualquier valor, incluida una respuesta en blanco. Para validar numéricamente, escribe {{N:...}}: el alumno debe ingresar un número (acepta coma o punto decimal, y fracciones como 1/2, que valen igual que 0,5 o 2/4) y se compara por su valor - {{N:0.5}} un valor exacto, {{N:1/3}} una fracción, {{N:3.14:0.01}} valor con tolerancia (de 3.13 a 3.15), {{N:1..2}} un rango, {{N:*}} cualquier número, o varios a la vez con {{N:2;-2;5..6}}. Para uno marcado como "Marcar como fracción" ({{F:numerador|denominador}}), escribe la respuesta como a/b (p. ej. 3/4, o {{N:3/4}} para aceptar también fracciones equivalentes y decimales). Deja todo este lienzo vacío para mantener esta pregunta totalmente calificada de forma manual, igual que antes de que existiera esta funcionalidad.';
$string['resetresultgraph'] = 'Restablecer al grafo por defecto';
$string['resetresultgraph_confirm'] = 'Esto sobrescribirá el grafo de resultado de abajo con una copia del grafo de arriba, descartando cualquier cambio realizado en él. ¿Continuar?';
$string['validategraphs'] = 'Validar grafo de respuesta';
$string['altanswersheader'] = 'Grafos de respuesta alternativos';
$string['altanswershelp'] = 'Si más de un grafo final debe considerarse correcto, añade aquí grafos de respuesta adicionales - cada uno es una copia completa del Grafo de respuesta de arriba (emparejado con el grafo por defecto por id de nodo/conexión de la misma forma), para los casos que el único grafo de respuesta de arriba no puede expresar como un solo conjunto de respuestas aceptadas por espacio. Al calificar una respuesta, cada grafo de respuesta (este más cada alternativo) se comprueba de forma independiente y al estudiante se le asigna la puntuación más alta de todas. Marcar un nodo/conexión como espacio para completar en el grafo por defecto limpia ese id en el grafo de respuesta de arriba Y en cada alternativo de aquí, listo para que escribas la respuesta aceptada en cada uno.';
$string['addaltanswer'] = 'Añadir grafo de respuesta alternativo';
$string['allowaddnodes'] = 'Permitir a los estudiantes añadir nuevos nodos';
$string['allowdeletenodes'] = 'Permitir a los estudiantes eliminar nodos originales';
$string['allowdownloadimage'] = 'Permitir a los estudiantes descargar su grafo como imagen';
$string['allowdownloadimage_help'] = 'Si está activado, los estudiantes verán un botón de exportar imagen en la barra del lienzo del intento, que les permite descargar su grafo actual como archivo PNG o SVG. Desactivado por defecto.';
$string['allowchangeorientation'] = 'Permitir a los estudiantes cambiar la orientación del árbol';
$string['allowchangeorientation_help'] = 'Si está activado, los estudiantes verán el selector de orientación vertical/horizontal en la barra del lienzo del intento (solo en modo árbol) y podrán cambiarlo ellos mismos. Desactivado por defecto - el botón queda oculto por completo, no solo deshabilitado.';
$string['allowchangelinestyle'] = 'Permitir a los estudiantes cambiar el estilo de las ramas (conexiones)';
$string['allowchangelinestyle_help'] = 'Si está activado, los estudiantes verán el selector de estilo de conexión (recta/ortogonal) en la barra del lienzo del intento y podrán cambiarlo ellos mismos. Desactivado por defecto - el botón queda oculto por completo, no solo deshabilitado.';
$string['allowchangegraphtype'] = 'Permitir a los estudiantes cambiar el tipo de grafo (grafo o árbol)';
$string['allowchangegraphtype_help'] = 'Si está activado, los estudiantes verán el selector de modo grafo/árbol en la barra del lienzo del intento y podrán cambiarlo ellos mismos. Desactivado por defecto - el botón queda oculto por completo, no solo deshabilitado.';
$string['contenttype_input'] = 'Texto libre';
$string['contenttype_select'] = 'Lista desplegable';
$string['contenttype_text'] = 'Texto fijo (no editable)';
$string['newnodecontenttype'] = 'Contenido de nodo nuevo';
$string['newnodecontenttype_help'] = 'Lo que ve un estudiante al añadir un nuevo nodo conectado al grafo durante su intento (solo aplica a nodos que crea el estudiante - nunca al grafo por defecto elaborado por el profesor). "Texto libre" es el comportamiento actual: una casilla editable, usando el valor de abajo como su texto de ayuda (placeholder). "Lista desplegable" ofrece al estudiante una lista fija para elegir en lugar de escribir - el valor de abajo es una lista de opciones separadas por punto y coma, p. ej. Madrid;Barcelona;Sevilla. "Texto fijo" crea el nuevo nodo con exactamente el valor de abajo y el estudiante no puede cambiarlo - solo si lo añade, y cómo lo conecta, forma parte de su respuesta.';
$string['newnodecontentvalue'] = 'Valor de contenido de nodo nuevo';
$string['newedgecontenttype'] = 'Contenido de conexión nueva';
$string['newedgecontenttype_help'] = 'Las mismas tres opciones que "Contenido de nodo nuevo" de arriba, pero para la etiqueta de una nueva conexión que crea un estudiante - solo se muestra si el estudiante abre el menú de esa conexión para establecer su etiqueta (no hay calificación automática de las etiquetas de conexión, ni un aviso automático para completar una).';
$string['newedgecontentvalue'] = 'Valor de contenido de conexión nueva';
$string['textcolor'] = 'Color de texto';
$string['textcolor_help'] = 'El color (como valor hexadecimal CSS, p. ej. #1f2937) del texto de las etiquetas de los nodos y de las conexiones, en todos los lienzos de esta pregunta. Déjalo en blanco para usar el valor por defecto de cada uno (texto blanco en los nodos, texto oscuro en las conexiones) - ten en cuenta que un color elegido aquí se aplica a ambos, por lo que podría no combinar bien con el color de fondo de todos los nodos.';
$string['addednodessummary'] = '{$a} nodo(s) añadido(s) por el estudiante';
$string['privacy:metadata'] = 'El plugin de tipo de pregunta Grafo no almacena ningún dato personal por sí mismo. Las respuestas de los estudiantes (los nodos que añaden) se almacenan como parte de los datos estándar del intento de pregunta, que están cubiertos por el propio proveedor de privacidad del motor de preguntas.';
