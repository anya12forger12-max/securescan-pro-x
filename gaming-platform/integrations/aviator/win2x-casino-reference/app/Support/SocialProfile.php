<?php namespace App\Support;

/**
 * Normalised identity extracted from a Socialite user.
 *
 * Socialite exposes mapped attributes on the object itself, not through a
 * `user` property. The legacy callback dereferenced `->user` for vkontakte
 * and google, which crashes with current Socialite versions. Raw provider
 * fields are accepted as a fallback so existing sessions keep working.
 *
 * Kept compatible with the PHP 7.1 runtime declared in this archive's
 * composer.json (no typed or readonly properties, no constructor promotion).
 */
final class SocialProfile
{
    /** @var string */
    public $provider;

    /** @var string */
    public $providerId;

    /** @var string */
    public $name;

    /** @var string */
    public $avatar;

    public function __construct($provider, $providerId, $name, $avatar)
    {
        $this->provider = strtolower((string) $provider);
        $this->providerId = (string) $providerId;
        $this->name = (string) $name;
        $this->avatar = (string) $avatar;
    }

    public static function fromSocialite($user, $provider)
    {
        $raw = isset($user->user) && is_object($user->user) ? $user->user : null;

        $providerId = self::firstNonEmpty([
            isset($user->id) ? $user->id : null,
            $raw !== null && isset($raw->id) ? $raw->id : null,
        ]);

        $name = trim(self::firstNonEmpty([
            isset($user->name) ? $user->name : null,
            isset($user->nickname) ? $user->nickname : null,
            $raw !== null && isset($raw->first_name, $raw->last_name)
                ? trim($raw->first_name . ' ' . $raw->last_name)
                : null,
            isset($user->displayName) ? $user->displayName : null,
            $raw !== null && isset($raw->displayName) ? $raw->displayName : null,
            $raw !== null && isset($raw->name) ? $raw->name : null,
        ], ''));

        $avatar = self::firstNonEmpty([
            isset($user->avatar) ? $user->avatar : null,
            isset($user->image) && is_object($user->image) && isset($user->image->url)
                ? $user->image->url
                : null,
            $raw !== null && isset($raw->photo_max) ? $raw->photo_max : null,
            $raw !== null && isset($raw->photo_200) ? $raw->photo_200 : null,
            $raw !== null && isset($raw->picture) ? $raw->picture : null,
            $raw !== null && isset($raw->image) && is_object($raw->image) && isset($raw->image->url)
                ? $raw->image->url
                : null,
        ], '');

        return new self(
            $provider,
            $providerId !== '' ? $providerId : 'unknown',
            $name !== '' ? $name : 'Player',
            $avatar
        );
    }

    /** Provider-scoped value for the legacy `users.user_id` column. */
    public function identity()
    {
        return $this->provider . ':' . $this->providerId;
    }

    /**
     * Legacy rows stored the bare provider id; keep accepting them for
     * existing accounts so upgrading does not duplicate or lock out players.
     *
     * @return string[]
     */
    public function lookupIds()
    {
        return array_values(array_unique([$this->identity(), $this->providerId]));
    }

    /** @return string */
    private static function firstNonEmpty(array $values, $default = '')
    {
        foreach ($values as $value) {
            if ($value === null || $value === '') {
                continue;
            }
            if (is_scalar($value)) {
                return (string) $value;
            }
        }

        return $default;
    }
}
