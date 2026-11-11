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
        start = WORKFLOW.index('\n  develop:')
        develop = WORKFLOW[start:WORKFLOW.index('    runs-on:', start)]
        self.assertIn('github.run_attempt == 1', develop)
        preflight = WORKFLOW[WORKFLOW.index('\n  preflight:'):start]
        self.assertIn("vars.DAJC_", preflight)  # schedule kill switch remains
        if not PLATFORM:
            review = (ROOT / '.github/workflows/dajc-ai-independent-codex-review.yml').read_text()
            job = review[review.index('  codex-review:'):review.index('    runs-on:')]
            self.assertIn('github.run_attempt == 1', job)

    def test_preflight_gate_and_kill_switch_stop_paid_work_before_any_provider_call(self):
        start = WORKFLOW.index('\n  develop:')
        develop = WORKFLOW[start:WORKFLOW.index('    runs-on:', start)]
        self.assertIn('needs: preflight', develop)
        self.assertIn("if: ${{ needs.preflight.outputs.ready == 'true' && github.run_attempt == 1 }}", develop)
        # Job-level expressions treat an unset variable as null and null == '0'
        # as true; the kill switch must stay in the tested shell below.
        self.assertNotIn('contains(', develop)
        self.assertNotIn('vars.', develop)
        preflight = WORKFLOW[WORKFLOW.index('\n  preflight:'):start]
        self.assertNotRegex(preflight, r'\$\{\{\s*secrets\.')
        self.assertNotIn('contents: write', preflight)
        self.assertIn('EVENT_NAME: ${{ github.event_name }}', preflight)
        self.assertLess(WORKFLOW.index('\n  preflight:'), WORKFLOW.index('      - name: ' + PAID_STEP))
        script = self._step_script('          echo "Kill switch', '\n  develop:')
        S, D = 'schedule', 'workflow_dispatch'
        # (event, kill switch value, gh output, gh exit code, expected ready, gh called)
        if PLATFORM:
            endpoint = 'repos/o/r/actions/workflows/dajc-autonomy-pr-probe.yml/runs?branch=main&status=completed&per_page=1'
            cases = [(S, '', 'success', 0, 'true', True),  # unset switch: schedules run
                     (S, 'true', 'success', 0, 'true', True),
                     (S, 'false', 'success', 0, 'false', False), (S, ' OFF ', 'success', 0, 'false', False),
                     (S, '0', 'success', 0, 'false', False), (S, 'No', 'success', 0, 'false', False),
                     (D, 'false', 'success', 0, 'true', True),  # deliberate manual run
                     (S, '', 'failure', 0, 'false', True), (S, '', 'cancelled', 0, 'false', True),
                     (D, '', 'none', 0, 'false', True), (S, '', '', 1, None, True)]
        else:
            endpoint = 'repos/o/r --jq .private'
            cases = [(S, '', 'true', 0, 'true', True),  # private, unset switch: schedules run
                     (S, 'false', 'true', 0, 'false', False), (S, '0', 'true', 0, 'false', False),
                     (D, 'false', 'true', 0, 'true', True),
                     (S, '', 'false', 0, 'false', True), (D, '', 'false', 0, 'false', True),
                     (S, 'true', 'false', 0, 'true', True), (S, ' TRUE ', 'false', 0, 'true', True),
                     (S, '', 'null', 0, 'false', True), (S, 'true', '', 1, None, True)]
        with tempfile.TemporaryDirectory() as directory:
            fake = Path(directory) / 'gh'
            fake.write_text('#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$FAKE_LOG"\n'
                            '[ "$FAKE_RC" = 0 ] || exit "$FAKE_RC"\nprintf "%s\\n" "$FAKE_OUT"\n')
            fake.chmod(0o755)
            for event, enabled, out, rc, ready, called in cases:
                with self.subTest(event=event, enabled=enabled, out=out, rc=rc):
                    files = {name: Path(directory) / name for name in ('log', 'output', 'summary')}
                    for path in files.values():
                        path.write_text('')
                    result = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', script],
                        capture_output=True, text=True,
                        env={**os.environ, 'PATH': f'{directory}:{os.environ["PATH"]}',
                             'FAKE_OUT': out, 'FAKE_RC': str(rc), 'FAKE_LOG': str(files['log']),
                             'DAJC_ENABLED': enabled, 'EVENT_NAME': event, 'GITHUB_REPOSITORY': 'o/r',
                             'PROBE_WORKFLOW': 'dajc-autonomy-pr-probe.yml',
                             'GITHUB_OUTPUT': str(files['output']),
                             'GITHUB_STEP_SUMMARY': str(files['summary'])})
                    self.assertEqual(endpoint in files['log'].read_text(), called)
                    if ready is None:  # API failure fails closed: develop never starts
                        self.assertNotEqual(result.returncode, 0)
                        self.assertNotIn('ready=true', files['output'].read_text())
                        continue
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(files['output'].read_text(), f'ready={ready}\n')
                    self.assertIn('Kill switch', files['summary'].read_text())
                    if ready == 'false':
                        self.assertRegex(result.stdout, '::(warning|notice)::')

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

    def _platform_review_prompt(self, sha, changed, head_files):
        """Run the trusted reviewer against a mocked GitHub/Anthropic API and
        return the prompt it sends plus its final commit status."""
        github = {
            'pulls/31': {'state': 'open', 'draft': True, 'base': {'ref': 'dev', 'sha': 'd' * 40},
                         'head': {'sha': sha, 'ref': 'codex/autonomous-1-1', 'repo': {'full_name': 'o/r'}}},
            'pulls/31/files?per_page=100&page=1': [{'filename': name, 'status': 'modified',
                                                    'patch': '@@ -1 +1 @@\n-a\n+b'} for name in changed],
        }
        for path, content in head_files.items():
            github[f'contents/{path}?ref={sha}'] = content
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
                "  const key = decodeURIComponent(url.replace('https://api.github.com/repos/o/r/', ''));\n"
                "  if (init.method === 'POST') { posts.push([key, init.body]);\n"
                f'    fs.writeFileSync({json.dumps(str(Path(directory) / "posts.json"))}, JSON.stringify(posts));\n'
                '    return { ok: true, json: async () => ({}) }; }\n'
                '  if (!(key in api)) return { ok: false, status: 404, json: async () => ({}) };\n'
                '  const value = api[key];\n'
                "  const body = typeof value === 'string' ? { type: 'file', encoding: 'base64',\n"
                "    content: Buffer.from(value).toString('base64') } : value;\n"
                '  return { ok: true, json: async () => body };\n'
                '};\n')
            result = subprocess.run(['node', '--import', mock.as_uri(), str(ROOT / '.github/autonomy/independent-review.mjs')],
                           check=True, capture_output=True, text=True,
                           env={**os.environ, 'GITHUB_REPOSITORY': 'o/r', 'GITHUB_TOKEN': 'x', 'PR_NUMBER': '31',
                                'ANTHROPIC_API_KEY': 'x', 'DAJC_REVIEW_MODEL': 'm', 'DAJC_TARGET_BASE': 'dev',
                                'GITHUB_SERVER_URL': 'https://github.com', 'GITHUB_RUN_ID': '1'})
            prompt = json.loads(sent.read_text())['messages'][0]['content']
            posts = json.loads((Path(directory) / 'posts.json').read_text())
            final_status = [json.loads(body) for key, body in posts if key == 'statuses/' + sha][-1]
            return prompt, final_status, result.stdout

    @unittest.skipUnless(PLATFORM, 'DAJC AI reviewer is tested by its own evidence test')
    def test_platform_review_uses_pinned_import_context(self):
        sha = 'c' * 40
        test_file = "import { handleIdentityLoss } from '@/lib/offline/tenant-guard';\nvi.mock('@/lib/client-state-purge', () => ({}));\n"
        prompt, status, _ = self._platform_review_prompt(sha, ['tests/regression/x.test.ts'], {
            'tests/regression/x.test.ts': test_file,
            'lib/offline/tenant-guard.ts': 'export async function handleIdentityLoss(): Promise<boolean> { return true; }\n',
            'lib/client-state-purge.ts': 'export const OFFLINE_DB_NAME = "x";\n',
        })
        self.assertIn('FILE: tests/regression/x.test.ts', prompt)
        self.assertIn('CONTEXT FILE: tests/regression/x.test.ts (full content at head ' + sha + ', changed', prompt)
        self.assertIn('CONTEXT FILE: lib/offline/tenant-guard.ts (full content at head ' + sha + ', unchanged', prompt)
        self.assertIn('Promise<boolean>', prompt)
        self.assertIn('CONTEXT FILE: lib/client-state-purge.ts', prompt)
        self.assertNotIn('OMITTED CONTEXT (not supplied', prompt)
        self.assertEqual(status['state'], 'success')

    @unittest.skipUnless(PLATFORM, 'DAJC AI reviewer is tested by its own evidence test')
    def test_platform_review_follows_real_imports_before_mocks(self):
        # PR #31 at 5d93da9: a test mocks many modules and runs replay.ts, which
        # imports tenant-guard.ts. The reviewer must see tenant-guard.ts.
        sha = 'e' * 40
        mocks = ['@/lib/offline/db'] + [f'@/app/(app)/m{i}/actions' for i in range(16)]
        test_file = ('import type { QueuedAction } from "@/lib/offline/types";\n'
                     + ''.join(f'vi.mock("{spec}", () => ({{}}));\n' for spec in mocks)
                     + 'import { replayQueue } from "@/lib/offline/replay";\n')
        head = {'tests/regression/replay.test.ts': test_file,
                'lib/offline/types.ts': 'export type QueuedAction = { id: string };\n',
                'lib/offline/replay.ts': ('import { handleIdentityLoss } from "./tenant-guard";\n'
                                          'import { listActions } from "@/lib/offline/db";\n'),
                'lib/offline/tenant-guard.ts': 'export async function handleIdentityLoss() { await purge(); return true; }\n',
                'lib/offline/db.ts': 'export function listActions() {}\n'}
        head.update({f'app/(app)/m{i}/actions.ts': f'export const action{i} = 1;\n' for i in range(16)})
        prompt, status, stdout = self._platform_review_prompt(sha, ['tests/regression/replay.test.ts'], head)
        self.assertIn('CONTEXT FILE: lib/offline/replay.ts (full content at head ' + sha + ', unchanged, imported by a changed file)', prompt)
        self.assertIn('CONTEXT FILE: lib/offline/tenant-guard.ts (full content at head ' + sha + ', unchanged, imported by lib/offline/replay.ts)', prompt)
        self.assertIn('await purge()', prompt)
        self.assertIn('CONTEXT FILE: lib/offline/db.ts (full content at head ' + sha + ', unchanged, replaced by vi.mock', prompt)
        # Real imports come first; mocked modules fill the remaining slots and the
        # rest is named instead of silently dropped.
        self.assertLess(prompt.index('CONTEXT FILE: lib/offline/tenant-guard.ts'), prompt.index('CONTEXT FILE: app/(app)/m0/actions.ts'))
        self.assertIn('OMITTED CONTEXT (not supplied', prompt)
        omitted = prompt.split('OMITTED CONTEXT (not supplied', 1)[1]
        self.assertIn('app/(app)/m15/actions', omitted)
        self.assertNotIn('tenant-guard', omitted)
        self.assertIn('Review context supplied: tests/regression/replay.test.ts, lib/offline/types.ts, lib/offline/replay.ts, lib/offline/tenant-guard.ts', stdout)
        self.assertEqual(status['state'], 'success')

    @unittest.skipUnless(PLATFORM, 'Only the Platform publisher has the optional PR App path')
    def test_pr_app_token_is_publisher_only_and_least_privilege(self):
        develop = WORKFLOW[WORKFLOW.index('  develop:'):WORKFLOW.index('  publish-draft:')]
        publish = WORKFLOW[WORKFLOW.index('  publish-draft:'):]
        self.assertNotIn('create-github-app-token', develop)
        self.assertNotIn('DAJC_PR_APP', develop)
        step = publish[publish.index('      - name: Mint a short-lived PR-only token'):
                       publish.index('      - name: Create one draft PR')]
        # Pinned to a full commit SHA, optional, and limited to pull requests.
        self.assertRegex(step, r'uses: actions/create-github-app-token@[0-9a-f]{40} ')
        self.assertIn("if: ${{ vars.DAJC_PR_APP_CLIENT_ID != '' }}", step)
        permissions = [line.strip() for line in step.splitlines() if line.strip().startswith('permission-')]
        self.assertEqual(permissions, ['permission-pull-requests: write'])
        self.assertNotIn('owner:', step)
        self.assertNotIn('repositories:', step)
        self.assertNotIn('skip-token-revoke', step)
        # The App token is only used to open the PR, never to push or merge.
        self.assertEqual(publish.count('steps.pr-app.outputs.token'), 2)
        self.assertIn('GH_TOKEN="$PR_TOKEN" gh pr create --draft', publish)
        self.assertNotIn('gh pr merge', WORKFLOW)
        self.assertNotIn('--auto', WORKFLOW)

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
