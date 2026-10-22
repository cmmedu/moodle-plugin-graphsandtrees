<?php
// This file is part of qtype_graph, a question type plugin for Moodle - http://moodle.org/
//
// Released under the MIT License. See the LICENSE file at the root of this plugin.

/**
 * Privacy Subsystem implementation for qtype_graph.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    https://opensource.org/licenses/MIT MIT
 */

namespace qtype_graph\privacy;

/**
 * Privacy Subsystem for qtype_graph implementing null_provider.
 *
 * qtype_graph_options only stores the teacher-authored graph (not personal
 * data). Student responses (the nodes/edges they add) live only in the
 * standard question_attempt_step data, which is already covered by
 * core_question's own privacy provider.
 *
 * @copyright  2026 Rutas Digitales
 * @license    https://opensource.org/licenses/MIT MIT
 */
class provider implements \core_privacy\local\metadata\null_provider {
    /**
     * Get the language string identifier with the component's language
     * file to explain why this plugin stores no data.
     *
     * @return string
     */
    public static function get_reason(): string {
        return 'privacy:metadata';
    }
}
