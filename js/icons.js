/**
 * StudyHub · 图标图片仓库（IndexedDB）
 *
 * 设计说明：
 * - 只有「本地上传」的图片进入 IndexedDB，主数据 localStorage 里只保存 imageId；
 * - 数据库：studyhub-icons，版本 1，对象仓库 icons（keyPath: id）；
 * - 记录结构：{ id, blob, mime, width, height, size, createdAt }；
 * - 所有接口返回 Promise，失败时 reject 一个带 code 的 Error：
 *     UNAVAILABLE / BLOCKED / OPEN_FAILED / QUOTA / WRITE_FAILED / READ_FAILED / NOT_FOUND
 * - 任何失败都不会删除或改写别的记录；调用方负责决定是否回滚主数据。
 */
(function (root) {
  'use strict';

  var DB_NAME = 'studyhub-icons';
  var DB_VERSION = 1;
  var STORE_NAME = 'icons';

  var dbPromise = null;
  var support = null;
  var urls = {}; // imageId -> objectURL，避免重复创建导致内存泄漏

  function makeError(code, message, cause) {
    var err = new Error(message || code);
    err.code = code;
    if (cause) { err.cause = cause; }
    return err;
  }

  function classify(err) {
    if (!err) { return makeError('WRITE_FAILED'); }
    if (err.code === 'QUOTA' || err.name === 'QuotaExceededError') {
      return makeError('QUOTA', '本地图片存储空间不足');
    }
    if (err.name === 'SecurityError') {
      return makeError('BLOCKED', '浏览器不允许访问本地图片存储');
    }
    return err.code ? err : makeError('WRITE_FAILED', '本地图片存储失败', err);
  }

  function supported() {
    if (support !== null) { return support; }
    try {
      support = typeof root.indexedDB !== 'undefined' && !!root.indexedDB && typeof root.IDBKeyRange !== 'undefined';
    } catch (err) {
      support = false;
    }
    return support;
  }

  function open() {
    if (!supported()) {
      return Promise.reject(makeError('UNAVAILABLE', '当前浏览器不支持 IndexedDB'));
    }
    if (dbPromise) { return dbPromise; }

    dbPromise = new Promise(function (resolve, reject) {
      var req;
      try {
        req = root.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        dbPromise = null;
        reject(makeError('OPEN_FAILED', '无法打开本地图片存储', err));
        return;
      }
      var settled = false;
      var timer = root.setTimeout(function () {
        if (settled) { return; }
        settled = true;
        dbPromise = null;
        reject(makeError('BLOCKED', '本地图片存储被占用，请关闭其他页面后重试'));
      }, 4000);

      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () {
        if (settled) { return; }
        settled = true;
        root.clearTimeout(timer);
        var db = req.result;
        db.onversionchange = function () { try { db.close(); } catch (err) {} dbPromise = null; };
        resolve(db);
      };
      req.onerror = function () {
        if (settled) { return; }
        settled = true;
        root.clearTimeout(timer);
        dbPromise = null;
        reject(classify(req.error) || makeError('OPEN_FAILED', '无法打开本地图片存储'));
      };
      req.onblocked = function () {
        if (settled) { return; }
        settled = true;
        root.clearTimeout(timer);
        dbPromise = null;
        reject(makeError('BLOCKED', '本地图片存储被其他标签页占用'));
      };
    });

    dbPromise.catch(function () { dbPromise = null; });
    return dbPromise;
  }

  function tx(mode, run) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction;
        try {
          transaction = db.transaction(STORE_NAME, mode);
        } catch (err) {
          reject(classify(err));
          return;
        }
        var store = transaction.objectStore(STORE_NAME);
        var request;
        try {
          request = run(store);
        } catch (err) {
          reject(classify(err));
          return;
        }
        transaction.oncomplete = function () { resolve(request && request.result); };
        transaction.onabort = function () { reject(classify(transaction.error)); };
        transaction.onerror = function () { /* onabort 会接管 */ };
        if (!request) { resolve(undefined); }
      });
    });
  }

  /** 写入一张压缩后的图片文件 */
  function put(id, blob, info) {
    if (!id || !blob) { return Promise.reject(makeError('WRITE_FAILED', '缺少图片数据')); }
    var record = {
      id: String(id),
      blob: blob,
      mime: blob.type || (info && info.mime) || 'image/webp',
      width: (info && info.width) || 0,
      height: (info && info.height) || 0,
      size: blob.size || 0,
      createdAt: Date.now()
    };
    return tx('readwrite', function (store) {
      return store.put(record);
    }).catch(function (err) { throw classify(err); });
  }

  function get(id) {
    return tx('readonly', function (store) {
      return store.get(String(id));
    }).then(function (record) {
      if (!record || !record.blob) { throw makeError('NOT_FOUND', '找不到本地图片'); }
      return record;
    });
  }

  function has(id) {
    return get(id).then(function () { return true; }, function (err) {
      if (err && err.code === 'NOT_FOUND') { return false; }
      throw err;
    });
  }

  function remove(id) {
    return tx('readwrite', function (store) {
      return store.delete(String(id));
    }).then(function () {
      revoke(id);
    });
  }

  function removeMany(ids) {
    var list = (ids || []).filter(Boolean);
    if (!list.length) { return Promise.resolve(); }
    return tx('readwrite', function (store) {
      list.forEach(function (id) { store.delete(String(id)); });
      return null;
    }).then(function () {
      list.forEach(revoke);
    });
  }

  /** 列出所有记录（只读诊断/未来备份用） */
  function list() {
    return tx('readonly', function (store) {
      return store.getAll();
    }).then(function (records) {
      return (records || []).map(function (record) {
        return {
          id: record.id,
          mime: record.mime,
          width: record.width,
          height: record.height,
          size: record.size,
          createdAt: record.createdAt
        };
      });
    });
  }

  function count() {
    return tx('readonly', function (store) {
      return store.count();
    });
  }

  /** 返回可直接用于 <img src> 的对象 URL（按 imageId 缓存） */
  function objectUrl(id) {
    var key = String(id);
    if (urls[key]) { return Promise.resolve(urls[key]); }
    return get(key).then(function (record) {
      if (urls[key]) { return urls[key]; }
      var url = root.URL.createObjectURL(record.blob);
      urls[key] = url;
      return url;
    });
  }

  function revoke(id) {
    var key = String(id);
    if (urls[key]) {
      try { root.URL.revokeObjectURL(urls[key]); } catch (err) {}
      delete urls[key];
    }
  }

  function revokeAll() {
    Object.keys(urls).forEach(function (key) {
      try { root.URL.revokeObjectURL(urls[key]); } catch (err) {}
      delete urls[key];
    });
  }

  root.SH = root.SH || {};
  root.SH.icons = {
    DB_NAME: DB_NAME,
    STORE_NAME: STORE_NAME,
    supported: supported,
    open: open,
    put: put,
    get: get,
    has: has,
    remove: remove,
    removeMany: removeMany,
    list: list,
    count: count,
    objectUrl: objectUrl,
    revoke: revoke,
    revokeAll: revokeAll
  };
})(typeof window !== 'undefined' ? window : globalThis);
