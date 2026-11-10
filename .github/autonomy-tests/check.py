"""Offline regression checks for the actual workflow shell guards."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
PLATFORM = (ROOT / '.github/workflows/dajc-autonomous-development.yml').exists()
NAME = 'dajc-autonomous-development.yml' if PLATFORM else 'dajc-ai-autonomous-claude.yml'
WORKFLOW = (ROOT / '.github/workflows' / NAME).read_text()
PREFIX = 'codex/autonomous-' if PLATFORM else 'claude/autonomous-ai-'


class GuardTests(unittest.TestCase):
    def test_untrusted_resume_names(self):
        start = WORKFLOW.index('          # Branch names')
        end = WORKFLOW.index('          count=$(jq', start)
        shell = WORKFLOW[start:end]
        cases = [(PREFIX + '123-1', True), (PREFIX + 'x', False),
                 (PREFIX + '$(touch injected)', False),
                 (PREFIX + '123-1;exit', False), ('main', False)]
        with tempfile.TemporaryDirectory() as directory:
            for name, allowed in cases:
                with self.subTest(name=name):
                    result = subprocess.run(['bash', '-c', shell], cwd=directory,
                        env={**os.environ, 'prs': json.dumps([{'headRefName': name}])},
                        capture_output=True)
                    self.assertEqual(result.returncode == 0, allowed)
            self.assertFalse((Path(directory) / 'injected').exists())

    def test_baseline_is_captured_before_development(self):
        self.assertLess(WORKFLOW.index('id: baseline'), WORKFLOW.index('      - name: Export'))
        self.assertIn('base_sha: ${{ steps.baseline.outputs.sha }}', WORKFLOW)
        start = WORKFLOW.index('          test "$(git rev-parse HEAD)" = "$EXPECTED_BASE_SHA"')
        shell = WORKFLOW[start:WORKFLOW.index('          }', start) + len('          }')]
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args],
                    stderr=subprocess.DEVNULL, text=True).strip()
            git('init'); git('config', 'user.name', 'Offline test')
            git('config', 'user.email', 'offline@example.invalid')
            git('commit', '--allow-empty', '-m', 'baseline')
            baseline = git('rev-parse', 'HEAD')
            def check():
                return subprocess.run(['bash', '-c', shell], cwd=directory,
                    env={**os.environ, 'EXPECTED_BASE_SHA': baseline}, capture_output=True).returncode
            self.assertEqual(check(), 0)
            git('commit', '--allow-empty', '-m', 'unexpected developer commit')
            self.assertNotEqual(check(), 0)

    def test_review_javascript_syntax(self):
        if PLATFORM:
            subprocess.run(['node', '--check', str(ROOT / '.github/autonomy/independent-review.mjs')], check=True)
        else:
            text = (ROOT / '.github/workflows/dajc-ai-independent-codex-review.yml').read_text()
            for fragment in text.split("<<'JS'\n")[1:]:
                script = fragment.split('\n          JS', 1)[0]
                subprocess.run(['node', '--input-type=module', '--check'], input=script, text=True, check=True)


if __name__ == '__main__':
    unittest.main()
