# kiox-action

GitHub Action for [kiox](https://github.com/sourceplane/kiox) — the OCI-native provider runtime.

Installs `kiox`, optionally initializes a workspace, adds providers, and runs commands through the current workspace-first kiox execution model.

When `workspace` or `providers` is set, the action runs the `run` script inside a kiox workspace. That matches current kiox behavior, where provider execution goes through `kiox exec` or `kiox -- ...`, not `kiox run`.

## Usage

### Setup only

Install kiox and make it available on `PATH` for subsequent steps:

```yaml
steps:
  - uses: sourceplane/kiox-action@v2
  - run: kiox version
```

### Run commands in a transient workspace

```yaml
steps:
  - uses: sourceplane/kiox-action@v2
    with:
      providers: |
        sourceplane/lite-ci:v0.2.25 as lite-ci
      run: |
        lite-ci --help
```

When `providers` is set without `workspace`, the action creates a transient workspace under the runner temp directory and exports its root as `KIOX_WORKSPACE_ROOT`.

### Initialize a reusable workspace

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: sourceplane/kiox-action@v2
    with:
      workspace: ./.github/kiox-ci
      providers: |
        sourceplane/lite-ci:v0.2.25 as lite-ci

  - run: kiox --workspace "$KIOX_WORKSPACE_ROOT" provider list
```

### Workspace from manifest

Point `workspace` at a workspace manifest file to initialize the full provider set:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: sourceplane/kiox-action@v2
    with:
      workspace: .github/kiox.yaml
      run: |
        lite-ci plan
```

The referenced manifest must be a kiox workspace manifest with `kind: Workspace`, not a provider `kiox.yaml`.

### Workspace from flags

Create a workspace on the fly by providing a name and a list of providers:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: sourceplane/kiox-action@v2
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
    uses: sourceplane/kiox-action@v2
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
| `version` | — | kiox version to install (for example `v0.4.2`); when omitted or set to `latest`, the action resolves the latest published kiox release tag |
| `install-url` | — | Override for the kiox installer script URL; when omitted, the action uses `install.sh` from the resolved kiox tag |
| `workspace` | — | Workspace manifest path (`kind: Workspace`) or workspace directory/name to initialize |
| `providers` | — | Provider specs to add to the workspace, one per line (`<source> [as <alias>] [--plain-http]`) |
| `run` | — | Shell commands to execute after setup |
| `working-directory` | `.` | Working directory for all operations |
| `outputs` | — | Output file mappings (`name=path`, one per line) |
| `artifacts` | — | Artifact paths to upload (one per line) |
| `artifact-name` | `kiox-artifacts` | Name for uploaded artifact bundle |

## Outputs

| Name | Description |
|------|-------------|
| `kiox-version` | Installed kiox version string |
| `workspace-name` | Initialized workspace name |
| `workspace-root` | Initialized workspace root directory |
| `outputs-json` | JSON object assembled from output file mappings |

## How it works

1. **Install** — Resolves a concrete kiox release tag, downloads the installer from that tag, and adds `kiox` to `PATH`.
2. **Workspace** (optional) — Initializes a named, directory-backed, or manifest-backed workspace when `workspace` or `providers` is set.
3. **Providers** (optional) — Adds providers to that workspace with `kiox add`.
4. **Run** (optional) — Executes shell commands inside the workspace environment so provider aliases are available on `PATH`.
5. **Outputs** (optional) — Reads mapped files and sets them as step outputs.
6. **Artifacts** (optional) — Uploads files as workflow artifacts.

## Environment

The action exports the following for use in subsequent steps:

| Variable | Description |
|----------|-------------|
| `KIOX_HOME` | Global kiox home used by the action |
| `KIOX_GLOBAL_HOME` | Same global kiox home path |
| `KIOX_INSTALL_DIR` | Directory containing the `kiox` binary |
| `KIOX_BIN` | Full path to the installed `kiox` binary |
| `KIOX_WORKSPACE` | Initialized workspace name |
| `KIOX_WORKSPACE_ROOT` | Initialized workspace root directory |
| `KIOX_WORKSPACE_MANIFEST` | Initialized workspace manifest path |

The `kiox` binary directory is added to `PATH` automatically.

For later steps, prefer `kiox --workspace "$KIOX_WORKSPACE_ROOT" -- <command>` if you want to target the workspace created by the action explicitly.

## Runtime

- Runs as a Node.js 20 action bundled with `ncc` to `dist/index.js`.
- Installs `kiox` via the official `install.sh` script from the resolved release tag.
- Supports `ubuntu-latest`, `macos-latest`, and self-hosted runners with `curl` and `tar`.

## Security

- Provider additions use direct argument passing (no shell interpolation).
- Pin `kiox-action` to a specific SHA or tag for reproducible CI.
- Use `version` to pin a specific `kiox` release.
- Avoid `--plain-http` outside trusted local/dev environments.

## Development

```bash
npm install
npm run build    # bundles src/index.js → dist/index.js
```
