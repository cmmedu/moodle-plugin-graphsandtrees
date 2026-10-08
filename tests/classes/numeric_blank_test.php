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

use basic_testcase;

defined('MOODLE_INTERNAL') || die();

/**
 * Unit tests for numeric {{N_INPUT}} blanks ("Marcar como input → Número") - see
 * classes/answer_matcher.php's matches() and this plugin's CLAUDE.md
 * ("Answer-field grammar and blank sanitization").
 *
 * Pure PHP, no DB/session dependency.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
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
            'exact' => ['3.14', '3.14', true],
            'comma decimal (student)' => ['3,14', '3.14', true],
            'comma decimal (teacher)' => ['3.140', '3,14', true],
            'inside tolerance' => ['3.15', '3.14:0.01', true],
            'outside tolerance' => ['3.16', '3.14:0.01', false],
            'answer list' => ['-2', '{{2;-2}}', true],
            'exponent' => ['1e3', '1000', true],
            'float rounding' => ['0.3', '0.30000000000000004', true],
            'T_ANY rejects non-number' => ['abc', '{{T_ANY}}', false],
            'T_ANY accepts number' => ['5', '{{T_ANY}}', true],
            'T_ANY_N_EMPTY accepts empty' => ['', '{{T_ANY_N_EMPTY}}', true],
            'empty never matches 0' => ['', '0', false],
            'malformed answer never matches' => ['3.14', 'pi', false],
            'not a number' => ['1,5,0', '150', false],
        ];
    }

    /**
     * @dataProvider numeric_matches_provider
     * @param string $student
     * @param string $accepted
     * @param bool $expected
     */
    public function test_numeric_matches(string $student, string $accepted, bool $expected): void {
        $this->assertSame($expected, answer_matcher::matches($student, $accepted, true));
    }

    public function test_is_numeric_blank(): void {
        $this->assertTrue(answer_matcher::is_numeric_blank('{{N_INPUT}}'));
        $this->assertTrue(answer_matcher::is_numeric_blank('mide {{N_INPUT}} cm'));
        $this->assertFalse(answer_matcher::is_numeric_blank('{{T_INPUT}}'));
        $this->assertFalse(answer_matcher::is_numeric_blank('[[1;2]]'));
        $this->assertTrue(answer_matcher::has_blank('{{N_INPUT}}'));
        $this->assertSame('12', answer_matcher::strip_default_context('{{N_INPUT}} cm', '12 cm'));
    }

    public function test_text_blank_is_unchanged(): void {
        // A {{T_INPUT}} blank keeps comparing as text: "3,14" is not "3.14" there.
        $this->assertFalse(answer_matcher::matches('3,14', '3.14'));
    }

    public function test_grading_numeric_tree_in_any_order(): void {
        $tree = static function(array $texts): string {
            return json_encode([
                'mode' => 'tree',
                'nodes' => [
                    ['id' => 'root', 'text' => 'Total'],
                    ['id' => 'a', 'text' => $texts[0]],
                    ['id' => 'b', 'text' => $texts[1]],
                ],
                'edges' => [
                    ['id' => 'e-ra', 'from' => 'root', 'to' => 'a', 'label' => ''],
                    ['id' => 'e-rb', 'from' => 'root', 'to' => 'b', 'label' => ''],
                ],
            ]);
        };
        $default = $tree(['{{N_INPUT}}', '{{N_INPUT}}']);
        $result = $tree(['0.5:0.01', '0.25']);
        $response = static function(string $a, string $b): array {
            return ['nodesjson' => json_encode(['nodes' => [], 'edges' => [], 'removednodes' => [],
                    'blanks' => ['node:a:0' => $a, 'node:b:0' => $b]])];
        };

        $this->assertSame([2, 2], grading::count_parts_right($default, $result, $response('0,5', '0.25'), true, [], false));
        $this->assertSame([2, 2], grading::count_parts_right($default, $result, $response('0.25', '0,505'), true, [], false),
                'interchangeable numeric siblings may be answered in any order');
        $this->assertSame([1, 2], grading::count_parts_right($default, $result, $response('0.5', 'un cuarto'), true, [], false));
    }
}
