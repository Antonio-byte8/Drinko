/* Drinko Venue Portal — shared auth, API helpers, and navigation */
(function (window) {
  var cfg = window.APP;
  var KEY = 'drinko_venue_session';

  var PORTAL = {};

  /* ---------- Session storage ---------- */
  PORTAL.loadSession = function () {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
  };
  PORTAL.saveSession = function (s) {
    try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch (e) {}
  };

  /* ---------- Auth ---------- */
  PORTAL.authCall = function (grant, body) {
    return fetch(cfg.supabaseUrl + '/auth/v1/token?grant_type=' + grant, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || !j.access_token) throw new Error(grant === 'password' ? 'Incorrect email or password.' : 'Session expired, please log in again.');
        return {
          access_token: j.access_token,
          refresh_token: j.refresh_token,
          user_id: j.user && j.user.id,
          expires_at: Date.now() + (j.expires_in || 3600) * 1000 - 60000
        };
      });
    });
  };

  PORTAL.signUp = function (email, password) {
    return fetch(cfg.supabaseUrl + '/auth/v1/signup', {
      method: 'POST',
      headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j && j.msg) || (j && j.message) || 'Signup failed.');
        return j;
      });
    });
  };

  PORTAL.token = function (session) {
    if (!session) return Promise.reject(new Error('Not logged in.'));
    if (session.expires_at > Date.now()) return Promise.resolve(session.access_token);
    return PORTAL.authCall('refresh_token', { refresh_token: session.refresh_token }).then(function (s) {
      PORTAL.saveSession(s);
      return s.access_token;
    });
  };

  /* ---------- REST API helper ---------- */
  PORTAL.api = function (session, path, init) {
    return PORTAL.token(session).then(function (t) {
      init = init || {};
      init.headers = Object.assign(
        { apikey: cfg.anonKey, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
        init.headers || {}
      );
      return fetch(cfg.supabaseUrl + '/rest/v1/' + path, init).then(function (r) {
        if (r.status === 204) return null;
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.message) || (j && j.error) || 'API error ' + r.status);
          return j;
        });
      });
    });
  };

  /* ---------- Edge function helper ---------- */
  PORTAL.fn = function (session, name, body) {
    return PORTAL.token(session).then(function (t) {
      return fetch(cfg.supabaseUrl + '/functions/v1/' + name, {
        method: 'POST',
        headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      }).then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error((j && j.error) || 'Function error');
          return j;
        });
      });
    });
  };

  /* ---------- Sign out ---------- */
  PORTAL.signOut = function () {
    PORTAL.saveSession(null);
    var base = location.href.split('/venue/')[0];
    location.href = base + '/venue/index.html';
  };

  /* ---------- Redirect if not logged in ---------- */
  PORTAL.requireAuth = function (session) {
    if (!session || !session.access_token) {
      location.href = 'index.html';
      return false;
    }
    return true;
  };

  /* ---------- Get venue (club + role) for current user ---------- */
  PORTAL.getVenue = function (session) {
    return PORTAL.api(session, 'staff?select=club_id,role').then(function (rows) {
      if (!rows || !rows.length) return null;
      var row = rows[0];
      return PORTAL.api(session, 'clubs?id=eq.' + encodeURIComponent(row.club_id) + '&select=id,name,service_fee_cents,active,stripe_account_id').then(function (clubs) {
        if (!clubs || !clubs.length) return null;
        return { club: clubs[0], role: row.role };
      });
    });
  };

  /* ---------- Sidebar navigation ---------- */
  PORTAL.renderNav = function (activePage, venueName, role) {
    var items = [
      { href: 'index.html', label: 'Dashboard', icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.4"/><rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.4"/></svg>' },
      { href: 'menu.html', label: 'Menu', icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h9M2 12h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' },
      { href: 'bars.html', label: 'Bar Areas', icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3h10l-1.5 6H4.5L3 3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6 13h4M8 9v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' },
      { href: 'qr.html', label: 'QR Codes', icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M9 9h2v2H9zM13 9h2M9 13h2M11 11h4v4h-4z" stroke="currentColor" stroke-width="1.4"/></svg>' },
      { href: 'staff.html', label: 'Staff', icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="3" stroke="currentColor" stroke-width="1.4"/><path d="M1 14c0-2.76 2.24-5 5-5h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M13 10v4M11 12h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' },
      { href: 'setup.html', label: 'Settings', icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.93 2.93l1.41 1.41M11.66 11.66l1.41 1.41M2.93 13.07l1.41-1.41M11.66 4.34l1.41-1.41" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' }
    ];
    var html = '<aside class="sidebar">'
      + '<div class="sidebar-logo">Drinko</div>'
      + (venueName ? '<div class="sidebar-venue"><span class="sidebar-venue-name">' + esc(venueName) + '</span><span class="sidebar-role">' + (role || 'barista') + '</span></div>' : '')
      + '<nav class="sidebar-nav">'
      + items.map(function (item) {
        var active = location.pathname.endsWith(item.href) || location.href.endsWith(item.href) || activePage === item.href;
        return '<a href="' + item.href + '" class="nav-item' + (active ? ' active' : '') + '">'
          + '<span class="nav-icon">' + item.icon + '</span>'
          + '<span class="nav-label">' + item.label + '</span>'
          + '</a>';
      }).join('')
      + '</nav>'
      + '<button class="nav-logout" id="nav-logout">Sign out</button>'
      + '</aside>';
    return html;
  };

  /* ---------- Utility ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  PORTAL.esc = esc;

  PORTAL.eur = function (c) {
    return (c / 100).toLocaleString('en-IE', { style: 'currency', currency: 'EUR' });
  };

  PORTAL.toast = function (msg, type) {
    var el = document.getElementById('portal-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'portal-toast show' + (type === 'error' ? ' error' : '');
    clearTimeout(PORTAL._toastTimer);
    PORTAL._toastTimer = setTimeout(function () { el.className = 'portal-toast'; }, 3500);
  };

  window.PORTAL = PORTAL;
})(window);
