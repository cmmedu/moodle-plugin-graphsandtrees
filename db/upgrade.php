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

    return true;
}
