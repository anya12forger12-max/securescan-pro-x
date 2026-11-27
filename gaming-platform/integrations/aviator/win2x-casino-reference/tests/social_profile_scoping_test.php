<?php
/**
 * Standalone regression test for provider-scoped social identities.
 *
 * The legacy callback looked users up by the bare provider id. Provider ids
 * are only unique within a provider, so a facebook user with id "42" could
 * resolve to a vkontakte user with id "42" and take over that account.
 * Run with: php tests/social_profile_scoping_test.php
 */
require __DIR__ . '/../app/Support/SocialProfile.php';

use App\Support\SocialProfile;

$failures = 0;
function check($label, $actual, $expected) {
    global $failures;
    if ($actual !== $expected) {
        fwrite(STDERR, "FAIL $label: expected " . var_export($expected, true) .
                       ", got " . var_export($actual, true) . "\n");
        $failures++;
    } else {
        echo "ok - $label\n";
    }
}

$facebook = (object) ['id' => '42', 'name' => 'Alice', 'avatar' => 'https://example.test/a.png'];
$fb = SocialProfile::fromSocialite($facebook, 'facebook');
$fb2 = SocialProfile::fromSocialite((object) ['id' => '42', 'name' => 'Mallory'], 'vkontakte');

check('facebook identity is namespaced', $fb->identity(), 'facebook:42');
check('vkontakte identity is namespaced', $fb2->identity(), 'vkontakte:42');
check('identities cannot collide across providers', $fb->identity() === $fb2->identity(), false);
check('bare provider id is never accepted as an identity', in_array('42', $fb->lookupIds(), true), false);
check('lookups always use the namespaced identity', $fb->lookupIds(), ['facebook:42']);
check('the same bare id from another provider cannot collide', $fb2->lookupIds(), ['vkontakte:42']);
check('name comes from the mapped attribute', $fb->name, 'Alice');
check('missing id falls back to a safe sentinel', SocialProfile::fromSocialite((object) [], 'google')->identity(), 'google:unknown');

// Current Socialite exposes mapped attributes on the object, not under ->user.
$google = (object) ['id' => '99', 'displayName' => 'Bob', 'image' => (object) ['url' => 'https://example.test/b.png']];
$g = SocialProfile::fromSocialite($google, 'google');
check('google display name is read from the mapped object', $g->name, 'Bob');
check('google avatar is read from the mapped object', $g->avatar, 'https://example.test/b.png');

if ($failures > 0) {
    fwrite(STDERR, "\n$failures assertion(s) failed\n");
    exit(1);
}
echo "\nAll assertions passed\n";
