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
        $question->options->altanswers = array_values($DB->get_records('qtype_graph_altanswers',
                array('questionid' => $question->id), 'sortorder ASC'));
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
        $options->strictinputchecks = !empty($formdata->strictinputchecks) ? 1 : 0;
        $options->newnodecontenttype = $formdata->newnodecontenttype ?? 'input';
        $options->newnodecontentvalue = $formdata->newnodecontentvalue ?? '';
        $options->newedgecontenttype = $formdata->newedgecontenttype ?? 'input';
        $options->newedgecontentvalue = $formdata->newedgecontentvalue ?? '';
        $options->showgrid = !empty($formdata->showgrid) ? 1 : 0;
        $options->bgcolor = $formdata->bgcolor ?? '#e2e8f0';
        $options->gridcolor = $formdata->gridcolor ?? '#1b1f27';
        $options->textcolor = $formdata->textcolor ?? '';
        $options->shownodetrail = !empty($formdata->shownodetrail) ? 1 : 0;
        $options->showlevellabels = !empty($formdata->showlevellabels) ? 1 : 0;
        $options->levellabelsjson = $formdata->levellabelsjson ?? '';
        $options = $this->save_combined_feedback_helper($options, $formdata, $formdata->context, true);
        $DB->update_record('qtype_graph_options', $options);

        $this->save_alt_answers($formdata);

        // True: this question type's hints carry the "clear incorrect responses"
        // and "show number of correct responses" options - see make_hint() below.
        $this->save_hints($formdata, true);
    }

    /**
     * Replace this question's qtype_graph_altanswers rows with whatever the
     * edit form's "Alternate answer graphs" tool (amd/src/editor.js's
     * initAltAnswers()) submitted, in altresultgraphsjson - a JSON array of
     * graph objects, one per alternate, in display order.
     *
     * @param stdClass $formdata
     */
    protected function save_alt_answers(stdClass $formdata): void {
        global $DB;

        $altgraphs = json_decode($formdata->altresultgraphsjson ?? '[]', true);
        if (!is_array($altgraphs)) {
            $altgraphs = [];
        }

        $DB->delete_records('qtype_graph_altanswers', ['questionid' => $formdata->id]);
        foreach (array_values($altgraphs) as $index => $altgraph) {
            $DB->insert_record('qtype_graph_altanswers', (object) [
                'questionid' => $formdata->id,
                'graphjson' => json_encode($altgraph),
                'sortorder' => $index,
            ]);
        }
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
        $question->strictinputchecks = (bool) ($questiondata->options->strictinputchecks ?? 1);
        $question->newnodecontenttype = $questiondata->options->newnodecontenttype ?? 'input';
        $question->newnodecontentvalue = $questiondata->options->newnodecontentvalue ?? '';
        $question->newedgecontenttype = $questiondata->options->newedgecontenttype ?? 'input';
        $question->newedgecontentvalue = $questiondata->options->newedgecontentvalue ?? '';
        $question->showgrid = (bool) ($questiondata->options->showgrid ?? 1);
        $question->bgcolor = $questiondata->options->bgcolor ?? '#e2e8f0';
        $question->gridcolor = $questiondata->options->gridcolor ?? '#1b1f27';
        $question->textcolor = $questiondata->options->textcolor ?? '';
        $question->shownodetrail = (bool) ($questiondata->options->shownodetrail ?? 1);
        $question->showlevellabels = (bool) ($questiondata->options->showlevellabels ?? 1);
        $question->levellabelsjson = $questiondata->options->levellabelsjson ?? '';
        $question->altresultgraphs = array_map(function($altanswer) {
            return $altanswer->graphjson;
        }, $questiondata->options->altanswers ?? []);
        $this->initialise_combined_feedback($question, $questiondata, true);
    }

    public function delete_question($questionid, $contextid) {
        global $DB;

        $DB->delete_records('qtype_graph_options', array('questionid' => $questionid));
        $DB->delete_records('qtype_graph_altanswers', array('questionid' => $questionid));
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

    /**
     * Export this question to Moodle XML ("Export questions to file" in the question
     * bank). Fully custom rather than relying on question_type::export_to_xml()'s
     * extra_question_fields()-based default, since that only handles a single flat
     * options row plus standard question_answers - not the combined-feedback fields
     * or the qtype_graph_altanswers to-many table this plugin also has.
     *
     * Only ever returns the qtype-specific middle of the <question> element -
     * qformat_xml::writequestion() already writes the generic header (name,
     * questiontext, generalfeedback, defaultgrade, penalty, hidden, idnumber)
     * before calling this, and appends hints/tags after, for every qtype.
     *
     * @param stdClass $question the question data (options/altanswers already
     *                 loaded, as get_question_options() populates them).
     * @param qformat_xml $format
     * @param mixed $extra unused - part of the interface, always null for XML export.
     * @return string XML.
     */
    public function export_to_xml($question, qformat_xml $format, $extra = null) {
        $options = $question->options;

        $expout = '';
        $expout .= '    <graphjson>' . $format->xml_escape($options->graphjson) . "</graphjson>\n";
        $expout .= '    <resultgraphjson>' . $format->xml_escape($options->resultgraphjson) . "</resultgraphjson>\n";
        $expout .= "    <allowaddnodes>{$options->allowaddnodes}</allowaddnodes>\n";
        $expout .= "    <allowdeletenodes>{$options->allowdeletenodes}</allowdeletenodes>\n";
        $expout .= "    <strictinputchecks>{$options->strictinputchecks}</strictinputchecks>\n";
        $expout .= '    <newnodecontenttype>' . $format->xml_escape($options->newnodecontenttype) .
                "</newnodecontenttype>\n";
        $expout .= '    <newnodecontentvalue>' . $format->xml_escape($options->newnodecontentvalue) .
                "</newnodecontentvalue>\n";
        $expout .= '    <newedgecontenttype>' . $format->xml_escape($options->newedgecontenttype) .
                "</newedgecontenttype>\n";
        $expout .= '    <newedgecontentvalue>' . $format->xml_escape($options->newedgecontentvalue) .
                "</newedgecontentvalue>\n";
        $expout .= "    <showgrid>{$options->showgrid}</showgrid>\n";
        $expout .= '    <bgcolor>' . $format->xml_escape($options->bgcolor) . "</bgcolor>\n";
        $expout .= '    <gridcolor>' . $format->xml_escape($options->gridcolor) . "</gridcolor>\n";
        $expout .= '    <textcolor>' . $format->xml_escape($options->textcolor ?? '') . "</textcolor>\n";
        $expout .= "    <shownodetrail>{$options->shownodetrail}</shownodetrail>\n";
        $expout .= "    <showlevellabels>{$options->showlevellabels}</showlevellabels>\n";
        $expout .= '    <levellabelsjson>' . $format->xml_escape($options->levellabelsjson ?? '') .
                "</levellabelsjson>\n";
        $expout .= $format->write_combined_feedback($options, $question->id, $question->contextid);

        $expout .= "    <altanswers>\n";
        foreach (($options->altanswers ?? []) as $altanswer) {
            $expout .= "      <altanswer>\n";
            $expout .= '        <graphjson>' . $format->xml_escape($altanswer->graphjson) . "</graphjson>\n";
            $expout .= "      </altanswer>\n";
        }
        $expout .= "    </altanswers>\n";

        return $expout;
    }

    /**
     * Import this question from Moodle XML ("Import questions from file"). Fully
     * custom, mirroring qtype_multichoice's own import_from_xml() - see
     * export_to_xml() above for why the shared default isn't used.
     *
     * @param array $data the parsed <question> element (expat tree shape).
     * @param stdClass|null $question unused - always null via qformat_xml's call path.
     * @param qformat_xml $format
     * @param mixed $extra unused - part of the interface, always null for XML import.
     * @return stdClass|bool the question data ready for save_question()/
     *         save_question_options(), or false if $data is not a graph question
     *         (qformat_xml tries every installed qtype's import_from_xml in turn).
     */
    public function import_from_xml($data, $question, qformat_xml $format, $extra = null) {
        if (($data['@']['type'] ?? '') !== 'graph') {
            return false;
        }

        $qo = $format->import_headers($data);
        $qo->qtype = 'graph';

        $qo->graphjson = $format->getpath($data, ['#', 'graphjson', 0, '#'], '', true);
        $qo->resultgraphjson = $format->getpath($data, ['#', 'resultgraphjson', 0, '#'], '', true);
        $qo->allowaddnodes = $format->getpath($data, ['#', 'allowaddnodes', 0, '#'], 1);
        $qo->allowdeletenodes = $format->getpath($data, ['#', 'allowdeletenodes', 0, '#'], 0);
        $qo->strictinputchecks = $format->getpath($data, ['#', 'strictinputchecks', 0, '#'], 1);
        $qo->newnodecontenttype = $format->getpath($data, ['#', 'newnodecontenttype', 0, '#'], 'input', true);
        $qo->newnodecontentvalue = $format->getpath($data, ['#', 'newnodecontentvalue', 0, '#'], '', true);
        $qo->newedgecontenttype = $format->getpath($data, ['#', 'newedgecontenttype', 0, '#'], 'input', true);
        $qo->newedgecontentvalue = $format->getpath($data, ['#', 'newedgecontentvalue', 0, '#'], '', true);
        $qo->showgrid = $format->getpath($data, ['#', 'showgrid', 0, '#'], 1);
        $qo->bgcolor = $format->getpath($data, ['#', 'bgcolor', 0, '#'], '#e2e8f0', true);
        $qo->gridcolor = $format->getpath($data, ['#', 'gridcolor', 0, '#'], '#1b1f27', true);
        $qo->textcolor = $format->getpath($data, ['#', 'textcolor', 0, '#'], '', true);
        $qo->shownodetrail = $format->getpath($data, ['#', 'shownodetrail', 0, '#'], 1);
        $qo->showlevellabels = $format->getpath($data, ['#', 'showlevellabels', 0, '#'], 1);
        $qo->levellabelsjson = $format->getpath($data, ['#', 'levellabelsjson', 0, '#'], '', true);

        $format->import_combined_feedback($qo, $data, true);

        $altanswers = [];
        $altanswernodes = $format->getpath($data, ['#', 'altanswers', 0, '#', 'altanswer'], []);
        foreach ($altanswernodes as $altanswerxml) {
            $graphjson = $format->getpath($altanswerxml, ['#', 'graphjson', 0, '#'], '', true);
            $decoded = json_decode($graphjson, true);
            $altanswers[] = is_array($decoded) ? $decoded : new stdClass();
        }
        $qo->altresultgraphsjson = json_encode($altanswers);

        $format->import_hints($qo, $data, true, false, $format->get_format($qo->questiontextformat));

        return $qo;
    }
}
