/**
 * StudyHub V0.1.1 —— 页面逻辑
 * ------------------------------------------------------------------
 * 职责划分：
 *   data.js  提供「预置数据」，仅在浏览器首次初始化时作为种子
 *   store.js 负责持久化层（校验、迁移、备份、读写）
 *   本文件   负责界面、筛选、排序、渲染与交互
 *
 * 数据流：
 *   SH.store.init() ── 读取/迁移得到 v3 文档，暴露 state.document
 *   本文件只读 doc / sites，所有写入先构造副本再交给 SH.store.save()
 *
 * 只使用普通 script，不依赖 ES Module 与 fetch。
 * ------------------------------------------------------------------
 */
(function () {
  'use strict';

  var DATA = window.STUDYHUB_DATA;
  if (!DATA || !Array.isArray(DATA.sites)) { return; }

  var PANEL_ROWS = 4;
  var MAX_NAME = 30;
  var MAX_DESC = 60;
  var MAX_TAGS = 5;
  var MAX_TAG_LEN = 12;
  var MAX_ICON_BYTES = 2 * 1024 * 1024;
  var ICON_MAX_SIZE = 128;
  var ICON_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
  var FAVICON_TIMEOUT = 4500;

  var VIEW_TITLES = { all: '全部网站', favorites: '我的收藏', recent: '最近访问' };
  var EMPTY_STATES = {
    all: { title: '暂时还没有网站', hint: '点击「添加网站」，把常用的站点收进来。' },
    favorites: { title: '还没有收藏任何网站', hint: '点击卡片右上角的星标，即可把常用网站收进来。' },
    recent: { title: '还没有访问记录', hint: '点击任意网站卡片后，这里会按时间显示最近打开过的网站。' },
    category: { title: '该分类下还没有网站', hint: '点击「添加网站」，把站点添加到这个分类。' }
  };

  var WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  var state = {
    view: 'all',
    sort: 'visits',
    tags: [],
    query: '',
    tagsExpanded: false,
    tagQuery: '',
    tagShowAll: false
  };
  var api = null;
  var doc = null;
  var readOnly = false;
  var readOnlyMessage = '';
  var readOnlyBar = null;
  var sites = [];
  var categoryMap = {};
  var collator = null;
  var toastTimer = 0;
  var editingId = null;
  var pendingDeleteId = null;
  var iconDraft = null;
  var iconCache = {};
  var lastFocus = null;
  var els = {};

  /* 设置页与分类管理 */
  var settingsTab = 'categories';
  var editingCategoryId = null;
  var pendingCategoryId = null;
  var dragCategoryId = null;
  var dragOverCategoryId = null;

  /* 标签管理 */
  var editingTag = null;
  var pendingTag = null;

  var SETTINGS_TABS = {
    appearance: { title: '外观', desc: '选择界面的深浅色模式，切换后立即生效并保存在本地。' },
    display: {
      title: '网站显示',
      coming: ['网站显示设置尚未开放', '后续会在这里调整卡片密度、显示字段等。']
    },
    categories: { title: '分类管理', desc: '调整主页面左侧的分类顺序，也可以新增或删除分类。' },
    tags: { title: '标签管理', desc: '标签由网站表单自动汇总，可在这里重命名或删除。' },
    data: {
      title: '数据管理',
      desc: '导出完整备份，或从备份文件恢复网站、分类、设置和图标。'
    },
    about: {
      title: '关于 StudyHub',
      coming: ['关于 StudyHub', '个人学习导航，纯静态页面，数据保存在浏览器本地。']
    }
  };

  var CATEGORY_ICONS = [
    { symbol: 'i-grid', label: '网格' },
    { symbol: 'i-cap', label: '学习' },
    { symbol: 'i-code', label: '编程' },
    { symbol: 'i-flask', label: '实验' },
    { symbol: 'i-book', label: '书籍' },
    { symbol: 'i-file', label: '文档' },
    { symbol: 'i-library', label: '图书馆' },
    { symbol: 'i-landmark', label: '院校' },
    { symbol: 'i-atom', label: '理科' },
    { symbol: 'i-chip', label: '电子' },
    { symbol: 'i-monitor', label: '设备' },
    { symbol: 'i-home', label: '生活' },
    { symbol: 'i-star', label: '收藏' },
    { symbol: 'i-clock', label: '时间' },
    { symbol: 'i-video', label: '视频' },
    { symbol: 'i-layers', label: '资料' },
    { symbol: 'i-bug', label: '调试' },
    { symbol: 'i-sun', label: '轻主题' }
  ];

  var CATEGORY_COLORS = ['#2f6bff', '#7c5cff', '#0ea5a4', '#e0793c', '#d24a7a', '#3f8f4f', '#8a6d3b', '#4a6fa5'];

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
      fTags: document.getElementById('f-tags'),

      settingsView: document.getElementById('settings-view'),
      settingsNav: document.getElementById('settings-nav'),
      settingsTitle: document.getElementById('settings-title'),
      settingsDesc: document.getElementById('settings-desc'),
      panelCategories: document.getElementById('settings-panel-categories'),
      panelAppearance: document.getElementById('settings-panel-appearance'),
      panelTags: document.getElementById('settings-panel-tags'),
      themeStatus: document.getElementById('theme-status'),
      panelComing: document.getElementById('settings-panel-coming'),
      comingTitle: document.getElementById('coming-title'),
      comingText: document.getElementById('coming-text'),
      categoryAdminList: document.getElementById('category-admin-list'),
      addCategoryBtn: document.getElementById('add-category-btn'),
      tagAdminList: document.getElementById('tag-admin-list'),
      tagAdminEmpty: document.getElementById('tag-admin-empty'),
      tagDialog: document.getElementById('tag-dialog'),
      tagForm: document.getElementById('tag-form'),
      tagDialogTitle: document.getElementById('tag-dialog-title'),
      tagSubmit: document.getElementById('tag-submit'),
      tName: document.getElementById('t-name'),
      tNameError: document.getElementById('err-t-name'),
      tagDeleteDialog: document.getElementById('tag-delete-dialog'),
      tagDeleteText: document.getElementById('tag-delete-text'),
      tagDeleteConfirm: document.getElementById('tag-delete-confirm'),
      tagFilter: document.getElementById('tag-filter'),
      tagFilterList: document.getElementById('tag-filter-list'),
      tagFilterClear: document.getElementById('tag-filter-clear'),
      tagToggle: document.getElementById('tag-filter-toggle'),
      tagToggleText: document.getElementById('tag-filter-toggle-text'),
      tagCount: document.getElementById('tag-filter-count'),
      tagSelected: document.getElementById('tag-filter-selected'),
      tagBody: document.getElementById('tag-filter-body'),
      tagMeta: document.getElementById('tag-filter-meta'),
      tagShowAll: document.getElementById('tag-filter-showall'),
      tagSearch: document.getElementById('tag-search'),
      searchInput: document.getElementById('search-input'),
      searchClear: document.getElementById('search-clear'),
      categoryDialog: document.getElementById('category-dialog'),
      categoryForm: document.getElementById('category-form'),
      categoryDialogTitle: document.getElementById('category-dialog-title'),
      categorySubmit: document.getElementById('category-submit'),
      cName: document.getElementById('c-name'),
      cIcon: document.getElementById('c-icon'),
      cColor: document.getElementById('c-color'),
      cNameError: document.getElementById('err-c-name'),
      categoryDeleteDialog: document.getElementById('category-delete-dialog'),
      categoryDeleteText: document.getElementById('category-delete-text'),
      categoryMigrateField: document.getElementById('category-migrate-field'),
      categoryMigrate: document.getElementById('category-migrate'),
      categoryMigrateError: document.getElementById('err-category-migrate'),
      categoryDeleteConfirm: document.getElementById('category-delete-confirm'),
      iconPreview: document.getElementById('icon-preview'),
      iconSources: document.getElementById('icon-sources'),
      iconHint: document.getElementById('icon-hint'),
      iconPanelUrl: document.getElementById('icon-panel-url'),
      iconPanelUpload: document.getElementById('icon-panel-upload'),
      fIconUrl: document.getElementById('f-icon-url'),
      fIconFile: document.getElementById('f-icon-file'),
      iconUploadBtn: document.getElementById('icon-upload-btn'),
      iconFileName: document.getElementById('icon-file-name'),
      iconReset: document.getElementById('icon-reset'),
      iconError: document.getElementById('err-icon'),

      panelData: document.getElementById('settings-panel-data'),
      dataSiteCount: document.getElementById('data-site-count'),
      dataCategoryCount: document.getElementById('data-category-count'),
      dataIconCount: document.getElementById('data-icon-count'),
      exportBackupBtn: document.getElementById('export-backup-btn'),
      chooseBackupBtn: document.getElementById('choose-backup-btn'),
      backupFileInput: document.getElementById('backup-file-input'),
      dataFile: document.getElementById('data-file'),
      dataFileName: document.getElementById('data-file-name'),
      dataFileMeta: document.getElementById('data-file-meta'),
      restoreBackupBtn: document.getElementById('restore-backup-btn'),
      clearBackupBtn: document.getElementById('clear-backup-btn'),
      dataError: document.getElementById('data-error'),
      dataReadonly: document.getElementById('data-readonly'),
      restoreDialog: document.getElementById('restore-dialog'),
      restoreText: document.getElementById('restore-text'),
      restoreSummary: document.getElementById('restore-summary'),
      restoreConfirm: document.getElementById('restore-confirm')
    };
    if (!els.grid) { return; }

    collator = typeof Intl !== 'undefined' && Intl.Collator
      ? new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })
      : null;

    indexCategories();
    bootStore();
    rebuildCategoryMap();
    initTheme();

    renderDate();
    renderCategories();
    renderCategoryOptions();
    renderSettings();
    bindEvents();

    renderAll();
    applyRoute();

    if (readOnly) {
      showToast(readOnlyMessage || '只读模式：本地数据受保护，暂不能修改');
    }
  }

  /* ------------------------------------------------------------ 数据层 */

  function indexCategories() {
    (DATA.categories || []).forEach(function (cat) {
      categoryMap[cat.id] = cat;
    });
  }

  /** 当前分类来源：优先 V3 文档，尚未就绪时回退到预置数据 */
  function categories() {
    var list = doc && Array.isArray(doc.categories) && doc.categories.length
      ? doc.categories
      : (DATA.categories || []);
    return list.slice().sort(function (a, b) {
      var ao = typeof a.order === 'number' ? a.order : 0;
      var bo = typeof b.order === 'number' ? b.order : 0;
      return ao - bo;
    });
  }

  function rebuildCategoryMap() {
    categoryMap = {};
    categories().forEach(function (cat) {
      categoryMap[cat.id] = cat;
    });
  }

  function findCategory(id) {
    var list = categories();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { return list[i]; }
    }
    return null;
  }

  /** 只调用一次 SH.store.init()，之后所有写入都走 store.save() */
  function bootStore() {
    api = window.SH && window.SH.store ? window.SH.store : null;
    if (!api) {
      doc = null;
      sites = [];
      readOnly = true;
      readOnlyMessage = '数据模块未加载，页面进入只读模式';
      return;
    }

    var boot = null;
    try {
      boot = api.init({ seed: DATA });
    } catch (err) {
      boot = null;
    }

    doc = boot && boot.doc ? boot.doc : null;
    sites = doc && Array.isArray(doc.sites) ? doc.sites : [];
    readOnly = !boot || boot.mode !== 'normal';
    readOnlyMessage = boot ? String(boot.message || boot.reason || '') : '';

    if (readOnly && !doc) {
      readOnlyMessage = '本地数据无法读取，已进入只读模式';
    } else if (readOnly && readOnlyMessage && readOnlyMessage.indexOf('只读') < 0) {
      readOnlyMessage = '只读模式：' + readOnlyMessage;
    } else if (readOnly && !readOnlyMessage) {
      readOnlyMessage = '只读模式：本地数据受保护，暂不能修改';
    }
    if (readOnly) {
      applyReadOnlyState();
    }
  }

  /** 候选文档：与已提交文档完全隔离的深拷贝 */
  function cloneDoc(value) {
    return value ? JSON.parse(JSON.stringify(value)) : null;
  }

  function findSiteIn(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { return list[i]; }
    }
    return null;
  }

  /**
   * 提交候选文档。成功前不触碰 doc/sites，失败时内存状态保持原样。
   */
  function commit(candidate) {
    if (!api || readOnly) {
      notifyReadOnly();
      return false;
    }

    var saved = api.save(candidate);
    if (!saved || !saved.ok) {
      var code = saved ? saved.code : '';
      if (code === 'READONLY') {
        readOnly = true;
        readOnlyMessage = (saved && saved.message) || '数据校验未通过，已进入只读模式';
        applyReadOnlyState();
        notifyReadOnly();
      } else if (code === 'QUOTA') {
        showToast('本地存储空间不足，本次修改未保存');
      } else if (code === 'SCHEMA') {
        showToast('数据校验未通过，本次修改未保存');
      } else {
        showToast('保存失败，本次修改未生效');
      }
      return false;
    }

    doc = saved.doc;
    sites = doc.sites;
    return true;
  }

  function applyReadOnlyState() {
    if (els.addBtn) {
      els.addBtn.disabled = true;
      els.addBtn.setAttribute('aria-disabled', 'true');
      els.addBtn.title = readOnlyMessage || '只读模式';
      els.addBtn.style.opacity = '0.55';
      els.addBtn.style.cursor = 'not-allowed';
    }
    syncReadOnlyBar();
  }

  /** 只读横幅：不写入任何数据，仅在页面顶部提示当前状态 */
  function syncReadOnlyBar() {
    var header = document.querySelector('.topbar');

    if (!readOnly) {
      if (readOnlyBar && readOnlyBar.parentNode) {
        readOnlyBar.parentNode.removeChild(readOnlyBar);
      }
      readOnlyBar = null;
      return;
    }

    if (!header) { return; }

    var broken = !doc;
    if (!readOnlyBar) {
      readOnlyBar = document.createElement('div');
      readOnlyBar.id = 'readonly-bar';
      readOnlyBar.className = 'readonly-bar';
      readOnlyBar.setAttribute('role', 'status');
      readOnlyBar.setAttribute('aria-live', 'polite');
      readOnlyBar.innerHTML =
        '<div class="readonly-bar__inner">' +
          '<span class="readonly-bar__icon" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24">' +
              '<rect x="4.8" y="10.4" width="14.4" height="9.6" rx="2.4"/>' +
              '<path d="M8.4 10.4V8a3.6 3.6 0 0 1 7.2 0v2.4"/>' +
            '</svg>' +
          '</span>' +
          '<strong class="readonly-bar__title"></strong>' +
          '<span class="readonly-bar__desc"></span>' +
        '</div>';
      header.insertAdjacentElement('afterend', readOnlyBar);
    }

    var titleEl = readOnlyBar.querySelector('.readonly-bar__title');
    var descEl = readOnlyBar.querySelector('.readonly-bar__desc');
    var title = broken ? '数据读取异常' : '只读模式';
    var desc = broken
      ? '本地数据无法读取，已进入只读模式；现有数据不会被修改。请检查浏览器存储权限，或稍后从备份恢复。'
      : stripReadOnlyPrefix(readOnlyMessage) || '本地数据受保护，暂不能修改。网站仍可正常打开与浏览。';

    readOnlyBar.className = 'readonly-bar' + (broken ? ' readonly-bar--error' : '');
    titleEl.textContent = title;
    descEl.textContent = desc;
    readOnlyBar.title = readOnlyMessage || title;
  }

  function stripReadOnlyPrefix(message) {
    return String(message || '').replace(/^只读模式[：:]\s*/, '');
  }

  /* ------------------------------------------------------------ 主题层 */
  var themeMedia = null;
  var themeTimer = 0;
  var THEME_COLORS = { light: '#f5f7fb', dark: '#0e1117' };

  function currentThemePref() {
    var value = doc && doc.settings ? doc.settings.theme : 'system';
    return value === 'light' || value === 'dark' ? value : 'system';
  }

  function resolveTheme(pref) {
    if (pref === 'light' || pref === 'dark') { return pref; }
    return themeMedia && themeMedia.matches ? 'dark' : 'light';
  }

  function updateThemeCards(pref, resolved) {
    var cards = document.querySelectorAll('[data-theme-choice]');
    Array.prototype.forEach.call(cards, function (card) {
      var active = card.getAttribute('data-theme-choice') === pref;
      card.classList.toggle('is-active', active);
      card.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    if (els.themeStatus) {
      els.themeStatus.textContent = pref === 'system'
        ? '当前跟随系统：' + (resolved === 'dark' ? '深色' : '浅色')
        : '当前固定为' + (pref === 'dark' ? '深色' : '浅色') + '模式';
    }
  }

  function applyTheme(pref, options) {
    var resolved = resolveTheme(pref);
    var root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    root.setAttribute('data-theme-pref', pref);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) { meta.setAttribute('content', THEME_COLORS[resolved]); }
    updateThemeCards(pref, resolved);
    if (options && options.animate) {
      root.classList.add('theme-anim');
      window.clearTimeout(themeTimer);
      themeTimer = window.setTimeout(function () { root.classList.remove('theme-anim'); }, 260);
    }
  }

  function initTheme() {
    if (window.matchMedia) {
      themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
      var onSystemThemeChange = function () {
        if (currentThemePref() === 'system') { applyTheme('system', { animate: true }); }
      };
      if (themeMedia.addEventListener) { themeMedia.addEventListener('change', onSystemThemeChange); }
      else if (themeMedia.addListener) { themeMedia.addListener(onSystemThemeChange); }
    }
    applyTheme(currentThemePref());
  }

  function setTheme(pref) {
    if (pref !== 'light' && pref !== 'dark' && pref !== 'system') { return; }
    if (readOnly) { notifyReadOnly(); return; }
    if (!doc) { return; }
    if (currentThemePref() === pref) {
      applyTheme(pref);
      return;
    }
    var candidate = cloneDoc(doc);
    candidate.settings = candidate.settings || {};
    candidate.settings.theme = pref;
    if (!commit(candidate)) { return; }
    applyTheme(pref, { animate: true });
    showToast(pref === 'system' ? '已切换为跟随系统' : '已切换为' + (pref === 'dark' ? '深色' : '浅色') + '模式');
  }

  function notifyReadOnly() {
    showToast(readOnlyMessage || '只读模式：本地数据受保护，暂不能修改');
  }

  function findSite(id) {
    return findSiteIn(sites, id);
  }

  /* ------------------------------------------------------------ 视图层 */

  function renderAll() {
    renderTagFilter();
    renderGrid();
    renderOverview();
    hydrateIcons();
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
    els.categoryList.innerHTML = categories().map(function (cat) {
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

  /* ------------------------------------------------------------ 标签 */

  /** 从网站 tags 字段动态汇总，不额外存储 */
  function tagStats() {
    var map = {};
    sites.forEach(function (site) {
      (site.tags || []).forEach(function (tag) {
        if (!map[tag]) { map[tag] = { name: tag, count: 0 }; }
        map[tag].count += 1;
      });
    });
    var list = Object.keys(map).map(function (key) { return map[key]; });
    list.sort(function (a, b) {
      if (b.count !== a.count) { return b.count - a.count; }
      if (collator) { return collator.compare(a.name, b.name); }
      return a.name.localeCompare(b.name);
    });
    return list;
  }

  var TAG_COMMON_LIMIT = 6;

  function tagChipHTML(item) {
    var selected = state.tags.indexOf(item.name) >= 0;
    return '<button class="tag-chip' + (selected ? ' is-active' : '') + '" type="button"' +
      ' data-tag-filter="' + escapeAttr(item.name) + '" aria-pressed="' + (selected ? 'true' : 'false') + '">' +
      '<span class="tag-chip__name">' + escapeHtml(item.name) + '</span>' +
      '<span class="tag-chip__count">' + item.count + '</span>' +
    '</button>';
  }

  function selectedTagHTML(name) {
    return '<span class="tag-selected">' +
      '<span>' + escapeHtml(name) + '</span>' +
      '<button type="button" data-tag-remove="' + escapeAttr(name) + '"' +
        ' aria-label="移除标签 ' + escapeAttr(name) + '" title="移除标签">' +
        '<svg class="icon" aria-hidden="true"><use href="#i-x"/></svg>' +
      '</button>' +
    '</span>';
  }

  /** 搜索时在全量标签里找；否则按「常用 6 个 / 全部」显示 */
  function visibleTagStats(stats) {
    if (state.tagQuery) {
      var needle = state.tagQuery.toLowerCase();
      return stats.filter(function (item) {
        return item.name.toLowerCase().indexOf(needle) >= 0;
      });
    }
    return state.tagShowAll ? stats.slice() : stats.slice(0, TAG_COMMON_LIMIT);
  }

  function renderTagList(stats) {
    var shown = visibleTagStats(stats);
    els.tagFilterList.innerHTML = shown.length
      ? shown.map(tagChipHTML).join('')
      : '<p class="tag-filter__none">没有匹配的标签</p>';

    els.tagShowAll.hidden = !!state.tagQuery || stats.length <= TAG_COMMON_LIMIT;
    els.tagShowAll.textContent = state.tagShowAll ? '只看常用' : '显示全部 ' + stats.length + ' 个';
    els.tagMeta.textContent = (state.tags.length ? '已选 ' + state.tags.length + ' 个 · ' : '') +
      '共 ' + stats.length + ' 个标签';

    if (els.tagSearch && els.tagSearch.value !== state.tagQuery) {
      els.tagSearch.value = state.tagQuery;
    }
  }

  function renderTagFilter() {
    if (!els.tagFilter || !els.tagFilterList) { return; }
    var stats = tagStats();
    var available = {};
    stats.forEach(function (item) { available[item.name] = true; });

    // 数据变化后丢弃已不存在的标签
    state.tags = state.tags.filter(function (tag) { return available[tag]; });

    els.tagFilter.hidden = !stats.length;
    if (!stats.length) {
      state.tagsExpanded = false;
      state.tagQuery = '';
      state.tagShowAll = false;
      els.tagFilterList.innerHTML = '';
      els.tagSelected.innerHTML = '';
      els.tagFilterClear.hidden = true;
      els.tagCount.hidden = true;
      els.tagBody.hidden = true;
      if (els.tagSearch) { els.tagSearch.value = ''; }
      return;
    }

    els.tagFilter.classList.toggle('is-expanded', state.tagsExpanded);
    els.tagToggle.setAttribute('aria-expanded', state.tagsExpanded ? 'true' : 'false');
    els.tagToggleText.textContent = state.tagsExpanded ? '收起标签' : '标签筛选';
    els.tagBody.hidden = !state.tagsExpanded;
    els.tagCount.hidden = !state.tags.length;
    els.tagCount.textContent = String(state.tags.length);
    els.tagSelected.innerHTML = state.tags.map(selectedTagHTML).join('');
    els.tagFilterClear.hidden = !state.tags.length;
    renderTagList(stats);
  }

  /** 标签变化只刷新网格与标签条，不重建搜索输入框，避免打断输入 */
  function applyTagChange() {
    renderTagFilter();
    renderGrid();
    renderOverview();
  }

  function toggleTagFilter(tag) {
    var index = state.tags.indexOf(tag);
    if (index >= 0) { state.tags.splice(index, 1); } else { state.tags.push(tag); }
    applyTagChange();
  }

  function removeTagFilter(tag) {
    var index = state.tags.indexOf(tag);
    if (index < 0) { return; }
    state.tags.splice(index, 1);
    applyTagChange();
  }

  function clearTagFilter() {
    if (!state.tags.length) { return; }
    state.tags = [];
    applyTagChange();
  }

  function onSearchInput() {
    if (!els.searchInput) { return; }
    state.query = els.searchInput.value.trim();
    if (els.searchClear) { els.searchClear.hidden = !els.searchInput.value; }
    renderGrid();
  }

  function clearSearch(keepFocus) {
    if (!els.searchInput) { return; }
    els.searchInput.value = '';
    state.query = '';
    if (els.searchClear) { els.searchClear.hidden = true; }
    renderGrid();
    if (keepFocus) { els.searchInput.focus(); }
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
    if (readOnly && !doc) {
      els.emptyTitle.textContent = '本地数据无法读取';
      els.emptyHint.textContent = '已进入只读模式，页面不会写入任何数据。请恢复浏览器本地数据后刷新重试。';
      els.empty.hidden = false;
      return;
    }
    var copy = EMPTY_STATES[state.view] || EMPTY_STATES.category;
    if (state.query && state.tags.length) {
      els.emptyTitle.textContent = '没有符合搜索和标签条件的网站';
      els.emptyHint.textContent = '试试更换关键词、减少已选标签，或清除全部筛选条件。';
      els.empty.hidden = false;
      return;
    }
    if (state.query) {
      els.emptyTitle.textContent = '没有找到匹配的网站';
      els.emptyHint.textContent = '换个关键词试试，搜索会匹配名称、网址、描述和标签。';
      els.empty.hidden = false;
      return;
    }
    if (state.tags.length) {
      els.emptyTitle.textContent = '没有同时包含这些标签的网站';
      els.emptyHint.textContent = '试试减少已选标签，或点击「清除全部」恢复当前视图的全部网站。';
      els.empty.hidden = false;
      return;
    }
    els.emptyTitle.textContent = copy.title;
    els.emptyHint.textContent = copy.hint;
    els.empty.hidden = false;
  }

  function cardHTML(site) {
    var favLabel = site.favorite ? '取消收藏 ' + site.name : '收藏 ' + site.name;
    return '<article class="card" data-site-id="' + escapeAttr(site.id) + '" style="--accent:' + site.color + '">' +
      '<div class="card__head">' +
        iconBoxHTML(site, 'card__icon') +
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
        iconBoxHTML(site, 'mini__icon') +
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
    var list;
    if (state.view === 'all') { list = sites.slice(); }
    else if (state.view === 'favorites') { list = sites.filter(function (s) { return s.favorite; }); }
    else if (state.view === 'recent') { list = sites.filter(function (s) { return s.lastUsed; }); }
    else { list = sites.filter(function (s) { return s.category === state.view; }); }

    if (state.tags.length) {
      list = list.filter(function (site) {
        return state.tags.every(function (tag) { return site.tags.indexOf(tag) >= 0; });
      });
    }

    if (state.query) {
      var needle = state.query.toLowerCase();
      list = list.filter(function (site) {
        var hay = [site.name, site.url, site.desc, (site.tags || []).join(' ')].join('\n');
        return hay.toLowerCase().indexOf(needle) >= 0;
      });
    }
    return list;
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
        window.location.hash = '#/settings';
      });
    }
    window.addEventListener('hashchange', applyRoute);

    var themeOptions = document.querySelector('.theme-options');
    if (themeOptions) {
      themeOptions.addEventListener('click', function (event) {
        var card = event.target.closest('[data-theme-choice]');
        if (!card) { return; }
        setTheme(card.getAttribute('data-theme-choice'));
      });
    }
    if (els.settingsNav) {
      els.settingsNav.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-settings-tab]');
        if (!btn) { return; }
        settingsTab = btn.getAttribute('data-settings-tab');
        renderSettings();
      });
    }
    if (els.addCategoryBtn) {
      els.addCategoryBtn.addEventListener('click', function () { openCategoryForm('add'); });
    }
    if (els.categoryForm) {
      els.categoryForm.addEventListener('submit', onCategorySubmit);
    }
    if (els.categoryDeleteConfirm) {
      els.categoryDeleteConfirm.addEventListener('click', confirmCategoryDelete);
    }
    if (els.categoryAdminList) {
      bindCategoryAdminEvents();
    }

    if (els.tagForm) {
      els.tagForm.addEventListener('submit', onTagSubmit);
    }
    if (els.tagDeleteConfirm) {
      els.tagDeleteConfirm.addEventListener('click', confirmTagDelete);
    }
    if (els.tagAdminList) {
      els.tagAdminList.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-tag-action]');
        if (!btn) { return; }
        var row = btn.closest('[data-tag-name]');
        if (!row) { return; }
        var name = row.getAttribute('data-tag-name');
        if (btn.getAttribute('data-tag-action') === 'rename') { openTagForm(name); }
        else { openTagDelete(name); }
      });
    }

    if (els.tagFilterClear) {
      els.tagFilterClear.addEventListener('click', clearTagFilter);
    }
    if (els.tagToggle) {
      els.tagToggle.addEventListener('click', function () {
        state.tagsExpanded = !state.tagsExpanded;
        renderTagFilter();
      });
    }
    if (els.tagSelected) {
      els.tagSelected.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-tag-remove]');
        if (btn) { removeTagFilter(btn.getAttribute('data-tag-remove')); }
      });
    }
    if (els.tagSearch) {
      els.tagSearch.addEventListener('input', function () {
        state.tagQuery = els.tagSearch.value;
        renderTagList(tagStats());
      });
      els.tagSearch.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          event.stopPropagation();
          state.tagQuery = '';
          els.tagSearch.value = '';
          renderTagList(tagStats());
        }
      });
    }
    if (els.tagShowAll) {
      els.tagShowAll.addEventListener('click', function () {
        state.tagShowAll = !state.tagShowAll;
        renderTagList(tagStats());
      });
    }
    if (els.searchInput) {
      els.searchInput.addEventListener('input', onSearchInput);
      els.searchInput.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && els.searchInput.value) {
          event.stopPropagation();
          clearSearch(true);
        }
      });
    }
    if (els.searchClear) {
      els.searchClear.addEventListener('click', function () { clearSearch(true); });
    }

    if (els.addBtn) {
      els.addBtn.addEventListener('click', function () { openSiteForm('add'); });
    }
    if (els.siteForm) {
      els.siteForm.addEventListener('submit', onFormSubmit);
    }
    if (els.iconSources) {
      els.iconSources.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-icon-source]');
        if (!btn) { return; }
        setIconSource(btn.getAttribute('data-icon-source'));
      });
    }
    if (els.iconUploadBtn) {
      els.iconUploadBtn.addEventListener('click', function () {
        if (els.fIconFile) { els.fIconFile.click(); }
      });
    }
    if (els.fIconFile) {
      els.fIconFile.addEventListener('change', function () {
        var file = els.fIconFile.files && els.fIconFile.files[0];
        if (file) { handleIconFile(file); }
      });
    }
    if (els.iconReset) {
      els.iconReset.addEventListener('click', function () {
        if (!iconDraft) { return; }
        if (iconDraft.imageId) { iconDraft.removeImageId = iconDraft.imageId; }
        iconDraft.imageId = '';
        iconDraft.file = null;
        iconDraft.url = '';
        iconDraft.source = 'builtin';
        revokeDraftPreview();
        if (els.fIconUrl) { els.fIconUrl.value = ''; }
        if (els.fIconFile) { els.fIconFile.value = ''; }
        if (els.iconFileName) { els.iconFileName.textContent = 'PNG / JPG / WebP，不超过 2MB'; }
        if (els.iconError) { els.iconError.textContent = ''; }
        renderIconPicker();
      });
    }
    if (els.fIconUrl) {
      var iconUrlTimer = 0;
      els.fIconUrl.addEventListener('input', function () {
        if (!iconDraft) { return; }
        iconDraft.url = els.fIconUrl.value.trim();
        window.clearTimeout(iconUrlTimer);
        iconUrlTimer = window.setTimeout(refreshIconPreview, 300);
      });
    }
    if (els.fCategory) {
      els.fCategory.addEventListener('change', function () {
        if (iconDraft) { refreshIconPreview(); }
      });
    }
    if (els.fUrl) {
      var faviconTimer = 0;
      els.fUrl.addEventListener('input', function () {
        if (!iconDraft || iconDraft.source !== 'auto') { return; }
        window.clearTimeout(faviconTimer);
        faviconTimer = window.setTimeout(refreshIconPreview, 450);
      });
    }
    if (els.exportBackupBtn) {
      els.exportBackupBtn.addEventListener('click', onExportBackup);
    }
    if (els.chooseBackupBtn) {
      els.chooseBackupBtn.addEventListener('click', function () {
        if (readOnly) { notifyReadOnly(); return; }
        clearDataError();
        if (els.backupFileInput) { els.backupFileInput.click(); }
      });
    }
    if (els.backupFileInput) {
      els.backupFileInput.addEventListener('change', function () {
        var file = els.backupFileInput.files && els.backupFileInput.files[0];
        if (file) { handleBackupFile(file); }
        els.backupFileInput.value = '';
      });
    }
    if (els.restoreBackupBtn) {
      els.restoreBackupBtn.addEventListener('click', openRestoreDialog);
    }
    if (els.clearBackupBtn) {
      els.clearBackupBtn.addEventListener('click', function () {
        pendingBackup = null;
        clearDataError();
        updateDataFile();
      });
    }
    if (els.restoreConfirm) {
      els.restoreConfirm.addEventListener('click', confirmRestore);
    }
    if (els.confirmBtn) {
      els.confirmBtn.addEventListener('click', confirmDelete);
    }
    [els.siteDialog, els.confirmDialog, els.categoryDialog, els.categoryDeleteDialog,
      els.tagDialog, els.tagDeleteDialog, els.restoreDialog].forEach(function (dialog) {
      if (!dialog) { return; }
      dialog.addEventListener('close', function () {
        syncScrollLock();
        if (dialog === els.siteDialog) { revokeDraftPreview(); }
      });
      dialog.addEventListener('click', function (event) {
        if (event.target === dialog) { dialog.close(); }
      });
    });
  }

  function bindCategoryAdminEvents() {
    els.categoryAdminList.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-cat-action]');
      if (!btn) { return; }
      var row = btn.closest('[data-cat-id]');
      if (!row) { return; }
      var id = row.getAttribute('data-cat-id');
      var action = btn.getAttribute('data-cat-action');
      if (action === 'up') { moveCategory(id, -1); }
      else if (action === 'down') { moveCategory(id, 1); }
      else if (action === 'edit') { openCategoryForm('edit', id); }
      else if (action === 'delete') { openCategoryDelete(id); }
    });

    els.categoryAdminList.addEventListener('dragstart', function (event) {
      var row = event.target.closest('[data-cat-id]');
      if (!row) { return; }
      dragCategoryId = row.getAttribute('data-cat-id');
      row.classList.add('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', dragCategoryId);
      }
    });

    els.categoryAdminList.addEventListener('dragover', function (event) {
      if (!dragCategoryId) { return; }
      var row = event.target.closest('[data-cat-id]');
      if (!row) { return; }
      event.preventDefault();
      if (event.dataTransfer) { event.dataTransfer.dropEffect = 'move'; }
      var id = row.getAttribute('data-cat-id');
      if (id !== dragOverCategoryId) { clearDropMarkers(); }
      dragOverCategoryId = id;
      var rect = row.getBoundingClientRect();
      var before = event.clientY - rect.top < rect.height / 2;
      row.classList.toggle('is-drop-before', before);
      row.classList.toggle('is-drop-after', !before);
    });

    els.categoryAdminList.addEventListener('drop', function (event) {
      var row = event.target.closest('[data-cat-id]');
      if (!dragCategoryId || !row) { return; }
      event.preventDefault();
      var targetId = row.getAttribute('data-cat-id');
      var rect = row.getBoundingClientRect();
      var before = event.clientY - rect.top < rect.height / 2;
      var dragId = dragCategoryId;
      dragCategoryId = null;
      clearDropMarkers();
      if (targetId === dragId) { return; }
      reorderCategoryByDrag(dragId, targetId, before);
    });

    els.categoryAdminList.addEventListener('dragend', function () {
      dragCategoryId = null;
      clearDropMarkers();
    });
  }

  function reorderCategoryByDrag(dragId, targetId, before) {
    var ids = categories().map(function (cat) { return cat.id; })
      .filter(function (id) { return id !== dragId; });
    var index = ids.indexOf(targetId);
    if (index < 0) { return; }
    ids.splice(before ? index : index + 1, 0, dragId);
    saveCategoryOrder(ids);
  }

  function clearDropMarkers() {
    if (!els.categoryAdminList) { return; }
    els.categoryAdminList.querySelectorAll('.cat-admin__row').forEach(function (row) {
      row.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after');
    });
    dragOverCategoryId = null;
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

    var tagChip = target.closest('[data-tag-filter]');
    if (tagChip) {
      toggleTagFilter(tagChip.getAttribute('data-tag-filter'));
      return;
    }

    if (target.closest('#tag-filter-clear')) {
      clearTagFilter();
      return;
    }

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
    if (readOnly) { return; } // 只读：仍允许打开网站，只是不记录

    var candidate = cloneDoc(doc);
    var target = candidate ? findSiteIn(candidate.sites, id) : null;
    if (!target) { return; }

    var now = Date.now();
    target.visits = (parseInt(target.visits, 10) || 0) + 1;
    target.lastUsed = now;
    target.updatedAt = now;
    if (!commit(candidate)) { return; }

    var site = findSite(id);
    if (!site) { return; }
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
    if (readOnly) { notifyReadOnly(); return; }

    var candidate = cloneDoc(doc);
    var target = candidate ? findSiteIn(candidate.sites, id) : null;
    if (!target) { return; }

    target.favorite = !target.favorite;
    target.updatedAt = Date.now();
    if (!commit(candidate)) { return; }

    var site = findSite(id);
    if (!site) { return; }
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
    els.fCategory.innerHTML = categories().map(function (cat) {
      return '<option value="' + escapeAttr(cat.id) + '">' + escapeHtml(cat.name) + '</option>';
    }).join('');
  }

  /* --------------------------------------------------------- 设置页路由 */

  function applyRoute() {
    var inSettings = window.location.hash === '#/settings';
    if (els.settingsView) { els.settingsView.hidden = !inSettings; }
    var layout = document.querySelector('.layout');
    if (layout) { layout.hidden = inSettings; }
    var footer = document.getElementById('site-footer');
    if (footer) { footer.hidden = inSettings; }

    if (inSettings) {
      renderSettings();
      document.title = '设置 · StudyHub';
    } else {
      renderAll();
    }
  }

  function renderSettings() {
    if (!els.settingsView) { return; }
    var tab = SETTINGS_TABS[settingsTab] ? settingsTab : 'categories';
    var meta = SETTINGS_TABS[tab];
    var isCategories = tab === 'categories';
    var isTags = tab === 'tags';
    var isAppearance = tab === 'appearance';
    var isData = tab === 'data';
    var hasPanel = isCategories || isTags || isAppearance || isData;

    if (els.settingsNav) {
      els.settingsNav.querySelectorAll('[data-settings-tab]').forEach(function (btn) {
        var active = btn.getAttribute('data-settings-tab') === tab;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-current', active ? 'page' : 'false');
      });
    }

    els.settingsTitle.textContent = meta.title;
    if (hasPanel) {
      els.panelCategories.hidden = !isCategories;
      els.panelTags.hidden = !isTags;
      if (els.panelAppearance) { els.panelAppearance.hidden = !isAppearance; }
      if (els.panelData) { els.panelData.hidden = !isData; }
      els.panelComing.hidden = true;
      els.settingsDesc.hidden = false;
      els.settingsDesc.textContent = meta.desc || '';
      if (isCategories) { renderCategoryAdmin(); }
      else if (isTags) { renderTagAdmin(); }
      else if (isData) { renderDataPanel(); }
      else { updateThemeCards(currentThemePref(), resolveTheme(currentThemePref())); }
    } else {
      els.panelCategories.hidden = true;
      els.panelTags.hidden = true;
      if (els.panelAppearance) { els.panelAppearance.hidden = true; }
      if (els.panelData) { els.panelData.hidden = true; }
      els.panelComing.hidden = false;
      var coming = meta.coming || ['该模块尚未开放', '会在后续版本中开放。'];
      els.comingTitle.textContent = coming[0];
      els.comingText.textContent = coming[1];
      els.settingsDesc.hidden = true;
    }
  }

  function renderCategoryAdmin() {
    if (!els.categoryAdminList) { return; }
    var list = categories();

    els.categoryAdminList.innerHTML = list.map(function (cat, index) {
      var count = sites.filter(function (s) { return s.category === cat.id; }).length;
      var upDisabled = index === 0 ? ' disabled' : '';
      var downDisabled = index === list.length - 1 ? ' disabled' : '';
      return '<li class="cat-admin__row" draggable="true" data-cat-id="' + escapeAttr(cat.id) + '">' +
        '<span class="cat-admin__handle" aria-hidden="true" title="拖拽排序">⠿</span>' +
        '<span class="cat-admin__badge" style="--accent:' + safeColor(cat.color) + '">' +
          '<svg class="icon" aria-hidden="true"><use href="#' + safeIcon(cat.icon) + '"/></svg>' +
        '</span>' +
        '<span class="cat-admin__name"><span>' + escapeHtml(cat.name) + '</span>' +
          (cat.builtin ? '<span class="cat-admin__flag">内置</span>' : '') +
        '</span>' +
        '<span class="cat-admin__count">' + count + ' 个网站</span>' +
        '<span class="cat-admin__actions">' +
          '<button class="cat-btn" type="button" data-cat-action="up"' + upDisabled +
            ' aria-label="上移 ' + escapeAttr(cat.name) + '" title="上移">↑</button>' +
          '<button class="cat-btn" type="button" data-cat-action="down"' + downDisabled +
            ' aria-label="下移 ' + escapeAttr(cat.name) + '" title="下移">↓</button>' +
          '<button class="cat-btn" type="button" data-cat-action="edit"' +
            ' aria-label="编辑 ' + escapeAttr(cat.name) + '" title="编辑">' +
            '<svg class="icon" aria-hidden="true"><use href="#i-pencil"/></svg></button>' +
          '<button class="cat-btn cat-btn--danger" type="button" data-cat-action="delete"' +
            ' aria-label="删除 ' + escapeAttr(cat.name) + '" title="删除">' +
            '<svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg></button>' +
        '</span>' +
      '</li>';
    }).join('');
  }

  /* ------------------------------------------------------------ 标签管理 */

  function renderTagAdmin() {
    if (!els.tagAdminList) { return; }
    var stats = tagStats();
    if (els.tagAdminEmpty) { els.tagAdminEmpty.hidden = stats.length > 0; }
    if (!stats.length) {
      els.tagAdminList.innerHTML = '';
      return;
    }
    els.tagAdminList.innerHTML = stats.map(function (item) {
      return '<li class="tag-admin__row" data-tag-name="' + escapeAttr(item.name) + '">' +
        '<span class="tag-admin__name">' + escapeHtml(item.name) + '</span>' +
        '<span class="tag-admin__count">' + item.count + ' 个网站</span>' +
        '<span class="tag-admin__actions">' +
          '<button class="cat-btn" type="button" data-tag-action="rename"' +
            ' aria-label="重命名 ' + escapeAttr(item.name) + '" title="重命名">' +
            '<svg class="icon" aria-hidden="true"><use href="#i-pencil"/></svg></button>' +
          '<button class="cat-btn cat-btn--danger" type="button" data-tag-action="delete"' +
            ' aria-label="删除 ' + escapeAttr(item.name) + '" title="删除">' +
            '<svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg></button>' +
        '</span>' +
      '</li>';
    }).join('');
  }

  function tagUsage(name) {
    return sites.filter(function (site) { return site.tags.indexOf(name) >= 0; }).length;
  }

  function clearTagFormError() {
    if (els.tNameError) { els.tNameError.textContent = ''; }
    if (els.tName) { els.tName.closest('.field').classList.remove('has-error'); }
  }

  function showTagFormError(message) {
    if (els.tNameError) { els.tNameError.textContent = message; }
    if (els.tName) {
      els.tName.closest('.field').classList.add('has-error');
      els.tName.focus();
    }
  }

  function openTagForm(name) {
    if (!els.tagDialog) { return; }
    if (readOnly) { notifyReadOnly(); return; }
    editingTag = name;
    clearTagFormError();
    els.tagDialogTitle.textContent = '重命名标签';
    els.tagSubmit.textContent = '保存标签';
    els.tName.value = name;
    openDialog(els.tagDialog);
    window.setTimeout(function () { els.tName.focus(); els.tName.select(); }, 30);
  }

  function onTagSubmit(event) {
    event.preventDefault();
    if (readOnly) { notifyReadOnly(); return; }

    var next = els.tName.value.trim();
    if (!next) { showTagFormError('请填写标签名称'); return; }
    if (next.length > MAX_TAG_LEN) { showTagFormError('标签名称不超过 ' + MAX_TAG_LEN + ' 个字符'); return; }
    if (!editingTag) { return; }
    if (next === editingTag) {
      closeDialog(els.tagDialog);
      showToast('标签名称没有变化');
      return;
    }

    var candidate = cloneDoc(doc);
    if (!candidate) { showToast('数据未就绪，本次修改未保存'); return; }

    var affected = 0;
    var merged = false;
    candidate.sites.forEach(function (site) {
      var index = site.tags.indexOf(editingTag);
      if (index < 0) { return; }
      affected += 1;
      var tags = site.tags.slice();
      tags.splice(index, 1);
      if (tags.indexOf(next) < 0) {
        tags.splice(index, 0, next);
      } else {
        merged = true;
      }
      site.tags = tags;
      site.updatedAt = Date.now();
    });

    if (!affected) {
      closeDialog(els.tagDialog);
      renderTagAdmin();
      showToast('这个标签已经不存在了');
      return;
    }
    if (!commit(candidate)) { return; }

    var oldName = editingTag;
    state.tags = state.tags.map(function (tag) { return tag === oldName ? next : tag; });
    state.tags = state.tags.filter(function (tag, i) { return state.tags.indexOf(tag) === i; });

    closeDialog(els.tagDialog);
    editingTag = null;
    renderTagAdmin();
    renderAll();
    if (!els.settingsView.hidden) { renderSettings(); }
    showToast('已把「' + oldName + '」重命名为「' + next + '」，' + affected + ' 个网站已更新' +
      (merged ? '（重复标签已合并）' : ''));
  }

  function openTagDelete(name) {
    if (!els.tagDeleteDialog) { return; }
    if (readOnly) { notifyReadOnly(); return; }
    pendingTag = name;
    var count = tagUsage(name);
    els.tagDeleteText.innerHTML = '标签「<strong>' + escapeHtml(name) + '</strong>」正在被 ' +
      count + ' 个网站使用，删除后会从这些网站中移除，且无法恢复。';
    openDialog(els.tagDeleteDialog);
    window.setTimeout(function () { els.tagDeleteConfirm.focus(); }, 30);
  }

  function confirmTagDelete() {
    if (readOnly) {
      pendingTag = null;
      closeDialog(els.tagDeleteDialog);
      notifyReadOnly();
      return;
    }
    var name = pendingTag;
    if (!name) { return; }

    var candidate = cloneDoc(doc);
    if (!candidate) { showToast('数据未就绪，本次修改未保存'); return; }

    var affected = 0;
    candidate.sites.forEach(function (site) {
      var index = site.tags.indexOf(name);
      if (index < 0) { return; }
      site.tags.splice(index, 1);
      site.updatedAt = Date.now();
      affected += 1;
    });
    if (!affected) {
      pendingTag = null;
      closeDialog(els.tagDeleteDialog);
      renderTagAdmin();
      showToast('这个标签已经不存在了');
      return;
    }
    if (!commit(candidate)) { return; }

    pendingTag = null;
    state.tags = state.tags.filter(function (tag) { return tag !== name; });
    closeDialog(els.tagDeleteDialog);
    renderTagAdmin();
    renderAll();
    if (!els.settingsView.hidden) { renderSettings(); }
    showToast('已删除标签「' + name + '」，' + affected + ' 个网站已更新');
  }

  function renderCategoryIconOptions() {
    if (!els.cIcon || els.cIcon.options.length) { return; }
    els.cIcon.innerHTML = CATEGORY_ICONS.map(function (item) {
      return '<option value="' + item.symbol + '">' + item.label + '</option>';
    }).join('');
  }

  /* --------------------------------------------------------- 分类管理 */

  function openCategoryForm(mode, id) {
    if (!els.categoryDialog) { return; }
    if (readOnly) { notifyReadOnly(); return; }
    renderCategoryIconOptions();
    editingCategoryId = mode === 'edit' ? id : null;
    clearCategoryFormError();

    if (editingCategoryId) {
      var cat = findCategory(editingCategoryId);
      if (!cat) { editingCategoryId = null; return; }
      els.categoryDialogTitle.textContent = '编辑分类';
      els.categorySubmit.textContent = '保存修改';
      els.cName.value = cat.name;
      els.cIcon.value = safeIcon(cat.icon);
      els.cColor.value = safeColor(cat.color);
    } else {
      els.categoryDialogTitle.textContent = '新增分类';
      els.categorySubmit.textContent = '保存分类';
      els.cName.value = '';
      els.cIcon.value = 'i-grid';
      els.cColor.value = CATEGORY_COLORS[categories().length % CATEGORY_COLORS.length];
    }

    openDialog(els.categoryDialog);
    window.setTimeout(function () { els.cName.focus(); }, 30);
  }

  function clearCategoryFormError() {
    if (els.cNameError) { els.cNameError.textContent = ''; }
    if (els.cName) { els.cName.closest('.field').classList.remove('has-error'); }
  }

  function showCategoryFormError(message) {
    if (els.cNameError) { els.cNameError.textContent = message; }
    if (els.cName) { els.cName.closest('.field').classList.add('has-error'); }
    if (els.cName) { els.cName.focus(); }
  }

  function onCategorySubmit(event) {
    event.preventDefault();
    if (readOnly) { notifyReadOnly(); return; }

    var name = els.cName.value.trim();
    var icon = safeIcon(els.cIcon.value);
    var color = safeColor(els.cColor.value);

    if (!name) { showCategoryFormError('请填写分类名称'); return; }
    if (name.length > 20) { showCategoryFormError('分类名称不超过 20 个字符'); return; }
    var duplicated = categories().some(function (cat) {
      return cat.id !== editingCategoryId && cat.name === name;
    });
    if (duplicated) { showCategoryFormError('已经有同名分类了'); return; }

    var candidate = cloneDoc(doc);
    if (!candidate) { showToast('数据未就绪，本次修改未保存'); return; }

    if (editingCategoryId) {
      var target = null;
      candidate.categories.forEach(function (cat) { if (cat.id === editingCategoryId) { target = cat; } });
      if (!target) { showToast('要修改的分类已不存在'); return; }
      target.name = name;
      target.icon = icon;
      target.color = color;
    } else {
      var maxOrder = 0;
      candidate.categories.forEach(function (cat) {
        if (typeof cat.order === 'number' && cat.order > maxOrder) { maxOrder = cat.order; }
      });
      candidate.categories.push({
        id: newId('c-'),
        name: name,
        icon: icon,
        color: color,
        order: maxOrder + 100,
        builtin: false
      });
      candidate.categories.sort(function (a, b) { return a.order - b.order; });
      candidate.categories.forEach(function (cat, index) { cat.order = index * 100; });
    }

    if (!commit(candidate)) { return; }
    rebuildCategoryMap();
    renderCategories();
    renderCategoryOptions();
    renderCategoryAdmin();
    renderAll();
    closeDialog(els.categoryDialog);
    showToast(editingCategoryId ? '已保存分类「' + name + '」' : '已新增分类「' + name + '」');
    editingCategoryId = null;
  }

  function moveCategory(id, delta) {
    if (readOnly) { notifyReadOnly(); return; }
    var list = categories();
    var index = -1;
    list.forEach(function (cat, i) { if (cat.id === id) { index = i; } });
    var next = index + delta;
    if (index < 0 || next < 0 || next >= list.length) { return; }

    var ids = list.map(function (cat) { return cat.id; });
    var moving = ids.splice(index, 1)[0];
    ids.splice(next, 0, moving);
    saveCategoryOrder(ids);
  }

  function saveCategoryOrder(orderedIds) {
    var candidate = cloneDoc(doc);
    if (!candidate) { return; }
    var byId = {};
    candidate.categories.forEach(function (cat) { byId[cat.id] = cat; });
    var ordered = [];
    orderedIds.forEach(function (id) {
      if (byId[id]) { ordered.push(byId[id]); delete byId[id]; }
    });
    Object.keys(byId).forEach(function (id) { ordered.push(byId[id]); });
    ordered.forEach(function (cat, i) { cat.order = i * 100; });
    candidate.categories = ordered;

    if (!commit(candidate)) { return; }
    rebuildCategoryMap();
    renderCategories();
    renderCategoryOptions();
    renderCategoryAdmin();
    renderAll();
  }

  function openCategoryDelete(id) {
    if (readOnly) { notifyReadOnly(); return; }
    var cat = findCategory(id);
    if (!cat) { return; }
    if (categories().length <= 1) { showToast('至少需要保留一个分类'); return; }

    pendingCategoryId = id;
    var count = sites.filter(function (s) { return s.category === id; }).length;
    var others = categories().filter(function (item) { return item.id !== id; });

    if (els.categoryMigrateError) { els.categoryMigrateError.textContent = ''; }

    if (count > 0) {
      els.categoryMigrateField.hidden = false;
      els.categoryMigrate.innerHTML = others.map(function (item) {
        return '<option value="' + escapeAttr(item.id) + '">' + escapeHtml(item.name) + '</option>';
      }).join('');
      els.categoryDeleteText.textContent = '「' + cat.name + '」下有 ' + count +
        ' 个网站，选择一个目标分类，网站会迁移过去，然后删除该分类。';
    } else {
      els.categoryMigrateField.hidden = true;
      els.categoryDeleteText.textContent = '确定删除分类「' + cat.name + '」吗？该分类下没有网站。';
    }

    openDialog(els.categoryDeleteDialog);
  }

  function confirmCategoryDelete() {
    if (readOnly) { notifyReadOnly(); return; }
    var cat = findCategory(pendingCategoryId);
    var candidate = cloneDoc(doc);
    if (!cat || !candidate) { return; }

    var index = -1;
    candidate.categories.forEach(function (item, i) {
      if (item.id === cat.id) { index = i; }
    });
    if (index < 0) { return; }

    var moved = 0;
    var targetId = els.categoryMigrate.value;
    var targetCat = null;
    candidate.categories.forEach(function (item) {
      if (item.id === targetId) { targetCat = item; }
    });

    if (els.categoryMigrateField.hidden === false && !targetCat) {
      els.categoryMigrateError.textContent = '请选择迁移目标分类';
      return;
    }

    if (targetCat) {
      candidate.sites.forEach(function (site) {
        if (site.category === cat.id) {
          site.category = targetCat.id;
          site.updatedAt = Date.now();
          moved += 1;
        }
      });
    }

    candidate.categories.splice(index, 1);
    candidate.categories.forEach(function (item, i) { item.order = i * 100; });

    if (state.view === cat.id) { state.view = 'all'; }
    if (!commit(candidate)) { return; }

    pendingCategoryId = null;
    rebuildCategoryMap();
    renderCategories();
    renderCategoryOptions();
    renderCategoryAdmin();
    renderAll();
    closeDialog(els.categoryDeleteDialog);
    showToast(moved
      ? '已删除分类，' + moved + ' 个网站迁移到「' + targetCat.name + '」'
      : '已删除分类「' + cat.name + '」');
  }

  function newId(prefix) {
    return (prefix || 's-') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function openSiteForm(mode, id) {
    if (!els.siteDialog) { return; }
    if (readOnly) { notifyReadOnly(); return; }
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
      initIconDraft(site);
    } else {
      els.dialogTitle.textContent = '添加网站';
      els.submitBtn.textContent = '保存网站';
      els.siteForm.reset();
      var fallback = categoryMap[state.view] ? state.view : (categories()[0] ? categories()[0].id : '');
      els.fCategory.value = fallback;
      els.fTags.value = '';
      initIconDraft(null);
    }

    openDialog(els.siteDialog);
    window.setTimeout(function () { els.fName.focus(); }, 30);
  }

  /* ---------- 数据管理 ---------- */

  var BACKUP_FORMAT = 'studyhub-backup';
  var BACKUP_MAX_BYTES = 40 * 1024 * 1024;
  var pendingBackup = null;
  var restoreBusy = false;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function backupFileName(isPreRestore) {
    var d = new Date();
    return 'StudyHub' + (isPreRestore ? '-before-restore' : '') + '-' +
      d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' +
      pad2(d.getHours()) + pad2(d.getMinutes()) + '.json';
  }

  function backupTimeLabel(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return '未知时间'; }
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function iconsAvailable() {
    return !!(window.SH && window.SH.icons && window.SH.icons.supported && window.SH.icons.supported());
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('图片读取失败')); };
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl) {
    var match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
    if (!match) { return null; }
    var binary;
    try { binary = window.atob(match[2].replace(/\s/g, '')); } catch (err) { return null; }
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) { bytes[i] = binary.charCodeAt(i); }
    return { mime: match[1], blob: new Blob([bytes], { type: match[1] }) };
  }

  function newImageId() {
    return 'ico-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function downloadBackup(payload, isPreRestore) {
    var name = backupFileName(!!isPreRestore);
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    return name;
  }

  /**
   * 收集完整备份。任何一处不完整都会 reject，避免生成「看起来正常」的残缺备份。
   */
  function collectBackupPayload() {
    return new Promise(function (resolve, reject) {
      if (!doc || !api) { reject(new Error('当前没有可导出的数据')); return; }
      var check = api.validateDoc(doc);
      if (!check.ok) {
        reject(new Error('当前数据未通过校验，请刷新页面后重试'));
        return;
      }

      var payload = {
        format: BACKUP_FORMAT,
        schemaVersion: api.SCHEMA_VERSION,
        appVersion: api.APP_VERSION,
        exportedAt: new Date().toISOString(),
        data: cloneDoc(doc),
        icons: []
      };

      var uploadSites = sites.filter(function (site) {
        return site.icon && site.icon.source === 'upload';
      });

      if (!iconsAvailable()) {
        if (uploadSites.length) {
          reject(new Error('有网站使用本地上传的图标，但当前浏览器无法访问图片库，无法生成完整备份'));
        } else {
          resolve(payload);
        }
        return;
      }

      window.SH.icons.list().then(function (records) {
        return Promise.all(records.map(function (record) {
          return window.SH.icons.get(record.id).then(function (full) {
            return blobToDataUrl(full.blob).then(function (dataUrl) {
              payload.icons.push({
                id: record.id,
                mime: record.mime,
                width: record.width,
                height: record.height,
                size: record.size,
                createdAt: record.createdAt,
                dataUrl: dataUrl
              });
            });
          });
        }));
      }).then(function () {
        var ids = {};
        payload.icons.forEach(function (icon) { ids[icon.id] = true; });
        for (var i = 0; i < uploadSites.length; i += 1) {
          var site = uploadSites[i];
          if (!ids[site.icon.imageId]) {
            throw new Error('网站「' + site.name + '」的图标图片已丢失，请在编辑中重新上传后再导出');
          }
        }
        resolve(payload);
      }).catch(function (err) {
        reject(new Error((err && err.message) || '读取图片数据失败'));
      });
    });
  }

  function describeIssue(issue) {
    if (!issue) { return '未知错误'; }
    return (issue.field ? issue.field + ' ' : '') + (issue.message || issue.code || '无效数据');
  }

  function validateBackupObject(raw) {
    var errors = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, errors: ['备份文件不是有效的 JSON 对象'] };
    }
    if (raw.format !== BACKUP_FORMAT) {
      errors.push('文件格式不正确：缺少 StudyHub 备份标记');
    }
    if (raw.schemaVersion !== api.SCHEMA_VERSION) {
      errors.push('备份数据版本为 v' + raw.schemaVersion + '，当前仅支持 v' + api.SCHEMA_VERSION + '，请使用对应版本导出或恢复');
    }
    var exportedAt = '';
    if (typeof raw.exportedAt !== 'string' || isNaN(Date.parse(raw.exportedAt))) {
      errors.push('缺少有效的导出时间');
    } else {
      exportedAt = raw.exportedAt;
    }

    var data = raw.data;
    var dataOk = false;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      errors.push('缺少网站数据');
    } else {
      var check = api.validateDoc(data);
      if (!check.ok) {
        var detail = (check.errors || []).slice(0, 2).map(describeIssue).join('；');
        errors.push('网站数据校验未通过：' + detail);
      } else {
        dataOk = true;
      }
    }

    var icons = raw.icons;
    var normalizedIcons = [];
    var iconIds = {};
    if (!Array.isArray(icons)) {
      errors.push('缺少图片数据列表');
    } else {
      icons.forEach(function (icon, index) {
        var label = '第 ' + (index + 1) + ' 张图片';
        if (!icon || typeof icon !== 'object') {
          errors.push(label + '格式不正确');
          return;
        }
        if (typeof icon.id !== 'string' || !icon.id.trim()) {
          errors.push(label + '缺少标识');
          return;
        }
        if (iconIds[icon.id]) {
          errors.push('图片标识重复：' + icon.id);
          return;
        }
        iconIds[icon.id] = true;
        var decoded = dataUrlToBlob(icon.dataUrl);
        if (!decoded) {
          errors.push(label + '的 Base64 数据不合法');
          return;
        }
        if (icon.mime && icon.mime !== decoded.mime) {
          errors.push(label + '的图片类型与数据不一致');
          return;
        }
        if (decoded.blob.size > MAX_ICON_BYTES) {
          errors.push(label + '超过 2MB，无法恢复');
          return;
        }
        normalizedIcons.push({
          id: icon.id,
          mime: decoded.mime,
          width: Math.max(0, parseInt(icon.width, 10) || 0),
          height: Math.max(0, parseInt(icon.height, 10) || 0),
          createdAt: parseInt(icon.createdAt, 10) || Date.now(),
          dataUrl: icon.dataUrl
        });
      });
    }

    if (dataOk) {
      var missing = null;
      data.sites.forEach(function (site) {
        if (missing || !site || !site.icon || site.icon.source !== 'upload') { return; }
        if (!site.icon.imageId || !iconIds[site.icon.imageId]) {
          missing = site.name || site.id;
        }
      });
      if (missing) {
        errors.push('网站「' + missing + '」引用的图片不在备份中');
      }
    }

    if (errors.length) {
      return { ok: false, errors: errors };
    }

    var categoriesCount = Array.isArray(data.categories) ? data.categories.length : 0;
    return {
      ok: true,
      doc: data,
      icons: normalizedIcons,
      stats: {
        exportedAt: exportedAt,
        appVersion: raw.appVersion || '',
        sites: data.sites.length,
        categories: categoriesCount,
        icons: normalizedIcons.length
      }
    };
  }

  function showDataError(message) {
    if (!els.dataError) { return; }
    els.dataError.textContent = message;
    els.dataError.hidden = false;
  }

  function clearDataError() {
    if (!els.dataError) { return; }
    els.dataError.hidden = true;
    els.dataError.textContent = '';
  }

  function updateDataFile() {
    if (!els.dataFile) { return; }
    var has = !!pendingBackup;
    els.dataFile.hidden = !has;
    if (els.restoreBackupBtn) { els.restoreBackupBtn.disabled = !has || readOnly; }
    if (els.clearBackupBtn) { els.clearBackupBtn.disabled = !has; }
    if (!has) { return; }
    els.dataFileName.textContent = pendingBackup.fileName || '备份文件';
    els.dataFileMeta.textContent = backupTimeLabel(pendingBackup.stats.exportedAt) + ' 导出 · ' +
      pendingBackup.stats.sites + ' 个网站 · ' + pendingBackup.stats.categories + ' 个分类 · ' +
      pendingBackup.stats.icons + ' 张图片';
  }

  function renderDataPanel() {
    if (!els.panelData) { return; }
    if (els.dataSiteCount) { els.dataSiteCount.textContent = sites.length; }
    if (els.dataCategoryCount) { els.dataCategoryCount.textContent = categories().length; }
    if (els.dataIconCount) {
      els.dataIconCount.textContent = '—';
      if (iconsAvailable()) {
        window.SH.icons.count().then(function (count) {
          if (els.dataIconCount) { els.dataIconCount.textContent = String(count); }
        }).catch(function () {
          if (els.dataIconCount) { els.dataIconCount.textContent = '—'; }
        });
      }
    }
    if (els.dataReadonly) {
      els.dataReadonly.hidden = !readOnly;
    }
    if (els.chooseBackupBtn) {
      els.chooseBackupBtn.disabled = readOnly;
    }
    updateDataFile();
    if (readOnly) { clearDataError(); }
    if (els.exportBackupBtn) {
      els.exportBackupBtn.disabled = !doc;
    }
  }

  function onExportBackup() {
    clearDataError();
    collectBackupPayload().then(function (payload) {
      var name = downloadBackup(payload, false);
      showToast('备份已导出：' + name);
    }).catch(function (err) {
      showDataError((err && err.message) || '导出失败');
      showToast('导出失败，请查看页面提示');
    });
  }

  function handleBackupFile(file) {
    if (!file) { return; }
    clearDataError();
    pendingBackup = null;
    updateDataFile();
    if (file.size > BACKUP_MAX_BYTES) {
      showDataError('备份文件超过 40MB，无法导入');
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () {
      showDataError('文件读取失败，请重试');
    };
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (err) {
        showDataError('文件不是有效的 JSON');
        return;
      }
      var result = validateBackupObject(parsed);
      if (!result.ok) {
        var message = result.errors.slice(0, 3).join('；');
        showDataError('备份校验未通过：' + message);
        return;
      }
      result.fileName = file.name;
      pendingBackup = result;
      updateDataFile();
      showToast('备份校验通过，可以恢复');
    };
    reader.readAsText(file);
  }

  function openRestoreDialog() {
    if (readOnly) { notifyReadOnly(); return; }
    if (!pendingBackup) { return; }
    var stats = pendingBackup.stats;
    if (els.restoreText) {
      els.restoreText.textContent = '即将用「' + (pendingBackup.fileName || '备份文件') + '」替换当前数据，这一步会覆盖现有内容。';
    }
    if (els.restoreSummary) {
      els.restoreSummary.innerHTML = [
        ['导出时间', backupTimeLabel(stats.exportedAt)],
        ['网站', stats.sites + ' 个'],
        ['分类', stats.categories + ' 个'],
        ['图片', stats.icons + ' 张']
      ].map(function (row) {
        return '<div class="restore-summary__row"><span>' + escapeHtml(row[0]) +
          '</span><strong>' + escapeHtml(row[1]) + '</strong></div>';
      }).join('');
    }
    openDialog(els.restoreDialog);
  }

  function saveFailureMessage(result) {
    var code = result ? result.code : '';
    if (code === 'QUOTA') { return '本地存储空间不足，写入被拒绝'; }
    if (code === 'READONLY') { return '当前处于只读模式，已拒绝写入'; }
    if (code === 'SCHEMA') { return '备份数据未通过校验'; }
    return '写入本地数据失败';
  }

  /**
   * 恢复顺序：
   *   1. 先导出当前数据（调用方完成）
   *   2. 把备份图片以全新 id 写入 IndexedDB（不覆盖现有图片，失败可安全清理）
   *   3. 用映射后的文档覆盖主数据（store.save 负责校验与写入）
   *   4. 主数据成功后再清理旧图片；清理失败只告警，不当作恢复失败
   * 任何一步失败都会清理本次写入的新图片，现有数据保持原样。
   */
  function runRestoreWrites(backup) {
    var oldIds = [];
    var newIds = [];
    var mapping = {};

    if (backup.icons.length && !iconsAvailable()) {
      return Promise.reject(new Error('当前浏览器无法访问图片库，不能恢复包含图片的备份'));
    }

    var start = iconsAvailable() ? window.SH.icons.list() : Promise.resolve([]);
    return start.then(function (records) {
      oldIds = (records || []).map(function (record) { return record.id; });
      var chain = Promise.resolve();
      backup.icons.forEach(function (icon) {
        chain = chain.then(function () {
          var decoded = dataUrlToBlob(icon.dataUrl);
          if (!decoded) { throw new Error('备份中的图片数据无法解析'); }
          var nextId = newImageId();
          mapping[icon.id] = nextId;
          return window.SH.icons.put(nextId, decoded.blob, {
            mime: decoded.mime,
            width: icon.width,
            height: icon.height
          }).then(function () { newIds.push(nextId); });
        });
      });
      return chain;
    }).then(function () {
      var candidate = cloneDoc(backup.doc);
      candidate.updatedAt = Date.now();
      candidate.sites.forEach(function (site) {
        if (!site.icon || site.icon.source !== 'upload') { return; }
        var mapped = mapping[site.icon.imageId];
        if (!mapped) { throw new Error('备份中的图片引用不一致'); }
        site.icon.imageId = mapped;
      });

      var saved = api.save(candidate);
      if (!saved || !saved.ok) {
        var error = new Error(saveFailureMessage(saved));
        error.fromSave = true;
        throw error;
      }
      doc = saved.doc;
      sites = doc.sites;
      return { warning: false, oldIds: oldIds };
    }).then(function (result) {
      if (!iconsAvailable() || !result.oldIds.length) { return result; }
      return window.SH.icons.removeMany(result.oldIds).then(function () {
        return result;
      }, function () {
        result.warning = true;
        return result;
      });
    }).catch(function (err) {
      if (!newIds.length || !iconsAvailable()) { throw err; }
      return window.SH.icons.removeMany(newIds).then(function () {
        throw err;
      }, function () {
        throw new Error((err.message || '恢复失败') + '；临时图片清理也失败，请立即导入刚才自动下载的备份');
      });
    });
  }

  function resetRestoreButton() {
    if (!els.restoreConfirm) { return; }
    els.restoreConfirm.disabled = false;
    els.restoreConfirm.textContent = '确认恢复';
  }

  function confirmRestore() {
    if (restoreBusy) { return; }
    if (readOnly) { notifyReadOnly(); return; }
    if (!pendingBackup || !pendingBackup.ok) { return; }

    restoreBusy = true;
    if (els.restoreConfirm) {
      els.restoreConfirm.disabled = true;
      els.restoreConfirm.textContent = '正在恢复…';
    }

    var preName = '';
    collectBackupPayload().then(function (current) {
      preName = downloadBackup(current, true);
      return runRestoreWrites(pendingBackup);
    }).then(function (result) {
      restoreBusy = false;
      resetRestoreButton();
      pendingBackup = null;
      closeDialog(els.restoreDialog);
      if (result.warning) {
        showToast('恢复完成，但有旧图片未能清理，请稍后重新导入备份核对');
      } else {
        showToast('恢复完成，正在刷新页面…');
      }
      window.setTimeout(function () { window.location.reload(); }, result.warning ? 1600 : 700);
    }).catch(function (err) {
      restoreBusy = false;
      resetRestoreButton();
      closeDialog(els.restoreDialog);
      var message = (err && err.message) || '未知错误';
      showDataError('恢复失败：' + message + (preName ? '（恢复前备份已下载，可用于回滚）' : ''));
      showToast('恢复失败：' + message);
      updateDataFile();
    });
  }

  /* ---------- 图标选择 ---------- */

  function categoryIconSymbol(categoryId) {
    var cat = categoryMap[categoryId] || categories()[0];
    return cat ? safeIcon(cat.icon) : 'i-grid';
  }

  function initIconDraft(site) {
    revokeDraftPreview();
    var icon = site && site.icon && typeof site.icon === 'object' ? site.icon : null;
    var source = icon && icon.source ? icon.source : 'auto';
    iconDraft = {
      source: source === 'url' || source === 'upload' || source === 'builtin' ? source : 'auto',
      url: icon && icon.url ? icon.url : '',
      imageId: icon && icon.imageId ? icon.imageId : '',
      removeImageId: '',
      file: null,
      fileInfo: null,
      previewUrl: '',
      token: 0
    };
    if (els.fIconUrl) { els.fIconUrl.value = iconDraft.url; }
    if (els.fIconFile) { els.fIconFile.value = ''; }
    if (els.iconFileName) {
      els.iconFileName.textContent = iconDraft.imageId && iconDraft.source === 'upload'
        ? '已上传图片，可重新选择'
        : 'PNG / JPG / WebP，不超过 2MB';
    }
    renderIconPicker();
  }

  function renderIconPicker() {
    if (!iconDraft || !els.iconSources) { return; }
    var buttons = els.iconSources.querySelectorAll('[data-icon-source]');
    Array.prototype.forEach.call(buttons, function (btn) {
      var active = btn.getAttribute('data-icon-source') === iconDraft.source;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (els.iconPanelUrl) { els.iconPanelUrl.hidden = iconDraft.source !== 'url'; }
    if (els.iconPanelUpload) { els.iconPanelUpload.hidden = iconDraft.source !== 'upload'; }
    if (els.iconReset) { els.iconReset.disabled = iconDraft.source === 'builtin'; }
    if (els.iconHint) {
      var hints = {
        auto: '会尝试读取网站根目录的 /favicon.ico，读取失败时使用默认图标。',
        url: '填写一张图片的公开地址，加载失败会自动回退到 favicon 或默认图标。',
        upload: '图片会压缩到 128×128 以内并保存在本机浏览器，不计入主数据。',
        builtin: '使用内置图标，不发起任何图片请求。'
      };
      els.iconHint.textContent = hints[iconDraft.source] || '';
    }
    refreshIconPreview();
  }

  function setIconSource(source) {
    if (!iconDraft || iconDraft.source === source) { return; }
    var previous = iconDraft.source;
    iconDraft.source = source;
    if (previous === 'upload' && source !== 'upload') {
      if (iconDraft.imageId) { iconDraft.removeImageId = iconDraft.imageId; }
      iconDraft.imageId = '';
      iconDraft.file = null;
      revokeDraftPreview();
      if (els.fIconFile) { els.fIconFile.value = ''; }
      if (els.iconFileName) { els.iconFileName.textContent = 'PNG / JPG / WebP，不超过 2MB'; }
    }
    if (els.iconError) { els.iconError.textContent = ''; }
    renderIconPicker();
  }

  function previewSymbol() {
    return categoryIconSymbol(els.fCategory ? els.fCategory.value : '');
  }

  function refreshIconPreview() {
    if (!iconDraft || !els.iconPreview) { return; }
    var preview = els.iconPreview;
    var symbol = previewSymbol();
    var token = ++iconDraft.token;

    preview.classList.toggle('is-default', iconDraft.source === 'builtin');
    preview.innerHTML = '<svg class="icon"><use href="#' + symbol + '"/></svg>';

    function showImg(url) {
      if (token !== iconDraft.token) { return; }
      var img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.onload = function () {
        if (token !== iconDraft.token) { return; }
        preview.innerHTML = '';
        preview.appendChild(img);
        preview.classList.remove('is-default');
      };
      img.onerror = function () { img = null; };
      img.src = url;
    }

    if (iconDraft.source === 'upload' && window.SH && window.SH.icons) {
      if (iconDraft.file && iconDraft.previewUrl) {
        showImg(iconDraft.previewUrl);
      } else if (iconDraft.imageId) {
        window.SH.icons.objectUrl(iconDraft.imageId).then(showImg).catch(function () {});
      }
      return;
    }
    if (iconDraft.source === 'url' && iconDraft.url) {
      loadImageUrl(iconDraft.url, 6000).then(showImg).catch(function () {});
      return;
    }
    if (iconDraft.source === 'auto' && els.fUrl) {
      var fav = faviconUrl(els.fUrl.value.trim());
      if (fav) { loadImageUrl(fav, FAVICON_TIMEOUT).then(showImg).catch(function () {}); }
    }
  }

  function revokeDraftPreview() {
    if (iconDraft && iconDraft.previewUrl) {
      try { window.URL.revokeObjectURL(iconDraft.previewUrl); } catch (err) {}
      iconDraft.previewUrl = '';
    }
  }

  function showIconError(message) {
    if (!els.iconError) { return; }
    els.iconError.textContent = message || '';
    var field = els.iconError.closest('.field');
    if (field) { field.classList.toggle('has-error', !!message); }
  }

  function loadImageElement(file) {
    return new Promise(function (resolve, reject) {
      var url = window.URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        window.URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        window.URL.revokeObjectURL(url);
        reject(new Error('图片无法读取'));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise(function (resolve) {
      if (typeof canvas.toBlob !== 'function') { resolve(null); return; }
      canvas.toBlob(function (blob) { resolve(blob || null); }, mime, quality);
    });
  }

  /** 缩放到不超过 128×128，优先 WebP，失败回退 PNG */
  function compressIconFile(file) {
    return loadImageElement(file).then(function (img) {
      var width = img.naturalWidth || img.width;
      var height = img.naturalHeight || img.height;
      if (!width || !height) { throw new Error('图片尺寸无效'); }
      var scale = Math.min(1, ICON_MAX_SIZE / Math.max(width, height));
      var targetW = Math.max(1, Math.round(width * scale));
      var targetH = Math.max(1, Math.round(height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      var ctx = canvas.getContext('2d');
      if (!ctx) { throw new Error('无法处理图片'); }
      ctx.drawImage(img, 0, 0, targetW, targetH);
      return canvasToBlob(canvas, 'image/webp', 0.9).then(function (blob) {
        if (blob && blob.size) {
          return { blob: blob, width: targetW, height: targetH };
        }
        return canvasToBlob(canvas, 'image/png', 0.92);
      }).then(function (result) {
        if (!result || !result.blob) { throw new Error('图片压缩失败'); }
        return { blob: result.blob, width: targetW, height: targetH };
      });
    });
  }

  function handleIconFile(file) {
    if (!file || !iconDraft) { return; }
    showIconError('');
    if (ICON_MIME.indexOf(file.type) === -1) {
      showIconError('请选择 PNG、JPG、WebP 或 GIF 图片');
      if (els.fIconFile) { els.fIconFile.value = ''; }
      return;
    }
    if (file.size > MAX_ICON_BYTES) {
      showIconError('图片不能超过 2MB');
      if (els.fIconFile) { els.fIconFile.value = ''; }
      return;
    }
    if (!window.SH || !window.SH.icons || !window.SH.icons.supported()) {
      showIconError('当前浏览器不支持本地图片存储，请改用图片链接');
      return;
    }
    revokeDraftPreview();
    iconDraft.file = file;
    iconDraft.previewUrl = window.URL.createObjectURL(file);
    if (els.iconFileName) { els.iconFileName.textContent = file.name + '（保存时自动压缩）'; }
    if (els.iconError) { els.iconError.textContent = ''; }
    refreshIconPreview();
  }

  function newImageId() {
    return 'img-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function onFormSubmit(event) {
    event.preventDefault();
    if (readOnly) { notifyReadOnly(); return; }

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

    var plan = validateIconDraft();
    if (!plan) { return; }

    var cat = categoryMap[data.category];
    var isEdit = !!editingId;
    var candidate = cloneDoc(doc);
    if (!candidate) { showToast('数据未就绪，本次修改未保存'); return; }

    var target = isEdit ? findSiteIn(candidate.sites, editingId) : null;
    if (isEdit && !target) {
      showToast('要修改的网站已不存在');
      closeDialog(els.siteDialog);
      editingId = null;
      renderAll();
      return;
    }

    var previousImageId = isEdit && target.icon && target.icon.source === 'upload' ? target.icon.imageId : '';
    if (els.submitBtn) { els.submitBtn.disabled = true; }

    persistIconForSubmit(plan).then(function (saved) {
      var icon = saved.icon;
      var now = Date.now();

      if (isEdit) {
        if (target.category !== data.category) {
          target.category = data.category;
          target.color = safeColor(cat.color);
        }
        target.name = data.name;
        target.desc = data.desc;
        target.url = result.url;
        target.tags = result.tags;
        target.icon = icon;
        target.updatedAt = now;
      } else {
        var maxOrder = 0;
        candidate.sites.forEach(function (item) {
          if (typeof item.order === 'number' && item.order > maxOrder) { maxOrder = item.order; }
        });
        candidate.sites.push({
          id: uid(),
          name: data.name,
          desc: data.desc,
          url: result.url,
          category: data.category,
          tags: result.tags,
          icon: icon,
          color: safeColor(cat.color),
          order: maxOrder + 100,
          visits: 0,
          lastUsed: null,
          favorite: false,
          createdAt: now,
          updatedAt: now
        });
      }

      if (!commit(candidate)) {
        if (saved.newImageId) { cleanupImage(saved.newImageId); }
        return;
      }

      var obsolete = [];
      if (saved.newImageId && previousImageId && previousImageId !== saved.newImageId) {
        obsolete.push(previousImageId);
      }
      if (iconDraft && iconDraft.removeImageId && iconDraft.removeImageId !== saved.newImageId) {
        obsolete.push(iconDraft.removeImageId);
      }
      if (obsolete.length) { cleanupImages(obsolete); }

      closeDialog(els.siteDialog);
      editingId = null;
      revokeDraftPreview();
      renderAll();
      showToast(isEdit ? '已保存「' + data.name + '」的修改' : '已添加「' + data.name + '」');
    }).catch(function (err) {
      var code = err && err.code;
      var message = '图片保存失败，本次修改未生效';
      if (code === 'QUOTA') { message = '本地图片存储空间不足，请删除旧图片或改用图片链接'; }
      else if (code === 'UNAVAILABLE' || code === 'BLOCKED') { message = '本地图片存储不可用，请改用图片链接'; }
      else if (err && err.message && err.message.indexOf('图片') === 0) { message = err.message; }
      showIconError(message);
    }).finally(function () {
      if (els.submitBtn) { els.submitBtn.disabled = false; }
    });
  }

  function validateIconDraft() {
    if (!iconDraft) { return { source: 'builtin' }; }
    if (iconDraft.source === 'url') {
      var parsed = normalizeUrl(els.fIconUrl ? els.fIconUrl.value.trim() : '');
      if (parsed.error) {
        var message = parsed.error;
        if (message === '请填写网站网址') { message = '请填写图片链接'; }
        else { message = '图片链接' + message.replace(/^网址/, ''); }
        showIconError(message);
        return null;
      }
      showIconError('');
      return { source: 'url', url: parsed.url };
    }
    if (iconDraft.source === 'upload') {
      if (!iconDraft.file && !iconDraft.imageId) {
        showIconError('请选择一张本地图片');
        return null;
      }
      if (iconDraft.file && (!window.SH || !window.SH.icons || !window.SH.icons.supported())) {
        showIconError('当前浏览器不支持本地图片存储，请改用图片链接');
        return null;
      }
      showIconError('');
      return { source: 'upload' };
    }
    showIconError('');
    return { source: iconDraft.source === 'auto' ? 'auto' : 'builtin' };
  }

  function persistIconForSubmit(plan) {
    var symbol = categoryIconSymbol(els.fCategory.value);
    if (plan.source === 'upload') {
      if (iconDraft && iconDraft.file) {
        return compressIconFile(iconDraft.file).then(function (info) {
          var id = newImageId();
          return window.SH.icons.put(id, info.blob, {
            mime: info.blob.type,
            width: info.width,
            height: info.height
          }).then(function () {
            return {
              icon: { source: 'upload', symbol: symbol, url: '', imageId: id },
              newImageId: id
            };
          });
        });
      }
      return Promise.resolve({
        icon: { source: 'upload', symbol: symbol, url: '', imageId: iconDraft ? iconDraft.imageId : '' },
        newImageId: ''
      });
    }
    return Promise.resolve({
      icon: { source: plan.source, symbol: symbol, url: plan.url || '', imageId: '' },
      newImageId: ''
    });
  }

  function cleanupImage(imageId) {
    if (!imageId || !window.SH || !window.SH.icons) { return; }
    window.SH.icons.remove(imageId).catch(function () {
      showToast('图片清理失败，可稍后在设置中重试');
    });
  }

  function cleanupImages(ids) {
    if (!ids || !ids.length) { return; }
    var keys = Object.keys(iconCache);
    ids.forEach(function (id) {
      if (!id) { return; }
      cleanupImage(id);
      keys.forEach(function (key) {
        if (key.indexOf(id) > -1) { delete iconCache[key]; }
      });
    });
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
    // 分隔符：逗号、中文逗号、分号、中文分号；空格保留在标签内部
    var seen = {};
    return String(text || '').split(/[,，;；]+/).map(function (tag) {
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
    if (readOnly) { notifyReadOnly(); return; }
    pendingDeleteId = site.id;
    els.confirmText.innerHTML = '删除「<strong>' + escapeHtml(site.name) + '</strong>」后，' +
      '它的使用次数、收藏和最近访问记录会一并清除，且无法恢复。';
    openDialog(els.confirmDialog);
    window.setTimeout(function () { els.confirmBtn.focus(); }, 30);
  }

  function confirmDelete() {
    if (readOnly) {
      pendingDeleteId = null;
      closeDialog(els.confirmDialog);
      notifyReadOnly();
      return;
    }

    var victim = findSite(pendingDeleteId);
    if (!victim) {
      pendingDeleteId = null;
      closeDialog(els.confirmDialog);
      return;
    }

    var candidate = cloneDoc(doc);
    var index = candidate ? candidate.sites.indexOf(findSiteIn(candidate.sites, victim.id)) : -1;
    if (index < 0) {
      pendingDeleteId = null;
      closeDialog(els.confirmDialog);
      return;
    }

    candidate.sites.splice(index, 1);
    if (!commit(candidate)) { return; }

    if (victim.icon && victim.icon.source === 'upload' && victim.icon.imageId) {
      cleanupImage(victim.icon.imageId);
      var staleKeys = Object.keys(iconCache);
      staleKeys.forEach(function (key) {
        if (key.indexOf(victim.icon.imageId) > -1) { delete iconCache[key]; }
      });
    }

    pendingDeleteId = null;
    closeDialog(els.confirmDialog);
    renderAll();
    showToast('已删除「' + victim.name + '」');
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

  /** V3 的 icon 是对象；同时兼容旧的 symbol 字符串 */
  function iconSymbol(site) {
    var icon = site ? site.icon : null;
    if (icon && typeof icon === 'object') { return safeIcon(icon.symbol); }
    return safeIcon(icon);
  }

  function iconSource(site) {
    var icon = site && site.icon;
    if (icon && typeof icon === 'object' && icon.source) { return icon.source; }
    return 'builtin';
  }

  /** 生成图标容器；真实图片由 hydrateIcons() 异步补上 */
  function iconBoxHTML(site, cls) {
    var icon = site && site.icon && typeof site.icon === 'object' ? site.icon : {};
    var symbol = iconSymbol(site);
    var attrs = ' data-icon-source="' + escapeAttr(iconSource(site)) + '"' +
      ' data-symbol="' + escapeAttr(symbol) + '"' +
      ' data-site-url="' + escapeAttr(site.url || '') + '"';
    if (icon.url) { attrs += ' data-icon-url="' + escapeAttr(icon.url) + '"'; }
    if (icon.imageId) { attrs += ' data-image-id="' + escapeAttr(icon.imageId) + '"'; }
    return '<span class="' + cls + '" aria-hidden="true"' + attrs + '>' +
      '<svg class="icon"><use href="#' + symbol + '"/></svg></span>';
  }

  function faviconUrl(siteUrl) {
    try {
      var url = new URL(String(siteUrl || ''));
      if (url.protocol !== 'http:' && url.protocol !== 'https:') { return ''; }
      return url.origin + '/favicon.ico';
    } catch (err) {
      return '';
    }
  }

  function loadImageUrl(url, timeout) {
    return new Promise(function (resolve, reject) {
      if (!url) { reject(new Error('没有图片地址')); return; }
      var img = new Image();
      var settled = false;
      var timer = window.setTimeout(function () {
        if (settled) { return; }
        settled = true;
        img.onload = img.onerror = null;
        img.src = '';
        reject(new Error('图片加载超时'));
      }, timeout || FAVICON_TIMEOUT);
      img.onload = function () {
        if (settled) { return; }
        settled = true;
        window.clearTimeout(timer);
        resolve(url);
      };
      img.onerror = function () {
        if (settled) { return; }
        settled = true;
        window.clearTimeout(timer);
        reject(new Error('图片加载失败'));
      };
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.src = url;
    });
  }

  function iconCacheKey(node) {
    return [
      node.getAttribute('data-icon-source') || '',
      node.getAttribute('data-symbol') || '',
      node.getAttribute('data-icon-url') || '',
      node.getAttribute('data-image-id') || '',
      node.getAttribute('data-site-url') || ''
    ].join('|');
  }

  /** 按「上传图片 → 图片链接 → favicon → 内置图标」顺序尝试 */
  function resolveIconUrl(node) {
    var source = node.getAttribute('data-icon-source');
    var imageId = node.getAttribute('data-image-id');
    var url = node.getAttribute('data-icon-url');
    var fav = faviconUrl(node.getAttribute('data-site-url'));
    var attempts = [];

    if (source === 'upload' && imageId && window.SH && window.SH.icons) {
      attempts.push(function () {
        return window.SH.icons.objectUrl(imageId).then(function (blobUrl) {
          return loadImageUrl(blobUrl, 5000);
        });
      });
    }
    if (source === 'url' && url) {
      attempts.push(function () { return loadImageUrl(url, 6000); });
    }
    if (fav) {
      attempts.push(function () { return loadImageUrl(fav, FAVICON_TIMEOUT); });
    }

    function next(index) {
      if (index >= attempts.length) { return Promise.reject(new Error('没有可用的图标')); }
      return attempts[index]().catch(function () { return next(index + 1); });
    }
    return next(0);
  }

  function setIconImage(node, url) {
    var img = node.querySelector('.site-icon__img');
    if (!img) {
      img = document.createElement('img');
      img.className = 'site-icon__img';
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      img.addEventListener('error', function () {
        node.classList.remove('has-image');
        if (img.parentNode) { img.parentNode.removeChild(img); }
      });
      node.appendChild(img);
    }
    img.onload = function () { node.classList.add('has-image'); };
    img.src = url;
  }

  /** 每轮渲染后补齐真实图标；失败保持内置 symbol */
  function hydrateIcons() {
    var nodes = document.querySelectorAll('[data-icon-source]');
    Array.prototype.forEach.call(nodes, function (node) {
      var source = node.getAttribute('data-icon-source');
      if (source === 'builtin') { return; }
      var key = iconCacheKey(node);
      var cached = iconCache[key];
      if (cached === 'fail') { return; }
      if (cached) { setIconImage(node, cached); return; }
      if (node.__iconBusy) { return; }
      node.__iconBusy = true;
      resolveIconUrl(node).then(function (url) {
        iconCache[key] = url;
        if (node.isConnected) { setIconImage(node, url); }
      }).catch(function () {
        iconCache[key] = 'fail';
      });
    });
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
