let csrf = "";

export function setCsrf(newCsrf: string) {
	csrf = newCsrf;
}

export function getCsrf() {
	return csrf;
}
