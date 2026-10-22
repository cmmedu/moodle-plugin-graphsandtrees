<?php
// This file is part of qtype_graph, a question type plugin for Moodle - http://moodle.org/
//
// Released under the MIT License. See the LICENSE file at the root of this plugin.

namespace qtype_graph;

use basic_testcase;

defined('MOODLE_INTERNAL') || die();

/**
 * Unit tests for numeric answer validation - a {{N:...}} result-graph answer field
 * (values, fractions, tolerances, ranges) - see classes/answer_matcher.php's
 * parse_numeric_answer()/matches(), grading::numeric_blank_keys() and this plugin's
 * CLAUDE.md ("Answer-field grammar and blank sanitization").
 *
 * Pure PHP, no DB/session dependency.
 *
 * @package    qtype_graph
 * @copyright  2026 CMMEdu
 * @license    https://opensource.org/licenses/MIT MIT
 * @covers     \qtype_graph\answer_matcher
 * @covers     \qtype_graph\grading
 */
class numeric_blank_test extends basic_testcase {

    /**
     * Data provider for test_numeric_matches().
     *
     * @return array [student value, result-graph answer field, expected match]
     */
    public static function numeric_matches_provider(): array {
        return [
            'exact' => ['3.14', '{{N:3.14}}', true],
            'comma decimal (student)' => ['3,14', '{{N:3.14}}', true],
            'comma decimal (teacher)' => ['3.140', '{{N:3,14}}', true],
            'inside tolerance' => ['3.15', '{{N:3.14:0.01}}', true],
            'outside tolerance' => ['3.16', '{{N:3.14:0.01}}', false],
            'answer list' => ['-2', '{{N:2;-2}}', true],
            'exponent' => ['1e3', '{{N:1000}}', true],
            'float rounding' => ['0.3', '{{N:0.30000000000000004}}', true],
            'any number' => ['5', '{{N:*}}', true],
            'any number rejects text' => ['abc', '{{N:*}}', false],
            'empty never matches 0' => ['', '{{N:0}}', false],
            'malformed item never matches' => ['3.14', '{{N:pi}}', false],
            'not a number' => ['1,5,0', '{{N:150}}', false],
            'fraction vs decimal answer' => ['1/2', '{{N:0.5}}', true],
            'equivalent fraction' => ['2/4', '{{N:1/2}}', true],
            'equivalent fraction (thirds)' => ['2/6', '{{N:1/3}}', true],
            'decimal vs fraction answer' => ['0,5', '{{N:1/2}}', true],
            'negative fraction' => ['-3/4', '{{N:-0.75}}', true],
            'spaces around slash' => ['7 / 8', '{{N:0.875}}', true],
            'fraction tolerance' => ['0.333', '{{N:1/3:0.001}}', true],
            'rounded decimal is not the fraction' => ['0.333', '{{N:1/3}}', false],
            'wrong fraction' => ['1/3', '{{N:0.5}}', false],
            'zero denominator' => ['1/0', '{{N:*}}', false],
            'mixed number not accepted' => ['1 1/2', '{{N:1.5}}', false],
            'decimal inside fraction not accepted' => ['0,5/2', '{{N:0.25}}', false],
            'range inside' => ['1.5', '{{N:1..2}}', true],
            'range inclusive bound' => ['2', '{{N:1..2}}', true],
            'range with fraction bounds' => ['2/3', '{{N:1/2..3/4}}', true],
            'range with comma decimals' => ['0,6', '{{N:0,5..0,75}}', true],
            'range outside' => ['2.01', '{{N:1..2}}', false],
            'inverted range is malformed' => ['1.5', '{{N:2..1}}', false],
            'mixed items' => ['5.5', '{{N:2;-2;5..6}}', true],
            'quoted items' => ['0,5', '{{N:"1/2";"0.25"}}', true],
        ];
    }

    /**
     * @dataProvider numeric_matches_provider
     * @param string $student
     * @param string $accepted
     * @param bool $expected
     */
    public function test_numeric_matches(string $student, string $accepted, bool $expected): void {
        $this->assertSame($expected, answer_matcher::matches($student, $accepted));
    }

    public function test_plain_answers_keep_comparing_as_text(): void {
        // Without the {{N:...}} opt-in, existing answers grade exactly as before.
        $this->assertFalse(answer_matcher::matches('3,14', '3.14'));
        $this->assertFalse(answer_matcher::matches('1/2', '0.5'));
        $this->assertTrue(answer_matcher::matches('0.5', '0.5'));
        $this->assertTrue(answer_matcher::matches('abc', '{{T_ANY}}'));
        $this->assertTrue(answer_matcher::matches('n:1', '{{n:1}}'), 'lowercase n: is a plain text list');
    }

    public function test_is_numeric_answer(): void {
        $this->assertTrue(answer_matcher::is_numeric_answer('{{N:1/2}}'));
        $this->assertTrue(answer_matcher::is_numeric_answer(' {{N:*}} '));
        $this->assertFalse(answer_matcher::is_numeric_answer('{{1;2}}'));
        $this->assertFalse(answer_matcher::is_numeric_answer('0.5'));
        $this->assertFalse(answer_matcher::is_numeric_answer(''));
    }

    /**
     * A tiny tree: root -> a, root -> b, with the given text on a and b, and optionally
     * a floating label on b and a label on the root -> b edge.
     *
     * @param string $a
     * @param string $b
     * @param string $bfloating floating label on b ('' for none).
     * @param string $rblabel label on the root -> b edge.
     * @return string graph JSON
     */
    protected function tree(string $a, string $b, string $bfloating = '', string $rblabel = ''): string {
        $nodeb = ['id' => 'b', 'text' => $b];
        if ($bfloating !== '') {
            $nodeb['floatingLabel'] = $bfloating;
        }
        return json_encode([
            'mode' => 'tree',
            'nodes' => [
                ['id' => 'root', 'text' => 'Total'],
                ['id' => 'a', 'text' => $a],
                $nodeb,
            ],
            'edges' => [
                ['id' => 'e-ra', 'from' => 'root', 'to' => 'a', 'label' => ''],
                ['id' => 'e-rb', 'from' => 'root', 'to' => 'b', 'label' => $rblabel],
            ],
        ]);
    }

    public function test_grading_numeric_tree_in_any_order(): void {
        $default = $this->tree('{{T_INPUT}}', '{{T_INPUT}}');
        $result = $this->tree('{{N:0.5:0.01}}', '{{N:1/4}}');
        $response = static function(string $a, string $b): array {
            return ['nodesjson' => json_encode(['nodes' => [], 'edges' => [], 'removednodes' => [],
                    'blanks' => ['node:a:0' => $a, 'node:b:0' => $b]])];
        };

        $this->assertSame([2, 2], grading::count_parts_right($default, $result, $response('1/2', '0,25'), true, [], false));
        $this->assertSame([2, 2], grading::count_parts_right($default, $result, $response('2/8', '0,505'), true, [], false),
                'interchangeable numeric siblings may be answered in any order');
        $this->assertSame([1, 2], grading::count_parts_right($default, $result, $response('0.5', 'un cuarto'), true, [], false));
    }

    public function test_numeric_blank_keys(): void {
        $default = $this->tree('{{T_INPUT}}', '[[1/2;1/3]]', '{{T_INPUT}} %', '{{T_INPUT}}');
        // Floating label "{{T_INPUT}} %" with a numeric answer: its " %" context is stripped
        // before checking; the edge blank is text-graded, so it is not numeric.
        $primary = $this->tree('{{N:0.5}}', '{{N:1/2}}', '{{N:40}} %', 'texto');

        $this->assertSame(['node:a:0', 'node:b:0', 'floatingLabel:b:0'],
                grading::numeric_blank_keys($default, $primary));
        // A blank only counts if EVERY answer graph validates it numerically.
        $alternate = $this->tree('cualquier texto', '{{N:1/3}}', '40 %', '{{N:*}}');
        $this->assertSame(['node:b:0'], grading::numeric_blank_keys($default, $primary, [$alternate]));
        // Blank alternates are ignored, and no answer graph at all means no hints.
        $this->assertSame(['node:a:0', 'node:b:0', 'floatingLabel:b:0'],
                grading::numeric_blank_keys($default, $primary, ['', '  ']));
        $this->assertSame([], grading::numeric_blank_keys($default, ''));
    }
}
