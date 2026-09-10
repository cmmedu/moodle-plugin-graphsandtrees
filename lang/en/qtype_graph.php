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
$string['altanswersheader'] = 'Alternate answer graphs';
$string['altanswershelp'] = 'If more than one final graph should count as correct, add extra answer graphs here - each is a full copy of the Answer graph above (matched against the default graph by node/edge id in the same way), for cases the single answer graph above cannot express as one set of accepted answers per blank. When grading a response, each answer graph (this one plus every alternate) is checked independently and the student is given whichever score is highest. Marking a node/edge as a fill-in-the-blank in the default graph clears that id in the answer graph above AND in every alternate here, ready for you to type the accepted answer into each.';
$string['addaltanswer'] = 'Add alternate answer graph';
$string['allowaddnodes'] = 'Allow students to add new nodes';
$string['allowdeletenodes'] = 'Allow students to delete original nodes';
$string['shownodetrail'] = 'Show node trail';
$string['shownodetrail_help'] = 'When enabled, clicking a node during the attempt highlights the path (nodes and connections) back to its origin node - the ancestor with no incoming connection. Click elsewhere on the canvas to clear the highlight.';
$string['contenttype_input'] = 'Free text';
$string['contenttype_select'] = 'Dropdown';
$string['contenttype_text'] = 'Fixed text (not editable)';
$string['newnodecontenttype'] = 'New node content';
$string['newnodecontenttype_help'] = 'What a student sees when they add a new node connected to the graph during their attempt (only applies to nodes the student creates - never to the teacher-authored default graph). "Free text" is today\'s behaviour: an editable box, with the value below used as its placeholder hint. "Dropdown" gives the student a fixed list to choose from instead of typing - the value below is a semicolon-separated option list, e.g. Madrid;Barcelona;Sevilla. "Fixed text" creates the new node with exactly the value below and the student cannot change it - only whether they add it, and how they connect it, is part of their answer.';
$string['newnodecontentvalue'] = 'New node content value';
$string['newedgecontenttype'] = 'New connector content';
$string['newedgecontenttype_help'] = 'Same three choices as "New node content" above, but for the label of a new connection a student creates - only shown if the student opens that connection\'s menu to set its label (there is no automatic grading of connection labels, and no automatic prompt to fill one in).';
$string['newedgecontentvalue'] = 'New connector content value';
$string['showgrid'] = 'Show background grid';
$string['showlevellabels'] = 'Show level labels';
$string['showlevellabels_help'] = 'When enabled, tree mode shows a "Nivel 0" (root), "Nivel 1", "Nivel 2", ... label per depth - above each column in horizontal orientation, to the left of each row in vertical orientation. Applies to every canvas for this question (this editor, the answer graph, every alternate, and what the student sees during their attempt). Has no effect in graph mode.';
$string['levellabeloverridesheader'] = 'Level label overrides';
$string['levellabeloverrideshelp'] = 'Fine-tune individual levels\' labels (only takes effect while "Show level labels" above is on). For each depth: untick the checkbox to hide that one level\'s label regardless of the setting above; type a title to replace its default "Nivel <depth>" text; type a subtitle to show a second, smaller line under the title (left empty, no subtitle is shown). A depth deeper than the rows below always uses the default title, shown, with no subtitle.';
$string['levellabeloverride_row'] = 'Level {$a}';
$string['levellabeloverride_subtitleplaceholder'] = 'Subtitle (optional)';
$string['bgcolor'] = 'Canvas background color';
$string['bgcolor_help'] = 'The background color (as a CSS hex value, e.g. #e2e8f0) of every canvas for this question: the default graph, the answer graph, every alternate answer graph, and what the student sees during their attempt.';
$string['gridcolor'] = 'Grid color';
$string['gridcolor_help'] = 'The color (as a CSS hex value, e.g. #1b1f27) of the background grid lines, on every canvas for this question. Only visible when "Show background grid" is enabled.';
$string['addednodessummary'] = '{$a} student-added node(s)';
$string['privacy:metadata'] = 'The Graph question type plugin does not store any personal data itself. Student responses (the nodes they add) are stored as part of the standard question attempt data, which is covered by the question engine\'s own privacy provider.';
