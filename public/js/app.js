// Main App Router & State
const App = {
  user: null,
  currentPage: 'dashboard',

  async init() {
    try {
      this.user = await Api.get('/api/auth/me');
    } catch (e) {
      window.location.href = '/';
      return;
    }

    document.getElementById('userName').textContent = this.user.fullName;

    // Show admin nav if admin
    if (this.user.role === 'admin') {
      document.getElementById('adminNav').style.display = 'block';
    }

    // Menu toggle
    document.getElementById('menuToggle').addEventListener('click', () => this.toggleMenu());
    document.getElementById('navOverlay').addEventListener('click', () => this.toggleMenu(false));

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await Api.post('/api/auth/logout');
      window.location.href = '/';
    });

    // Nav clicks
    document.querySelectorAll('[data-page]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.navigate(link.dataset.page);
        this.toggleMenu(false);
      });
    });

    // Handle browser back/forward
    window.addEventListener('popstate', () => {
      const hash = window.location.hash.slice(1) || 'dashboard';
      const parts = hash.split('/');
      this.loadPage(parts[0], parts[1], parts[2]);
    });

    // Sync offline records on startup
    OfflineStore.syncPending().then(count => {
      if (count > 0) this.toast(`Synced ${count} offline record${count > 1 ? 's' : ''}`, 'success');
    });

    // Cache products for offline use
    Api.get('/api/products').then(products => {
      OfflineStore.cacheProducts(products);
    }).catch(() => {});

    // Cache properties for offline use
    Api.get('/api/properties').then(props => {
      OfflineStore.cacheProperties(props);
    }).catch(() => {});

    // Online/offline status indicator
    const updateOnlineStatus = () => {
      const badge = document.getElementById('syncBadge');
      if (badge) badge.style.display = navigator.onLine ? 'none' : 'inline-block';
    };
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    // Initial page load
    const hash = window.location.hash.slice(1) || 'dashboard';
    const parts = hash.split('/');
    this.loadPage(parts[0], parts[1], parts[2]);
  },

  navigate(page, action, id, prefill) {
    let hash = page;
    if (action) hash += '/' + action;
    if (id) hash += '/' + id;
    window.location.hash = hash;

    // Store prefill data temporarily
    this._prefill = prefill || null;
    this.loadPage(page, action, id);
  },

  loadPage(page, action, id) {
    this.currentPage = page;

    // Update active nav items
    document.querySelectorAll('[data-page]').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });

    // Scroll to top
    window.scrollTo(0, 0);

    // Route to page
    switch (page) {
      case 'dashboard':
        DashboardPage.render();
        break;
      case 'products':
        ProductsPage.render(action, id ? Number(id) : null);
        break;
      case 'inventory':
        InventoryPage.render();
        break;
      case 'calculator':
        CalculatorPage.render();
        break;
      case 'properties':
        PropertiesPage.render(action, id ? Number(id) : null);
        break;
      case 'applications':
        ApplicationsPage.render(action, id ? Number(id) : null, this._prefill);
        this._prefill = null;
        break;
      case 'ipm':
        IpmPage.render(action, id ? Number(id) : null);
        break;
      case 'settings':
        SettingsPage.render();
        break;
      default:
        DashboardPage.render();
    }
  },

  toggleMenu(force) {
    const nav = document.getElementById('sideNav');
    const overlay = document.getElementById('navOverlay');
    const open = force !== undefined ? force : !nav.classList.contains('open');
    nav.classList.toggle('open', open);
    overlay.classList.toggle('open', open);
  },

  toast(message, type = 'success') {
    // Remove existing toasts
    document.querySelectorAll('.toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
