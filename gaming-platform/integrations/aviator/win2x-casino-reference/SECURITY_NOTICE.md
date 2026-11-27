# Security notice — do not deploy

This directory is a **vendored, unmaintained reference archive**. It is kept
only so the platform's native implementations can be compared with the original
PHP casino app. It is not part of the gaming-platform build or runtime:

- `Dockerfile` never copies `integrations/` into an image.
- `.dockerignore` excludes `integrations/` from the build context outright.
- No Compose service mounts, executes or serves anything under this directory.

The lockfile pins a Laravel 5.8 / Symfony 4.2 / PHP 7.2 dependency stack with
**known critical and high-severity advisories** (including request-handling,
deserialization and file-system issues). `composer.lock` is retained verbatim
only for provenance; installing from it and exposing the resulting app would be
unsafe.

Do not:

- run `composer install` from this lockfile in any reachable environment;
- copy its configuration, credentials or routes into a deployed service;
- add a Compose service, Dockerfile stage or web-server root for this path.

If a deployable PHP app is ever needed, start from a supported Laravel release
with a freshly generated lockfile rather than upgrading this archive in place.

## Application-level fixes replayed from the maintained Win2x source

The archive is not deployed, but it is used as a comparison reference, so the
application-level fixes from the maintained `Win2x` repository are replayed
here to avoid anyone copying a vulnerable pattern:

- **Social login account takeover** — `users.user_id` now stores a
  provider-scoped id (`facebook:42`, `vkontakte:42`) via `SocialProfile`, so a
  bare provider id cannot resolve into another provider's account. Legacy rows
  with bare ids are still accepted for upgrades. Socialite's OAuth state check
  is no longer disabled with `stateless()` (login-CSRF).
- **Internal API guard fail-open** — `secretKey` now supports a constant-time
  `GAME_SERVICE_TOKEN` / `X-Service-Token` check instead of relying only on
  `SERVER_ADDR`, which fails open behind a same-host reverse proxy.
- **Limited-use promo double-spend** — redemption now locks the promo row and
  re-checks the remaining count inside a transaction.
- **Duplicate withdrawals** — payouts and refunds atomically claim the
  withdrawal row (`status` 3 = processing) before calling the payment provider,
  and revert the claim on failure. Balance credits use a row lock.
- **Null dereferences** — admin jackpot/chance and withdrawal-list rendering
  no longer crash on missing rows.

This does **not** make the archived dependency stack safe. The advisories and
deployment prohibition above still apply.

