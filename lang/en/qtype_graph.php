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
$string['graphjson_help'] = 'Build the graph the student will see. Click a node to edit its text/color, add connected nodes, or delete it.';
$string['err_emptygraph'] = 'The graph must have at least one node.';
$string['addednodessummary'] = '{$a} student-added node(s)';
$string['privacy:metadata'] = 'The Graph question type plugin does not store any personal data itself. Student responses (the nodes they add) are stored as part of the standard question attempt data, which is covered by the question engine\'s own privacy provider.';
