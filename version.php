<?php
// This file is part of qtype_graph, a question type plugin for Moodle - http://moodle.org/
//
// Released under the MIT License. See the LICENSE file at the root of this plugin.

/**
 * Version information for the graph question type.
 *
 * @package    qtype_graph
 * @copyright  2026 CMMEdu
 * @license    https://opensource.org/licenses/MIT MIT
 */

defined('MOODLE_INTERNAL') || die();

$plugin->component = 'qtype_graph';
$plugin->version   = 2026092504;

$plugin->requires  = 2025041400; // Moodle 5.0 and any later version.

$plugin->maturity  = MATURITY_ALPHA;
$plugin->release   = '0.1 (basic)';
