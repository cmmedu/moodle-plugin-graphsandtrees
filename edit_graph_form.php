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

        $mform->addElement('advcheckbox', 'strictinputchecks', get_string('strictinputchecks', 'qtype_graph'));
        $mform->setDefault('strictinputchecks', 1);
        $mform->addHelpButton('strictinputchecks', 'strictinputchecks', 'qtype_graph');

        $mform->addElement('advcheckbox', 'shownodetrail', get_string('shownodetrail', 'qtype_graph'));
        $mform->setDefault('shownodetrail', 1);
        $mform->addHelpButton('shownodetrail', 'shownodetrail', 'qtype_graph');

        $mform->addElement('advcheckbox', 'allowdownloadimage', get_string('allowdownloadimage', 'qtype_graph'));
        $mform->setDefault('allowdownloadimage', 0);
        $mform->addHelpButton('allowdownloadimage', 'allowdownloadimage', 'qtype_graph');

        $mform->addElement('advcheckbox', 'allowchangeorientation', get_string('allowchangeorientation', 'qtype_graph'));
        $mform->setDefault('allowchangeorientation', 0);
        $mform->addHelpButton('allowchangeorientation', 'allowchangeorientation', 'qtype_graph');

        $mform->addElement('advcheckbox', 'allowchangelinestyle', get_string('allowchangelinestyle', 'qtype_graph'));
        $mform->setDefault('allowchangelinestyle', 0);
        $mform->addHelpButton('allowchangelinestyle', 'allowchangelinestyle', 'qtype_graph');

        $mform->addElement('advcheckbox', 'allowchangegraphtype', get_string('allowchangegraphtype', 'qtype_graph'));
        $mform->setDefault('allowchangegraphtype', 0);
        $mform->addHelpButton('allowchangegraphtype', 'allowchangegraphtype', 'qtype_graph');

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

        $mform->addElement('advcheckbox', 'showlevellabels', get_string('showlevellabels', 'qtype_graph'),
                null, ['id' => 'id_showlevellabels']);
        $mform->setDefault('showlevellabels', 1);
        $mform->addHelpButton('showlevellabels', 'showlevellabels', 'qtype_graph');

        // No longer visible fields on this form - "Mostrar cuadrícula"/"Color de
        // fondo"/"Color de cuadrícula" are now edited from the canvas's own gear
        // panel (classes/editor_ui.php's canvas-settings-panel, wired in
        // createGraphEditor() in amd/src/editor.js), the same way graphjson itself
        // is only ever edited via the canvas, never a form field. Kept as hidden
        // fields (rather than dropped outright) so they're still what actually
        // gets submitted and saved - the canvas panel writes into them by id on
        // every change (see canvasSettingsFieldIds passed to initEditor() below).
        // The default values here only ever matter if that JS somehow fails to
        // load, since $canvasstyleattrs below (which the canvas panel's initial
        // state is itself seeded from) already resolves the real current value -
        // still, kept matching db/install.xml's own column defaults, not left
        // empty, as a sane fallback.
        $mform->addElement('hidden', 'showgrid', 1, ['id' => 'id_showgrid']);
        $mform->setType('showgrid', PARAM_INT);
        $mform->addElement('hidden', 'bgcolor', '#f8f9fa', ['id' => 'id_bgcolor']);
        $mform->setType('bgcolor', PARAM_TEXT);
        $mform->addElement('hidden', 'gridcolor', '#e2e8f0', ['id' => 'id_gridcolor']);
        $mform->setType('gridcolor', PARAM_TEXT);

        // No longer a visible question-level field - node/edge/floating-label text
        // color is now set per-item, in that item's own menu on the canvas (see
        // node-textcolor-section/edge-textcolor-section/floatinglabel-textcolor-section
        // in classes/editor_ui.php and applyNodeTextColor()/applyEdgeTextColor()/
        // applyFloatingLabelTextColor() in amd/src/editor.js). Kept as a hidden field
        // (rather than dropped outright) purely so an EXISTING question's already-saved
        // value keeps round-tripping through save_question_options() unchanged - see
        // --qtype-graph-canvas-text in styles.css - instead of being silently wiped to
        // '' the next time this form is saved; a brand new question just gets ''
        // (the plugin's hardcoded default) here, same as before.
        $mform->addElement('hidden', 'textcolor');
        $mform->setType('textcolor', PARAM_TEXT);

        // Generated upfront (before either canvas is rendered) so the default graph's
        // initEditor call below can reference the result graph's container id as its
        // "Marcar como input" sync target, even though that second canvas is only
        // rendered later in this method.
        $containerid = 'qtype_graph_editor_' . html_writer::random_id('editor');
        $resultcontainerid = 'qtype_graph_editor_' . html_writer::random_id('editor');

        // One setting for every canvas this question has (see the canvas gear
        // panel/canvasSettingsFieldIds below, and initCanvasSettings() above for
        // the settings still on this form), so the same values seed all three
        // render() calls below (default, result, and the alternate-answer
        // template) - a brand new question falls back to the same defaults as
        // the showgrid/bgcolor/gridcolor hidden fields above (matching
        // db/install.xml's own column defaults).
        $canvasstyleattrs = [
            'showgrid' => (!empty($this->question->options) ? (int) $this->question->options->showgrid : 1) ? '1' : '0',
            'bgcolor' => !empty($this->question->options) ? $this->question->options->bgcolor : '#f8f9fa',
            'gridcolor' => !empty($this->question->options) ? $this->question->options->gridcolor : '#e2e8f0',
            'textcolor' => !empty($this->question->options) ? ($this->question->options->textcolor ?? '') : '',
            'showlevellabels' =>
                    (!empty($this->question->options) ? (int) $this->question->options->showlevellabels : 1) ? '1' : '0',
            // A brand new question (no saved options yet) defaults depth 0's label to
            // hidden, since the root label is redundant for most of this
            // organization's trees and turning it off was the single most common
            // first edit anyway (click it on the canvas to turn it back on - see
            // levellabel-menu in classes/editor_ui.php). An existing question keeps
            // whatever it already has saved, untouched by this default.
            'levellabelsjson' => !empty($this->question->options) ? ($this->question->options->levellabelsjson ?? '')
                    : json_encode([['show' => false]]),
            // A brand new question defaults to 24px (bigger than the 16px legacy/
            // pre-field baseline below) - the organization's usual starting size.
            // An existing question keeps whatever it already has saved.
            'levellabelsize' => !empty($this->question->options) ? ($this->question->options->levellabelsize ?? 16) : 24,
        ];

        $mform->addElement('html', \qtype_graph\editor_ui::render($containerid, $canvasstyleattrs));

        $mform->addElement('hidden', 'graphjson', null, ['id' => 'id_graphjson']);
        $mform->setType('graphjson', PARAM_RAW);

        $PAGE->requires->js_call_amd('qtype_graph/editor', 'initEditor',
                [$containerid, 'id_graphjson', null, null, $resultcontainerid,
                        ['showGrid' => 'id_showgrid', 'bgColor' => 'id_bgcolor', 'gridColor' => 'id_gridcolor',
                                'levelLabelSize' => 'id_levellabelsize', 'levelLabelOverrides' => 'id_levellabelsjson']]);

        $PAGE->requires->js_call_amd('qtype_graph/editor', 'initCanvasSettings',
                ['id_showlevellabels', null, null]);

        // No longer a visible field - global font size for every level label's
        // title (applying uniformly to all depths - see --qtype-graph-levellabel-size
        // in styles.css) is now edited from the canvas's own gear panel
        // (classes/editor_ui.php's canvas-settings-panel, wired in
        // createGraphEditor() in amd/src/editor.js), same as
        // showgrid/bgcolor/gridcolor - the canvas panel writes into this hidden
        // field by id on every change (see canvasSettingsFieldIds passed to
        // initEditor() below).
        $mform->addElement('hidden', 'levellabelsize', 24, ['id' => 'id_levellabelsize']);
        $mform->setType('levellabelsize', PARAM_INT);

        // No longer a visible section on this form - per-depth level-label
        // overrides (show/title/subtitle) are now edited by clicking the label
        // directly on the canvas (classes/editor_ui.php's levellabel-menu,
        // wired in createGraphEditor() in amd/src/editor.js), the same way
        // graphjson itself is only ever edited via the canvas - the canvas
        // click-menu writes into this hidden field by id on every change (see
        // canvasSettingsFieldIds passed to initEditor() below). Per-depth color
        // is no longer supported - --qtype-graph-muted (styles.css) applies
        // uniformly to every level label now.
        $mform->addElement('hidden', 'levellabelsjson', '', ['id' => 'id_levellabelsjson']);
        $mform->setType('levellabelsjson', PARAM_RAW);

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
            $question->strictinputchecks = $question->options->strictinputchecks ?? 1;
            $question->newnodecontenttype = $question->options->newnodecontenttype ?? 'input';
            $question->newnodecontentvalue = $question->options->newnodecontentvalue ?? '';
            $question->newedgecontenttype = $question->options->newedgecontenttype ?? 'input';
            $question->newedgecontentvalue = $question->options->newedgecontentvalue ?? '';
            $question->showgrid = $question->options->showgrid ?? 1;
            $question->bgcolor = $question->options->bgcolor ?? '#f8f9fa';
            $question->gridcolor = $question->options->gridcolor ?? '#e2e8f0';
            $question->textcolor = $question->options->textcolor ?? '';
            $question->shownodetrail = $question->options->shownodetrail ?? 1;
            $question->allowdownloadimage = $question->options->allowdownloadimage ?? 0;
            $question->allowchangeorientation = $question->options->allowchangeorientation ?? 0;
            $question->allowchangelinestyle = $question->options->allowchangelinestyle ?? 0;
            $question->allowchangegraphtype = $question->options->allowchangegraphtype ?? 0;
            $question->showlevellabels = $question->options->showlevellabels ?? 1;
            $question->levellabelsjson = $question->options->levellabelsjson ?? '';
            $question->levellabelsize = $question->options->levellabelsize ?? 16;
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
