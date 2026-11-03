/**
 * StudyHub V0.1.1 —— 页面逻辑
 * ------------------------------------------------------------------
 * 职责划分：
 *   data.js  提供「预置数据」，仅在该浏览器第一次打开时写入本地存储
 *   本文件   负责本地数据的读写、网站增删改、筛选、排序、渲染与交互
 *
 * 数据流：
 *   localStorage(studyhub:v1) ── 完整站点列表（含访问次数/时间/收藏）
 *   data.js(预置数据) ─────────┘ 首次打开时作为种子
 *
 * 只使用普通 script，不依赖 ES Module 与 fetch。
 * ------------------------------------------------------------------
 */
(function () {
  'use strict';

  var DATA = window.STUDYHUB_DATA;
  if (!DATA || !Array.isArray(DATA.sites)) { return; }

  var STORAGE_KEY = (DATA.meta && DATA.meta.storageKey) || 'studyhub:v1';
  var STORE_VERSION = 2;
  var PANEL_ROWS = 4;
  var MAX_NAME = 30;
  var MAX_DESC = 60;
  var MAX_TAGS = 3;
  var MAX_TAG_LEN = 8;

  var VIEW_TITLES = { all: '全部网站', favorites: '我的收藏', recent: '最近访问' };
  var EMPTY_STATES = {
    all: { title: '暂时还没有网站', hint: '点击「添加网站」，把常用的站点收进来。' },
    favorites: { title: '还没有收藏任何网站', hint: '点击卡片右上角的星标，即可把常用网站收进来。' },
    recent: { title: '还没有访问记录', hint: '点击任意网站卡片后，这里会按时间显示最近打开过的网站。' },
    category: { title: '该分类下还没有网站', hint: '点击「添加网站」，把站点添加到这个分类。' }
  };

  var WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  var state = { view: 'all', sort: 'visits' };
  var store = null;
  var sites = [];
  var categoryMap = {};
  var collator = null;
  var storageFailed = false;
  var toastTimer = 0;
  var editingId = null;
  var pendingDeleteId = null;
  var lastFocus = null;
  var els = {};

  /* ---------------------------------------------------------------- 启动 */

  function init() {
    els = {
      grid: document.getElementById('site-grid'),
      empty: document.getElementById('empty-state'),
      emptyTitle: document.getElementById('empty-title'),
      emptyHint: document.getElementById('empty-hint'),
      viewTitle: document.getElementById('view-title'),
      viewCount: document.getElementById('view-count'),
      navList: document.getElementById('nav-list'),
      categoryList: document.getElementById('category-list'),
      overview: document.getElementById('overview'),
      favoritesBody: document.getElementById('favorites-body'),
      recentBody: document.getElementById('recent-body'),
      date: document.getElementById('today-date'),
      toast: document.getElementById('toast'),
      addBtn: document.getElementById('add-site-btn'),
      siteDialog: document.getElementById('site-dialog'),
      siteForm: document.getElementById('site-form'),
      dialogTitle: document.getElementById('dialog-title'),
      submitBtn: document.getElementById('site-submit'),
      confirmDialog: document.getElementById('confirm-dialog'),
      confirmText: document.getElementById('confirm-text'),
      confirmBtn: document.getElementById('confirm-delete'),
      fName: document.getElementById('f-name'),
      fUrl: document.getElementById('f-url'),
      fCategory: document.getElementById('f-category'),
      fDesc: document.getElementById('f-desc'),
      fTags: document.getElementById('f-tags')
    };
    if (!els.grid) { return; }

    collator = typeof Intl !== 'undefined' && Intl.Collator
      ? new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })
      : null;

    indexCategories();
    store = loadStore();
    sites = store.sites;

    renderDate();
    renderCategories();
    renderCategoryOptions();
    bindEvents();

    renderAll();
  }

  /* ------------------------------------------------------------ 数据层 */

  function indexCategories() {
    (DATA.categories || []).forEach(function (cat) {
      categoryMap[cat.id] = cat;
    });
  }

  function defaultRecord(site) {
    var hours = typeof site.seededHoursAgo === 'number' ? site.seededHoursAgo : null;
    return {
      visits: Math.max(0, parseInt(site.initialVisits, 10) || 0),
      lastUsed: hours === null ? null : Date.now() - hours * 3600 * 1000,
      favorite: false
    };
  }

  /** 把任意来源的站点整理成统一结构 */
  function normalizeSite(base, rec) {
    rec = rec || {};
    var tags = Array.isArray(base.tags) ? base.tags : [];
    return {
      id: String(base.id || uid()),
      name: String(base.name || '').slice(0, MAX_NAME),
      desc: String(base.desc || '').slice(0, MAX_DESC),
      url: safeUrl(rec.url || base.url),
      category: categoryMap[base.category] ? base.category : 'course',
      icon: safeIcon(base.icon),
      color: safeColor(base.color),
      tags: tags.slice(0, MAX_TAGS).map(function (tag) { return String(tag).slice(0, MAX_TAG_LEN); }),
      visits: Math.max(0, parseInt(rec.visits, 10) || 0),
      lastUsed: typeof rec.lastUsed === 'number' ? rec.lastUsed : null,
      favorite: !!rec.favorite
    };
  }

  function seedSites() {
    return DATA.sites.map(function (base) {
      return normalizeSite(base, defaultRecord(base));
    });
  }

  /** v1（基础信息 + 记录分离）→ v2（完整站点列表） */
  function migrateStore(raw) {
    if (raw && raw.version === 1 && raw.sites && !Array.isArray(raw.sites)) {
      var list = DATA.sites.map(function (base) {
        return normalizeSite(base, raw.sites[base.id]);
      });
      return list.length ? list : null;
    }
    return null;
  }

  function loadStore() {
    var raw = readStorage();
    if (raw && raw.version === STORE_VERSION && Array.isArray(raw.sites)) {
      raw.sites = raw.sites.map(function (site) { return normalizeSite(site, site); });
      return raw;
    }

    var migrated = migrateStore(raw);
    var fresh = {
      version: STORE_VERSION,
      updatedAt: Date.now(),
      sites: migrated || seedSites()
    };
    writeStorage(fresh);
    return fresh;
  }

  function readStorage() {
    try {
      var text = window.localStorage.getItem(STORAGE_KEY);
      return text ? JSON.parse(text) : null;
    } catch (err) {
      return null;
    }
  }

  function writeStorage(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      return true;
    } catch (err) {
      storageFailed = true;
      return false;
    }
  }

  function persist() {
    if (!store) { return; }
    store.updatedAt = Date.now();
    if (!writeStorage(store) && !storageFailed) { storageFailed = true; }
    if (storageFailed) {
      showToast('浏览器禁止本地存储，本次记录将无法保存');
      storageFailed = false; // 只提示一次
    }
  }

  function findSite(id) {
    for (var i = 0; i < sites.length; i++) {
      if (sites[i].id === id) { return sites[i]; }
    }
    return null;
  }

  /* ------------------------------------------------------------ 视图层 */

  function renderAll() {
    renderGrid();
    renderOverview();
    updateHeader();
    updateNavState();
    updateSortState();
  }

  function renderDate() {
    if (!els.date) { return; }
    var now = new Date();
    els.date.textContent = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' +
      now.getDate() + '日 ' + WEEKDAYS[now.getDay()];
    els.date.setAttribute('datetime', now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()));
  }

  function renderCategories() {
    if (!els.categoryList) { return; }
    els.categoryList.innerHTML = (DATA.categories || []).map(function (cat) {
      return '<li>' +
        '<button class="side-item side-item--cat" type="button" data-view="' + escapeAttr(cat.id) + '"' +
        ' aria-pressed="false" style="--accent:' + safeColor(cat.color) + '">' +
          '<span class="side-item__badge" aria-hidden="true">' +
            '<svg class="icon"><use href="#' + safeIcon(cat.icon) + '"/></svg>' +
          '</span>' +
          '<span>' + escapeHtml(cat.name) + '</span>' +
        '</button>' +
      '</li>';
    }).join('');
  }

  function renderGrid() {
    var list = sortedList(filteredSites());

    updateHeader(list.length);

    if (!list.length) {
      els.grid.innerHTML = '';
      els.grid.hidden = true;
      showEmpty();
      return;
    }

    els.grid.hidden = false;
    els.empty.hidden = true;
    els.grid.innerHTML = list.map(cardHTML).join('');
  }

  function showEmpty() {
    var copy = EMPTY_STATES[state.view] || EMPTY_STATES.category;
    els.emptyTitle.textContent = copy.title;
    els.emptyHint.textContent = copy.hint;
    els.empty.hidden = false;
  }

  function cardHTML(site) {
    var favLabel = site.favorite ? '取消收藏 ' + site.name : '收藏 ' + site.name;
    return '<article class="card" data-site-id="' + escapeAttr(site.id) + '" style="--accent:' + site.color + '">' +
      '<div class="card__head">' +
        '<span class="card__icon" aria-hidden="true">' +
          '<svg class="icon"><use href="#' + site.icon + '"/></svg>' +
        '</span>' +
        '<h3 class="card__title" title="' + escapeAttr(site.name) + '">' + escapeHtml(site.name) + '</h3>' +
        '<div class="card__tools">' +
          '<button class="fav-btn' + (site.favorite ? ' is-active' : '') + '" type="button" data-action="favorite"' +
            ' aria-pressed="' + (site.favorite ? 'true' : 'false') + '" aria-label="' + escapeAttr(favLabel) + '"' +
            ' title="' + escapeAttr(favLabel) + '">' +
            '<svg class="icon" aria-hidden="true"><use href="#i-star"/></svg>' +
          '</button>' +
          '<button class="card__more" type="button" data-action="manage"' +
            ' aria-haspopup="menu" aria-expanded="false" aria-label="管理 ' + escapeAttr(site.name) + '"' +
            ' title="管理网站">' +
            '<svg class="icon" aria-hidden="true"><use href="#i-more"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="card__menu" role="menu" aria-label="管理 ' + escapeAttr(site.name) + '" hidden>' +
        '<button class="card__menu-item" type="button" role="menuitem" data-action="edit">' +
          '<svg class="icon" aria-hidden="true"><use href="#i-pencil"/></svg>编辑' +
        '</button>' +
        '<button class="card__menu-item card__menu-item--danger" type="button" role="menuitem" data-action="delete">' +
          '<svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg>删除' +
        '</button>' +
      '</div>' +
      '<p class="card__desc">' + escapeHtml(site.desc) + '</p>' +
      '<div class="card__meta">' +
        '<div class="card__tags">' + site.tags.map(function (tag) {
          return '<span class="tag">' + escapeHtml(tag) + '</span>';
        }).join('') + '</div>' +
        '<span class="card__visits" title="累计使用 ' + site.visits + ' 次">' +
          '<svg class="icon" aria-hidden="true"><use href="#i-flame"/></svg>' +
          '<span class="card__visits-value">' + site.visits + '</span> 次' +
        '</span>' +
      '</div>' +
      '<a class="card__link" href="' + escapeAttr(site.url) + '" target="_blank" rel="noopener noreferrer"' +
        ' data-action="visit" aria-label="打开 ' + escapeAttr(site.name) + '（新标签页）"></a>' +
    '</article>';
  }

  function renderOverview() {
    if (!els.overview) { return; }

    // 在「我的收藏 / 最近访问」视图中，主列表已经承担展示，概览不再重复
    var inFocusView = state.view === 'favorites' || state.view === 'recent';
    els.overview.hidden = inFocusView;
    if (inFocusView) { return; }

    renderFavoritesPanel();
    renderRecentPanel();
  }

  function renderFavoritesPanel() {
    var list = sites.filter(function (s) { return s.favorite; })
      .sort(function (a, b) { return b.visits - a.visits; })
      .slice(0, PANEL_ROWS);

    if (!list.length) {
      els.favoritesBody.innerHTML =
        '<div class="panel__empty">' +
          '<span class="panel__empty-icon"><svg class="icon" aria-hidden="true"><use href="#i-star"/></svg></span>' +
          '<p class="panel__empty-title">还没有收藏任何网站</p>' +
          '<p class="panel__empty-hint">点击网站卡片右上角的星标即可收藏</p>' +
        '</div>';
      return;
    }

    els.favoritesBody.innerHTML = list.map(function (site) {
      return miniHTML(site, '');
    }).join('');
  }

  function renderRecentPanel() {
    var list = sites.filter(function (s) { return s.lastUsed; })
      .sort(function (a, b) { return b.lastUsed - a.lastUsed; })
      .slice(0, PANEL_ROWS);

    if (!list.length) {
      els.recentBody.innerHTML =
        '<div class="panel__empty">' +
          '<span class="panel__empty-icon"><svg class="icon" aria-hidden="true"><use href="#i-clock"/></svg></span>' +
          '<p class="panel__empty-title">还没有访问记录</p>' +
          '<p class="panel__empty-hint">打开任意网站后会记录在这里</p>' +
        '</div>';
      return;
    }

    els.recentBody.innerHTML = list.map(function (site) {
      return miniHTML(site, formatTime(site.lastUsed));
    }).join('');
  }

  function miniHTML(site, timeText) {
    return '<a class="mini" href="' + escapeAttr(site.url) + '" target="_blank" rel="noopener noreferrer"' +
      ' data-action="visit" data-site-id="' + escapeAttr(site.id) + '"' +
      ' aria-label="打开 ' + escapeAttr(site.name) + '（新标签页）" style="--accent:' + site.color + '">' +
        '<span class="mini__icon" aria-hidden="true">' +
          '<svg class="icon"><use href="#' + site.icon + '"/></svg>' +
        '</span>' +
        '<span class="mini__name">' + escapeHtml(site.name) + '</span>' +
        (timeText ? '<span class="mini__time">' + escapeHtml(timeText) + '</span>' : '') +
      '</a>';
  }

  function updateHeader(count) {
    if (typeof count !== 'number') {
      count = sortedList(filteredSites()).length;
    }
    var title = VIEW_TITLES[state.view] ||
      (categoryMap[state.view] ? categoryMap[state.view].name : '全部网站');
    if (els.viewTitle) { els.viewTitle.textContent = title; }
    if (els.viewCount) {
      els.viewCount.textContent = state.view === 'recent'
        ? '共 ' + count + ' 条记录'
        : '共 ' + count + ' 个网站';
    }
    document.title = state.view === 'all' ? 'StudyHub · 个人学习导航' : title + ' · StudyHub';
  }

  function updateNavState() {
    document.querySelectorAll('[data-view]').forEach(function (btn) {
      var active = btn.getAttribute('data-view') === state.view;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function updateSortState() {
    document.querySelectorAll('[data-sort]').forEach(function (btn) {
      var active = btn.getAttribute('data-sort') === state.sort;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  /* ------------------------------------------------------------ 筛选排序 */

  function filteredSites() {
    if (state.view === 'all') { return sites.slice(); }
    if (state.view === 'favorites') { return sites.filter(function (s) { return s.favorite; }); }
    if (state.view === 'recent') { return sites.filter(function (s) { return s.lastUsed; }); }
    return sites.filter(function (s) { return s.category === state.view; });
  }

  function sortedList(list) {
    var copy = list.slice();
    copy.sort(function (a, b) {
      if (state.sort === 'name') {
        return collator ? collator.compare(a.name, b.name) : a.name.localeCompare(b.name);
      }
      if (state.sort === 'recent') {
        return (b.lastUsed || 0) - (a.lastUsed || 0) || b.visits - a.visits;
      }
      return b.visits - a.visits || (b.lastUsed || 0) - (a.lastUsed || 0);
    });
    return copy;
  }

  /* ------------------------------------------------------------ 交互 */

  function bindEvents() {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { closeMenus(); }
    });

    var settings = document.getElementById('settings-btn');
    if (settings) {
      settings.addEventListener('click', function () {
        showToast('设置功能将在 V0.2 开放');
      });
    }

    if (els.addBtn) {
      els.addBtn.addEventListener('click', function () { openSiteForm('add'); });
    }
    if (els.siteForm) {
      els.siteForm.addEventListener('submit', onFormSubmit);
    }
    if (els.confirmBtn) {
      els.confirmBtn.addEventListener('click', confirmDelete);
    }
    [els.siteDialog, els.confirmDialog].forEach(function (dialog) {
      if (!dialog) { return; }
      dialog.addEventListener('close', syncScrollLock);
      dialog.addEventListener('click', function (event) {
        if (event.target === dialog) { dialog.close(); }
      });
    });
  }

  function onDocumentClick(event) {
    var target = event.target;
    if (!target || !target.closest) { return; }

    var closeBtn = target.closest('[data-close]');
    if (closeBtn) {
      closeDialog(closeBtn.closest('dialog'));
      return;
    }

    var manageBtn = target.closest('[data-action="manage"]');
    if (manageBtn) {
      toggleMenu(manageBtn);
      return;
    }

    var editBtn = target.closest('[data-action="edit"]');
    if (editBtn) {
      var editCard = editBtn.closest('[data-site-id]');
      closeMenus();
      if (editCard) { openSiteForm('edit', editCard.getAttribute('data-site-id')); }
      return;
    }

    var deleteBtn = target.closest('[data-action="delete"]');
    if (deleteBtn) {
      var deleteCard = deleteBtn.closest('[data-site-id]');
      closeMenus();
      var doomed = deleteCard ? findSite(deleteCard.getAttribute('data-site-id')) : null;
      if (doomed) { openConfirm(doomed); }
      return;
    }

    if (!target.closest('.card__menu')) { closeMenus(); }

    var viewBtn = target.closest('[data-view]');
    if (viewBtn) {
      setView(viewBtn.getAttribute('data-view'));
      return;
    }

    var sortBtn = target.closest('[data-sort]');
    if (sortBtn) {
      setSort(sortBtn.getAttribute('data-sort'));
      return;
    }

    var favBtn = target.closest('[data-action="favorite"]');
    if (favBtn) {
      var card = favBtn.closest('[data-site-id]');
      if (card) { toggleFavorite(card.getAttribute('data-site-id')); }
      return;
    }

    var link = target.closest('[data-action="visit"]');
    if (link) {
      var host = link.closest('[data-site-id]');
      var id = link.getAttribute('data-site-id') || (host && host.getAttribute('data-site-id'));
      if (id) { recordVisit(id); }
    }
  }

  function setView(view) {
    if (!view || state.view === view) { return; }
    if (view !== 'all' && view !== 'favorites' && view !== 'recent' && !categoryMap[view]) { return; }

    state.view = view;
    // 「最近访问」本身定义就是按时间排序，进入时自动切换排序方式
    if (view === 'recent') { state.sort = 'recent'; }

    renderAll();
    scrollToTop();
  }

  function setSort(sort) {
    if (sort !== 'visits' && sort !== 'recent' && sort !== 'name') { return; }
    if (state.sort === sort) { return; }
    state.sort = sort;
    renderGrid();
    updateSortState();
  }

  function recordVisit(id) {
    var site = findSite(id);
    if (!site) { return; }

    site.visits = (parseInt(site.visits, 10) || 0) + 1;
    site.lastUsed = Date.now();
    persist();

    updateCardVisits(id, site.visits);
    renderOverview();

    // 「最近访问」视图下顺序会变化，等浏览器完成跳转后再重排
    if (state.view === 'recent') {
      window.setTimeout(function () {
        if (state.view === 'recent') {
          renderGrid();
          renderOverview();
        }
      }, 60);
    }
  }

  function updateCardVisits(id, visits) {
    var card = els.grid.querySelector('[data-site-id="' + cssEscape(id) + '"] .card__visits-value');
    if (card) { card.textContent = String(visits); }
  }

  function toggleFavorite(id) {
    var site = findSite(id);
    if (!site) { return; }

    site.favorite = !site.favorite;
    persist();

    var card = els.grid.querySelector('[data-site-id="' + cssEscape(id) + '"]');
    var btn = card ? card.querySelector('[data-action="favorite"]') : null;
    if (btn) {
      var label = site.favorite ? '取消收藏 ' + site.name : '收藏 ' + site.name;
      btn.classList.toggle('is-active', site.favorite);
      btn.setAttribute('aria-pressed', site.favorite ? 'true' : 'false');
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
    }

    if (state.view === 'favorites') {
      renderGrid();
      updateHeader();
    }
    renderOverview();
  }

  /* --------------------------------------------------------- 网站管理 */

  function renderCategoryOptions() {
    if (!els.fCategory) { return; }
    els.fCategory.innerHTML = (DATA.categories || []).map(function (cat) {
      return '<option value="' + escapeAttr(cat.id) + '">' + escapeHtml(cat.name) + '</option>';
    }).join('');
  }

  function openSiteForm(mode, id) {
    if (!els.siteDialog) { return; }
    editingId = null;
    clearFormErrors();

    if (mode === 'edit') {
      var site = findSite(id);
      if (!site) { return; }
      editingId = site.id;
      els.dialogTitle.textContent = '编辑网站';
      els.submitBtn.textContent = '保存修改';
      els.fName.value = site.name;
      els.fUrl.value = site.url;
      els.fCategory.value = site.category;
      els.fDesc.value = site.desc;
      els.fTags.value = site.tags.join('，');
    } else {
      els.dialogTitle.textContent = '添加网站';
      els.submitBtn.textContent = '保存网站';
      els.siteForm.reset();
      els.fCategory.value = categoryMap[state.view] ? state.view : 'course';
      els.fTags.value = '';
    }

    openDialog(els.siteDialog);
    window.setTimeout(function () { els.fName.focus(); }, 30);
  }

  function onFormSubmit(event) {
    event.preventDefault();

    var data = {
      name: els.fName.value.trim(),
      url: els.fUrl.value.trim(),
      category: els.fCategory.value,
      desc: els.fDesc.value.trim(),
      tags: els.fTags.value
    };
    var result = validateSite(data);
    if (Object.keys(result.errors).length) {
      showFieldErrors(result.errors);
      return;
    }

    var cat = categoryMap[data.category];
    var isEdit = !!editingId;
    var site = isEdit ? findSite(editingId) : null;

    if (isEdit && site) {
      if (site.category !== data.category) {
        site.category = data.category;
        site.icon = safeIcon(cat.icon);
        site.color = safeColor(cat.color);
      }
      site.name = data.name;
      site.desc = data.desc;
      site.url = result.url;
      site.tags = result.tags;
    } else {
      sites.push(normalizeSite({
        id: uid(),
        name: data.name,
        desc: data.desc,
        url: result.url,
        category: data.category,
        icon: cat.icon,
        color: cat.color,
        tags: result.tags
      }, { visits: 0, lastUsed: null, favorite: false }));
    }

    persist();
    closeDialog(els.siteDialog);
    editingId = null;
    renderAll();
    showToast(isEdit ? '已保存「' + data.name + '」的修改' : '已添加「' + data.name + '」');
  }

  function validateSite(data) {
    var errors = {};
    var parsed = normalizeUrl(data.url);

    if (!data.name) {
      errors.name = '请填写网站名称';
    } else if (data.name.length > MAX_NAME) {
      errors.name = '网站名称不超过 ' + MAX_NAME + ' 个字符';
    }

    if (parsed.error) {
      errors.url = parsed.error;
    } else if (sites.some(function (s) {
      return s.id !== editingId && canonicalKey(s.url) === canonicalKey(parsed.url);
    })) {
      errors.url = '这个网址已经添加过了';
    }

    if (!categoryMap[data.category]) { errors.category = '请选择所属分类'; }
    if (data.desc.length > MAX_DESC) { errors.desc = '用途说明不超过 ' + MAX_DESC + ' 个字符'; }

    var tags = parseTags(data.tags);
    if (tags.length > MAX_TAGS) {
      errors.tags = '最多填写 ' + MAX_TAGS + ' 个标签';
    } else if (tags.some(function (tag) { return tag.length > MAX_TAG_LEN; })) {
      errors.tags = '每个标签不超过 ' + MAX_TAG_LEN + ' 个字符';
    }

    return { errors: errors, url: parsed.url, tags: tags };
  }

  function normalizeUrl(raw) {
    var text = String(raw || '').trim();
    if (!text) { return { error: '请填写网站网址' }; }
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) { text = 'https://' + text; }

    var url;
    try {
      url = new URL(text);
    } catch (err) {
      return { error: '网址格式不正确，例如 https://example.com' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { error: '只支持 http 或 https 开头的网址' };
    }
    if (!url.hostname || url.hostname.indexOf('.') === -1) {
      return { error: '请填写完整的域名，例如 example.com' };
    }
    url.hash = '';
    return { url: url.href };
  }

  function canonicalKey(url) {
    try {
      var u = new URL(url);
      return (u.hostname.replace(/^www\./i, '') + u.pathname.replace(/\/$/, '') + u.search).toLowerCase();
    } catch (err) {
      return String(url || '').toLowerCase();
    }
  }

  function parseTags(text) {
    var seen = {};
    return String(text || '').split(/[,，、;；\s]+/).map(function (tag) {
      return tag.trim();
    }).filter(function (tag) {
      if (!tag || seen[tag]) { return false; }
      seen[tag] = true;
      return true;
    });
  }

  function showFieldErrors(errors) {
    clearFormErrors();
    var first = null;
    Object.keys(errors).forEach(function (key) {
      var input = els['f' + key.charAt(0).toUpperCase() + key.slice(1)];
      var errorEl = document.getElementById('err-' + key);
      if (errorEl) { errorEl.textContent = errors[key]; }
      if (input) {
        input.setAttribute('aria-invalid', 'true');
        var field = input.closest('.field');
        if (field) { field.classList.add('has-error'); }
        if (!first) { first = input; }
      }
    });
    if (first) { first.focus(); }
  }

  function clearFormErrors() {
    document.querySelectorAll('#site-form .field').forEach(function (field) {
      field.classList.remove('has-error');
    });
    document.querySelectorAll('#site-form [aria-invalid]').forEach(function (input) {
      input.removeAttribute('aria-invalid');
    });
    document.querySelectorAll('#site-form .field__error').forEach(function (error) {
      error.textContent = '';
    });
  }

  function openConfirm(site) {
    if (!els.confirmDialog) { return; }
    pendingDeleteId = site.id;
    els.confirmText.innerHTML = '删除「<strong>' + escapeHtml(site.name) + '</strong>」后，' +
      '它的使用次数、收藏和最近访问记录会一并清除，且无法恢复。';
    openDialog(els.confirmDialog);
    window.setTimeout(function () { els.confirmBtn.focus(); }, 30);
  }

  function confirmDelete() {
    var site = findSite(pendingDeleteId);
    pendingDeleteId = null;
    if (!site) { closeDialog(els.confirmDialog); return; }

    var index = sites.indexOf(site);
    if (index > -1) { sites.splice(index, 1); }
    persist();
    closeDialog(els.confirmDialog);
    renderAll();
    showToast('已删除「' + site.name + '」');
  }

  function openDialog(dialog) {
    if (!dialog || dialog.open) { return; }
    document.documentElement.classList.add('is-locked');
    dialog.showModal();
  }

  function closeDialog(dialog) {
    if (dialog && dialog.open) { dialog.close(); }
  }

  function syncScrollLock() {
    if (!document.querySelector('dialog[open]')) {
      document.documentElement.classList.remove('is-locked');
    }
  }

  function toggleMenu(btn) {
    var card = btn.closest('[data-site-id]');
    var menu = card ? card.querySelector('.card__menu') : null;
    if (!menu) { return; }
    var willOpen = menu.hidden;
    closeMenus();
    if (!willOpen) { return; }
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    var first = menu.querySelector('.card__menu-item');
    if (first) { first.focus({ preventScroll: true }); }
  }

  function closeMenus() {
    els.grid.querySelectorAll('.card__menu').forEach(function (menu) {
      menu.hidden = true;
    });
    els.grid.querySelectorAll('[data-action="manage"]').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  /* ------------------------------------------------------------ 小工具 */

  function scrollToTop() {
    if (window.scrollY < 100) { return; }
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }

  function showToast(message) {
    if (!els.toast) { return; }
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      els.toast.classList.remove('is-visible');
    }, 2200);
  }

  function formatTime(ts) {
    var d = new Date(ts);
    var now = new Date();
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (sameDay(d, now)) { return '今天 ' + hm; }
    var yesterday = new Date(now.getTime());
    yesterday.setDate(yesterday.getDate() - 1);
    if (sameDay(d, yesterday)) { return '昨天 ' + hm; }
    if (d.getFullYear() === now.getFullYear()) {
      return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm;
    }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function uid() {
    return 's-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function safeUrl(url) {
    var text = String(url || '');
    return /^https?:\/\//i.test(text) ? text : '#';
  }

  function safeIcon(icon) {
    var text = String(icon || '');
    return /^i-[a-z0-9-]+$/.test(text) ? text : 'i-grid';
  }

  function safeColor(color) {
    var text = String(color || '');
    return /^#[0-9a-f]{3,8}$/i.test(text) ? text : '#2f6bff';
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(text) { return escapeHtml(text); }

  function cssEscape(text) {
    if (window.CSS && typeof window.CSS.escape === 'function') { return window.CSS.escape(text); }
    return String(text).replace(/["\\]/g, '\\$&');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
