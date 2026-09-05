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
 * Not every node/edge id in the default graph is a gradable item - only
 * those falling into one of three categories are (see evaluate()'s two main
 * loops): a blank to fill in, something the student is expected to delete,
 * or (further below) something new the student is expected to add. A node/edge
 * present in the result graph under the same id with no blank in its text is
 * purely scaffolding - nothing for the student to get right or wrong beyond
 * not deleting it - so it is skipped entirely: not counted in $total, not
 * counted in $correct, and (deliberately) not penalised even if the student
 * deletes it. This keeps the score reflecting only the parts of the graph the
 * teacher actually authored an answer for, rather than padding it with a
 * "free" correct point per scaffolding node - at the cost that, if
 * $allowdeletenodes is on, deleting scaffolding is not caught as wrong.
 *
 * - absent from the result graph  => the student was expected to delete it
 *   (checked via the response's removednodes list; for an edge, since a
 *   locked edge can only be removed by deleting one of its endpoint nodes,
 *   "deleted" means either endpoint id is in removednodes - there is
 *   currently no way for a student to delete just a locked edge on its own).
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
 * A node id in the result graph with NO counterpart in the default graph at
 * all is a different kind of item: the student is expected to *create* it
 * (only possible when $allowaddnodes is true, since only then can a student
 * add nodes at all). Since a student-created node's id is generated at
 * creation time and can never match the teacher's id for it, matching is by
 * content instead: find an "anchor" - a result-graph edge connecting this
 * node to a node id that DOES exist in the default graph - then check
 * whether the student added any new node, connected by an edge to that same
 * anchor, whose text satisfies the expected node's accepted-answer field.
 * If no such anchor exists (e.g. the new node is only connected to another
 * new node - a chain), the item is skipped entirely (excluded from both
 * $total and $correct) rather than counted wrong, since no student could
 * ever satisfy it; same if $allowaddnodes is false. A genuinely new EDGE
 * between two nodes that both already exist in the default graph is not
 * handled at all - there is no student-facing way to draw a connection
 * between two already-existing nodes (see editor.js, createEdge is only
 * ever invoked together with a new node, or from hydrate()).
 *
 * Multiple answer graphs: a question can have more than one answer graph
 * (the primary $resultgraphjson field, plus any number of alternates stored
 * in qtype_graph_altanswers - see edit_graph_form.php's "Alternate answer
 * graphs" section and amd/src/editor.js's initAltAnswers()). Every public
 * method here accepts the alternates as $altresultgraphjsons and grades the
 * response against each candidate independently via evaluate(), keeping
 * whichever gives the best fraction (evaluate_best()) - so a question with
 * several acceptable final graphs can express each one as its own complete
 * answer graph, rather than trying to encode every alternative into one set
 * of accepted answers per blank.
 *
 * @package    qtype_graph
 * @copyright  2026 Rutas Digitales
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class grading {
    /** Gradable item the student got right. */
    const ITEM_CORRECT = 'correct';
    /** Wrong because the student's value for a {{T_INPUT}} blank does not match. */
    const ITEM_WRONG_BLANK = 'wrongblank';
    /** Wrong because the student deleted something the result graph still contains. */
    const ITEM_WRONG_REMOVED = 'wrongremoved';
    /** Wrong in a way clearing the response cannot undo (e.g. not deleted when it should be). */
    const ITEM_WRONG = 'wrong';

    /**
     * Grade a student's response against the teacher's graphs.
     *
     * @param string $graphjson the default (student-visible) graph.
     * @param string $resultgraphjson the primary expected/correct result graph.
     * @param array $response the question's response array (has 'nodesjson').
     * @param bool $allowaddnodes whether this question allows students to add new nodes.
     * @param string[] $altresultgraphjsons extra alternate answer graphs (see evaluate_best()).
     * @return float fraction correct, 0.0 to 1.0.
     */
    public static function grade(string $graphjson, string $resultgraphjson, array $response,
            bool $allowaddnodes = true, array $altresultgraphjsons = []): float {
        list($correct, $total) = self::count_parts_right($graphjson, $resultgraphjson, $response, $allowaddnodes,
                $altresultgraphjsons);
        return $total > 0 ? $correct / $total : 0.0;
    }

    /**
     * How many of this question's gradable items the student got right, out of
     * how many. Used by the "Show the number of correct responses" hint option
     * (see qtype_graph_question::get_num_parts_right()); grade() is just this,
     * expressed as a fraction.
     *
     * @param string $graphjson the default (student-visible) graph.
     * @param string $resultgraphjson the primary expected/correct result graph.
     * @param array $response the question's response array (has 'nodesjson').
     * @param bool $allowaddnodes whether this question allows students to add new nodes.
     * @param string[] $altresultgraphjsons extra alternate answer graphs (see evaluate_best()).
     * @return array [number of items correct, total number of items].
     */
    public static function count_parts_right(string $graphjson, string $resultgraphjson, array $response,
            bool $allowaddnodes = true, array $altresultgraphjsons = []): array {
        $report = self::evaluate_best($graphjson, $resultgraphjson, $altresultgraphjsons, $response, $allowaddnodes);
        return [$report['correct'], $report['total']];
    }

    /**
     * Per-item correctness for showing feedback markers on the attempt canvas
     * (see amd/src/editor.js's initAttempt()/markFeedback()). Deliberately
     * scoped to just the items that have a visible "answer" to get right -
     * {{T_INPUT}} blanks and anchored new-node creations - never plain
     * structural nodes/edges, which have nothing to compare beyond
     * deleted-or-not (see this plugin's CLAUDE.md, "Automatic grading").
     *
     * @param string $graphjson the default (student-visible) graph.
     * @param string $resultgraphjson the primary expected/correct result graph.
     * @param array $response the question's response array (has 'nodesjson').
     * @param bool $allowaddnodes whether this question allows students to add new nodes.
     * @param string[] $altresultgraphjsons extra alternate answer graphs (see evaluate_best()).
     * @return array {nodes: {id: bool}, edges: {id: bool}, newnodes: {id: bool}} - true = correct.
     *      newnodes is keyed by the student's own added-node id, not a default-graph id.
     */
    public static function feedback_breakdown(string $graphjson, string $resultgraphjson, array $response,
            bool $allowaddnodes = true, array $altresultgraphjsons = []): array {
        $report = self::evaluate_best($graphjson, $resultgraphjson, $altresultgraphjsons, $response, $allowaddnodes);
        return [
            'nodes' => $report['blanknodes'],
            'edges' => $report['blankedges'],
            'newnodes' => $report['newnodes'],
        ];
    }

    /**
     * Reset the parts of a response the student got wrong, keeping the rest,
     * for the "Clear incorrect responses" hint option. Wrong blank values are
     * emptied, nodes the student deleted but should have kept are restored,
     * and added nodes that answer an expected new node incorrectly are removed.
     *
     * An item that is wrong in a way the student cannot fix by re-answering -
     * a node the result graph expects them to delete and they didn't - is left
     * alone: there is nothing in the response to clear.
     *
     * @param string $graphjson the default (student-visible) graph.
     * @param string $resultgraphjson the primary expected/correct result graph.
     * @param array $response the question's response array (has 'nodesjson').
     * @param bool $allowaddnodes whether this question allows students to add new nodes.
     * @param string[] $altresultgraphjsons extra alternate answer graphs (see evaluate_best()).
     * @return array the response with its wrong parts reset.
     */
    public static function clear_wrong(string $graphjson, string $resultgraphjson, array $response,
            bool $allowaddnodes = true, array $altresultgraphjsons = []): array {
        $data = json_decode($response['nodesjson'] ?? '', true);
        if (!is_array($data)) {
            return $response;
        }
        // Clear towards whichever answer graph the response is already closest to -
        // the same one feedback/grading are using (see evaluate_best()) - rather than
        // always the primary, so alternates behave like a real accepted answer.
        $report = self::evaluate_best($graphjson, $resultgraphjson, $altresultgraphjsons, $response, $allowaddnodes);

        if (is_array($data['blanks'] ?? null)) {
            foreach (array_keys($report['wrongblanks']) as $key) {
                if (array_key_exists($key, $data['blanks'])) {
                    $data['blanks'][$key] = '';
                }
            }
        }

        if (is_array($data['removednodes'] ?? null) && $report['wrongremovals']) {
            $kept = [];
            foreach ($data['removednodes'] as $id) {
                if (!isset($report['wrongremovals'][$id])) {
                    $kept[] = $id;
                }
            }
            $data['removednodes'] = $kept;
        }

        $studentnodes = is_array($data['nodes'] ?? null) ? $data['nodes'] : [];
        $studentedges = is_array($data['edges'] ?? null) ? $data['edges'] : [];
        $todelete = [];
        foreach ($studentnodes as $node) {
            if (self::added_node_is_wrong($node, $studentedges, $report['expectedbyanchor'])) {
                $todelete[$node['id']] = true;
            }
        }
        if ($todelete) {
            $data['nodes'] = self::reject_nodes($studentnodes, $todelete);
            $data['edges'] = self::reject_edges($studentedges, $todelete);
        }

        $response['nodesjson'] = json_encode($data);
        return $response;
    }

    /**
     * Grade a response against the primary answer graph and every alternate,
     * and return whichever evaluate() report scores highest by fraction
     * (correct/total) - see this plugin's CLAUDE.md, "Multiple answer graphs".
     * All four public methods above are built on this, so grading, feedback
     * markers, and "Clear incorrect responses" all agree on which answer
     * graph a given response is being judged against.
     *
     * A blank/whitespace-only candidate (the common case: no alternates
     * authored, or the primary itself left empty) is skipped rather than
     * evaluated - evaluate() would score it 0/0, which must never win over a
     * real candidate purely because 0/0 is not literally lower than another
     * candidate's fraction.
     *
     * @param string $graphjson the default (student-visible) graph.
     * @param string $resultgraphjson the primary expected/correct result graph.
     * @param string[] $altresultgraphjsons extra alternate answer graphs, same shape as $resultgraphjson.
     * @param array $response the question's response array (has 'nodesjson').
     * @param bool $allowaddnodes whether this question allows students to add new nodes.
     * @return array an evaluate() report - see its own docblock for the shape - or empty_report()
     *      if every candidate was blank.
     */
    protected static function evaluate_best(string $graphjson, string $resultgraphjson,
            array $altresultgraphjsons, array $response, bool $allowaddnodes): array {
        $best = null;
        $bestfraction = -1.0;
        foreach (array_merge([$resultgraphjson], $altresultgraphjsons) as $candidate) {
            if (trim((string) $candidate) === '') {
                continue;
            }
            $report = self::evaluate($graphjson, (string) $candidate, $response, $allowaddnodes);
            $fraction = $report['total'] > 0 ? $report['correct'] / $report['total'] : 0.0;
            if ($fraction > $bestfraction) {
                $bestfraction = $fraction;
                $best = $report;
            }
        }
        return $best ?? self::empty_report();
    }

    /**
     * The evaluate() report shape for "no answer graph could be evaluated" -
     * every candidate passed to evaluate_best() was blank.
     *
     * @return array
     */
    protected static function empty_report(): array {
        return [
            'total' => 0,
            'correct' => 0,
            'wrongblanks' => [],
            'wrongremovals' => [],
            'expectedbyanchor' => [],
            'blanknodes' => [],
            'blankedges' => [],
            'newnodes' => [],
        ];
    }

    /**
     * Walk every gradable item once, counting right/wrong and recording enough
     * detail for clear_wrong() to undo the wrong ones. Single source of truth
     * for what "correct" means against ONE candidate answer graph;
     * evaluate_best() calls this once per candidate (primary + alternates)
     * and keeps whichever scores highest.
     *
     * @param string $graphjson the default (student-visible) graph.
     * @param string $resultgraphjson the expected/correct result graph.
     * @param array $response the question's response array (has 'nodesjson').
     * @param bool $allowaddnodes whether this question allows students to add new nodes.
     * @return array with keys total, correct, wrongblanks (blank key => true),
     *      wrongremovals (node id => true), expectedbyanchor
     *      (default-graph node id => list of accepted texts for new nodes hung off it),
     *      blanknodes/blankedges (default-graph id => bool, only for {{T_INPUT}} items)
     *      and newnodes (student-added node id => bool, only for anchored candidates).
     */
    protected static function evaluate(string $graphjson, string $resultgraphjson, array $response,
            bool $allowaddnodes): array {
        $report = [
            'total' => 0,
            'correct' => 0,
            'wrongblanks' => [],
            'wrongremovals' => [],
            'expectedbyanchor' => [],
            'blanknodes' => [],
            'blankedges' => [],
            'newnodes' => [],
        ];

        $default = json_decode($graphjson, true);
        if (!is_array($default) || empty($default['nodes'])) {
            return $report;
        }
        $result = json_decode($resultgraphjson, true);
        $result = is_array($result) ? $result : [];
        $defaultnodes = self::index_by_id($default['nodes']);
        $resultnodes = self::index_by_id($result['nodes'] ?? []);
        $resultedges = self::index_by_id($result['edges'] ?? []);

        $responsedata = json_decode($response['nodesjson'] ?? '', true);
        $removednodes = [];
        $blanks = [];
        $studentnodes = [];
        $studentedges = [];
        if (is_array($responsedata)) {
            $removedlist = is_array($responsedata['removednodes'] ?? null) ? $responsedata['removednodes'] : [];
            $removednodes = array_flip($removedlist);
            $blanks = is_array($responsedata['blanks'] ?? null) ? $responsedata['blanks'] : [];
            $studentnodes = is_array($responsedata['nodes'] ?? null) ? $responsedata['nodes'] : [];
            $studentedges = is_array($responsedata['edges'] ?? null) ? $responsedata['edges'] : [];
        }
        $studentnodesbyid = self::index_by_id($studentnodes);

        foreach ($default['nodes'] as $node) {
            $id = $node['id'] ?? null;
            $hasblank = answer_matcher::has_blank($node['text'] ?? '');
            $expecteddeleted = $id !== null && !array_key_exists($id, $resultnodes);
            if ($id !== null && !$expecteddeleted && !$hasblank) {
                // Present under the same id, no blank: pure scaffolding, not a gradable item.
                continue;
            }
            $report['total']++;
            $status = self::node_status($node, $resultnodes, $removednodes, $blanks);
            self::record($report, $status, 'node:' . ($id ?? '') . ':0', $id);
            if ($id !== null && $hasblank) {
                $report['blanknodes'][$id] = ($status === self::ITEM_CORRECT);
            }
        }
        foreach (($default['edges'] ?? []) as $edge) {
            $id = $edge['id'] ?? null;
            $hasblank = answer_matcher::has_blank($edge['label'] ?? '');
            $expecteddeleted = $id !== null && !array_key_exists($id, $resultedges);
            if ($id !== null && !$expecteddeleted && !$hasblank) {
                // Present under the same id, no blank: pure scaffolding, not a gradable item.
                continue;
            }
            $report['total']++;
            $status = self::edge_status($edge, $resultedges, $removednodes, $blanks);
            // An edge is only ever "removed" as a side effect of deleting one of its
            // endpoint nodes, so restoring it is that node's entry to undo, not the edge's.
            self::record($report, $status, 'edge:' . ($id ?? '') . ':0', null);
            if ($id !== null && $hasblank) {
                $report['blankedges'][$id] = ($status === self::ITEM_CORRECT);
            }
        }

        if ($allowaddnodes) {
            foreach (($result['nodes'] ?? []) as $resultnode) {
                $id = $resultnode['id'] ?? null;
                if ($id === null || array_key_exists($id, $defaultnodes)) {
                    continue;
                }
                $anchorid = self::find_anchor($id, $result['edges'] ?? [], $defaultnodes);
                if ($anchorid === null) {
                    continue;
                }
                $expectedtext = $resultnode['text'] ?? '';
                $report['expectedbyanchor'][$anchorid][] = $expectedtext;
                $report['total']++;
                if (self::new_node_created($anchorid, $expectedtext, $studentedges, $studentnodesbyid)) {
                    $report['correct']++;
                }
            }
            self::mark_new_nodes($report, $studentedges, $studentnodesbyid);
        }

        return $report;
    }

    /**
     * Identify which of the student's own added nodes are an attempt at one of
     * the expected new-node items ($report['expectedbyanchor']) and record
     * whether each one's text actually satisfies it, keyed by the student's
     * own node id (see feedback_breakdown() above). Run once expectedbyanchor
     * is fully built, so a candidate is checked against every expected text at
     * its anchor, not just the one that happened to be evaluated first.
     *
     * @param array $report the report being built, modified in place.
     * @param array $studentedges the response's student-added edges.
     * @param array $studentnodesbyid the response's student-added nodes, indexed by id.
     */
    protected static function mark_new_nodes(array &$report, array $studentedges, array $studentnodesbyid): void {
        foreach ($studentedges as $edge) {
            $from = $edge['from'] ?? null;
            $to = $edge['to'] ?? null;
            foreach ([[$from, $to], [$to, $from]] as [$anchor, $candidateid]) {
                if ($anchor === null || $candidateid === null || $anchor === $candidateid) {
                    continue;
                }
                if (!isset($report['expectedbyanchor'][$anchor]) || !array_key_exists($candidateid, $studentnodesbyid)) {
                    continue;
                }
                $text = $studentnodesbyid[$candidateid]['text'] ?? '';
                $matches = false;
                foreach ($report['expectedbyanchor'][$anchor] as $expectedtext) {
                    if (answer_matcher::matches($text, $expectedtext)) {
                        $matches = true;
                        break;
                    }
                }
                $report['newnodes'][$candidateid] = $matches;
            }
        }
    }

    /**
     * Fold one item's status into the running report.
     *
     * @param array $report the report being built, modified in place.
     * @param string $status one of the ITEM_* constants.
     * @param string $blankkey the response's blanks-map key for this item.
     * @param string|null $nodeid the node id to restore if the student wrongly deleted it.
     */
    protected static function record(array &$report, string $status, string $blankkey, ?string $nodeid): void {
        if ($status === self::ITEM_CORRECT) {
            $report['correct']++;
        } else if ($status === self::ITEM_WRONG_BLANK) {
            $report['wrongblanks'][$blankkey] = true;
        } else if ($status === self::ITEM_WRONG_REMOVED && $nodeid !== null) {
            $report['wrongremovals'][$nodeid] = true;
        }
    }

    /**
     * Should this student-added node be removed by "Clear incorrect responses"?
     *
     * Only nodes hung off an anchor the result graph expects a new node on are
     * considered: a node the student added somewhere the result graph says
     * nothing about earns and costs no marks, so it is not "wrong" and is kept.
     *
     * @param array $node a student-added node.
     * @param array $studentedges the response's student-added edges.
     * @param array $expectedbyanchor anchor node id => list of accepted texts.
     * @return bool
     */
    protected static function added_node_is_wrong(array $node, array $studentedges, array $expectedbyanchor): bool {
        $id = $node['id'] ?? null;
        if ($id === null) {
            return false;
        }
        $answersanexpectednode = false;
        foreach ($studentedges as $edge) {
            $from = $edge['from'] ?? null;
            $to = $edge['to'] ?? null;
            if ($from === $id) {
                $anchor = $to;
            } else if ($to === $id) {
                $anchor = $from;
            } else {
                continue;
            }
            if ($anchor === null || !isset($expectedbyanchor[$anchor])) {
                continue;
            }
            $answersanexpectednode = true;
            foreach ($expectedbyanchor[$anchor] as $expectedtext) {
                if (answer_matcher::matches($node['text'] ?? '', $expectedtext)) {
                    return false;
                }
            }
        }
        return $answersanexpectednode;
    }

    /**
     * Drop the given nodes from a student-added node list.
     *
     * @param array $nodes
     * @param array $todelete node id => true.
     * @return array
     */
    protected static function reject_nodes(array $nodes, array $todelete): array {
        $kept = [];
        foreach ($nodes as $node) {
            if (!isset($todelete[$node['id'] ?? ''])) {
                $kept[] = $node;
            }
        }
        return $kept;
    }

    /**
     * Drop any edge touching one of the given nodes from a student-added edge list.
     *
     * @param array $edges
     * @param array $todelete node id => true.
     * @return array
     */
    protected static function reject_edges(array $edges, array $todelete): array {
        $kept = [];
        foreach ($edges as $edge) {
            if (!isset($todelete[$edge['from'] ?? '']) && !isset($todelete[$edge['to'] ?? ''])) {
                $kept[] = $edge;
            }
        }
        return $kept;
    }

    /**
     * Find the default-graph node a result-graph-only node is anchored to,
     * i.e. the other endpoint of a result-graph edge connecting them.
     *
     * @param string $nodeid the result-only node's id.
     * @param array $resultedges the result graph's raw edges list.
     * @param array $defaultnodes default-graph nodes indexed by id.
     * @return string|null the anchor's id, or null if not found.
     */
    protected static function find_anchor(string $nodeid, array $resultedges, array $defaultnodes): ?string {
        foreach ($resultedges as $edge) {
            $from = $edge['from'] ?? null;
            $to = $edge['to'] ?? null;
            if ($from === $nodeid && $to !== null && array_key_exists($to, $defaultnodes)) {
                return $to;
            }
            if ($to === $nodeid && $from !== null && array_key_exists($from, $defaultnodes)) {
                return $from;
            }
        }
        return null;
    }

    /**
     * Did the student add a new node, connected to $anchorid, whose text
     * satisfies the expected answer?
     *
     * @param string $anchorid
     * @param string $expectedtext the result-graph node's accepted-answer field.
     * @param array $studentedges the response's student-added edges.
     * @param array $studentnodesbyid the response's student-added nodes, indexed by id.
     * @return bool
     */
    protected static function new_node_created(string $anchorid, string $expectedtext, array $studentedges,
            array $studentnodesbyid): bool {
        foreach ($studentedges as $edge) {
            $from = $edge['from'] ?? null;
            $to = $edge['to'] ?? null;
            if ($from === $anchorid) {
                $candidateid = $to;
            } else if ($to === $anchorid) {
                $candidateid = $from;
            } else {
                continue;
            }
            if (!array_key_exists($candidateid, $studentnodesbyid)) {
                continue;
            }
            $candidatetext = $studentnodesbyid[$candidateid]['text'] ?? '';
            if (answer_matcher::matches($candidatetext, $expectedtext)) {
                return true;
            }
        }
        return false;
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
     * @return string one of the ITEM_* constants.
     */
    protected static function node_status(array $node, array $resultnodes, array $removednodes,
            array $blanks): string {
        $id = $node['id'] ?? null;
        if ($id === null) {
            return self::ITEM_WRONG;
        }
        $deleted = array_key_exists($id, $removednodes);
        $expecteddeleted = !array_key_exists($id, $resultnodes);
        if ($expecteddeleted) {
            return $deleted ? self::ITEM_CORRECT : self::ITEM_WRONG;
        }
        if ($deleted) {
            return self::ITEM_WRONG_REMOVED;
        }
        $text = $node['text'] ?? '';
        if (!answer_matcher::has_blank($text)) {
            return self::ITEM_CORRECT;
        }
        $studentvalue = $blanks["node:{$id}:0"] ?? '';
        $accepted = $resultnodes[$id]['text'] ?? '';
        return answer_matcher::matches($studentvalue, $accepted) ? self::ITEM_CORRECT : self::ITEM_WRONG_BLANK;
    }

    /**
     * Grade one default-graph edge.
     *
     * @param array $edge
     * @param array $resultedges result-graph edges indexed by id.
     * @param array $removednodes ids the student deleted, as array keys.
     * @param array $blanks the response's blanks map.
     * @return string one of the ITEM_* constants.
     */
    protected static function edge_status(array $edge, array $resultedges, array $removednodes,
            array $blanks): string {
        $id = $edge['id'] ?? null;
        if ($id === null) {
            return self::ITEM_WRONG;
        }
        $endpointremoved = array_key_exists($edge['from'] ?? null, $removednodes)
                || array_key_exists($edge['to'] ?? null, $removednodes);
        $expecteddeleted = !array_key_exists($id, $resultedges);
        if ($expecteddeleted) {
            return $endpointremoved ? self::ITEM_CORRECT : self::ITEM_WRONG;
        }
        if ($endpointremoved) {
            return self::ITEM_WRONG_REMOVED;
        }
        $text = $edge['label'] ?? '';
        if (!answer_matcher::has_blank($text)) {
            return self::ITEM_CORRECT;
        }
        $studentvalue = $blanks["edge:{$id}:0"] ?? '';
        $accepted = $resultedges[$id]['label'] ?? '';
        return answer_matcher::matches($studentvalue, $accepted) ? self::ITEM_CORRECT : self::ITEM_WRONG_BLANK;
    }
}
