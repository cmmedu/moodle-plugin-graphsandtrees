<?php
// This file is part of qtype_graph, a question type plugin for Moodle - http://moodle.org/
//
// Released under the MIT License. See the LICENSE file at the root of this plugin.

/**
 * Strings for component 'qtype_graph', language 'en'.
 *
 * @package    qtype_graph
 * @copyright  2026 CMMEdu
 * @license    https://opensource.org/licenses/MIT MIT
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
$string['resultgraphjson_help'] = 'Build the graph or tree that represents the correct/expected final answer, matched against the default graph above by node/edge id - use "Reset to default graph" to start from a copy of it. Every node/edge here is checked automatically: delete one here to mark it as something the student is expected to delete; for one you marked "Marcar como input" above, type the accepted answer here instead - a single answer (e.g. Madrid), several with {{answer1;answer2}} (quotes optional, e.g. {{"answer1";"answer2"}}), {{T_ANY}} to accept anything non-empty, or {{T_ANY_N_EMPTY}} to accept anything, including a blank answer. For numeric validation, write {{N:...}}: the student must enter a number (comma or dot decimal separator, and fractions such as 1/2, equal to 0.5 or 2/4) and it is compared by value - {{N:0.5}} an exact value, {{N:1/3}} a fraction, {{N:3.14:0.01}} a value with tolerance (3.13 to 3.15), {{N:1..2}} a range, {{N:*}} any number, or several at once with {{N:2;-2;5..6}}. For one marked "Marcar como fracción" ({{F:numerator|denominator}}), write the answer as a/b (e.g. 3/4, or {{N:3/4}} to also accept equivalent fractions and decimals). Leave this whole canvas empty to keep this question fully manually graded, exactly as before this feature existed.';
$string['resetresultgraph'] = 'Reset to default graph';
$string['resetresultgraph_confirm'] = 'This will overwrite the result graph below with a copy of the graph above, discarding any changes made to it. Continue?';
$string['validategraphs'] = 'Validate answer graph';
$string['altanswersheader'] = 'Alternate answer graphs';
$string['altanswershelp'] = 'If more than one final graph should count as correct, add extra answer graphs here - each is a full copy of the Answer graph above (matched against the default graph by node/edge id in the same way), for cases the single answer graph above cannot express as one set of accepted answers per blank. When grading a response, each answer graph (this one plus every alternate) is checked independently and the student is given whichever score is highest. Marking a node/edge as a fill-in-the-blank in the default graph clears that id in the answer graph above AND in every alternate here, ready for you to type the accepted answer into each.';
$string['addaltanswer'] = 'Add alternate answer graph';
$string['allowaddnodes'] = 'Allow students to add new nodes';
$string['allowdeletenodes'] = 'Allow students to delete original nodes';
$string['allowdownloadimage'] = 'Allow students to download their graph as an image';
$string['allowdownloadimage_help'] = 'When enabled, students see an image-export button on the attempt canvas\'s toolbar, letting them download their current graph as a PNG or SVG file. Disabled by default.';
$string['allowchangeorientation'] = 'Allow students to change tree orientation';
$string['allowchangeorientation_help'] = 'When enabled, students see the vertical/horizontal orientation toggle on the attempt canvas\'s toolbar (tree mode only) and can switch it themselves. Disabled by default - the toggle is hidden entirely, not just disabled.';
$string['allowchangelinestyle'] = 'Allow students to change branch (connection line) style';
$string['allowchangelinestyle_help'] = 'When enabled, students see the straight/orthogonal connection line-style toggle on the attempt canvas\'s toolbar and can switch it themselves. Disabled by default - the toggle is hidden entirely, not just disabled.';
$string['allowchangegraphtype'] = 'Allow students to change graph type (graph or tree)';
$string['allowchangegraphtype_help'] = 'When enabled, students see the graph/tree mode toggle on the attempt canvas\'s toolbar and can switch it themselves. Disabled by default - the toggle is hidden entirely, not just disabled.';
$string['contenttype_input'] = 'Free text';
$string['contenttype_select'] = 'Dropdown';
$string['contenttype_text'] = 'Fixed text (not editable)';
$string['newnodecontenttype'] = 'New node content';
$string['newnodecontenttype_help'] = 'What a student sees when they add a new node connected to the graph during their attempt (only applies to nodes the student creates - never to the teacher-authored default graph). "Free text" is today\'s behaviour: an editable box, with the value below used as its placeholder hint. "Dropdown" gives the student a fixed list to choose from instead of typing - the value below is a semicolon-separated option list, e.g. Madrid;Barcelona;Sevilla. "Fixed text" creates the new node with exactly the value below and the student cannot change it - only whether they add it, and how they connect it, is part of their answer.';
$string['newnodecontentvalue'] = 'New node content value';
$string['newedgecontenttype'] = 'New connector content';
$string['newedgecontenttype_help'] = 'Same three choices as "New node content" above, but for the label of a new connection a student creates - only shown if the student opens that connection\'s menu to set its label (there is no automatic grading of connection labels, and no automatic prompt to fill one in).';
$string['newedgecontentvalue'] = 'New connector content value';
$string['textcolor'] = 'Text color';
$string['textcolor_help'] = 'The color (as a CSS hex value, e.g. #1f2937) of node labels and connection labels, on every canvas for this question. Leave blank to use the default for each (white node text, dark connection text) - note that a color chosen here applies to both, so it might not suit every node\'s own background color equally well.';
$string['addednodessummary'] = '{$a} student-added node(s)';
$string['privacy:metadata'] = 'The Graph question type plugin does not store any personal data itself. Student responses (the nodes they add) are stored as part of the standard question attempt data, which is covered by the question engine\'s own privacy provider.';
