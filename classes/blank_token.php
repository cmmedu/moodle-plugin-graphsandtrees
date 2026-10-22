<?php
// This file is part of qtype_graph, a question type plugin for Moodle - http://moodle.org/
//
// Released under the MIT License. See the LICENSE file at the root of this plugin.

namespace qtype_graph;

/**
 * Strips accepted-answer lists out of {{T_INPUT;"..";".."}} fill-in-the-blank
 * tokens before a teacher-authored graph is sent to a student's browser.
 *
 * @package    qtype_graph
 * @copyright  2026 CMMEdu
 * @license    https://opensource.org/licenses/MIT MIT
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
            // A leaf node's floating label (see CLAUDE.md, "Floating labels on leaf
            // nodes") uses the exact same blank grammar as its own text, so it can just
            // as easily carry a legacy embedded-answer token that must never reach the
            // student's browser either.
            if (isset($node['floatingLabel']) && is_string($node['floatingLabel'])) {
                $node['floatingLabel'] = preg_replace(self::TOKEN_PATTERN, self::SANITIZED_MARKER, $node['floatingLabel']);
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
