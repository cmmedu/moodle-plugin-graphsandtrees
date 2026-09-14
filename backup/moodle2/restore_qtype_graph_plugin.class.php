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
 * Restore information for the graph question type.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

/**
 * Restore plugin class providing the necessary information needed to restore
 * one graph qtype plugin - see backup_qtype_graph_plugin for the matching
 * backup side and the structure this reads.
 *
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class restore_qtype_graph_plugin extends restore_qtype_plugin {

    /**
     * Is the question currently being restored a brand new one (as opposed to
     * one restore matched to an already-existing question in the target
     * category)? qtype_graph_options.questionid is unique, so process_graph()
     * must never insert a second row for a question restore decided to reuse.
     *
     * @return bool
     */
    protected function is_question_created(): bool {
        return (bool) $this->get_mappingid('question_created', $this->get_old_parentid('question'));
    }

    /**
     * Returns the paths to be handled by the plugin at question level.
     *
     * @return array
     */
    protected function define_question_plugin_structure() {
        $paths = [];

        $paths[] = new restore_path_element('graph', $this->get_pathfor('/graph'));
        $paths[] = new restore_path_element('altanswer', $this->get_pathfor('/altanswers/altanswer'));

        return $paths;
    }

    /**
     * Process the qtype/graph element.
     *
     * @param array $data
     */
    public function process_graph($data): void {
        global $DB;
        $data = (object) $data;
        $oldid = $data->id;

        if (!$this->is_question_created()) {
            return;
        }

        $data->questionid = $this->get_new_parentid('question');
        // Backups made before these columns existed on qtype_graph_options won't
        // have them in the XML at all - fall back to the same defaults
        // save_question_options() uses for a freshly-authored question.
        $data->newnodecontenttype = $data->newnodecontenttype ?? 'input';
        $data->newedgecontenttype = $data->newedgecontenttype ?? 'input';
        $data->showgrid = $data->showgrid ?? 1;
        $data->bgcolor = $data->bgcolor ?? '#e2e8f0';
        $data->gridcolor = $data->gridcolor ?? '#1b1f27';
        $data->textcolor = $data->textcolor ?? '';

        $newitemid = $DB->insert_record('qtype_graph_options', $data);
        $this->set_mapping('qtype_graph_options', $oldid, $newitemid);
    }

    /**
     * Process one qtype/altanswers/altanswer element.
     *
     * @param array $data
     */
    public function process_altanswer($data): void {
        global $DB;
        $data = (object) $data;
        $oldid = $data->id;

        if (!$this->is_question_created()) {
            return;
        }

        $data->questionid = $this->get_new_parentid('question');
        $newitemid = $DB->insert_record('qtype_graph_altanswers', $data);
        $this->set_mapping('qtype_graph_altanswers', $oldid, $newitemid);
    }

    /**
     * Return the contents of this qtype to be processed by the links decoder,
     * matching the same fields core's multichoice plugin decodes (this plugin's
     * combined-feedback fields have the same shape/possible content as theirs).
     *
     * @return array
     */
    public static function define_decode_contents(): array {
        $fields = ['correctfeedback', 'partiallycorrectfeedback', 'incorrectfeedback'];
        return [new restore_decode_content('qtype_graph_options', $fields, 'qtype_graph_options')];
    }

    /**
     * Converts the backup structure of this question type into a structure
     * matching its question data, for the question-identity-hash comparison
     * used to detect and reuse an already-existing identical question. The
     * base implementation already handles the 'graph' element generically
     * (named to match the qtype, see backup_qtype_graph_plugin) - this only
     * needs to add the altanswers list, which the base class has no generic
     * handling for.
     *
     * @param array $backupdata Data from the backup.
     * @return stdClass The converted question data.
     */
    public static function convert_backup_to_questiondata(array $backupdata): stdClass {
        $questiondata = parent::convert_backup_to_questiondata($backupdata);

        $altanswers = $backupdata['plugin_qtype_graph_question']['altanswers']['altanswer'] ?? [];
        $questiondata->options->altanswers = array_map(fn($altanswer) => (object) $altanswer, $altanswers);

        return $questiondata;
    }

    /**
     * Also exclude the altanswers rows' own ids/questionid from the identity
     * hash comparison - they're per-restore/per-site values that will never
     * match between an old backup and a freshly-inserted row, same reason the
     * base class already excludes /options/id and /options/questionid.
     *
     * @return array
     */
    protected function define_excluded_identity_hash_fields(): array {
        return [
            '/options/altanswers/id',
            '/options/altanswers/questionid',
        ];
    }
}
