#!/usr/bin/env bash
set -euo pipefail

API_KEY="${HONEYCOMB_API_KEY:-${HC_API_KEY:-}}"
if [[ -z "$API_KEY" ]]; then
  echo "Missing HONEYCOMB_API_KEY (or HC_API_KEY)."
  exit 1
fi

# Disable system collector if it's running (conflicts on port 4318)
if systemctl --quiet is-active otelcol-contrib.service 2>/dev/null; then
  echo "Detected system otelcol-contrib.service (port 4318)."
  if command -v sudo >/dev/null; then
    if sudo -n true 2>/dev/null; then
      sudo systemctl disable --now otelcol-contrib || true
    else
      echo "Run: sudo systemctl disable --now otelcol-contrib"
    fi
  else
    echo "Run: sudo systemctl disable --now otelcol-contrib"
  fi
fi

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
