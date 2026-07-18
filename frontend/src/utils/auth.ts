export function getAccessToken(): string | null {
  return localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
}

export function setAccessToken(token: string, persistent: boolean): void {
  if (persistent) {
    localStorage.setItem('access_token', token);
  } else {
    sessionStorage.setItem('access_token', token);
  }
}

export function clearAccessToken(): void {
  localStorage.removeItem('access_token');
  sessionStorage.removeItem('access_token');
}
