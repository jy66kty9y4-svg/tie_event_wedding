# Orbitpanel control connector

`tie.event` accepts management requests only on the private Docker alias
`tie-event-control:4173` under `/api/internal/orbitpanel/`. Requests require
HMAC v1 signing with `ORBIT_TIE_HMAC_SECRET`; public hosts receive no control
endpoint.

The connector lists opaque account and guest-invitation sessions, revokes real
cookies, disables portal accounts, records auditable mutations, and enforces
exact public-IP bans. Configure the trusted Caddy peer with
`ORBIT_TIE_TRUSTED_PROXY_IPS`; attach only the Orbitpanel agent and Tie service
to the internal `orbitpanel_tie_control` network. No token or session digest is
returned by the API.
