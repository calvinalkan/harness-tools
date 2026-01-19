#!/usr/bin/env bash
set -euo pipefail

API_KEY="hcbik_01kf9whv0ds6ft674r13p2c2s208c4qjr3k8nyp632f84p0jx0zr4a905y"

# Update config with API key
sed -i "s|YOUR_HONEYCOMB_API_KEY_HERE|$API_KEY|" ~/.config/otelcol/pi.yaml
sed -i 's|# Replace with your actual Honeycomb API key||' ~/.config/otelcol/pi.yaml

# Remove old env file
rm -f ~/.config/otelcol/env

# Install updated service file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/otelcol-pi.service" ~/.config/systemd/user/

# Reload and restart
systemctl --user daemon-reload
systemctl --user restart otelcol-pi

echo "Done. Checking status..."
sleep 2
systemctl --user status otelcol-pi --no-pager
