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
