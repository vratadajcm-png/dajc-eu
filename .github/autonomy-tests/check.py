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
            if PLATFORM:
                # Ownership returns without following developer-created symlinks.
                self.assertIn('run: sudo chown -R -h "$(id -u):$(id -g)" -- "$GITHUB_WORKSPACE"', text)
                self.assertNotRegex(text, r'chown -R (?!-h)')

    @unittest.skipUnless(PLATFORM, 'DAJC AI reviewer is tested by its own evidence test')
    def test_platform_review_uses_pinned_import_context(self):
        sha = 'c' * 40
        test_file = "import { handleIdentityLoss } from '@/lib/offline/tenant-guard';\nvi.mock('@/lib/client-state-purge', () => ({}));\n"
        github = {
            'pulls/31': {'state': 'open', 'draft': True, 'base': {'ref': 'dev', 'sha': 'd' * 40},
                         'head': {'sha': sha, 'ref': 'codex/autonomous-1-1', 'repo': {'full_name': 'o/r'}}},
            'pulls/31/files?per_page=100&page=1': [{'filename': 'tests/regression/x.test.ts', 'status': 'modified',
                                                    'patch': '@@ -1 +1 @@\n-a\n+b'}],
            f'contents/tests/regression/x.test.ts?ref={sha}': test_file,
            f'contents/lib/offline/tenant-guard.ts?ref={sha}': 'export async function handleIdentityLoss(): Promise<boolean> { return true; }\n',
            f'contents/lib/client-state-purge.ts?ref={sha}': 'export const OFFLINE_DB_NAME = "x";\n',
        }
        verdict = '```json\n' + json.dumps({'verdict': 'approve', 'summary': 'ok', 'findings': []}) + '\n```'
        with tempfile.TemporaryDirectory() as directory:
            sent = Path(directory) / 'sent.json'
            mock = Path(directory) / 'mock.mjs'
            mock.write_text('import fs from "node:fs";\n'
                'const api = ' + json.dumps(github) + ';\n'
                'const posts = [];\n'
                'globalThis.fetch = async (url, init = {}) => {\n'
                '  url = String(url);\n'
                "  if (url === 'https://api.anthropic.com/v1/messages') {\n"
                f'    fs.writeFileSync({json.dumps(str(sent))}, init.body);\n'
                "    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: "
                + json.dumps(verdict) + ' }] }) };\n'
                '  }\n'
                "  const key = url.replace('https://api.github.com/repos/o/r/', '');\n"
                "  if (init.method === 'POST') { posts.push([key, init.body]);\n"
                f'    fs.writeFileSync({json.dumps(str(Path(directory) / "posts.json"))}, JSON.stringify(posts));\n'
                '    return { ok: true, json: async () => ({}) }; }\n'
                '  if (!(key in api)) return { ok: false, status: 404, json: async () => ({}) };\n'
                '  const value = api[key];\n'
                "  const body = typeof value === 'string' ? { type: 'file', encoding: 'base64',\n"
                "    content: Buffer.from(value).toString('base64') } : value;\n"
                '  return { ok: true, json: async () => body };\n'
                '};\n')
            subprocess.run(['node', '--import', mock.as_uri(), str(ROOT / '.github/autonomy/independent-review.mjs')],
                           check=True, capture_output=True, text=True,
                           env={**os.environ, 'GITHUB_REPOSITORY': 'o/r', 'GITHUB_TOKEN': 'x', 'PR_NUMBER': '31',
                                'ANTHROPIC_API_KEY': 'x', 'DAJC_REVIEW_MODEL': 'm', 'DAJC_TARGET_BASE': 'dev',
                                'GITHUB_SERVER_URL': 'https://github.com', 'GITHUB_RUN_ID': '1'})
            prompt = json.loads(sent.read_text())['messages'][0]['content']
            self.assertIn('FILE: tests/regression/x.test.ts', prompt)
            self.assertIn('CONTEXT FILE: tests/regression/x.test.ts (full content at head ' + sha + ', changed', prompt)
            self.assertIn('CONTEXT FILE: lib/offline/tenant-guard.ts (full content at head ' + sha + ', unchanged', prompt)
            self.assertIn('Promise<boolean>', prompt)
            self.assertIn('CONTEXT FILE: lib/client-state-purge.ts', prompt)
            posts = json.loads((Path(directory) / 'posts.json').read_text())
            final_status = [json.loads(body) for key, body in posts if key == 'statuses/' + sha][-1]
            self.assertEqual(final_status['state'], 'success')

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
