let csrfToken = '';

export async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  const isForm = options.body instanceof FormData;
  if (options.body && !isForm && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (!csrfToken) await api('/auth/csrf');
    headers.set('x-csrf-token', csrfToken);
  }
  const response = await fetch(`/api${path}`, {
    ...options,
    method,
    headers,
    credentials: 'include',
    body: options.body && !isForm && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  if (response.status === 204) {
    if (path === '/auth/logout') csrfToken = '';
    return null;
  }
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    if (response.status === 403 && result?.code === 'csrf_invalid' && !options.csrfRetried) {
      csrfToken = '';
      await api('/auth/csrf');
      return api(path, { ...options, csrfRetried: true });
    }
    throw new Error(result?.error || `Request failed (${response.status}).`);
  }
  if (result?.csrfToken) csrfToken = result.csrfToken;
  return result;
}

export async function download(path, filename) {
  const response = await fetch(`/api${path}`, { credentials: 'include' });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || 'Download could not be completed.');
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}