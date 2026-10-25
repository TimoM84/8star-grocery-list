import { describe, expect, it, beforeEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Runs scripts/release.sh against a throw-away repository with a local bare "origin" and a
 * stub `gh` that records what it was asked to do.
 */

const SCRIPT = path.resolve('scripts/release.sh');

const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "$STUB_DIR/gh.log"
case "$1 $2" in
	"auth status") exit 0 ;;
	"repo view")
		if [[ "$*" == *nameWithOwner* ]]; then echo "TimoM84/8star-grocery-list"; else echo "main"; fi ;;
	"release view") [ -f "$STUB_DIR/release-exists" ] && exit 0 || exit 1 ;;
	"release create") cp "\${@: -1}" "$STUB_DIR/notes.md"; echo created >> "$STUB_DIR/created" ;;
	api*)
		# checks.N (if present) answers the N-th call, so tests can let CI finish while waiting.
		n=$(( $(cat "$STUB_DIR/api-count" 2>/dev/null || echo 0) + 1 ))
		echo "$n" > "$STUB_DIR/api-count"
		if [ -f "$STUB_DIR/checks.$n" ]; then cat "$STUB_DIR/checks.$n"; else cat "$STUB_DIR/checks"; fi ;;
	*) echo "unexpected gh call: $*" >&2; exit 9 ;;
esac
`;

interface Env {
	dir: string;
	stub: string;
	work: string;
	origin: string;
}

function git(cwd: string, ...args: string[]) {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function setup(): Env {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), '8star-release-'));
	const stub = path.join(dir, 'stub');
	const bin = path.join(stub, 'bin');
	fs.mkdirSync(bin, { recursive: true });
	fs.writeFileSync(path.join(bin, 'gh'), GH_STUB, { mode: 0o755 });
	const origin = path.join(dir, 'origin.git');
	const work = path.join(dir, 'work');
	git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
	git(dir, 'clone', '-q', origin, work);
	git(work, 'config', 'user.email', 't@example.com');
	git(work, 'config', 'user.name', 'Test');
	git(work, 'switch', '-q', '-c', 'main');
	fs.writeFileSync(path.join(work, 'package.json'), '{\n\t"name": "x",\n\t"version": "1.1.0"\n}\n');
	fs.writeFileSync(
		path.join(work, 'package-lock.json'),
		'{\n  "name": "x",\n  "version": "1.1.0",\n  "packages": { "": { "version": "1.1.0" } }\n}\n'
	);
	fs.writeFileSync(
		path.join(work, 'CHANGELOG.md'),
		'# Changelog\n\n## 1.1.0\n\n- Import and export\n- AI suggestions\n\n## 1.0.0\n\n- First release\n'
	);
	git(work, 'add', '.');
	git(work, 'commit', '-q', '-m', 'v1.1.0');
	git(work, 'push', '-q', '-u', 'origin', 'main');
	fs.writeFileSync(
		path.join(stub, 'checks'),
		'Typecheck, lint, unit, build, Playwright\tcompleted\tsuccess\nDocker image and compose smoke test\tcompleted\tsuccess\n'
	);
	return { dir, stub, work, origin };
}

function release(env: Env, args: string[], input = '', extra: Record<string, string> = {}) {
	const r = spawnSync('bash', [SCRIPT, ...args], {
		cwd: env.work,
		input,
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${path.join(env.stub, 'bin')}:${process.env.PATH}`,
			STUB_DIR: env.stub,
			CI_POLL_SECONDS: '0',
			...extra
		}
	});
	return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

const remoteTags = (env: Env) => git(env.dir, '--git-dir', env.origin, 'tag', '-l');

let env: Env;
beforeEach(() => {
	env = setup();
});

describe('scripts/release.sh', () => {
	it('publishes after confirmation: annotated tag on the exact commit and notes from the changelog', () => {
		const head = git(env.work, 'rev-parse', 'HEAD');
		const r = release(env, ['v1.1.0'], 'v1.1.0\n');
		expect(r.code, r.out).toBe(0);
		expect(r.out).toContain('All GitHub Actions checks passed');
		expect(remoteTags(env)).toBe('v1.1.0');
		expect(git(env.dir, '--git-dir', env.origin, 'cat-file', '-t', 'v1.1.0')).toBe('tag');
		expect(git(env.dir, '--git-dir', env.origin, 'rev-list', '-n', '1', 'v1.1.0')).toBe(head);
		const notes = fs.readFileSync(path.join(env.stub, 'notes.md'), 'utf8');
		expect(notes).toContain('Import and export');
		expect(notes).not.toContain('First release');
		const log = fs.readFileSync(path.join(env.stub, 'gh.log'), 'utf8');
		expect(log).toMatch(
			/gh release create v1\.1\.0 --repo TimoM84\/8star-grocery-list --verify-tag/
		);
		expect(log).toContain(`commits/${head}/check-runs`);
	});

	it('--yes publishes without asking (used by the Release workflow)', () => {
		const r = release(env, ['v1.1.0', '--yes']);
		expect(r.code, r.out).toBe(0);
		expect(r.out).toContain('Confirmed with --yes');
		expect(remoteTags(env)).toBe('v1.1.0');
		expect(fs.existsSync(path.join(env.stub, 'created'))).toBe(true);
	});

	it('--wait-for-ci waits until CI finished for the commit, ignoring its own job', () => {
		fs.writeFileSync(path.join(env.stub, 'checks.1'), '');
		fs.writeFileSync(
			path.join(env.stub, 'checks.2'),
			'Typecheck, lint, unit, build, Playwright\tin_progress\t\nPublish release\tin_progress\t\n'
		);
		fs.writeFileSync(
			path.join(env.stub, 'checks'),
			'Typecheck, lint, unit, build, Playwright\tcompleted\tsuccess\nPublish release\tin_progress\t\nPublish release\tcompleted\tfailure\n'
		);
		const r = release(env, ['v1.1.0', '--yes', '--wait-for-ci', '60'], '', {
			IGNORE_CHECK: 'Publish release'
		});
		expect(r.code, r.out).toBe(0);
		expect(r.out).toContain('no GitHub Actions checks for this commit yet');
		expect(r.out).toContain('Waiting 0s for GitHub Actions');
		expect(r.out).not.toContain('Publish release');
		expect(remoteTags(env)).toBe('v1.1.0');
	});

	it('--wait-for-ci stops at the first failed check and at the time limit', () => {
		fs.writeFileSync(path.join(env.stub, 'checks.1'), 'Docker\tin_progress\t\n');
		fs.writeFileSync(path.join(env.stub, 'checks'), 'Docker\tcompleted\tfailure\n');
		const failed = release(env, ['v1.1.0', '--yes', '--wait-for-ci', '60']);
		expect(failed.code).toBe(1);
		expect(failed.out).toMatch(/must have passed/);

		fs.writeFileSync(path.join(env.stub, 'checks'), 'Docker\tin_progress\t\n');
		const slow = release(env, ['v1.1.0', '--yes', '--wait-for-ci', '60'], '', {
			CI_WAIT_SECONDS: '0'
		});
		expect(slow.code).toBe(1);
		expect(slow.out).toMatch(/did not finish .* within 60 minutes; nothing was released/);
		expect(remoteTags(env)).toBe('');
		expect(fs.existsSync(path.join(env.stub, 'created'))).toBe(false);
	});

	it('does nothing without the typed confirmation', () => {
		const r = release(env, ['v1.1.0'], 'yes\n');
		expect(r.code).toBe(1);
		expect(r.out).toContain('Not confirmed');
		expect(remoteTags(env)).toBe('');
		expect(fs.existsSync(path.join(env.stub, 'created'))).toBe(false);
	});

	it('dry run checks everything but creates nothing', () => {
		const r = release(env, ['v1.1.0', '--dry-run']);
		expect(r.code, r.out).toBe(0);
		expect(r.out).toContain('Dry run');
		expect(remoteTags(env)).toBe('');
	});

	it.each([
		['bad version format', ['1.1.0'], () => {}, /Usage/],
		[
			'version mismatch with package.json',
			['v1.2.0', '--dry-run'],
			() => {},
			/package\.json has version 1\.1\.0/
		],
		[
			'dirty working tree',
			['v1.1.0', '--dry-run'],
			(e: Env) => fs.writeFileSync(path.join(e.work, 'stray.txt'), 'x'),
			/not clean/
		],
		[
			'wrong branch',
			['v1.1.0', '--dry-run'],
			(e: Env) => git(e.work, 'switch', '-q', '-c', 'feature'),
			/You are on 'feature'/
		],
		[
			'unpushed commit',
			['v1.1.0', '--dry-run'],
			(e: Env) => git(e.work, 'commit', '-q', '--allow-empty', '-m', 'local only'),
			/differs from origin\/main/
		],
		[
			'lockfile out of sync',
			['v1.1.0', '--dry-run'],
			(e: Env) => {
				fs.writeFileSync(path.join(e.work, 'package-lock.json'), '{\n  "version": "1.0.0"\n}\n');
				git(e.work, 'commit', '-qam', 'lock');
				git(e.work, 'push', '-q');
			},
			/package-lock\.json has version 1\.0\.0/
		],
		[
			'missing changelog section',
			['v1.1.0', '--dry-run'],
			(e: Env) => {
				fs.writeFileSync(path.join(e.work, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0\n- x\n');
				git(e.work, 'commit', '-qam', 'cl');
				git(e.work, 'push', '-q');
			},
			/no '## 1\.1\.0' section/
		],
		[
			'tag already on GitHub',
			['v1.1.0', '--dry-run'],
			(e: Env) => {
				git(e.work, 'tag', 'v1.1.0');
				git(e.work, 'push', '-q', 'origin', 'v1.1.0');
				git(e.work, 'tag', '-d', 'v1.1.0');
			},
			/already exists on GitHub/
		],
		[
			'release already exists',
			['v1.1.0', '--dry-run'],
			(e: Env) => fs.writeFileSync(path.join(e.stub, 'release-exists'), ''),
			/release v1\.1\.0 already exists/
		],
		[
			'failed CI',
			['v1.1.0', '--dry-run'],
			(e: Env) =>
				fs.writeFileSync(
					path.join(e.stub, 'checks'),
					'Typecheck, lint\tcompleted\tsuccess\nDocker\tcompleted\tfailure\n'
				),
			/must have passed/
		],
		[
			'CI still running',
			['v1.1.0', '--dry-run'],
			(e: Env) => fs.writeFileSync(path.join(e.stub, 'checks'), 'Docker\tin_progress\t\n'),
			/must have passed/
		],
		[
			'stale version in compose.yaml',
			['v1.1.0', '--dry-run'],
			(e: Env) => {
				fs.writeFileSync(
					path.join(e.work, 'compose.yaml'),
					'services:\n  app:\n    image: x:${APP_VERSION:-1.0.0}\n'
				);
				git(e.work, 'add', '.');
				git(e.work, 'commit', '-qm', 'compose');
				git(e.work, 'push', '-q');
			},
			/compose\.yaml still names another version/
		],
		['unknown option', ['v1.1.0', '--force'], () => {}, /Usage/],
		[
			'no CI at all',
			['v1.1.0', '--dry-run'],
			(e: Env) => fs.writeFileSync(path.join(e.stub, 'checks'), ''),
			/No GitHub Actions checks/
		]
	])('refuses: %s', (_name, args, prepare, message) => {
		prepare(env);
		const r = release(env, args as string[], 'v1.1.0\n');
		expect(r.code).not.toBe(0);
		expect(r.out).toMatch(message);
		expect(fs.existsSync(path.join(env.stub, 'created'))).toBe(false);
	});
});
