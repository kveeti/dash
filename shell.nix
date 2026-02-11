let
	pkgs = import <nixpkgs> { };
in
pkgs.mkShell {
	nativeBuildInputs = with pkgs; [
		nodejs_24
		bun

		rustup

		postgresql_18
	];

	postgresConf =
		pkgs.writeText "postgresql.conf" ''
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

	PGDATA = "${toString ./.}/.pg";

	shellHook = ''
		echo "Setting up ${pkgs.postgresql_18.name}"

		export PGPORT=5556

		mkdir -p "$PGDATA"
		export PGHOST="$PGDATA"

		if [ ! -f "$PGDATA/PG_VERSION" ]; then
		  echo "Initializing database..."
		  pg_ctl initdb -D "$PGDATA" -o "-U postgres"
		  cat "$postgresConf" >> "$PGDATA/postgresql.conf"
		fi

		pg_ctl -D "$PGDATA" -o "-k $PGDATA" start

		alias fin="pg_ctl -D $PGDATA stop && exit"
		alias pg="psql -U postgres -d postgres"
	'';
}

