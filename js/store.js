/**
 * StudyHub V0.2 —— 数据层（阶段一 1.1）
 * ------------------------------------------------------------------
 * 职责：
 *   · V0.2 数据文档（schemaVersion 3）的结构定义、常量与默认值
 *   · 归一化 normalize*：把任意输入修整成合法结构
 *   · 校验 validateDoc：结构 + 引用 + 语义检查，返回 errors / warnings
 *   · 种子 createDoc：由 data.js 的种子生成首份文档
 *   · localStorage 读写原语：readDoc / writeDoc / writeVerified
 *
 * 边界（本步骤刻意不做）：
 *   · 不接触 DOM，不引用 document，可在 Node 中直接加载做单元测试
 *   · 不执行真实迁移（buildV3 / 状态机在 1.2、1.3 实现）
 *   · 不接入页面（app.js 仍走自己的旧逻辑，1.5 才切换）
 *
 * 加载方式：普通 <script>，挂载到 window.SH.store。
 * ------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  var SH = root.SH || (root.SH = {});

  /* ================================================================ 常量 */

  var SCHEMA_VERSION = 3;
  var APP_VERSION = '0.2.0';

  /** localStorage 键位。旧键与备份键永不自动删除 */
  var KEYS = {
    data: 'studyhub:data',
    meta: 'studyhub:meta',
    legacy: 'studyhub:v1',
    backupPrefix: 'studyhub:backup:v2-'
  };

  var LIMITS = {
    name: 30,
    desc: 60,
    tags: 5,
    tagLen: 12,
    categoryName: 20
  };

  var THEMES = ['light', 'dark', 'system'];
  var SORTS = ['visits', 'recent', 'name', 'custom'];
  var SEARCH_SCOPES = ['all'];
  var ICON_SOURCES = ['builtin', 'auto', 'url', 'upload'];

  var DEFAULT_SETTINGS = {
    theme: 'system',
    sort: 'visits',
    searchScope: 'all'
  };

  /** 种子缺失时的兜底分类，保证文档始终有分类可用 */
  var FALLBACK_CATEGORIES = [
    { id: 'course', name: '课程学习', icon: 'i-cap', color: '#3b6fe0' },
    { id: 'coding', name: '编程开发', icon: 'i-code', color: '#6d5ce7' },
    { id: 'major', name: '专业学习', icon: 'i-flask', color: '#0f9d8a' },
    { id: 'docs', name: '文献资料', icon: 'i-book', color: '#d9822b' },
    { id: 'campus', name: '校园生活', icon: 'i-home', color: '#d6537a' }
  ];

  var DEFAULT_ICON = 'i-grid';
  var DEFAULT_COLOR = '#2f6bff';
  var TAG_SPLIT = /[,，;；]+/;
  var ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

  /* ================================================================ 小工具 */

  function now() { return Date.now(); }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isString(value) { return typeof value === 'string'; }

  function isPositiveNumber(value) {
    return typeof value === 'number' && isFinite(value) && value > 0;
  }

  function toInt(value, fallback) {
    var n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
  }

  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (err) { return null; }
  }

  var uidCounter = 0;

  /** 生成带前缀的稳定唯一 id：s-xxx（站点）、c-xxx（分类）、img-xxx（图片） */
  function uid(prefix) {
    uidCounter = (uidCounter + 1) % 46656;
    return (prefix || 's-') + now().toString(36) +
      Math.random().toString(36).slice(2, 6) + uidCounter.toString(36);
  }

  function safeIcon(value) {
    var text = String(value || '');
    return /^i-[a-z0-9-]+$/.test(text) ? text : DEFAULT_ICON;
  }

  function safeColor(value) {
    var text = String(value || '').trim();
    return /^#[0-9a-f]{3,8}$/i.test(text) ? text : DEFAULT_COLOR;
  }

  /** 抽成与 app.js 一致的网址整理规则：补协议、只允许 http(s)、去 hash */
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

  /** 查重用的规范化键：忽略 www、末尾斜杠与大小写 */
  function canonicalKey(url) {
    try {
      var parsed = new URL(url);
      return (parsed.hostname.replace(/^www\./i, '') +
        parsed.pathname.replace(/\/$/, '') + parsed.search).toLowerCase();
    } catch (err) {
      return String(url || '').trim().toLowerCase();
    }
  }

  /**
   * 标签拆分 + 去空 + 去重 + 截断。
   * 分隔符只有 , ， ; ； 四种；空格与换行不拆分（英文标签可含空格），
   * 回车确认交给标签输入 UI 处理。
   */
  function parseTags(input) {
    var list = Array.isArray(input) ? input : String(input || '').split(TAG_SPLIT);
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length && out.length < LIMITS.tags; i++) {
      var tag = String(list[i] === undefined || list[i] === null ? '' : list[i]).trim();
      if (!tag) { continue; }
      tag = tag.slice(0, LIMITS.tagLen);
      if (seen[tag]) { continue; }
      seen[tag] = true;
      out.push(tag);
    }
    return out;
  }

  /* ============================================================ 归一化 */

  function normalizeSettings(raw) {
    var src = isObject(raw) ? raw : {};
    return {
      theme: THEMES.indexOf(src.theme) > -1 ? src.theme : DEFAULT_SETTINGS.theme,
      sort: SORTS.indexOf(src.sort) > -1 ? src.sort : DEFAULT_SETTINGS.sort,
      searchScope: SEARCH_SCOPES.indexOf(src.searchScope) > -1 ? src.searchScope : DEFAULT_SETTINGS.searchScope
    };
  }

  function normalizeCategory(raw, index) {
    var src = isObject(raw) ? raw : {};
    var order = toInt(src.order, index);
    return {
      id: isString(src.id) && src.id ? src.id.slice(0, 64) : uid('c-'),
      name: (isString(src.name) ? src.name.trim() : '').slice(0, LIMITS.categoryName) || '未命名分类',
      icon: safeIcon(src.icon),
      color: safeColor(src.color),
      order: order < 0 ? index : order,
      builtin: !!src.builtin
    };
  }

  /** 兼容两种历史写法：icon 为对象（V0.2）或 icon 为 symbol 字符串（V0.1） */
  function normalizeIcon(raw, legacySymbol) {
    var src = isObject(raw) ? raw : {};
    var source = ICON_SOURCES.indexOf(src.source) > -1 ? src.source : 'builtin';
    var symbol = safeIcon(src.symbol || legacySymbol);
    var out = { source: source, symbol: symbol, url: '', imageId: '' };

    if (source === 'url') {
      var parsed = normalizeUrl(src.url);
      if (parsed.url) { out.url = parsed.url; } else { out.source = 'builtin'; }
    } else if (source === 'upload') {
      out.imageId = isString(src.imageId) ? src.imageId.trim().slice(0, 64) : '';
      if (!out.imageId) { out.source = 'builtin'; }
    }
    return out;
  }

  function normalizeSite(raw) {
    var src = isObject(raw) ? raw : {};
    var url = normalizeUrl(src.url);
    var created = isPositiveNumber(src.createdAt) ? src.createdAt : now();
    var updated = isPositiveNumber(src.updatedAt) ? src.updatedAt : created;

    return {
      id: isString(src.id) && src.id ? src.id.slice(0, 64) : uid(),
      name: (isString(src.name) ? src.name.trim() : '').slice(0, LIMITS.name),
      url: url.url || '',
      desc: (isString(src.desc) ? src.desc.trim() : '').slice(0, LIMITS.desc),
      category: isString(src.category) ? src.category.slice(0, 64) : '',
      tags: parseTags(src.tags),
      icon: normalizeIcon(src.icon, isString(src.icon) ? src.icon : ''),
      color: safeColor(src.color),
      order: typeof src.order === 'number' && isFinite(src.order) && src.order >= 0
        ? Math.floor(src.order) : null,
      visits: Math.max(0, toInt(src.visits, 0)),
      lastUsed: isPositiveNumber(src.lastUsed) ? src.lastUsed : null,
      favorite: !!src.favorite,
      createdAt: created,
      updatedAt: updated
    };
  }

  /**
   * 修整整份文档：补齐缺失字段、修复可修复的脏值。
   * 注意：不保证结果一定合法（例如分类为空、URL 非法），合法性交给 validateDoc。
   */
  function normalizeDoc(raw) {
    var src = isObject(raw) ? raw : {};

    var categories = (Array.isArray(src.categories) ? src.categories : [])
      .map(normalizeCategory);

    // 按 order 排序并重新编号，保证序号连续且唯一（用户顺序不变）
    categories.sort(function (a, b) {
      if (a.order !== b.order) { return a.order - b.order; }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    for (var i = 0; i < categories.length; i++) { categories[i].order = i; }

    var sites = (Array.isArray(src.sites) ? src.sites : []).map(normalizeSite);

    return {
      schemaVersion: SCHEMA_VERSION,
      appVersion: isString(src.appVersion) && src.appVersion ? src.appVersion : APP_VERSION,
      updatedAt: isPositiveNumber(src.updatedAt) ? src.updatedAt : now(),
      settings: normalizeSettings(src.settings),
      categories: categories,
      sites: sites
    };
  }

  /* ============================================================== 校验 */

  function makeIssue(code, path, message) {
    return { code: code, path: path, message: message };
  }

  /**
   * 校验一份「已经 normalize 过」的文档。
   * @returns {{ok:boolean, errors:Array, warnings:Array}}
   *   errors   → 结构不可用，必须修复或中止
   *   warnings → 可容忍的异常（重复网址、序号重复等），仅提示
   */
  function validateDoc(doc) {
    var errors = [];
    var warnings = [];

    if (!isObject(doc)) {
      errors.push(makeIssue('DOC_NOT_OBJECT', '$', '数据文档不是对象'));
      return { ok: false, errors: errors, warnings: warnings };
    }

    if (doc.schemaVersion !== SCHEMA_VERSION) {
      errors.push(makeIssue('SCHEMA_VERSION', 'schemaVersion', '数据版本不是 ' + SCHEMA_VERSION));
    }
    if (!isPositiveNumber(doc.updatedAt)) {
      errors.push(makeIssue('UPDATED_AT', 'updatedAt', 'updatedAt 必须是时间戳'));
    }

    /* ---- 设置 ---- */
    var settings = doc.settings;
    if (!isObject(settings)) {
      errors.push(makeIssue('SETTINGS_MISSING', 'settings', '缺少设置对象'));
    } else {
      if (THEMES.indexOf(settings.theme) === -1) {
        errors.push(makeIssue('SETTINGS_THEME', 'settings.theme', '未知主题：' + settings.theme));
      }
      if (SORTS.indexOf(settings.sort) === -1) {
        errors.push(makeIssue('SETTINGS_SORT', 'settings.sort', '未知排序：' + settings.sort));
      }
      if (SEARCH_SCOPES.indexOf(settings.searchScope) === -1) {
        errors.push(makeIssue('SETTINGS_SCOPE', 'settings.searchScope', '未知搜索范围：' + settings.searchScope));
      }
    }

    /* ---- 分类 ---- */
    var categories = doc.categories;
    var categoryIds = {};
    var categoryOrders = {};

    if (!Array.isArray(categories) || !categories.length) {
      errors.push(makeIssue('CATEGORIES_EMPTY', 'categories', '至少需要一个分类'));
    } else {
      for (var c = 0; c < categories.length; c++) {
        var cat = categories[c];
        var cp = 'categories[' + c + ']';
        if (!isObject(cat)) {
          errors.push(makeIssue('CATEGORY_NOT_OBJECT', cp, '分类不是对象'));
          continue;
        }
        if (!isString(cat.id) || !ID_PATTERN.test(cat.id)) {
          errors.push(makeIssue('CATEGORY_ID', cp + '.id', '分类 id 非法：' + cat.id));
        } else if (categoryIds[cat.id]) {
          errors.push(makeIssue('CATEGORY_ID_DUP', cp + '.id', '分类 id 重复：' + cat.id));
        } else {
          categoryIds[cat.id] = true;
        }
        if (!isString(cat.name) || !cat.name.trim()) {
          errors.push(makeIssue('CATEGORY_NAME', cp + '.name', '分类名称不能为空'));
        } else if (cat.name.length > LIMITS.categoryName) {
          errors.push(makeIssue('CATEGORY_NAME_LEN', cp + '.name', '分类名称超过 ' + LIMITS.categoryName + ' 字'));
        }
        if (!isString(cat.icon) || !/^i-[a-z0-9-]+$/.test(cat.icon)) {
          errors.push(makeIssue('CATEGORY_ICON', cp + '.icon', '分类图标名非法：' + cat.icon));
        }
        if (!isString(cat.color) || !/^#[0-9a-f]{3,8}$/i.test(cat.color)) {
          errors.push(makeIssue('CATEGORY_COLOR', cp + '.color', '分类颜色非法：' + cat.color));
        }
        if (!isFinite(cat.order) || cat.order < 0 || Math.floor(cat.order) !== cat.order) {
          errors.push(makeIssue('CATEGORY_ORDER', cp + '.order', '分类序号必须是非负整数'));
        } else {
          if (categoryOrders[cat.order]) {
            warnings.push(makeIssue('CATEGORY_ORDER_DUP', cp + '.order', '分类序号重复：' + cat.order));
          }
          categoryOrders[cat.order] = true;
        }
        if (typeof cat.builtin !== 'boolean') {
          errors.push(makeIssue('CATEGORY_BUILTIN', cp + '.builtin', 'builtin 必须是布尔值'));
        }
      }
    }

    /* ---- 站点 ---- */
    var sites = doc.sites;
    if (!Array.isArray(sites)) {
      errors.push(makeIssue('SITES_NOT_ARRAY', 'sites', 'sites 必须是数组'));
      sites = [];
    }

    var siteIds = {};
    var urlKeys = {};

    for (var s = 0; s < sites.length; s++) {
      var site = sites[s];
      var sp = 'sites[' + s + ']';

      if (!isObject(site)) {
        errors.push(makeIssue('SITE_NOT_OBJECT', sp, '网站不是对象'));
        continue;
      }
      if (!isString(site.id) || !ID_PATTERN.test(site.id)) {
        errors.push(makeIssue('SITE_ID', sp + '.id', '网站 id 非法：' + site.id));
      } else if (siteIds[site.id]) {
        errors.push(makeIssue('SITE_ID_DUP', sp + '.id', '网站 id 重复：' + site.id));
      } else {
        siteIds[site.id] = true;
      }

      if (!isString(site.name) || !site.name.trim()) {
        errors.push(makeIssue('SITE_NAME', sp + '.name', '网站名称不能为空'));
      } else if (site.name.length > LIMITS.name) {
        errors.push(makeIssue('SITE_NAME_LEN', sp + '.name', '网站名称超过 ' + LIMITS.name + ' 字'));
      }

      var urlResult = normalizeUrl(site.url);
      if (urlResult.error) {
        errors.push(makeIssue('SITE_URL', sp + '.url', urlResult.error));
      } else {
        var key = canonicalKey(urlResult.url);
        if (urlKeys[key]) {
          warnings.push(makeIssue('SITE_URL_DUP', sp + '.url', '网址与 ' + urlKeys[key] + ' 重复'));
        } else {
          urlKeys[key] = site.id;
        }
      }

      if (!isString(site.desc) || site.desc.length > LIMITS.desc) {
        errors.push(makeIssue('SITE_DESC', sp + '.desc', '用途说明必须是不超过 ' + LIMITS.desc + ' 字的字符串'));
      }

      if (!isString(site.category) || !site.category) {
        errors.push(makeIssue('SITE_CATEGORY', sp + '.category', '缺少所属分类'));
      } else if (!categoryIds[site.category]) {
        errors.push(makeIssue('SITE_CATEGORY_REF', sp + '.category', '分类不存在：' + site.category));
      }

      if (!Array.isArray(site.tags)) {
        errors.push(makeIssue('SITE_TAGS', sp + '.tags', 'tags 必须是数组'));
      } else {
        if (site.tags.length > LIMITS.tags) {
          errors.push(makeIssue('SITE_TAGS_LEN', sp + '.tags', '标签超过 ' + LIMITS.tags + ' 个'));
        }
        for (var t = 0; t < site.tags.length; t++) {
          var tag = site.tags[t];
          if (!isString(tag) || !tag.trim()) {
            errors.push(makeIssue('SITE_TAG_EMPTY', sp + '.tags[' + t + ']', '标签不能为空'));
          } else if (tag.length > LIMITS.tagLen) {
            errors.push(makeIssue('SITE_TAG_LEN', sp + '.tags[' + t + ']', '单个标签超过 ' + LIMITS.tagLen + ' 字'));
          }
        }
      }

      /* 图标 */
      var icon = site.icon;
      if (!isObject(icon)) {
        errors.push(makeIssue('SITE_ICON', sp + '.icon', 'icon 必须是对象'));
      } else {
        if (ICON_SOURCES.indexOf(icon.source) === -1) {
          errors.push(makeIssue('SITE_ICON_SOURCE', sp + '.icon.source', '未知图标来源：' + icon.source));
        }
        if (!isString(icon.symbol) || !/^i-[a-z0-9-]+$/.test(icon.symbol)) {
          errors.push(makeIssue('SITE_ICON_SYMBOL', sp + '.icon.symbol', '图标 symbol 非法：' + icon.symbol));
        }
        if (icon.source === 'url' && normalizeUrl(icon.url).error) {
          errors.push(makeIssue('SITE_ICON_URL', sp + '.icon.url', '图标 URL 非法'));
        }
        if (icon.source === 'upload' && (!isString(icon.imageId) || !icon.imageId)) {
          errors.push(makeIssue('SITE_ICON_IMAGE', sp + '.icon.imageId', '上传图标缺少 imageId'));
        }
      }

      if (!isString(site.color) || !/^#[0-9a-f]{3,8}$/i.test(site.color)) {
        errors.push(makeIssue('SITE_COLOR', sp + '.color', '站点颜色非法：' + site.color));
      }
      if (!isFinite(site.visits) || site.visits < 0 || Math.floor(site.visits) !== site.visits) {
        errors.push(makeIssue('SITE_VISITS', sp + '.visits', '使用次数必须是非负整数'));
      }
      if (site.lastUsed !== null && !isPositiveNumber(site.lastUsed)) {
        errors.push(makeIssue('SITE_LAST_USED', sp + '.lastUsed', 'lastUsed 必须是时间戳或 null'));
      }
      if (typeof site.favorite !== 'boolean') {
        errors.push(makeIssue('SITE_FAVORITE', sp + '.favorite', 'favorite 必须是布尔值'));
      }
      if (site.order !== null && (!isFinite(site.order) || site.order < 0)) {
        errors.push(makeIssue('SITE_ORDER', sp + '.order', 'order 必须是 null 或非负数'));
      }
      if (!isPositiveNumber(site.createdAt)) {
        errors.push(makeIssue('SITE_CREATED_AT', sp + '.createdAt', 'createdAt 必须是时间戳'));
      }
      if (!isPositiveNumber(site.updatedAt)) {
        errors.push(makeIssue('SITE_UPDATED_AT', sp + '.updatedAt', 'updatedAt 必须是时间戳'));
      }
    }

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  /* ============================================================== 种子 */

  function seedCategories(seed) {
    var source = seed && Array.isArray(seed.categories) && seed.categories.length
      ? seed.categories : FALLBACK_CATEGORIES;

    return source.map(function (cat, index) {
      return {
        id: isString(cat.id) && cat.id ? cat.id : uid('c-'),
        name: isString(cat.name) ? cat.name : '未命名分类',
        icon: cat.icon,
        color: cat.color,
        order: index,
        builtin: true
      };
    });
  }

  function seedSites(seed, at) {
    var list = seed && Array.isArray(seed.sites) ? seed.sites : [];
    return list.map(function (raw, index) {
      var hours = typeof raw.seededHoursAgo === 'number' ? raw.seededHoursAgo : null;
      return {
        id: raw.id,
        name: raw.name,
        url: raw.url,
        desc: raw.desc,
        category: raw.category,
        tags: raw.tags,
        icon: { source: 'builtin', symbol: raw.icon, url: '', imageId: '' },
        color: raw.color,
        order: index * 100,
        visits: Math.max(0, toInt(raw.initialVisits, 0)),
        lastUsed: hours === null ? null : at - hours * 3600 * 1000,
        favorite: false,
        createdAt: at,
        updatedAt: at
      };
    });
  }

  /**
   * 由 data.js 的种子生成第一份 V0.2 文档。
   * @param {object} seed  window.STUDYHUB_DATA
   * @param {object} [options] {now}
   */
  function createDoc(seed, options) {
    var opts = options || {};
    var at = isPositiveNumber(opts.now) ? opts.now : now();

    return normalizeDoc({
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      updatedAt: at,
      settings: clone(DEFAULT_SETTINGS),
      categories: seedCategories(seed),
      sites: seedSites(seed, at)
    });
  }

  /* ========================================================== 版本迁移 */

  /** 解析迁移来源：接受已解析对象或 JSON 字符串，null/undefined 视为「无数据」 */
  function parseSource(source) {
    if (source === null || source === undefined) {
      return { ok: true, value: null };
    }
    if (isString(source)) {
      try {
        return { ok: true, value: JSON.parse(source) };
      } catch (err) {
        return { ok: false, code: 'PARSE', message: '源数据不是合法 JSON' };
      }
    }
    if (isObject(source)) {
      return { ok: true, value: source };
    }
    return { ok: false, code: 'SOURCE_TYPE', message: '源数据必须是对象或 JSON 字符串' };
  }

  /**
   * 识别来源版本：
   *   3 → 已是 V0.2 文档（幂等重放）
   *   2 → {version:2, sites:[...]} 完整站点数组
   *   1 → {version:1, sites:{id:{visits,lastUsed,favorite}}} 记录分离
   *   0 → 无数据
   */
  function detectSourceVersion(source) {
    if (!isObject(source)) { return 0; }
    if (source.version !== undefined) {
      if (source.version === 3) { return 3; }
      if (source.version === 2) { return 2; }
      if (source.version === 1) { return 1; }
      return null;
    }
    if (source.schemaVersion === SCHEMA_VERSION) { return 3; }
    if (Array.isArray(source.sites)) { return 2; }
    if (isObject(source.sites)) { return 1; }
    return null;
  }

  function indexById(list) {
    var map = {};
    for (var i = 0; i < list.length; i++) { map[list[i].id] = list[i]; }
    return map;
  }

  /** V2（完整站点数组）→ V3 */
  function buildFromV2(raw, at, seed, warnings) {
    var categories = seedCategories(seed);
    var byId = indexById(categories);
    var fallback = categories.length ? categories[0] : null;
    var seen = {};
    var list = Array.isArray(raw.sites) ? raw.sites : [];
    var sites = [];

    for (var i = 0; i < list.length; i++) {
      var src = isObject(list[i]) ? list[i] : {};
      var path = 'sites[' + i + ']';

      var id = isString(src.id) && src.id ? src.id : uid();
      if (seen[id]) {
        id = uid();
        warnings.push(makeIssue('SITE_ID_REPAIRED', path + '.id', '站点 id 重复，已重新生成'));
      }
      seen[id] = true;

      var category = src.category;
      if (!isString(category) || !byId[category]) {
        category = fallback ? fallback.id : '';
        warnings.push(makeIssue('SITE_CATEGORY_FALLBACK', path + '.category', '分类不存在，已归入默认分类'));
      }
      var cat = byId[category] || fallback || {};

      var url = normalizeUrl(src.url);
      var name = (isString(src.name) ? src.name.trim() : '').slice(0, LIMITS.name);
      if (!name) {
        name = '未命名网站';
        warnings.push(makeIssue('SITE_NAME_FALLBACK', path + '.name', '网站名称为空，已使用占位名称'));
      }

      var created = isPositiveNumber(src.createdAt) ? src.createdAt
        : isPositiveNumber(raw.updatedAt) ? raw.updatedAt : at;
      var updated = isPositiveNumber(src.updatedAt) ? src.updatedAt : created;

      sites.push({
        id: id,
        name: name,
        url: url.url || '',
        desc: (isString(src.desc) ? src.desc.trim() : '').slice(0, LIMITS.desc),
        category: category,
        tags: parseTags(src.tags),
        icon: normalizeIcon(src.icon, isString(src.icon) ? src.icon : (cat.icon || '')),
        color: isString(src.color) ? src.color : (cat.color || DEFAULT_COLOR),
        order: i * 100,
        visits: Math.max(0, toInt(src.visits, 0)),
        lastUsed: isPositiveNumber(src.lastUsed) ? src.lastUsed : null,
        favorite: !!src.favorite,
        createdAt: created,
        updatedAt: updated
      });
    }

    return normalizeDoc({
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      updatedAt: isPositiveNumber(raw.updatedAt) ? raw.updatedAt : at,
      settings: DEFAULT_SETTINGS,
      categories: categories,
      sites: sites
    });
  }

  /** V1（记录分离）→ V3：以种子站点为本体，叠加保存过的使用记录 */
  function buildFromV1(raw, at, seed, warnings) {
    var categories = seedCategories(seed);
    var records = isObject(raw.sites) ? raw.sites : {};
    var seeded = seedSites(seed, at);
    var known = {};

    var sites = seeded.map(function (base) {
      known[base.id] = true;
      var rec = isObject(records[base.id]) ? records[base.id] : null;
      if (!rec) { return base; }

      var merged = clone(base);
      var url = normalizeUrl(rec.url);
      if (url.url) { merged.url = url.url; }
      merged.visits = Math.max(0, toInt(rec.visits, base.visits));
      merged.lastUsed = isPositiveNumber(rec.lastUsed) ? rec.lastUsed
        : rec.lastUsed === null ? null : base.lastUsed;
      merged.favorite = !!rec.favorite;
      return merged;
    });

    Object.keys(records).forEach(function (id) {
      if (!known[id]) {
        warnings.push(makeIssue('ORPHAN_RECORD', 'sites.' + id, '记录对应的网站已不存在，已忽略'));
      }
    });

    return normalizeDoc({
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      updatedAt: isPositiveNumber(raw.updatedAt) ? raw.updatedAt : at,
      settings: DEFAULT_SETTINGS,
      categories: categories,
      sites: sites
    });
  }

  /**
   * 构建 V3 文档（纯函数，不读写 localStorage、不改动入参）。
   * @param {object|string|null} source V1/V2 存储原文、V3 文档或 JSON 字符串
   * @param {{seed?:object, now?:number}} [options]
   * @returns {{ok:true, doc, report}|{ok:false, code, message?, errors?, warnings?, doc?}}
   */
  function buildV3(source, options) {
    var opts = options || {};
    var at = isPositiveNumber(opts.now) ? opts.now : now();
    var seed = opts.seed || (isObject(root.STUDYHUB_DATA) ? root.STUDYHUB_DATA : null);

    var parsed = parseSource(source);
    if (!parsed.ok) { return parsed; }

    var raw = parsed.value;
    var version = detectSourceVersion(raw);
    if (version === null) {
      return { ok: false, code: 'UNKNOWN_VERSION', message: '无法识别的数据版本，未做任何改动' };
    }

    var warnings = [];
    var doc;

    if (version === 0) {
      doc = createDoc(seed, { now: at });
    } else if (version === 1) {
      doc = buildFromV1(raw, at, seed, warnings);
    } else if (version === 2) {
      doc = buildFromV2(raw, at, seed, warnings);
    } else {
      doc = normalizeDoc(raw);
    }

    var check = validateV3(doc);
    var report = {
      sourceVersion: version,
      targetVersion: SCHEMA_VERSION,
      sites: check.stats.sites,
      categories: check.stats.categories,
      favorites: check.stats.favorites,
      visitsTotal: check.stats.visitsTotal,
      lastUsedCount: check.stats.lastUsedCount,
      warnings: warnings.concat(check.warnings)
    };

    if (!check.ok) {
      return {
        ok: false,
        code: 'SCHEMA',
        message: '迁移结果未通过校验',
        errors: check.errors,
        warnings: report.warnings,
        doc: doc,
        report: report
      };
    }

    return { ok: true, doc: doc, report: report };
  }

  /**
   * 迁移专用校验：在 validateDoc 之上补充「同站标签重复」告警与统计信息。
   * @returns {{ok:boolean, errors:Array, warnings:Array, stats:object}}
   */
  function validateV3(doc) {
    var base = validateDoc(doc);
    var warnings = base.warnings.slice();
    var sites = isObject(doc) && Array.isArray(doc.sites) ? doc.sites : [];
    var favorites = 0;
    var visitsTotal = 0;
    var lastUsedCount = 0;

    for (var i = 0; i < sites.length; i++) {
      var site = sites[i];
      if (!isObject(site)) { continue; }
      if (site.favorite) { favorites++; }
      visitsTotal += Math.max(0, toInt(site.visits, 0));
      if (site.lastUsed) { lastUsedCount++; }

      if (Array.isArray(site.tags)) {
        var seen = {};
        var duplicated = false;
        for (var t = 0; t < site.tags.length; t++) {
          if (seen[site.tags[t]]) { duplicated = true; } else { seen[site.tags[t]] = true; }
        }
        if (duplicated) {
          warnings.push(makeIssue('SITE_TAG_DUP', 'sites[' + i + '].tags', '同一站点存在重复标签'));
        }
      }
    }

    return {
      ok: base.ok,
      errors: base.errors,
      warnings: warnings,
      stats: {
        sites: sites.length,
        categories: isObject(doc) && Array.isArray(doc.categories) ? doc.categories.length : 0,
        favorites: favorites,
        visitsTotal: visitsTotal,
        lastUsedCount: lastUsedCount
      }
    };
  }

  /* ============================================================== 统计 */

  /** 供迁移元信息、设置页展示使用的汇总 */
  function summarize(doc) {
    var sites = isObject(doc) && Array.isArray(doc.sites) ? doc.sites : [];
    var favorites = 0;
    var visitsTotal = 0;
    var lastUsedCount = 0;
    var tags = {};
    var icons = 0;

    for (var i = 0; i < sites.length; i++) {
      var site = sites[i];
      if (site.favorite) { favorites++; }
      visitsTotal += Math.max(0, toInt(site.visits, 0));
      if (site.lastUsed) { lastUsedCount++; }
      if (site.icon && site.icon.source === 'upload') { icons++; }
      for (var t = 0; t < (site.tags || []).length; t++) { tags[site.tags[t]] = true; }
    }

    return {
      sites: sites.length,
      categories: isObject(doc) && Array.isArray(doc.categories) ? doc.categories.length : 0,
      favorites: favorites,
      visitsTotal: visitsTotal,
      lastUsedCount: lastUsedCount,
      tags: Object.keys(tags).length,
      uploadedIcons: icons
    };
  }

  /* ========================================================== 存储原语 */

  var storageCache = null;
  var storageChecked = false;

  function resetStorageProbe() {
    storageChecked = false;
    storageCache = null;
  }

  function getStorage() {
    if (storageChecked) { return storageCache; }
    storageChecked = true;
    try {
      var ls = root.localStorage;
      storageCache = ls && typeof ls.getItem === 'function' ? ls : null;
    } catch (err) {
      storageCache = null;
    }
    return storageCache;
  }

  /** 把浏览器异常归类成有限错误码，供上层决定「重试 / 只读 / 仅提示」 */
  function classifyError(err) {
    if (!err) { return 'UNKNOWN'; }
    var name = String(err.name || '');
    var code = err.code;
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        code === 22 || code === 1014) { return 'QUOTA'; }
    if (name === 'SecurityError' || code === 18) { return 'BLOCKED'; }
    return 'UNKNOWN';
  }

  function readRaw(key) {
    var ls = getStorage();
    if (!ls) {
      return { ok: false, code: 'NO_STORAGE', message: '当前浏览器不可用本地存储' };
    }
    try {
      return { ok: true, raw: ls.getItem(key) };
    } catch (err) {
      return { ok: false, code: classifyError(err), message: String(err && err.message || err) };
    }
  }

  function writeRaw(key, text) {
    var ls = getStorage();
    if (!ls) {
      return { ok: false, code: 'NO_STORAGE', message: '当前浏览器不可用本地存储' };
    }
    try {
      ls.setItem(key, text);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        code: classifyError(err),
        message: String(err && err.message || err)
      };
    }
  }

  function removeRaw(key) {
    var ls = getStorage();
    if (!ls) {
      return { ok: false, code: 'NO_STORAGE', message: '当前浏览器不可用本地存储' };
    }
    try {
      ls.removeItem(key);
      return { ok: true };
    } catch (err) {
      return { ok: false, code: classifyError(err), message: String(err && err.message || err) };
    }
  }

  function backupKey(timestamp) {
    return KEYS.backupPrefix + (isPositiveNumber(timestamp) ? timestamp : now());
  }

  /**
   * 读取主数据并归一化 + 校验。
   * @returns {{ok:true, doc, warnings, raw}|{ok:false, code, errors?, message?}}
   */
  function readDoc() {
    var read = readRaw(KEYS.data);
    if (!read.ok) { return read; }
    if (read.raw === null) { return { ok: false, code: 'EMPTY', message: '本地还没有 V0.2 数据' }; }

    var parsed;
    try {
      parsed = JSON.parse(read.raw);
    } catch (err) {
      return { ok: false, code: 'PARSE', message: '本地数据不是合法 JSON' };
    }

    var doc = normalizeDoc(parsed);
    var check = validateDoc(doc);
    if (!check.ok) {
      return { ok: false, code: 'SCHEMA', errors: check.errors, warnings: check.warnings, doc: doc };
    }
    return { ok: true, doc: doc, warnings: check.warnings, raw: read.raw };
  }

  /** 写入主数据：先校验再写，避免把非法文档落盘 */
  function writeDoc(doc) {
    var check = validateDoc(doc);
    if (!check.ok) {
      return { ok: false, code: 'SCHEMA', errors: check.errors };
    }

    var text;
    try {
      text = JSON.stringify(doc);
    } catch (err) {
      return { ok: false, code: 'SERIALIZE', message: '数据无法序列化' };
    }

    var written = writeRaw(KEYS.data, text);
    if (!written.ok) { return written; }
    return { ok: true, text: text };
  }

  /**
   * 写入后回读校验（迁移提交、导入恢复使用）。
   * 逐字节比较 + 重新校验，双重确认。
   */
  function writeVerified(doc) {
    var written = writeDoc(doc);
    if (!written.ok) { return written; }

    var readBack = readRaw(KEYS.data);
    if (!readBack.ok) { return readBack; }
    if (readBack.raw !== written.text) {
      return { ok: false, code: 'VERIFY_FAILED', message: '回读内容与写入内容不一致' };
    }

    var parsed;
    try {
      parsed = JSON.parse(readBack.raw);
    } catch (err) {
      return { ok: false, code: 'VERIFY_FAILED', message: '回读内容不是合法 JSON' };
    }
    var check = validateDoc(normalizeDoc(parsed));
    if (!check.ok) {
      return { ok: false, code: 'VERIFY_FAILED', errors: check.errors };
    }
    return { ok: true, text: written.text };
  }

  /* ========================================================== 迁移状态机 */

  var MIGRATION_STATES = ['backing-up', 'writing', 'done', 'failed'];

  /**
   * 进程内会话状态：
   *   mode normal    → 可正常读写
   *   mode readonly  → 迁移失败保护，所有写入口拒绝
   */
  var session = {
    mode: 'normal',
    readOnly: false,
    reason: null,
    message: '',
    doc: null,
    meta: null,
    migration: null,
    warnings: []
  };

  /** 稳定的小校验和：长度 + djb2，用于备份回读比对（错一位就会变） */
  function checksum(text) {
    var str = String(text);
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36) + ':' + str.length;
  }

  /** 校验备份是否确实对应本次迁移：字节数 + 校验和，且旧键原文一致（若可用） */
  function verifyBackup(meta, backupRaw, sourceRaw) {
    if (!isString(backupRaw)) { return false; }
    if (!isPositiveNumber(meta.backupBytes) || meta.backupBytes !== backupRaw.length) { return false; }
    if (!isString(meta.backupChecksum) || meta.backupChecksum === '') { return false; }
    if (meta.backupChecksum !== checksum(backupRaw)) { return false; }
    if (sourceRaw !== null && sourceRaw !== backupRaw) { return false; }
    return true;
  }

  function readMeta() {
    var read = readRaw(KEYS.meta);
    if (!read.ok) { return read; }
    if (read.raw === null) { return { ok: true, value: null }; }
    try {
      var value = JSON.parse(read.raw);
      return { ok: true, value: isObject(value) ? value : null, corrupt: !isObject(value) };
    } catch (err) {
      return { ok: true, value: null, corrupt: true };
    }
  }

  function writeMeta(meta) {
    var text;
    try {
      text = JSON.stringify(meta);
    } catch (err) {
      return { ok: false, code: 'SERIALIZE', message: '迁移状态无法序列化' };
    }
    return writeRaw(KEYS.meta, text);
  }

  /** 选一个绝不覆盖已有备份的键：base、base-1、base-2 …
   *  探测本身失败时宁可中止迁移，也不猜一个可能已存在的键 */
  function uniqueBackupKey(timestamp) {
    var base = backupKey(timestamp);
    var candidate = base;
    for (var n = 1; n <= 999; n++) {
      var read = readRaw(candidate);
      if (!read.ok) {
        return {
          ok: false,
          code: 'STORAGE_UNAVAILABLE',
          message: '无法确认备份键是否可用：' + (read.code || 'UNKNOWN')
        };
      }
      if (read.raw === null) { return { ok: true, key: candidate }; }
      candidate = base + '-' + n;
    }
    return { ok: true, key: base + '-x' + now().toString(36) };
  }

  function enterReadOnly(code, message, meta, doc, warnings) {
    session.mode = 'readonly';
    session.readOnly = true;
    session.reason = code;
    session.message = message || code;
    session.meta = meta || null;
    session.doc = doc || null;
    session.warnings = warnings || [];
    return session;
  }

  function enterNormal(doc, meta, migration, warnings) {
    session.mode = 'normal';
    session.readOnly = false;
    session.reason = null;
    session.message = '';
    session.doc = doc || null;
    session.meta = meta || null;
    session.migration = migration || null;
    session.warnings = warnings || [];
    return session;
  }

  function sourceLabel(version) {
    if (version === 1) { return 'v1'; }
    if (version === 2) { return 'v2'; }
    if (version === 3) { return 'v3'; }
    return 'none';
  }

  /**
   * 执行一次完整迁移（只在 init / retryMigration 内部调用）：
   *   backing-up → 写备份 → 回读逐字节校验 → writing → 写主数据 + 回读校验 → done
   * 任一步失败 → 写 failed 状态并返回失败信息，旧键始终不动。
   */
  function performMigration(sourceText, sourceVersion, options) {
    var opts = options || {};
    var at = isPositiveNumber(opts.now) ? opts.now : now();
    var seed = opts.seed || (isObject(root.STUDYHUB_DATA) ? root.STUDYHUB_DATA : null);
    var keyPick = uniqueBackupKey(at);
    if (!keyPick.ok) {
      // 无法确认备份键可用：不写 meta、不写备份、不碰主数据
      return {
        ok: false,
        code: keyPick.code,
        message: keyPick.message,
        meta: null,
        backupKey: null,
        metaPersisted: false
      };
    }
    var key = keyPick.key;

    var meta = {
      version: 1,
      state: 'backing-up',
      source: sourceLabel(sourceVersion),
      sourceVersion: sourceVersion,
      backupKey: key,
      backupBytes: sourceText.length,
      backupChecksum: checksum(sourceText),
      startedAt: at,
      finishedAt: null,
      backupVerifiedAt: null,
      appVersion: APP_VERSION,
      error: null
    };

    function fail(code, message, extra) {
      meta.state = 'failed';
      meta.finishedAt = isPositiveNumber(opts.now) ? opts.now : now();
      meta.error = { code: code, message: message };
      var written = writeMeta(meta);
      return {
        ok: false,
        code: code,
        message: message,
        meta: meta,
        backupKey: key,
        metaPersisted: written.ok,
        errors: extra && extra.errors ? extra.errors : undefined,
        warnings: extra && extra.warnings ? extra.warnings : undefined
      };
    }

    var firstMeta = writeMeta(meta);
    if (!firstMeta.ok) {
      return fail('META_WRITE_FAILED', '无法写入迁移状态：' + firstMeta.code);
    }

    var backupWrite = writeRaw(key, sourceText);
    if (!backupWrite.ok) {
      return fail('BACKUP_WRITE_FAILED', '备份写入失败：' + backupWrite.code);
    }

    var backupRead = readRaw(key);
    if (!backupRead.ok) {
      return fail('BACKUP_READBACK_FAILED', '备份回读失败：' + backupRead.code);
    }
    if (backupRead.raw !== sourceText) {
      return fail('BACKUP_MISMATCH', '备份内容与原始数据不一致，已中止迁移');
    }

    meta.state = 'writing';
    meta.backupVerifiedAt = now();
    var writingMeta = writeMeta(meta);
    if (!writingMeta.ok) {
      return fail('META_WRITE_FAILED', '无法记录迁移进度：' + writingMeta.code);
    }

    var built = buildV3(sourceText, { seed: seed, now: at });
    if (!built.ok) {
      return fail('BUILD_FAILED', '旧数据无法构建为 V0.2 结构：' + (built.message || built.code), built);
    }

    var verified = writeVerified(built.doc);
    if (!verified.ok) {
      return fail(
        verified.code === 'QUOTA' ? 'DATA_QUOTA' : 'DATA_WRITE_FAILED',
        '主数据写入或回读校验失败：' + (verified.code || 'UNKNOWN'),
        verified
      );
    }

    meta.state = 'done';
    meta.finishedAt = now();
    meta.error = null;
    meta.counts = {
      sites: built.report.sites,
      favorites: built.report.favorites,
      visitsTotal: built.report.visitsTotal,
      lastUsedCount: built.report.lastUsedCount
    };

    var doneMeta = writeMeta(meta);
    if (!doneMeta.ok) {
      // 主数据已验证可用，只是状态没落盘：下次启动会把 writing + 有效数据提升为 done
      return {
        ok: true,
        metaPersisted: false,
        doc: built.doc,
        meta: meta,
        backupKey: key,
        report: built.report,
        warnings: (built.report.warnings || []).concat([
          makeIssue('META_COMMIT_FAILED', 'meta', '迁移状态写入失败，下次启动会自动补记')
        ])
      };
    }

    return {
      ok: true,
      metaPersisted: true,
      doc: built.doc,
      meta: meta,
      backupKey: key,
      report: built.report,
      warnings: built.report.warnings || []
    };
  }

  /**
   * 启动入口：判定当前处于首次运行 / 已迁移 / 迁移中 / 迁移失败，
   * 必要时执行迁移；迁移失败进入只读模式。
   */
  function init(options) {
    var opts = options || {};
    var at = isPositiveNumber(opts.now) ? opts.now : now();
    var seed = opts.seed || (isObject(root.STUDYHUB_DATA) ? root.STUDYHUB_DATA : null);
    var warnings = [];

    var metaRead = readMeta();
    if (!metaRead.ok) {
      return enterReadOnly('STORAGE_UNAVAILABLE', '无法读取本地存储：' + metaRead.code, null, null, warnings);
    }
    var meta = metaRead.value;
    if (metaRead.corrupt) {
      warnings.push(makeIssue('META_CORRUPT', 'meta', '迁移状态不是合法 JSON，已忽略'));
    }

    var data = readDoc();
    if (data.ok && data.warnings && data.warnings.length) {
      warnings = warnings.concat(data.warnings);
    }

    if (data.ok) {
      if (meta && meta.state === 'failed') {
        return enterReadOnly(
          (meta.error && meta.error.code) || 'MIGRATION_FAILED',
          (meta.error && meta.error.message) || '上次迁移失败',
          meta, data.doc, warnings
        );
      }
      if (meta && meta.state === 'writing') {
        // 只有 writing 才会写主数据：数据已校验通过，补记 done 是安全的
        meta.state = 'done';
        meta.finishedAt = at;
        meta.error = null;
        var promoted = writeMeta(meta);
        if (!promoted.ok) {
          warnings.push(makeIssue('META_PERSIST_FAILED', 'meta', '状态补记失败，下次启动会重试'));
        }
        warnings.push(makeIssue('MIGRATION_PROMOTED', 'meta', '检测到已完成但未收尾的迁移，已补记 done'));
        return enterNormal(data.doc, meta, {
          sourceVersion: meta.sourceVersion,
          backupKey: meta.backupKey,
          performed: false,
          promoted: true
        }, warnings);
      }
      if (meta && meta.state === 'backing-up') {
        // backing-up 阶段不可能写出主数据：这份有效数据无法归属，只读保护
        return enterReadOnly(
          'DATA_INVALID',
          '检测到无法归属的有效主数据（迁移停在备份阶段），已进入只读保护',
          meta, data.doc, warnings.concat([
            makeIssue('DATA_UNATTRIBUTED', 'data', '主数据有效但迁移状态为 backing-up，拒绝自动补记')
          ])
        );
      }
      return enterNormal(data.doc, meta, null, warnings);
    }

    if (meta && meta.state === 'failed') {
      return enterReadOnly(
        (meta.error && meta.error.code) || 'MIGRATION_FAILED',
        (meta.error && meta.error.message) || '上次迁移失败',
        meta, null, warnings
      );
    }

    if (meta && meta.state === 'done') {
      return enterReadOnly('DATA_INVALID', '已迁移的数据无法读取，已进入只读保护', meta, null, warnings);
    }

    var dataKey = readRaw(KEYS.data);
    if (!dataKey.ok) {
      return enterReadOnly('STORAGE_UNAVAILABLE', '无法读取主数据：' + dataKey.code, meta, null, warnings);
    }
    var hasDataKey = dataKey.raw !== null;

    // backing-up 阶段不可能写出主数据：出现任何主数据都视为无法归属，只读保护
    if (meta && meta.state === 'backing-up' && hasDataKey) {
      return enterReadOnly(
        'DATA_INVALID',
        '迁移停在备份阶段，但已存在主数据，无法确认数据归属，已进入只读保护',
        meta, null, warnings.concat([
          makeIssue('DATA_UNATTRIBUTED', 'data', 'backing-up 阶段出现主数据，拒绝自动清理')
        ])
      );
    }

    // 只有 writing 阶段才可能产生本次迁移的部分主数据：校验备份归属后才清理
    if (meta && meta.state === 'writing' && hasDataKey) {
      var backupKeyText = isString(meta.backupKey) ? meta.backupKey : '';
      var backupRead = backupKeyText ? readRaw(backupKeyText) : { ok: false };
      var sourceRead = readRaw(KEYS.legacy);
      var sourceRaw = sourceRead.ok && sourceRead.raw !== null ? sourceRead.raw : null;
      var backupVerified = backupRead.ok && backupRead.raw !== null &&
        sourceRead.ok && verifyBackup(meta, backupRead.raw, sourceRaw);

      if (!backupVerified) {
        return enterReadOnly(
          'DATA_INVALID',
          '无法证明无效主数据属于本次迁移，已保留数据并进入只读保护',
          meta, null, warnings.concat([
            makeIssue('DATA_UNATTRIBUTED', 'data', '备份归属校验未通过，拒绝清理主数据')
          ])
        );
      }

      var removed = removeRaw(KEYS.data);
      if (!removed.ok) {
        return enterReadOnly('DATA_CLEANUP_FAILED', '无法清理未完成的迁移数据：' + removed.code, meta, null, warnings);
      }
      warnings.push(makeIssue('PARTIAL_DATA_CLEANED', 'data', '已清理上次迁移中断留下的无效主数据'));
      hasDataKey = false;
    }

    // 存在无法归属的无效主数据：宁可只读，也不覆盖
    if (hasDataKey) {
      return enterReadOnly('DATA_INVALID', '检测到无法识别的本地主数据，已进入只读保护', meta, null, warnings);
    }

    var legacy = readRaw(KEYS.legacy);
    if (!legacy.ok) {
      return enterReadOnly('STORAGE_UNAVAILABLE', '无法读取旧数据：' + legacy.code, meta, null, warnings);
    }

    if (legacy.raw !== null) {
      var legacyVersion = null;
      try {
        legacyVersion = detectSourceVersion(JSON.parse(legacy.raw));
      } catch (err) {
        return enterReadOnly('LEGACY_CORRUPT', '旧数据不是合法 JSON，未做任何改动', meta, null, warnings);
      }
      if (legacyVersion === null || legacyVersion === 0) {
        return enterReadOnly('LEGACY_UNKNOWN', '无法识别的旧数据版本，未做任何改动', meta, null, warnings);
      }

      var result = performMigration(legacy.raw, legacyVersion, { now: at, seed: seed });
      if (!result.ok) {
        return enterReadOnly(result.code, result.message, result.meta, null,
          warnings.concat(result.warnings || []));
      }
      return enterNormal(result.doc, result.meta, {
        sourceVersion: legacyVersion,
        backupKey: result.backupKey,
        performed: true
      }, warnings.concat(result.warnings || []));
    }

    if (data.code === 'EMPTY') {
      // 首次运行：直接生成种子文档，写入失败只作为普通存储问题提示
      var fresh = createDoc(seed, { now: at });
      var freshMeta = {
        version: 1,
        state: 'done',
        source: 'none',
        sourceVersion: 0,
        backupKey: null,
        backupBytes: 0,
        backupChecksum: '',
        startedAt: at,
        finishedAt: at,
        backupVerifiedAt: null,
        appVersion: APP_VERSION,
        error: null,
        counts: summarize(fresh)
      };
      var freshWrite = writeVerified(fresh);
      if (!freshWrite.ok) {
        warnings.push(makeIssue('FIRST_RUN_WRITE_FAILED', 'data', '首次数据写入失败：' + (freshWrite.code || 'UNKNOWN')));
      } else {
        var freshMetaWrite = writeMeta(freshMeta);
        if (!freshMetaWrite.ok) {
          warnings.push(makeIssue('META_PERSIST_FAILED', 'meta', '首次运行状态写入失败'));
        }
      }
      return enterNormal(fresh, freshWrite.ok ? freshMeta : null, {
        sourceVersion: 0,
        backupKey: null,
        performed: false,
        firstRun: true
      }, warnings);
    }

    return enterReadOnly('DATA_INVALID', '本地数据损坏且没有可用的旧数据，已进入只读保护', meta, null, warnings);
  }

  /**
   * 只读模式下由用户触发重试：旧键仍在，重新完整走一遍状态机。
   */
  function retryMigration(options) {
    var opts = options || {};
    if (!session.readOnly) {
      return { ok: false, code: 'NOT_READONLY', message: '当前不在只读模式' };
    }
    if (session.doc) {
      // 已经有一份可用主数据：重试会覆盖它，必须由用户先导出/处理
      return {
        ok: false,
        code: 'DATA_PRESENT',
        message: '当前存在可用主数据，重试迁移会覆盖它，已拒绝'
      };
    }

    // 主数据键只要存在（内容可能无效），就拒绝自动重试：宁可让用户先处理，也不覆盖
    var existing = readRaw(KEYS.data);
    if (!existing.ok) {
      return { ok: false, code: existing.code, message: '无法检查主数据键：' + existing.code };
    }
    if (existing.raw !== null) {
      return {
        ok: false,
        code: 'DATA_PRESENT',
        message: '主数据键已存在（内容可能无效），请先导出或清理后再重试迁移'
      };
    }

    var legacy = readRaw(KEYS.legacy);
    if (!legacy.ok) { return { ok: false, code: legacy.code, message: legacy.message }; }
    if (legacy.raw === null) {
      return { ok: false, code: 'NO_SOURCE', message: '旧数据已不存在，无法重试迁移' };
    }

    var version = null;
    try {
      version = detectSourceVersion(JSON.parse(legacy.raw));
    } catch (err) {
      return { ok: false, code: 'LEGACY_CORRUPT', message: '旧数据不是合法 JSON' };
    }
    if (version === null || version === 0) {
      return { ok: false, code: 'LEGACY_UNKNOWN', message: '无法识别的旧数据版本' };
    }

    var at = isPositiveNumber(opts.now) ? opts.now : now();
    var seed = opts.seed || (isObject(root.STUDYHUB_DATA) ? root.STUDYHUB_DATA : null);
    var result = performMigration(legacy.raw, version, { now: at, seed: seed });

    if (!result.ok) {
      enterReadOnly(result.code, result.message, result.meta, null,
        (session.warnings || []).concat(result.warnings || []));
      return result;
    }

    enterNormal(result.doc, result.meta, {
      sourceVersion: version,
      backupKey: result.backupKey,
      performed: true
    }, (session.warnings || []).concat(result.warnings || []));
    return result;
  }

  /**
   * 正常保存入口：只读模式一律拒绝；普通存储失败只拒绝本次操作，
   * 不会把整个应用切成只读（与迁移期失败区分）。
   */
  function save(doc) {
    if (session.readOnly || session.mode === 'readonly') {
      return {
        ok: false,
        code: 'READONLY',
        message: '只读模式（' + (session.reason || 'MIGRATION_FAILED') + '），已拒绝写入'
      };
    }

    var check = validateDoc(doc);
    if (!check.ok) {
      return { ok: false, code: 'SCHEMA', errors: check.errors };
    }

    var next = clone(doc);
    next.updatedAt = now();

    var written = writeDoc(next);
    if (!written.ok) {
      return {
        ok: false,
        code: written.code,
        message: written.message || '写入本地存储失败',
        retryable: written.code === 'QUOTA'
      };
    }

    session.doc = next;
    return { ok: true, doc: next };
  }

  function getState() {
    return {
      mode: session.mode,
      readOnly: session.readOnly,
      reason: session.reason,
      message: session.message,
      doc: session.doc,
      meta: session.meta,
      migration: session.migration,
      warnings: session.warnings
    };
  }

  /* ============================================================== 导出 */

  SH.store = {
    stage: '1.3',
    SCHEMA_VERSION: SCHEMA_VERSION,
    APP_VERSION: APP_VERSION,
    KEYS: KEYS,
    LIMITS: LIMITS,
    THEMES: THEMES,
    SORTS: SORTS,
    ICON_SOURCES: ICON_SOURCES,
    DEFAULT_SETTINGS: clone(DEFAULT_SETTINGS),
    DEFAULT_ICON: DEFAULT_ICON,

    /* 结构与规则 */
    normalizeDoc: normalizeDoc,
    normalizeSite: normalizeSite,
    normalizeCategory: normalizeCategory,
    normalizeSettings: normalizeSettings,
    normalizeIcon: normalizeIcon,
    validateDoc: validateDoc,
    createDoc: createDoc,
    summarize: summarize,
    backupKey: backupKey,

    /* 版本迁移（纯函数） */
    buildV3: buildV3,
    validateV3: validateV3,
    detectSourceVersion: detectSourceVersion,

    /* 启动 / 迁移状态机 / 只读保护 */
    MIGRATION_STATES: MIGRATION_STATES,
    init: init,
    retryMigration: retryMigration,
    save: save,
    getState: getState,
    readMeta: readMeta,

    /* localStorage 原语 */
    readRaw: readRaw,
    writeRaw: writeRaw,
    removeRaw: removeRaw,
    readDoc: readDoc,
    writeDoc: writeDoc,
    writeVerified: writeVerified,
    resetStorageProbe: resetStorageProbe,

    /* 纯函数工具（app.js 后续复用） */
    util: {
      now: now,
      uid: uid,
      clone: clone,
      normalizeUrl: normalizeUrl,
      canonicalKey: canonicalKey,
      parseTags: parseTags,
      safeIcon: safeIcon,
      safeColor: safeColor,
      classifyError: classifyError,
      checksum: checksum,
      isObject: isObject
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
