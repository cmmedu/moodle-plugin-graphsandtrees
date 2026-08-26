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

namespace qtype_graph;

/**
 * Strips accepted-answer lists out of {{T_INPUT;"..";".."}} fill-in-the-blank
 * tokens before a teacher-authored graph is sent to a student's browser.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class blank_token {
    /** @var string regex matching a full authoring-time token, 0+ semicolon-quoted answers. */
    const TOKEN_PATTERN = '/\{\{T_INPUT(?:\s*;\s*"[^"]*")*\}\}/';

    /** @var string the bare marker a token is replaced with - still parseable client-side
     *  as "there is a blank here", but with no answer content. */
    const SANITIZED_MARKER = '{{T_INPUT}}';

    /**
     * Replace every {{T_INPUT;"a";"b"}} token found in a teacher-authored
     * graphjson blob with the bare {{T_INPUT}} marker, so the accepted
     * answers never reach the student's browser. Used only for the
     * student-facing attempt page - never for the teacher's own authoring view.
     *
     * @param string $graphjson raw graphjson as stored in the DB.
     * @return string sanitized graphjson, safe to embed in the attempt page.
     */
    public static function strip_answers(string $graphjson): string {
        $data = json_decode($graphjson, true);
        if (!is_array($data)) {
            // Malformed JSON - fall back to a best-effort raw string replace
            // so answers are never leaked even if decoding fails.
            return preg_replace(self::TOKEN_PATTERN, self::SANITIZED_MARKER, $graphjson);
        }

        // Reference into local intermediate variables, not the ?? expression
        // result directly - a foreach-by-reference over a null-coalesced
        // temporary never writes back into $data.
        $nodes = $data['nodes'] ?? [];
        foreach ($nodes as &$node) {
            if (isset($node['text']) && is_string($node['text'])) {
                $node['text'] = preg_replace(self::TOKEN_PATTERN, self::SANITIZED_MARKER, $node['text']);
            }
        }
        unset($node);
        $data['nodes'] = $nodes;

        $edges = $data['edges'] ?? [];
        foreach ($edges as &$edge) {
            if (isset($edge['label']) && is_string($edge['label'])) {
                $edge['label'] = preg_replace(self::TOKEN_PATTERN, self::SANITIZED_MARKER, $edge['label']);
            }
        }
        unset($edge);
        $data['edges'] = $edges;

        return json_encode($data);
    }
}
