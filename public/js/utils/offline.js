// Offline support using IndexedDB
const OfflineStore = {
  DB_NAME: 'CleanAirOffline',
  DB_VERSION: 2,
  db: null,

  async open() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('pendingApplications')) {
          db.createObjectStore('pendingApplications', { keyPath: 'tempId', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('productsCache')) {
          db.createObjectStore('productsCache', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('propertiesCache')) {
          db.createObjectStore('propertiesCache', { keyPath: 'id' });
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      request.onerror = () => reject(request.error);
    });
  },

  async savePendingApplication(data) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pendingApplications', 'readwrite');
      const store = tx.objectStore('pendingApplications');
      const request = store.add({ ...data, savedAt: new Date().toISOString() });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async getPendingApplications() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pendingApplications', 'readonly');
      const store = tx.objectStore('pendingApplications');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async removePendingApplication(tempId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pendingApplications', 'readwrite');
      const store = tx.objectStore('pendingApplications');
      const request = store.delete(tempId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  async cacheProducts(products) {
    const db = await this.open();
    const tx = db.transaction('productsCache', 'readwrite');
    const store = tx.objectStore('productsCache');
    store.clear();
    products.forEach(p => store.put(p));
  },

  async getCachedProducts() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('productsCache', 'readonly');
      const store = tx.objectStore('productsCache');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async cacheProperties(properties) {
    const db = await this.open();
    const tx = db.transaction('propertiesCache', 'readwrite');
    const store = tx.objectStore('propertiesCache');
    store.clear();
    properties.forEach(p => store.put(p));
  },

  async getCachedProperties() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('propertiesCache', 'readonly');
      const store = tx.objectStore('propertiesCache');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async searchCachedProperties(query) {
    const all = await this.getCachedProperties();
    const q = query.toLowerCase();
    return all.filter(p => {
      const searchStr = ((p.customer_name || '') + ' ' + (p.address || '') + ' ' + (p.city || '')).toLowerCase();
      return searchStr.includes(q);
    });
  },

  async syncPending() {
    const pending = await this.getPendingApplications();
    if (pending.length === 0) return 0;

    let synced = 0;
    for (const app of pending) {
      try {
        const { tempId, savedAt, ...data } = app;
        await Api.post('/api/applications', data);
        await this.removePendingApplication(tempId);
        synced++;
      } catch (e) {
        console.warn('Failed to sync application:', e);
      }
    }
    return synced;
  }
};

// Auto-sync when coming back online
window.addEventListener('online', async () => {
  const count = await OfflineStore.syncPending();
  if (count > 0) {
    App.toast(`Synced ${count} offline record${count > 1 ? 's' : ''}`, 'success');
  }
});
