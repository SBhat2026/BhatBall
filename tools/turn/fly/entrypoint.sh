#!/bin/sh
# coturn launcher for Fly.io.
#
# Fly delivers UDP only to a process bound to the `fly-global-services` address,
# so we resolve it and bind coturn there. ICE candidates must advertise the
# app's DEDICATED public IPv4 instead of that internal address — external-ip
# does the public/private mapping. EXTERNAL_IP + TURN_PASSWORD come from Fly
# secrets; MIN_PORT/MAX_PORT match the relay range exposed in fly.toml.
set -eu

FGS_IP="$(getent hosts fly-global-services | awk '{print $1}' | head -n1)"
: "${FGS_IP:=0.0.0.0}"
# Fly's TCP proxy dials the machine's eth0 address, NOT fly-global-services
# (that address only carries UDP) — so TCP TURN needs a second listener there.
ETH_IP="$(ip -4 -o addr show eth0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -n1 || true)"
: "${EXTERNAL_IP:?set EXTERNAL_IP to the app's dedicated IPv4 (fly secrets set)}"
: "${TURN_PASSWORD:?set TURN_PASSWORD (fly secrets set)}"
: "${MIN_PORT:=50000}"
: "${MAX_PORT:=50009}"

echo "coturn: bind=${FGS_IP}+${ETH_IP:-none} external=${EXTERNAL_IP} relay=${MIN_PORT}-${MAX_PORT}"

# 443 via --aux-server (a full extra TURN endpoint). --alt-listening-port is the
# RFC 5780 CHANGE-REQUEST port — coturn silently skips binding it with a single
# listening IP, which is why the earlier 443 attempt never opened a socket.
exec turnserver -n \
  --listening-ip="${FGS_IP}" \
  ${ETH_IP:+--listening-ip="${ETH_IP}"} \
  --relay-ip="${FGS_IP}" \
  --external-ip="${EXTERNAL_IP}/${FGS_IP}" \
  ${ETH_IP:+--external-ip="${EXTERNAL_IP}/${ETH_IP}"} \
  --listening-port=3478 \
  --aux-server="${FGS_IP}:443" \
  ${ETH_IP:+--aux-server="${ETH_IP}:443"} \
  --min-port="${MIN_PORT}" --max-port="${MAX_PORT}" \
  --lt-cred-mech \
  --user="bhatball:${TURN_PASSWORD}" \
  --realm=bhatball \
  --fingerprint \
  --no-cli \
  --no-tlsv1 --no-tlsv1_1 \
  --no-multicast-peers \
  --denied-peer-ip=0.0.0.0-0.255.255.255 \
  --denied-peer-ip=10.0.0.0-10.255.255.255 \
  --denied-peer-ip=127.0.0.0-127.255.255.255 \
  --denied-peer-ip=169.254.0.0-169.254.255.255 \
  --denied-peer-ip=172.16.0.0-172.31.255.255 \
  --denied-peer-ip=192.168.0.0-192.168.255.255 \
  --max-bps=1000000
