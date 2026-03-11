# tinx-action

Thin GitHub Action wrapper for `tinx`.

## Design

- Default behavior is only: `tinx run <provider-ref> <capability> [args...]`
- GitHub-specific features are optional and explicit via inputs:
  - `outputs`: map files into `outputs-json`
  - `artifacts`: upload selected files

This keeps providers portable across local/CI environments.

## Inputs

- `run` (required): CLI-style run spec, e.g. `ghcr.io/sourceplane/lite-ci:v0.0.2 plan`
- `working-directory` (optional, default `.`)
- `outputs` (optional): newline-delimited `name=path`
- `artifacts` (optional): newline-delimited file paths
- `artifact-name` (optional, default `tinx-artifacts`)
- `tinx-version` (optional, default `latest`)
- `install-url` (optional, default official `install.sh` URL)

## Outputs

- `outputs-json`: JSON object assembled from `outputs` mappings.

Note: this action exposes a stable `outputs-json` output. Use `fromJSON(...)` in downstream steps/jobs to read specific keys.

## Usage

### Minimal

```yaml
name: CI

on:
  workflow_dispatch:

jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: sourceplane/tinx-action@v1
        with:
          run: ghcr.io/sourceplane/lite-ci:v0.0.2 plan
```

### Explicit outputs and artifacts

```yaml
name: CI

on:
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - id: tinx
        uses: sourceplane/tinx-action@v1
        with:
          run: ghcr.io/sourceplane/lite-ci:v0.0.2 build --repo .
          outputs: |
            image=.tmp/image.txt
            version=.tmp/version.txt
          artifacts: |
            plan.json
            reports/test.xml

      - name: Print JSON output blob
        run: echo '${{ steps.tinx.outputs.outputs-json }}'

      - name: Read one output field
        run: echo "image=${{ fromJSON(steps.tinx.outputs.outputs-json).image }}"
```

## Notes

- Keep provider behavior inside provider logic; avoid action-level workflow abstraction.
- `run` is intentionally aligned with CLI syntax.
- Output file paths are resolved from `working-directory` unless absolute.
- Installation follows standard setup-action behavior: path is exported for subsequent steps, and the action executes via a deterministic `TINX_BIN` path.
- When `tinx-version: latest` is used, the action resolves the release tag via authenticated GitHub API (`github.token`) to reduce rate-limit failures.
