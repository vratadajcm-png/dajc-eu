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
PAID_PREFIX = 'Codex' if PLATFORM else 'Claude Code'
PAID_STEP = ('Codex — one bounded non-production cycle' if PLATFORM
             else 'Claude Code — one bounded DAJC AI development cycle')


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

    def _step_script(self, first_line, end_marker):
        start = WORKFLOW.index(first_line)
        end = WORKFLOW.index(end_marker, start)
        return '\n'.join(line[10:] for line in WORKFLOW[start:end].splitlines())

    def test_paid_developer_call_is_never_repeated_by_rerun(self):
        develop = WORKFLOW[WORKFLOW.index('  develop:'):WORKFLOW.index('    runs-on:')]
        self.assertIn('github.run_attempt == 1', develop)
        self.assertIn("vars.DAJC_", develop)  # schedule kill switch remains
        if not PLATFORM:
            review = (ROOT / '.github/workflows/dajc-ai-independent-codex-review.yml').read_text()
            job = review[review.index('  codex-review:'):review.index('    runs-on:')]
            self.assertIn('github.run_attempt == 1', job)

    def test_weekly_paid_run_cap(self):
        # The cap must identify the real paid step; renaming it must break this test.
        self.assertIn('      - name: ' + PAID_STEP + '\n', WORKFLOW)
        self.assertIn('PAID_STEP_PREFIX: ' + PAID_PREFIX + '\n', WORKFLOW)
        self.assertTrue(PAID_STEP.startswith(PAID_PREFIX))
        self.assertLess(WORKFLOW.index('case "$RUN_CAP"'), WORKFLOW.index('      - name: ' + PAID_STEP))
        script = self._step_script('          case "$RUN_CAP"', '      - name: Checkout candidate baseline')
        paid_job = {'jobs': [{'name': 'develop', 'steps': [
            {'name': 'Find', 'conclusion': 'success'},
            {'name': PAID_STEP, 'conclusion': 'success'}]}]}
        running_job = {'jobs': [{'name': 'develop', 'steps': [
            {'name': PAID_STEP, 'status': 'in_progress', 'conclusion': None}]}]}
        blocked_job = {'jobs': [{'name': 'develop', 'steps': [
            {'name': 'Enforce', 'conclusion': 'failure'},
            {'name': PAID_STEP, 'conclusion': 'skipped'}]}]}
        skipped_run = {'jobs': [{'name': 'develop', 'steps': []}]}
        other_job = {'jobs': [{'name': 'publish-draft', 'steps': [
            {'name': PAID_STEP, 'conclusion': 'success'}]}]}
        runs = {'11': paid_job, '12': running_job, '13': blocked_job,
                '14': skipped_run, '15': other_job, '99': paid_job}
        with tempfile.TemporaryDirectory() as directory:
            fake = Path(directory) / 'gh'
            fake.write_text('#!/usr/bin/env python3\n'
                'import json, sys\n'
                f'RUNS = {json.dumps(runs)!r}\n'
                'args = " ".join(sys.argv[1:])\n'
                'if "/workflows/" in args:\n'
                '    print("\\n".join(json.loads(RUNS)))\n'
                'else:\n'
                '    run_id = args.split("/runs/")[1].split("/")[0]\n'
                '    print(json.dumps(json.loads(RUNS)[run_id]))\n')
            fake.chmod(0o755)
            summary = Path(directory) / 'summary'

            def run(cap):
                return subprocess.run(['bash', '-e', '-c', script], capture_output=True, text=True,
                    env={**os.environ, 'PATH': f'{directory}:{os.environ["PATH"]}',
                         'RUN_CAP': cap, 'GITHUB_RUN_ID': '99', 'GITHUB_REPOSITORY': 'o/r',
                         'WORKFLOW_FILE': NAME, 'PAID_STEP_PREFIX': PAID_PREFIX,
                         'GITHUB_STEP_SUMMARY': str(summary)})
            # Runs 11 and 12 count; blocked, skipped, other-job and self do not.
            self.assertEqual(run('3').returncode, 0)
            self.assertIn(': 2 (cap 3)', summary.read_text())
            self.assertNotEqual(run('2').returncode, 0)
            self.assertNotEqual(run('0').returncode, 0)
            for bad in ('', 'x', '-1', '2;id'):
                with self.subTest(cap=bad):
                    self.assertNotEqual(run(bad).returncode, 0)

    def test_main_reference_copies_never_enter_a_patch(self):
        script = self._step_script('          ref=.dajc-main-reference\n          if git ls-files',
                                   '          # end-reference-cleanup')
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args],
                    stderr=subprocess.DEVNULL, text=True).strip()
            git('init'); git('config', 'user.name', 'Offline test')
            git('config', 'user.email', 'offline@example.invalid')
            git('commit', '--allow-empty', '-m', 'baseline')
            ref = Path(directory) / '.dajc-main-reference'

            def cleanup():
                return subprocess.run(['bash', '-e', '-c', script], cwd=directory,
                                      capture_output=True).returncode
            (ref / 'docs').mkdir(parents=True)
            (ref / 'docs' / 'x.md').write_text('reference')
            subprocess.run(['chmod', '-R', 'a-w', str(ref)], check=True)
            self.assertEqual(cleanup(), 0)
            self.assertFalse(ref.exists())
            self.assertEqual(cleanup(), 0)  # absent is fine
            ref.symlink_to('/etc')
            self.assertNotEqual(cleanup(), 0)
            ref.unlink()
            ref.mkdir(); (ref / 'tracked').write_text('x')
            git('add', '-f', '.dajc-main-reference/tracked'); git('commit', '-m', 'tracked')
            self.assertNotEqual(cleanup(), 0)
            self.assertTrue((ref / 'tracked').exists())

    def test_codex_runs_without_sudo_on_hosted_runners(self):
        files = [ROOT / '.github/workflows' / ('dajc-autonomous-development.yml' if PLATFORM
                 else 'dajc-ai-independent-codex-review.yml')]
        for path in files:
            text = path.read_text()
            self.assertIn('openai/codex-action@v1', text)
            self.assertNotIn('safety-strategy: drop-sudo', text)
            self.assertIn('safety-strategy: unprivileged-user', text)
            self.assertIn('codex-user: dajc-codex', text)
            self.assertIn('unexpectedly has sudo', text)

    @unittest.skipIf(PLATFORM, 'Platform reviewer embeds the patch in its own script')
    def test_review_evidence_includes_pinned_import_context(self):
        review = (ROOT / '.github/workflows/dajc-ai-independent-codex-review.yml').read_text()
        script = review.split("<<'JS'\n")[1].split('\n          JS', 1)[0]
        script = '\n'.join(line[10:] for line in script.splitlines())
        sha = 'a' * 40
        changed = "import { X } from './client.mjs';\nimport y from '../util/y';\nexport const f = 1;\n"
        api = {
            'pulls/7': {'state': 'open', 'draft': True, 'base': {'ref': 'dev', 'sha': 'b' * 40},
                        'head': {'sha': sha, 'ref': 'claude/autonomous-ai-1-1',
                                 'repo': {'full_name': 'o/r'}}},
            'pulls/7/files?per_page=100&page=1': [{'filename': 'src/lib/kb/a.mjs', 'status': 'modified',
                                                   'patch': '@@ -1 +1 @@\n-x\n+export const f = 1;'}],
            f'contents/src/lib/kb/a.mjs?ref={sha}': changed,
            f'contents/src/lib/kb/client.mjs?ref={sha}': "export const X = 'redirect: manual';\n",
            f'contents/src/lib/util/y.ts?ref={sha}': 'export default 2;\n',
        }
        with tempfile.TemporaryDirectory() as directory:
            mock = Path(directory) / 'mock.mjs'
            mock.write_text('const api = ' + json.dumps(api) + ';\n'
                'globalThis.fetch = async (url) => {\n'
                "  const key = String(url).replace('https://api.github.com/repos/o/r/', '');\n"
                '  if (!(key in api)) return { ok: false, status: 404, json: async () => ({}) };\n'
                '  const value = api[key];\n'
                "  const body = typeof value === 'string' ? { type: 'file', encoding: 'base64',\n"
                "    content: Buffer.from(value).toString('base64') } : value;\n"
                '  return { ok: true, status: 200, json: async () => body };\n'
                '};\n')
            subprocess.run(['node', '--import', mock.as_uri(), '--input-type=module'], input=script,
                           text=True, check=True, cwd=directory,
                           env={**os.environ, 'GITHUB_REPOSITORY': 'o/r', 'PR_NUMBER': '7',
                                'GITHUB_TOKEN': 'x', 'DAJC_TARGET_BASE': 'dev',
                                'GITHUB_OUTPUT': str(Path(directory) / 'output')})
            evidence = (Path(directory) / 'review-diff.txt').read_text()
            self.assertIn('FILE src/lib/kb/a.mjs\nSTATUS modified', evidence)
            self.assertIn('CONTEXT FILE src/lib/kb/a.mjs (full content at head ' + sha + ', changed', evidence)
            self.assertIn('CONTEXT FILE src/lib/kb/client.mjs (full content at head ' + sha + ', unchanged', evidence)
            self.assertIn("redirect: manual", evidence)
            self.assertIn('CONTEXT FILE src/lib/util/y.ts', evidence)
            meta = json.loads((Path(directory) / 'review-meta.json').read_text())
            self.assertEqual(meta['sha'], sha)
            self.assertEqual((Path(directory) / 'output').read_text(), 'head_sha=' + sha + '\n')
        # The context checkout is pinned to that SHA, credential-free and verified.
        checkout = review[review.index('      - name: Read-only checkout of exactly the reviewed head'):
                          review.index('      - name: Require explicit Codex API model')]
        for expected in ('ref: ${{ steps.evidence.outputs.head_sha }}', 'path: pr-head',
                         'persist-credentials: false', 'test "$(git -C pr-head rev-parse HEAD)" = "$HEAD_SHA"'):
            self.assertIn(expected, checkout)
        self.assertLess(review.index('path: pr-head'), review.index('sudo setfacl -R -m u:dajc-codex:rX'))

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
