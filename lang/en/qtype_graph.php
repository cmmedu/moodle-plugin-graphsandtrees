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

/**
 * Strings for component 'qtype_graph', language 'en'.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

$string['pluginname'] = 'Graph';
$string['pluginname_help'] = 'The student is shown a graph (nodes and connections) built by the teacher, and can add their own nodes connected to it. Graded automatically once the teacher has built a result graph, manually otherwise.';
$string['pluginnameadding'] = 'Adding a Graph question';
$string['pluginnameediting'] = 'Editing a Graph question';
$string['pluginnamesummary'] = 'The teacher builds a graph (nodes and connections); students view it and add their own connected nodes as their answer. Graded automatically once a result graph is set up, manually otherwise.';
$string['graphjson'] = 'Default graph';
$string['graphjson_help'] = 'Build the graph or tree the student will see. Click a node or edge to edit its text/color, add connected nodes, or delete it. To turn a node or edge into a fill-in-the-blank, click it and choose "Marcar como input" - this replaces its whole label with an empty box the student types into. The blank itself does not carry the correct answer: define that separately below, in the Answer graph, on the node/edge with the same id (clicking "Marcar como input" clears it there automatically, ready to fill in).';
$string['err_emptygraph'] = 'The graph must have at least one node.';
$string['invalidresponse'] = 'No valid graph response was submitted.';
$string['resultgraphjson'] = 'Answer graph';
$string['resultgraphjson_help'] = 'Build the graph or tree that represents the correct/expected final answer, matched against the default graph above by node/edge id - use "Reset to default graph" to start from a copy of it. Every node/edge here is checked automatically: delete one here to mark it as something the student is expected to delete; for one you marked "Marcar como input" above, type the accepted answer here instead - a single answer (e.g. Madrid), several with {{"answer1";"answer2"}}, {{T_ANY}} to accept anything non-empty, or {{T_ANY_N_EMPTY}} to accept anything, including a blank answer. Leave this whole canvas empty to keep this question fully manually graded, exactly as before this feature existed.';
$string['resetresultgraph'] = 'Reset to default graph';
$string['resetresultgraph_confirm'] = 'This will overwrite the result graph below with a copy of the graph above, discarding any changes made to it. Continue?';
$string['validategraphs'] = 'Validate answer graph';
$string['allowaddnodes'] = 'Allow students to add new nodes';
$string['allowdeletenodes'] = 'Allow students to delete original nodes';
$string['addednodessummary'] = '{$a} student-added node(s)';
$string['privacy:metadata'] = 'The Graph question type plugin does not store any personal data itself. Student responses (the nodes they add) are stored as part of the standard question attempt data, which is covered by the question engine\'s own privacy provider.';
