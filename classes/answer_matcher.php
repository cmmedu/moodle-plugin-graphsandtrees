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
 * {{N:...}} (numeric validation - see parse_numeric_answer()), or plain text.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class answer_matcher {
    /** @var string matches the bare/authored {{T_INPUT...}} blank marker in a default-graph label. */
    const BLANK_TOKEN_PATTERN = '/\{\{T_INPUT\b/';

    /** @var string a number as a student/teacher may type it: optional sign, '.' or ',' as the
     *  decimal separator, optional exponent. No thousands separators ("1.000" would be ambiguous). */
    const NUMBER_PATTERN = '/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/';

    /** @var string a simple fraction: optional sign, whole-number numerator and denominator,
     *  optional spaces around '/' (e.g. 1/2, -3/4, 7 / 8). Compared by value, so every
     *  equivalent fraction or decimal (2/4, 0,5) matches too. No decimals inside a fraction and
     *  no mixed numbers ("1 1/2") - both would be ambiguous. */
    const FRACTION_PATTERN = '/^([+-]?\d+)\s*\/\s*(\d+)$/';

    /** @var string matches a [[option1,option2,...]] dropdown blank marker in a default-graph label -
     *  see amd/src/editor.js's "Marcar como selector". Unlike BLANK_TOKEN_PATTERN, this marker's
     *  content (the option list) is not secret and is never stripped by blank_token.php: it is the
     *  set of choices, not the accepted answer. The accepted answer(s) still live in the result graph,
     *  matched against the option TEXT the student picked, using the exact same grammar as a free-text
     *  {{T_INPUT}} blank (parse_accepted_answers()/matches() below) - a select blank changes only how
     *  the student answers (a <select> instead of a text box), never how the answer is graded. */
    const SELECT_TOKEN_PATTERN = '/\[\[[^\]]*\]\]/';

    /** @var string one side of a {{F:numerator|denominator}} fraction (see FRACTION_TOKEN_PATTERN):
     *  a whole {{T_INPUT}} blank, a whole [[...]] select, or fixed text (no braces, brackets or '|'),
     *  with surrounding spaces ignored. Captures the part itself. */
    const FRACTION_PART = '\s*(\{\{T_INPUT\b[^}]*\}\}|\[\[[^\]]*\]\]|[^{}|\[\]]*?)\s*';

    /** @var string a {{F:numerator|denominator}} fraction shown stacked ("Marcar como fracción"), each
     *  side fixed text or a single blank - e.g. {{F:1|2}} (display only), {{F:{{T_INPUT}}|4}},
     *  {{F:{{T_INPUT}}|[[2;4;8]]}}. A fraction with at least one blank side is ONE gradable blank:
     *  its value is composed as "numerator/denominator" (compose_fraction_values()) and graded like
     *  any other blank, so the answer graph just writes the fraction as "a/b" (or {{N:a/b}}). */
    const FRACTION_TOKEN_PATTERN = '/\{\{F:' . self::FRACTION_PART . '\|' . self::FRACTION_PART . '\}\}/';

    /** @var string matches the FULL span of any candidate blank marker in a default-graph label - a
     *  fraction (listed first, so its inner markers are never matched on their own), a free-text
     *  blank, or a select. Used positionally by first_blank_span() below to find where the (only
     *  graded, see grading.php's docblock) index-0 blank sits amid any decorative prefix/suffix
     *  text the label may also carry (e.g. "antes [[Opción 1;Opción 2]] despues"). */
    const BLANK_SPAN_PATTERN = '/\{\{F:(?:\{\{T_INPUT\b[^}]*\}\}|\[\[[^\]]*\]\]|[^{}\[\]])*\}\}' .
            '|\{\{T_INPUT\b[^}]*\}\}|\[\[[^\]]*\]\]/';

    /** @var string matches a whole result-graph field that is a {{...}} multi-answer list -
     *  either the original quoted-items form {{"a";"b"}} or the plainer unquoted form
     *  {{a;b}} (same semicolon convention as a [[a;b]] select-options list, so a node with
     *  several acceptable answers - free-text or select alike - can be authored the same
     *  way as its options were). Items may freely mix quoted and unquoted; see
     *  split_answer_list() below for the actual per-item extraction. */
    const ANSWER_LIST_PATTERN = '/^\{\{(.*)\}\}$/s';

    /** @var string matches a whole result-graph field that opts into numeric validation,
     *  {{N:item;item;...}} - the student's value must be a number (or fraction) and is compared
     *  by value against each item (see parse_numeric_answer()). An explicit prefix, since a
     *  plain "0.5" has always meant the exact text "0.5" and must keep grading that way. Checked
     *  before ANSWER_LIST_PATTERN, which would otherwise also match it. */
    const NUMERIC_LIST_PATTERN = '/^\{\{N:(.*)\}\}$/s';

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
     * Parse a typed number, accepting '.' or ',' as the decimal separator, or a simple
     * fraction (FRACTION_PATTERN) - a zero denominator is not a number.
     *
     * @param mixed $value
     * @return float|null null if $value is not a number.
     */
    public static function parse_number($value): ?float {
        if (!is_string($value) && !is_int($value) && !is_float($value)) {
            return null;
        }
        $trimmed = trim((string) $value);
        if (preg_match(self::FRACTION_PATTERN, $trimmed, $fraction) === 1) {
            return (int) $fraction[2] === 0 ? null : (float) $fraction[1] / (float) $fraction[2];
        }
        if (preg_match(self::NUMBER_PATTERN, $trimmed) !== 1) {
            return null;
        }
        return (float) str_replace(',', '.', $trimmed);
    }

    /**
     * Parse one item of a {{N:...}} numeric answer field into the closed interval of
     * accepted values. Each side may be a decimal or a fraction (see parse_number()):
     * - "valor"             exactly that value (e.g. 0.5 - so 1/2, 2/4, 0,5 all match)
     * - "valor:tolerancia"  Cloze-style, valor ± tolerancia (e.g. 3.14:0.01)
     * - "min..max"          inclusive range (e.g. 1..2, 0,5..3/4); min must not exceed max
     * - "*"                 any valid number
     *
     * @param string $item
     * @return array|null [min, max], or null if malformed.
     */
    public static function parse_numeric_answer(string $item): ?array {
        $item = trim($item);
        if ($item === '*') {
            return [-INF, INF];
        }
        if (strpos($item, '..') !== false) {
            $bounds = explode('..', $item);
            if (count($bounds) !== 2) {
                return null;
            }
            $min = self::parse_number($bounds[0]);
            $max = self::parse_number($bounds[1]);
            return ($min === null || $max === null || $min > $max) ? null : [$min, $max];
        }
        $parts = explode(':', $item);
        if (count($parts) > 2) {
            return null;
        }
        $value = self::parse_number($parts[0]);
        $tolerance = count($parts) === 2 ? self::parse_number($parts[1]) : 0.0;
        if ($value === null || $tolerance === null || $tolerance < 0) {
            return null;
        }
        return [$value - $tolerance, $value + $tolerance];
    }

    /**
     * Does a result-graph answer field opt into numeric validation ({{N:...}})? Used by
     * grading::numeric_blank_keys() to tell the attempt page which blanks expect a number.
     *
     * @param mixed $text raw result-graph field text.
     * @return bool
     */
    public static function is_numeric_answer($text): bool {
        return self::parse_accepted_answers($text)['type'] === 'numeric';
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
        $span = self::first_blank_span($defaulttext);
        if ($span === null) {
            return $resulttext;
        }
        [$offset, $marker] = $span;
        $prefix = substr($defaulttext, 0, $offset);
        $suffix = substr($defaulttext, $offset + strlen($marker));
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
     * Find the index-0 blank in a default-graph label: the first free-text blank, select, or
     * fraction with at least one blank side. A display-only fraction ({{F:1|2}}) is skipped -
     * it is not a blank, so a blank after it is still index 0. Must match amd/src/editor.js's
     * parseLabelSegments() blank numbering.
     *
     * @param string $text
     * @return array|null [byte offset, full marker text], or null if the label has no blank.
     */
    public static function first_blank_span(string $text): ?array {
        if (!preg_match_all(self::BLANK_SPAN_PATTERN, $text, $matches, PREG_OFFSET_CAPTURE)) {
            return null;
        }
        foreach ($matches[0] as [$marker, $offset]) {
            $parts = self::fraction_parts($marker);
            if ($parts === null) {
                // A {{F:...}} span that is not a well-formed fraction is plain text.
                if (strpos($marker, '{{F:') === 0) {
                    continue;
                }
                return [$offset, $marker];
            }
            if (self::has_blank($parts[0]) || self::has_blank($parts[1])) {
                return [$offset, $marker];
            }
        }
        return null;
    }

    /**
     * Split a whole {{F:numerator|denominator}} marker into its two (trimmed) sides.
     *
     * @param string $marker
     * @return array|null [numerator, denominator], or null if $marker is not exactly one fraction.
     */
    public static function fraction_parts(string $marker): ?array {
        $anchored = '/^' . substr(self::FRACTION_TOKEN_PATTERN, 1, -1) . '$/';
        if (preg_match($anchored, $marker, $match) !== 1) {
            return null;
        }
        return [$match[1], $match[2]];
    }

    /**
     * Fill in the composed "numerator/denominator" value of every fraction blank in the
     * default graph, under the fraction's own index-0 response key ('node:<id>:0',
     * 'edge:<id>:0', 'floatingLabel:<id>:0'), so grading reads a fraction exactly like any
     * other blank. The student's inputs for each side are stored under that key plus ':n'
     * (numerator) / ':d' (denominator); a fixed side contributes its own text. If the
     * student left every blank side empty, the value is '' (an unanswered blank).
     *
     * @param array $default decoded default graph.
     * @param array $blanks the response's blanks map.
     * @return array $blanks with fraction values composed in.
     */
    public static function compose_fraction_values(array $default, array $blanks): array {
        $labels = [];
        foreach (($default['nodes'] ?? []) as $node) {
            if (isset($node['id'])) {
                $labels["node:{$node['id']}:0"] = $node['text'] ?? '';
                $labels["floatingLabel:{$node['id']}:0"] = $node['floatingLabel'] ?? '';
            }
        }
        foreach (($default['edges'] ?? []) as $edge) {
            if (isset($edge['id'])) {
                $labels["edge:{$edge['id']}:0"] = $edge['label'] ?? '';
            }
        }
        foreach ($labels as $key => $text) {
            if (!is_string($text) || strpos($text, '{{F:') === false) {
                continue;
            }
            $span = self::first_blank_span($text);
            $parts = $span === null ? null : self::fraction_parts($span[1]);
            if ($parts === null) {
                continue;
            }
            $values = [];
            $answered = false;
            foreach ([[$parts[0], ':n'], [$parts[1], ':d']] as [$part, $suffix]) {
                if (self::has_blank($part)) {
                    $value = $blanks[$key . $suffix] ?? '';
                    $value = is_string($value) ? trim($value) : '';
                    $answered = $answered || $value !== '';
                    $values[] = $value;
                } else {
                    $values[] = trim($part);
                }
            }
            $blanks[$key] = $answered ? $values[0] . '/' . $values[1] : '';
        }
        return $blanks;
    }

    /**
     * Parse a result-graph node/edge's text into the answer-field grammar.
     *
     * @param mixed $text raw result-graph field text.
     * @return array {type: 'unset'|'any'|'any_or_empty'|'exact'|'numeric', answers: string[]}
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
        if (preg_match(self::NUMERIC_LIST_PATTERN, $trimmed, $match)) {
            return ['type' => 'numeric', 'answers' => self::split_answer_list($match[1])];
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
     * A {{N:...}} field compares numerically: the student's value must parse as a number
     * (parse_number()) and fall inside one item's interval (parse_numeric_answer()), with a
     * tiny epsilon so float representation error (1/3 vs 2/6, 0.1+0.2) never fails an
     * exact answer. A malformed item matches nothing.
     *
     * @param mixed $studentvalue what the student typed into the blank.
     * @param mixed $acceptedfieldtext the result-graph node/edge's text for the matching id.
     * @return bool
     */
    public static function matches($studentvalue, $acceptedfieldtext): bool {
        $spec = self::parse_accepted_answers($acceptedfieldtext);
        if ($spec['type'] === 'numeric') {
            $number = self::parse_number($studentvalue);
            if ($number === null) {
                return false;
            }
            foreach ($spec['answers'] as $item) {
                $interval = self::parse_numeric_answer($item);
                if ($interval === null) {
                    continue;
                }
                [$min, $max] = $interval;
                $epsilon = 1e-9 * max(1.0, is_finite($min) ? abs($min) : 1.0, is_finite($max) ? abs($max) : 1.0);
                if ($number >= $min - $epsilon && $number <= $max + $epsilon) {
                    return true;
                }
            }
            return false;
        }
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
