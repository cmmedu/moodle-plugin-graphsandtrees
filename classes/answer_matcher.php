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
 * {{T_ANY}}, {{T_ANY_N_EMPTY}}, {{a;b}} (items optionally quoted, {{"a";"b"}}),
 * or plain text.
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

    /** @var string matches the FULL span of the (only graded, see grading.php's docblock)
     *  index-0 blank marker in a default-graph label - either form of blank, free-text or
     *  select. Unlike BLANK_TOKEN_PATTERN/SELECT_TOKEN_PATTERN above (existence checks),
     *  this one is used positionally by strip_default_context() below to find where the
     *  blank sits amid any decorative prefix/suffix text the label may also carry (e.g.
     *  "antes [[Opción 1;Opción 2]] despues"). */
    const BLANK_SPAN_PATTERN = '/\{\{T_INPUT\b[^}]*\}\}|\[\[[^\]]*\]\]/';

    /** @var string matches a whole result-graph field that is a {{...}} multi-answer list -
     *  either the original quoted-items form {{"a";"b"}} or the plainer unquoted form
     *  {{a;b}} (same semicolon convention as a [[a;b]] select-options list, so a node with
     *  several acceptable answers - free-text or select alike - can be authored the same
     *  way as its options were). Items may freely mix quoted and unquoted; see
     *  split_answer_list() below for the actual per-item extraction. */
    const ANSWER_LIST_PATTERN = '/^\{\{(.*)\}\}$/s';

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
     * Strip the decorative prefix/suffix text surrounding a default-graph blank marker
     * off the matching result-graph field, before it is parsed as an accepted-answer
     * expression - e.g. a default-graph label "antes [[Opción 1;Opción 2]] despues"
     * paired with a result-graph field "antes Opción 1 despues" should be parsed as
     * just "Opción 1", not the whole string, since the student's typed/picked value for
     * the blank itself never includes that surrounding text either (see
     * renderLabelSegments() in amd/src/editor.js, which renders the prefix/suffix as
     * plain text around the fillable input/select, and only the input/select's own
     * value ever reaches the response's `blanks` map).
     *
     * Only strips a side that is actually present verbatim at that end of the result
     * field - a teacher who typed just the bare answer (the original, pre-embedding
     * convention, with no prefix/suffix at all) is left untouched, since there is
     * nothing to strip. Only the index-0 blank is considered, matching grading.php's
     * existing "only blank index 0 is graded" limitation.
     *
     * @param mixed $defaulttext the default-graph node/edge's raw text.
     * @param mixed $resulttext the matching result-graph node/edge's raw text.
     * @return string $resulttext with the default label's prefix/suffix stripped off,
     *      wherever present - unchanged if the default label has no blank, or the
     *      result text doesn't carry that prefix/suffix.
     */
    public static function strip_default_context($defaulttext, $resulttext): string {
        if (!is_string($defaulttext) || !is_string($resulttext)) {
            return is_string($resulttext) ? $resulttext : '';
        }
        if (preg_match(self::BLANK_SPAN_PATTERN, $defaulttext, $match, PREG_OFFSET_CAPTURE) !== 1) {
            return $resulttext;
        }
        $prefix = substr($defaulttext, 0, $match[0][1]);
        $suffix = substr($defaulttext, $match[0][1] + strlen($match[0][0]));
        $stripped = $resulttext;
        if ($prefix !== '' && str_starts_with($stripped, $prefix)) {
            $stripped = substr($stripped, strlen($prefix));
        }
        if ($suffix !== '' && str_ends_with($stripped, $suffix)) {
            $stripped = substr($stripped, 0, strlen($stripped) - strlen($suffix));
        }
        return $stripped;
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
        if (preg_match(self::ANSWER_LIST_PATTERN, $trimmed, $match)) {
            return ['type' => 'exact', 'answers' => self::split_answer_list($match[1])];
        }
        return ['type' => 'exact', 'answers' => [$trimmed]];
    }

    /**
     * Split a {{...}}-wrapped answer list's inner content into individual accepted
     * answers, on ';' - each item may optionally be wrapped in double quotes (stripped
     * here), for backward compatibility with the original {{"a";"b"}} authoring
     * convention; an item can just as well be left bare, e.g. {{a;b}}. A blank item
     * (stray/trailing semicolon, or "") is dropped rather than treated as "empty answer
     * accepted" - {{T_ANY_N_EMPTY}} already exists for that, so this never needs to
     * guess whether a blank was intentional.
     *
     * @param string $inner the content between the outer {{ and }}.
     * @return string[]
     */
    private static function split_answer_list(string $inner): array {
        $items = [];
        foreach (explode(';', $inner) as $item) {
            $item = trim($item);
            if (strlen($item) >= 2 && $item[0] === '"' && substr($item, -1) === '"') {
                $item = substr($item, 1, -1);
            }
            if ($item !== '') {
                $items[] = $item;
            }
        }
        return $items;
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
