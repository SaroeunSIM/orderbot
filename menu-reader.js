/*
 * Order Bot — menu reader.
 * Runs as a bookmark on a shop page you have open (GrabFood, E-GetS or WOWNOW web).
 * Reads what the page shows — categories, items, prices, photos, sold-out marks,
 * and on E-Get the item options — then hands it to your import page.
 * Nothing is sent anywhere until you press "Send to Order Bot".
 *
 * __IMPORT_URL__ is filled in by bookmarklet.html.
 */
(async function () {
  var IMPORT_URL = '__IMPORT_URL__';
  if (window.__obReading) return;
  window.__obReading = true;

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var txt = function (el) { return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : ''; };
  var visible = function (el) { return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); };
  var num = function (s) { var n = parseFloat(String(s || '').replace(/[^0-9.]/g, '')); return isNaN(n) ? '' : n; };

  // ---- progress box -------------------------------------------------------
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;width:300px;padding:14px 16px;' +
    'background:#fff;color:#111;border:1px solid #ccc;border-radius:12px;font:14px/1.45 system-ui,sans-serif;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.18)';
  box.innerHTML = '<b>Order Bot</b><div id="obmsg" style="margin-top:6px">Reading the menu…</div>';
  document.body.appendChild(box);
  var say = function (h) { box.querySelector('#obmsg').innerHTML = h; };
  var done = function () { window.__obReading = false; };

  try {
    var host = location.host;
    var data;
    if (/grab\.com$/.test(host)) data = await readGrab();
    else if (/e-gets\.com$/.test(host)) data = await readEget();
    else if (/wownow\.net$/.test(host)) data = await readWownow();
    else { say('Open a shop page on <b>food.grab.com</b>, <b>e-gets.com</b> or <b>wownow.net</b> first (open the share link in Chrome).'); done(); return; }

    if (!data.items.length) { say('No menu items found on this page. Scroll to the menu and try again.'); done(); return; }

    var sold = data.items.filter(function (i) { return !i.available; }).length;
    var opts = data.items.filter(function (i) { return i.options && i.options.length; }).length;
    say('<b>' + esc(data.shop_name) + '</b><br>' + data.items.length + ' items · ' +
        Object.keys(data.items.reduce(function (a, i) { a[i.category] = 1; return a; }, {})).length + ' categories' +
        (opts ? ' · ' + opts + ' with options' : '') + (sold ? ' · ' + sold + ' sold out' : '') +
        '<br><button id="obsend" style="margin-top:10px;width:100%;padding:9px;border:0;border-radius:8px;' +
        'background:#111;color:#fff;font:inherit;cursor:pointer">Send to Order Bot</button>' +
        '<div style="margin-top:6px;text-align:right"><a href="#" id="obclose" style="color:#666">Close</a></div>');
    box.querySelector('#obsend').onclick = function () {
      window.open(IMPORT_URL + '#' + encodeURIComponent(JSON.stringify(data)), '_blank');
      say('Sent to the import page — finish there. ✓');
      setTimeout(function () { box.remove(); }, 4000);
      done();
    };
    box.querySelector('#obclose').onclick = function (e) { e.preventDefault(); box.remove(); done(); };
  } catch (err) {
    say('Something went wrong: ' + esc(String(err && err.message || err)));
    done();
  }

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  // ---- GrabFood web (food.grab.com) -----------------------------------------
  async function readGrab() {
    // Photos load as you scroll; walk the page once so every image has its real address.
    var h = document.body.scrollHeight;
    for (var y = 0; y < h; y += 600) { window.scrollTo(0, y); await sleep(180); say('Reading the menu… ' + Math.min(99, Math.round(y / h * 100)) + '%'); }
    window.scrollTo(0, 0);

    var q = function (root, k) { return root.querySelector('[class*="' + k + '"]'); };
    var name = txt(document.querySelector('h1')) || document.title.replace(/\s*⭐.*$/, '');
    var items = {}, order = [];
    document.querySelectorAll('[class*="categoryContent"]').forEach(function (cc) {
      var head = cc.parentElement && cc.parentElement.querySelector('h2[class*="categoryName"]');
      var cat = txt(head) || 'Menu';
      cc.querySelectorAll('[class*="menuItem___"]').forEach(function (mi) {
        var n = txt(q(mi, 'itemNameTitle'));
        if (!n) return;
        var key = n.toLowerCase();
        if (items[key] && /for you|recommended|popular/i.test(cat)) return;     // keep the real category
        var priceTxt = txt(q(mi, 'discountedPrice'));
        var origEl = mi.querySelector('[class*="itemPrice"] del, [class*="originalPrice"], [class*="originPrice"]');
        var img = mi.querySelector('img');
        var cur = /\$/.test(priceTxt) ? 'USD' : (/\/kh\//.test(location.pathname) ? 'KHR' : 'USD');
        if (!items[key]) order.push(key);
        items[key] = {
          category: cat, name: n, desc: txt(q(mi, 'itemDescription')),
          price: num(priceTxt), was: origEl ? num(txt(origEl)) : '', currency: cur,
          image: img ? (img.currentSrc || img.src || '') : '',
          available: !/disable/i.test(String(mi.className)), options: []
        };
      });
    });
    return { v: 1, app: 'Grab', shop_name: name, page_url: location.origin + location.pathname,
             read_at: new Date().toISOString(), items: order.map(function (k) { return items[k]; }) };
  }

  // ---- WOWNOW web (fd.wownow.net) ---------------------------------------------
  // The menu is a scrolling panel that only draws what's on screen, so we scroll
  // it top to bottom and collect items as they appear. Section titles sit in the
  // same list as the items; menus list promotions first and the real categories
  // later, so the last section an item appears in is kept.
  async function readWownow() {
    var wrap = document.querySelector('.store-item-wrapper');
    if (!wrap) return { items: [] };
    var sc = wrap;
    while (sc && !(sc.scrollHeight > sc.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    var nameEl = [].filter.call(document.querySelectorAll('h5'), function (h) { return !h.closest('.store-item-product'); })[0];
    var items = {}, order = [], cat = 'Menu';
    var collect = function () {
      [].forEach.call(wrap.children, function (c) {
        var p = c.querySelector('.store-item-product');
        if (!p) { var t = txt(c); if (t) cat = t.substring(0, 60); return; }
        var n = txt(p.querySelector('h5'));
        if (!n) return;
        var key = n.toLowerCase();
        var img = p.querySelector('img.show-img');
        var priceEl = [].filter.call(p.querySelectorAll('strong'), function (e) { return /\$/.test(txt(e)); })[0] ||
                      p.querySelector('strong');
        var priceTxt = txt(priceEl);
        if (!items[key]) order.push(key);
        var prev = items[key];
        items[key] = {
          category: cat, name: n, desc: '',
          price: num(priceTxt), was: num(txt(p.querySelector('.lineThrough'))),
          currency: /\$/.test(priceTxt) ? 'USD' : 'KHR',
          image: (img && /^https?:/.test(img.currentSrc || img.src) ? (img.currentSrc || img.src) : '') || (prev && prev.image) || '',
          available: !/sold out|out of stock|unavailable/i.test(p.textContent), options: []
        };
      });
    };
    if (sc) {
      for (var y = 0; y <= sc.scrollHeight; y += 400) {
        sc.scrollTop = y; await sleep(260); collect();
        say('Reading the menu… ' + Math.min(99, Math.round(y / sc.scrollHeight * 100)) + '%');
      }
      sc.scrollTop = 0;
    } else collect();
    var storeNo = (location.search.match(/storeNo=([^&]+)/) || [])[1];
    return { v: 1, app: 'WOWNOW', shop_name: txt(nameEl) || 'WOWNOW shop',
             page_url: location.origin + location.pathname + (storeNo ? '?storeNo=' + storeNo : ''),
             read_at: new Date().toISOString(), items: order.map(function (k) { return items[k]; }) };
  }

  // ---- E-GetS web (takeaway.e-gets.com) -------------------------------------
  async function readEget() {
    var title = document.title.match(/\[(.+?)\]/);
    var name = title ? title[1] : txt(document.querySelector('.shop-name, h1, h2'));
    var tabs = [].slice.call(document.querySelectorAll('.van-tabs__nav .van-tab'));
    var items = {}, order = [];

    for (var ti = 0; ti < tabs.length; ti++) {
      var cat = txt(tabs[ti]);
      say('Reading “' + esc(cat) + '” (' + (ti + 1) + '/' + tabs.length + ')…');
      tabs[ti].click();
      await sleep(900);
      var pane = document.querySelectorAll('.van-tab__pane')[ti];
      if (!pane) continue;
      for (var k = 0; k < 15; k++) {                    // the list loads more as you scroll
        var list = pane.querySelectorAll('.goods-item'), before = list.length;
        if (list.length) list[list.length - 1].scrollIntoView();
        await sleep(450);
        if (pane.querySelectorAll('.goods-item').length === before) break;
      }
      var promoCat = /promo/i.test(cat);
      [].forEach.call(pane.querySelectorAll('.goods-item'), function (g) {
        var n = txt(g.querySelector('.goods-title'));
        if (!n) return;
        var key = n.toLowerCase();
        if (items[key] && (promoCat || !/promo/i.test(items[key].category))) return;
        var sym = txt(g.querySelector('.symbol-money'));
        var price = num(txt(g.querySelector('.main-money')) + txt(g.querySelector('.digit-money')));
        var img = g.querySelector('img.van-image__img');
        var soldOut = [].some.call(g.querySelectorAll('p'), function (p) { return txt(p) === 'Sold Out' && visible(p); });
        if (!items[key]) order.push(key);
        items[key] = {
          category: cat, name: n, desc: txt(g.querySelector('.goods-small-title')),
          price: price, was: num(txt(g.querySelector('del'))), currency: /៛|riel/i.test(sym) ? 'KHR' : 'USD',
          image: img ? (img.dataset.src || img.currentSrc || img.src || '') : '',
          available: !soldOut, options: [], _el: /SELECT/.test(g.textContent) ? g : null
        };
      });
    }

    // Options (size, sugar level, toppings…) live behind each item's SELECT button.
    var withOpts = order.filter(function (k) { return items[k]._el; });
    for (var i = 0; i < withOpts.length; i++) {
      var it = items[withOpts[i]];
      say('Reading options ' + (i + 1) + '/' + withOpts.length + ' — ' + esc(it.name));
      try {
        var tabEl = tabs.filter(function (t) { return txt(t) === it.category; })[0];
        if (tabEl && !document.body.contains(it._el)) { tabEl.click(); await sleep(700); }
        var btn = [].filter.call(it._el.querySelectorAll('*'), function (e) { return !e.children.length && txt(e) === 'SELECT'; })[0];
        if (!btn) continue;
        btn.click();
        var pop = null;
        for (var w = 0; w < 10 && !pop; w++) {
          await sleep(200);
          pop = [].filter.call(document.querySelectorAll('.goods-sku-pop'), visible)[0];
        }
        if (!pop) continue;
        it.options = [].map.call(pop.querySelectorAll('.sku-type'), function (grp) {
          return {
            group: txt(grp.querySelector('h5')),
            multi: /checkbox/.test(grp.className),
            choices: [].map.call(grp.querySelectorAll('.van-cell__title'), txt).filter(Boolean)
          };
        }).filter(function (g) { return g.group && g.choices.length; });
        var x = pop.querySelector('.van-popup__close-icon');
        if (x) x.click();
        await sleep(350);
        [].forEach.call(document.querySelectorAll('.shop-closed-box'), function (b) {   // "Store closed" notice
          if (visible(b)) { var ok = b.querySelector('.van-button'); if (ok) ok.click(); }
        });
      } catch (e) { /* skip this item's options */ }
    }

    return { v: 1, app: 'E-Get', shop_name: name, page_url: location.href.replace(/[?&](share|s_id|lang|region_code)=[^&]*/g, ''),
             read_at: new Date().toISOString(),
             items: order.map(function (k) { var it = items[k]; delete it._el; return it; }) };
  }
})();
