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
 * PHP-side counterpart of the parseAcceptedAnswers()/normalize() helpers in
 * amd/src/editor.js. Implements the result-graph answer-field grammar
 * documented in this plugin's CLAUDE.md ("Answer-field grammar"): empty,
 * {{T_ANY}}, {{T_ANY_N_EMPTY}}, {{"a";"b"}}, or plain text.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class answer_matcher {
    /** @var string matches the bare/authored {{T_INPUT...}} blank marker in a default-graph label. */
    const BLANK_TOKEN_PATTERN = '/\{\{T_INPUT\b/';

    /** @var string matches a [[option1,option2,...]] dropdown blank marker in a default-graph label -
     *  see amd/src/editor.js's "Marcar como selector". Unlike BLANK_TOKEN_PATTERN, this marker's
     *  content (the option list) is not secret and is never stripped by blank_token.php: it is the
     *  set of choices, not the accepted answer. The accepted answer(s) still live in the result graph,
     *  matched against the option TEXT the student picked, using the exact same grammar as a free-text
     *  {{T_INPUT}} blank (parse_accepted_answers()/matches() below) - a select blank changes only how
     *  the student answers (a <select> instead of a text box), never how the answer is graded. */
    const SELECT_TOKEN_PATTERN = '/\[\[[^\]]*\]\]/';

    /** @var string matches a whole result-graph field that is a {{"a";"b";...}} answer list. */
    const ANSWER_LIST_PATTERN = '/^\{\{\s*(?:"[^"]*"\s*;?\s*)+\}\}$/';

    /** @var string extracts each quoted answer out of an ANSWER_LIST_PATTERN match. */
    const ANSWER_QUOTED_PATTERN = '/"([^"]*)"/';

    /** @var string result-graph field meaning "any non-empty student input is accepted". */
    const ANY_MARKER = '{{T_ANY}}';

    /** @var string result-graph field meaning "any student input, including empty, is accepted". */
    const ANY_OR_EMPTY_MARKER = '{{T_ANY_N_EMPTY}}';

    /**
     * Does a default-graph node/edge label contain a fill-in-the-blank marker -
     * either a free-text {{T_INPUT}} blank or a [[option1,option2,...]] dropdown blank?
     *
     * @param mixed $text
     * @return bool
     */
    public static function has_blank($text): bool {
        if (!is_string($text)) {
            return false;
        }
        return preg_match(self::BLANK_TOKEN_PATTERN, $text) === 1
                || preg_match(self::SELECT_TOKEN_PATTERN, $text) === 1;
    }

    /**
     * Parse a result-graph node/edge's text into the answer-field grammar.
     *
     * @param mixed $text raw result-graph field text.
     * @return array {type: 'unset'|'any'|'any_or_empty'|'exact', answers: string[]}
     */
    public static function parse_accepted_answers($text): array {
        $trimmed = is_string($text) ? trim($text) : '';
        if ($trimmed === '') {
            return ['type' => 'unset', 'answers' => []];
        }
        if ($trimmed === self::ANY_MARKER) {
            return ['type' => 'any', 'answers' => []];
        }
        if ($trimmed === self::ANY_OR_EMPTY_MARKER) {
            return ['type' => 'any_or_empty', 'answers' => []];
        }
        if (preg_match(self::ANSWER_LIST_PATTERN, $trimmed)) {
            preg_match_all(self::ANSWER_QUOTED_PATTERN, $trimmed, $matches);
            return ['type' => 'exact', 'answers' => $matches[1]];
        }
        return ['type' => 'exact', 'answers' => [$trimmed]];
    }

    /**
     * Normalize a value for answer comparison: trim whitespace, lowercase.
     *
     * @param mixed $value
     * @return string
     */
    public static function normalize($value): string {
        return is_string($value) ? mb_strtolower(trim($value)) : '';
    }

    /**
     * Does a student's typed value satisfy a result-graph answer field?
     *
     * @param mixed $studentvalue what the student typed into the blank.
     * @param mixed $acceptedfieldtext the result-graph node/edge's text for the matching id.
     * @return bool
     */
    public static function matches($studentvalue, $acceptedfieldtext): bool {
        $spec = self::parse_accepted_answers($acceptedfieldtext);
        $normalizedstudent = self::normalize($studentvalue);
        switch ($spec['type']) {
            case 'any_or_empty':
                return true;
            case 'any':
                return $normalizedstudent !== '';
            case 'exact':
                foreach ($spec['answers'] as $answer) {
                    if (self::normalize($answer) === $normalizedstudent) {
                        return true;
                    }
                }
                return false;
            case 'unset':
            default:
                return false;
        }
    }
}
