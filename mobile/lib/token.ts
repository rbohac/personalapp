/** The signed-in session's API token, shared by the API client and the offline outbox. */
let token: string | null = null;

export function getToken(): string | null {
  return token;
}

export function setToken(t: string | null): void {
  token = t;
}
