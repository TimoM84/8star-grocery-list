import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

/**
 * Every place that names the app version must agree, so the Release workflow, the image and
 * Dockhand's single APP_VERSION variable never drift apart.
 */

const read = (file: string) => fs.readFileSync(file, 'utf8');
const pkg = JSON.parse(read('package.json')) as { version: string };
const version = pkg.version;

describe('version numbers', () => {
	it('package-lock.json matches package.json', () => {
		const lock = JSON.parse(read('package-lock.json'));
		expect(lock.version).toBe(version);
		expect(lock.packages[''].version).toBe(version);
	});

	it('CHANGELOG.md has release notes for this version as its first release section', () => {
		const headings = [...read('CHANGELOG.md').matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
		const releases = headings.filter((h) => h !== 'Unreleased');
		expect(releases[0]).toBe(version);
	});

	it('the Dockerfile and .env.example default to this version', () => {
		expect(read('Dockerfile')).toContain(`ARG APP_VERSION=${version}`);
		expect(read('.env.example')).toMatch(
			new RegExp(`^APP_VERSION=${version.replace(/\./g, '\\.')}$`, 'm')
		);
	});

	it('compose.yaml uses APP_VERSION for the Git tag, the build argument and the image tag', () => {
		const compose = read('compose.yaml');
		const fallback = `\${APP_VERSION:-${version}}`;
		expect(compose).toContain(
			`context: https://github.com/TimoM84/8star-grocery-list.git#v${fallback}`
		);
		expect(compose).toContain(`APP_VERSION: ${fallback}`);
		expect(compose).toContain(`image: 8star-grocery-list:${fallback}`);
		// No other version anywhere in the file.
		const versions = [...compose.matchAll(/APP_VERSION:-([^}]+)\}/g)].map((m) => m[1]);
		expect(versions).toHaveLength(3);
		expect(new Set(versions)).toEqual(new Set([version]));
	});

	it('the Dockhand compose uses only APP_VERSION, required, for the Git tag, argument and image', () => {
		const compose = read('deploy/dockhand-compose.yaml');
		const required = /\$\{APP_VERSION:\?[^}]+\}/.source;
		expect(compose).toMatch(new RegExp(`image: 8star-grocery-list:${required}`));
		expect(compose).toMatch(
			new RegExp(`context: https://github\\.com/TimoM84/8star-grocery-list\\.git#v${required}`)
		);
		expect(compose).toMatch(new RegExp(`APP_VERSION: ${required}`));
		// No hard-coded version (IP addresses and the "e.g." hint aside).
		const rest = compose.replace(/e\.g\. [\d.]+/g, '').replace(/\d+\.\d+\.\d+\.\d+/g, '');
		expect(rest).not.toMatch(/\d+\.\d+\.\d+/);
	});

	it('the Dockerfile refuses to build a source whose version differs from APP_VERSION', () => {
		const dockerfile = read('Dockerfile');
		expect(dockerfile).toMatch(/require\("\.\/package\.json"\)\.version/);
		expect(dockerfile).toMatch(/"\$APP_VERSION" != "\$PKG_VERSION"/);
	});
});

describe('Release workflow', () => {
	const workflow = read('.github/workflows/release.yml');

	it('is started by hand with a version and only from the default branch', () => {
		expect(workflow).toMatch(/workflow_dispatch:\s+inputs:\s+version:/);
		expect(workflow).toContain('github.ref_name != github.event.repository.default_branch');
	});

	it('uses only GITHUB_TOKEN with the smallest permissions', () => {
		expect(workflow).toMatch(/^permissions: \{\}$/m);
		const granted = [...workflow.matchAll(/^\s+(\w+): (read|write)\b/gm)].map(
			(m) => `${m[1]}:${m[2]}`
		);
		expect(granted.sort()).toEqual(['checks:read', 'contents:write']);
		expect(workflow).toContain('GH_TOKEN: ${{ github.token }}');
		expect(workflow).not.toMatch(/secrets\./);
	});

	it('reuses release.sh non-interactively, waits for CI and never runs two releases at once', () => {
		expect(workflow).toMatch(
			/bash scripts\/release\.sh "v\$\{VERSION#v\}" --yes --wait-for-ci \d+/
		);
		expect(workflow).toContain('IGNORE_CHECK: Publish release');
		expect(workflow).toContain('name: Publish release');
		expect(workflow).toMatch(/concurrency:\s+group: release\s+cancel-in-progress: false/);
		// The typed version reaches the shell only through an environment variable.
		expect(workflow).not.toMatch(/run:[^\n]*\$\{\{\s*inputs\./);
	});
});
