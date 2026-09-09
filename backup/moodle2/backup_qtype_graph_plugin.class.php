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
 * Backup information for the graph question type.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

/**
 * Provides the information to backup graph questions: the qtype_graph_options
 * row (the single-row "extra fields" for this question - default/result graph,
 * settings, combined feedback) plus qtype_graph_altanswers (a to-many child of
 * the question, zero or more alternate answer graphs).
 *
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class backup_qtype_graph_plugin extends backup_qtype_plugin {

    /**
     * Returns the qtype information to attach to question element.
     *
     * @return backup_plugin_element
     */
    protected function define_question_plugin_structure() {
        // Define the virtual plugin element with the condition to fulfill.
        $plugin = $this->get_plugin_element(null, '../../qtype', 'graph');

        // Create one standard named plugin element (the visible container).
        $pluginwrapper = new backup_nested_element($this->get_recommended_name());

        // Connect the visible container ASAP.
        $plugin->add_child($pluginwrapper);

        // Named 'graph' (matching the qtype name), not e.g. 'options' - this is
        // what lets restore_qtype_plugin::convert_backup_to_questiondata()'s
        // generic handling pick this straight into $questiondata->options
        // without qtype_graph needing to override that method itself.
        $graph = new backup_nested_element('graph', ['id'], [
            'graphjson', 'resultgraphjson', 'allowaddnodes', 'allowdeletenodes',
            'newnodecontenttype', 'newnodecontentvalue', 'newedgecontenttype', 'newedgecontentvalue',
            'correctfeedback', 'correctfeedbackformat',
            'partiallycorrectfeedback', 'partiallycorrectfeedbackformat',
            'incorrectfeedback', 'incorrectfeedbackformat', 'shownumcorrect',
            'showgrid', 'bgcolor', 'gridcolor',
        ]);
        $pluginwrapper->add_child($graph);
        $graph->set_source_table('qtype_graph_options', ['questionid' => backup::VAR_PARENTID]);

        // Alternate answer graphs - a to-many child of the QUESTION (its own
        // questionid FK, same as qtype_graph_options above, not a child of $graph).
        $altanswers = new backup_nested_element('altanswers');
        $pluginwrapper->add_child($altanswers);

        $altanswer = new backup_nested_element('altanswer', ['id'], ['graphjson', 'sortorder']);
        $altanswers->add_child($altanswer);
        $altanswer->set_source_table('qtype_graph_altanswers', ['questionid' => backup::VAR_PARENTID], 'sortorder ASC');

        // Don't need to annotate ids nor files - graphjson/resultgraphjson/altanswer
        // graphjson are opaque structured JSON (never rendered as trusted HTML, so
        // never carry embedded file references), and the combined feedback fields
        // follow the same no-file-annotation precedent as core's own multichoice.

        return $plugin;
    }
}
