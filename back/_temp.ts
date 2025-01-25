
		let url = null;
		try {
			url = new URL(req.url, "http://localhost:8000");
		} catch (e) {
			console.log(e);

			res.end();
			return;
		}
		const path = url.pathname;
		console.log(path);

		if (path === "/auth/init") {
			const codeVerifier = randomPKCECodeVerifier();
			const state = randomState();
			const redirectTo: URL = buildAuthorizationUrl(oauthConfig, {
				redirect_uri: "http://localhost:8000/auth/verify",
				scope: "email",
				code_challenge: await calculatePKCECodeChallenge(codeVerifier),
				code_challenge_method: "S256",
				state,
			});

			const headers = new Headers({
				Location: redirectTo.toString(),
			});
			headers.append(
				"Set-Cookie",
				`cv=${codeVerifier}; HttpOnly; Max-Age=300; SameSite=Lax;`
			);
			headers.append("Set-Cookie", `state=${state}; HttpOnly; Max-Age=300; SameSite=Lax;`);

			res.setHeaders(headers);
			res.writeHead(302);
			res.end();

			return;
		} else if (path === "/auth/verify") {
			const cookies = req.headers.cookie?.split(";");

			const codeVerifier = cookies?.find((x) => x.includes("cv="))?.split("=")[1];
			console.log({ cookies });

			if (!codeVerifier) {
				return;
			}

			const state = cookies?.find((x) => x.includes("state="))?.split("=")[1];
			console.log({ state });
			if (!state) {
				return;
			}

			try {
				const tokens: TokenEndpointResponse = await authorizationCodeGrant(
					oauthConfig,
					url,
					{
						pkceCodeVerifier: codeVerifier,
						expectedState: state,
					}
				);
				console.log(tokens);
			} catch (e) {
				console.log(e);
			}

			const headers = new Headers({
				Location: "http://localhost:3000/",
			});
			headers.append("Set-Cookie", `cv=; HttpOnly; Max-Age=0; SameSite=Lax;`);
			headers.append("Set-Cookie", `state=; HttpOnly; Max-Age=0; SameSite=Lax;`);

			res.setHeaders(headers);
			res.writeHead(302);
			res.end();
			return;
		}
