import shutil
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from downlevel_js import code_without_strings_and_comments, downlevel_wechat_js

ROOT = Path(__file__).resolve().parents[3]
GLUE = ROOT / "bin" / "godot.wechat.template_release.wasm32.nothreads.js"


def _eval(expression: str):
    source = downlevel_wechat_js(expression)
    if "?." in source or "??" in source:
        raise AssertionError(source)
    node = shutil.which("node")
    if node is None:
        raise unittest.SkipTest("node is not on PATH")
    script = "var value = (" + source + "); "
    script += "console.log(value === undefined ? 'undefined' : JSON.stringify(value));"
    completed = subprocess.run(
        [node, "-e", script],
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise AssertionError(completed.stderr + "\n" + source)
    return completed.stdout.strip()


class WeChatJsDownlevelTest(unittest.TestCase):
    def test_optional_member_reads_through_a_present_object_and_skips_null(self):
        self.assertEqual(_eval("({ currentScript: { src: 'game.js' } }).currentScript?.src"), '"game.js"')
        self.assertEqual(_eval("({ currentScript: null }).currentScript?.src"), "undefined")
        self.assertEqual(_eval("(null)?.src"), "undefined")

    def test_optional_call_keeps_the_object_of_a_computed_member(self):
        present = (
            "(function () {"
            " var Module = { monitorRunDependencies: function (value) { return value + 1; } };"
            " return Module['monitorRunDependencies']?.(2);"
            " }())"
        )
        self.assertEqual(_eval(present), "3")
        missing = (
            "(function () {"
            " var Module = {}; var ran = false;"
            " Module['monitorRunDependencies']?.(ran = true);"
            " return ran;"
            " }())"
        )
        self.assertEqual(_eval(missing), "false")

    def test_optional_call_does_not_invoke_a_missing_function(self):
        self.assertEqual(
            _eval("(function () { var calls = 0; var fn = null; fn?.(calls += 1); return calls; }())"),
            "0",
        )
        self.assertEqual(
            _eval("(function () { var fn = function (value) { return value + 1; }; return fn?.(2); }())"),
            "3",
        )

    def test_optional_chain_does_not_read_properties_past_a_missing_base(self):
        self.assertEqual(_eval("(null)?.stream_ops.setattr"), "undefined")
        self.assertEqual(
            _eval("({ stream_ops: { setattr: 7 } })?.stream_ops.setattr"),
            "7",
        )

    def test_chained_optional_members_stop_when_an_intermediate_is_missing(self):
        self.assertEqual(_eval("({ opts: { autoPersist: true } })?.opts?.autoPersist"), "true")
        self.assertEqual(_eval("(null)?.opts?.autoPersist"), "undefined")

    def test_nullish_fallback_keeps_zero_and_evaluates_the_value_once(self):
        once = (
            "(function () {"
            " var reads = 0; var value = 0;"
            " var out = (reads++, value) ?? 5;"
            " return [reads, out];"
            " }())"
        )
        self.assertEqual(_eval(once), "[1,0]")
        self.assertEqual(_eval("(null) ?? 'fallback'"), '"fallback"')
        self.assertEqual(_eval("(null) ?? 1 ?? 2"), "1")

    def test_nullish_assignment_writes_only_when_the_target_is_missing(self):
        self.assertEqual(
            _eval(
                "(function () {"
                " var wasmBinaryFile = null;"
                " wasmBinaryFile ??= 'godot.wasm.br';"
                " return wasmBinaryFile;"
                " }())"
            ),
            '"godot.wasm.br"',
        )
        self.assertEqual(
            _eval(
                "(function () {"
                " var wasmBinaryFile = 'keep';"
                " wasmBinaryFile ??= 'godot.wasm.br';"
                " return wasmBinaryFile;"
                " }())"
            ),
            '"keep"',
        )

    def test_class_fields_are_assigned_from_the_constructor(self):
        derived = """(function () {
          class ExitStatus extends Error {
            name = 'ExitStatus';
            constructor(status) {
              super('exit');
              this.status = status;
            }
          }
          var error = new ExitStatus(3);
          return [error.name, error.status];
        }())"""
        self.assertEqual(_eval(derived), '["ExitStatus",3]')
        plain = """(function () {
          class Stream {
            shared = { flags: 1 };
            get flags() { return this.shared.flags; }
          }
          return new Stream().flags;
        }())"""
        self.assertEqual(_eval(plain), "1")
        kept = (
            "(function () {"
            " class Sample {"
            " static create(params, options = {}) {"
            " return options.numberOfChannels;"
            " }"
            " }"
            " return Sample.create({}, { numberOfChannels: 1 });"
            " }())"
        )
        self.assertEqual(_eval(kept), "1")

    def test_logical_assignment_does_not_read_a_comment_on_the_previous_line(self):
        self.assertEqual(
            _eval(
                "(function () {\n"
                "  // active context.\n"
                "  var context = null;\n"
                "  var GL = { currentContext: 4 };\n"
                "  context ||= GL.currentContext;\n"
                "  return context;\n"
                "}())"
            ),
            "4",
        )

    def test_logical_assignment_uses_truthiness(self):
        self.assertEqual(
            _eval(
                "(function () {"
                " var warnOnce = {};"
                " warnOnce.shown ||= { ready: 1 };"
                " return warnOnce.shown.ready;"
                " }())"
            ),
            "1",
        )
        self.assertEqual(
            _eval("(function () { var box = { n: 0 }; box.n ||= 5; return box.n; }())"),
            "5",
        )
        self.assertEqual(
            _eval("(function () { var box = { n: 2 }; box.n &&= 5; return box.n; }())"),
            "5",
        )

    def test_object_spread_becomes_object_assign(self):
        self.assertEqual(_eval("({...{ autoPersist: true }}).autoPersist"), "true")

    def test_strings_and_comments_keep_the_original_tokens(self):
        source = "var label = 'a?.b ?? c'; // process.versions?.node\nvar value = obj?.prop;"
        rewritten = downlevel_wechat_js(source)
        self.assertIn("'a?.b ?? c'", rewritten)
        self.assertIn("// process.versions?.node", rewritten)
        self.assertNotIn("obj?.prop", rewritten)

    def test_template_glue_has_no_preview_parser_tokens_left(self):
        if not GLUE.is_file():
            self.skipTest("WeChat template glue is not built")
        rewritten = downlevel_wechat_js(GLUE.read_text(encoding="utf-8"))
        code = code_without_strings_and_comments(rewritten)
        self.assertNotIn("?.", code)
        self.assertNotIn("??", code)
        node = shutil.which("node")
        if node is None:
            self.skipTest("node is not on PATH")
        completed = subprocess.run(
            [node, "--check", "-"],
            input=rewritten,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)


if __name__ == "__main__":
    unittest.main()
