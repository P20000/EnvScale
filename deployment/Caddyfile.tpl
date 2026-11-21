# ==============================================================================
# EnvScale — Host Caddy Reverse Proxy & Automatic TLS Template
# ==============================================================================
# Rendered atomically by deployment/scripts/host-runtime.sh and validated via
# `caddy validate --config` prior to `systemctl reload caddy`.
# All upstreams bind strictly to 127.0.0.1 loopback ports.
# ==============================================================================

(envscale_routes) {
    encode zstd gzip

    header {
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }

    @api_health path /api/health /api/v1/health
    rewrite @api_health /health

    handle /health {
        reverse_proxy 127.0.0.1:__API_HOST_PORT__
    }

    handle /healthz {
        reverse_proxy 127.0.0.1:__STREAMER_HOST_PORT__
    }

    @streamer_gateway {
        path /ws*
        path /api/v1/stream/*
        path /api/v1/clusters/snapshot*
        path /api/v1/clusters/metrics/*
        path /api/v1/clusters/register*
        path /api/v1/clusters/unregister-all*
        path /api/v1/clusters/*/rollout/*
        path /api/v1/clusters/rollout/*
        path /api/v1/logs/stream*
        path /api/v1/chaos/*
        path /api/v1/resource/*
        path /api/v1/evaluator/*
        path /api/v1/rollout/*
    }
    handle @streamer_gateway {
        reverse_proxy 127.0.0.1:__STREAMER_HOST_PORT__ {
            flush_interval -1
        }
    }

    handle /api* {
        reverse_proxy 127.0.0.1:__API_HOST_PORT__
    }

    handle {
        reverse_proxy 127.0.0.1:__WEB_HOST_PORT__
    }
}

http://__PUBLIC_IP__ {
    import envscale_routes
}

__SSLIP_HOST__ {
    import envscale_routes
}

__FULL_DOMAIN__ {
    import envscale_routes
}

