#!/usr/bin/env bash
# Install + configure coturn as the TURN relay for BhatBall Online Rooms.
# Run ON THE SERVER (Ubuntu/Debian VM with a public IP), as root.
#
#   sudo ./setup-coturn.sh <PUBLIC_IP> [TURN_PASSWORD]
#
# If PASSWORD is omitted, a strong one is generated and printed. At the end it
# prints the exact window.BHATBALL_ICE snippet to paste into index.html.
set -euo pipefail

PUBLIC_IP="${1:-}"
PASSWORD="${2:-$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)}"

if [[ -z "$PUBLIC_IP" ]]; then
  echo "usage: sudo $0 <PUBLIC_IP> [TURN_PASSWORD]" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "run as root (sudo)" >&2
  exit 1
fi

CONF_SRC="$(dirname "$0")/turnserver.conf"

echo "==> installing coturn"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y coturn >/dev/null

echo "==> writing /etc/turnserver.conf"
mkdir -p /var/log/turnserver
sed -e "s/__PUBLIC_IP__/${PUBLIC_IP}/g" \
    -e "s/__TURN_PASSWORD__/${PASSWORD}/g" \
    "$CONF_SRC" > /etc/turnserver.conf

# Let the Debian package start the daemon.
sed -i 's/^#*TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn 2>/dev/null || \
  echo 'TURNSERVER_ENABLED=1' >> /etc/default/coturn

echo "==> opening firewall (ufw, if present)"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 3478/tcp  >/dev/null 2>&1 || true
  ufw allow 3478/udp  >/dev/null 2>&1 || true
  ufw allow 49152:65535/udp >/dev/null 2>&1 || true
fi

echo "==> starting coturn"
systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn

sleep 1
systemctl --no-pager --full status coturn | head -n 5 || true

cat <<EOF

============================================================================
 coturn is up. Paste this into index.html (uncomment the BHATBALL_ICE block):

   <script>
     window.BHATBALL_ICE = [
       { urls: 'stun:stun.l.google.com:19302' },
       { urls: 'turn:${PUBLIC_IP}:3478?transport=udp', username: 'bhatball', credential: '${PASSWORD}' },
       { urls: 'turn:${PUBLIC_IP}:3478?transport=tcp', username: 'bhatball', credential: '${PASSWORD}' },
     ];
   </script>

 Verify from a browser console anywhere:
   Trickle-ICE test → https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
   (enter turn:${PUBLIC_IP}:3478, user bhatball, pass above — expect a 'relay' row)
============================================================================
EOF
