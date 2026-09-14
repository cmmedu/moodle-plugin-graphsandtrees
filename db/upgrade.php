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
 * Graph question type upgrade code.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/**
 * Method to perform upgrade steps between versions.
 *
 * @param int $oldversion
 * @return bool
 */
function xmldb_qtype_graph_upgrade(int $oldversion): bool {
    global $DB;

    $dbman = $DB->get_manager();

    if ($oldversion < 2026082400) {
        $table = new xmldb_table('qtype_graph_options');

        $field = new xmldb_field('allowaddnodes', XMLDB_TYPE_INTEGER, '1', null,
                XMLDB_NOTNULL, null, '1', 'graphjson');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        $field = new xmldb_field('allowdeletenodes', XMLDB_TYPE_INTEGER, '1', null,
                XMLDB_NOTNULL, null, '0', 'allowaddnodes');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        upgrade_plugin_savepoint(true, 2026082400, 'qtype', 'graph');
    }

    if ($oldversion < 2026082700) {
        $table = new xmldb_table('qtype_graph_options');

        $field = new xmldb_field('resultgraphjson', XMLDB_TYPE_TEXT, null, null,
                null, null, null, 'graphjson');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        upgrade_plugin_savepoint(true, 2026082700, 'qtype', 'graph');
    }

    if ($oldversion < 2026090102) {
        $table = new xmldb_table('qtype_graph_options');

        // The three feedback fields are TEXT columns, which Postgres/MySQL cannot
        // give a DEFAULT - add_field() would refuse to add them NOT NULL on a
        // table that already has rows. Add nullable, backfill every existing row
        // below, then tighten to NOT NULL with change_field_notnull().
        $correctfeedback = new xmldb_field('correctfeedback', XMLDB_TYPE_TEXT, null, null,
                null, null, null, 'allowdeletenodes');
        if (!$dbman->field_exists($table, $correctfeedback)) {
            $dbman->add_field($table, $correctfeedback);
        }

        $field = new xmldb_field('correctfeedbackformat', XMLDB_TYPE_INTEGER, '2', null,
                XMLDB_NOTNULL, null, '0', 'correctfeedback');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        $partiallycorrectfeedback = new xmldb_field('partiallycorrectfeedback', XMLDB_TYPE_TEXT, null, null,
                null, null, null, 'correctfeedbackformat');
        if (!$dbman->field_exists($table, $partiallycorrectfeedback)) {
            $dbman->add_field($table, $partiallycorrectfeedback);
        }

        $field = new xmldb_field('partiallycorrectfeedbackformat', XMLDB_TYPE_INTEGER, '2', null,
                XMLDB_NOTNULL, null, '0', 'partiallycorrectfeedback');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        $incorrectfeedback = new xmldb_field('incorrectfeedback', XMLDB_TYPE_TEXT, null, null,
                null, null, null, 'partiallycorrectfeedbackformat');
        if (!$dbman->field_exists($table, $incorrectfeedback)) {
            $dbman->add_field($table, $incorrectfeedback);
        }

        $field = new xmldb_field('incorrectfeedbackformat', XMLDB_TYPE_INTEGER, '2', null,
                XMLDB_NOTNULL, null, '0', 'incorrectfeedback');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        $field = new xmldb_field('shownumcorrect', XMLDB_TYPE_INTEGER, '2', null,
                XMLDB_NOTNULL, null, '0', 'incorrectfeedbackformat');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        // Existing questions predate this feature: give them the same feedback
        // defaults a brand-new question gets (see edit_question_form.php's
        // add_combined_feedback_fields(), whose editor defaults come from these
        // same core 'question' strings), rather than leaving them empty.
        $DB->execute("UPDATE {qtype_graph_options}
                         SET correctfeedback = ?, correctfeedbackformat = ?,
                             partiallycorrectfeedback = ?, partiallycorrectfeedbackformat = ?,
                             incorrectfeedback = ?, incorrectfeedbackformat = ?
                       WHERE correctfeedback IS NULL", [
            get_string('correctfeedbackdefault', 'question'), FORMAT_HTML,
            get_string('partiallycorrectfeedbackdefault', 'question'), FORMAT_HTML,
            get_string('incorrectfeedbackdefault', 'question'), FORMAT_HTML,
        ]);

        // Now that every row has a value, the columns can be tightened to NOT NULL
        // to match install.xml (what a fresh install gets straight away).
        $correctfeedback->setNotNull(true);
        $dbman->change_field_notnull($table, $correctfeedback);
        $partiallycorrectfeedback->setNotNull(true);
        $dbman->change_field_notnull($table, $partiallycorrectfeedback);
        $incorrectfeedback->setNotNull(true);
        $dbman->change_field_notnull($table, $incorrectfeedback);

        upgrade_plugin_savepoint(true, 2026090102, 'qtype', 'graph');
    }

    if ($oldversion < 2026090400) {
        $table = new xmldb_table('qtype_graph_altanswers');

        if (!$dbman->table_exists($table)) {
            $table->add_field('id', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, XMLDB_SEQUENCE, null);
            $table->add_field('questionid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $table->add_field('graphjson', XMLDB_TYPE_TEXT, null, null, null, null, null);
            $table->add_field('sortorder', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');

            $table->add_key('primary', XMLDB_KEY_PRIMARY, ['id']);
            $table->add_key('questionid', XMLDB_KEY_FOREIGN, ['questionid'], 'question', ['id']);

            $dbman->create_table($table);
        }

        upgrade_plugin_savepoint(true, 2026090400, 'qtype', 'graph');
    }

    if ($oldversion < 2026090401) {
        $table = new xmldb_table('qtype_graph_options');

        $field = new xmldb_field('newnodecontenttype', XMLDB_TYPE_CHAR, '20', null,
                XMLDB_NOTNULL, null, 'input', 'allowdeletenodes');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        $field = new xmldb_field('newnodecontentvalue', XMLDB_TYPE_TEXT, null, null,
                null, null, null, 'newnodecontenttype');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        $field = new xmldb_field('newedgecontenttype', XMLDB_TYPE_CHAR, '20', null,
                XMLDB_NOTNULL, null, 'input', 'newnodecontentvalue');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        $field = new xmldb_field('newedgecontentvalue', XMLDB_TYPE_TEXT, null, null,
                null, null, null, 'newedgecontenttype');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        upgrade_plugin_savepoint(true, 2026090401, 'qtype', 'graph');
    }

    if ($oldversion < 2026090900) {
        $table = new xmldb_table('qtype_graph_options');

        $field = new xmldb_field('showgrid', XMLDB_TYPE_INTEGER, '1', null,
                XMLDB_NOTNULL, null, '1', 'shownumcorrect');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        $field = new xmldb_field('bgcolor', XMLDB_TYPE_CHAR, '20', null,
                XMLDB_NOTNULL, null, '#e2e8f0', 'showgrid');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        upgrade_plugin_savepoint(true, 2026090900, 'qtype', 'graph');
    }

    if ($oldversion < 2026091000) {
        $table = new xmldb_table('qtype_graph_options');

        $field = new xmldb_field('gridcolor', XMLDB_TYPE_CHAR, '20', null,
                XMLDB_NOTNULL, null, '#1b1f27', 'bgcolor');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        upgrade_plugin_savepoint(true, 2026091000, 'qtype', 'graph');
    }

    if ($oldversion < 2026091001) {
        $table = new xmldb_table('qtype_graph_options');

        $field = new xmldb_field('shownodetrail', XMLDB_TYPE_INTEGER, '1', null,
                XMLDB_NOTNULL, null, '0', 'gridcolor');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        upgrade_plugin_savepoint(true, 2026091001, 'qtype', 'graph');
    }

    if ($oldversion < 2026091002) {
        $table = new xmldb_table('qtype_graph_options');

        // shownodetrail was added above defaulting to 0 (off) - now defaulting to 1
        // (on) instead, alongside showlevellabels below, per the same "on by default"
        // request. Only changes the column default for future rows; existing
        // questions keep whatever value they already have.
        $field = new xmldb_field('shownodetrail', XMLDB_TYPE_INTEGER, '1', null,
                XMLDB_NOTNULL, null, '1', 'gridcolor');
        if ($dbman->field_exists($table, $field)) {
            $dbman->change_field_default($table, $field);
        }

        $field = new xmldb_field('showlevellabels', XMLDB_TYPE_INTEGER, '1', null,
                XMLDB_NOTNULL, null, '1', 'shownodetrail');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        upgrade_plugin_savepoint(true, 2026091002, 'qtype', 'graph');
    }

    if ($oldversion < 2026091003) {
        $table = new xmldb_table('qtype_graph_options');

        $field = new xmldb_field('levellabelsjson', XMLDB_TYPE_TEXT, null, null,
                null, null, null, 'showlevellabels');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        upgrade_plugin_savepoint(true, 2026091003, 'qtype', 'graph');
    }

    if ($oldversion < 2026091005) {
        $table = new xmldb_table('qtype_graph_options');

        // Nullable with no default (not NOTNULL + '', which XMLDB rejects for a CHAR
        // column) - null/empty means "no override": node text and connection labels
        // each fall back to their own default color (see .qtype_graph-node/
        // .qtype_graph-edge-label in styles.css) until a teacher explicitly picks
        // one, so every existing question keeps rendering correctly with no
        // backfill needed.
        $field = new xmldb_field('textcolor', XMLDB_TYPE_CHAR, '20', null,
                null, null, null, 'gridcolor');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        upgrade_plugin_savepoint(true, 2026091005, 'qtype', 'graph');
    }

    return true;
}
