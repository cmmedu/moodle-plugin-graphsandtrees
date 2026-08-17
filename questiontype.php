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
 * graded manually.
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
            $options->id = $DB->insert_record('qtype_graph_options', $options);
        }

        $options->graphjson = $formdata->graphjson ?? '';
        $DB->update_record('qtype_graph_options', $options);
    }

    protected function initialise_question_instance(question_definition $question, $questiondata) {
        parent::initialise_question_instance($question, $questiondata);
        $question->graphjson = $questiondata->options->graphjson;
    }

    public function delete_question($questionid, $contextid) {
        global $DB;

        $DB->delete_records('qtype_graph_options', array('questionid' => $questionid));
        parent::delete_question($questionid, $contextid);
    }
}
