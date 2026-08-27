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
 * Automatic grading: compares a student's response against the teacher's
 * default graph + result graph, matched by shared node/edge id (see this
 * plugin's CLAUDE.md, "Planned: automatic-grading comparison design").
 *
 * Every node/edge id in the default graph is one gradable item:
 * - absent from the result graph  => the student was expected to delete it
 *   (checked via the response's removednodes list; for an edge, since a
 *   locked edge can only be removed by deleting one of its endpoint nodes,
 *   "deleted" means either endpoint id is in removednodes - there is
 *   currently no way for a student to delete just a locked edge on its own).
 * - present in the result graph, not a {{T_INPUT}} blank => purely
 *   structural: correct as long as the student didn't delete it (nothing
 *   else to compare, since locked non-blank text can't be edited).
 * - present in the result graph, is a {{T_INPUT}} blank => the result
 *   graph's text for that id is the accepted-answer field (see
 *   answer_matcher::parse_accepted_answers()), compared against the
 *   student's typed value for blank index 0 of that node/edge. Only blank
 *   index 0 is graded: the "Marcar como input" button always replaces a
 *   label's entire text with a single bare marker, so every gradable blank
 *   today is index 0 - a label with more than one {{T_INPUT}} token (only
 *   reachable by hand-typing the legacy embedded-answer syntax) would have
 *   its later blanks silently ungraded.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class grading {
    /**
     * Grade a student's response against the teacher's graphs.
     *
     * @param string $graphjson the default (student-visible) graph.
     * @param string $resultgraphjson the expected/correct result graph.
     * @param array $response the question's response array (has 'nodesjson').
     * @return float fraction correct, 0.0 to 1.0.
     */
    public static function grade(string $graphjson, string $resultgraphjson, array $response): float {
        $default = json_decode($graphjson, true);
        if (!is_array($default) || empty($default['nodes'])) {
            return 0.0;
        }
        $result = json_decode($resultgraphjson, true);
        $result = is_array($result) ? $result : [];
        $resultnodes = self::index_by_id($result['nodes'] ?? []);
        $resultedges = self::index_by_id($result['edges'] ?? []);

        $responsedata = json_decode($response['nodesjson'] ?? '', true);
        $removednodes = [];
        $blanks = [];
        if (is_array($responsedata)) {
            $removedlist = is_array($responsedata['removednodes'] ?? null) ? $responsedata['removednodes'] : [];
            $removednodes = array_flip($removedlist);
            $blanks = is_array($responsedata['blanks'] ?? null) ? $responsedata['blanks'] : [];
        }

        $total = 0;
        $correct = 0;

        foreach ($default['nodes'] as $node) {
            $total++;
            if (self::node_correct($node, $resultnodes, $removednodes, $blanks)) {
                $correct++;
            }
        }
        foreach (($default['edges'] ?? []) as $edge) {
            $total++;
            if (self::edge_correct($edge, $resultedges, $removednodes, $blanks)) {
                $correct++;
            }
        }

        return $total > 0 ? $correct / $total : 0.0;
    }

    /**
     * Index a list of {id: ...} records by id.
     *
     * @param array $items
     * @return array id => item
     */
    protected static function index_by_id(array $items): array {
        $indexed = [];
        foreach ($items as $item) {
            if (is_array($item) && isset($item['id'])) {
                $indexed[$item['id']] = $item;
            }
        }
        return $indexed;
    }

    /**
     * Grade one default-graph node.
     *
     * @param array $node
     * @param array $resultnodes result-graph nodes indexed by id.
     * @param array $removednodes ids the student deleted, as array keys.
     * @param array $blanks the response's blanks map.
     * @return bool
     */
    protected static function node_correct(array $node, array $resultnodes, array $removednodes, array $blanks): bool {
        $id = $node['id'] ?? null;
        if ($id === null) {
            return false;
        }
        $deleted = array_key_exists($id, $removednodes);
        $expecteddeleted = !array_key_exists($id, $resultnodes);
        if ($expecteddeleted) {
            return $deleted;
        }
        if ($deleted) {
            return false;
        }
        $text = $node['text'] ?? '';
        if (!answer_matcher::has_blank($text)) {
            return true;
        }
        $studentvalue = $blanks["node:{$id}:0"] ?? '';
        $accepted = $resultnodes[$id]['text'] ?? '';
        return answer_matcher::matches($studentvalue, $accepted);
    }

    /**
     * Grade one default-graph edge.
     *
     * @param array $edge
     * @param array $resultedges result-graph edges indexed by id.
     * @param array $removednodes ids the student deleted, as array keys.
     * @param array $blanks the response's blanks map.
     * @return bool
     */
    protected static function edge_correct(array $edge, array $resultedges, array $removednodes, array $blanks): bool {
        $id = $edge['id'] ?? null;
        if ($id === null) {
            return false;
        }
        $endpointremoved = array_key_exists($edge['from'] ?? null, $removednodes)
                || array_key_exists($edge['to'] ?? null, $removednodes);
        $expecteddeleted = !array_key_exists($id, $resultedges);
        if ($expecteddeleted) {
            return $endpointremoved;
        }
        if ($endpointremoved) {
            return false;
        }
        $text = $edge['label'] ?? '';
        if (!answer_matcher::has_blank($text)) {
            return true;
        }
        $studentvalue = $blanks["edge:{$id}:0"] ?? '';
        $accepted = $resultedges[$id]['label'] ?? '';
        return answer_matcher::matches($studentvalue, $accepted);
    }
}
