# tinx-action

GitHub Action for [tinx](https://github.com/sourceplane/tinx) — the OCI-native provider runtime.

Installs `tinx`, optionally initializes a workspace or installs providers, and runs commands.

## Usage

### Setup only

Install tinx and make it available on `PATH` for subsequent steps:

```yaml
steps:
  - uses: sourceplane/tinx-action@v2
  - run: tinx version
```

### Run a single provider

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: sourceplane/tinx-action@v2
    with:
      run: tinx run ghcr.io/sourceplane/lite-ci:v0.0.2 plan
```

### Install providers and run

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: sourceplane/tinx-action@v2
    with:
      providers: |
        sourceplane/lite-ci as lite-ci
      run: |
        tinx run lite-ci plan
```

### Workspace from manifest

Point `workspace` at a `tinx.yaml` manifest file to initialize the full provider set:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: sourceplane/tinx-action@v2
    with:
      workspace: tinx.yaml
      run: |
        tinx -- lite-ci run plan
```

### Workspace from flags

Create a workspace on the fly by providing a name and a list of providers:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: sourceplane/tinx-action@v2
    with:
      workspace: dev
      providers: |
        sourceplane/lite-ci as lite-ci
        core/node as node
      run: |
        tinx -- lite-ci run plan
        tinx -- node deploy
```

### GitHub Action as provider

Use the `gha://` source to install a GitHub Action as a tinx provider:

```yaml
steps:
  - uses: sourceplane/tinx-action@v2
    with:
      providers: |
        gha://azure/setup-helm@v4 as helm --input version=3.18.4
      run: |
        helm version --short
```

### Outputs and artifacts

Map output files to step outputs and upload artifacts in one step:

```yaml
steps:
  - uses: actions/checkout@v4

  - id: plan
    uses: sourceplane/tinx-action@v2
    with:
      providers: |
        sourceplane/lite-ci as lite-ci
      run: |
        tinx run lite-ci plan
      outputs: |
        plan=plan.json
        version=.tmp/version.txt
      artifacts: |
        plan.json

  - run: echo '${{ steps.plan.outputs.outputs-json }}'
  - run: echo "${{ fromJSON(steps.plan.outputs.outputs-json).plan }}"
```

## Inputs

| Name | Default | Description |
|------|---------|-------------|
| `version` | `latest` | tinx version to install (e.g. `v0.3.0`, `latest`) |
| `install-url` | — | Override for the tinx installer script URL |
| `workspace` | — | Workspace manifest path or workspace name to initialize |
| `providers` | — | Provider install specs, one per line (`<source> [as <alias>] [flags]`) |
| `run` | — | Shell commands to execute after setup |
| `working-directory` | `.` | Working directory for all operations |
| `outputs` | — | Output file mappings (`name=path`, one per line) |
| `artifacts` | — | Artifact paths to upload (one per line) |
| `artifact-name` | `tinx-artifacts` | Name for uploaded artifact bundle |

## Outputs

| Name | Description |
|------|-------------|
| `tinx-version` | Installed tinx version string |
| `outputs-json` | JSON object assembled from output file mappings |

## How it works

1. **Install** — Downloads `tinx` via the official installer and adds it to `PATH`.
2. **Workspace** (optional) — Initializes and activates a workspace from a manifest or name + providers.
3. **Providers** (optional) — Installs standalone providers when no workspace is configured.
4. **Run** (optional) — Executes shell commands with `tinx` and provider aliases on `PATH`.
5. **Outputs** (optional) — Reads mapped files and sets them as step outputs.
6. **Artifacts** (optional) — Uploads files as workflow artifacts.

## Environment

The action exports the following for use in subsequent steps:

| Variable | Description |
|----------|-------------|
| `TINX_INSTALL_DIR` | Directory containing the `tinx` binary |
| `TINX_WORKSPACE` | Active workspace name (set when `workspace` input is provided) |

The `tinx` binary directory is added to `PATH` automatically.

## Runtime

- Runs as a Node.js 20 action bundled with `ncc` to `dist/index.js`.
- Installs `tinx` via the official [install.sh](https://github.com/sourceplane/tinx/blob/main/install.sh).
- Supports `ubuntu-latest`, `macos-latest`, and self-hosted runners with `curl` and `tar`.

## Security

- Provider installs use direct argument passing (no shell interpolation).
- Pin `tinx-action` to a specific SHA or tag for reproducible CI.
- Use `version` to pin a specific `tinx` release.
- Avoid `--plain-http` outside trusted local/dev environments.

## Development

```bash
npm install
npm run build    # bundles src/index.js → dist/index.js
```
