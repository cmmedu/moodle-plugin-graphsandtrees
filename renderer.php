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
class qtype_graph_renderer extends qtype_with_combined_feedback_renderer {

    public function formulation_and_controls(question_attempt $qa, question_display_options $options) {
        $question = $qa->get_question();
        $response = $qa->get_last_qt_data();
        // Feedback markers (below) are always graded against what the student actually
        // submitted, even when clearwrong is about to blank out the wrong parts for a
        // retry - otherwise the marker for a part just cleared would vanish along with it.
        $submittedresponse = $response;
        if ($options->clearwrong) {
            // A hint with "Clear incorrect responses" is showing: the student
            // gets their wrong parts back empty for the next try. Applied to the
            // one hidden field below rather than through the base class's
            // clear_wrong() - see that method's override at the end of this class.
            $response = $question->clear_wrong_from_response($response);
        }
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

        $feedbackjson = null;
        if ($options->correctness) {
            $breakdown = $question->get_feedback_breakdown($submittedresponse);
            if (!empty($breakdown['nodes']) || !empty($breakdown['edges']) || !empty($breakdown['newnodes'])) {
                $feedbackjson = json_encode($breakdown);
            }
        }

        $this->page->requires->js_call_amd('qtype_graph/editor', 'initAttempt', [
            $containerid,
            $fieldname,
            \qtype_graph\blank_token::strip_answers($question->graphjson),
            (bool) $options->readonly,
            (bool) $question->allowaddnodes,
            (bool) $question->allowdeletenodes,
            $feedbackjson,
            $question->newnodecontenttype,
            $question->newnodecontentvalue,
            $question->newedgecontenttype,
            $question->newedgecontentvalue,
        ]);

        return $output;
    }

    /**
     * The whole response lives in a single hidden nodesjson field that the JS
     * editor writes to by id, so the base class's approach - appending a second
     * hidden field carrying the cleared response - would leave the form with two
     * inputs of that name, and the one the editor is not updating would win on
     * submit. formulation_and_controls() above puts the cleared response
     * straight into that single field instead, so there is nothing to add here.
     *
     * @param question_attempt $qa the question attempt to display.
     * @return string empty.
     */
    public function clear_wrong(question_attempt $qa) {
        return '';
    }

    public function specific_feedback(question_attempt $qa) {
        // Only ever reached for a question with an answer graph: manualgraded
        // behaviour (question.php's make_behaviour(), for a question with none)
        // hides all feedback except general feedback and the manual comment
        // while active, and again once finished, so combined_feedback() -
        // which needs grade_response() to be automatic grading, not manual - is
        // never invoked in that case.
        return $this->combined_feedback($qa);
    }

    public function correct_response(question_attempt $qa) {
        return '';
    }
}
