<?php

namespace App\Http\Middleware;

use Closure;

class secretKey
{

    /**
     * Guard the internal game-control endpoints (/api/*).
     *
     * The legacy check compared the client IP with SERVER_ADDR. That fails
     * open behind a same-host reverse proxy, where every external request can
     * appear to originate from the server's own address.
     *
     * When GAME_SERVICE_TOKEN is configured, callers must present it in the
     * X-Service-Token header (constant-time comparison). This is the real fix
     * for proxied deployments. When it is not configured we keep the legacy
     * same-host check so existing bot deployments continue to work unchanged.
     */
    public function handle($request, Closure $next)
    {
        $deny = function() {
            return response()->json(['error' => 'Invalid Request'], 403);
        };

        $configured = (string) getenv('GAME_SERVICE_TOKEN');
        if($configured !== '') {
            $provided = (string) $request->header('X-Service-Token', '');
            if($provided === '' || !hash_equals($configured, $provided)) return $deny();
            return $next($request);
        }

        $clientIp = (string) $request->getClientIp();
        $serverAddr = isset($_SERVER['SERVER_ADDR']) ? (string) $_SERVER['SERVER_ADDR'] : '';
        if($serverAddr === '' || !hash_equals($serverAddr, $clientIp)) return $deny();

        return $next($request);
    }
}
