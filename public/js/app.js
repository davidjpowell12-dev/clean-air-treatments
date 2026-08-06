// Main App Router & State
const App = {
  user: null,
  currentPage: 'dashboard',

  // Where the user came from, most recent last. This app runs as an installed
  // PWA ("display": "standalone"), so there is NO browser back button — and
  // every per-page back link is hardcoded to that section's list (a property
  // opened from the Schedule offered "← Properties", not "back to Schedule").
  // This stack powers a real context-aware back button in the header.
  _navStack: [],

  // Explicit labels so the wording is predictable and short enough for the
  // header (side-nav text is close but not always right — e.g. "Scheduling").
  _PAGE_LABELS: {
    dashboard: 'Dashboard', products: 'Products', inventory: 'Inventory',
    properties: 'Properties', calculator: 'Calculator', scheduling: 'Schedule',
    applications: 'Applications', estimates: 'Estimates', invoicing: 'Invoicing',
    'follow-ups': 'Follow-ups', messaging: 'Messaging', notes: 'Client Notes',
    activate: 'Activate Client', settings: 'Settings', ipm: 'IPM Cases'
  },

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

    // Handle browser back/forward (also Android's hardware/gesture back).
    window.addEventListener('popstate', () => {
      const hash = window.location.hash.slice(1) || 'dashboard';
      // If they went back to exactly where our stack says they came from,
      // consume that entry so the header button doesn't offer it twice.
      if (this._navStack[this._navStack.length - 1] === hash) this._navStack.pop();
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

    // Mount global quick-capture follow-up button
    if (window.FollowUpsPage && FollowUpsPage.mountFab) FollowUpsPage.mountFab();

    // Initial page load
    const hash = window.location.hash.slice(1) || 'dashboard';
    const parts = hash.split('/');
    this.loadPage(parts[0], parts[1], parts[2]);
  },

  navigate(page, action, id, prefill) {
    let hash = page;
    if (action) hash += '/' + action;
    if (id) hash += '/' + id;

    // Remember where we're leaving from — this is forward navigation by
    // definition, since goBack()/popstate load pages without coming through
    // here. Skip no-op re-navigations to the same place.
    const from = window.location.hash.slice(1);
    if (from && from !== hash) {
      this._navStack.push(from);
      if (this._navStack.length > 25) this._navStack.shift();
    }

    window.location.hash = hash;

    // Store prefill data temporarily
    this._prefill = prefill || null;
    this.loadPage(page, action, id);
  },

  // Header back button: return to the previous page the user actually came
  // from, rather than a section list guessed at by the current page.
  goBack() {
    const prev = this._navStack.pop();
    if (!prev) return;
    window.location.hash = prev;
    const parts = prev.split('/');
    this.loadPage(parts[0], parts[1], parts[2]);
  },

  _pageLabel(hash) {
    const page = String(hash || '').split('/')[0];
    if (this._PAGE_LABELS[page]) return this._PAGE_LABELS[page];
    return page ? page.charAt(0).toUpperCase() + page.slice(1) : 'Back';
  },

  _updateBackButton() {
    const btn = document.getElementById('headerBack');
    if (!btn) return;
    const prev = this._navStack[this._navStack.length - 1];
    if (!prev) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = 'flex';
    const label = document.getElementById('headerBackLabel');
    if (label) label.textContent = this._pageLabel(prev);
  },

  loadPage(page, action, id) {
    this.currentPage = page;

    // Update active nav items
    document.querySelectorAll('[data-page]').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });

    // Scroll to top
    window.scrollTo(0, 0);

    // Single place that refreshes the header back button, so it stays correct
    // for every entry point: navigate(), goBack(), popstate, and initial load.
    this._updateBackButton();

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
      case 'scheduling':
        SchedulingPage.render(action, id ? Number(id) : null);
        break;
      case 'estimates':
        EstimatesPage.render(action, id ? Number(id) : null);
        break;
      case 'invoicing':
        InvoicingPage.render(action, id ? Number(id) : null);
        break;
      case 'follow-ups':
        FollowUpsPage.render(action, id ? Number(id) : null);
        break;
      case 'messaging':
        MessagingPage.render();
        break;
      case 'notes':
        ClientNotesPage.render();
        break;
      case 'activate':
        ActivatePage.render();
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
