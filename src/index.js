const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DefaultArtifactClient } = require('@actions/artifact');

const defaultKioxRepo = 'sourceplane/kiox';

/* ── Helpers ────────────────────────────────────────────── */

function lines(input) {
  return (input || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function parseOutputMappings(raw) {
  return lines(raw).map(entry => {
    const index = entry.indexOf('=');
    if (index <= 0 || index === entry.length - 1) {
      throw new Error(`Invalid output mapping '${entry}' - expected name=path`);
    }
    return { name: entry.slice(0, index).trim(), path: entry.slice(index + 1).trim() };
  });
}

function abs(base, value) {
  return path.isAbsolute(value) ? value : path.join(base, value);
}

function shellQuote(value) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function splitCommandLine(input) {
  const words = [];
  let current = '';
  let quote = '';
  let escape = false;

  for (const ch of input || '') {
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      escape = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = '';
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (escape) {
    current += '\\';
  }
  if (quote) {
    throw new Error(`Unterminated quote in provider spec: ${input}`);
  }
  if (current) {
    words.push(current);
  }
  return words;
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function capture(bin, args, options = {}) {
  let stdout = '';
  await exec.exec(bin, args, {
    listeners: { stdout: data => { stdout += data.toString(); } },
    silent: true,
    ...options,
  });
  return stdout.trim();
}

function githubRequestHeaders() {
  const headers = { accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

async function resolveLatestKioxReleaseTag(repo = defaultKioxRepo) {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: githubRequestHeaders(),
  });
  if (!response.ok) {
    throw new Error(`failed to resolve latest kiox release tag for ${repo}: ${response.status}`);
  }
  const release = await response.json();
  const tag = typeof release?.tag_name === 'string' ? release.tag_name.trim() : '';
  if (!tag) {
    throw new Error(`latest release response for ${repo} did not include tag_name`);
  }
  return tag;
}

async function resolveKioxVersion(versionInput, repo = defaultKioxRepo) {
  const requested = (versionInput || '').trim();
  if (requested && requested !== 'latest') {
    return requested;
  }
  const resolved = await resolveLatestKioxReleaseTag(repo);
  core.info(`Resolved kiox version ${resolved}`);
  return resolved;
}

function defaultInstallUrlForVersion(version, repo = defaultKioxRepo) {
  return `https://raw.githubusercontent.com/${repo}/${version}/install.sh`;
}

function parseWorkspaceInfo(output, fallbackRoot) {
  const name = output.match(/^workspace:\s*(.+)$/m)?.[1]?.trim() || path.basename(fallbackRoot);
  const root = fallbackRoot;
  return {
    name,
    root,
    manifest: path.join(root, 'kiox.yaml'),
  };
}

async function ensureKioxHome() {
  const home = process.env.KIOX_HOME || path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'kiox-home');
  await fsp.mkdir(home, { recursive: true });
  core.exportVariable('KIOX_HOME', home);
  core.exportVariable('KIOX_GLOBAL_HOME', home);
  return home;
}

function exportWorkspaceInfo(info) {
  core.exportVariable('KIOX_WORKSPACE', info.name);
  core.exportVariable('KIOX_WORKSPACE_ROOT', info.root);
  core.exportVariable('KIOX_WORKSPACE_MANIFEST', info.manifest);
  core.setOutput('workspace-name', info.name);
  core.setOutput('workspace-root', info.root);
}

/* ── Install ────────────────────────────────────────────── */

async function installKiox(version, installUrl) {
  const dir = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'kiox-bin');
  await fsp.mkdir(dir, { recursive: true });

  core.exportVariable('KIOX_INSTALL_DIR', dir);
  core.exportVariable('KIOX_BIN', path.join(dir, 'kiox'));
  core.addPath(dir);

  const url = installUrl || 'https://raw.githubusercontent.com/sourceplane/kiox/main/install.sh';
  const script = [
    `export KIOX_INSTALL_DIR=${shellQuote(dir)}`,
    `export KIOX_VERSION=${shellQuote(version)}`,
    `curl -fsSL ${shellQuote(url)} | bash`,
  ].join('\n');

  await exec.exec('bash', ['-e', '-o', 'pipefail', '-c', script], {
    failOnStdErr: false,
  });

  const bin = path.join(dir, 'kiox');
  await fsp.access(bin, fs.constants.X_OK);

  const resolvedVersion = await capture(bin, ['version']);
  core.info(`kiox ${resolvedVersion} installed -> ${bin}`);
  core.setOutput('kiox-version', resolvedVersion);
  return bin;
}

/* ── Workspace ──────────────────────────────────────────── */

async function resolveWorkspaceTarget(cwd, workspaceInput) {
  if (workspaceInput) {
    const resolved = abs(cwd, workspaceInput);
    if (await fileExists(resolved)) {
      const stat = await fsp.stat(resolved);
      if (stat.isFile()) {
        return { initTarget: resolved, root: path.dirname(resolved), implicit: false };
      }
    }
    return { initTarget: resolved, root: resolved, implicit: false };
  }

  const root = await fsp.mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'kiox-action-workspace-'));
  return { initTarget: root, root, implicit: true };
}

async function describeWorkspace(bin, workspaceRoot, cwd) {
  const output = await capture(bin, ['--workspace', workspaceRoot, 'workspace', 'current'], { cwd });
  return parseWorkspaceInfo(output, workspaceRoot);
}

async function initWorkspace(bin, workspaceInput, cwd) {
  const target = await resolveWorkspaceTarget(cwd, workspaceInput);
  if (target.implicit) {
    core.info(`Initializing transient workspace: ${target.root}`);
  } else {
    core.info(`Initializing workspace: ${target.initTarget}`);
  }

  await exec.exec(bin, ['init', target.initTarget], { cwd });
  const info = await describeWorkspace(bin, target.root, cwd);
  return { ...info, implicit: target.implicit };
}

async function addProviders(bin, workspaceRoot, providers, cwd) {
  for (const spec of providers) {
    core.info(`Adding provider: ${spec}`);
    const args = ['--workspace', workspaceRoot, 'add', ...splitCommandLine(spec)];
    await exec.exec(bin, args, { cwd });
  }
}

/* ── Run ────────────────────────────────────────────────── */

async function runCommands(bin, script, workspaceRoot, cwd) {
  if (!workspaceRoot) {
    await exec.exec('bash', ['-e', '-o', 'pipefail', '-c', script], {
      cwd,
      failOnStdErr: false,
    });
    return;
  }

  const wrappedScript = [`cd ${shellQuote(cwd)}`, script].join('\n');
  await exec.exec(bin, ['--workspace', workspaceRoot, 'exec', '--', 'bash', '-e', '-o', 'pipefail', '-c', wrappedScript], {
    cwd,
    failOnStdErr: false,
  });
}

/* ── Outputs ────────────────────────────────────────────── */

async function collectOutputs(raw, cwd) {
  const mappings = parseOutputMappings(raw);
  if (!mappings.length) {
    return;
  }

  const payload = {};
  for (const mapping of mappings) {
    const filePath = abs(cwd, mapping.path);
    const value = (await fsp.readFile(filePath, 'utf8')).trim();
    core.setOutput(mapping.name, value);
    payload[mapping.name] = value;
  }
  core.setOutput('outputs-json', JSON.stringify(payload));
}

/* ── Artifacts ──────────────────────────────────────────── */

async function uploadArtifacts(raw, name, cwd) {
  const paths = lines(raw).map(filePath => abs(cwd, filePath));
  if (!paths.length) {
    return;
  }

  const files = [];
  for (const filePath of paths) {
    try {
      if ((await fsp.stat(filePath)).isFile()) {
        files.push(filePath);
      }
    } catch {
      /* skip missing */
    }
  }

  if (!files.length) {
    core.info('No artifact files found to upload.');
    return;
  }

  const client = new DefaultArtifactClient();
  await client.uploadArtifact(name, files, cwd, { compressionLevel: 6 });
  core.info(`Uploaded ${files.length} file(s) as '${name}'`);
}

/* ── Main ───────────────────────────────────────────────── */

async function main() {
  try {
    const versionInput = core.getInput('version');
    const resolvedVersion = await resolveKioxVersion(versionInput);
    const installUrl = core.getInput('install-url') || defaultInstallUrlForVersion(resolvedVersion);
    const workspace = core.getInput('workspace');
    const providersRaw = core.getInput('providers');
    const runScript = core.getInput('run');
    const workDirInput = core.getInput('working-directory') || '.';
    const outputsRaw = core.getInput('outputs');
    const artifactsRaw = core.getInput('artifacts');
    const artifactName = core.getInput('artifact-name') || 'kiox-artifacts';

    const cwd = path.resolve(process.cwd(), workDirInput);
    const providers = lines(providersRaw);

    await ensureKioxHome();

    core.startGroup('Install kiox');
    const bin = await installKiox(resolvedVersion, installUrl);
    core.endGroup();

    let workspaceInfo = null;
    if (workspace || providers.length) {
      core.startGroup('Prepare workspace');
      workspaceInfo = await initWorkspace(bin, workspace, cwd);
      if (providers.length) {
        await addProviders(bin, workspaceInfo.root, providers, cwd);
      }
      exportWorkspaceInfo(workspaceInfo);
      if (workspaceInfo.implicit) {
        core.info(`Providers are attached to a transient workspace at ${workspaceInfo.root}`);
      }
      core.endGroup();
    }

    if (runScript) {
      core.startGroup('Run');
      await runCommands(bin, runScript, workspaceInfo && workspaceInfo.root, cwd);
      core.endGroup();
    }

    if (outputsRaw) {
      core.startGroup('Collect outputs');
      await collectOutputs(outputsRaw, cwd);
      core.endGroup();
    }

    if (artifactsRaw) {
      core.startGroup('Upload artifacts');
      await uploadArtifacts(artifactsRaw, artifactName, cwd);
      core.endGroup();
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

main();
