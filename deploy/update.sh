#!/usr/bin/env bash
# Pull the latest Crux code and restart it. Run on the server:  sudo bash /opt/crux/deploy/update.sh
set -euo pipefail
cd /opt/crux
sudo -u crux git pull --ff-only
sudo -u crux npm install --omit=dev --no-audit --no-fund
systemctl restart crux
sleep 1
systemctl is-active crux && echo "Crux updated and running."
