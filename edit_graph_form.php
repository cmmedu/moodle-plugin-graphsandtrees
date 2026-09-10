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

        // Explicit id (rather than relying on mform's default id_<name> generation) since
        // initValidation() below needs to read its live checked state by id.
        $mform->addElement('advcheckbox', 'allowaddnodes', get_string('allowaddnodes', 'qtype_graph'),
                null, ['id' => 'id_allowaddnodes']);
        $mform->setDefault('allowaddnodes', 1);

        $mform->addElement('advcheckbox', 'allowdeletenodes', get_string('allowdeletenodes', 'qtype_graph'));
        $mform->setDefault('allowdeletenodes', 0);

        $mform->addElement('advcheckbox', 'shownodetrail', get_string('shownodetrail', 'qtype_graph'));
        $mform->setDefault('shownodetrail', 0);
        $mform->addHelpButton('shownodetrail', 'shownodetrail', 'qtype_graph');

        $newcontenttypeoptions = [
            'input' => get_string('contenttype_input', 'qtype_graph'),
            'select' => get_string('contenttype_select', 'qtype_graph'),
            'text' => get_string('contenttype_text', 'qtype_graph'),
        ];

        $mform->addElement('select', 'newnodecontenttype', get_string('newnodecontenttype', 'qtype_graph'),
                $newcontenttypeoptions);
        $mform->setDefault('newnodecontenttype', 'input');
        $mform->addHelpButton('newnodecontenttype', 'newnodecontenttype', 'qtype_graph');

        $mform->addElement('text', 'newnodecontentvalue', get_string('newnodecontentvalue', 'qtype_graph'),
                ['size' => 50]);
        $mform->setType('newnodecontentvalue', PARAM_TEXT);

        $mform->addElement('select', 'newedgecontenttype', get_string('newedgecontenttype', 'qtype_graph'),
                $newcontenttypeoptions);
        $mform->setDefault('newedgecontenttype', 'input');
        $mform->addHelpButton('newedgecontenttype', 'newedgecontenttype', 'qtype_graph');

        $mform->addElement('text', 'newedgecontentvalue', get_string('newedgecontentvalue', 'qtype_graph'),
                ['size' => 50]);
        $mform->setType('newedgecontentvalue', PARAM_TEXT);

        // Explicit ids (rather than relying on mform's default id_<name> generation) since
        // initCanvasSettings() below needs to read/listen to them by id. Applies to every
        // canvas this question has (default, result, every alternate, and the student
        // attempt canvas) - see editor_ui::render()'s $dataattrs calls below and in
        // renderer.php, and setCanvasStyle() in amd/src/editor.js.
        $mform->addElement('advcheckbox', 'showgrid', get_string('showgrid', 'qtype_graph'),
                null, ['id' => 'id_showgrid']);
        $mform->setDefault('showgrid', 1);

        // A plain text field (so a hex value can be typed/pasted directly), paired on the
        // same row with a native color-swatch picker as a convenience that overwrites it -
        // the picker isn't an mform element itself (no name attribute, so it never submits
        // as its own form field), just a visual affordance kept in sync with the text field
        // in both directions by initCanvasSettings().
        $bgcolorgroup = [
            $mform->createElement('text', 'bgcolor', '', ['id' => 'id_bgcolor', 'size' => 10]),
            $mform->createElement('html', html_writer::empty_tag('input', [
                'type' => 'color',
                'id' => 'id_bgcolor_picker',
                'value' => $this->question->options->bgcolor ?? '#e2e8f0',
                'class' => 'qtype_graph-bgcolorpicker',
                'aria-label' => get_string('bgcolor', 'qtype_graph'),
            ])),
        ];
        $mform->addGroup($bgcolorgroup, 'bgcolorgroup', get_string('bgcolor', 'qtype_graph'), ' ', false);
        $mform->setType('bgcolor', PARAM_TEXT);
        $mform->setDefault('bgcolor', '#e2e8f0');
        $mform->addHelpButton('bgcolorgroup', 'bgcolor', 'qtype_graph');

        // Same text-field-plus-swatch pattern as bgcolor above, for the grid line color.
        $gridcolorgroup = [
            $mform->createElement('text', 'gridcolor', '', ['id' => 'id_gridcolor', 'size' => 10]),
            $mform->createElement('html', html_writer::empty_tag('input', [
                'type' => 'color',
                'id' => 'id_gridcolor_picker',
                'value' => $this->question->options->gridcolor ?? '#cbd5e1',
                'class' => 'qtype_graph-bgcolorpicker',
                'aria-label' => get_string('gridcolor', 'qtype_graph'),
            ])),
        ];
        $mform->addGroup($gridcolorgroup, 'gridcolorgroup', get_string('gridcolor', 'qtype_graph'), ' ', false);
        $mform->setType('gridcolor', PARAM_TEXT);
        $mform->setDefault('gridcolor', '#cbd5e1');
        $mform->addHelpButton('gridcolorgroup', 'gridcolor', 'qtype_graph');

        // Generated upfront (before either canvas is rendered) so the default graph's
        // initEditor call below can reference the result graph's container id as its
        // "Marcar como input" sync target, even though that second canvas is only
        // rendered later in this method.
        $containerid = 'qtype_graph_editor_' . html_writer::random_id('editor');
        $resultcontainerid = 'qtype_graph_editor_' . html_writer::random_id('editor');

        // One setting for every canvas this question has (see initCanvasSettings() above),
        // so the same values seed all three render() calls below (default, result, and
        // the alternate-answer template) - a brand new question falls back to the same
        // defaults set on the showgrid/bgcolor/gridcolor form fields above.
        $canvasstyleattrs = [
            'showgrid' => (!empty($this->question->options) ? (int) $this->question->options->showgrid : 1) ? '1' : '0',
            'bgcolor' => !empty($this->question->options) ? $this->question->options->bgcolor : '#e2e8f0',
            'gridcolor' => !empty($this->question->options) ? $this->question->options->gridcolor : '#cbd5e1',
        ];

        $mform->addElement('html', \qtype_graph\editor_ui::render($containerid, $canvasstyleattrs));

        $mform->addElement('hidden', 'graphjson', null, ['id' => 'id_graphjson']);
        $mform->setType('graphjson', PARAM_RAW);

        $PAGE->requires->js_call_amd('qtype_graph/editor', 'initEditor',
                [$containerid, 'id_graphjson', null, null, $resultcontainerid]);

        $PAGE->requires->js_call_amd('qtype_graph/editor', 'initCanvasSettings',
                ['id_showgrid', 'id_bgcolor', 'id_bgcolor_picker', 'id_gridcolor', 'id_gridcolor_picker']);

        $mform->addElement('header', 'resultgraphheader', get_string('resultgraphjson', 'qtype_graph'));
        $mform->setExpanded('resultgraphheader');
        $mform->addElement('static', 'resultgraphjsonhelp', '', get_string('resultgraphjson_help', 'qtype_graph'));

        $resetbuttonid = 'qtype_graph_reset_' . html_writer::random_id('reset');
        $mform->addElement('html', html_writer::tag('button', get_string('resetresultgraph', 'qtype_graph'), [
            'type' => 'button',
            'id' => $resetbuttonid,
            'class' => 'btn btn-outline-danger mb-2',
            'data-confirm' => get_string('resetresultgraph_confirm', 'qtype_graph'),
        ]));
        $validatebuttonid = 'qtype_graph_validate_' . html_writer::random_id('validate');
        $mform->addElement('html', html_writer::tag('button', get_string('validategraphs', 'qtype_graph'), [
            'type' => 'button',
            'id' => $validatebuttonid,
            'class' => 'btn btn-outline-secondary mb-2 ml-2',
        ]));
        $validateoutputid = 'qtype_graph_validateoutput_' . html_writer::random_id('validateoutput');
        $mform->addElement('html', html_writer::div('', 'qtype_graph-validation-output', ['id' => $validateoutputid]));

        $mform->addElement('html', \qtype_graph\editor_ui::render($resultcontainerid, $canvasstyleattrs));

        $mform->addElement('hidden', 'resultgraphjson', null, ['id' => 'id_resultgraphjson']);
        $mform->setType('resultgraphjson', PARAM_RAW);

        $PAGE->requires->js_call_amd('qtype_graph/editor', 'initEditor',
                [$resultcontainerid, 'id_resultgraphjson', $resetbuttonid, 'id_graphjson']);

        $PAGE->requires->js_call_amd('qtype_graph/editor', 'initValidation',
                [$validatebuttonid, $validateoutputid, 'id_graphjson', 'id_resultgraphjson', 'id_allowaddnodes']);

        $mform->addElement('header', 'altanswersheader', get_string('altanswersheader', 'qtype_graph'));
        $mform->setExpanded('altanswersheader', false);
        $mform->addElement('static', 'altanswershelp', '', get_string('altanswershelp', 'qtype_graph'));

        // Inert skeleton initAltAnswers() clones for every alternate it adds, so the editor
        // markup (editor_ui::render()) only needs to be authored in one place - the container
        // id baked into it here is irrelevant, since the JS overwrites it on every clone.
        $alttemplateid = 'qtype_graph_alttemplate_' . html_writer::random_id('tpl');
        $mform->addElement('html',
                '<template id="' . $alttemplateid . '">' .
                \qtype_graph\editor_ui::render('qtype_graph_alt_tpl', $canvasstyleattrs) .
                '</template>');

        $altlistid = 'qtype_graph_altlist_' . html_writer::random_id('list');
        $mform->addElement('html', html_writer::div('', 'qtype_graph-altlist', ['id' => $altlistid]));

        $mform->addElement('hidden', 'altresultgraphsjson', null, ['id' => 'id_altresultgraphsjson']);
        $mform->setType('altresultgraphsjson', PARAM_RAW);

        $addaltbuttonid = 'qtype_graph_addalt_' . html_writer::random_id('addalt');
        $mform->addElement('html', html_writer::tag('button', get_string('addaltanswer', 'qtype_graph'), [
            'type' => 'button',
            'id' => $addaltbuttonid,
            'class' => 'btn btn-outline-secondary mb-2',
        ]));

        $PAGE->requires->js_call_amd('qtype_graph/editor', 'initAltAnswers',
                [$addaltbuttonid, $altlistid, $alttemplateid, 'id_altresultgraphsjson', $containerid,
                        'id_graphjson']);

        // Correct/partially correct/incorrect feedback, shown via
        // qtype_with_combined_feedback_renderer::combined_feedback() (renderer.php).
        // "true" = also offer "show number of correct responses once finished",
        // which reads get_num_parts_right() the same way the interactive-behaviour
        // hints below do. Like those, only has any effect once an answer graph is
        // authored - see get_num_parts_right()'s early return in question.php.
        $this->add_combined_feedback_fields(true);

        // Penalty + hints, which is what gives the student more than one try at
        // the Check button under the interactive behaviour. Both options are on:
        // the question class implements clear_wrong_from_response() and
        // get_num_parts_right(). Only has any effect once an answer graph is
        // authored, since without one the question stays manually graded.
        $this->add_interactive_settings(true, true);
    }

    protected function data_preprocessing($question) {
        $question = parent::data_preprocessing($question);

        if (!empty($question->options)) {
            $question->graphjson = $question->options->graphjson;
            $question->resultgraphjson = $question->options->resultgraphjson ?? '';
            $question->allowaddnodes = $question->options->allowaddnodes;
            $question->allowdeletenodes = $question->options->allowdeletenodes;
            $question->newnodecontenttype = $question->options->newnodecontenttype ?? 'input';
            $question->newnodecontentvalue = $question->options->newnodecontentvalue ?? '';
            $question->newedgecontenttype = $question->options->newedgecontenttype ?? 'input';
            $question->newedgecontentvalue = $question->options->newedgecontentvalue ?? '';
            $question->showgrid = $question->options->showgrid ?? 1;
            $question->bgcolor = $question->options->bgcolor ?? '#e2e8f0';
            $question->gridcolor = $question->options->gridcolor ?? '#1b1f27';
            $question->shownodetrail = $question->options->shownodetrail ?? 0;
            $question->altresultgraphsjson = json_encode(array_map(
                    function($altanswer) {
                        return json_decode($altanswer->graphjson, true) ?: new stdClass();
                    },
                    array_values($question->options->altanswers ?? [])));
        }
        $question = $this->data_preprocessing_combined_feedback($question, true);
        $question = $this->data_preprocessing_hints($question, true, true);

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
