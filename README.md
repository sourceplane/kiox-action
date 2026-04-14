# tinx-action

GitHub Action for [tinx](https://github.com/sourceplane/tinx) — the OCI-native provider runtime.

Installs `tinx`, optionally initializes a workspace, adds providers, and runs commands through the current workspace-first tinx execution model.

When `workspace` or `providers` is set, the action runs the `run` script inside a tinx workspace. That matches current tinx behavior, where provider execution goes through `tinx exec` or `tinx -- ...`, not `tinx run`.

## Usage

### Setup only

Install tinx and make it available on `PATH` for subsequent steps:

```yaml
steps:
  - uses: sourceplane/tinx-action@v2
  - run: tinx version
```

### Run commands in a transient workspace

```yaml
steps:
  - uses: sourceplane/tinx-action@v2
    with:
      providers: |
        sourceplane/lite-ci:v0.2.25 as lite-ci
      run: |
        lite-ci --help
```

When `providers` is set without `workspace`, the action creates a transient workspace under the runner temp directory and exports its root as `TINX_WORKSPACE_ROOT`.

### Initialize a reusable workspace

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: sourceplane/tinx-action@v2
    with:
      workspace: ./.github/tinx-ci
      providers: |
        sourceplane/lite-ci:v0.2.25 as lite-ci

  - run: tinx --workspace "$TINX_WORKSPACE_ROOT" provider list
```

### Workspace from manifest

Point `workspace` at a workspace manifest file to initialize the full provider set:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: sourceplane/tinx-action@v2
    with:
      workspace: .github/tinx.yaml
      run: |
        lite-ci plan
```

The referenced manifest must be a tinx workspace manifest with `kind: Workspace`, not a provider `tinx.yaml`.

### Workspace from flags

Create a workspace on the fly by providing a name and a list of providers:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: sourceplane/tinx-action@v2
    with:
      workspace: dev
      providers: |
        sourceplane/lite-ci:v0.2.25 as lite-ci
      run: |
        lite-ci --help
```

### Outputs and artifacts

Map output files to step outputs and upload artifacts in one step:

```yaml
steps:
  - uses: actions/checkout@v4

  - id: node
    uses: sourceplane/tinx-action@v2
    with:
      providers: |
        sourceplane/lite-ci:v0.2.25 as lite-ci
      run: |
        mkdir -p .tmp
        lite-ci --help > .tmp/lite-ci-help.txt
      outputs: |
        lite-ci-help=.tmp/lite-ci-help.txt
      artifacts: |
        .tmp/lite-ci-help.txt

  - run: echo '${{ steps.node.outputs.outputs-json }}'
  - run: echo "${{ steps.node.outputs.lite-ci-help }}"
```

## Inputs

| Name | Default | Description |
|------|---------|-------------|
| `version` | `latest` | tinx version to install (for example `v0.3.0` or `latest`) |
| `install-url` | — | Override for the tinx installer script URL |
| `workspace` | — | Workspace manifest path (`kind: Workspace`) or workspace directory/name to initialize |
| `providers` | — | Provider specs to add to the workspace, one per line (`<source> [as <alias>] [--plain-http]`) |
| `run` | — | Shell commands to execute after setup |
| `working-directory` | `.` | Working directory for all operations |
| `outputs` | — | Output file mappings (`name=path`, one per line) |
| `artifacts` | — | Artifact paths to upload (one per line) |
| `artifact-name` | `tinx-artifacts` | Name for uploaded artifact bundle |

## Outputs

| Name | Description |
|------|-------------|
| `tinx-version` | Installed tinx version string |
| `workspace-name` | Initialized workspace name |
| `workspace-root` | Initialized workspace root directory |
| `outputs-json` | JSON object assembled from output file mappings |

## How it works

1. **Install** — Downloads `tinx` via the official installer and adds it to `PATH`.
2. **Workspace** (optional) — Initializes a named, directory-backed, or manifest-backed workspace when `workspace` or `providers` is set.
3. **Providers** (optional) — Adds providers to that workspace with `tinx add`.
4. **Run** (optional) — Executes shell commands inside the workspace environment so provider aliases are available on `PATH`.
5. **Outputs** (optional) — Reads mapped files and sets them as step outputs.
6. **Artifacts** (optional) — Uploads files as workflow artifacts.

## Environment

The action exports the following for use in subsequent steps:

| Variable | Description |
|----------|-------------|
| `TINX_HOME` | Global tinx home used by the action |
| `TINX_GLOBAL_HOME` | Same global tinx home path |
| `TINX_INSTALL_DIR` | Directory containing the `tinx` binary |
| `TINX_BIN` | Full path to the installed `tinx` binary |
| `TINX_WORKSPACE` | Initialized workspace name |
| `TINX_WORKSPACE_ROOT` | Initialized workspace root directory |
| `TINX_WORKSPACE_MANIFEST` | Initialized workspace manifest path |

The `tinx` binary directory is added to `PATH` automatically.

For later steps, prefer `tinx --workspace "$TINX_WORKSPACE_ROOT" -- <command>` if you want to target the workspace created by the action explicitly.

## Runtime

- Runs as a Node.js 20 action bundled with `ncc` to `dist/index.js`.
- Installs `tinx` via the official [install.sh](https://github.com/sourceplane/tinx/blob/main/install.sh).
- Supports `ubuntu-latest`, `macos-latest`, and self-hosted runners with `curl` and `tar`.

## Security

- Provider additions use direct argument passing (no shell interpolation).
- Pin `tinx-action` to a specific SHA or tag for reproducible CI.
- Use `version` to pin a specific `tinx` release.
- Avoid `--plain-http` outside trusted local/dev environments.

## Development

```bash
npm install
npm run build    # bundles src/index.js → dist/index.js
```
