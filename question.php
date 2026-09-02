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
 * Graph question definition class.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/question/type/questionbase.php');

/**
 * Represents a graph question: the teacher's graph, plus whatever the
 * student adds to it. Automatically graded (via classes/grading.php) once
 * the teacher has authored a result graph; falls back to fully manual
 * grading - exactly as before this feature existed - for any question
 * where resultgraphjson is still empty.
 *
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class qtype_graph_question extends question_graded_automatically {

    /** @var string JSON-encoded teacher-authored graph (nodes, edges, view settings). */
    public $graphjson;

    /** @var string JSON-encoded expected/correct result graph, used for automatic grading. */
    public $resultgraphjson;

    /** @var bool whether students may add new nodes. */
    public $allowaddnodes = true;

    /** @var bool whether students may delete the teacher-authored (original) nodes. */
    public $allowdeletenodes = false;

    /** @var string feedback shown for a fully correct response. */
    public $correctfeedback;
    /** @var int format of $correctfeedback. */
    public $correctfeedbackformat;
    /** @var string feedback shown for a partially correct response. */
    public $partiallycorrectfeedback;
    /** @var int format of $partiallycorrectfeedback. */
    public $partiallycorrectfeedbackformat;
    /** @var string feedback shown for a fully incorrect response. */
    public $incorrectfeedback;
    /** @var int format of $incorrectfeedback. */
    public $incorrectfeedbackformat;
    // $shownumcorrect is already declared by question_graded_automatically (questionbase.php).

    public function make_behaviour(question_attempt $qa, $preferredbehaviour) {
        if (trim((string) $this->resultgraphjson) === '') {
            // No result graph authored yet - stay fully manually graded,
            // exactly like every graph question before this feature existed.
            return question_engine::make_behaviour('manualgraded', $qa, $preferredbehaviour);
        }
        return parent::make_behaviour($qa, $preferredbehaviour);
    }

    public function get_expected_data() {
        return array('nodesjson' => PARAM_RAW);
    }

    public function grade_response(array $response) {
        $fraction = \qtype_graph\grading::grade($this->graphjson, $this->resultgraphjson, $response,
                (bool) $this->allowaddnodes);
        return array($fraction, question_state::graded_state_for_fraction($fraction));
    }

    /**
     * Used by the interactive-with-parts behaviour ("Show the number of correct
     * responses"). Every node and edge of the teacher's graph is one part, plus
     * one for each new node the result graph expects the student to create.
     *
     * @param array $response the student's response.
     * @return array [number of parts right, total number of parts].
     */
    public function get_num_parts_right(array $response) {
        if (trim((string) $this->resultgraphjson) === '') {
            // Manually graded: there are no automatically checkable parts to count.
            return [null, null];
        }
        list($correct, $total) = \qtype_graph\grading::count_parts_right($this->graphjson,
                $this->resultgraphjson, $response, (bool) $this->allowaddnodes);
        // A null total tells qtype_renderer::num_parts_correct() to say nothing at all,
        // which beats claiming the student got 0 out of 0 parts right.
        return [$correct, $total > 0 ? $total : null];
    }

    /**
     * Per-item correctness breakdown for the attempt renderer's feedback markers
     * (see classes/grading.php::feedback_breakdown() and
     * renderer.php::formulation_and_controls()). Empty when this question is not
     * auto-graded, same condition as everywhere else in this class.
     *
     * @param array $response the student's response.
     * @return array {nodes: {id: bool}, edges: {id: bool}, newnodes: {id: bool}}, or all-empty.
     */
    public function get_feedback_breakdown(array $response) {
        if (trim((string) $this->resultgraphjson) === '') {
            return ['nodes' => [], 'edges' => [], 'newnodes' => []];
        }
        return \qtype_graph\grading::feedback_breakdown($this->graphjson, $this->resultgraphjson,
                $response, (bool) $this->allowaddnodes);
    }

    /**
     * Used by the interactive-with-parts behaviour ("Clear incorrect responses"):
     * empties wrong blanks and drops wrongly added/deleted nodes, so the student
     * retries only the parts they got wrong.
     *
     * @param array $response the student's response.
     * @return array the response with its wrong parts reset.
     */
    public function clear_wrong_from_response(array $response) {
        if (trim((string) $this->resultgraphjson) === '') {
            return $response;
        }
        return \qtype_graph\grading::clear_wrong($this->graphjson, $this->resultgraphjson,
                $response, (bool) $this->allowaddnodes);
    }

    public function check_file_access($qa, $options, $component, $filearea, $args, $forcedownload) {
        if ($component == 'question' && in_array($filearea,
                ['correctfeedback', 'partiallycorrectfeedback', 'incorrectfeedback'])) {
            return $this->check_combined_feedback_file_access($qa, $options, $filearea, $args);
        } else if ($component == 'question' && $filearea == 'hint') {
            return $this->check_hint_file_access($qa, $options, $args);
        }
        return parent::check_file_access($qa, $options, $component, $filearea, $args, $forcedownload);
    }

    public function get_validation_error(array $response) {
        if ($this->is_gradable_response($response)) {
            return '';
        }
        return get_string('invalidresponse', 'qtype_graph');
    }

    public function get_correct_response() {
        // Reconstructing a full "correct" nodesjson (with matching blanks
        // values) from resultgraphjson is not implemented yet - grading
        // itself (grade_response(), above) does not need it. Only affects
        // get_right_answer_summary()'s display, which stays blank for now.
        return null;
    }

    public function is_complete_response(array $response) {
        return array_key_exists('nodesjson', $response) && $this->decode_nodes($response['nodesjson']) !== null;
    }

    public function is_gradable_response(array $response) {
        return $this->is_complete_response($response);
    }

    public function is_same_response(array $prevresponse, array $newresponse) {
        return question_utils::arrays_same_at_key_missing_is_blank(
                $prevresponse, $newresponse, 'nodesjson');
    }

    public function summarise_response(array $response) {
        if (!array_key_exists('nodesjson', $response)) {
            return null;
        }
        $data = $this->decode_nodes($response['nodesjson']);
        if ($data === null) {
            return null;
        }
        $nodes = $data['nodes'] ?? [];
        if (empty($nodes)) {
            return get_string('addednodessummary', 'qtype_graph', 0);
        }
        $labels = array_map(function($node) {
            return $node['text'] ?? '';
        }, $nodes);
        return get_string('addednodessummary', 'qtype_graph', count($nodes)) . ': ' . implode(', ', $labels);
    }

    /**
     * Decode and lightly validate a student response's nodesjson field.
     *
     * @param string $nodesjson raw JSON as submitted by the browser.
     * @return array|null the decoded ['nodes' => [...], 'edges' => [...]] structure, or null if invalid.
     */
    protected function decode_nodes($nodesjson) {
        if ($nodesjson === '' || $nodesjson === null) {
            return ['nodes' => [], 'edges' => []];
        }
        $data = json_decode($nodesjson, true);
        if (!is_array($data) || !array_key_exists('nodes', $data) || !is_array($data['nodes'])) {
            return null;
        }
        $data['edges'] = $data['edges'] ?? [];
        return $data;
    }
}
