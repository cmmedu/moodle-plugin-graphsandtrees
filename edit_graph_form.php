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
 * Defines the editing form for the graph question type.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

/**
 * Graph question type editing form: lets the teacher build the graph the
 * students will see, using the same editor widget as the attempt page.
 *
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class qtype_graph_edit_form extends question_edit_form {

    protected function definition_inner($mform) {
        global $PAGE;

        $mform->addElement('header', 'graphheader', get_string('graphjson', 'qtype_graph'));
        $mform->setExpanded('graphheader');
        $mform->addElement('static', 'graphjsonhelp', '', get_string('graphjson_help', 'qtype_graph'));

        $mform->addElement('advcheckbox', 'allowaddnodes', get_string('allowaddnodes', 'qtype_graph'));
        $mform->setDefault('allowaddnodes', 1);

        $mform->addElement('advcheckbox', 'allowdeletenodes', get_string('allowdeletenodes', 'qtype_graph'));
        $mform->setDefault('allowdeletenodes', 0);

        $containerid = 'qtype_graph_editor_' . html_writer::random_id('editor');
        $mform->addElement('html', \qtype_graph\editor_ui::render($containerid));

        $mform->addElement('hidden', 'graphjson', null, ['id' => 'id_graphjson']);
        $mform->setType('graphjson', PARAM_RAW);

        $PAGE->requires->js_call_amd('qtype_graph/editor', 'initEditor',
                [$containerid, 'id_graphjson']);
    }

    protected function data_preprocessing($question) {
        $question = parent::data_preprocessing($question);

        if (!empty($question->options)) {
            $question->graphjson = $question->options->graphjson;
            $question->allowaddnodes = $question->options->allowaddnodes;
            $question->allowdeletenodes = $question->options->allowdeletenodes;
        }

        return $question;
    }

    public function validation($fromform, $files) {
        $errors = parent::validation($fromform, $files);

        $graphjson = $fromform['graphjson'] ?? '';
        $data = json_decode($graphjson, true);
        if (!is_array($data) || empty($data['nodes'])) {
            $errors['graphjson'] = get_string('err_emptygraph', 'qtype_graph');
        }

        return $errors;
    }

    public function qtype() {
        return 'graph';
    }
}
