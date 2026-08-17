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
 * Graph question renderer class.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/question/type/rendererbase.php');

/**
 * Generates the output for graph questions: the teacher's graph, locked,
 * plus whatever the student has added so far.
 *
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class qtype_graph_renderer extends qtype_renderer {

    public function formulation_and_controls(question_attempt $qa, question_display_options $options) {
        $question = $qa->get_question();
        $response = $qa->get_last_qt_data();
        $nodesjson = $response['nodesjson'] ?? '';

        $output = html_writer::div($question->format_questiontext($qa), 'qtext');

        $containerid = $qa->get_outer_question_div_unique_id() . '_graph';
        $output .= \qtype_graph\editor_ui::render($containerid);

        $fieldname = $qa->get_qt_field_name('nodesjson');
        $output .= html_writer::empty_tag('input', [
            'type' => 'hidden',
            'id' => $fieldname,
            'name' => $fieldname,
            'value' => $nodesjson,
            'class' => 'qtype_graph-response',
        ]);

        $this->page->requires->js_call_amd('qtype_graph/editor', 'initAttempt', [
            $containerid,
            $fieldname,
            $question->graphjson,
            (bool) $options->readonly,
        ]);

        return $output;
    }

    public function specific_feedback(question_attempt $qa) {
        return '';
    }

    public function correct_response(question_attempt $qa) {
        return '';
    }
}
