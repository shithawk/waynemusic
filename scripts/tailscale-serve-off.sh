#!/bin/bash
set -euo pipefail
tailscale serve --https=443 off
tailscale serve --https=8443 off
tailscale serve status || true