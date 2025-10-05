from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import webbrowser
from dataclasses import dataclass
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Optional, Set

if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    DATA_ROOT = Path(sys._MEIPASS)
    PROJECT_ROOT = Path(sys.executable).resolve().parent
else:
    DATA_ROOT = Path(__file__).resolve().parent.parent
    PROJECT_ROOT = DATA_ROOT

APP_DIR = DATA_ROOT / "app"
CONFIG_PATH = DATA_ROOT / "config" / "appsettings.json"
LOG_DIR = PROJECT_ROOT / "logs"
APP_LOG_PATH = LOG_DIR / "app.log"
TEST_DIR = APP_DIR / "assets" / "test"
TEST_REPORT = LOG_DIR / "test-report.json"

LOG_DIR.mkdir(parents=True, exist_ok=True)

LOGGER = logging.getLogger("flowviz")
if not LOGGER.handlers:
    LOGGER.setLevel(logging.INFO)
    LOGGER.propagate = False
    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")

    file_handler = logging.FileHandler(APP_LOG_PATH, encoding="utf-8")
    file_handler.setFormatter(formatter)
    LOGGER.addHandler(file_handler)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    LOGGER.addHandler(console_handler)


class FlowVizHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:  # type: ignore[override]
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;",
        )
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

    def handle_one_request(self) -> None:  # type: ignore[override]
        start = time.perf_counter()
        try:
            super().handle_one_request()
        finally:
            duration_ms = (time.perf_counter() - start) * 1000
            setattr(self, "_flowviz_duration_ms", duration_ms)

    def log_request(self, code: object = "-", size: object = "-") -> None:  # type: ignore[override]
        duration = getattr(self, "_flowviz_duration_ms", None)
        if duration is not None:
            LOGGER.info("Served %s %s %s (%.1f ms)", self.path, code, size, duration)
        else:
            LOGGER.info("Served %s %s %s", self.path, code, size)

    def log_message(self, format: str, *args: object) -> None:  # type: ignore[override]
        LOGGER.debug("HTTP %s", format % args)


@dataclass
class Node:
    id: str
    label: str
    line: int
    group: Optional[str]


@dataclass
class Edge:
    source: str
    target: str
    line: int


class FlowMDError(Exception):
    def __init__(self, message: str, line: Optional[int] = None) -> None:
        if line is not None:
            message = f"{message} (line {line})"
        super().__init__(message)
        self.line = line


class FlowMDParserPy:
    def __init__(self, max_nodes: int = 1000, preferred_max: int = 300) -> None:
        self.max_nodes = max_nodes
        self.preferred_max = preferred_max

    def parse(self, text: str) -> Dict[str, object]:
        lines = text.splitlines()
        orientation = "TB"
        orientation_parsed = False
        nodes: Dict[str, Node] = {}
        edges: List[Edge] = []
        groups: Dict[str, Set[str]] = {}
        current_group: Optional[str] = None
        warnings: List[Dict[str, object]] = []

        for index, raw_line in enumerate(lines):
            line = raw_line.strip()
            if not line or line.startswith("%%"):
                continue
            line_no = index + 1
            if not orientation_parsed:
                parts = line.split()
                if not parts or parts[0] not in {"graph", "flowchart"}:
                    raise FlowMDError("FlowMD must start with graph/flowchart declaration", line_no)
                orientation = parts[1].upper() if len(parts) > 1 else "TB"
                orientation_parsed = True
                continue

            if line.lower().startswith("subgraph"):
                name = line.split(None, 1)[1].strip() if len(line.split(None, 1)) == 2 else ""
                if not name:
                    warnings.append({"line": line_no, "message": "Empty subgraph name"})
                    current_group = None
                else:
                    groups.setdefault(name, set())
                    current_group = name
                continue

            if line.lower() == "end":
                current_group = None
                continue

            edge_parts = self._parse_edge(line)
            if edge_parts:
                lhs, lhs_label, rhs, rhs_label = edge_parts
                left_node = self._ensure_node(lhs, nodes, line_no, current_group)
                right_node = self._ensure_node(rhs, nodes, line_no, current_group)
                if lhs_label:
                    left_node.label = lhs_label
                if rhs_label:
                    right_node.label = rhs_label
                edges.append(Edge(lhs, rhs, line_no))
                continue

            node_parts = self._parse_node(line)
            if node_parts:
                node_id, label = node_parts
                node = self._ensure_node(node_id, nodes, line_no, current_group)
                if label:
                    node.label = label
                continue

            warnings.append({"line": line_no, "message": "Unrecognised statement"})

        if len(nodes) > self.max_nodes:
            raise FlowMDError(f"Node count {len(nodes)} exceeds hard limit {self.max_nodes}")

        cycles = self._detect_cycles(nodes, edges)
        for cycle in cycles:
            warnings.append({
                "message": f"Cycle detected: {' -> '.join(cycle)}",
                "nodes": cycle,
            })

        meta = {
            "orientation": orientation,
            "preferredMaxNodes": self.preferred_max,
            "maxNodes": self.max_nodes,
            "warnings": warnings,
            "groups": {name: sorted(group) for name, group in groups.items()},
            "degrade": len(nodes) > self.preferred_max,
            "overflow": False,
        }

        return {
            "nodes": [node.__dict__ for node in nodes.values()],
            "edges": [edge.__dict__ for edge in edges],
            "meta": meta,
        }

    @staticmethod
    def _parse_edge(line: str) -> Optional[tuple[str, Optional[str], str, Optional[str]]]:
        separators = ["-->", "--", "==>", "==", "-.->", "===>"]
        for sep in separators:
            if sep in line:
                lhs, rhs = line.split(sep, 1)
                left_id, left_label = FlowMDParserPy._extract_node(lhs)
                right_id, right_label = FlowMDParserPy._extract_node(rhs)
                return left_id, left_label, right_id, right_label
        return None

    @staticmethod
    def _parse_node(line: str) -> Optional[tuple[str, Optional[str]]]:
        node_id, label = FlowMDParserPy._extract_node(line)
        if node_id:
            return node_id, label
        return None

    @staticmethod
    def _extract_node(token: str) -> tuple[str, Optional[str]]:
        token = token.strip()
        label: Optional[str] = None
        if "[" in token and "]" in token:
            node_id, rest = token.split("[", 1)
            label = rest.rsplit("]", 1)[0].strip()
            token = node_id
        return token.strip(), label

    @staticmethod
    def _ensure_node(
        node_id: str,
        nodes: Dict[str, Node],
        line_no: int,
        group: Optional[str],
    ) -> Node:
        node = nodes.get(node_id)
        if node is None:
            node = Node(id=node_id, label=node_id, line=line_no, group=group)
            nodes[node_id] = node
        else:
            node.group = node.group or group
        return node

    @staticmethod
    def _detect_cycles(nodes: Dict[str, Node], edges: List[Edge]) -> List[List[str]]:
        adjacency: Dict[str, Set[str]] = {node_id: set() for node_id in nodes}
        for edge in edges:
            adjacency.setdefault(edge.source, set()).add(edge.target)

        visited: Set[str] = set()
        stack: Set[str] = set()
        path: List[str] = []
        seen: Set[str] = set()
        cycles: List[List[str]] = []

        def dfs(node_id: str) -> None:
            visited.add(node_id)
            stack.add(node_id)
            path.append(node_id)
            for successor in adjacency.get(node_id, set()):
                if successor not in visited:
                    dfs(successor)
                elif successor in stack:
                    if successor in path:
                        index = path.index(successor)
                        cycle_path = path[index:] + [successor]
                        key = "->".join(cycle_path)
                        if key not in seen:
                            seen.add(key)
                            cycles.append(cycle_path)
            stack.remove(node_id)
            path.pop()

        for node_id in adjacency:
            if node_id not in visited:
                dfs(node_id)

        return cycles


class HighlightEnginePy:
    def __init__(self, graph: Dict[str, object]) -> None:
        adjacency: Dict[str, Set[str]] = {}
        for node in graph["nodes"]:
            adjacency.setdefault(node["id"], set())
        for edge in graph["edges"]:
            adjacency.setdefault(edge["source"], set()).add(edge["target"])
        self.adjacency = adjacency

    def downstream(self, node_id: str) -> Dict[str, object]:
        visited: Set[str] = set()
        edge_ids: Set[str] = set()
        queue: List[str] = [node_id]
        start = time.perf_counter()
        while queue:
            current = queue.pop(0)
            if current in visited:
                continue
            visited.add(current)
            for successor in self.adjacency.get(current, set()):
                edge_ids.add(f"{current}->{successor}")
                if successor not in visited:
                    queue.append(successor)
        duration = (time.perf_counter() - start) * 1000
        return {"nodes": sorted(visited), "edges": sorted(edge_ids), "durationMs": duration}


def run_selftest() -> Dict[str, object]:
    parser = FlowMDParserPy()
    results: List[Dict[str, object]] = []
    passed = 0
    test_index = json.loads((TEST_DIR / "testcases" / "index.json").read_text(encoding="utf-8"))
    LOGGER.info("Starting selftest with %s cases", len(test_index))
    for file_name in test_index:
        testcase = json.loads((TEST_DIR / "testcases" / file_name).read_text(encoding="utf-8"))
        outcome = {"id": testcase["id"], "description": testcase["description"], "success": False}
        try:
            graph = parser.parse(testcase["input"])
            if testcase["type"] == "parser":
                expected = testcase["expected"]
                success = (
                    len(graph["nodes"]) == expected["nodeCount"]
                    and len(graph["edges"]) == expected["edgeCount"]
                    and graph["meta"]["orientation"] == expected["orientation"]
                )
                warnings_contains = expected.get("warningsContains", [])
                if success and warnings_contains:
                    messages = [warning.get("message", "") for warning in graph["meta"].get("warnings", [])]
                    for expected_warning in warnings_contains:
                        if not any(expected_warning in message for message in messages):
                            success = False
                            outcome["message"] = f"Expected warning '{expected_warning}' not found"
                            break
                if not success and "message" not in outcome:
                    outcome["message"] = "Parser expectations failed"
                else:
                    outcome["success"] = True
            elif testcase["type"] == "highlight":
                engine = HighlightEnginePy(graph)
                result = engine.downstream(testcase["target"])
                expected_nodes = set(testcase["expected"]["highlightedNodes"])
                if expected_nodes.issubset(set(result["nodes"])) and len(result["edges"]) == testcase["expected"]["edgeCount"]:
                    outcome["success"] = True
                else:
                    outcome["message"] = "Highlight expectations failed"
            elif testcase["type"] == "csv":
                expected_rows = testcase["expected"]["rows"]
                if len(graph["edges"]) + 1 == expected_rows:
                    outcome["success"] = True
                else:
                    outcome["message"] = "CSV row expectation failed"
            elif testcase["type"] == "search":
                query = testcase["query"]
                expected_id = testcase["expected"]["id"]
                match = next(
                    (
                        node
                        for node in graph["nodes"]
                        if node["id"] == query or query in str(node.get("label", ""))
                    ),
                    None,
                )
                if match and match["id"] == expected_id:
                    outcome["success"] = True
                else:
                    outcome["message"] = "Search expectation failed"
            else:
                outcome["message"] = "Unknown testcase type"
        except FlowMDError as error:
            outcome["message"] = str(error)
        if outcome["success"]:
            passed += 1
        results.append(outcome)

    report = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "passed": passed,
        "total": len(results),
        "results": results,
    }
    LOG_DIR.mkdir(exist_ok=True)
    TEST_REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    LOGGER.info("Selftest %s/%s", passed, len(results))
    return report


def load_config() -> Dict[str, object]:
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return {"port": 0}


def run_server(port: int) -> None:
    os.chdir(APP_DIR)
    server = ThreadingHTTPServer(("127.0.0.1", port), FlowVizHandler)
    LOGGER.info("FlowViz server started on http://127.0.0.1:%s/viewer.html", server.server_port)
    webbrowser.open(f"http://127.0.0.1:{server.server_port}/viewer.html")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("Shutting down...")
    finally:
        server.server_close()


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="FlowViz launcher")
    parser.add_argument("--selftest", action="store_true", help="Run self tests")
    args = parser.parse_args(argv)

    if args.selftest:
        run_selftest()
        print(TEST_REPORT.read_text(encoding="utf-8"))
        return 0

    config = load_config()
    port = int(config.get("port", 0))
    if port <= 0:
        port = 0
    run_server(port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
