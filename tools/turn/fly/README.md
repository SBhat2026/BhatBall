# TURN relay on Fly.io (coturn)

This is the live relay that makes BhatBall Online Rooms work on **any** network
(coffee-shop / school / corporate wifi, cellular, symmetric NAT). STUN alone,
built into the game, only covers same-wifi and lenient home routers.

**Deployed app:** `bhatball-turn` · dedicated IPv4 `77.83.142.36` · region `sjc`.
The game points at it via `window.BHATBALL_ICE` in `index.html`.

## Files

- `Dockerfile` — coturn 4.6 (alpine) + entrypoint.
- `entrypoint.sh` — binds coturn to Fly's `fly-global-services` (required for UDP)
  and advertises the dedicated public IPv4 via `external-ip`.
- `fly.toml` — exposes `3478/udp`, `3478/tcp`, and relay range `50000-50009/udp`.

## Recreate / redeploy from scratch

```bash
cd tools/turn/fly
fly apps create bhatball-turn
fly ips allocate-v4 -a bhatball-turn --yes          # dedicated IPv4, ~$2/mo
PW=$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
fly secrets set -a bhatball-turn EXTERNAL_IP=<THE_IPV4> TURN_PASSWORD="$PW" --stage
fly deploy -a bhatball-turn --ha=false
```

Then put `<THE_IPV4>` + `$PW` into the `window.BHATBALL_ICE` block in
`index.html` (both `?transport=udp` and `?transport=tcp` entries) and redeploy
the site.

## Rotate the password

```bash
PW=$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
fly secrets set -a bhatball-turn TURN_PASSWORD="$PW"   # triggers a redeploy
```

Update the two `credential` values in `index.html` to match, then redeploy the
site.

## Verify it relays

Browser console anywhere, or the [Trickle-ICE tester](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
with `turn:77.83.142.36:3478` + the creds — expect a **relay** candidate. A quick
console check:

```js
const pc = new RTCPeerConnection({ iceTransportPolicy:'relay', iceServers:[
  {urls:'turn:77.83.142.36:3478?transport=udp',username:'bhatball',credential:'<PW>'}]});
pc.createDataChannel('x');
pc.onicecandidate = e => e.candidate && /typ relay/.test(e.candidate.candidate) && console.log('RELAY OK', e.candidate.candidate);
pc.createOffer().then(o=>pc.setLocalDescription(o));
```

## Capacity / cost

- Dedicated IPv4: ~$2/mo. Machine: shared-cpu-1x/256MB (within/near free
  allowance). Bandwidth is metered — the config caps each session to 1 Mbps.
- Relay range is 10 UDP ports (`50000-50009`) → a handful of concurrent players.
  Widen `min/max-port` in `entrypoint.sh` **and** add matching `[[services]]`
  blocks in `fly.toml` to scale up.
