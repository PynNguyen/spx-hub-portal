/**
 * ============================================================
 * SPX HUB TRANSPARENT RPC BRIDGE
 * Cầu nối trong suốt thay thế hoàn toàn google.script.run
 * Giữ nguyên 100% mã nguồn giao diện HTML gốc của dự án.
 * ============================================================
 */

(function () {
  'use strict';

  console.log('⚡ [SPX Bridge] Initializing Multi-User RPC Bridge...');

  // Xoá sạch IndexedDB cache cũ một lần duy nhất nếu phiên bản trước bị dính UI lỗi
  try {
    if (typeof indexedDB !== 'undefined') {
      if (localStorage.getItem('spx_clean_v2_synced') !== 'true') {
        indexedDB.deleteDatabase('spx_modcache_v1');
        localStorage.setItem('spx_clean_v2_synced', 'true');
        console.log('🧹 [SPX Bridge] Flushed previous UI cache successfully.');
      }
    }
  } catch (e) {}

    // Tự động thiết lập trạm mặc định nếu chưa chọn hoặc bị lỗi encoding
  try {
    var curHub = localStorage.getItem('spx_default_hub');
    if (!curHub || curHub === 'Chưa chọn Hub' || curHub.includes('KrA') || curHub.includes('?')) {
      localStorage.setItem('spx_default_hub', '45-DLK Krong Pak 02 Hub');
      localStorage.setItem('SPX_selectedHub', '45-DLK Krong Pak 02 Hub');
    }
  } catch (e) {}

  var currentUserEmail = (window.__SPX_CURRENT_USER__ && window.__SPX_CURRENT_USER__.email) || localStorage.getItem('spx_current_user_email') || localStorage.getItem('spx_user_email') || 'xuan.nguyenthanh01@spxexpress.com';
  var currentUserName = (window.__SPX_CURRENT_USER__ && window.__SPX_CURRENT_USER__.name) || localStorage.getItem('spx_user_name') || 'Admin Xuân';

  window.SPX_LOCAL_ENV = {
    isLocal: true,
    serverUrl: window.location.origin,
    userEmail: currentUserEmail,
    userName: currentUserName
  };

  /**
   * Tạo một RPC Runner bất biến (immutable) để hỗ trợ gọi chuỗi bất đồng bộ:
   * google.script.run.withSuccessHandler(fn).withFailureHandler(fn).serverMethod(...args)
   */
  function createRpcRunner(state) {
    var s = (state && state.s) || null;
    var f = (state && state.f) || null;
    var u = (state && state.u) || null;

    var runner = {
      withSuccessHandler: function (fn) {
        return createRpcRunner({ s: fn, f: f, u: u });
      },
      withFailureHandler: function (fn) {
        return createRpcRunner({ s: s, f: fn, u: u });
      },
      withUserObject: function (obj) {
        return createRpcRunner({ s: s, f: f, u: obj });
      }
    };

    return new Proxy(runner, {
      get: function (target, prop) {
        if (prop in target) {
          return target[prop];
        }

        if (typeof prop !== 'string' || prop === 'then') {
          return undefined;
        }

        return function () {
          var args = Array.prototype.slice.call(arguments);
          var startTime = performance.now();

          fetch('/api/rpc/' + encodeURIComponent(prop), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-SPX-User-Email': currentUserEmail
            },
            body: JSON.stringify({ args: args, user: currentUserEmail })
          })
            .then(function (res) {
              if (!res.ok) {
                throw new Error('HTTP ' + res.status + ' ' + res.statusText);
              }
              return res.json();
            })
            .then(function (data) {
              var duration = (performance.now() - startTime).toFixed(1);
              if (data && data.error) {
                if (f) {
                  f(new Error(data.error), u);
                } else {
                  console.error('[RPC ERROR] ' + prop + ':', data.error);
                }
              } else {
                if (s) {
                  try {
                    s(data ? data.result : null, u);
                  } catch (cbErr) {
                    console.error('[RPC Callback Error in ' + prop + ']:', cbErr);
                  }
                }
              }
            })
            .catch(function (err) {
              var duration = (performance.now() - startTime).toFixed(1);
              console.error('[RPC FAIL] ' + prop + ' failed after ' + duration + 'ms:', err);
              if (f) {
                f(err, u);
              }
            });
        };
      }
    });
  }

  // Khởi tạo đối tượng window.google.script.run
  window.google = window.google || {};
  window.google.script = window.google.script || {};

  Object.defineProperty(window.google.script, 'run', {
    get: function () {
      return createRpcRunner();
    },
    configurable: true
  });

  window.google.script.host = window.google.script.host || {
    close: function () { window.close(); },
    setHeight: function () {},
    setWidth: function () {},
    editor: { focus: function () {} }
  };

  window.google.script.url = window.google.script.url || {
    getLocation: function (cb) {
      if (cb) {
        var params = {};
        var searchParams = new URLSearchParams(window.location.search);
        searchParams.forEach(function (val, key) {
          params[key] = val;
        });
        cb({
          hash: window.location.hash.replace(/^#/, ''),
          parameter: params,
          parameters: params
        });
      }
    }
  };

  console.log('✅ [SPX Bridge] google.script.run is fully ready!');
})();
