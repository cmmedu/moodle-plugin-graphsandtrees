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
 * Unit tests for {{F:num|den}} fraction labels ("Marcar como fracción") - see
 * classes/answer_matcher.php's first_blank_span()/fraction_parts()/
 * compose_fraction_values() and this plugin's CLAUDE.md ("Fractions").
 *
 * Pure PHP, no DB/session dependency.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 * @covers     \qtype_graph\answer_matcher
 * @covers     \qtype_graph\grading
 */
class fraction_blank_test extends basic_testcase {

    public function test_first_blank_span(): void {
        $this->assertNull(answer_matcher::first_blank_span('{{F:1|2}}'), 'a display-only fraction is not a blank');
        $this->assertNull(answer_matcher::first_blank_span('{{F:casos favorables|casos totales}}'));
        $this->assertSame([0, '{{F:{{T_INPUT}}|4}}'], answer_matcher::first_blank_span('{{F:{{T_INPUT}}|4}}'));
        $this->assertSame([4, '{{F: {{T_INPUT}} | [[2;4;8]] }}'],
                answer_matcher::first_blank_span('P = {{F: {{T_INPUT}} | [[2;4;8]] }} %'));
        $this->assertSame([12, '{{T_INPUT}}'], answer_matcher::first_blank_span('{{F:1|2}} y {{T_INPUT}}'),
                'a blank after a display-only fraction is still blank 0');
        $this->assertNull(answer_matcher::first_blank_span('{{F:{{T_INPUT}}|a|b}}'),
                'a malformed fraction is plain text, inner markers included');
    }

    public function test_fraction_parts(): void {
        $this->assertSame(['{{T_INPUT}}', '[[2;4;8]]'], answer_matcher::fraction_parts('{{F: {{T_INPUT}} | [[2;4;8]] }}'));
        $this->assertSame(['1', '2'], answer_matcher::fraction_parts('{{F:1|2}}'));
        $this->assertNull(answer_matcher::fraction_parts('{{F:1|2|3}}'));
        $this->assertNull(answer_matcher::fraction_parts('{{T_INPUT}}'));
    }

    public function test_strip_default_context_around_a_fraction(): void {
        $this->assertSame('1/2', answer_matcher::strip_default_context('P = {{F:{{T_INPUT}}|[[2;4]]}} %', 'P = 1/2 %'));
    }

    /**
     * Default/result graph pair: a fraction on node a's text, a floating label on leaf b
     * and the root -> b edge label.
     *
     * @param string $a node a's text.
     * @param string $bfloating leaf b's floating label.
     * @param string $edge the root -> b edge label.
     * @return string graph JSON
     */
    protected function graph(string $a, string $bfloating, string $edge): string {
        return json_encode([
            'mode' => 'tree',
            'nodes' => [
                ['id' => 'r', 'text' => '{{F:casos favorables|casos totales}}'],
                ['id' => 'a', 'text' => $a],
                ['id' => 'b', 'text' => 'B', 'floatingLabel' => $bfloating],
            ],
            'edges' => [
                ['id' => 'e1', 'from' => 'r', 'to' => 'a', 'label' => '{{F:1|2}}'],
                ['id' => 'e2', 'from' => 'r', 'to' => 'b', 'label' => $edge],
            ],
        ]);
    }

    /**
     * @param array $blanks
     * @return array a response array.
     */
    protected function response(array $blanks): array {
        return ['nodesjson' => json_encode(['nodes' => [], 'edges' => [], 'removednodes' => [], 'blanks' => $blanks])];
    }

    public function test_compose_fraction_values(): void {
        $default = json_decode($this->graph('{{F:{{T_INPUT}}|4}}', 'P = {{F:{{T_INPUT}}|[[2;4]]}}',
                '{{F:{{T_INPUT}}|{{T_INPUT}}}}'), true);
        $composed = answer_matcher::compose_fraction_values($default, [
            'node:a:0:n' => ' 3 ',
            'floatingLabel:b:0:n' => '1',
            'floatingLabel:b:0:d' => '2',
        ]);
        $this->assertSame('3/4', $composed['node:a:0'], 'a fixed side contributes its own text');
        $this->assertSame('1/2', $composed['floatingLabel:b:0']);
        $this->assertSame('', $composed['edge:e2:0'], 'every blank side empty = unanswered');
        $this->assertArrayNotHasKey('edge:e1:0', $composed, 'a display-only fraction is not a blank');
    }

    public function test_grading_fractions(): void {
        $default = $this->graph('{{F:{{T_INPUT}}|4}}', 'P = {{F:{{T_INPUT}}|[[2;4;8]]}}', '{{F:{{T_INPUT}}|{{T_INPUT}}}}');
        $text = $this->graph('3/4', 'P = 1/2', '1/2');
        $numeric = $this->graph('{{N:3/4}}', 'P = {{N:0.5}}', '{{N:0.4..0.6}}');
        $right = $this->response(['node:a:0:n' => '3', 'floatingLabel:b:0:n' => '1', 'floatingLabel:b:0:d' => '2',
                'edge:e2:0:n' => '1', 'edge:e2:0:d' => '2']);
        $equivalent = $this->response(['node:a:0:n' => '3', 'floatingLabel:b:0:n' => '2', 'floatingLabel:b:0:d' => '4',
                'edge:e2:0:n' => '2', 'edge:e2:0:d' => '4']);

        $this->assertSame([3, 3], grading::count_parts_right($default, $text, $right, true, [], false));
        $this->assertSame([1, 3], grading::count_parts_right($default, $text, $equivalent, true, [], false),
                'a plain "a/b" answer is exact text, so 2/4 is not 1/2 there');
        $this->assertSame([3, 3], grading::count_parts_right($default, $numeric, $equivalent, true, [], false),
                '{{N:...}} compares the composed fraction by value');
        $this->assertSame([2, 3], grading::count_parts_right($default, $numeric,
                $this->response(['node:a:0:n' => '3', 'floatingLabel:b:0:n' => '1', 'floatingLabel:b:0:d' => '2',
                        'edge:e2:0:n' => '1', 'edge:e2:0:d' => '0']), true, [], false),
                'a zero denominator is not a number');
    }

    public function test_clear_wrong_clears_fraction_sides(): void {
        $default = $this->graph('{{F:{{T_INPUT}}|4}}', 'P = {{F:{{T_INPUT}}|[[2;4;8]]}}', '{{F:{{T_INPUT}}|{{T_INPUT}}}}');
        $result = $this->graph('3/4', 'P = 1/2', '1/2');
        $cleared = grading::clear_wrong($default, $result, $this->response(['node:a:0:n' => '3',
                'floatingLabel:b:0:n' => '1', 'floatingLabel:b:0:d' => '2', 'edge:e2:0:n' => '2', 'edge:e2:0:d' => '3']),
                true, [], false);
        $blanks = json_decode($cleared['nodesjson'], true)['blanks'];
        $this->assertSame(['node:a:0:n' => '3', 'floatingLabel:b:0:n' => '1', 'floatingLabel:b:0:d' => '2',
                'edge:e2:0:n' => '', 'edge:e2:0:d' => ''], $blanks);
    }

    public function test_any_order_with_text_around_the_blank(): void {
        // Siblings told apart only by blanks carrying decorative text ("P = ", " %"): the
        // any-order search must strip that text off the answers before comparing, exactly
        // like the final grading does - otherwise it never finds the swap.
        $graph = static function(string $x, string $y): string {
            return json_encode(['mode' => 'tree',
                'nodes' => [['id' => 'r', 'text' => 'R'], ['id' => 'x', 'text' => 'Rama', 'floatingLabel' => $x],
                        ['id' => 'y', 'text' => 'Rama', 'floatingLabel' => $y]],
                'edges' => [['id' => 'e1', 'from' => 'r', 'to' => 'x', 'label' => ''],
                        ['id' => 'e2', 'from' => 'r', 'to' => 'y', 'label' => '']]]);
        };
        $this->assertSame([2, 2], grading::count_parts_right($graph('{{T_INPUT}} %', '{{T_INPUT}} %'),
                $graph('40 %', '60 %'), $this->response(['floatingLabel:x:0' => '60', 'floatingLabel:y:0' => '40']),
                true, [], false));
        $fraction = 'P = {{F:{{T_INPUT}}|{{T_INPUT}}}}';
        $this->assertSame([2, 2], grading::count_parts_right($graph($fraction, $fraction), $graph('P = 2/5', 'P = 3/5'),
                $this->response(['floatingLabel:x:0:n' => '3', 'floatingLabel:x:0:d' => '5',
                        'floatingLabel:y:0:n' => '2', 'floatingLabel:y:0:d' => '5']), true, [], false));
    }

    public function test_numeric_blank_keys_cover_fractions(): void {
        $default = $this->graph('{{F:{{T_INPUT}}|4}}', 'P = {{F:{{T_INPUT}}|[[2;4;8]]}}', '{{F:{{T_INPUT}}|{{T_INPUT}}}}');
        $this->assertSame(['node:a:0', 'edge:e2:0'],
                grading::numeric_blank_keys($default, $this->graph('{{N:3/4}}', 'P = 1/2', '{{N:*}}')));
    }
}
