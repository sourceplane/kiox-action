#!/usr/bin/env bash
set -euo pipefail

install -m 0755 "$GITHUB_WORKSPACE/test/fixtures/fake-kiox" "$KIOX_INSTALL_DIR/kiox"