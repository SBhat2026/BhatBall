# Self-hosted TURN (coturn) for BhatBall Online Rooms

STUN (built into the game) already covers same-wifi and most home networks.
A TURN relay covers the rest — symmetric NAT, school/corporate wifi, cellular —
so rooms work **no matter what network** each player is on.

## What you need

- A small always-on Linux box with a **public IP**: any cheap VPS works
  (DigitalOcean / Hetzner / Vultr / Fly.io / a home server with a forwarded
  port). 1 vCPU / 512MB is plenty — TURN just forwards packets.

## Install (2 commands on the server)

```bash
# copy this folder to the server, then:
sudo bash setup-coturn.sh <PUBLIC_IP>
```

That installs coturn, writes `/etc/turnserver.conf` (from `turnserver.conf`),
opens the firewall ports, starts the service, and **prints the exact
`window.BHATBALL_ICE` snippet** to paste into `index.html`.

Ports it uses (open these in your cloud provider's firewall too):
`3478/udp`, `3478/tcp`, and `49152-65535/udp` (relay range).

## Turn it on in the game

Paste the printed snippet into `index.html` just after the peerjs `<script>`
tag (there's a commented block showing exactly where). Commit + redeploy. Done —
the game now uses your relay for the hard cases and direct/STUN for the rest.

## Verify it actually relays

Open the [Trickle-ICE tester](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/),
enter `turn:<PUBLIC_IP>:3478` with user `bhatball` and your password, and click
*Gather candidates*. You should see a row of type **relay**. If you do, remote
joining works on every network.

## Notes

- The username/password live in client JS — that's fine for a hobby relay. The
  config caps per-session and total bandwidth to keep abuse cheap.
- For port-443 / TLS (gets through the strictest firewalls) add certs and
  uncomment the `tls-listening-port` lines in `turnserver.conf`.
