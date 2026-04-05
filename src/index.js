const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DefaultArtifactClient } = require('@actions/artifact');

/* ── Helpers ────────────────────────────────────────────── */

function lines(input) {
  return (input || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
}

function parseOutputMappings(raw) {
  return lines(raw).map(entry => {
    const i = entry.indexOf('=');
    if (i <= 0 || i === entry.length - 1) {
      throw new Error(`Invalid output mapping '${entry}' — expected name=path`);
    }
    return { name: entry.slice(0, i).trim(), path: entry.slice(i + 1).trim() };
  });
}

function abs(base, p) {
  return path.isAbsolute(p) ? p : path.join(base, p);
}

function shellQuote(s) {
  return "'" + s.replace(/'/g, "'\\''" ) + "'";
}

async function fileExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function capture(bin, args) {
  let stdout = '';
  await exec.exec(bin, args, {
    listeners: { stdout: d => { stdout += d.toString(); } },
    silent: true,
  });
  return stdout.trim();
}

/* ── Install ────────────────────────────────────────────── */

async function installTinx(version, installUrl) {
  const dir = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'tinx-bin');
  await fsp.mkdir(dir, { recursive: true });

  core.exportVariable('TINX_INSTALL_DIR', dir);
  core.addPath(dir);

  const url = installUrl || 'https://raw.githubusercontent.com/sourceplane/tinx/main/install.sh';
  const script = [
    `export TINX_INSTALL_DIR=${shellQuote(dir)}`,
    `export TINX_VERSION=${shellQuote(version)}`,
    `curl -fsSL ${shellQuote(url)} | bash`,
  ].join('\n');

  await exec.exec('bash', ['-e', '-o', 'pipefail', '-c', script], {
    failOnStdErr: false,
  });

  const bin = path.join(dir, 'tinx');
  await fsp.access(bin, fs.constants.X_OK);

  const ver = await capture(bin, ['version']);
  core.info(`tinx ${ver} installed → ${bin}`);
  core.setOutput('tinx-version', ver);
  return bin;
}

/* ── Workspace ──────────────────────────────────────────── */

async function initWorkspace(bin, workspace, providers, cwd) {
  const resolved = abs(cwd, workspace);
  const isFile = (await fileExists(resolved)) && (await fsp.stat(resolved)).isFile();
  let name;

  if (isFile) {
    core.info(`Initializing workspace from manifest: ${resolved}`);
    await exec.exec(bin, ['init', resolved], { cwd });

    const yaml = await fsp.readFile(resolved, 'utf8');
    const m = yaml.match(/^workspace:\s*(.+)$/m);
    if (!m) {
      throw new Error(
        `Cannot extract workspace name from ${workspace}. Ensure the manifest contains a 'workspace:' field.`
      );
    }
    name = m[1].trim();
  } else {
    name = workspace;
    const args = ['init', name];
    for (const p of providers) {
      args.push('-p', ...p.split(/\s+/));
    }
    core.info(`Initializing workspace '${name}' with ${providers.length} provider(s)`);
    await exec.exec(bin, args, { cwd });
  }

  core.exportVariable('TINX_WORKSPACE', name);
  return name;
}

/* ── Providers (standalone) ─────────────────────────────── */

async function installProviders(bin, providers, cwd) {
  for (const spec of providers) {
    core.info(`Installing provider: ${spec}`);
    const args = ['install', ...spec.split(/\s+/)];
    await exec.exec(bin, args, { cwd });
  }
}

/* ── Run ────────────────────────────────────────────────── */

async function runCommands(bin, script, workspaceName, cwd) {
  const parts = [];
  if (workspaceName) {
    parts.push(`${shellQuote(bin)} use ${shellQuote(workspaceName)}`);
  }
  parts.push(script);

  await exec.exec('bash', ['-e', '-o', 'pipefail', '-c', parts.join('\n')], {
    cwd,
    failOnStdErr: false,
  });
}

/* ── Outputs ────────────────────────────────────────────── */

async function collectOutputs(raw, cwd) {
  const mappings = parseOutputMappings(raw);
  if (!mappings.length) return;

  const payload = {};
  for (const m of mappings) {
    const p = abs(cwd, m.path);
    const val = (await fsp.readFile(p, 'utf8')).trim();
    core.setOutput(m.name, val);
    payload[m.name] = val;
  }
  core.setOutput('outputs-json', JSON.stringify(payload));
}

/* ── Artifacts ──────────────────────────────────────────── */

async function uploadArtifacts(raw, name, cwd) {
  const paths = lines(raw).map(p => abs(cwd, p));
  if (!paths.length) return;

  const files = [];
  for (const p of paths) {
    try {
      if ((await fsp.stat(p)).isFile()) files.push(p);
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
    const version      = core.getInput('version') || 'latest';
    const installUrl   = core.getInput('install-url');
    const workspace    = core.getInput('workspace');
    const providersRaw = core.getInput('providers');
    const runScript    = core.getInput('run');
    const workDirInput = core.getInput('working-directory') || '.';
    const outputsRaw   = core.getInput('outputs');
    const artifactsRaw = core.getInput('artifacts');
    const artifactName = core.getInput('artifact-name') || 'tinx-artifacts';

    const cwd = path.resolve(process.cwd(), workDirInput);
    const providers = lines(providersRaw);

    // 1 ── Install tinx
    core.startGroup('Install tinx');
    const bin = await installTinx(version, installUrl);
    core.endGroup();

    // 2 ── Configure workspace or install standalone providers
    let wsName = '';
    if (workspace) {
      core.startGroup('Initialize workspace');
      wsName = await initWorkspace(bin, workspace, providers, cwd);
      core.endGroup();
    } else if (providers.length) {
      core.startGroup('Install providers');
      await installProviders(bin, providers, cwd);
      core.endGroup();
    }

    // 3 ── Execute user commands
    if (runScript) {
      core.startGroup('Run');
      await runCommands(bin, runScript, wsName, cwd);
      core.endGroup();
    }

    // 4 ── Collect outputs
    if (outputsRaw) {
      core.startGroup('Collect outputs');
      await collectOutputs(outputsRaw, cwd);
      core.endGroup();
    }

    // 5 ── Upload artifacts
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
