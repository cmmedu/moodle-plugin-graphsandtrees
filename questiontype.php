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
 * Question type class for the graph question type.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

require_once($CFG->libdir . '/questionlib.php');

/**
 * The graph question type: teacher builds a graph, students add nodes to it,
 * graded automatically once a result graph is authored (see question.php),
 * manually otherwise.
 *
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class qtype_graph extends question_type {
    public function is_manual_graded() {
        return true;
    }

    public function get_question_options($question) {
        global $DB;
        $question->options = $DB->get_record('qtype_graph_options',
                array('questionid' => $question->id), '*', MUST_EXIST);
        parent::get_question_options($question);
    }

    public function save_question_options($formdata) {
        global $DB;

        $options = $DB->get_record('qtype_graph_options', array('questionid' => $formdata->id));
        if (!$options) {
            $options = new stdClass();
            $options->questionid = $formdata->id;
            // NOTNULL text columns with no DB-level default - insert_record() needs
            // something in them; save_combined_feedback_helper() overwrites these below.
            $options->correctfeedback = '';
            $options->partiallycorrectfeedback = '';
            $options->incorrectfeedback = '';
            $options->id = $DB->insert_record('qtype_graph_options', $options);
        }

        $options->graphjson = $formdata->graphjson ?? '';
        $options->resultgraphjson = $formdata->resultgraphjson ?? '';
        $options->allowaddnodes = !empty($formdata->allowaddnodes) ? 1 : 0;
        $options->allowdeletenodes = !empty($formdata->allowdeletenodes) ? 1 : 0;
        $options = $this->save_combined_feedback_helper($options, $formdata, $formdata->context, true);
        $DB->update_record('qtype_graph_options', $options);

        // True: this question type's hints carry the "clear incorrect responses"
        // and "show number of correct responses" options - see make_hint() below.
        $this->save_hints($formdata, true);
    }

    /**
     * Hints here are question_hint_with_parts, since a graph question is made of
     * many independently gradable parts (every node and edge), so the multiple
     * tries settings can offer to clear the wrong ones or count the right ones.
     *
     * @param stdClass $hint the DB row defining the hint.
     * @return question_hint_with_parts
     */
    protected function make_hint($hint) {
        return question_hint_with_parts::load_from_record($hint);
    }

    protected function initialise_question_instance(question_definition $question, $questiondata) {
        parent::initialise_question_instance($question, $questiondata);
        $question->graphjson = $questiondata->options->graphjson;
        $question->resultgraphjson = $questiondata->options->resultgraphjson ?? '';
        $question->allowaddnodes = (bool) $questiondata->options->allowaddnodes;
        $question->allowdeletenodes = (bool) $questiondata->options->allowdeletenodes;
        $this->initialise_combined_feedback($question, $questiondata, true);
    }

    public function delete_question($questionid, $contextid) {
        global $DB;

        $DB->delete_records('qtype_graph_options', array('questionid' => $questionid));
        parent::delete_question($questionid, $contextid);
    }

    public function move_files($questionid, $oldcontextid, $newcontextid) {
        parent::move_files($questionid, $oldcontextid, $newcontextid);
        $this->move_files_in_combined_feedback($questionid, $oldcontextid, $newcontextid);
        $this->move_files_in_hints($questionid, $oldcontextid, $newcontextid);
    }

    protected function delete_files($questionid, $contextid) {
        parent::delete_files($questionid, $contextid);
        $this->delete_files_in_combined_feedback($questionid, $contextid);
        $this->delete_files_in_hints($questionid, $contextid);
    }
}
