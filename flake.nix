{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.go

            pkgs.postgresql_18

            pkgs.nodejs_24
            pkgs.pnpm_10
          ];

          postgresConf = pkgs.writeText "postgresql.conf" ''
            # Add Custom Settings
            log_min_messages = warning
            log_min_error_statement = error
            log_min_duration_statement = 100
            log_connections = on
            log_disconnections = on
            log_duration = on
            log_timezone = 'UTC'
            log_statement = 'all'
            log_directory = 'pg_log'
            log_filename = 'postgresql-%Y-%m-%d_%H%M%S.log'
            logging_collector = on
            log_min_error_statement = error
          '';

          shellHook = ''
            if [ -f .env ]; then
              set -a
              source .env
              set +a
            fi

            free_port() {
              local port="$1"
              shift
              while (echo >/dev/tcp/localhost/"$port") 2>/dev/null || [[ " $* " == *" $port "* ]]; do
                port=$((port + 1))
              done
              echo "$port"
            }

            export PGDATA="$PWD/.pg"
            export PORT="$(free_port "''${PORT:-8000}")"
            export VITE_PORT="$(free_port "''${VITE_PORT:-3000}" "$PORT")"
            export DEVIDP_PORT="$(free_port "''${DEVIDP_PORT:-5557}" "$PORT" "$VITE_PORT")"

            if pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
              export PGPORT="$(awk 'NR == 4 { print; exit }' "$PGDATA/postmaster.pid")"
            else
              echo "Setting up ${pkgs.postgresql_18.name}"
              export PGPORT="$(free_port "''${PGPORT:-5556}" "$PORT" "$VITE_PORT" "$DEVIDP_PORT")"

              if [ ! -f "$PGDATA/PG_VERSION" ]; then
                echo "Initializing database..."
                initdb -D "$PGDATA" -U postgres
                cat "$postgresConf" >> "$PGDATA/postgresql.conf"
              fi

              pg_ctl -D "$PGDATA" -o "-k $PGDATA" start
            fi

            export PGHOST="$PGDATA"
            export BACKEND_URL="http://localhost:$PORT"
            export DEV_VITE_URL="http://localhost:$VITE_PORT"
            export DEVIDP_ISSUER="http://localhost:$DEVIDP_PORT"
            export DB_URL="postgres://postgres:postgres@localhost:$PGPORT/postgres"

            echo "Ports: backend $PORT, frontend $VITE_PORT, IdP $DEVIDP_PORT, Postgres $PGPORT"

            alias fin="pg_ctl -D $PGDATA stop && exit"
            alias pg="psql -U postgres -d postgres"
          '';
        };
      });
    };
}
