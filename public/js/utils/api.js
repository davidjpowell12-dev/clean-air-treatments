// API utility wrapper
const Api = {
  async request(url, options = {}) {
    const defaults = {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    };
    const config = { ...defaults, ...options };
    if (options.body && typeof options.body === 'object') {
      config.body = JSON.stringify(options.body);
    }

    const res = await fetch(url, config);

    if (res.status === 401) {
      window.location.href = '/';
      throw new Error('Not authenticated');
    }

    // Read body as text first so we can surface non-JSON responses
    // (e.g. Railway HTML error pages, proxy timeouts, truncated bodies)
    const text = await res.text();
    let data = null;
    let parseError = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (err) {
        parseError = err;
      }
    }

    if (!res.ok) {
      const msg = (data && data.error) ||
        (parseError ? `Server error ${res.status}: ${text.slice(0, 300)}` : `Request failed (${res.status})`);
      throw new Error(msg);
    }

    if (parseError) {
      throw new Error(`Bad response from server: ${parseError.message}. Body: ${text.slice(0, 300)}`);
    }

    return data;
  },

  get(url) { return this.request(url); },

  post(url, body) {
    return this.request(url, { method: 'POST', body });
  },

  put(url, body) {
    return this.request(url, { method: 'PUT', body });
  },

  delete(url) {
    return this.request(url, { method: 'DELETE' });
  }
};
