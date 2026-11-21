export const RPC_SHIM_SOURCE = `
window.google = window.google || {};
window.google.script = window.google.script || {};

var __optimiaRpcState = { ok: null, fail: null };
var __optimiaRpcRunner = new Proxy({}, {
  get: function (_target, method) {
    if (method === 'withSuccessHandler') {
      return function (fn) { __optimiaRpcState.ok = fn; return __optimiaRpcRunner; };
    }
    if (method === 'withFailureHandler') {
      return function (fn) { __optimiaRpcState.fail = fn; return __optimiaRpcRunner; };
    }
    return function () {
      var params = Array.prototype.slice.call(arguments);
      var ctx = __optimiaRpcState;
      __optimiaRpcState = { ok: null, fail: null };

      if (method === 'getView') {
        var rutas = { home: '/', abiertos: '/abiertos', config: '/config' };
        window.location.href = rutas[params[0]] || '/';
        return;
      }

      setTimeout(function () {
        fetch('/api/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: method, params: params })
        })
          .then(function (res) {
            return res.json().then(function (body) {
              if (!res.ok || body.error) {
                throw new Error(body.error || ('HTTP ' + res.status));
              }
              return body.result;
            });
          })
          .then(function (result) { if (ctx.ok) ctx.ok(result); })
          .catch(function (err) {
            if (ctx.fail) ctx.fail(err);
            else console.error(err);
          });
      }, 0);
    };
  }
});

window.google.script.run = __optimiaRpcRunner;
`;
