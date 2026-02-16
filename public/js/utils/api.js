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

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
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
