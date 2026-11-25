<?php namespace App\Http\Controllers;

use Socialite;
use App\User;
use App\Profit;
use App\Support\SocialProfile;
use Auth;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Input;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\Session;

class AuthController extends Controller {

    public function __construct() {
        parent::__construct();
    }

    public function login($provider)
    {
        return Socialite::driver($provider)->redirect();
    }

    public function callback($provider)
    {
		try {
            // Keep Socialite's state check enabled: stateless() disables the
            // OAuth state nonce and allows login-CSRF.
			$user = json_decode(json_encode(Socialite::driver($provider)->user()));
		} catch (\Exception $e) {
			return redirect()->route('index')->with('error', 'Session data is out of date, please try again!');
		}
        if(!is_object($user) || !isset($user->id)) {
            return redirect()->route('index')->with('error', 'Session data is out of date, please try again!');
        }
        $user = $this->createOrGetUser($user, $provider);
        Auth::login($user, true);
        return redirect()->intended('/');
    }

    public function createOrGetUser($user, $provider) {
        $profile = SocialProfile::fromSocialite((object) $user, $provider);
        $lookupIds = $profile->lookupIds();

		$ref_id = Cookie::get('ref');
		$ref = User::where('unique_id', $ref_id)->first();
		$plus = 0;
		$ban = 0;
		$ban_reason = null;

        $ipCheck = User::where('ban', 0)->where('ip', request()->ip())->where('is_admin', 0)->first();
        $banCheck = User::where('ban', 1)->whereIn('user_id', $lookupIds)->where('is_admin', 0)->count();
        if((!is_null($ipCheck) && !in_array((string) $ipCheck->user_id, $lookupIds, true)) || $banCheck > 0) {
            $ban = 1;
            $ban_reason = 'Violation of rules 7.4.1. - "It is forbidden to register more than one account through the site. Such actions will result in account blocking"';
        }

        $u = User::whereIn('user_id', $lookupIds)->first();
        if ($u) {
            // Never let a login clear an existing ban or its reason.
            $ban = $ban || (bool) $u->ban;
            if ($ban && $ban_reason === null) {
                $ban_reason = $u->ban_reason;
            }
            User::where('id', $u->id)->update([
                'username' => $profile->name,
                'avatar' => $profile->avatar,
                'ip' => request()->ip(),
                'ban' => $ban,
                'ban_reason' => $ban_reason
            ]);
            $u->ban = $ban;
            $u->ban_reason = $ban_reason;
            return $u;
        }

		if(!is_null($ref) && !$ban) {
			$ref->link_reg += 1;
			$ref->save();
			$plus = $this->settings->ref_sum;
			if($plus > 0) Profit::create([
				'game' => 'ref',
				'sum' => -$plus
			]);
		} else {
            $ref_id = null;
        }

        return User::create([
            'unique_id' => bin2hex(random_bytes(6)),
            // Provider ids are only unique per provider; namespace them so a
            // facebook id cannot resolve to a vkontakte/google account.
            'user_id' => $profile->identity(),
            'username' => $profile->name,
            'avatar' => $profile->avatar,
            'ip' => request()->ip(),
            'balance' => $plus,
            'ref_id' => $ref_id,
            'ban' => $ban,
            'ban_reason' => $ban_reason
        ]);
    }

    public function logout()
    {
        // Cache::flush() here wiped every player's cached balance/rate limits
        // because one user logged out. Invalidating the session is enough.
        Auth::logout();
		Session::flush();
        return redirect()->intended('/');
    }
}
