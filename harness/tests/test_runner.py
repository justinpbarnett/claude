import json

from harness.runner import _parse_claude_output


def test_extract_cost_from_total_cost_usd():
    data = json.dumps({"total_cost_usd": 0.045, "result": "done"})
    assert _parse_claude_output(data).cost == 0.045


def test_extract_cost_from_top_level_cost_usd():
    data = json.dumps({"cost_usd": 0.1, "result": "done"})
    assert _parse_claude_output(data).cost == 0.1


def test_extract_cost_from_usage():
    data = json.dumps({"usage": {"cost_usd": 0.042}})
    assert _parse_claude_output(data).cost == 0.042


def test_extract_cost_missing():
    assert _parse_claude_output("not json").cost == 0.0
    assert _parse_claude_output("{}").cost == 0.0


def test_extract_cost_real_claude_output():
    data = json.dumps({
        "type": "result",
        "result": "Done",
        "total_cost_usd": 0.023721,
        "usage": {"input_tokens": 5, "output_tokens": 286},
    })
    assert _parse_claude_output(data).cost == 0.023721


def test_extract_summary():
    data = json.dumps({"result": "Added the health endpoint"})
    assert _parse_claude_output(data).summary == "Added the health endpoint"


def test_extract_summary_fallback():
    assert _parse_claude_output("raw text output").summary == "raw text output"


def test_extract_summary_truncates():
    data = json.dumps({"result": "x" * 1000})
    assert len(_parse_claude_output(data).summary) == 500


def test_extract_permission_denials_present():
    data = json.dumps({
        "result": "Could not write",
        "permission_denials": [
            {"tool_name": "Write", "tool_use_id": "abc"},
            {"tool_name": "Bash", "tool_use_id": "def"},
        ],
    })
    assert _parse_claude_output(data).permission_denials == ["Write", "Bash"]


def test_extract_permission_denials_empty():
    data = json.dumps({"result": "Done", "permission_denials": []})
    assert _parse_claude_output(data).permission_denials == []


def test_extract_permission_denials_missing():
    assert _parse_claude_output("{}").permission_denials == []
    assert _parse_claude_output("not json").permission_denials == []
