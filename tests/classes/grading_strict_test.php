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
 * Unit tests for the "Strict input checks" ($strict) parameter of
 * classes/grading.php - order-independent matching among interchangeable
 * blanks. See classes/grading.php's docblock and this plugin's CLAUDE.md
 * ("Strict vs. non-strict grading") for the full design.
 *
 * Pure PHP, no DB/session dependency - grading::count_parts_right() takes
 * plain JSON strings and a response array, same as at grading time.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 * @covers     \qtype_graph\grading
 */
class grading_strict_test extends basic_testcase {

    /**
     * Builds a response array (grading::count_parts_right()'s $response
     * argument) from a plain node-id => typed-value blanks map.
     *
     * @param array $blanks 'node:<id>:0' (or 'edge:<id>:0') => typed value.
     * @param string[] $removednodes ids the student deleted.
     * @param array $nodes student-added nodes ({id, text}), if any.
     * @param array $edges student-added edges ({id, from, to}), if any.
     * @return array
     */
    protected function response(array $blanks, array $removednodes = [], array $nodes = [], array $edges = []): array {
        return ['nodesjson' => json_encode([
            'nodes' => $nodes,
            'edges' => $edges,
            'removednodes' => $removednodes,
            'blanks' => $blanks,
        ])];
    }

    /**
     * The exact tree from the user's report: three siblings each sharing the
     * identical blank [[Mago;Dragon;Hada]], each with two further identical
     * [[Aire;Hielo]] children - so every branch is structurally symmetric.
     *
     * @return array [default graph JSON, primary answer graph JSON].
     */
    protected function magician_tree(): array {
        $default = [
            'mode' => 'tree',
            'nodes' => [
                ['id' => 'root', 'text' => ' '],
                ['id' => 'n1', 'text' => '[[Mago;Dragon;Hada]]'],
                ['id' => 'n2', 'text' => '[[Mago;Dragon;Hada]]'],
                ['id' => 'n3', 'text' => '[[Mago;Dragon;Hada]]'],
                ['id' => 'n1a', 'text' => '[[Aire;Hielo]]'],
                ['id' => 'n1b', 'text' => '[[Aire;Hielo]]'],
                ['id' => 'n2a', 'text' => '[[Aire;Hielo]]'],
                ['id' => 'n2b', 'text' => '[[Aire;Hielo]]'],
                ['id' => 'n3a', 'text' => '[[Aire;Hielo]]'],
                ['id' => 'n3b', 'text' => '[[Aire;Hielo]]'],
            ],
            'edges' => [
                ['id' => 'e1', 'from' => 'root', 'to' => 'n1'],
                ['id' => 'e2', 'from' => 'root', 'to' => 'n2'],
                ['id' => 'e3', 'from' => 'root', 'to' => 'n3'],
                ['id' => 'e1a', 'from' => 'n1', 'to' => 'n1a'],
                ['id' => 'e1b', 'from' => 'n1', 'to' => 'n1b'],
                ['id' => 'e2a', 'from' => 'n2', 'to' => 'n2a'],
                ['id' => 'e2b', 'from' => 'n2', 'to' => 'n2b'],
                ['id' => 'e3a', 'from' => 'n3', 'to' => 'n3a'],
                ['id' => 'e3b', 'from' => 'n3', 'to' => 'n3b'],
            ],
        ];
        $result = json_decode(json_encode($default), true);
        $texts = [
            'n1' => 'mago', 'n2' => 'dragon', 'n3' => 'hada',
            'n1a' => 'aire', 'n1b' => 'hielo', 'n2a' => 'aire', 'n2b' => 'hielo',
            'n3a' => 'aire', 'n3b' => 'hielo',
        ];
        foreach ($result['nodes'] as &$node) {
            if (isset($texts[$node['id']])) {
                $node['text'] = $texts[$node['id']];
            }
        }
        unset($node);
        return [json_encode($default), json_encode($result)];
    }

    public function test_exact_response_scores_full_marks_either_way(): void {
        [$default, $result] = $this->magician_tree();
        $response = $this->response([
            'node:n1:0' => 'mago', 'node:n2:0' => 'dragon', 'node:n3:0' => 'hada',
            'node:n1a:0' => 'aire', 'node:n1b:0' => 'hielo', 'node:n2a:0' => 'aire', 'node:n2b:0' => 'hielo',
            'node:n3a:0' => 'aire', 'node:n3b:0' => 'hielo',
        ]);

        [$correct, $total] = grading::count_parts_right($default, $result, $response, true, [], true);
        $this->assertSame([9, 9], [$correct, $total], 'exact match must stay 9/9 under strict grading');

        [$correct, $total] = grading::count_parts_right($default, $result, $response, true, [], false);
        $this->assertSame([9, 9], [$correct, $total], 'exact match must stay 9/9 under non-strict grading too');
    }

    public function test_permuted_siblings_only_score_full_marks_when_non_strict(): void {
        [$default, $result] = $this->magician_tree();
        // n1<->n2 swapped (dragon/mago), n3 unchanged (hada) - each swapped branch's
        // aire/hielo children carried along with their new parent, recursively.
        $response = $this->response([
            'node:n1:0' => 'dragon', 'node:n2:0' => 'mago', 'node:n3:0' => 'hada',
            'node:n1a:0' => 'aire', 'node:n1b:0' => 'hielo', 'node:n2a:0' => 'aire', 'node:n2b:0' => 'hielo',
            'node:n3a:0' => 'aire', 'node:n3b:0' => 'hielo',
        ]);

        [$correct, $total] = grading::count_parts_right($default, $result, $response, true, [], true);
        // n1/n2 wrong by id; n1a/n1b/n2a/n2b happen to coincide (aire/hielo is the same
        // in both branches); n3/n3a/n3b untouched. 7 of 9 correct by sheer coincidence.
        $this->assertSame([7, 9], [$correct, $total], 'strict grading only credits the exact authored id pairing');

        [$correct, $total] = grading::count_parts_right($default, $result, $response, true, [], false);
        $this->assertSame([9, 9], [$correct, $total],
                'non-strict grading must credit any structurally valid sibling permutation in full');
    }

    public function test_partial_permutation_gives_partial_credit_not_zero(): void {
        [$default, $result] = $this->magician_tree();
        // Same valid n1<->n2 swap as above, but n1a is a genuine mistake this time
        // (not just a relabeling) - non-strict grading must still credit everything
        // else, not throw away the whole branch's credit over one real wrong answer.
        $response = $this->response([
            'node:n1:0' => 'dragon', 'node:n2:0' => 'mago', 'node:n3:0' => 'hada',
            'node:n1a:0' => 'WRONG', 'node:n1b:0' => 'hielo', 'node:n2a:0' => 'aire', 'node:n2b:0' => 'hielo',
            'node:n3a:0' => 'aire', 'node:n3b:0' => 'hielo',
        ]);

        [$correct, $total] = grading::count_parts_right($default, $result, $response, true, [], false);
        $this->assertSame([8, 9], [$correct, $total],
                'a genuine mistake inside a validly-permuted subtree should cost exactly one point, not the whole subtree');
    }

    public function test_fully_wrong_response_scores_zero_either_way(): void {
        [$default, $result] = $this->magician_tree();
        $blanks = [];
        foreach (['n1', 'n2', 'n3', 'n1a', 'n1b', 'n2a', 'n2b', 'n3a', 'n3b'] as $id) {
            $blanks["node:{$id}:0"] = 'definitely not an accepted answer';
        }
        $response = $this->response($blanks);

        foreach ([true, false] as $strict) {
            [$correct, $total] = grading::count_parts_right($default, $result, $response, true, [], $strict);
            $this->assertSame([0, 9], [$correct, $total],
                    'non-strict grading must never invent credit for answers that match nothing (strict=' .
                    var_export($strict, true) . ')');
        }
    }

    public function test_general_graph_mode_permutes_via_edge_adjacency_not_tree_parents(): void {
        // A diamond (not a tree): root -> a -> c, root -> b -> c. a/b are free siblings
        // (both node text AND the connecting edge label are blanks); c is a fixed merge
        // point. Exercises non-strict grading with cycada-free but non-tree structure,
        // and blank EDGE labels being permuted alongside blank node text.
        $default = json_encode([
            'mode' => 'graph',
            'nodes' => [
                ['id' => 'root', 'text' => 'root'],
                ['id' => 'a', 'text' => '[[Left;Right]]'],
                ['id' => 'b', 'text' => '[[Left;Right]]'],
                ['id' => 'c', 'text' => 'merge'],
            ],
            'edges' => [
                ['id' => 'e-ra', 'from' => 'root', 'to' => 'a', 'label' => '{{T_INPUT}}'],
                ['id' => 'e-rb', 'from' => 'root', 'to' => 'b', 'label' => '{{T_INPUT}}'],
                ['id' => 'e-ac', 'from' => 'a', 'to' => 'c', 'label' => ''],
                ['id' => 'e-bc', 'from' => 'b', 'to' => 'c', 'label' => ''],
            ],
        ]);
        $result = json_encode([
            'mode' => 'graph',
            'nodes' => [
                ['id' => 'root', 'text' => 'root'],
                ['id' => 'a', 'text' => 'Left'],
                ['id' => 'b', 'text' => 'Right'],
                ['id' => 'c', 'text' => 'merge'],
            ],
            'edges' => [
                ['id' => 'e-ra', 'from' => 'root', 'to' => 'a', 'label' => 'west'],
                ['id' => 'e-rb', 'from' => 'root', 'to' => 'b', 'label' => 'east'],
                ['id' => 'e-ac', 'from' => 'a', 'to' => 'c', 'label' => ''],
                ['id' => 'e-bc', 'from' => 'b', 'to' => 'c', 'label' => ''],
            ],
        ]);
        // Student swaps a/b relative to the authored answer: a=Right/east, b=Left/west.
        $response = $this->response([
            'node:a:0' => 'Right', 'node:b:0' => 'Left',
            'edge:e-ra:0' => 'east', 'edge:e-rb:0' => 'west',
        ]);

        [$correct, $total] = grading::count_parts_right($default, $result, $response, true, [], true);
        $this->assertSame([0, 4], [$correct, $total], 'strict grading rejects the swap entirely');

        [$correct, $total] = grading::count_parts_right($default, $result, $response, true, [], false);
        $this->assertSame([4, 4], [$correct, $total],
                'non-strict grading must permute via edge adjacency in general graph mode too, node text and edge labels alike');
    }

    public function test_deletion_and_new_node_anchor_matching_are_unaffected_by_strict(): void {
        // p/q are free siblings (swappable); d is fixed scaffolding the student is
        // expected to delete; the answer graph also expects a brand new node anchored
        // to q's ORIGINAL id. None of that should be influenced by the p/q permutation.
        $default = json_encode([
            'mode' => 'tree',
            'nodes' => [
                ['id' => 'root', 'text' => 'root'],
                ['id' => 'p', 'text' => '[[X;Y]]'],
                ['id' => 'q', 'text' => '[[X;Y]]'],
                ['id' => 'd', 'text' => 'deleteme'],
            ],
            'edges' => [
                ['id' => 'e-rp', 'from' => 'root', 'to' => 'p'],
                ['id' => 'e-rq', 'from' => 'root', 'to' => 'q'],
                ['id' => 'e-rd', 'from' => 'root', 'to' => 'd'],
            ],
        ]);
        $result = json_encode([
            'mode' => 'tree',
            'nodes' => [
                ['id' => 'root', 'text' => 'root'],
                ['id' => 'p', 'text' => 'X'],
                ['id' => 'q', 'text' => 'Y'],
                ['id' => 'new1', 'text' => 'extra'],
            ],
            'edges' => [
                ['id' => 'e-rp', 'from' => 'root', 'to' => 'p'],
                ['id' => 'e-rq', 'from' => 'root', 'to' => 'q'],
                ['id' => 'e-new1', 'from' => 'q', 'to' => 'new1'],
            ],
        ]);
        // p/q swapped (non-strict-valid), d correctly deleted, and a new node correctly
        // attached to the literal id "q" (not wherever q's own answer ended up).
        $response = $this->response(
            ['node:p:0' => 'Y', 'node:q:0' => 'X'],
            ['d'],
            [['id' => 'student-1', 'text' => 'extra']],
            [['id' => 'student-e1', 'from' => 'q', 'to' => 'student-1']]
        );

        // 5 gradable items: p, q, d's own deletion, the e-rd edge's deletion (an edge is
        // only ever "removed" via its endpoint - see grading.php's docblock), new1.
        [$correct, $total] = grading::count_parts_right($default, $result, $response, true, [], true);
        $this->assertSame([3, 5], [$correct, $total],
                'strict: only the id-independent items (deletion x2, anchored new node) are credited');

        [$correct, $total] = grading::count_parts_right($default, $result, $response, true, [], false);
        $this->assertSame([5, 5], [$correct, $total],
                'non-strict: p/q now also credited via the permutation, deletion/anchor items unchanged');
    }

    public function test_pathologically_symmetric_graph_degrades_gracefully_instead_of_hanging(): void {
        // A 9-leaf star, every leaf sharing an identical 9-option blank, and every
        // response value matching NOTHING - the worst case for this search, since no
        // candidate ever looks better than another, so nothing lets the branch-and-bound
        // prune early (see grading::MAX_PERMUTATION_STEPS). Asserts this returns quickly
        // with a sane (bounded, non-negative) result rather than hanging or erroring.
        $labels = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
        $nodes = [['id' => 'root', 'text' => 'root']];
        $resultnodes = [['id' => 'root', 'text' => 'root']];
        $edges = [];
        $blanks = [];
        foreach ($labels as $i => $label) {
            $id = "leaf$i";
            $nodes[] = ['id' => $id, 'text' => '[[' . implode(';', $labels) . ']]'];
            $resultnodes[] = ['id' => $id, 'text' => $label];
            $edges[] = ['id' => "e$i", 'from' => 'root', 'to' => $id];
            $blanks["node:{$id}:0"] = 'this matches none of the nine options';
        }
        $default = json_encode(['mode' => 'graph', 'nodes' => $nodes, 'edges' => $edges]);
        $result = json_encode(['mode' => 'graph', 'nodes' => $resultnodes, 'edges' => $edges]);
        $response = $this->response($blanks);

        $start = microtime(true);
        [$correct, $total] = grading::count_parts_right($default, $result, $response, true, [], false);
        $elapsed = microtime(true) - $start;

        $this->assertLessThan(5.0, $elapsed, 'the safety cap must keep grading fast even on adversarial symmetric input');
        $this->assertSame(9, $total);
        $this->assertGreaterThanOrEqual(0, $correct);
        $this->assertLessThanOrEqual($total, $correct);
        // Nothing the student typed matches any accepted answer under ANY permutation,
        // so the true best score is 0 regardless of how much of the search ran.
        $this->assertSame(0, $correct);
    }
}
