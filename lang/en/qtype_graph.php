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
$string['pluginname_help'] = 'The student is shown a graph (nodes and connections) built by the teacher, and can add their own nodes connected to it. The question is always graded manually.';
$string['pluginnameadding'] = 'Adding a Graph question';
$string['pluginnameediting'] = 'Editing a Graph question';
$string['pluginnamesummary'] = 'The teacher builds a graph (nodes and connections); students view it and add their own connected nodes as their answer. Graded manually.';
$string['graphjson'] = 'Graph';
$string['graphjson_help'] = 'Build the graph the student will see. Click a node to edit its text/color, add connected nodes, or delete it. To add a fill-in-the-blank inside a node or edge label, type {{T_INPUT;"answer1";"answer2"}} anywhere in the text (one or more accepted answers, each in double quotes and separated by semicolons - answers must not contain a " character) - it will show as an empty text box for the student to fill in.';
$string['err_emptygraph'] = 'The graph must have at least one node.';
$string['resultgraphjson'] = 'Result graph (for automatic grading)';
$string['resultgraphjson_help'] = 'Build the graph that represents the correct/expected final answer. This is a separate, independent canvas from the graph above - it does not affect what students see, and does not yet affect scoring (automatic grading against this graph is not implemented yet).';
$string['resetresultgraph'] = 'Reset to default graph';
$string['resetresultgraph_confirm'] = 'This will overwrite the result graph below with a copy of the graph above, discarding any changes made to it. Continue?';
$string['allowaddnodes'] = 'Allow students to add new nodes';
$string['allowdeletenodes'] = 'Allow students to delete original nodes';
$string['addednodessummary'] = '{$a} student-added node(s)';
$string['privacy:metadata'] = 'The Graph question type plugin does not store any personal data itself. Student responses (the nodes they add) are stored as part of the standard question attempt data, which is covered by the question engine\'s own privacy provider.';
