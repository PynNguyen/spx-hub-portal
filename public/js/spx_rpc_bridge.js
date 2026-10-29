/**
 * ============================================================
 * SPX HUB TRANSPARENT RPC BRIDGE
 * Cầu nối trong suốt thay thế hoàn toàn google.script.run
 * Giữ nguyên 100% mã nguồn giao diện HTML của toàn bộ dự án.
 * ============================================================
 */

(function () {
  'use strict';

  console.log('⚡ [SPX Bridge] Initializing Local Multi-User RPC Bridge...');

  // Thông tin phiên người dùng hiện tại
  var currentUserEmail = localStorage.getItem('spx_user_email') || 'xuan.nguyenthanh01@spxexpress.com';
  var currentUserName = localStorage.getItem('spx_user_name') || 'Admin Xuân - Krông Pắc 02';

  window.SPX_LOCAL_ENV = {
    isLocal: true,
    serverUrl: window.location.origin,
    userEmail: currentUserEmail,
    userName: currentUserName
  };

  function createRpcRunner() {
    var _successCb = null;
    var _failureCb = null;
    var _userObject = null;
    var proxyInstance = null;

    var runner = {
      withSuccessHandler: function (fn) {
        _successCb = fn;
        return proxyInstance;
      },
      withFailureHandler: function (fn) {
        _failureCb = fn;
        return proxyInstance;
      },
      withUserObject: function (obj) {
        _userObject = obj;
        return proxyInstance;
      }
    };

    // Proxy bắt mọi tên hàm được gọi: google.script.run.functionName(...args)
    proxyInstance = new Proxy(runner, {

      get: function (target, prop) {
        if (prop in target) {
          return target[prop];
        }

        // prop chính là tên hàm backend được gọi (ví dụ: getStationData, saveStationData, getOrders...)
        return function (...args) {
          var startTime = performance.now();
          // Gửi request tới Node.js Local Server
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
              console.log(`[RPC ⚡] ${prop} finished in ${duration}ms`, data);
              if (data && data.error) {
                if (_failureCb) {
                  _failureCb(new Error(data.error), _userObject);
                } else {
                  console.error(`[RPC ERROR] ${prop}:`, data.error);
                }
              } else {
                if (_successCb) {
                  _successCb(data.result, _userObject);
                }
              }
            })
            .catch(function (err) {
              var duration = (performance.now() - startTime).toFixed(1);
              console.error(`[RPC FAIL ❌] ${prop} failed after ${duration}ms:`, err);
              if (_failureCb) {
                _failureCb(err, _userObject);
              }
            });
        };
      }
    });
  }

  // Khởi tạo window.google.script.run
  window.google = window.google || {};
  window.google.script = window.google.script || {};

  Object.defineProperty(window.google.script, 'run', {
    get: function () {
      return createRpcRunner();
    },
    configurable: true
  });

  // Mock google.script.host và google.script.url
  window.google.script.host = window.google.script.host || {
    close: function () {
      window.close();
    },
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

  console.log('✅ [SPX Bridge] google.script.run is fully proxied to Node.js backend!');
})();
