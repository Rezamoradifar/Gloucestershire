var yt = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : {};
function Cu(t) {
  return t && t.__esModule && Object.prototype.hasOwnProperty.call(t, "default") ? t.default : t;
}
function Nu(t) {
  if (Object.prototype.hasOwnProperty.call(t, "__esModule")) return t;
  var e = t.default;
  if (typeof e == "function") {
    var r = function s() {
      return this instanceof s ? Reflect.construct(e, arguments, this.constructor) : e.apply(this, arguments);
    };
    r.prototype = e.prototype;
  } else r = {};
  return Object.defineProperty(r, "__esModule", { value: !0 }), Object.keys(t).forEach(function(s) {
    var n = Object.getOwnPropertyDescriptor(t, s);
    Object.defineProperty(r, s, n.get ? n : {
      enumerable: !0,
      get: function() {
        return t[s];
      }
    });
  }), r;
}
var Ws = { exports: {} }, Xa;
function fp() {
  if (Xa) return Ws.exports;
  Xa = 1;
  var t = typeof Reflect == "object" ? Reflect : null, e = t && typeof t.apply == "function" ? t.apply : function(x, I, P) {
    return Function.prototype.apply.call(x, I, P);
  }, r;
  t && typeof t.ownKeys == "function" ? r = t.ownKeys : Object.getOwnPropertySymbols ? r = function(x) {
    return Object.getOwnPropertyNames(x).concat(Object.getOwnPropertySymbols(x));
  } : r = function(x) {
    return Object.getOwnPropertyNames(x);
  };
  function s(v) {
    console && console.warn && console.warn(v);
  }
  var n = Number.isNaN || function(x) {
    return x !== x;
  };
  function i() {
    i.init.call(this);
  }
  Ws.exports = i, Ws.exports.once = E, i.EventEmitter = i, i.prototype._events = void 0, i.prototype._eventsCount = 0, i.prototype._maxListeners = void 0;
  var o = 10;
  function a(v) {
    if (typeof v != "function")
      throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof v);
  }
  Object.defineProperty(i, "defaultMaxListeners", {
    enumerable: !0,
    get: function() {
      return o;
    },
    set: function(v) {
      if (typeof v != "number" || v < 0 || n(v))
        throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + v + ".");
      o = v;
    }
  }), i.init = function() {
    (this._events === void 0 || this._events === Object.getPrototypeOf(this)._events) && (this._events = /* @__PURE__ */ Object.create(null), this._eventsCount = 0), this._maxListeners = this._maxListeners || void 0;
  }, i.prototype.setMaxListeners = function(x) {
    if (typeof x != "number" || x < 0 || n(x))
      throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + x + ".");
    return this._maxListeners = x, this;
  };
  function c(v) {
    return v._maxListeners === void 0 ? i.defaultMaxListeners : v._maxListeners;
  }
  i.prototype.getMaxListeners = function() {
    return c(this);
  }, i.prototype.emit = function(x) {
    for (var I = [], P = 1; P < arguments.length; P++) I.push(arguments[P]);
    var B = x === "error", T = this._events;
    if (T !== void 0)
      B = B && T.error === void 0;
    else if (!B)
      return !1;
    if (B) {
      var L;
      if (I.length > 0 && (L = I[0]), L instanceof Error)
        throw L;
      var U = new Error("Unhandled error." + (L ? " (" + L.message + ")" : ""));
      throw U.context = L, U;
    }
    var N = T[x];
    if (N === void 0)
      return !1;
    if (typeof N == "function")
      e(N, this, I);
    else
      for (var A = N.length, R = p(N, A), P = 0; P < A; ++P)
        e(R[P], this, I);
    return !0;
  };
  function l(v, x, I, P) {
    var B, T, L;
    if (a(I), T = v._events, T === void 0 ? (T = v._events = /* @__PURE__ */ Object.create(null), v._eventsCount = 0) : (T.newListener !== void 0 && (v.emit(
      "newListener",
      x,
      I.listener ? I.listener : I
    ), T = v._events), L = T[x]), L === void 0)
      L = T[x] = I, ++v._eventsCount;
    else if (typeof L == "function" ? L = T[x] = P ? [I, L] : [L, I] : P ? L.unshift(I) : L.push(I), B = c(v), B > 0 && L.length > B && !L.warned) {
      L.warned = !0;
      var U = new Error("Possible EventEmitter memory leak detected. " + L.length + " " + String(x) + " listeners added. Use emitter.setMaxListeners() to increase limit");
      U.name = "MaxListenersExceededWarning", U.emitter = v, U.type = x, U.count = L.length, s(U);
    }
    return v;
  }
  i.prototype.addListener = function(x, I) {
    return l(this, x, I, !1);
  }, i.prototype.on = i.prototype.addListener, i.prototype.prependListener = function(x, I) {
    return l(this, x, I, !0);
  };
  function u() {
    if (!this.fired)
      return this.target.removeListener(this.type, this.wrapFn), this.fired = !0, arguments.length === 0 ? this.listener.call(this.target) : this.listener.apply(this.target, arguments);
  }
  function h(v, x, I) {
    var P = { fired: !1, wrapFn: void 0, target: v, type: x, listener: I }, B = u.bind(P);
    return B.listener = I, P.wrapFn = B, B;
  }
  i.prototype.once = function(x, I) {
    return a(I), this.on(x, h(this, x, I)), this;
  }, i.prototype.prependOnceListener = function(x, I) {
    return a(I), this.prependListener(x, h(this, x, I)), this;
  }, i.prototype.removeListener = function(x, I) {
    var P, B, T, L, U;
    if (a(I), B = this._events, B === void 0)
      return this;
    if (P = B[x], P === void 0)
      return this;
    if (P === I || P.listener === I)
      --this._eventsCount === 0 ? this._events = /* @__PURE__ */ Object.create(null) : (delete B[x], B.removeListener && this.emit("removeListener", x, P.listener || I));
    else if (typeof P != "function") {
      for (T = -1, L = P.length - 1; L >= 0; L--)
        if (P[L] === I || P[L].listener === I) {
          U = P[L].listener, T = L;
          break;
        }
      if (T < 0)
        return this;
      T === 0 ? P.shift() : y(P, T), P.length === 1 && (B[x] = P[0]), B.removeListener !== void 0 && this.emit("removeListener", x, U || I);
    }
    return this;
  }, i.prototype.off = i.prototype.removeListener, i.prototype.removeAllListeners = function(x) {
    var I, P, B;
    if (P = this._events, P === void 0)
      return this;
    if (P.removeListener === void 0)
      return arguments.length === 0 ? (this._events = /* @__PURE__ */ Object.create(null), this._eventsCount = 0) : P[x] !== void 0 && (--this._eventsCount === 0 ? this._events = /* @__PURE__ */ Object.create(null) : delete P[x]), this;
    if (arguments.length === 0) {
      var T = Object.keys(P), L;
      for (B = 0; B < T.length; ++B)
        L = T[B], L !== "removeListener" && this.removeAllListeners(L);
      return this.removeAllListeners("removeListener"), this._events = /* @__PURE__ */ Object.create(null), this._eventsCount = 0, this;
    }
    if (I = P[x], typeof I == "function")
      this.removeListener(x, I);
    else if (I !== void 0)
      for (B = I.length - 1; B >= 0; B--)
        this.removeListener(x, I[B]);
    return this;
  };
  function f(v, x, I) {
    var P = v._events;
    if (P === void 0)
      return [];
    var B = P[x];
    return B === void 0 ? [] : typeof B == "function" ? I ? [B.listener || B] : [B] : I ? m(B) : p(B, B.length);
  }
  i.prototype.listeners = function(x) {
    return f(this, x, !0);
  }, i.prototype.rawListeners = function(x) {
    return f(this, x, !1);
  }, i.listenerCount = function(v, x) {
    return typeof v.listenerCount == "function" ? v.listenerCount(x) : g.call(v, x);
  }, i.prototype.listenerCount = g;
  function g(v) {
    var x = this._events;
    if (x !== void 0) {
      var I = x[v];
      if (typeof I == "function")
        return 1;
      if (I !== void 0)
        return I.length;
    }
    return 0;
  }
  i.prototype.eventNames = function() {
    return this._eventsCount > 0 ? r(this._events) : [];
  };
  function p(v, x) {
    for (var I = new Array(x), P = 0; P < x; ++P)
      I[P] = v[P];
    return I;
  }
  function y(v, x) {
    for (; x + 1 < v.length; x++)
      v[x] = v[x + 1];
    v.pop();
  }
  function m(v) {
    for (var x = new Array(v.length), I = 0; I < x.length; ++I)
      x[I] = v[I].listener || v[I];
    return x;
  }
  function E(v, x) {
    return new Promise(function(I, P) {
      function B(L) {
        v.removeListener(x, T), P(L);
      }
      function T() {
        typeof v.removeListener == "function" && v.removeListener("error", B), I([].slice.call(arguments));
      }
      b(v, x, T, { once: !0 }), x !== "error" && $(v, B, { once: !0 });
    });
  }
  function $(v, x, I) {
    typeof v.on == "function" && b(v, "error", x, I);
  }
  function b(v, x, I, P) {
    if (typeof v.on == "function")
      P.once ? v.once(x, I) : v.on(x, I);
    else if (typeof v.addEventListener == "function")
      v.addEventListener(x, function B(T) {
        P.once && v.removeEventListener(x, B), I(T);
      });
    else
      throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type ' + typeof v);
  }
  return Ws.exports;
}
var je = fp();
const ea = /* @__PURE__ */ Cu(je);
var Ja = function(t, e, r) {
  if (r || arguments.length === 2) for (var s = 0, n = e.length, i; s < n; s++)
    (i || !(s in e)) && (i || (i = Array.prototype.slice.call(e, 0, s)), i[s] = e[s]);
  return t.concat(i || Array.prototype.slice.call(e));
}, dp = (
  /** @class */
  /* @__PURE__ */ (function() {
    function t(e, r, s) {
      this.name = e, this.version = r, this.os = s, this.type = "browser";
    }
    return t;
  })()
), pp = (
  /** @class */
  /* @__PURE__ */ (function() {
    function t(e) {
      this.version = e, this.type = "node", this.name = "node", this.os = process.platform;
    }
    return t;
  })()
), gp = (
  /** @class */
  /* @__PURE__ */ (function() {
    function t(e, r, s, n) {
      this.name = e, this.version = r, this.os = s, this.bot = n, this.type = "bot-device";
    }
    return t;
  })()
), yp = (
  /** @class */
  /* @__PURE__ */ (function() {
    function t() {
      this.type = "bot", this.bot = !0, this.name = "bot", this.version = null, this.os = null;
    }
    return t;
  })()
), wp = (
  /** @class */
  /* @__PURE__ */ (function() {
    function t() {
      this.type = "react-native", this.name = "react-native", this.version = null, this.os = null;
    }
    return t;
  })()
), mp = /alexa|bot|crawl(er|ing)|facebookexternalhit|feedburner|google web preview|nagios|postrank|pingdom|slurp|spider|yahoo!|yandex/, bp = /(nuhk|curl|Googlebot|Yammybot|Openbot|Slurp|MSNBot|Ask\ Jeeves\/Teoma|ia_archiver)/, Qa = 3, vp = [
  ["aol", /AOLShield\/([0-9\._]+)/],
  ["edge", /Edge\/([0-9\._]+)/],
  ["edge-ios", /EdgiOS\/([0-9\._]+)/],
  ["yandexbrowser", /YaBrowser\/([0-9\._]+)/],
  ["kakaotalk", /KAKAOTALK\s([0-9\.]+)/],
  ["samsung", /SamsungBrowser\/([0-9\.]+)/],
  ["silk", /\bSilk\/([0-9._-]+)\b/],
  ["miui", /MiuiBrowser\/([0-9\.]+)$/],
  ["beaker", /BeakerBrowser\/([0-9\.]+)/],
  ["edge-chromium", /EdgA?\/([0-9\.]+)/],
  [
    "chromium-webview",
    /(?!Chrom.*OPR)wv\).*Chrom(?:e|ium)\/([0-9\.]+)(:?\s|$)/
  ],
  ["chrome", /(?!Chrom.*OPR)Chrom(?:e|ium)\/([0-9\.]+)(:?\s|$)/],
  ["phantomjs", /PhantomJS\/([0-9\.]+)(:?\s|$)/],
  ["crios", /CriOS\/([0-9\.]+)(:?\s|$)/],
  ["firefox", /Firefox\/([0-9\.]+)(?:\s|$)/],
  ["fxios", /FxiOS\/([0-9\.]+)/],
  ["opera-mini", /Opera Mini.*Version\/([0-9\.]+)/],
  ["opera", /Opera\/([0-9\.]+)(?:\s|$)/],
  ["opera", /OPR\/([0-9\.]+)(:?\s|$)/],
  ["pie", /^Microsoft Pocket Internet Explorer\/(\d+\.\d+)$/],
  ["pie", /^Mozilla\/\d\.\d+\s\(compatible;\s(?:MSP?IE|MSInternet Explorer) (\d+\.\d+);.*Windows CE.*\)$/],
  ["netfront", /^Mozilla\/\d\.\d+.*NetFront\/(\d.\d)/],
  ["ie", /Trident\/7\.0.*rv\:([0-9\.]+).*\).*Gecko$/],
  ["ie", /MSIE\s([0-9\.]+);.*Trident\/[4-7].0/],
  ["ie", /MSIE\s(7\.0)/],
  ["bb10", /BB10;\sTouch.*Version\/([0-9\.]+)/],
  ["android", /Android\s([0-9\.]+)/],
  ["ios", /Version\/([0-9\._]+).*Mobile.*Safari.*/],
  ["safari", /Version\/([0-9\._]+).*Safari/],
  ["facebook", /FB[AS]V\/([0-9\.]+)/],
  ["instagram", /Instagram\s([0-9\.]+)/],
  ["ios-webview", /AppleWebKit\/([0-9\.]+).*Mobile/],
  ["ios-webview", /AppleWebKit\/([0-9\.]+).*Gecko\)$/],
  ["curl", /^curl\/([0-9\.]+)$/],
  ["searchbot", mp]
], ec = [
  ["iOS", /iP(hone|od|ad)/],
  ["Android OS", /Android/],
  ["BlackBerry OS", /BlackBerry|BB10/],
  ["Windows Mobile", /IEMobile/],
  ["Amazon OS", /Kindle/],
  ["Windows 3.11", /Win16/],
  ["Windows 95", /(Windows 95)|(Win95)|(Windows_95)/],
  ["Windows 98", /(Windows 98)|(Win98)/],
  ["Windows 2000", /(Windows NT 5.0)|(Windows 2000)/],
  ["Windows XP", /(Windows NT 5.1)|(Windows XP)/],
  ["Windows Server 2003", /(Windows NT 5.2)/],
  ["Windows Vista", /(Windows NT 6.0)/],
  ["Windows 7", /(Windows NT 6.1)/],
  ["Windows 8", /(Windows NT 6.2)/],
  ["Windows 8.1", /(Windows NT 6.3)/],
  ["Windows 10", /(Windows NT 10.0)/],
  ["Windows ME", /Windows ME/],
  ["Windows CE", /Windows CE|WinCE|Microsoft Pocket Internet Explorer/],
  ["Open BSD", /OpenBSD/],
  ["Sun OS", /SunOS/],
  ["Chrome OS", /CrOS/],
  ["Linux", /(Linux)|(X11)/],
  ["Mac OS", /(Mac_PowerPC)|(Macintosh)/],
  ["QNX", /QNX/],
  ["BeOS", /BeOS/],
  ["OS/2", /OS\/2/]
];
function Ep(t) {
  return typeof document > "u" && typeof navigator < "u" && navigator.product === "ReactNative" ? new wp() : typeof navigator < "u" ? _p(navigator.userAgent) : Ip();
}
function xp(t) {
  return t !== "" && vp.reduce(function(e, r) {
    var s = r[0], n = r[1];
    if (e)
      return e;
    var i = n.exec(t);
    return !!i && [s, i];
  }, !1);
}
function _p(t) {
  var e = xp(t);
  if (!e)
    return null;
  var r = e[0], s = e[1];
  if (r === "searchbot")
    return new yp();
  var n = s[1] && s[1].split(".").join("_").split("_").slice(0, 3);
  n ? n.length < Qa && (n = Ja(Ja([], n, !0), Dp(Qa - n.length), !0)) : n = [];
  var i = n.join("."), o = Sp(t), a = bp.exec(t);
  return a && a[1] ? new gp(r, i, o, a[1]) : new dp(r, i, o);
}
function Sp(t) {
  for (var e = 0, r = ec.length; e < r; e++) {
    var s = ec[e], n = s[0], i = s[1], o = i.exec(t);
    if (o)
      return n;
  }
  return null;
}
function Ip() {
  var t = typeof process < "u" && process.version;
  return t ? new pp(process.version.slice(1)) : null;
}
function Dp(t) {
  for (var e = [], r = 0; r < t; r++)
    e.push("0");
  return e;
}
var fi = {};
/*! *****************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
var go = function(t, e) {
  return go = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(r, s) {
    r.__proto__ = s;
  } || function(r, s) {
    for (var n in s) s.hasOwnProperty(n) && (r[n] = s[n]);
  }, go(t, e);
};
function Ap(t, e) {
  go(t, e);
  function r() {
    this.constructor = t;
  }
  t.prototype = e === null ? Object.create(e) : (r.prototype = e.prototype, new r());
}
var yo = function() {
  return yo = Object.assign || function(e) {
    for (var r, s = 1, n = arguments.length; s < n; s++) {
      r = arguments[s];
      for (var i in r) Object.prototype.hasOwnProperty.call(r, i) && (e[i] = r[i]);
    }
    return e;
  }, yo.apply(this, arguments);
};
function Op(t, e) {
  var r = {};
  for (var s in t) Object.prototype.hasOwnProperty.call(t, s) && e.indexOf(s) < 0 && (r[s] = t[s]);
  if (t != null && typeof Object.getOwnPropertySymbols == "function")
    for (var n = 0, s = Object.getOwnPropertySymbols(t); n < s.length; n++)
      e.indexOf(s[n]) < 0 && Object.prototype.propertyIsEnumerable.call(t, s[n]) && (r[s[n]] = t[s[n]]);
  return r;
}
function $p(t, e, r, s) {
  var n = arguments.length, i = n < 3 ? e : s === null ? s = Object.getOwnPropertyDescriptor(e, r) : s, o;
  if (typeof Reflect == "object" && typeof Reflect.decorate == "function") i = Reflect.decorate(t, e, r, s);
  else for (var a = t.length - 1; a >= 0; a--) (o = t[a]) && (i = (n < 3 ? o(i) : n > 3 ? o(e, r, i) : o(e, r)) || i);
  return n > 3 && i && Object.defineProperty(e, r, i), i;
}
function Pp(t, e) {
  return function(r, s) {
    e(r, s, t);
  };
}
function Tp(t, e) {
  if (typeof Reflect == "object" && typeof Reflect.metadata == "function") return Reflect.metadata(t, e);
}
function Bp(t, e, r, s) {
  function n(i) {
    return i instanceof r ? i : new r(function(o) {
      o(i);
    });
  }
  return new (r || (r = Promise))(function(i, o) {
    function a(u) {
      try {
        l(s.next(u));
      } catch (h) {
        o(h);
      }
    }
    function c(u) {
      try {
        l(s.throw(u));
      } catch (h) {
        o(h);
      }
    }
    function l(u) {
      u.done ? i(u.value) : n(u.value).then(a, c);
    }
    l((s = s.apply(t, e || [])).next());
  });
}
function Rp(t, e) {
  var r = { label: 0, sent: function() {
    if (i[0] & 1) throw i[1];
    return i[1];
  }, trys: [], ops: [] }, s, n, i, o;
  return o = { next: a(0), throw: a(1), return: a(2) }, typeof Symbol == "function" && (o[Symbol.iterator] = function() {
    return this;
  }), o;
  function a(l) {
    return function(u) {
      return c([l, u]);
    };
  }
  function c(l) {
    if (s) throw new TypeError("Generator is already executing.");
    for (; r; ) try {
      if (s = 1, n && (i = l[0] & 2 ? n.return : l[0] ? n.throw || ((i = n.return) && i.call(n), 0) : n.next) && !(i = i.call(n, l[1])).done) return i;
      switch (n = 0, i && (l = [l[0] & 2, i.value]), l[0]) {
        case 0:
        case 1:
          i = l;
          break;
        case 4:
          return r.label++, { value: l[1], done: !1 };
        case 5:
          r.label++, n = l[1], l = [0];
          continue;
        case 7:
          l = r.ops.pop(), r.trys.pop();
          continue;
        default:
          if (i = r.trys, !(i = i.length > 0 && i[i.length - 1]) && (l[0] === 6 || l[0] === 2)) {
            r = 0;
            continue;
          }
          if (l[0] === 3 && (!i || l[1] > i[0] && l[1] < i[3])) {
            r.label = l[1];
            break;
          }
          if (l[0] === 6 && r.label < i[1]) {
            r.label = i[1], i = l;
            break;
          }
          if (i && r.label < i[2]) {
            r.label = i[2], r.ops.push(l);
            break;
          }
          i[2] && r.ops.pop(), r.trys.pop();
          continue;
      }
      l = e.call(t, r);
    } catch (u) {
      l = [6, u], n = 0;
    } finally {
      s = i = 0;
    }
    if (l[0] & 5) throw l[1];
    return { value: l[0] ? l[1] : void 0, done: !0 };
  }
}
function Cp(t, e, r, s) {
  s === void 0 && (s = r), t[s] = e[r];
}
function Np(t, e) {
  for (var r in t) r !== "default" && !e.hasOwnProperty(r) && (e[r] = t[r]);
}
function wo(t) {
  var e = typeof Symbol == "function" && Symbol.iterator, r = e && t[e], s = 0;
  if (r) return r.call(t);
  if (t && typeof t.length == "number") return {
    next: function() {
      return t && s >= t.length && (t = void 0), { value: t && t[s++], done: !t };
    }
  };
  throw new TypeError(e ? "Object is not iterable." : "Symbol.iterator is not defined.");
}
function Uu(t, e) {
  var r = typeof Symbol == "function" && t[Symbol.iterator];
  if (!r) return t;
  var s = r.call(t), n, i = [], o;
  try {
    for (; (e === void 0 || e-- > 0) && !(n = s.next()).done; ) i.push(n.value);
  } catch (a) {
    o = { error: a };
  } finally {
    try {
      n && !n.done && (r = s.return) && r.call(s);
    } finally {
      if (o) throw o.error;
    }
  }
  return i;
}
function Up() {
  for (var t = [], e = 0; e < arguments.length; e++)
    t = t.concat(Uu(arguments[e]));
  return t;
}
function Lp() {
  for (var t = 0, e = 0, r = arguments.length; e < r; e++) t += arguments[e].length;
  for (var s = Array(t), n = 0, e = 0; e < r; e++)
    for (var i = arguments[e], o = 0, a = i.length; o < a; o++, n++)
      s[n] = i[o];
  return s;
}
function Ss(t) {
  return this instanceof Ss ? (this.v = t, this) : new Ss(t);
}
function Mp(t, e, r) {
  if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
  var s = r.apply(t, e || []), n, i = [];
  return n = {}, o("next"), o("throw"), o("return"), n[Symbol.asyncIterator] = function() {
    return this;
  }, n;
  function o(f) {
    s[f] && (n[f] = function(g) {
      return new Promise(function(p, y) {
        i.push([f, g, p, y]) > 1 || a(f, g);
      });
    });
  }
  function a(f, g) {
    try {
      c(s[f](g));
    } catch (p) {
      h(i[0][3], p);
    }
  }
  function c(f) {
    f.value instanceof Ss ? Promise.resolve(f.value.v).then(l, u) : h(i[0][2], f);
  }
  function l(f) {
    a("next", f);
  }
  function u(f) {
    a("throw", f);
  }
  function h(f, g) {
    f(g), i.shift(), i.length && a(i[0][0], i[0][1]);
  }
}
function kp(t) {
  var e, r;
  return e = {}, s("next"), s("throw", function(n) {
    throw n;
  }), s("return"), e[Symbol.iterator] = function() {
    return this;
  }, e;
  function s(n, i) {
    e[n] = t[n] ? function(o) {
      return (r = !r) ? { value: Ss(t[n](o)), done: n === "return" } : i ? i(o) : o;
    } : i;
  }
}
function qp(t) {
  if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
  var e = t[Symbol.asyncIterator], r;
  return e ? e.call(t) : (t = typeof wo == "function" ? wo(t) : t[Symbol.iterator](), r = {}, s("next"), s("throw"), s("return"), r[Symbol.asyncIterator] = function() {
    return this;
  }, r);
  function s(i) {
    r[i] = t[i] && function(o) {
      return new Promise(function(a, c) {
        o = t[i](o), n(a, c, o.done, o.value);
      });
    };
  }
  function n(i, o, a, c) {
    Promise.resolve(c).then(function(l) {
      i({ value: l, done: a });
    }, o);
  }
}
function Fp(t, e) {
  return Object.defineProperty ? Object.defineProperty(t, "raw", { value: e }) : t.raw = e, t;
}
function jp(t) {
  if (t && t.__esModule) return t;
  var e = {};
  if (t != null) for (var r in t) Object.hasOwnProperty.call(t, r) && (e[r] = t[r]);
  return e.default = t, e;
}
function zp(t) {
  return t && t.__esModule ? t : { default: t };
}
function Hp(t, e) {
  if (!e.has(t))
    throw new TypeError("attempted to get private field on non-instance");
  return e.get(t);
}
function Kp(t, e, r) {
  if (!e.has(t))
    throw new TypeError("attempted to set private field on non-instance");
  return e.set(t, r), r;
}
const Vp = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  get __assign() {
    return yo;
  },
  __asyncDelegator: kp,
  __asyncGenerator: Mp,
  __asyncValues: qp,
  __await: Ss,
  __awaiter: Bp,
  __classPrivateFieldGet: Hp,
  __classPrivateFieldSet: Kp,
  __createBinding: Cp,
  __decorate: $p,
  __exportStar: Np,
  __extends: Ap,
  __generator: Rp,
  __importDefault: zp,
  __importStar: jp,
  __makeTemplateObject: Fp,
  __metadata: Tp,
  __param: Pp,
  __read: Uu,
  __rest: Op,
  __spread: Up,
  __spreadArrays: Lp,
  __values: wo
}, Symbol.toStringTag, { value: "Module" })), Kn = /* @__PURE__ */ Nu(Vp);
var di = {}, ns = {}, tc;
function Wp() {
  if (tc) return ns;
  tc = 1, Object.defineProperty(ns, "__esModule", { value: !0 }), ns.delay = void 0;
  function t(e) {
    return new Promise((r) => {
      setTimeout(() => {
        r(!0);
      }, e);
    });
  }
  return ns.delay = t, ns;
}
var dr = {}, pi = {}, pr = {}, rc;
function Gp() {
  return rc || (rc = 1, Object.defineProperty(pr, "__esModule", { value: !0 }), pr.ONE_THOUSAND = pr.ONE_HUNDRED = void 0, pr.ONE_HUNDRED = 100, pr.ONE_THOUSAND = 1e3), pr;
}
var gi = {}, sc;
function Yp() {
  return sc || (sc = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 }), t.ONE_YEAR = t.FOUR_WEEKS = t.THREE_WEEKS = t.TWO_WEEKS = t.ONE_WEEK = t.THIRTY_DAYS = t.SEVEN_DAYS = t.FIVE_DAYS = t.THREE_DAYS = t.ONE_DAY = t.TWENTY_FOUR_HOURS = t.TWELVE_HOURS = t.SIX_HOURS = t.THREE_HOURS = t.ONE_HOUR = t.SIXTY_MINUTES = t.THIRTY_MINUTES = t.TEN_MINUTES = t.FIVE_MINUTES = t.ONE_MINUTE = t.SIXTY_SECONDS = t.THIRTY_SECONDS = t.TEN_SECONDS = t.FIVE_SECONDS = t.ONE_SECOND = void 0, t.ONE_SECOND = 1, t.FIVE_SECONDS = 5, t.TEN_SECONDS = 10, t.THIRTY_SECONDS = 30, t.SIXTY_SECONDS = 60, t.ONE_MINUTE = t.SIXTY_SECONDS, t.FIVE_MINUTES = t.ONE_MINUTE * 5, t.TEN_MINUTES = t.ONE_MINUTE * 10, t.THIRTY_MINUTES = t.ONE_MINUTE * 30, t.SIXTY_MINUTES = t.ONE_MINUTE * 60, t.ONE_HOUR = t.SIXTY_MINUTES, t.THREE_HOURS = t.ONE_HOUR * 3, t.SIX_HOURS = t.ONE_HOUR * 6, t.TWELVE_HOURS = t.ONE_HOUR * 12, t.TWENTY_FOUR_HOURS = t.ONE_HOUR * 24, t.ONE_DAY = t.TWENTY_FOUR_HOURS, t.THREE_DAYS = t.ONE_DAY * 3, t.FIVE_DAYS = t.ONE_DAY * 5, t.SEVEN_DAYS = t.ONE_DAY * 7, t.THIRTY_DAYS = t.ONE_DAY * 30, t.ONE_WEEK = t.SEVEN_DAYS, t.TWO_WEEKS = t.ONE_WEEK * 2, t.THREE_WEEKS = t.ONE_WEEK * 3, t.FOUR_WEEKS = t.ONE_WEEK * 4, t.ONE_YEAR = t.ONE_DAY * 365;
  })(gi)), gi;
}
var nc;
function Lu() {
  return nc || (nc = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 });
    const e = Kn;
    e.__exportStar(Gp(), t), e.__exportStar(Yp(), t);
  })(pi)), pi;
}
var ic;
function Zp() {
  if (ic) return dr;
  ic = 1, Object.defineProperty(dr, "__esModule", { value: !0 }), dr.fromMiliseconds = dr.toMiliseconds = void 0;
  const t = Lu();
  function e(s) {
    return s * t.ONE_THOUSAND;
  }
  dr.toMiliseconds = e;
  function r(s) {
    return Math.floor(s / t.ONE_THOUSAND);
  }
  return dr.fromMiliseconds = r, dr;
}
var oc;
function Xp() {
  return oc || (oc = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 });
    const e = Kn;
    e.__exportStar(Wp(), t), e.__exportStar(Zp(), t);
  })(di)), di;
}
var Mr = {}, ac;
function Jp() {
  if (ac) return Mr;
  ac = 1, Object.defineProperty(Mr, "__esModule", { value: !0 }), Mr.Watch = void 0;
  class t {
    constructor() {
      this.timestamps = /* @__PURE__ */ new Map();
    }
    start(r) {
      if (this.timestamps.has(r))
        throw new Error(`Watch already started for label: ${r}`);
      this.timestamps.set(r, { started: Date.now() });
    }
    stop(r) {
      const s = this.get(r);
      if (typeof s.elapsed < "u")
        throw new Error(`Watch already stopped for label: ${r}`);
      const n = Date.now() - s.started;
      this.timestamps.set(r, { started: s.started, elapsed: n });
    }
    get(r) {
      const s = this.timestamps.get(r);
      if (typeof s > "u")
        throw new Error(`No timestamp found for label: ${r}`);
      return s;
    }
    elapsed(r) {
      const s = this.get(r);
      return s.elapsed || Date.now() - s.started;
    }
  }
  return Mr.Watch = t, Mr.default = t, Mr;
}
var yi = {}, is = {}, cc;
function Qp() {
  if (cc) return is;
  cc = 1, Object.defineProperty(is, "__esModule", { value: !0 }), is.IWatch = void 0;
  class t {
  }
  return is.IWatch = t, is;
}
var lc;
function eg() {
  return lc || (lc = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 }), Kn.__exportStar(Qp(), t);
  })(yi)), yi;
}
var uc;
function tg() {
  return uc || (uc = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 });
    const e = Kn;
    e.__exportStar(Xp(), t), e.__exportStar(Jp(), t), e.__exportStar(eg(), t), e.__exportStar(Lu(), t);
  })(fi)), fi;
}
var F = tg(), ee = {}, hc;
function Mu() {
  if (hc) return ee;
  hc = 1, Object.defineProperty(ee, "__esModule", { value: !0 }), ee.getLocalStorage = ee.getLocalStorageOrThrow = ee.getCrypto = ee.getCryptoOrThrow = ee.getLocation = ee.getLocationOrThrow = ee.getNavigator = ee.getNavigatorOrThrow = ee.getDocument = ee.getDocumentOrThrow = ee.getFromWindowOrThrow = ee.getFromWindow = void 0;
  function t(f) {
    let g;
    return typeof window < "u" && typeof window[f] < "u" && (g = window[f]), g;
  }
  ee.getFromWindow = t;
  function e(f) {
    const g = t(f);
    if (!g)
      throw new Error(`${f} is not defined in Window`);
    return g;
  }
  ee.getFromWindowOrThrow = e;
  function r() {
    return e("document");
  }
  ee.getDocumentOrThrow = r;
  function s() {
    return t("document");
  }
  ee.getDocument = s;
  function n() {
    return e("navigator");
  }
  ee.getNavigatorOrThrow = n;
  function i() {
    return t("navigator");
  }
  ee.getNavigator = i;
  function o() {
    return e("location");
  }
  ee.getLocationOrThrow = o;
  function a() {
    return t("location");
  }
  ee.getLocation = a;
  function c() {
    return e("crypto");
  }
  ee.getCryptoOrThrow = c;
  function l() {
    return t("crypto");
  }
  ee.getCrypto = l;
  function u() {
    return e("localStorage");
  }
  ee.getLocalStorageOrThrow = u;
  function h() {
    return t("localStorage");
  }
  return ee.getLocalStorage = h, ee;
}
var zt = Mu(), os = {}, fc;
function rg() {
  if (fc) return os;
  fc = 1, Object.defineProperty(os, "__esModule", { value: !0 }), os.getWindowMetadata = void 0;
  const t = Mu();
  function e() {
    let r, s;
    try {
      r = t.getDocumentOrThrow(), s = t.getLocationOrThrow();
    } catch {
      return null;
    }
    function n() {
      const g = r.getElementsByTagName("link"), p = [];
      for (let y = 0; y < g.length; y++) {
        const m = g[y], E = m.getAttribute("rel");
        if (E && E.toLowerCase().indexOf("icon") > -1) {
          const $ = m.getAttribute("href");
          if ($)
            if ($.toLowerCase().indexOf("https:") === -1 && $.toLowerCase().indexOf("http:") === -1 && $.indexOf("//") !== 0) {
              let b = s.protocol + "//" + s.host;
              if ($.indexOf("/") === 0)
                b += $;
              else {
                const v = s.pathname.split("/");
                v.pop();
                const x = v.join("/");
                b += x + "/" + $;
              }
              p.push(b);
            } else if ($.indexOf("//") === 0) {
              const b = s.protocol + $;
              p.push(b);
            } else
              p.push($);
        }
      }
      return p;
    }
    function i(...g) {
      const p = r.getElementsByTagName("meta");
      for (let y = 0; y < p.length; y++) {
        const m = p[y], E = ["itemprop", "property", "name"].map(($) => m.getAttribute($)).filter(($) => $ ? g.includes($) : !1);
        if (E.length && E) {
          const $ = m.getAttribute("content");
          if ($)
            return $;
        }
      }
      return "";
    }
    function o() {
      let g = i("name", "og:site_name", "og:title", "twitter:title");
      return g || (g = r.title), g;
    }
    function a() {
      return i("description", "og:description", "twitter:description", "keywords");
    }
    const c = o(), l = a(), u = s.origin, h = n();
    return {
      description: l,
      url: u,
      icons: h,
      name: c
    };
  }
  return os.getWindowMetadata = e, os;
}
var sg = rg();
const Gs = /* @__PURE__ */ BigInt(2 ** 32 - 1), dc = /* @__PURE__ */ BigInt(32);
function ku(t, e = !1) {
  return e ? { h: Number(t & Gs), l: Number(t >> dc & Gs) } : { h: Number(t >> dc & Gs) | 0, l: Number(t & Gs) | 0 };
}
function qu(t, e = !1) {
  const r = t.length;
  let s = new Uint32Array(r), n = new Uint32Array(r);
  for (let i = 0; i < r; i++) {
    const { h: o, l: a } = ku(t[i], e);
    [s[i], n[i]] = [o, a];
  }
  return [s, n];
}
const pc = (t, e, r) => t >>> r, gc = (t, e, r) => t << 32 - r | e >>> r, Qt = (t, e, r) => t >>> r | e << 32 - r, er = (t, e, r) => t << 32 - r | e >>> r, gs = (t, e, r) => t << 64 - r | e >>> r - 32, ys = (t, e, r) => t >>> r - 32 | e << 64 - r, ng = (t, e) => e, ig = (t, e) => t, og = (t, e, r) => t << r | e >>> 32 - r, ag = (t, e, r) => e << r | t >>> 32 - r, cg = (t, e, r) => e << r - 32 | t >>> 64 - r, lg = (t, e, r) => t << r - 32 | e >>> 64 - r;
function nt(t, e, r, s) {
  const n = (e >>> 0) + (s >>> 0);
  return { h: t + r + (n / 2 ** 32 | 0) | 0, l: n | 0 };
}
const ta = (t, e, r) => (t >>> 0) + (e >>> 0) + (r >>> 0), ra = (t, e, r, s) => e + r + s + (t / 2 ** 32 | 0) | 0, ug = (t, e, r, s) => (t >>> 0) + (e >>> 0) + (r >>> 0) + (s >>> 0), hg = (t, e, r, s, n) => e + r + s + n + (t / 2 ** 32 | 0) | 0, fg = (t, e, r, s, n) => (t >>> 0) + (e >>> 0) + (r >>> 0) + (s >>> 0) + (n >>> 0), dg = (t, e, r, s, n, i) => e + r + s + n + i + (t / 2 ** 32 | 0) | 0, kr = typeof globalThis == "object" && "crypto" in globalThis ? globalThis.crypto : void 0;
/*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function Vn(t) {
  return t instanceof Uint8Array || ArrayBuffer.isView(t) && t.constructor.name === "Uint8Array";
}
function xt(t) {
  if (!Number.isSafeInteger(t) || t < 0)
    throw new Error("positive integer expected, got " + t);
}
function lt(t, ...e) {
  if (!Vn(t))
    throw new Error("Uint8Array expected");
  if (e.length > 0 && !e.includes(t.length))
    throw new Error("Uint8Array expected of length " + e + ", got length=" + t.length);
}
function Wn(t) {
  if (typeof t != "function" || typeof t.create != "function")
    throw new Error("Hash should be wrapped by utils.createHasher");
  xt(t.outputLen), xt(t.blockLen);
}
function cr(t, e = !0) {
  if (t.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (e && t.finished)
    throw new Error("Hash#digest() has already been called");
}
function sa(t, e) {
  lt(t);
  const r = e.outputLen;
  if (t.length < r)
    throw new Error("digestInto() expects output buffer of length at least " + r);
}
function Is(t) {
  return new Uint32Array(t.buffer, t.byteOffset, Math.floor(t.byteLength / 4));
}
function Xe(...t) {
  for (let e = 0; e < t.length; e++)
    t[e].fill(0);
}
function wi(t) {
  return new DataView(t.buffer, t.byteOffset, t.byteLength);
}
function ut(t, e) {
  return t << 32 - e | t >>> e;
}
const Fu = new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68;
function ju(t) {
  return t << 24 & 4278190080 | t << 8 & 16711680 | t >>> 8 & 65280 | t >>> 24 & 255;
}
const Tt = Fu ? (t) => t : (t) => ju(t);
function pg(t) {
  for (let e = 0; e < t.length; e++)
    t[e] = ju(t[e]);
  return t;
}
const tr = Fu ? (t) => t : pg, zu = /* @ts-ignore */ typeof Uint8Array.from([]).toHex == "function" && typeof Uint8Array.fromHex == "function", gg = /* @__PURE__ */ Array.from({ length: 256 }, (t, e) => e.toString(16).padStart(2, "0"));
function Wr(t) {
  if (lt(t), zu)
    return t.toHex();
  let e = "";
  for (let r = 0; r < t.length; r++)
    e += gg[t[r]];
  return e;
}
const St = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function yc(t) {
  if (t >= St._0 && t <= St._9)
    return t - St._0;
  if (t >= St.A && t <= St.F)
    return t - (St.A - 10);
  if (t >= St.a && t <= St.f)
    return t - (St.a - 10);
}
function xn(t) {
  if (typeof t != "string")
    throw new Error("hex string expected, got " + typeof t);
  if (zu)
    return Uint8Array.fromHex(t);
  const e = t.length, r = e / 2;
  if (e % 2)
    throw new Error("hex string expected, got unpadded hex of length " + e);
  const s = new Uint8Array(r);
  for (let n = 0, i = 0; n < r; n++, i += 2) {
    const o = yc(t.charCodeAt(i)), a = yc(t.charCodeAt(i + 1));
    if (o === void 0 || a === void 0) {
      const c = t[i] + t[i + 1];
      throw new Error('hex string expected, got non-hex character "' + c + '" at index ' + i);
    }
    s[n] = o * 16 + a;
  }
  return s;
}
function yg(t) {
  if (typeof t != "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(t));
}
function ct(t) {
  return typeof t == "string" && (t = yg(t)), lt(t), t;
}
function Ut(...t) {
  let e = 0;
  for (let s = 0; s < t.length; s++) {
    const n = t[s];
    lt(n), e += n.length;
  }
  const r = new Uint8Array(e);
  for (let s = 0, n = 0; s < t.length; s++) {
    const i = t[s];
    r.set(i, n), n += i.length;
  }
  return r;
}
class Gn {
}
function Cs(t) {
  const e = (s) => t().update(ct(s)).digest(), r = t();
  return e.outputLen = r.outputLen, e.blockLen = r.blockLen, e.create = () => t(), e;
}
function wg(t) {
  const e = (s, n) => t(n).update(ct(s)).digest(), r = t({});
  return e.outputLen = r.outputLen, e.blockLen = r.blockLen, e.create = (s) => t(s), e;
}
function ur(t = 32) {
  if (kr && typeof kr.getRandomValues == "function")
    return kr.getRandomValues(new Uint8Array(t));
  if (kr && typeof kr.randomBytes == "function")
    return Uint8Array.from(kr.randomBytes(t));
  throw new Error("crypto.getRandomValues must be defined");
}
const mg = BigInt(0), as = BigInt(1), bg = BigInt(2), vg = BigInt(7), Eg = BigInt(256), xg = BigInt(113), Hu = [], Ku = [], Vu = [];
for (let t = 0, e = as, r = 1, s = 0; t < 24; t++) {
  [r, s] = [s, (2 * r + 3 * s) % 5], Hu.push(2 * (5 * s + r)), Ku.push((t + 1) * (t + 2) / 2 % 64);
  let n = mg;
  for (let i = 0; i < 7; i++)
    e = (e << as ^ (e >> vg) * xg) % Eg, e & bg && (n ^= as << (as << /* @__PURE__ */ BigInt(i)) - as);
  Vu.push(n);
}
const Wu = qu(Vu, !0), _g = Wu[0], Sg = Wu[1], wc = (t, e, r) => r > 32 ? cg(t, e, r) : og(t, e, r), mc = (t, e, r) => r > 32 ? lg(t, e, r) : ag(t, e, r);
function Ig(t, e = 24) {
  const r = new Uint32Array(10);
  for (let s = 24 - e; s < 24; s++) {
    for (let o = 0; o < 10; o++)
      r[o] = t[o] ^ t[o + 10] ^ t[o + 20] ^ t[o + 30] ^ t[o + 40];
    for (let o = 0; o < 10; o += 2) {
      const a = (o + 8) % 10, c = (o + 2) % 10, l = r[c], u = r[c + 1], h = wc(l, u, 1) ^ r[a], f = mc(l, u, 1) ^ r[a + 1];
      for (let g = 0; g < 50; g += 10)
        t[o + g] ^= h, t[o + g + 1] ^= f;
    }
    let n = t[2], i = t[3];
    for (let o = 0; o < 24; o++) {
      const a = Ku[o], c = wc(n, i, a), l = mc(n, i, a), u = Hu[o];
      n = t[u], i = t[u + 1], t[u] = c, t[u + 1] = l;
    }
    for (let o = 0; o < 50; o += 10) {
      for (let a = 0; a < 10; a++)
        r[a] = t[o + a];
      for (let a = 0; a < 10; a++)
        t[o + a] ^= ~r[(a + 2) % 10] & r[(a + 4) % 10];
    }
    t[0] ^= _g[s], t[1] ^= Sg[s];
  }
  Xe(r);
}
class na extends Gn {
  // NOTE: we accept arguments in bytes instead of bits here.
  constructor(e, r, s, n = !1, i = 24) {
    if (super(), this.pos = 0, this.posOut = 0, this.finished = !1, this.destroyed = !1, this.enableXOF = !1, this.blockLen = e, this.suffix = r, this.outputLen = s, this.enableXOF = n, this.rounds = i, xt(s), !(0 < e && e < 200))
      throw new Error("only keccak-f1600 function is supported");
    this.state = new Uint8Array(200), this.state32 = Is(this.state);
  }
  clone() {
    return this._cloneInto();
  }
  keccak() {
    tr(this.state32), Ig(this.state32, this.rounds), tr(this.state32), this.posOut = 0, this.pos = 0;
  }
  update(e) {
    cr(this), e = ct(e), lt(e);
    const { blockLen: r, state: s } = this, n = e.length;
    for (let i = 0; i < n; ) {
      const o = Math.min(r - this.pos, n - i);
      for (let a = 0; a < o; a++)
        s[this.pos++] ^= e[i++];
      this.pos === r && this.keccak();
    }
    return this;
  }
  finish() {
    if (this.finished)
      return;
    this.finished = !0;
    const { state: e, suffix: r, pos: s, blockLen: n } = this;
    e[s] ^= r, (r & 128) !== 0 && s === n - 1 && this.keccak(), e[n - 1] ^= 128, this.keccak();
  }
  writeInto(e) {
    cr(this, !1), lt(e), this.finish();
    const r = this.state, { blockLen: s } = this;
    for (let n = 0, i = e.length; n < i; ) {
      this.posOut >= s && this.keccak();
      const o = Math.min(s - this.posOut, i - n);
      e.set(r.subarray(this.posOut, this.posOut + o), n), this.posOut += o, n += o;
    }
    return e;
  }
  xofInto(e) {
    if (!this.enableXOF)
      throw new Error("XOF is not possible for this instance");
    return this.writeInto(e);
  }
  xof(e) {
    return xt(e), this.xofInto(new Uint8Array(e));
  }
  digestInto(e) {
    if (sa(e, this), this.finished)
      throw new Error("digest() was already called");
    return this.writeInto(e), this.destroy(), e;
  }
  digest() {
    return this.digestInto(new Uint8Array(this.outputLen));
  }
  destroy() {
    this.destroyed = !0, Xe(this.state);
  }
  _cloneInto(e) {
    const { blockLen: r, suffix: s, outputLen: n, rounds: i, enableXOF: o } = this;
    return e || (e = new na(r, s, n, o, i)), e.state32.set(this.state32), e.pos = this.pos, e.posOut = this.posOut, e.finished = this.finished, e.rounds = i, e.suffix = s, e.outputLen = n, e.enableXOF = o, e.destroyed = this.destroyed, e;
  }
}
const Dg = (t, e, r) => Cs(() => new na(e, t, r)), Gu = Dg(1, 136, 256 / 8), Ag = "0.1.1";
function Og() {
  return Ag;
}
class re extends Error {
  constructor(e, r = {}) {
    const s = (() => {
      if (r.cause instanceof re) {
        if (r.cause.details)
          return r.cause.details;
        if (r.cause.shortMessage)
          return r.cause.shortMessage;
      }
      return r.cause && "details" in r.cause && typeof r.cause.details == "string" ? r.cause.details : r.cause?.message ? r.cause.message : r.details;
    })(), n = r.cause instanceof re && r.cause.docsPath || r.docsPath, o = `https://oxlib.sh${n ?? ""}`, a = [
      e || "An error occurred.",
      ...r.metaMessages ? ["", ...r.metaMessages] : [],
      ...s || n ? [
        "",
        s ? `Details: ${s}` : void 0,
        n ? `See: ${o}` : void 0
      ] : []
    ].filter((c) => typeof c == "string").join(`
`);
    super(a, r.cause ? { cause: r.cause } : void 0), Object.defineProperty(this, "details", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: void 0
    }), Object.defineProperty(this, "docs", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: void 0
    }), Object.defineProperty(this, "docsPath", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: void 0
    }), Object.defineProperty(this, "shortMessage", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: void 0
    }), Object.defineProperty(this, "cause", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: void 0
    }), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "BaseError"
    }), Object.defineProperty(this, "version", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: `ox@${Og()}`
    }), this.cause = r.cause, this.details = s, this.docs = o, this.docsPath = n, this.shortMessage = e;
  }
  walk(e) {
    return Yu(this, e);
  }
}
function Yu(t, e) {
  return e?.(t) ? t : t && typeof t == "object" && "cause" in t && t.cause ? Yu(t.cause, e) : e ? null : t;
}
function $g(t, e, r, s) {
  if (typeof t.setBigUint64 == "function")
    return t.setBigUint64(e, r, s);
  const n = BigInt(32), i = BigInt(4294967295), o = Number(r >> n & i), a = Number(r & i), c = s ? 4 : 0, l = s ? 0 : 4;
  t.setUint32(e + c, o, s), t.setUint32(e + l, a, s);
}
function Pg(t, e, r) {
  return t & e ^ ~t & r;
}
function Tg(t, e, r) {
  return t & e ^ t & r ^ e & r;
}
class Zu extends Gn {
  constructor(e, r, s, n) {
    super(), this.finished = !1, this.length = 0, this.pos = 0, this.destroyed = !1, this.blockLen = e, this.outputLen = r, this.padOffset = s, this.isLE = n, this.buffer = new Uint8Array(e), this.view = wi(this.buffer);
  }
  update(e) {
    cr(this), e = ct(e), lt(e);
    const { view: r, buffer: s, blockLen: n } = this, i = e.length;
    for (let o = 0; o < i; ) {
      const a = Math.min(n - this.pos, i - o);
      if (a === n) {
        const c = wi(e);
        for (; n <= i - o; o += n)
          this.process(c, o);
        continue;
      }
      s.set(e.subarray(o, o + a), this.pos), this.pos += a, o += a, this.pos === n && (this.process(r, 0), this.pos = 0);
    }
    return this.length += e.length, this.roundClean(), this;
  }
  digestInto(e) {
    cr(this), sa(e, this), this.finished = !0;
    const { buffer: r, view: s, blockLen: n, isLE: i } = this;
    let { pos: o } = this;
    r[o++] = 128, Xe(this.buffer.subarray(o)), this.padOffset > n - o && (this.process(s, 0), o = 0);
    for (let h = o; h < n; h++)
      r[h] = 0;
    $g(s, n - 8, BigInt(this.length * 8), i), this.process(s, 0);
    const a = wi(e), c = this.outputLen;
    if (c % 4)
      throw new Error("_sha2: outputLen should be aligned to 32bit");
    const l = c / 4, u = this.get();
    if (l > u.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let h = 0; h < l; h++)
      a.setUint32(4 * h, u[h], i);
  }
  digest() {
    const { buffer: e, outputLen: r } = this;
    this.digestInto(e);
    const s = e.slice(0, r);
    return this.destroy(), s;
  }
  _cloneInto(e) {
    e || (e = new this.constructor()), e.set(...this.get());
    const { blockLen: r, buffer: s, length: n, finished: i, destroyed: o, pos: a } = this;
    return e.destroyed = o, e.finished = i, e.length = n, e.pos = a, n % r && e.buffer.set(s), e;
  }
  clone() {
    return this._cloneInto();
  }
}
const Ht = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]), xe = /* @__PURE__ */ Uint32Array.from([
  3418070365,
  3238371032,
  1654270250,
  914150663,
  2438529370,
  812702999,
  355462360,
  4144912697,
  1731405415,
  4290775857,
  2394180231,
  1750603025,
  3675008525,
  1694076839,
  1203062813,
  3204075428
]), _e = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  4089235720,
  3144134277,
  2227873595,
  1013904242,
  4271175723,
  2773480762,
  1595750129,
  1359893119,
  2917565137,
  2600822924,
  725511199,
  528734635,
  4215389547,
  1541459225,
  327033209
]), Bg = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]), Kt = /* @__PURE__ */ new Uint32Array(64);
class Rg extends Zu {
  constructor(e = 32) {
    super(64, e, 8, !1), this.A = Ht[0] | 0, this.B = Ht[1] | 0, this.C = Ht[2] | 0, this.D = Ht[3] | 0, this.E = Ht[4] | 0, this.F = Ht[5] | 0, this.G = Ht[6] | 0, this.H = Ht[7] | 0;
  }
  get() {
    const { A: e, B: r, C: s, D: n, E: i, F: o, G: a, H: c } = this;
    return [e, r, s, n, i, o, a, c];
  }
  // prettier-ignore
  set(e, r, s, n, i, o, a, c) {
    this.A = e | 0, this.B = r | 0, this.C = s | 0, this.D = n | 0, this.E = i | 0, this.F = o | 0, this.G = a | 0, this.H = c | 0;
  }
  process(e, r) {
    for (let h = 0; h < 16; h++, r += 4)
      Kt[h] = e.getUint32(r, !1);
    for (let h = 16; h < 64; h++) {
      const f = Kt[h - 15], g = Kt[h - 2], p = ut(f, 7) ^ ut(f, 18) ^ f >>> 3, y = ut(g, 17) ^ ut(g, 19) ^ g >>> 10;
      Kt[h] = y + Kt[h - 7] + p + Kt[h - 16] | 0;
    }
    let { A: s, B: n, C: i, D: o, E: a, F: c, G: l, H: u } = this;
    for (let h = 0; h < 64; h++) {
      const f = ut(a, 6) ^ ut(a, 11) ^ ut(a, 25), g = u + f + Pg(a, c, l) + Bg[h] + Kt[h] | 0, y = (ut(s, 2) ^ ut(s, 13) ^ ut(s, 22)) + Tg(s, n, i) | 0;
      u = l, l = c, c = a, a = o + g | 0, o = i, i = n, n = s, s = g + y | 0;
    }
    s = s + this.A | 0, n = n + this.B | 0, i = i + this.C | 0, o = o + this.D | 0, a = a + this.E | 0, c = c + this.F | 0, l = l + this.G | 0, u = u + this.H | 0, this.set(s, n, i, o, a, c, l, u);
  }
  roundClean() {
    Xe(Kt);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0), Xe(this.buffer);
  }
}
const Xu = qu([
  "0x428a2f98d728ae22",
  "0x7137449123ef65cd",
  "0xb5c0fbcfec4d3b2f",
  "0xe9b5dba58189dbbc",
  "0x3956c25bf348b538",
  "0x59f111f1b605d019",
  "0x923f82a4af194f9b",
  "0xab1c5ed5da6d8118",
  "0xd807aa98a3030242",
  "0x12835b0145706fbe",
  "0x243185be4ee4b28c",
  "0x550c7dc3d5ffb4e2",
  "0x72be5d74f27b896f",
  "0x80deb1fe3b1696b1",
  "0x9bdc06a725c71235",
  "0xc19bf174cf692694",
  "0xe49b69c19ef14ad2",
  "0xefbe4786384f25e3",
  "0x0fc19dc68b8cd5b5",
  "0x240ca1cc77ac9c65",
  "0x2de92c6f592b0275",
  "0x4a7484aa6ea6e483",
  "0x5cb0a9dcbd41fbd4",
  "0x76f988da831153b5",
  "0x983e5152ee66dfab",
  "0xa831c66d2db43210",
  "0xb00327c898fb213f",
  "0xbf597fc7beef0ee4",
  "0xc6e00bf33da88fc2",
  "0xd5a79147930aa725",
  "0x06ca6351e003826f",
  "0x142929670a0e6e70",
  "0x27b70a8546d22ffc",
  "0x2e1b21385c26c926",
  "0x4d2c6dfc5ac42aed",
  "0x53380d139d95b3df",
  "0x650a73548baf63de",
  "0x766a0abb3c77b2a8",
  "0x81c2c92e47edaee6",
  "0x92722c851482353b",
  "0xa2bfe8a14cf10364",
  "0xa81a664bbc423001",
  "0xc24b8b70d0f89791",
  "0xc76c51a30654be30",
  "0xd192e819d6ef5218",
  "0xd69906245565a910",
  "0xf40e35855771202a",
  "0x106aa07032bbd1b8",
  "0x19a4c116b8d2d0c8",
  "0x1e376c085141ab53",
  "0x2748774cdf8eeb99",
  "0x34b0bcb5e19b48a8",
  "0x391c0cb3c5c95a63",
  "0x4ed8aa4ae3418acb",
  "0x5b9cca4f7763e373",
  "0x682e6ff3d6b2b8a3",
  "0x748f82ee5defb2fc",
  "0x78a5636f43172f60",
  "0x84c87814a1f0ab72",
  "0x8cc702081a6439ec",
  "0x90befffa23631e28",
  "0xa4506cebde82bde9",
  "0xbef9a3f7b2c67915",
  "0xc67178f2e372532b",
  "0xca273eceea26619c",
  "0xd186b8c721c0c207",
  "0xeada7dd6cde0eb1e",
  "0xf57d4f7fee6ed178",
  "0x06f067aa72176fba",
  "0x0a637dc5a2c898a6",
  "0x113f9804bef90dae",
  "0x1b710b35131c471b",
  "0x28db77f523047d84",
  "0x32caab7b40c72493",
  "0x3c9ebe0a15c9bebc",
  "0x431d67c49c100d4c",
  "0x4cc5d4becb3e42b6",
  "0x597f299cfc657e2a",
  "0x5fcb6fab3ad6faec",
  "0x6c44198c4a475817"
].map((t) => BigInt(t))), Cg = Xu[0], Ng = Xu[1], Vt = /* @__PURE__ */ new Uint32Array(80), Wt = /* @__PURE__ */ new Uint32Array(80);
class ia extends Zu {
  constructor(e = 64) {
    super(128, e, 16, !1), this.Ah = _e[0] | 0, this.Al = _e[1] | 0, this.Bh = _e[2] | 0, this.Bl = _e[3] | 0, this.Ch = _e[4] | 0, this.Cl = _e[5] | 0, this.Dh = _e[6] | 0, this.Dl = _e[7] | 0, this.Eh = _e[8] | 0, this.El = _e[9] | 0, this.Fh = _e[10] | 0, this.Fl = _e[11] | 0, this.Gh = _e[12] | 0, this.Gl = _e[13] | 0, this.Hh = _e[14] | 0, this.Hl = _e[15] | 0;
  }
  // prettier-ignore
  get() {
    const { Ah: e, Al: r, Bh: s, Bl: n, Ch: i, Cl: o, Dh: a, Dl: c, Eh: l, El: u, Fh: h, Fl: f, Gh: g, Gl: p, Hh: y, Hl: m } = this;
    return [e, r, s, n, i, o, a, c, l, u, h, f, g, p, y, m];
  }
  // prettier-ignore
  set(e, r, s, n, i, o, a, c, l, u, h, f, g, p, y, m) {
    this.Ah = e | 0, this.Al = r | 0, this.Bh = s | 0, this.Bl = n | 0, this.Ch = i | 0, this.Cl = o | 0, this.Dh = a | 0, this.Dl = c | 0, this.Eh = l | 0, this.El = u | 0, this.Fh = h | 0, this.Fl = f | 0, this.Gh = g | 0, this.Gl = p | 0, this.Hh = y | 0, this.Hl = m | 0;
  }
  process(e, r) {
    for (let b = 0; b < 16; b++, r += 4)
      Vt[b] = e.getUint32(r), Wt[b] = e.getUint32(r += 4);
    for (let b = 16; b < 80; b++) {
      const v = Vt[b - 15] | 0, x = Wt[b - 15] | 0, I = Qt(v, x, 1) ^ Qt(v, x, 8) ^ pc(v, x, 7), P = er(v, x, 1) ^ er(v, x, 8) ^ gc(v, x, 7), B = Vt[b - 2] | 0, T = Wt[b - 2] | 0, L = Qt(B, T, 19) ^ gs(B, T, 61) ^ pc(B, T, 6), U = er(B, T, 19) ^ ys(B, T, 61) ^ gc(B, T, 6), N = ug(P, U, Wt[b - 7], Wt[b - 16]), A = hg(N, I, L, Vt[b - 7], Vt[b - 16]);
      Vt[b] = A | 0, Wt[b] = N | 0;
    }
    let { Ah: s, Al: n, Bh: i, Bl: o, Ch: a, Cl: c, Dh: l, Dl: u, Eh: h, El: f, Fh: g, Fl: p, Gh: y, Gl: m, Hh: E, Hl: $ } = this;
    for (let b = 0; b < 80; b++) {
      const v = Qt(h, f, 14) ^ Qt(h, f, 18) ^ gs(h, f, 41), x = er(h, f, 14) ^ er(h, f, 18) ^ ys(h, f, 41), I = h & g ^ ~h & y, P = f & p ^ ~f & m, B = fg($, x, P, Ng[b], Wt[b]), T = dg(B, E, v, I, Cg[b], Vt[b]), L = B | 0, U = Qt(s, n, 28) ^ gs(s, n, 34) ^ gs(s, n, 39), N = er(s, n, 28) ^ ys(s, n, 34) ^ ys(s, n, 39), A = s & i ^ s & a ^ i & a, R = n & o ^ n & c ^ o & c;
      E = y | 0, $ = m | 0, y = g | 0, m = p | 0, g = h | 0, p = f | 0, { h, l: f } = nt(l | 0, u | 0, T | 0, L | 0), l = a | 0, u = c | 0, a = i | 0, c = o | 0, i = s | 0, o = n | 0;
      const d = ta(L, N, R);
      s = ra(d, T, U, A), n = d | 0;
    }
    ({ h: s, l: n } = nt(this.Ah | 0, this.Al | 0, s | 0, n | 0)), { h: i, l: o } = nt(this.Bh | 0, this.Bl | 0, i | 0, o | 0), { h: a, l: c } = nt(this.Ch | 0, this.Cl | 0, a | 0, c | 0), { h: l, l: u } = nt(this.Dh | 0, this.Dl | 0, l | 0, u | 0), { h, l: f } = nt(this.Eh | 0, this.El | 0, h | 0, f | 0), { h: g, l: p } = nt(this.Fh | 0, this.Fl | 0, g | 0, p | 0), { h: y, l: m } = nt(this.Gh | 0, this.Gl | 0, y | 0, m | 0), { h: E, l: $ } = nt(this.Hh | 0, this.Hl | 0, E | 0, $ | 0), this.set(s, n, i, o, a, c, l, u, h, f, g, p, y, m, E, $);
  }
  roundClean() {
    Xe(Vt, Wt);
  }
  destroy() {
    Xe(this.buffer), this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
}
class Ug extends ia {
  constructor() {
    super(48), this.Ah = xe[0] | 0, this.Al = xe[1] | 0, this.Bh = xe[2] | 0, this.Bl = xe[3] | 0, this.Ch = xe[4] | 0, this.Cl = xe[5] | 0, this.Dh = xe[6] | 0, this.Dl = xe[7] | 0, this.Eh = xe[8] | 0, this.El = xe[9] | 0, this.Fh = xe[10] | 0, this.Fl = xe[11] | 0, this.Gh = xe[12] | 0, this.Gl = xe[13] | 0, this.Hh = xe[14] | 0, this.Hl = xe[15] | 0;
  }
}
const Se = /* @__PURE__ */ Uint32Array.from([
  573645204,
  4230739756,
  2673172387,
  3360449730,
  596883563,
  1867755857,
  2520282905,
  1497426621,
  2519219938,
  2827943907,
  3193839141,
  1401305490,
  721525244,
  746961066,
  246885852,
  2177182882
]);
class Lg extends ia {
  constructor() {
    super(32), this.Ah = Se[0] | 0, this.Al = Se[1] | 0, this.Bh = Se[2] | 0, this.Bl = Se[3] | 0, this.Ch = Se[4] | 0, this.Cl = Se[5] | 0, this.Dh = Se[6] | 0, this.Dl = Se[7] | 0, this.Eh = Se[8] | 0, this.El = Se[9] | 0, this.Fh = Se[10] | 0, this.Fl = Se[11] | 0, this.Gh = Se[12] | 0, this.Gl = Se[13] | 0, this.Hh = Se[14] | 0, this.Hl = Se[15] | 0;
  }
}
const Or = /* @__PURE__ */ Cs(() => new Rg()), Mg = /* @__PURE__ */ Cs(() => new ia()), kg = /* @__PURE__ */ Cs(() => new Ug()), qg = /* @__PURE__ */ Cs(() => new Lg()), Yn = Or;
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const oa = /* @__PURE__ */ BigInt(0), mo = /* @__PURE__ */ BigInt(1);
function Ns(t) {
  return t instanceof Uint8Array || ArrayBuffer.isView(t) && t.constructor.name === "Uint8Array";
}
function aa(t) {
  if (!Ns(t))
    throw new Error("Uint8Array expected");
}
function Ds(t, e) {
  if (typeof e != "boolean")
    throw new Error(t + " boolean expected, got " + e);
}
function Ys(t) {
  const e = t.toString(16);
  return e.length & 1 ? "0" + e : e;
}
function Ju(t) {
  if (typeof t != "string")
    throw new Error("hex string expected, got " + typeof t);
  return t === "" ? oa : BigInt("0x" + t);
}
const Qu = (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex == "function" && typeof Uint8Array.fromHex == "function"
), Fg = /* @__PURE__ */ Array.from({ length: 256 }, (t, e) => e.toString(16).padStart(2, "0"));
function As(t) {
  if (aa(t), Qu)
    return t.toHex();
  let e = "";
  for (let r = 0; r < t.length; r++)
    e += Fg[t[r]];
  return e;
}
const It = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function bc(t) {
  if (t >= It._0 && t <= It._9)
    return t - It._0;
  if (t >= It.A && t <= It.F)
    return t - (It.A - 10);
  if (t >= It.a && t <= It.f)
    return t - (It.a - 10);
}
function _n(t) {
  if (typeof t != "string")
    throw new Error("hex string expected, got " + typeof t);
  if (Qu)
    return Uint8Array.fromHex(t);
  const e = t.length, r = e / 2;
  if (e % 2)
    throw new Error("hex string expected, got unpadded hex of length " + e);
  const s = new Uint8Array(r);
  for (let n = 0, i = 0; n < r; n++, i += 2) {
    const o = bc(t.charCodeAt(i)), a = bc(t.charCodeAt(i + 1));
    if (o === void 0 || a === void 0) {
      const c = t[i] + t[i + 1];
      throw new Error('hex string expected, got non-hex character "' + c + '" at index ' + i);
    }
    s[n] = o * 16 + a;
  }
  return s;
}
function Dr(t) {
  return Ju(As(t));
}
function eh(t) {
  return aa(t), Ju(As(Uint8Array.from(t).reverse()));
}
function Us(t, e) {
  return _n(t.toString(16).padStart(e * 2, "0"));
}
function th(t, e) {
  return Us(t, e).reverse();
}
function We(t, e, r) {
  let s;
  if (typeof e == "string")
    try {
      s = _n(e);
    } catch (i) {
      throw new Error(t + " must be hex string or Uint8Array, cause: " + i);
    }
  else if (Ns(e))
    s = Uint8Array.from(e);
  else
    throw new Error(t + " must be hex string or Uint8Array");
  const n = s.length;
  if (typeof r == "number" && n !== r)
    throw new Error(t + " of length " + r + " expected, got " + n);
  return s;
}
function Sn(...t) {
  let e = 0;
  for (let s = 0; s < t.length; s++) {
    const n = t[s];
    aa(n), e += n.length;
  }
  const r = new Uint8Array(e);
  for (let s = 0, n = 0; s < t.length; s++) {
    const i = t[s];
    r.set(i, n), n += i.length;
  }
  return r;
}
const mi = (t) => typeof t == "bigint" && oa <= t;
function ca(t, e, r) {
  return mi(t) && mi(e) && mi(r) && e <= t && t < r;
}
function Gr(t, e, r, s) {
  if (!ca(e, r, s))
    throw new Error("expected valid " + t + ": " + r + " <= n < " + s + ", got " + e);
}
function jg(t) {
  let e;
  for (e = 0; t > oa; t >>= mo, e += 1)
    ;
  return e;
}
const Zn = (t) => (mo << BigInt(t)) - mo, bi = (t) => new Uint8Array(t), vc = (t) => Uint8Array.from(t);
function zg(t, e, r) {
  if (typeof t != "number" || t < 2)
    throw new Error("hashLen must be a number");
  if (typeof e != "number" || e < 2)
    throw new Error("qByteLen must be a number");
  if (typeof r != "function")
    throw new Error("hmacFn must be a function");
  let s = bi(t), n = bi(t), i = 0;
  const o = () => {
    s.fill(1), n.fill(0), i = 0;
  }, a = (...h) => r(n, s, ...h), c = (h = bi(0)) => {
    n = a(vc([0]), h), s = a(), h.length !== 0 && (n = a(vc([1]), h), s = a());
  }, l = () => {
    if (i++ >= 1e3)
      throw new Error("drbg: tried 1000 values");
    let h = 0;
    const f = [];
    for (; h < e; ) {
      s = a();
      const g = s.slice();
      f.push(g), h += s.length;
    }
    return Sn(...f);
  };
  return (h, f) => {
    o(), c(h);
    let g;
    for (; !(g = f(l())); )
      c();
    return o(), g;
  };
}
const Hg = {
  bigint: (t) => typeof t == "bigint",
  function: (t) => typeof t == "function",
  boolean: (t) => typeof t == "boolean",
  string: (t) => typeof t == "string",
  stringOrUint8Array: (t) => typeof t == "string" || Ns(t),
  isSafeInteger: (t) => Number.isSafeInteger(t),
  array: (t) => Array.isArray(t),
  field: (t, e) => e.Fp.isValid(t),
  hash: (t) => typeof t == "function" && Number.isSafeInteger(t.outputLen)
};
function Xn(t, e, r = {}) {
  const s = (n, i, o) => {
    const a = Hg[i];
    if (typeof a != "function")
      throw new Error("invalid validator function");
    const c = t[n];
    if (!(o && c === void 0) && !a(c, t))
      throw new Error("param " + String(n) + " is invalid. Expected " + i + ", got " + c);
  };
  for (const [n, i] of Object.entries(e))
    s(n, i, !1);
  for (const [n, i] of Object.entries(r))
    s(n, i, !0);
  return t;
}
function Ec(t) {
  const e = /* @__PURE__ */ new WeakMap();
  return (r, ...s) => {
    const n = e.get(r);
    if (n !== void 0)
      return n;
    const i = t(r, ...s);
    return e.set(r, i), i;
  };
}
function Kg(t, e) {
  if (Ic(t) > e)
    throw new fy({
      givenSize: Ic(t),
      maxSize: e
    });
}
const Dt = {
  zero: 48,
  nine: 57,
  A: 65,
  F: 70,
  a: 97,
  f: 102
};
function xc(t) {
  if (t >= Dt.zero && t <= Dt.nine)
    return t - Dt.zero;
  if (t >= Dt.A && t <= Dt.F)
    return t - (Dt.A - 10);
  if (t >= Dt.a && t <= Dt.f)
    return t - (Dt.a - 10);
}
function Vg(t, e = {}) {
  const { dir: r, size: s = 32 } = e;
  if (s === 0)
    return t;
  if (t.length > s)
    throw new dy({
      size: t.length,
      targetSize: s,
      type: "Bytes"
    });
  const n = new Uint8Array(s);
  for (let i = 0; i < s; i++) {
    const o = r === "right";
    n[o ? i : s - i - 1] = t[o ? i : t.length - i - 1];
  }
  return n;
}
function rh(t, e) {
  if (lr(t) > e)
    throw new ry({
      givenSize: lr(t),
      maxSize: e
    });
}
function Wg(t, e) {
  if (typeof e == "number" && e > 0 && e > lr(t) - 1)
    throw new ih({
      offset: e,
      position: "start",
      size: lr(t)
    });
}
function Gg(t, e, r) {
  if (typeof e == "number" && typeof r == "number" && lr(t) !== r - e)
    throw new ih({
      offset: r,
      position: "end",
      size: lr(t)
    });
}
function sh(t, e = {}) {
  const { dir: r, size: s = 32 } = e;
  if (s === 0)
    return t;
  const n = t.replace("0x", "");
  if (n.length > s * 2)
    throw new sy({
      size: Math.ceil(n.length / 2),
      targetSize: s,
      type: "Hex"
    });
  return `0x${n[r === "right" ? "padEnd" : "padStart"](s * 2, "0")}`;
}
const Yg = "#__bigint";
function la(t, e, r) {
  return JSON.stringify(t, (s, n) => typeof n == "bigint" ? n.toString() + Yg : n, r);
}
const Zg = /* @__PURE__ */ Array.from({ length: 256 }, (t, e) => e.toString(16).padStart(2, "0"));
function Xg(t, e = {}) {
  const { strict: r = !1 } = e;
  if (!t)
    throw new _c(t);
  if (typeof t != "string")
    throw new _c(t);
  if (r && !/^0x[0-9a-fA-F]*$/.test(t))
    throw new Sc(t);
  if (!t.startsWith("0x"))
    throw new Sc(t);
}
function Jg(...t) {
  return `0x${t.reduce((e, r) => e + r.replace("0x", ""), "")}`;
}
function ua(t) {
  return t instanceof Uint8Array ? In(t) : Array.isArray(t) ? In(new Uint8Array(t)) : t;
}
function In(t, e = {}) {
  let r = "";
  for (let n = 0; n < t.length; n++)
    r += Zg[t[n]];
  const s = `0x${r}`;
  return typeof e.size == "number" ? (rh(s, e.size), nh(s, e.size)) : s;
}
function vi(t, e = {}) {
  const { signed: r, size: s } = e, n = BigInt(t);
  let i;
  s ? r ? i = (1n << BigInt(s) * 8n - 1n) - 1n : i = 2n ** (BigInt(s) * 8n) - 1n : typeof t == "number" && (i = BigInt(Number.MAX_SAFE_INTEGER));
  const o = typeof i == "bigint" && r ? -i - 1n : 0;
  if (i && n > i || n < o) {
    const l = typeof t == "bigint" ? "n" : "";
    throw new ty({
      max: i ? `${i}${l}` : void 0,
      min: `${o}${l}`,
      signed: r,
      size: s,
      value: `${t}${l}`
    });
  }
  const c = `0x${(r && n < 0 ? (1n << BigInt(s * 8)) + BigInt(n) : n).toString(16)}`;
  return s ? Qg(c, s) : c;
}
function Qg(t, e) {
  return sh(t, { dir: "left", size: e });
}
function nh(t, e) {
  return sh(t, { dir: "right", size: e });
}
function Rt(t, e, r, s = {}) {
  const { strict: n } = s;
  Wg(t, e);
  const i = `0x${t.replace("0x", "").slice((e ?? 0) * 2, (r ?? t.length) * 2)}`;
  return n && Gg(i, e, r), i;
}
function lr(t) {
  return Math.ceil((t.length - 2) / 2);
}
function ey(t, e = {}) {
  const { strict: r = !1 } = e;
  try {
    return Xg(t, { strict: r }), !0;
  } catch {
    return !1;
  }
}
class ty extends re {
  constructor({ max: e, min: r, signed: s, size: n, value: i }) {
    super(`Number \`${i}\` is not in safe${n ? ` ${n * 8}-bit` : ""}${s ? " signed" : " unsigned"} integer range ${e ? `(\`${r}\` to \`${e}\`)` : `(above \`${r}\`)`}`), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "Hex.IntegerOutOfRangeError"
    });
  }
}
class _c extends re {
  constructor(e) {
    super(`Value \`${typeof e == "object" ? la(e) : e}\` of type \`${typeof e}\` is an invalid hex type.`, {
      metaMessages: ['Hex types must be represented as `"0x${string}"`.']
    }), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "Hex.InvalidHexTypeError"
    });
  }
}
class Sc extends re {
  constructor(e) {
    super(`Value \`${e}\` is an invalid hex value.`, {
      metaMessages: [
        'Hex values must start with `"0x"` and contain only hexadecimal characters (0-9, a-f, A-F).'
      ]
    }), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "Hex.InvalidHexValueError"
    });
  }
}
let ry = class extends re {
  constructor({ givenSize: e, maxSize: r }) {
    super(`Size cannot exceed \`${r}\` bytes. Given size: \`${e}\` bytes.`), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "Hex.SizeOverflowError"
    });
  }
};
class ih extends re {
  constructor({ offset: e, position: r, size: s }) {
    super(`Slice ${r === "start" ? "starting" : "ending"} at offset \`${e}\` is out-of-bounds (size: \`${s}\`).`), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "Hex.SliceOffsetOutOfBoundsError"
    });
  }
}
let sy = class extends re {
  constructor({ size: e, targetSize: r, type: s }) {
    super(`${s.charAt(0).toUpperCase()}${s.slice(1).toLowerCase()} size (\`${e}\`) exceeds padding size (\`${r}\`).`), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "Hex.SizeExceedsPaddingSizeError"
    });
  }
};
const ny = /* @__PURE__ */ new TextEncoder();
function iy(t) {
  if (!(t instanceof Uint8Array)) {
    if (!t)
      throw new Zs(t);
    if (typeof t != "object")
      throw new Zs(t);
    if (!("BYTES_PER_ELEMENT" in t))
      throw new Zs(t);
    if (t.BYTES_PER_ELEMENT !== 1 || t.constructor.name !== "Uint8Array")
      throw new Zs(t);
  }
}
function oy(t) {
  return t instanceof Uint8Array ? t : typeof t == "string" ? cy(t) : ay(t);
}
function ay(t) {
  return t instanceof Uint8Array ? t : new Uint8Array(t);
}
function cy(t, e = {}) {
  const { size: r } = e;
  let s = t;
  r && (rh(t, r), s = nh(t, r));
  let n = s.slice(2);
  n.length % 2 && (n = `0${n}`);
  const i = n.length / 2, o = new Uint8Array(i);
  for (let a = 0, c = 0; a < i; a++) {
    const l = xc(n.charCodeAt(c++)), u = xc(n.charCodeAt(c++));
    if (l === void 0 || u === void 0)
      throw new re(`Invalid byte sequence ("${n[c - 2]}${n[c - 1]}" in "${n}").`);
    o[a] = l * 16 + u;
  }
  return o;
}
function ly(t, e = {}) {
  const { size: r } = e, s = ny.encode(t);
  return typeof r == "number" ? (Kg(s, r), uy(s, r)) : s;
}
function uy(t, e) {
  return Vg(t, { dir: "right", size: e });
}
function Ic(t) {
  return t.length;
}
function hy(t) {
  try {
    return iy(t), !0;
  } catch {
    return !1;
  }
}
class Zs extends re {
  constructor(e) {
    super(`Value \`${typeof e == "object" ? la(e) : e}\` of type \`${typeof e}\` is an invalid Bytes value.`, {
      metaMessages: ["Bytes values must be of type `Bytes`."]
    }), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "Bytes.InvalidBytesTypeError"
    });
  }
}
class fy extends re {
  constructor({ givenSize: e, maxSize: r }) {
    super(`Size cannot exceed \`${r}\` bytes. Given size: \`${e}\` bytes.`), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "Bytes.SizeOverflowError"
    });
  }
}
class dy extends re {
  constructor({ size: e, targetSize: r, type: s }) {
    super(`${s.charAt(0).toUpperCase()}${s.slice(1).toLowerCase()} size (\`${e}\`) exceeds padding size (\`${r}\`).`), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "Bytes.SizeExceedsPaddingSizeError"
    });
  }
}
function oh(t, e = {}) {
  const { as: r = typeof t == "string" ? "Hex" : "Bytes" } = e, s = Gu(oy(t));
  return r === "Bytes" ? s : In(s);
}
class py extends Map {
  constructor(e) {
    super(), Object.defineProperty(this, "maxSize", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: void 0
    }), this.maxSize = e;
  }
  get(e) {
    const r = super.get(e);
    return super.has(e) && r !== void 0 && (this.delete(e), super.set(e, r)), r;
  }
  set(e, r) {
    if (super.set(e, r), this.maxSize && this.size > this.maxSize) {
      const s = this.keys().next().value;
      s && this.delete(s);
    }
    return this;
  }
}
const gy = {
  checksum: /* @__PURE__ */ new py(8192)
}, Ei = gy.checksum;
function ah(t, e = {}) {
  const { compressed: r } = e, { prefix: s, x: n, y: i } = t;
  if (r === !1 || typeof n == "bigint" && typeof i == "bigint") {
    if (s !== 4)
      throw new Dc({
        prefix: s,
        cause: new Ey()
      });
    return;
  }
  if (r === !0 || typeof n == "bigint" && typeof i > "u") {
    if (s !== 3 && s !== 2)
      throw new Dc({
        prefix: s,
        cause: new vy()
      });
    return;
  }
  throw new by({ publicKey: t });
}
function yy(t) {
  const e = (() => {
    if (ey(t))
      return ch(t);
    if (hy(t))
      return wy(t);
    const { prefix: r, x: s, y: n } = t;
    return typeof s == "bigint" && typeof n == "bigint" ? { prefix: r ?? 4, x: s, y: n } : { prefix: r, x: s };
  })();
  return ah(e), e;
}
function wy(t) {
  return ch(In(t));
}
function ch(t) {
  if (t.length !== 132 && t.length !== 130 && t.length !== 68)
    throw new xy({ publicKey: t });
  if (t.length === 130) {
    const s = BigInt(Rt(t, 0, 32)), n = BigInt(Rt(t, 32, 64));
    return {
      prefix: 4,
      x: s,
      y: n
    };
  }
  if (t.length === 132) {
    const s = Number(Rt(t, 0, 1)), n = BigInt(Rt(t, 1, 33)), i = BigInt(Rt(t, 33, 65));
    return {
      prefix: s,
      x: n,
      y: i
    };
  }
  const e = Number(Rt(t, 0, 1)), r = BigInt(Rt(t, 1, 33));
  return {
    prefix: e,
    x: r
  };
}
function my(t, e = {}) {
  ah(t);
  const { prefix: r, x: s, y: n } = t, { includePrefix: i = !0 } = e;
  return Jg(
    i ? vi(r, { size: 1 }) : "0x",
    vi(s, { size: 32 }),
    // If the public key is not compressed, add the y coordinate.
    typeof n == "bigint" ? vi(n, { size: 32 }) : "0x"
  );
}
class by extends re {
  constructor({ publicKey: e }) {
    super(`Value \`${la(e)}\` is not a valid public key.`, {
      metaMessages: [
        "Public key must contain:",
        "- an `x` and `prefix` value (compressed)",
        "- an `x`, `y`, and `prefix` value (uncompressed)"
      ]
    }), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "PublicKey.InvalidError"
    });
  }
}
class Dc extends re {
  constructor({ prefix: e, cause: r }) {
    super(`Prefix "${e}" is invalid.`, {
      cause: r
    }), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "PublicKey.InvalidPrefixError"
    });
  }
}
class vy extends re {
  constructor() {
    super("Prefix must be 2 or 3 for compressed public keys."), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "PublicKey.InvalidCompressedPrefixError"
    });
  }
}
class Ey extends re {
  constructor() {
    super("Prefix must be 4 for uncompressed public keys."), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "PublicKey.InvalidUncompressedPrefixError"
    });
  }
}
let xy = class extends re {
  constructor({ publicKey: e }) {
    super(`Value \`${e}\` is an invalid public key size.`, {
      metaMessages: [
        "Expected: 33 bytes (compressed + prefix), 64 bytes (uncompressed) or 65 bytes (uncompressed + prefix).",
        `Received ${lr(ua(e))} bytes.`
      ]
    }), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "PublicKey.InvalidSerializedSizeError"
    });
  }
};
const _y = /^0x[a-fA-F0-9]{40}$/;
function lh(t, e = {}) {
  const { strict: r = !0 } = e;
  if (!_y.test(t))
    throw new Ac({
      address: t,
      cause: new Dy()
    });
  if (r) {
    if (t.toLowerCase() === t)
      return;
    if (uh(t) !== t)
      throw new Ac({
        address: t,
        cause: new Ay()
      });
  }
}
function uh(t) {
  if (Ei.has(t))
    return Ei.get(t);
  lh(t, { strict: !1 });
  const e = t.substring(2).toLowerCase(), r = oh(ly(e), { as: "Bytes" }), s = e.split("");
  for (let i = 0; i < 40; i += 2)
    r[i >> 1] >> 4 >= 8 && s[i] && (s[i] = s[i].toUpperCase()), (r[i >> 1] & 15) >= 8 && s[i + 1] && (s[i + 1] = s[i + 1].toUpperCase());
  const n = `0x${s.join("")}`;
  return Ei.set(t, n), n;
}
function Sy(t, e = {}) {
  const { checksum: r = !1 } = e;
  return lh(t), r ? uh(t) : t;
}
function Iy(t, e = {}) {
  const r = oh(`0x${my(t).slice(4)}`).substring(26);
  return Sy(`0x${r}`, e);
}
class Ac extends re {
  constructor({ address: e, cause: r }) {
    super(`Address "${e}" is invalid.`, {
      cause: r
    }), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "Address.InvalidAddressError"
    });
  }
}
class Dy extends re {
  constructor() {
    super("Address is not a 20 byte (40 hexadecimal character) value."), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "Address.InvalidInputError"
    });
  }
}
class Ay extends re {
  constructor() {
    super("Address does not match its checksum counterpart."), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "Address.InvalidChecksumError"
    });
  }
}
class hh extends Gn {
  constructor(e, r) {
    super(), this.finished = !1, this.destroyed = !1, Wn(e);
    const s = ct(r);
    if (this.iHash = e.create(), typeof this.iHash.update != "function")
      throw new Error("Expected instance of class which extends utils.Hash");
    this.blockLen = this.iHash.blockLen, this.outputLen = this.iHash.outputLen;
    const n = this.blockLen, i = new Uint8Array(n);
    i.set(s.length > n ? e.create().update(s).digest() : s);
    for (let o = 0; o < i.length; o++)
      i[o] ^= 54;
    this.iHash.update(i), this.oHash = e.create();
    for (let o = 0; o < i.length; o++)
      i[o] ^= 106;
    this.oHash.update(i), Xe(i);
  }
  update(e) {
    return cr(this), this.iHash.update(e), this;
  }
  digestInto(e) {
    cr(this), lt(e, this.outputLen), this.finished = !0, this.iHash.digestInto(e), this.oHash.update(e), this.oHash.digestInto(e), this.destroy();
  }
  digest() {
    const e = new Uint8Array(this.oHash.outputLen);
    return this.digestInto(e), e;
  }
  _cloneInto(e) {
    e || (e = Object.create(Object.getPrototypeOf(this), {}));
    const { oHash: r, iHash: s, finished: n, destroyed: i, blockLen: o, outputLen: a } = this;
    return e = e, e.finished = n, e.destroyed = i, e.blockLen = o, e.outputLen = a, e.oHash = r._cloneInto(e.oHash), e.iHash = s._cloneInto(e.iHash), e;
  }
  clone() {
    return this._cloneInto();
  }
  destroy() {
    this.destroyed = !0, this.oHash.destroy(), this.iHash.destroy();
  }
}
const Ls = (t, e, r) => new hh(t, e).update(r).digest();
Ls.create = (t, e) => new hh(t, e);
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const Ne = BigInt(0), Ae = BigInt(1), Er = /* @__PURE__ */ BigInt(2), Oy = /* @__PURE__ */ BigInt(3), fh = /* @__PURE__ */ BigInt(4), dh = /* @__PURE__ */ BigInt(5), ph = /* @__PURE__ */ BigInt(8);
function Re(t, e) {
  const r = t % e;
  return r >= Ne ? r : e + r;
}
function He(t, e, r) {
  let s = t;
  for (; e-- > Ne; )
    s *= s, s %= r;
  return s;
}
function bo(t, e) {
  if (t === Ne)
    throw new Error("invert: expected non-zero number");
  if (e <= Ne)
    throw new Error("invert: expected positive modulus, got " + e);
  let r = Re(t, e), s = e, n = Ne, i = Ae;
  for (; r !== Ne; ) {
    const a = s / r, c = s % r, l = n - i * a;
    s = r, r = c, n = i, i = l;
  }
  if (s !== Ae)
    throw new Error("invert: does not exist");
  return Re(n, e);
}
function gh(t, e) {
  const r = (t.ORDER + Ae) / fh, s = t.pow(e, r);
  if (!t.eql(t.sqr(s), e))
    throw new Error("Cannot find square root");
  return s;
}
function $y(t, e) {
  const r = (t.ORDER - dh) / ph, s = t.mul(e, Er), n = t.pow(s, r), i = t.mul(e, n), o = t.mul(t.mul(i, Er), n), a = t.mul(i, t.sub(o, t.ONE));
  if (!t.eql(t.sqr(a), e))
    throw new Error("Cannot find square root");
  return a;
}
function Py(t) {
  if (t < BigInt(3))
    throw new Error("sqrt is not defined for small field");
  let e = t - Ae, r = 0;
  for (; e % Er === Ne; )
    e /= Er, r++;
  let s = Er;
  const n = ha(t);
  for (; Oc(n, s) === 1; )
    if (s++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  if (r === 1)
    return gh;
  let i = n.pow(s, e);
  const o = (e + Ae) / Er;
  return function(c, l) {
    if (c.is0(l))
      return l;
    if (Oc(c, l) !== 1)
      throw new Error("Cannot find square root");
    let u = r, h = c.mul(c.ONE, i), f = c.pow(l, e), g = c.pow(l, o);
    for (; !c.eql(f, c.ONE); ) {
      if (c.is0(f))
        return c.ZERO;
      let p = 1, y = c.sqr(f);
      for (; !c.eql(y, c.ONE); )
        if (p++, y = c.sqr(y), p === u)
          throw new Error("Cannot find square root");
      const m = Ae << BigInt(u - p - 1), E = c.pow(h, m);
      u = p, h = c.sqr(E), f = c.mul(f, h), g = c.mul(g, E);
    }
    return g;
  };
}
function Ty(t) {
  return t % fh === Oy ? gh : t % ph === dh ? $y : Py(t);
}
const By = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function Ry(t) {
  const e = {
    ORDER: "bigint",
    MASK: "bigint",
    BYTES: "isSafeInteger",
    BITS: "isSafeInteger"
  }, r = By.reduce((s, n) => (s[n] = "function", s), e);
  return Xn(t, r);
}
function Cy(t, e, r) {
  if (r < Ne)
    throw new Error("invalid exponent, negatives unsupported");
  if (r === Ne)
    return t.ONE;
  if (r === Ae)
    return e;
  let s = t.ONE, n = e;
  for (; r > Ne; )
    r & Ae && (s = t.mul(s, n)), n = t.sqr(n), r >>= Ae;
  return s;
}
function yh(t, e, r = !1) {
  const s = new Array(e.length).fill(r ? t.ZERO : void 0), n = e.reduce((o, a, c) => t.is0(a) ? o : (s[c] = o, t.mul(o, a)), t.ONE), i = t.inv(n);
  return e.reduceRight((o, a, c) => t.is0(a) ? o : (s[c] = t.mul(o, s[c]), t.mul(o, a)), i), s;
}
function Oc(t, e) {
  const r = (t.ORDER - Ae) / Er, s = t.pow(e, r), n = t.eql(s, t.ONE), i = t.eql(s, t.ZERO), o = t.eql(s, t.neg(t.ONE));
  if (!n && !i && !o)
    throw new Error("invalid Legendre symbol result");
  return n ? 1 : i ? 0 : -1;
}
function wh(t, e) {
  e !== void 0 && xt(e);
  const r = e !== void 0 ? e : t.toString(2).length, s = Math.ceil(r / 8);
  return { nBitLength: r, nByteLength: s };
}
function ha(t, e, r = !1, s = {}) {
  if (t <= Ne)
    throw new Error("invalid field: expected ORDER > 0, got " + t);
  const { nBitLength: n, nByteLength: i } = wh(t, e);
  if (i > 2048)
    throw new Error("invalid field: expected ORDER of <= 2048 bytes");
  let o;
  const a = Object.freeze({
    ORDER: t,
    isLE: r,
    BITS: n,
    BYTES: i,
    MASK: Zn(n),
    ZERO: Ne,
    ONE: Ae,
    create: (c) => Re(c, t),
    isValid: (c) => {
      if (typeof c != "bigint")
        throw new Error("invalid field element: expected bigint, got " + typeof c);
      return Ne <= c && c < t;
    },
    is0: (c) => c === Ne,
    isOdd: (c) => (c & Ae) === Ae,
    neg: (c) => Re(-c, t),
    eql: (c, l) => c === l,
    sqr: (c) => Re(c * c, t),
    add: (c, l) => Re(c + l, t),
    sub: (c, l) => Re(c - l, t),
    mul: (c, l) => Re(c * l, t),
    pow: (c, l) => Cy(a, c, l),
    div: (c, l) => Re(c * bo(l, t), t),
    // Same as above, but doesn't normalize
    sqrN: (c) => c * c,
    addN: (c, l) => c + l,
    subN: (c, l) => c - l,
    mulN: (c, l) => c * l,
    inv: (c) => bo(c, t),
    sqrt: s.sqrt || ((c) => (o || (o = Ty(t)), o(a, c))),
    toBytes: (c) => r ? th(c, i) : Us(c, i),
    fromBytes: (c) => {
      if (c.length !== i)
        throw new Error("Field.fromBytes: expected " + i + " bytes, got " + c.length);
      return r ? eh(c) : Dr(c);
    },
    // TODO: we don't need it here, move out to separate fn
    invertBatch: (c) => yh(a, c),
    // We can't move this out because Fp6, Fp12 implement it
    // and it's unclear what to return in there.
    cmov: (c, l, u) => u ? l : c
  });
  return Object.freeze(a);
}
function mh(t) {
  if (typeof t != "bigint")
    throw new Error("field order must be bigint");
  const e = t.toString(2).length;
  return Math.ceil(e / 8);
}
function bh(t) {
  const e = mh(t);
  return e + Math.ceil(e / 2);
}
function Ny(t, e, r = !1) {
  const s = t.length, n = mh(e), i = bh(e);
  if (s < 16 || s < i || s > 1024)
    throw new Error("expected " + i + "-1024 bytes of input, got " + s);
  const o = r ? eh(t) : Dr(t), a = Re(o, e - Ae) + Ae;
  return r ? th(a, n) : Us(a, n);
}
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const $c = BigInt(0), vo = BigInt(1);
function xi(t, e) {
  const r = e.negate();
  return t ? r : e;
}
function vh(t, e) {
  if (!Number.isSafeInteger(t) || t <= 0 || t > e)
    throw new Error("invalid window size, expected [1.." + e + "], got W=" + t);
}
function _i(t, e) {
  vh(t, e);
  const r = Math.ceil(e / t) + 1, s = 2 ** (t - 1), n = 2 ** t, i = Zn(t), o = BigInt(t);
  return { windows: r, windowSize: s, mask: i, maxNumber: n, shiftBy: o };
}
function Pc(t, e, r) {
  const { windowSize: s, mask: n, maxNumber: i, shiftBy: o } = r;
  let a = Number(t & n), c = t >> o;
  a > s && (a -= i, c += vo);
  const l = e * s, u = l + Math.abs(a) - 1, h = a === 0, f = a < 0, g = e % 2 !== 0;
  return { nextN: c, offset: u, isZero: h, isNeg: f, isNegF: g, offsetF: l };
}
function Uy(t, e) {
  if (!Array.isArray(t))
    throw new Error("array expected");
  t.forEach((r, s) => {
    if (!(r instanceof e))
      throw new Error("invalid point at index " + s);
  });
}
function Ly(t, e) {
  if (!Array.isArray(t))
    throw new Error("array of scalars expected");
  t.forEach((r, s) => {
    if (!e.isValid(r))
      throw new Error("invalid scalar at index " + s);
  });
}
const Si = /* @__PURE__ */ new WeakMap(), Eh = /* @__PURE__ */ new WeakMap();
function Ii(t) {
  return Eh.get(t) || 1;
}
function My(t, e) {
  return {
    constTimeNegate: xi,
    hasPrecomputes(r) {
      return Ii(r) !== 1;
    },
    // non-const time multiplication ladder
    unsafeLadder(r, s, n = t.ZERO) {
      let i = r;
      for (; s > $c; )
        s & vo && (n = n.add(i)), i = i.double(), s >>= vo;
      return n;
    },
    /**
     * Creates a wNAF precomputation window. Used for caching.
     * Default window size is set by `utils.precompute()` and is equal to 8.
     * Number of precomputed points depends on the curve size:
     * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
     * - 𝑊 is the window size
     * - 𝑛 is the bitlength of the curve order.
     * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
     * @param elm Point instance
     * @param W window size
     * @returns precomputed point tables flattened to a single array
     */
    precomputeWindow(r, s) {
      const { windows: n, windowSize: i } = _i(s, e), o = [];
      let a = r, c = a;
      for (let l = 0; l < n; l++) {
        c = a, o.push(c);
        for (let u = 1; u < i; u++)
          c = c.add(a), o.push(c);
        a = c.double();
      }
      return o;
    },
    /**
     * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
     * @param W window size
     * @param precomputes precomputed tables
     * @param n scalar (we don't check here, but should be less than curve order)
     * @returns real and fake (for const-time) points
     */
    wNAF(r, s, n) {
      let i = t.ZERO, o = t.BASE;
      const a = _i(r, e);
      for (let c = 0; c < a.windows; c++) {
        const { nextN: l, offset: u, isZero: h, isNeg: f, isNegF: g, offsetF: p } = Pc(n, c, a);
        n = l, h ? o = o.add(xi(g, s[p])) : i = i.add(xi(f, s[u]));
      }
      return { p: i, f: o };
    },
    /**
     * Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
     * @param W window size
     * @param precomputes precomputed tables
     * @param n scalar (we don't check here, but should be less than curve order)
     * @param acc accumulator point to add result of multiplication
     * @returns point
     */
    wNAFUnsafe(r, s, n, i = t.ZERO) {
      const o = _i(r, e);
      for (let a = 0; a < o.windows && n !== $c; a++) {
        const { nextN: c, offset: l, isZero: u, isNeg: h } = Pc(n, a, o);
        if (n = c, !u) {
          const f = s[l];
          i = i.add(h ? f.negate() : f);
        }
      }
      return i;
    },
    getPrecomputes(r, s, n) {
      let i = Si.get(s);
      return i || (i = this.precomputeWindow(s, r), r !== 1 && Si.set(s, n(i))), i;
    },
    wNAFCached(r, s, n) {
      const i = Ii(r);
      return this.wNAF(i, this.getPrecomputes(i, r, n), s);
    },
    wNAFCachedUnsafe(r, s, n, i) {
      const o = Ii(r);
      return o === 1 ? this.unsafeLadder(r, s, i) : this.wNAFUnsafe(o, this.getPrecomputes(o, r, n), s, i);
    },
    // We calculate precomputes for elliptic curve point multiplication
    // using windowed method. This specifies window size and
    // stores precomputed values. Usually only base point would be precomputed.
    setWindowSize(r, s) {
      vh(s, e), Eh.set(r, s), Si.delete(r);
    }
  };
}
function ky(t, e, r, s) {
  Uy(r, t), Ly(s, e);
  const n = r.length, i = s.length;
  if (n !== i)
    throw new Error("arrays of points and scalars must have equal length");
  const o = t.ZERO, a = jg(BigInt(n));
  let c = 1;
  a > 12 ? c = a - 3 : a > 4 ? c = a - 2 : a > 0 && (c = 2);
  const l = Zn(c), u = new Array(Number(l) + 1).fill(o), h = Math.floor((e.BITS - 1) / c) * c;
  let f = o;
  for (let g = h; g >= 0; g -= c) {
    u.fill(o);
    for (let y = 0; y < i; y++) {
      const m = s[y], E = Number(m >> BigInt(g) & l);
      u[E] = u[E].add(r[y]);
    }
    let p = o;
    for (let y = u.length - 1, m = o; y > 0; y--)
      m = m.add(u[y]), p = p.add(m);
    if (f = f.add(p), g !== 0)
      for (let y = 0; y < c; y++)
        f = f.double();
  }
  return f;
}
function xh(t) {
  return Ry(t.Fp), Xn(t, {
    n: "bigint",
    h: "bigint",
    Gx: "field",
    Gy: "field"
  }, {
    nBitLength: "isSafeInteger",
    nByteLength: "isSafeInteger"
  }), Object.freeze({
    ...wh(t.n, t.nBitLength),
    ...t,
    p: t.Fp.ORDER
  });
}
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function Tc(t) {
  t.lowS !== void 0 && Ds("lowS", t.lowS), t.prehash !== void 0 && Ds("prehash", t.prehash);
}
function qy(t) {
  const e = xh(t);
  Xn(e, {
    a: "field",
    b: "field"
  }, {
    allowInfinityPoint: "boolean",
    allowedPrivateKeyLengths: "array",
    clearCofactor: "function",
    fromBytes: "function",
    isTorsionFree: "function",
    toBytes: "function",
    wrapPrivateKey: "boolean"
  });
  const { endo: r, Fp: s, a: n } = e;
  if (r) {
    if (!s.eql(n, s.ZERO))
      throw new Error("invalid endo: CURVE.a must be 0");
    if (typeof r != "object" || typeof r.beta != "bigint" || typeof r.splitScalar != "function")
      throw new Error('invalid endo: expected "beta": bigint and "splitScalar": function');
  }
  return Object.freeze({ ...e });
}
let Fy = class extends Error {
  constructor(e = "") {
    super(e);
  }
};
const Ct = {
  // asn.1 DER encoding utils
  Err: Fy,
  // Basic building block is TLV (Tag-Length-Value)
  _tlv: {
    encode: (t, e) => {
      const { Err: r } = Ct;
      if (t < 0 || t > 256)
        throw new r("tlv.encode: wrong tag");
      if (e.length & 1)
        throw new r("tlv.encode: unpadded data");
      const s = e.length / 2, n = Ys(s);
      if (n.length / 2 & 128)
        throw new r("tlv.encode: long form length too big");
      const i = s > 127 ? Ys(n.length / 2 | 128) : "";
      return Ys(t) + i + n + e;
    },
    // v - value, l - left bytes (unparsed)
    decode(t, e) {
      const { Err: r } = Ct;
      let s = 0;
      if (t < 0 || t > 256)
        throw new r("tlv.encode: wrong tag");
      if (e.length < 2 || e[s++] !== t)
        throw new r("tlv.decode: wrong tlv");
      const n = e[s++], i = !!(n & 128);
      let o = 0;
      if (!i)
        o = n;
      else {
        const c = n & 127;
        if (!c)
          throw new r("tlv.decode(long): indefinite length not supported");
        if (c > 4)
          throw new r("tlv.decode(long): byte length is too big");
        const l = e.subarray(s, s + c);
        if (l.length !== c)
          throw new r("tlv.decode: length bytes not complete");
        if (l[0] === 0)
          throw new r("tlv.decode(long): zero leftmost byte");
        for (const u of l)
          o = o << 8 | u;
        if (s += c, o < 128)
          throw new r("tlv.decode(long): not minimal encoding");
      }
      const a = e.subarray(s, s + o);
      if (a.length !== o)
        throw new r("tlv.decode: wrong value length");
      return { v: a, l: e.subarray(s + o) };
    }
  },
  // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
  // since we always use positive integers here. It must always be empty:
  // - add zero byte if exists
  // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
  _int: {
    encode(t) {
      const { Err: e } = Ct;
      if (t < Lt)
        throw new e("integer: negative integers are not allowed");
      let r = Ys(t);
      if (Number.parseInt(r[0], 16) & 8 && (r = "00" + r), r.length & 1)
        throw new e("unexpected DER parsing assertion: unpadded hex");
      return r;
    },
    decode(t) {
      const { Err: e } = Ct;
      if (t[0] & 128)
        throw new e("invalid signature integer: negative");
      if (t[0] === 0 && !(t[1] & 128))
        throw new e("invalid signature integer: unnecessary leading zero");
      return Dr(t);
    }
  },
  toSig(t) {
    const { Err: e, _int: r, _tlv: s } = Ct, n = We("signature", t), { v: i, l: o } = s.decode(48, n);
    if (o.length)
      throw new e("invalid signature: left bytes after parsing");
    const { v: a, l: c } = s.decode(2, i), { v: l, l: u } = s.decode(2, c);
    if (u.length)
      throw new e("invalid signature: left bytes after parsing");
    return { r: r.decode(a), s: r.decode(l) };
  },
  hexFromSig(t) {
    const { _tlv: e, _int: r } = Ct, s = e.encode(2, r.encode(t.r)), n = e.encode(2, r.encode(t.s)), i = s + n;
    return e.encode(48, i);
  }
};
function Di(t, e) {
  return As(Us(t, e));
}
const Lt = BigInt(0), ge = BigInt(1);
BigInt(2);
const Ai = BigInt(3), jy = BigInt(4);
function zy(t) {
  const e = qy(t), { Fp: r } = e, s = ha(e.n, e.nBitLength), n = e.toBytes || ((b, v, x) => {
    const I = v.toAffine();
    return Sn(Uint8Array.from([4]), r.toBytes(I.x), r.toBytes(I.y));
  }), i = e.fromBytes || ((b) => {
    const v = b.subarray(1), x = r.fromBytes(v.subarray(0, r.BYTES)), I = r.fromBytes(v.subarray(r.BYTES, 2 * r.BYTES));
    return { x, y: I };
  });
  function o(b) {
    const { a: v, b: x } = e, I = r.sqr(b), P = r.mul(I, b);
    return r.add(r.add(P, r.mul(b, v)), x);
  }
  function a(b, v) {
    const x = r.sqr(v), I = o(b);
    return r.eql(x, I);
  }
  if (!a(e.Gx, e.Gy))
    throw new Error("bad curve params: generator point");
  const c = r.mul(r.pow(e.a, Ai), jy), l = r.mul(r.sqr(e.b), BigInt(27));
  if (r.is0(r.add(c, l)))
    throw new Error("bad curve params: a or b");
  function u(b) {
    return ca(b, ge, e.n);
  }
  function h(b) {
    const { allowedPrivateKeyLengths: v, nByteLength: x, wrapPrivateKey: I, n: P } = e;
    if (v && typeof b != "bigint") {
      if (Ns(b) && (b = As(b)), typeof b != "string" || !v.includes(b.length))
        throw new Error("invalid private key");
      b = b.padStart(x * 2, "0");
    }
    let B;
    try {
      B = typeof b == "bigint" ? b : Dr(We("private key", b, x));
    } catch {
      throw new Error("invalid private key, expected hex or " + x + " bytes, got " + typeof b);
    }
    return I && (B = Re(B, P)), Gr("private key", B, ge, P), B;
  }
  function f(b) {
    if (!(b instanceof y))
      throw new Error("ProjectivePoint expected");
  }
  const g = Ec((b, v) => {
    const { px: x, py: I, pz: P } = b;
    if (r.eql(P, r.ONE))
      return { x, y: I };
    const B = b.is0();
    v == null && (v = B ? r.ONE : r.inv(P));
    const T = r.mul(x, v), L = r.mul(I, v), U = r.mul(P, v);
    if (B)
      return { x: r.ZERO, y: r.ZERO };
    if (!r.eql(U, r.ONE))
      throw new Error("invZ was invalid");
    return { x: T, y: L };
  }), p = Ec((b) => {
    if (b.is0()) {
      if (e.allowInfinityPoint && !r.is0(b.py))
        return;
      throw new Error("bad point: ZERO");
    }
    const { x: v, y: x } = b.toAffine();
    if (!r.isValid(v) || !r.isValid(x))
      throw new Error("bad point: x or y not FE");
    if (!a(v, x))
      throw new Error("bad point: equation left != right");
    if (!b.isTorsionFree())
      throw new Error("bad point: not in prime-order subgroup");
    return !0;
  });
  class y {
    constructor(v, x, I) {
      if (v == null || !r.isValid(v))
        throw new Error("x required");
      if (x == null || !r.isValid(x) || r.is0(x))
        throw new Error("y required");
      if (I == null || !r.isValid(I))
        throw new Error("z required");
      this.px = v, this.py = x, this.pz = I, Object.freeze(this);
    }
    // Does not validate if the point is on-curve.
    // Use fromHex instead, or call assertValidity() later.
    static fromAffine(v) {
      const { x, y: I } = v || {};
      if (!v || !r.isValid(x) || !r.isValid(I))
        throw new Error("invalid affine point");
      if (v instanceof y)
        throw new Error("projective point not allowed");
      const P = (B) => r.eql(B, r.ZERO);
      return P(x) && P(I) ? y.ZERO : new y(x, I, r.ONE);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    /**
     * Takes a bunch of Projective Points but executes only one
     * inversion on all of them. Inversion is very slow operation,
     * so this improves performance massively.
     * Optimization: converts a list of projective points to a list of identical points with Z=1.
     */
    static normalizeZ(v) {
      const x = yh(r, v.map((I) => I.pz));
      return v.map((I, P) => I.toAffine(x[P])).map(y.fromAffine);
    }
    /**
     * Converts hash string or Uint8Array to Point.
     * @param hex short/long ECDSA hex
     */
    static fromHex(v) {
      const x = y.fromAffine(i(We("pointHex", v)));
      return x.assertValidity(), x;
    }
    // Multiplies generator point by privateKey.
    static fromPrivateKey(v) {
      return y.BASE.multiply(h(v));
    }
    // Multiscalar Multiplication
    static msm(v, x) {
      return ky(y, s, v, x);
    }
    // "Private method", don't use it directly
    _setWindowSize(v) {
      $.setWindowSize(this, v);
    }
    // A point on curve is valid if it conforms to equation.
    assertValidity() {
      p(this);
    }
    hasEvenY() {
      const { y: v } = this.toAffine();
      if (r.isOdd)
        return !r.isOdd(v);
      throw new Error("Field doesn't support isOdd");
    }
    /**
     * Compare one point to another.
     */
    equals(v) {
      f(v);
      const { px: x, py: I, pz: P } = this, { px: B, py: T, pz: L } = v, U = r.eql(r.mul(x, L), r.mul(B, P)), N = r.eql(r.mul(I, L), r.mul(T, P));
      return U && N;
    }
    /**
     * Flips point to one corresponding to (x, -y) in Affine coordinates.
     */
    negate() {
      return new y(this.px, r.neg(this.py), this.pz);
    }
    // Renes-Costello-Batina exception-free doubling formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 3
    // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
    double() {
      const { a: v, b: x } = e, I = r.mul(x, Ai), { px: P, py: B, pz: T } = this;
      let L = r.ZERO, U = r.ZERO, N = r.ZERO, A = r.mul(P, P), R = r.mul(B, B), d = r.mul(T, T), w = r.mul(P, B);
      return w = r.add(w, w), N = r.mul(P, T), N = r.add(N, N), L = r.mul(v, N), U = r.mul(I, d), U = r.add(L, U), L = r.sub(R, U), U = r.add(R, U), U = r.mul(L, U), L = r.mul(w, L), N = r.mul(I, N), d = r.mul(v, d), w = r.sub(A, d), w = r.mul(v, w), w = r.add(w, N), N = r.add(A, A), A = r.add(N, A), A = r.add(A, d), A = r.mul(A, w), U = r.add(U, A), d = r.mul(B, T), d = r.add(d, d), A = r.mul(d, w), L = r.sub(L, A), N = r.mul(d, R), N = r.add(N, N), N = r.add(N, N), new y(L, U, N);
    }
    // Renes-Costello-Batina exception-free addition formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 1
    // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
    add(v) {
      f(v);
      const { px: x, py: I, pz: P } = this, { px: B, py: T, pz: L } = v;
      let U = r.ZERO, N = r.ZERO, A = r.ZERO;
      const R = e.a, d = r.mul(e.b, Ai);
      let w = r.mul(x, B), _ = r.mul(I, T), O = r.mul(P, L), S = r.add(x, I), D = r.add(B, T);
      S = r.mul(S, D), D = r.add(w, _), S = r.sub(S, D), D = r.add(x, P);
      let C = r.add(B, L);
      return D = r.mul(D, C), C = r.add(w, O), D = r.sub(D, C), C = r.add(I, P), U = r.add(T, L), C = r.mul(C, U), U = r.add(_, O), C = r.sub(C, U), A = r.mul(R, D), U = r.mul(d, O), A = r.add(U, A), U = r.sub(_, A), A = r.add(_, A), N = r.mul(U, A), _ = r.add(w, w), _ = r.add(_, w), O = r.mul(R, O), D = r.mul(d, D), _ = r.add(_, O), O = r.sub(w, O), O = r.mul(R, O), D = r.add(D, O), w = r.mul(_, D), N = r.add(N, w), w = r.mul(C, D), U = r.mul(S, U), U = r.sub(U, w), w = r.mul(S, _), A = r.mul(C, A), A = r.add(A, w), new y(U, N, A);
    }
    subtract(v) {
      return this.add(v.negate());
    }
    is0() {
      return this.equals(y.ZERO);
    }
    wNAF(v) {
      return $.wNAFCached(this, v, y.normalizeZ);
    }
    /**
     * Non-constant-time multiplication. Uses double-and-add algorithm.
     * It's faster, but should only be used when you don't care about
     * an exposed private key e.g. sig verification, which works over *public* keys.
     */
    multiplyUnsafe(v) {
      const { endo: x, n: I } = e;
      Gr("scalar", v, Lt, I);
      const P = y.ZERO;
      if (v === Lt)
        return P;
      if (this.is0() || v === ge)
        return this;
      if (!x || $.hasPrecomputes(this))
        return $.wNAFCachedUnsafe(this, v, y.normalizeZ);
      let { k1neg: B, k1: T, k2neg: L, k2: U } = x.splitScalar(v), N = P, A = P, R = this;
      for (; T > Lt || U > Lt; )
        T & ge && (N = N.add(R)), U & ge && (A = A.add(R)), R = R.double(), T >>= ge, U >>= ge;
      return B && (N = N.negate()), L && (A = A.negate()), A = new y(r.mul(A.px, x.beta), A.py, A.pz), N.add(A);
    }
    /**
     * Constant time multiplication.
     * Uses wNAF method. Windowed method may be 10% faster,
     * but takes 2x longer to generate and consumes 2x memory.
     * Uses precomputes when available.
     * Uses endomorphism for Koblitz curves.
     * @param scalar by which the point would be multiplied
     * @returns New point
     */
    multiply(v) {
      const { endo: x, n: I } = e;
      Gr("scalar", v, ge, I);
      let P, B;
      if (x) {
        const { k1neg: T, k1: L, k2neg: U, k2: N } = x.splitScalar(v);
        let { p: A, f: R } = this.wNAF(L), { p: d, f: w } = this.wNAF(N);
        A = $.constTimeNegate(T, A), d = $.constTimeNegate(U, d), d = new y(r.mul(d.px, x.beta), d.py, d.pz), P = A.add(d), B = R.add(w);
      } else {
        const { p: T, f: L } = this.wNAF(v);
        P = T, B = L;
      }
      return y.normalizeZ([P, B])[0];
    }
    /**
     * Efficiently calculate `aP + bQ`. Unsafe, can expose private key, if used incorrectly.
     * Not using Strauss-Shamir trick: precomputation tables are faster.
     * The trick could be useful if both P and Q are not G (not in our case).
     * @returns non-zero affine point
     */
    multiplyAndAddUnsafe(v, x, I) {
      const P = y.BASE, B = (L, U) => U === Lt || U === ge || !L.equals(P) ? L.multiplyUnsafe(U) : L.multiply(U), T = B(this, x).add(B(v, I));
      return T.is0() ? void 0 : T;
    }
    // Converts Projective point to affine (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    // (x, y, z) ∋ (x=x/z, y=y/z)
    toAffine(v) {
      return g(this, v);
    }
    isTorsionFree() {
      const { h: v, isTorsionFree: x } = e;
      if (v === ge)
        return !0;
      if (x)
        return x(y, this);
      throw new Error("isTorsionFree() has not been declared for the elliptic curve");
    }
    clearCofactor() {
      const { h: v, clearCofactor: x } = e;
      return v === ge ? this : x ? x(y, this) : this.multiplyUnsafe(e.h);
    }
    toRawBytes(v = !0) {
      return Ds("isCompressed", v), this.assertValidity(), n(y, this, v);
    }
    toHex(v = !0) {
      return Ds("isCompressed", v), As(this.toRawBytes(v));
    }
  }
  y.BASE = new y(e.Gx, e.Gy, r.ONE), y.ZERO = new y(r.ZERO, r.ONE, r.ZERO);
  const { endo: m, nBitLength: E } = e, $ = My(y, m ? Math.ceil(E / 2) : E);
  return {
    CURVE: e,
    ProjectivePoint: y,
    normPrivateKeyToScalar: h,
    weierstrassEquation: o,
    isWithinCurveOrder: u
  };
}
function Hy(t) {
  const e = xh(t);
  return Xn(e, {
    hash: "hash",
    hmac: "function",
    randomBytes: "function"
  }, {
    bits2int: "function",
    bits2int_modN: "function",
    lowS: "boolean"
  }), Object.freeze({ lowS: !0, ...e });
}
function Ky(t) {
  const e = Hy(t), { Fp: r, n: s, nByteLength: n, nBitLength: i } = e, o = r.BYTES + 1, a = 2 * r.BYTES + 1;
  function c(d) {
    return Re(d, s);
  }
  function l(d) {
    return bo(d, s);
  }
  const { ProjectivePoint: u, normPrivateKeyToScalar: h, weierstrassEquation: f, isWithinCurveOrder: g } = zy({
    ...e,
    toBytes(d, w, _) {
      const O = w.toAffine(), S = r.toBytes(O.x), D = Sn;
      return Ds("isCompressed", _), _ ? D(Uint8Array.from([w.hasEvenY() ? 2 : 3]), S) : D(Uint8Array.from([4]), S, r.toBytes(O.y));
    },
    fromBytes(d) {
      const w = d.length, _ = d[0], O = d.subarray(1);
      if (w === o && (_ === 2 || _ === 3)) {
        const S = Dr(O);
        if (!ca(S, ge, r.ORDER))
          throw new Error("Point is not on curve");
        const D = f(S);
        let C;
        try {
          C = r.sqrt(D);
        } catch (k) {
          const q = k instanceof Error ? ": " + k.message : "";
          throw new Error("Point is not on curve" + q);
        }
        const M = (C & ge) === ge;
        return (_ & 1) === 1 !== M && (C = r.neg(C)), { x: S, y: C };
      } else if (w === a && _ === 4) {
        const S = r.fromBytes(O.subarray(0, r.BYTES)), D = r.fromBytes(O.subarray(r.BYTES, 2 * r.BYTES));
        return { x: S, y: D };
      } else {
        const S = o, D = a;
        throw new Error("invalid Point, expected length of " + S + ", or uncompressed " + D + ", got " + w);
      }
    }
  });
  function p(d) {
    const w = s >> ge;
    return d > w;
  }
  function y(d) {
    return p(d) ? c(-d) : d;
  }
  const m = (d, w, _) => Dr(d.slice(w, _));
  class E {
    constructor(w, _, O) {
      Gr("r", w, ge, s), Gr("s", _, ge, s), this.r = w, this.s = _, O != null && (this.recovery = O), Object.freeze(this);
    }
    // pair (bytes of r, bytes of s)
    static fromCompact(w) {
      const _ = n;
      return w = We("compactSignature", w, _ * 2), new E(m(w, 0, _), m(w, _, 2 * _));
    }
    // DER encoded ECDSA signature
    // https://bitcoin.stackexchange.com/questions/57644/what-are-the-parts-of-a-bitcoin-transaction-input-script
    static fromDER(w) {
      const { r: _, s: O } = Ct.toSig(We("DER", w));
      return new E(_, O);
    }
    /**
     * @todo remove
     * @deprecated
     */
    assertValidity() {
    }
    addRecoveryBit(w) {
      return new E(this.r, this.s, w);
    }
    recoverPublicKey(w) {
      const { r: _, s: O, recovery: S } = this, D = P(We("msgHash", w));
      if (S == null || ![0, 1, 2, 3].includes(S))
        throw new Error("recovery id invalid");
      const C = S === 2 || S === 3 ? _ + e.n : _;
      if (C >= r.ORDER)
        throw new Error("recovery id 2 or 3 invalid");
      const M = (S & 1) === 0 ? "02" : "03", z = u.fromHex(M + Di(C, r.BYTES)), k = l(C), q = c(-D * k), K = c(O * k), W = u.BASE.multiplyAndAddUnsafe(z, q, K);
      if (!W)
        throw new Error("point at infinify");
      return W.assertValidity(), W;
    }
    // Signatures should be low-s, to prevent malleability.
    hasHighS() {
      return p(this.s);
    }
    normalizeS() {
      return this.hasHighS() ? new E(this.r, c(-this.s), this.recovery) : this;
    }
    // DER-encoded
    toDERRawBytes() {
      return _n(this.toDERHex());
    }
    toDERHex() {
      return Ct.hexFromSig(this);
    }
    // padded bytes of r, then padded bytes of s
    toCompactRawBytes() {
      return _n(this.toCompactHex());
    }
    toCompactHex() {
      const w = n;
      return Di(this.r, w) + Di(this.s, w);
    }
  }
  const $ = {
    isValidPrivateKey(d) {
      try {
        return h(d), !0;
      } catch {
        return !1;
      }
    },
    normPrivateKeyToScalar: h,
    /**
     * Produces cryptographically secure private key from random of size
     * (groupLen + ceil(groupLen / 2)) with modulo bias being negligible.
     */
    randomPrivateKey: () => {
      const d = bh(e.n);
      return Ny(e.randomBytes(d), e.n);
    },
    /**
     * Creates precompute table for an arbitrary EC point. Makes point "cached".
     * Allows to massively speed-up `point.multiply(scalar)`.
     * @returns cached point
     * @example
     * const fast = utils.precompute(8, ProjectivePoint.fromHex(someonesPubKey));
     * fast.multiply(privKey); // much faster ECDH now
     */
    precompute(d = 8, w = u.BASE) {
      return w._setWindowSize(d), w.multiply(BigInt(3)), w;
    }
  };
  function b(d, w = !0) {
    return u.fromPrivateKey(d).toRawBytes(w);
  }
  function v(d) {
    if (typeof d == "bigint")
      return !1;
    if (d instanceof u)
      return !0;
    const _ = We("key", d).length, O = r.BYTES, S = O + 1, D = 2 * O + 1;
    if (!(e.allowedPrivateKeyLengths || n === S))
      return _ === S || _ === D;
  }
  function x(d, w, _ = !0) {
    if (v(d) === !0)
      throw new Error("first arg must be private key");
    if (v(w) === !1)
      throw new Error("second arg must be public key");
    return u.fromHex(w).multiply(h(d)).toRawBytes(_);
  }
  const I = e.bits2int || function(d) {
    if (d.length > 8192)
      throw new Error("input is too large");
    const w = Dr(d), _ = d.length * 8 - i;
    return _ > 0 ? w >> BigInt(_) : w;
  }, P = e.bits2int_modN || function(d) {
    return c(I(d));
  }, B = Zn(i);
  function T(d) {
    return Gr("num < 2^" + i, d, Lt, B), Us(d, n);
  }
  function L(d, w, _ = U) {
    if (["recovered", "canonical"].some((V) => V in _))
      throw new Error("sign() legacy options not supported");
    const { hash: O, randomBytes: S } = e;
    let { lowS: D, prehash: C, extraEntropy: M } = _;
    D == null && (D = !0), d = We("msgHash", d), Tc(_), C && (d = We("prehashed msgHash", O(d)));
    const z = P(d), k = h(w), q = [T(k), T(z)];
    if (M != null && M !== !1) {
      const V = M === !0 ? S(r.BYTES) : M;
      q.push(We("extraEntropy", V));
    }
    const K = Sn(...q), W = z;
    function G(V) {
      const Z = I(V);
      if (!g(Z))
        return;
      const ie = l(Z), oe = u.BASE.multiply(Z).toAffine(), de = c(oe.x);
      if (de === Lt)
        return;
      const Je = c(ie * c(W + de * k));
      if (Je === Lt)
        return;
      let Qe = (oe.x === de ? 0 : 2) | Number(oe.y & ge), Vs = Je;
      return D && p(Je) && (Vs = y(Je), Qe ^= 1), new E(de, Vs, Qe);
    }
    return { seed: K, k2sig: G };
  }
  const U = { lowS: e.lowS, prehash: !1 }, N = { lowS: e.lowS, prehash: !1 };
  function A(d, w, _ = U) {
    const { seed: O, k2sig: S } = L(d, w, _), D = e;
    return zg(D.hash.outputLen, D.nByteLength, D.hmac)(O, S);
  }
  u.BASE._setWindowSize(8);
  function R(d, w, _, O = N) {
    const S = d;
    w = We("msgHash", w), _ = We("publicKey", _);
    const { lowS: D, prehash: C, format: M } = O;
    if (Tc(O), "strict" in O)
      throw new Error("options.strict was renamed to lowS");
    if (M !== void 0 && M !== "compact" && M !== "der")
      throw new Error("format must be compact or der");
    const z = typeof S == "string" || Ns(S), k = !z && !M && typeof S == "object" && S !== null && typeof S.r == "bigint" && typeof S.s == "bigint";
    if (!z && !k)
      throw new Error("invalid signature, expected Uint8Array, hex string or Signature instance");
    let q, K;
    try {
      if (k && (q = new E(S.r, S.s)), z) {
        try {
          M !== "compact" && (q = E.fromDER(S));
        } catch (Qe) {
          if (!(Qe instanceof Ct.Err))
            throw Qe;
        }
        !q && M !== "der" && (q = E.fromCompact(S));
      }
      K = u.fromHex(_);
    } catch {
      return !1;
    }
    if (!q || D && q.hasHighS())
      return !1;
    C && (w = e.hash(w));
    const { r: W, s: G } = q, V = P(w), Z = l(G), ie = c(V * Z), oe = c(W * Z), de = u.BASE.multiplyAndAddUnsafe(K, ie, oe)?.toAffine();
    return de ? c(de.x) === W : !1;
  }
  return {
    CURVE: e,
    getPublicKey: b,
    getSharedSecret: x,
    sign: A,
    verify: R,
    ProjectivePoint: u,
    Signature: E,
    utils: $
  };
}
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function Vy(t) {
  return {
    hash: t,
    hmac: (e, ...r) => Ls(t, e, Ut(...r)),
    randomBytes: ur
  };
}
function Wy(t, e) {
  const r = (s) => Ky({ ...t, ...Vy(s) });
  return { ...r(e), create: r };
}
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const _h = BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"), Bc = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"), Gy = BigInt(0), Yy = BigInt(1), Eo = BigInt(2), Rc = (t, e) => (t + e / Eo) / e;
function Zy(t) {
  const e = _h, r = BigInt(3), s = BigInt(6), n = BigInt(11), i = BigInt(22), o = BigInt(23), a = BigInt(44), c = BigInt(88), l = t * t * t % e, u = l * l * t % e, h = He(u, r, e) * u % e, f = He(h, r, e) * u % e, g = He(f, Eo, e) * l % e, p = He(g, n, e) * g % e, y = He(p, i, e) * p % e, m = He(y, a, e) * y % e, E = He(m, c, e) * m % e, $ = He(E, a, e) * y % e, b = He($, r, e) * u % e, v = He(b, o, e) * p % e, x = He(v, s, e) * l % e, I = He(x, Eo, e);
  if (!xo.eql(xo.sqr(I), t))
    throw new Error("Cannot find square root");
  return I;
}
const xo = ha(_h, void 0, void 0, { sqrt: Zy }), Xy = Wy({
  a: Gy,
  b: BigInt(7),
  Fp: xo,
  n: Bc,
  Gx: BigInt("55066263022277343669578718895168534326250603453777594175500187360389116729240"),
  Gy: BigInt("32670510020758816978083085130507043184471273380659243275938904335757337482424"),
  h: BigInt(1),
  lowS: !0,
  // Allow only low-S signatures by default in sign() and verify()
  endo: {
    // Endomorphism, see above
    beta: BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),
    splitScalar: (t) => {
      const e = Bc, r = BigInt("0x3086d221a7d46bcde86c90e49284eb15"), s = -Yy * BigInt("0xe4437ed6010e88286f547fa90abfe4c3"), n = BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8"), i = r, o = BigInt("0x100000000000000000000000000000000"), a = Rc(i * t, e), c = Rc(-s * t, e);
      let l = Re(t - a * r - c * n, e), u = Re(-a * s - c * i, e);
      const h = l > o, f = u > o;
      if (h && (l = e - l), f && (u = e - u), l > o || u > o)
        throw new Error("splitScalar: Endomorphism failed, k=" + t);
      return { k1neg: h, k1: l, k2neg: f, k2: u };
    }
  }
}, Or);
function Jy(t) {
  if (t.length !== 130 && t.length !== 132)
    throw new ew({ signature: t });
  const e = BigInt(Rt(t, 0, 32)), r = BigInt(Rt(t, 32, 64)), s = (() => {
    const n = +`0x${t.slice(130)}`;
    if (!Number.isNaN(n))
      try {
        return Qy(n);
      } catch {
        throw new tw({ value: n });
      }
  })();
  return typeof s > "u" ? {
    r: e,
    s: r
  } : {
    r: e,
    s: r,
    yParity: s
  };
}
function Qy(t) {
  if (t === 0 || t === 27)
    return 0;
  if (t === 1 || t === 28)
    return 1;
  if (t >= 35)
    return t % 2 === 0 ? 1 : 0;
  throw new rw({ value: t });
}
class ew extends re {
  constructor({ signature: e }) {
    super(`Value \`${e}\` is an invalid signature size.`, {
      metaMessages: [
        "Expected: 64 bytes or 65 bytes.",
        `Received ${lr(ua(e))} bytes.`
      ]
    }), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "Signature.InvalidSerializedSizeError"
    });
  }
}
class tw extends re {
  constructor({ value: e }) {
    super(`Value \`${e}\` is an invalid y-parity value. Y-parity must be 0 or 1.`), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "Signature.InvalidYParityError"
    });
  }
}
class rw extends re {
  constructor({ value: e }) {
    super(`Value \`${e}\` is an invalid v value. v must be 27, 28 or >=35.`), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "Signature.InvalidVError"
    });
  }
}
const sw = /* @__PURE__ */ Uint8Array.from([
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  14,
  10,
  4,
  8,
  9,
  15,
  13,
  6,
  1,
  12,
  0,
  2,
  11,
  7,
  5,
  3,
  11,
  8,
  12,
  0,
  5,
  2,
  15,
  13,
  10,
  14,
  3,
  6,
  7,
  1,
  9,
  4,
  7,
  9,
  3,
  1,
  13,
  12,
  11,
  14,
  2,
  6,
  5,
  10,
  4,
  0,
  15,
  8,
  9,
  0,
  5,
  7,
  2,
  4,
  10,
  15,
  14,
  1,
  11,
  12,
  6,
  8,
  3,
  13,
  2,
  12,
  6,
  10,
  0,
  11,
  8,
  3,
  4,
  13,
  7,
  5,
  15,
  14,
  1,
  9,
  12,
  5,
  1,
  15,
  14,
  13,
  4,
  10,
  0,
  7,
  6,
  3,
  9,
  2,
  8,
  11,
  13,
  11,
  7,
  14,
  12,
  1,
  3,
  9,
  5,
  0,
  15,
  4,
  8,
  6,
  2,
  10,
  6,
  15,
  14,
  9,
  11,
  3,
  0,
  8,
  12,
  2,
  13,
  7,
  1,
  4,
  10,
  5,
  10,
  2,
  8,
  4,
  7,
  6,
  1,
  5,
  15,
  11,
  9,
  14,
  3,
  12,
  13,
  0,
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  14,
  10,
  4,
  8,
  9,
  15,
  13,
  6,
  1,
  12,
  0,
  2,
  11,
  7,
  5,
  3,
  // Blake1, unused in others
  11,
  8,
  12,
  0,
  5,
  2,
  15,
  13,
  10,
  14,
  3,
  6,
  7,
  1,
  9,
  4,
  7,
  9,
  3,
  1,
  13,
  12,
  11,
  14,
  2,
  6,
  5,
  10,
  4,
  0,
  15,
  8,
  9,
  0,
  5,
  7,
  2,
  4,
  10,
  15,
  14,
  1,
  11,
  12,
  6,
  8,
  3,
  13,
  2,
  12,
  6,
  10,
  0,
  11,
  8,
  3,
  4,
  13,
  7,
  5,
  15,
  14,
  1,
  9
]), le = /* @__PURE__ */ Uint32Array.from([
  4089235720,
  1779033703,
  2227873595,
  3144134277,
  4271175723,
  1013904242,
  1595750129,
  2773480762,
  2917565137,
  1359893119,
  725511199,
  2600822924,
  4215389547,
  528734635,
  327033209,
  1541459225
]), H = /* @__PURE__ */ new Uint32Array(32);
function Gt(t, e, r, s, n, i) {
  const o = n[i], a = n[i + 1];
  let c = H[2 * t], l = H[2 * t + 1], u = H[2 * e], h = H[2 * e + 1], f = H[2 * r], g = H[2 * r + 1], p = H[2 * s], y = H[2 * s + 1], m = ta(c, u, o);
  l = ra(m, l, h, a), c = m | 0, { Dh: y, Dl: p } = { Dh: y ^ l, Dl: p ^ c }, { Dh: y, Dl: p } = { Dh: ng(y, p), Dl: ig(y) }, { h: g, l: f } = nt(g, f, y, p), { Bh: h, Bl: u } = { Bh: h ^ g, Bl: u ^ f }, { Bh: h, Bl: u } = { Bh: Qt(h, u, 24), Bl: er(h, u, 24) }, H[2 * t] = c, H[2 * t + 1] = l, H[2 * e] = u, H[2 * e + 1] = h, H[2 * r] = f, H[2 * r + 1] = g, H[2 * s] = p, H[2 * s + 1] = y;
}
function Yt(t, e, r, s, n, i) {
  const o = n[i], a = n[i + 1];
  let c = H[2 * t], l = H[2 * t + 1], u = H[2 * e], h = H[2 * e + 1], f = H[2 * r], g = H[2 * r + 1], p = H[2 * s], y = H[2 * s + 1], m = ta(c, u, o);
  l = ra(m, l, h, a), c = m | 0, { Dh: y, Dl: p } = { Dh: y ^ l, Dl: p ^ c }, { Dh: y, Dl: p } = { Dh: Qt(y, p, 16), Dl: er(y, p, 16) }, { h: g, l: f } = nt(g, f, y, p), { Bh: h, Bl: u } = { Bh: h ^ g, Bl: u ^ f }, { Bh: h, Bl: u } = { Bh: gs(h, u, 63), Bl: ys(h, u, 63) }, H[2 * t] = c, H[2 * t + 1] = l, H[2 * e] = u, H[2 * e + 1] = h, H[2 * r] = f, H[2 * r + 1] = g, H[2 * s] = p, H[2 * s + 1] = y;
}
function nw(t, e = {}, r, s, n) {
  if (xt(r), t < 0 || t > r)
    throw new Error("outputLen bigger than keyLen");
  const { key: i, salt: o, personalization: a } = e;
  if (i !== void 0 && (i.length < 1 || i.length > r))
    throw new Error("key length must be undefined or 1.." + r);
  if (o !== void 0 && o.length !== s)
    throw new Error("salt must be undefined or " + s);
  if (a !== void 0 && a.length !== n)
    throw new Error("personalization must be undefined or " + n);
}
class iw extends Gn {
  constructor(e, r) {
    super(), this.finished = !1, this.destroyed = !1, this.length = 0, this.pos = 0, xt(e), xt(r), this.blockLen = e, this.outputLen = r, this.buffer = new Uint8Array(e), this.buffer32 = Is(this.buffer);
  }
  update(e) {
    cr(this), e = ct(e), lt(e);
    const { blockLen: r, buffer: s, buffer32: n } = this, i = e.length, o = e.byteOffset, a = e.buffer;
    for (let c = 0; c < i; ) {
      this.pos === r && (tr(n), this.compress(n, 0, !1), tr(n), this.pos = 0);
      const l = Math.min(r - this.pos, i - c), u = o + c;
      if (l === r && !(u % 4) && c + l < i) {
        const h = new Uint32Array(a, u, Math.floor((i - c) / 4));
        tr(h);
        for (let f = 0; c + r < i; f += n.length, c += r)
          this.length += r, this.compress(h, f, !1);
        tr(h);
        continue;
      }
      s.set(e.subarray(c, c + l), this.pos), this.pos += l, this.length += l, c += l;
    }
    return this;
  }
  digestInto(e) {
    cr(this), sa(e, this);
    const { pos: r, buffer32: s } = this;
    this.finished = !0, Xe(this.buffer.subarray(r)), tr(s), this.compress(s, 0, !0), tr(s);
    const n = Is(e);
    this.get().forEach((i, o) => n[o] = Tt(i));
  }
  digest() {
    const { buffer: e, outputLen: r } = this;
    this.digestInto(e);
    const s = e.slice(0, r);
    return this.destroy(), s;
  }
  _cloneInto(e) {
    const { buffer: r, length: s, finished: n, destroyed: i, outputLen: o, pos: a } = this;
    return e || (e = new this.constructor({ dkLen: o })), e.set(...this.get()), e.buffer.set(r), e.destroyed = i, e.finished = n, e.length = s, e.pos = a, e.outputLen = o, e;
  }
  clone() {
    return this._cloneInto();
  }
}
class ow extends iw {
  constructor(e = {}) {
    const r = e.dkLen === void 0 ? 64 : e.dkLen;
    super(128, r), this.v0l = le[0] | 0, this.v0h = le[1] | 0, this.v1l = le[2] | 0, this.v1h = le[3] | 0, this.v2l = le[4] | 0, this.v2h = le[5] | 0, this.v3l = le[6] | 0, this.v3h = le[7] | 0, this.v4l = le[8] | 0, this.v4h = le[9] | 0, this.v5l = le[10] | 0, this.v5h = le[11] | 0, this.v6l = le[12] | 0, this.v6h = le[13] | 0, this.v7l = le[14] | 0, this.v7h = le[15] | 0, nw(r, e, 64, 16, 16);
    let { key: s, personalization: n, salt: i } = e, o = 0;
    if (s !== void 0 && (s = ct(s), o = s.length), this.v0l ^= this.outputLen | o << 8 | 65536 | 1 << 24, i !== void 0) {
      i = ct(i);
      const a = Is(i);
      this.v4l ^= Tt(a[0]), this.v4h ^= Tt(a[1]), this.v5l ^= Tt(a[2]), this.v5h ^= Tt(a[3]);
    }
    if (n !== void 0) {
      n = ct(n);
      const a = Is(n);
      this.v6l ^= Tt(a[0]), this.v6h ^= Tt(a[1]), this.v7l ^= Tt(a[2]), this.v7h ^= Tt(a[3]);
    }
    if (s !== void 0) {
      const a = new Uint8Array(this.blockLen);
      a.set(s), this.update(a);
    }
  }
  // prettier-ignore
  get() {
    let { v0l: e, v0h: r, v1l: s, v1h: n, v2l: i, v2h: o, v3l: a, v3h: c, v4l: l, v4h: u, v5l: h, v5h: f, v6l: g, v6h: p, v7l: y, v7h: m } = this;
    return [e, r, s, n, i, o, a, c, l, u, h, f, g, p, y, m];
  }
  // prettier-ignore
  set(e, r, s, n, i, o, a, c, l, u, h, f, g, p, y, m) {
    this.v0l = e | 0, this.v0h = r | 0, this.v1l = s | 0, this.v1h = n | 0, this.v2l = i | 0, this.v2h = o | 0, this.v3l = a | 0, this.v3h = c | 0, this.v4l = l | 0, this.v4h = u | 0, this.v5l = h | 0, this.v5h = f | 0, this.v6l = g | 0, this.v6h = p | 0, this.v7l = y | 0, this.v7h = m | 0;
  }
  compress(e, r, s) {
    this.get().forEach((c, l) => H[l] = c), H.set(le, 16);
    let { h: n, l: i } = ku(BigInt(this.length));
    H[24] = le[8] ^ i, H[25] = le[9] ^ n, s && (H[28] = ~H[28], H[29] = ~H[29]);
    let o = 0;
    const a = sw;
    for (let c = 0; c < 12; c++)
      Gt(0, 4, 8, 12, e, r + 2 * a[o++]), Yt(0, 4, 8, 12, e, r + 2 * a[o++]), Gt(1, 5, 9, 13, e, r + 2 * a[o++]), Yt(1, 5, 9, 13, e, r + 2 * a[o++]), Gt(2, 6, 10, 14, e, r + 2 * a[o++]), Yt(2, 6, 10, 14, e, r + 2 * a[o++]), Gt(3, 7, 11, 15, e, r + 2 * a[o++]), Yt(3, 7, 11, 15, e, r + 2 * a[o++]), Gt(0, 5, 10, 15, e, r + 2 * a[o++]), Yt(0, 5, 10, 15, e, r + 2 * a[o++]), Gt(1, 6, 11, 12, e, r + 2 * a[o++]), Yt(1, 6, 11, 12, e, r + 2 * a[o++]), Gt(2, 7, 8, 13, e, r + 2 * a[o++]), Yt(2, 7, 8, 13, e, r + 2 * a[o++]), Gt(3, 4, 9, 14, e, r + 2 * a[o++]), Yt(3, 4, 9, 14, e, r + 2 * a[o++]);
    this.v0l ^= H[0] ^ H[16], this.v0h ^= H[1] ^ H[17], this.v1l ^= H[2] ^ H[18], this.v1h ^= H[3] ^ H[19], this.v2l ^= H[4] ^ H[20], this.v2h ^= H[5] ^ H[21], this.v3l ^= H[6] ^ H[22], this.v3h ^= H[7] ^ H[23], this.v4l ^= H[8] ^ H[24], this.v4h ^= H[9] ^ H[25], this.v5l ^= H[10] ^ H[26], this.v5h ^= H[11] ^ H[27], this.v6l ^= H[12] ^ H[28], this.v6h ^= H[13] ^ H[29], this.v7l ^= H[14] ^ H[30], this.v7h ^= H[15] ^ H[31], Xe(H);
  }
  destroy() {
    this.destroyed = !0, Xe(this.buffer32), this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
}
const aw = /* @__PURE__ */ wg((t) => new ow(t));
/*! scure-base - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function Sh(t) {
  return t instanceof Uint8Array || ArrayBuffer.isView(t) && t.constructor.name === "Uint8Array";
}
function Ih(t, e) {
  return Array.isArray(e) ? e.length === 0 ? !0 : t ? e.every((r) => typeof r == "string") : e.every((r) => Number.isSafeInteger(r)) : !1;
}
function Dn(t, e) {
  if (typeof e != "string")
    throw new Error(`${t}: string expected`);
  return !0;
}
function Ms(t) {
  if (!Number.isSafeInteger(t))
    throw new Error(`invalid integer: ${t}`);
}
function An(t) {
  if (!Array.isArray(t))
    throw new Error("array expected");
}
function On(t, e) {
  if (!Ih(!0, e))
    throw new Error(`${t}: array of strings expected`);
}
function Dh(t, e) {
  if (!Ih(!1, e))
    throw new Error(`${t}: array of numbers expected`);
}
// @__NO_SIDE_EFFECTS__
function Ah(...t) {
  const e = (i) => i, r = (i, o) => (a) => i(o(a)), s = t.map((i) => i.encode).reduceRight(r, e), n = t.map((i) => i.decode).reduce(r, e);
  return { encode: s, decode: n };
}
// @__NO_SIDE_EFFECTS__
function Oh(t) {
  const e = typeof t == "string" ? t.split("") : t, r = e.length;
  On("alphabet", e);
  const s = new Map(e.map((n, i) => [n, i]));
  return {
    encode: (n) => (An(n), n.map((i) => {
      if (!Number.isSafeInteger(i) || i < 0 || i >= r)
        throw new Error(`alphabet.encode: digit index outside alphabet "${i}". Allowed: ${t}`);
      return e[i];
    })),
    decode: (n) => (An(n), n.map((i) => {
      Dn("alphabet.decode", i);
      const o = s.get(i);
      if (o === void 0)
        throw new Error(`Unknown letter: "${i}". Allowed: ${t}`);
      return o;
    }))
  };
}
// @__NO_SIDE_EFFECTS__
function $h(t = "") {
  return Dn("join", t), {
    encode: (e) => (On("join.decode", e), e.join(t)),
    decode: (e) => (Dn("join.decode", e), e.split(t))
  };
}
// @__NO_SIDE_EFFECTS__
function cw(t, e = "=") {
  return Ms(t), Dn("padding", e), {
    encode(r) {
      for (On("padding.encode", r); r.length * t % 8; )
        r.push(e);
      return r;
    },
    decode(r) {
      On("padding.decode", r);
      let s = r.length;
      if (s * t % 8)
        throw new Error("padding: invalid, string should have whole number of bytes");
      for (; s > 0 && r[s - 1] === e; s--)
        if ((s - 1) * t % 8 === 0)
          throw new Error("padding: invalid, string has too much padding");
      return r.slice(0, s);
    }
  };
}
function Cc(t, e, r) {
  if (e < 2)
    throw new Error(`convertRadix: invalid from=${e}, base cannot be less than 2`);
  if (r < 2)
    throw new Error(`convertRadix: invalid to=${r}, base cannot be less than 2`);
  if (An(t), !t.length)
    return [];
  let s = 0;
  const n = [], i = Array.from(t, (a) => {
    if (Ms(a), a < 0 || a >= e)
      throw new Error(`invalid integer: ${a}`);
    return a;
  }), o = i.length;
  for (; ; ) {
    let a = 0, c = !0;
    for (let l = s; l < o; l++) {
      const u = i[l], h = e * a, f = h + u;
      if (!Number.isSafeInteger(f) || h / e !== a || f - u !== h)
        throw new Error("convertRadix: carry overflow");
      const g = f / r;
      a = f % r;
      const p = Math.floor(g);
      if (i[l] = p, !Number.isSafeInteger(p) || p * r + a !== f)
        throw new Error("convertRadix: carry overflow");
      if (c)
        p ? c = !1 : s = l;
      else continue;
    }
    if (n.push(a), c)
      break;
  }
  for (let a = 0; a < t.length - 1 && t[a] === 0; a++)
    n.push(0);
  return n.reverse();
}
const Ph = (t, e) => e === 0 ? t : Ph(e, t % e), $n = /* @__NO_SIDE_EFFECTS__ */ (t, e) => t + (e - Ph(t, e)), Oi = /* @__PURE__ */ (() => {
  let t = [];
  for (let e = 0; e < 40; e++)
    t.push(2 ** e);
  return t;
})();
function Nc(t, e, r, s) {
  if (An(t), e <= 0 || e > 32)
    throw new Error(`convertRadix2: wrong from=${e}`);
  if (r <= 0 || r > 32)
    throw new Error(`convertRadix2: wrong to=${r}`);
  if (/* @__PURE__ */ $n(e, r) > 32)
    throw new Error(`convertRadix2: carry overflow from=${e} to=${r} carryBits=${/* @__PURE__ */ $n(e, r)}`);
  let n = 0, i = 0;
  const o = Oi[e], a = Oi[r] - 1, c = [];
  for (const l of t) {
    if (Ms(l), l >= o)
      throw new Error(`convertRadix2: invalid data word=${l} from=${e}`);
    if (n = n << e | l, i + e > 32)
      throw new Error(`convertRadix2: carry overflow pos=${i} from=${e}`);
    for (i += e; i >= r; i -= r)
      c.push((n >> i - r & a) >>> 0);
    const u = Oi[i];
    if (u === void 0)
      throw new Error("invalid carry");
    n &= u - 1;
  }
  if (n = n << r - i & a, !s && i >= e)
    throw new Error("Excess padding");
  if (!s && n > 0)
    throw new Error(`Non-zero padding: ${n}`);
  return s && i > 0 && c.push(n >>> 0), c;
}
// @__NO_SIDE_EFFECTS__
function lw(t) {
  Ms(t);
  const e = 2 ** 8;
  return {
    encode: (r) => {
      if (!Sh(r))
        throw new Error("radix.encode input should be Uint8Array");
      return Cc(Array.from(r), e, t);
    },
    decode: (r) => (Dh("radix.decode", r), Uint8Array.from(Cc(r, t, e)))
  };
}
// @__NO_SIDE_EFFECTS__
function uw(t, e = !1) {
  if (Ms(t), t <= 0 || t > 32)
    throw new Error("radix2: bits should be in (0..32]");
  if (/* @__PURE__ */ $n(8, t) > 32 || /* @__PURE__ */ $n(t, 8) > 32)
    throw new Error("radix2: carry overflow");
  return {
    encode: (r) => {
      if (!Sh(r))
        throw new Error("radix2.encode input should be Uint8Array");
      return Nc(Array.from(r), 8, t, !e);
    },
    decode: (r) => (Dh("radix2.decode", r), Uint8Array.from(Nc(r, t, 8, e)))
  };
}
const hw = /* @__PURE__ */ Ah(/* @__PURE__ */ uw(5), /* @__PURE__ */ Oh("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"), /* @__PURE__ */ cw(5), /* @__PURE__ */ $h("")), fw = /* @__NO_SIDE_EFFECTS__ */ (t) => /* @__PURE__ */ Ah(/* @__PURE__ */ lw(58), /* @__PURE__ */ Oh(t), /* @__PURE__ */ $h("")), ks = /* @__PURE__ */ fw("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz");
function dw(t) {
  return Iy(pw(t));
}
function pw(t) {
  const { payload: e, signature: r } = t, { r: s, s: n, yParity: i } = r, a = new Xy.Signature(BigInt(s), BigInt(n)).addRecoveryBit(i).recoverPublicKey(ua(e).substring(2));
  return yy(a);
}
/*! noble-ciphers - MIT License (c) 2023 Paul Miller (paulmillr.com) */
function Th(t) {
  return t instanceof Uint8Array || ArrayBuffer.isView(t) && t.constructor.name === "Uint8Array";
}
function _o(t) {
  if (typeof t != "boolean")
    throw new Error(`boolean expected, not ${t}`);
}
function $i(t) {
  if (!Number.isSafeInteger(t) || t < 0)
    throw new Error("positive integer expected, got " + t);
}
function Ce(t, ...e) {
  if (!Th(t))
    throw new Error("Uint8Array expected");
  if (e.length > 0 && !e.includes(t.length))
    throw new Error("Uint8Array expected of length " + e + ", got length=" + t.length);
}
function Uc(t, e = !0) {
  if (t.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (e && t.finished)
    throw new Error("Hash#digest() has already been called");
}
function gw(t, e) {
  Ce(t);
  const r = e.outputLen;
  if (t.length < r)
    throw new Error("digestInto() expects output buffer of length at least " + r);
}
function ir(t) {
  return new Uint32Array(t.buffer, t.byteOffset, Math.floor(t.byteLength / 4));
}
function Qr(...t) {
  for (let e = 0; e < t.length; e++)
    t[e].fill(0);
}
function yw(t) {
  return new DataView(t.buffer, t.byteOffset, t.byteLength);
}
const ww = new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68;
function mw(t) {
  if (typeof t != "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(t));
}
function So(t) {
  if (typeof t == "string")
    t = mw(t);
  else if (Th(t))
    t = Io(t);
  else
    throw new Error("Uint8Array expected, got " + typeof t);
  return t;
}
function bw(t, e) {
  if (e == null || typeof e != "object")
    throw new Error("options must be defined");
  return Object.assign(t, e);
}
function vw(t, e) {
  if (t.length !== e.length)
    return !1;
  let r = 0;
  for (let s = 0; s < t.length; s++)
    r |= t[s] ^ e[s];
  return r === 0;
}
const Ew = /* @__NO_SIDE_EFFECTS__ */ (t, e) => {
  function r(s, ...n) {
    if (Ce(s), !ww)
      throw new Error("Non little-endian hardware is not yet supported");
    if (t.nonceLength !== void 0) {
      const u = n[0];
      if (!u)
        throw new Error("nonce / iv required");
      t.varSizeNonce ? Ce(u) : Ce(u, t.nonceLength);
    }
    const i = t.tagLength;
    i && n[1] !== void 0 && Ce(n[1]);
    const o = e(s, ...n), a = (u, h) => {
      if (h !== void 0) {
        if (u !== 2)
          throw new Error("cipher output not supported");
        Ce(h);
      }
    };
    let c = !1;
    return {
      encrypt(u, h) {
        if (c)
          throw new Error("cannot encrypt() twice with same key + nonce");
        return c = !0, Ce(u), a(o.encrypt.length, h), o.encrypt(u, h);
      },
      decrypt(u, h) {
        if (Ce(u), i && u.length < i)
          throw new Error("invalid ciphertext length: smaller than tagLength=" + i);
        return a(o.decrypt.length, h), o.decrypt(u, h);
      }
    };
  }
  return Object.assign(r, t), r;
};
function Lc(t, e, r = !0) {
  if (e === void 0)
    return new Uint8Array(t);
  if (e.length !== t)
    throw new Error("invalid output length, expected " + t + ", got: " + e.length);
  if (r && !_w(e))
    throw new Error("invalid output, must be aligned");
  return e;
}
function Mc(t, e, r, s) {
  if (typeof t.setBigUint64 == "function")
    return t.setBigUint64(e, r, s);
  const n = BigInt(32), i = BigInt(4294967295), o = Number(r >> n & i), a = Number(r & i), c = 4, l = 0;
  t.setUint32(e + c, o, s), t.setUint32(e + l, a, s);
}
function xw(t, e, r) {
  _o(r);
  const s = new Uint8Array(16), n = yw(s);
  return Mc(n, 0, BigInt(e), r), Mc(n, 8, BigInt(t), r), s;
}
function _w(t) {
  return t.byteOffset % 4 === 0;
}
function Io(t) {
  return Uint8Array.from(t);
}
function Sw(t) {
  const e = t.length;
  let r = 0, s = 0;
  for (; s < e; ) {
    let n = t.charCodeAt(s++);
    if ((n & 4294967168) === 0) {
      r++;
      continue;
    } else if ((n & 4294965248) === 0)
      r += 2;
    else {
      if (n >= 55296 && n <= 56319 && s < e) {
        const i = t.charCodeAt(s);
        (i & 64512) === 56320 && (++s, n = ((n & 1023) << 10) + (i & 1023) + 65536);
      }
      (n & 4294901760) === 0 ? r += 3 : r += 4;
    }
  }
  return r;
}
function Iw(t, e, r) {
  const s = t.length;
  let n = r, i = 0;
  for (; i < s; ) {
    let o = t.charCodeAt(i++);
    if ((o & 4294967168) === 0) {
      e[n++] = o;
      continue;
    } else if ((o & 4294965248) === 0)
      e[n++] = o >> 6 & 31 | 192;
    else {
      if (o >= 55296 && o <= 56319 && i < s) {
        const a = t.charCodeAt(i);
        (a & 64512) === 56320 && (++i, o = ((o & 1023) << 10) + (a & 1023) + 65536);
      }
      (o & 4294901760) === 0 ? (e[n++] = o >> 12 & 15 | 224, e[n++] = o >> 6 & 63 | 128) : (e[n++] = o >> 18 & 7 | 240, e[n++] = o >> 12 & 63 | 128, e[n++] = o >> 6 & 63 | 128);
    }
    e[n++] = o & 63 | 128;
  }
}
const Dw = new TextEncoder(), Aw = 50;
function Ow(t, e, r) {
  Dw.encodeInto(t, e.subarray(r));
}
function $w(t, e, r) {
  t.length > Aw ? Ow(t, e, r) : Iw(t, e, r);
}
const Pw = 4096;
function Bh(t, e, r) {
  let s = e;
  const n = s + r, i = [];
  let o = "";
  for (; s < n; ) {
    const a = t[s++];
    if ((a & 128) === 0)
      i.push(a);
    else if ((a & 224) === 192) {
      const c = t[s++] & 63;
      i.push((a & 31) << 6 | c);
    } else if ((a & 240) === 224) {
      const c = t[s++] & 63, l = t[s++] & 63;
      i.push((a & 31) << 12 | c << 6 | l);
    } else if ((a & 248) === 240) {
      const c = t[s++] & 63, l = t[s++] & 63, u = t[s++] & 63;
      let h = (a & 7) << 18 | c << 12 | l << 6 | u;
      h > 65535 && (h -= 65536, i.push(h >>> 10 & 1023 | 55296), h = 56320 | h & 1023), i.push(h);
    } else
      i.push(a);
    i.length >= Pw && (o += String.fromCharCode(...i), i.length = 0);
  }
  return i.length > 0 && (o += String.fromCharCode(...i)), o;
}
const Tw = new TextDecoder(), Bw = 200;
function Rw(t, e, r) {
  const s = t.subarray(e, e + r);
  return Tw.decode(s);
}
function Cw(t, e, r) {
  return r > Bw ? Rw(t, e, r) : Bh(t, e, r);
}
class Xs {
  type;
  data;
  constructor(e, r) {
    this.type = e, this.data = r;
  }
}
class ke extends Error {
  constructor(e) {
    super(e);
    const r = Object.create(ke.prototype);
    Object.setPrototypeOf(this, r), Object.defineProperty(this, "name", {
      configurable: !0,
      enumerable: !1,
      value: ke.name
    });
  }
}
const cs = 4294967295;
function Nw(t, e, r) {
  const s = r / 4294967296, n = r;
  t.setUint32(e, s), t.setUint32(e + 4, n);
}
function Rh(t, e, r) {
  const s = Math.floor(r / 4294967296), n = r;
  t.setUint32(e, s), t.setUint32(e + 4, n);
}
function Ch(t, e) {
  const r = t.getInt32(e), s = t.getUint32(e + 4);
  return r * 4294967296 + s;
}
function Uw(t, e) {
  const r = t.getUint32(e), s = t.getUint32(e + 4);
  return r * 4294967296 + s;
}
const Lw = -1, Mw = 4294967296 - 1, kw = 17179869184 - 1;
function qw({ sec: t, nsec: e }) {
  if (t >= 0 && e >= 0 && t <= kw)
    if (e === 0 && t <= Mw) {
      const r = new Uint8Array(4);
      return new DataView(r.buffer).setUint32(0, t), r;
    } else {
      const r = t / 4294967296, s = t & 4294967295, n = new Uint8Array(8), i = new DataView(n.buffer);
      return i.setUint32(0, e << 2 | r & 3), i.setUint32(4, s), n;
    }
  else {
    const r = new Uint8Array(12), s = new DataView(r.buffer);
    return s.setUint32(0, e), Rh(s, 4, t), r;
  }
}
function Fw(t) {
  const e = t.getTime(), r = Math.floor(e / 1e3), s = (e - r * 1e3) * 1e6, n = Math.floor(s / 1e9);
  return {
    sec: r + n,
    nsec: s - n * 1e9
  };
}
function jw(t) {
  if (t instanceof Date) {
    const e = Fw(t);
    return qw(e);
  } else
    return null;
}
function zw(t) {
  const e = new DataView(t.buffer, t.byteOffset, t.byteLength);
  switch (t.byteLength) {
    case 4:
      return { sec: e.getUint32(0), nsec: 0 };
    case 8: {
      const r = e.getUint32(0), s = e.getUint32(4), n = (r & 3) * 4294967296 + s, i = r >>> 2;
      return { sec: n, nsec: i };
    }
    case 12: {
      const r = Ch(e, 4), s = e.getUint32(0);
      return { sec: r, nsec: s };
    }
    default:
      throw new ke(`Unrecognized data size for timestamp (expected 4, 8, or 12): ${t.length}`);
  }
}
function Hw(t) {
  const e = zw(t);
  return new Date(e.sec * 1e3 + e.nsec / 1e6);
}
const Kw = {
  type: Lw,
  encode: jw,
  decode: Hw
};
class Jn {
  static defaultCodec = new Jn();
  // ensures ExtensionCodecType<X> matches ExtensionCodec<X>
  // this will make type errors a lot more clear
  // eslint-disable-next-line @typescript-eslint/naming-convention
  __brand;
  // built-in extensions
  builtInEncoders = [];
  builtInDecoders = [];
  // custom extensions
  encoders = [];
  decoders = [];
  constructor() {
    this.register(Kw);
  }
  register({ type: e, encode: r, decode: s }) {
    if (e >= 0)
      this.encoders[e] = r, this.decoders[e] = s;
    else {
      const n = -1 - e;
      this.builtInEncoders[n] = r, this.builtInDecoders[n] = s;
    }
  }
  tryToEncode(e, r) {
    for (let s = 0; s < this.builtInEncoders.length; s++) {
      const n = this.builtInEncoders[s];
      if (n != null) {
        const i = n(e, r);
        if (i != null) {
          const o = -1 - s;
          return new Xs(o, i);
        }
      }
    }
    for (let s = 0; s < this.encoders.length; s++) {
      const n = this.encoders[s];
      if (n != null) {
        const i = n(e, r);
        if (i != null) {
          const o = s;
          return new Xs(o, i);
        }
      }
    }
    return e instanceof Xs ? e : null;
  }
  decode(e, r, s) {
    const n = r < 0 ? this.builtInDecoders[-1 - r] : this.decoders[r];
    return n ? n(e, r, s) : new Xs(r, e);
  }
}
function Vw(t) {
  return t instanceof ArrayBuffer || typeof SharedArrayBuffer < "u" && t instanceof SharedArrayBuffer;
}
function Do(t) {
  return t instanceof Uint8Array ? t : ArrayBuffer.isView(t) ? new Uint8Array(t.buffer, t.byteOffset, t.byteLength) : Vw(t) ? new Uint8Array(t) : Uint8Array.from(t);
}
const Ww = 100, Gw = 2048;
let Yw = class Nh {
  extensionCodec;
  context;
  useBigInt64;
  maxDepth;
  initialBufferSize;
  sortKeys;
  forceFloat32;
  ignoreUndefined;
  forceIntegerToFloat;
  pos;
  view;
  bytes;
  entered = !1;
  constructor(e) {
    this.extensionCodec = e?.extensionCodec ?? Jn.defaultCodec, this.context = e?.context, this.useBigInt64 = e?.useBigInt64 ?? !1, this.maxDepth = e?.maxDepth ?? Ww, this.initialBufferSize = e?.initialBufferSize ?? Gw, this.sortKeys = e?.sortKeys ?? !1, this.forceFloat32 = e?.forceFloat32 ?? !1, this.ignoreUndefined = e?.ignoreUndefined ?? !1, this.forceIntegerToFloat = e?.forceIntegerToFloat ?? !1, this.pos = 0, this.view = new DataView(new ArrayBuffer(this.initialBufferSize)), this.bytes = new Uint8Array(this.view.buffer);
  }
  clone() {
    return new Nh({
      extensionCodec: this.extensionCodec,
      context: this.context,
      useBigInt64: this.useBigInt64,
      maxDepth: this.maxDepth,
      initialBufferSize: this.initialBufferSize,
      sortKeys: this.sortKeys,
      forceFloat32: this.forceFloat32,
      ignoreUndefined: this.ignoreUndefined,
      forceIntegerToFloat: this.forceIntegerToFloat
    });
  }
  reinitializeState() {
    this.pos = 0;
  }
  /**
   * This is almost equivalent to {@link Encoder#encode}, but it returns an reference of the encoder's internal buffer and thus much faster than {@link Encoder#encode}.
   *
   * @returns Encodes the object and returns a shared reference the encoder's internal buffer.
   */
  encodeSharedRef(e) {
    if (this.entered)
      return this.clone().encodeSharedRef(e);
    try {
      return this.entered = !0, this.reinitializeState(), this.doEncode(e, 1), this.bytes.subarray(0, this.pos);
    } finally {
      this.entered = !1;
    }
  }
  /**
   * @returns Encodes the object and returns a copy of the encoder's internal buffer.
   */
  encode(e) {
    if (this.entered)
      return this.clone().encode(e);
    try {
      return this.entered = !0, this.reinitializeState(), this.doEncode(e, 1), this.bytes.slice(0, this.pos);
    } finally {
      this.entered = !1;
    }
  }
  doEncode(e, r) {
    if (r > this.maxDepth)
      throw new Error(`Too deep objects in depth ${r}`);
    e == null ? this.encodeNil() : typeof e == "boolean" ? this.encodeBoolean(e) : typeof e == "number" ? this.forceIntegerToFloat ? this.encodeNumberAsFloat(e) : this.encodeNumber(e) : typeof e == "string" ? this.encodeString(e) : this.useBigInt64 && typeof e == "bigint" ? this.encodeBigInt64(e) : this.encodeObject(e, r);
  }
  ensureBufferSizeToWrite(e) {
    const r = this.pos + e;
    this.view.byteLength < r && this.resizeBuffer(r * 2);
  }
  resizeBuffer(e) {
    const r = new ArrayBuffer(e), s = new Uint8Array(r), n = new DataView(r);
    s.set(this.bytes), this.view = n, this.bytes = s;
  }
  encodeNil() {
    this.writeU8(192);
  }
  encodeBoolean(e) {
    e === !1 ? this.writeU8(194) : this.writeU8(195);
  }
  encodeNumber(e) {
    !this.forceIntegerToFloat && Number.isSafeInteger(e) ? e >= 0 ? e < 128 ? this.writeU8(e) : e < 256 ? (this.writeU8(204), this.writeU8(e)) : e < 65536 ? (this.writeU8(205), this.writeU16(e)) : e < 4294967296 ? (this.writeU8(206), this.writeU32(e)) : this.useBigInt64 ? this.encodeNumberAsFloat(e) : (this.writeU8(207), this.writeU64(e)) : e >= -32 ? this.writeU8(224 | e + 32) : e >= -128 ? (this.writeU8(208), this.writeI8(e)) : e >= -32768 ? (this.writeU8(209), this.writeI16(e)) : e >= -2147483648 ? (this.writeU8(210), this.writeI32(e)) : this.useBigInt64 ? this.encodeNumberAsFloat(e) : (this.writeU8(211), this.writeI64(e)) : this.encodeNumberAsFloat(e);
  }
  encodeNumberAsFloat(e) {
    this.forceFloat32 ? (this.writeU8(202), this.writeF32(e)) : (this.writeU8(203), this.writeF64(e));
  }
  encodeBigInt64(e) {
    e >= BigInt(0) ? (this.writeU8(207), this.writeBigUint64(e)) : (this.writeU8(211), this.writeBigInt64(e));
  }
  writeStringHeader(e) {
    if (e < 32)
      this.writeU8(160 + e);
    else if (e < 256)
      this.writeU8(217), this.writeU8(e);
    else if (e < 65536)
      this.writeU8(218), this.writeU16(e);
    else if (e < 4294967296)
      this.writeU8(219), this.writeU32(e);
    else
      throw new Error(`Too long string: ${e} bytes in UTF-8`);
  }
  encodeString(e) {
    const s = Sw(e);
    this.ensureBufferSizeToWrite(5 + s), this.writeStringHeader(s), $w(e, this.bytes, this.pos), this.pos += s;
  }
  encodeObject(e, r) {
    const s = this.extensionCodec.tryToEncode(e, this.context);
    if (s != null)
      this.encodeExtension(s);
    else if (Array.isArray(e))
      this.encodeArray(e, r);
    else if (ArrayBuffer.isView(e))
      this.encodeBinary(e);
    else if (typeof e == "object")
      this.encodeMap(e, r);
    else
      throw new Error(`Unrecognized object: ${Object.prototype.toString.apply(e)}`);
  }
  encodeBinary(e) {
    const r = e.byteLength;
    if (r < 256)
      this.writeU8(196), this.writeU8(r);
    else if (r < 65536)
      this.writeU8(197), this.writeU16(r);
    else if (r < 4294967296)
      this.writeU8(198), this.writeU32(r);
    else
      throw new Error(`Too large binary: ${r}`);
    const s = Do(e);
    this.writeU8a(s);
  }
  encodeArray(e, r) {
    const s = e.length;
    if (s < 16)
      this.writeU8(144 + s);
    else if (s < 65536)
      this.writeU8(220), this.writeU16(s);
    else if (s < 4294967296)
      this.writeU8(221), this.writeU32(s);
    else
      throw new Error(`Too large array: ${s}`);
    for (const n of e)
      this.doEncode(n, r + 1);
  }
  countWithoutUndefined(e, r) {
    let s = 0;
    for (const n of r)
      e[n] !== void 0 && s++;
    return s;
  }
  encodeMap(e, r) {
    const s = Object.keys(e);
    this.sortKeys && s.sort();
    const n = this.ignoreUndefined ? this.countWithoutUndefined(e, s) : s.length;
    if (n < 16)
      this.writeU8(128 + n);
    else if (n < 65536)
      this.writeU8(222), this.writeU16(n);
    else if (n < 4294967296)
      this.writeU8(223), this.writeU32(n);
    else
      throw new Error(`Too large map object: ${n}`);
    for (const i of s) {
      const o = e[i];
      this.ignoreUndefined && o === void 0 || (this.encodeString(i), this.doEncode(o, r + 1));
    }
  }
  encodeExtension(e) {
    if (typeof e.data == "function") {
      const s = e.data(this.pos + 6), n = s.length;
      if (n >= 4294967296)
        throw new Error(`Too large extension object: ${n}`);
      this.writeU8(201), this.writeU32(n), this.writeI8(e.type), this.writeU8a(s);
      return;
    }
    const r = e.data.length;
    if (r === 1)
      this.writeU8(212);
    else if (r === 2)
      this.writeU8(213);
    else if (r === 4)
      this.writeU8(214);
    else if (r === 8)
      this.writeU8(215);
    else if (r === 16)
      this.writeU8(216);
    else if (r < 256)
      this.writeU8(199), this.writeU8(r);
    else if (r < 65536)
      this.writeU8(200), this.writeU16(r);
    else if (r < 4294967296)
      this.writeU8(201), this.writeU32(r);
    else
      throw new Error(`Too large extension object: ${r}`);
    this.writeI8(e.type), this.writeU8a(e.data);
  }
  writeU8(e) {
    this.ensureBufferSizeToWrite(1), this.view.setUint8(this.pos, e), this.pos++;
  }
  writeU8a(e) {
    const r = e.length;
    this.ensureBufferSizeToWrite(r), this.bytes.set(e, this.pos), this.pos += r;
  }
  writeI8(e) {
    this.ensureBufferSizeToWrite(1), this.view.setInt8(this.pos, e), this.pos++;
  }
  writeU16(e) {
    this.ensureBufferSizeToWrite(2), this.view.setUint16(this.pos, e), this.pos += 2;
  }
  writeI16(e) {
    this.ensureBufferSizeToWrite(2), this.view.setInt16(this.pos, e), this.pos += 2;
  }
  writeU32(e) {
    this.ensureBufferSizeToWrite(4), this.view.setUint32(this.pos, e), this.pos += 4;
  }
  writeI32(e) {
    this.ensureBufferSizeToWrite(4), this.view.setInt32(this.pos, e), this.pos += 4;
  }
  writeF32(e) {
    this.ensureBufferSizeToWrite(4), this.view.setFloat32(this.pos, e), this.pos += 4;
  }
  writeF64(e) {
    this.ensureBufferSizeToWrite(8), this.view.setFloat64(this.pos, e), this.pos += 8;
  }
  writeU64(e) {
    this.ensureBufferSizeToWrite(8), Nw(this.view, this.pos, e), this.pos += 8;
  }
  writeI64(e) {
    this.ensureBufferSizeToWrite(8), Rh(this.view, this.pos, e), this.pos += 8;
  }
  writeBigUint64(e) {
    this.ensureBufferSizeToWrite(8), this.view.setBigUint64(this.pos, e), this.pos += 8;
  }
  writeBigInt64(e) {
    this.ensureBufferSizeToWrite(8), this.view.setBigInt64(this.pos, e), this.pos += 8;
  }
};
function Zw(t, e) {
  return new Yw(e).encodeSharedRef(t);
}
function Pi(t) {
  return `${t < 0 ? "-" : ""}0x${Math.abs(t).toString(16).padStart(2, "0")}`;
}
const Xw = 16, Jw = 16;
class Qw {
  hit = 0;
  miss = 0;
  caches;
  maxKeyLength;
  maxLengthPerKey;
  constructor(e = Xw, r = Jw) {
    this.maxKeyLength = e, this.maxLengthPerKey = r, this.caches = [];
    for (let s = 0; s < this.maxKeyLength; s++)
      this.caches.push([]);
  }
  canBeCached(e) {
    return e > 0 && e <= this.maxKeyLength;
  }
  find(e, r, s) {
    const n = this.caches[s - 1];
    e: for (const i of n) {
      const o = i.bytes;
      for (let a = 0; a < s; a++)
        if (o[a] !== e[r + a])
          continue e;
      return i.str;
    }
    return null;
  }
  store(e, r) {
    const s = this.caches[e.length - 1], n = { bytes: e, str: r };
    s.length >= this.maxLengthPerKey ? s[Math.random() * s.length | 0] = n : s.push(n);
  }
  decode(e, r, s) {
    const n = this.find(e, r, s);
    if (n != null)
      return this.hit++, n;
    this.miss++;
    const i = Bh(e, r, s), o = Uint8Array.prototype.slice.call(e, r, r + s);
    return this.store(o, i), i;
  }
}
const Ao = "array", ms = "map_key", Uh = "map_value", e0 = (t) => {
  if (typeof t == "string" || typeof t == "number")
    return t;
  throw new ke("The type of key must be string or number but " + typeof t);
};
class t0 {
  stack = [];
  stackHeadPosition = -1;
  get length() {
    return this.stackHeadPosition + 1;
  }
  top() {
    return this.stack[this.stackHeadPosition];
  }
  pushArrayState(e) {
    const r = this.getUninitializedStateFromPool();
    r.type = Ao, r.position = 0, r.size = e, r.array = new Array(e);
  }
  pushMapState(e) {
    const r = this.getUninitializedStateFromPool();
    r.type = ms, r.readCount = 0, r.size = e, r.map = {};
  }
  getUninitializedStateFromPool() {
    if (this.stackHeadPosition++, this.stackHeadPosition === this.stack.length) {
      const e = {
        type: void 0,
        size: 0,
        array: void 0,
        position: 0,
        readCount: 0,
        map: void 0,
        key: null
      };
      this.stack.push(e);
    }
    return this.stack[this.stackHeadPosition];
  }
  release(e) {
    if (this.stack[this.stackHeadPosition] !== e)
      throw new Error("Invalid stack state. Released state is not on top of the stack.");
    if (e.type === Ao) {
      const s = e;
      s.size = 0, s.array = void 0, s.position = 0, s.type = void 0;
    }
    if (e.type === ms || e.type === Uh) {
      const s = e;
      s.size = 0, s.map = void 0, s.readCount = 0, s.type = void 0;
    }
    this.stackHeadPosition--;
  }
  reset() {
    this.stack.length = 0, this.stackHeadPosition = -1;
  }
}
const ls = -1, fa = new DataView(new ArrayBuffer(0)), r0 = new Uint8Array(fa.buffer);
try {
  fa.getInt8(0);
} catch (t) {
  if (!(t instanceof RangeError))
    throw new Error("This module is not supported in the current JavaScript engine because DataView does not throw RangeError on out-of-bounds access");
}
const kc = new RangeError("Insufficient data"), s0 = new Qw();
let n0 = class Lh {
  extensionCodec;
  context;
  useBigInt64;
  rawStrings;
  maxStrLength;
  maxBinLength;
  maxArrayLength;
  maxMapLength;
  maxExtLength;
  keyDecoder;
  mapKeyConverter;
  totalPos = 0;
  pos = 0;
  view = fa;
  bytes = r0;
  headByte = ls;
  stack = new t0();
  entered = !1;
  constructor(e) {
    this.extensionCodec = e?.extensionCodec ?? Jn.defaultCodec, this.context = e?.context, this.useBigInt64 = e?.useBigInt64 ?? !1, this.rawStrings = e?.rawStrings ?? !1, this.maxStrLength = e?.maxStrLength ?? cs, this.maxBinLength = e?.maxBinLength ?? cs, this.maxArrayLength = e?.maxArrayLength ?? cs, this.maxMapLength = e?.maxMapLength ?? cs, this.maxExtLength = e?.maxExtLength ?? cs, this.keyDecoder = e?.keyDecoder !== void 0 ? e.keyDecoder : s0, this.mapKeyConverter = e?.mapKeyConverter ?? e0;
  }
  clone() {
    return new Lh({
      extensionCodec: this.extensionCodec,
      context: this.context,
      useBigInt64: this.useBigInt64,
      rawStrings: this.rawStrings,
      maxStrLength: this.maxStrLength,
      maxBinLength: this.maxBinLength,
      maxArrayLength: this.maxArrayLength,
      maxMapLength: this.maxMapLength,
      maxExtLength: this.maxExtLength,
      keyDecoder: this.keyDecoder
    });
  }
  reinitializeState() {
    this.totalPos = 0, this.headByte = ls, this.stack.reset();
  }
  setBuffer(e) {
    const r = Do(e);
    this.bytes = r, this.view = new DataView(r.buffer, r.byteOffset, r.byteLength), this.pos = 0;
  }
  appendBuffer(e) {
    if (this.headByte === ls && !this.hasRemaining(1))
      this.setBuffer(e);
    else {
      const r = this.bytes.subarray(this.pos), s = Do(e), n = new Uint8Array(r.length + s.length);
      n.set(r), n.set(s, r.length), this.setBuffer(n);
    }
  }
  hasRemaining(e) {
    return this.view.byteLength - this.pos >= e;
  }
  createExtraByteError(e) {
    const { view: r, pos: s } = this;
    return new RangeError(`Extra ${r.byteLength - s} of ${r.byteLength} byte(s) found at buffer[${e}]`);
  }
  /**
   * @throws {@link DecodeError}
   * @throws {@link RangeError}
   */
  decode(e) {
    if (this.entered)
      return this.clone().decode(e);
    try {
      this.entered = !0, this.reinitializeState(), this.setBuffer(e);
      const r = this.doDecodeSync();
      if (this.hasRemaining(1))
        throw this.createExtraByteError(this.pos);
      return r;
    } finally {
      this.entered = !1;
    }
  }
  *decodeMulti(e) {
    if (this.entered) {
      yield* this.clone().decodeMulti(e);
      return;
    }
    try {
      for (this.entered = !0, this.reinitializeState(), this.setBuffer(e); this.hasRemaining(1); )
        yield this.doDecodeSync();
    } finally {
      this.entered = !1;
    }
  }
  async decodeAsync(e) {
    if (this.entered)
      return this.clone().decodeAsync(e);
    try {
      this.entered = !0;
      let r = !1, s;
      for await (const a of e) {
        if (r)
          throw this.entered = !1, this.createExtraByteError(this.totalPos);
        this.appendBuffer(a);
        try {
          s = this.doDecodeSync(), r = !0;
        } catch (c) {
          if (!(c instanceof RangeError))
            throw c;
        }
        this.totalPos += this.pos;
      }
      if (r) {
        if (this.hasRemaining(1))
          throw this.createExtraByteError(this.totalPos);
        return s;
      }
      const { headByte: n, pos: i, totalPos: o } = this;
      throw new RangeError(`Insufficient data in parsing ${Pi(n)} at ${o} (${i} in the current buffer)`);
    } finally {
      this.entered = !1;
    }
  }
  decodeArrayStream(e) {
    return this.decodeMultiAsync(e, !0);
  }
  decodeStream(e) {
    return this.decodeMultiAsync(e, !1);
  }
  async *decodeMultiAsync(e, r) {
    if (this.entered) {
      yield* this.clone().decodeMultiAsync(e, r);
      return;
    }
    try {
      this.entered = !0;
      let s = r, n = -1;
      for await (const i of e) {
        if (r && n === 0)
          throw this.createExtraByteError(this.totalPos);
        this.appendBuffer(i), s && (n = this.readArraySize(), s = !1, this.complete());
        try {
          for (; yield this.doDecodeSync(), --n !== 0; )
            ;
        } catch (o) {
          if (!(o instanceof RangeError))
            throw o;
        }
        this.totalPos += this.pos;
      }
    } finally {
      this.entered = !1;
    }
  }
  doDecodeSync() {
    e: for (; ; ) {
      const e = this.readHeadByte();
      let r;
      if (e >= 224)
        r = e - 256;
      else if (e < 192)
        if (e < 128)
          r = e;
        else if (e < 144) {
          const n = e - 128;
          if (n !== 0) {
            this.pushMapState(n), this.complete();
            continue e;
          } else
            r = {};
        } else if (e < 160) {
          const n = e - 144;
          if (n !== 0) {
            this.pushArrayState(n), this.complete();
            continue e;
          } else
            r = [];
        } else {
          const n = e - 160;
          r = this.decodeString(n, 0);
        }
      else if (e === 192)
        r = null;
      else if (e === 194)
        r = !1;
      else if (e === 195)
        r = !0;
      else if (e === 202)
        r = this.readF32();
      else if (e === 203)
        r = this.readF64();
      else if (e === 204)
        r = this.readU8();
      else if (e === 205)
        r = this.readU16();
      else if (e === 206)
        r = this.readU32();
      else if (e === 207)
        this.useBigInt64 ? r = this.readU64AsBigInt() : r = this.readU64();
      else if (e === 208)
        r = this.readI8();
      else if (e === 209)
        r = this.readI16();
      else if (e === 210)
        r = this.readI32();
      else if (e === 211)
        this.useBigInt64 ? r = this.readI64AsBigInt() : r = this.readI64();
      else if (e === 217) {
        const n = this.lookU8();
        r = this.decodeString(n, 1);
      } else if (e === 218) {
        const n = this.lookU16();
        r = this.decodeString(n, 2);
      } else if (e === 219) {
        const n = this.lookU32();
        r = this.decodeString(n, 4);
      } else if (e === 220) {
        const n = this.readU16();
        if (n !== 0) {
          this.pushArrayState(n), this.complete();
          continue e;
        } else
          r = [];
      } else if (e === 221) {
        const n = this.readU32();
        if (n !== 0) {
          this.pushArrayState(n), this.complete();
          continue e;
        } else
          r = [];
      } else if (e === 222) {
        const n = this.readU16();
        if (n !== 0) {
          this.pushMapState(n), this.complete();
          continue e;
        } else
          r = {};
      } else if (e === 223) {
        const n = this.readU32();
        if (n !== 0) {
          this.pushMapState(n), this.complete();
          continue e;
        } else
          r = {};
      } else if (e === 196) {
        const n = this.lookU8();
        r = this.decodeBinary(n, 1);
      } else if (e === 197) {
        const n = this.lookU16();
        r = this.decodeBinary(n, 2);
      } else if (e === 198) {
        const n = this.lookU32();
        r = this.decodeBinary(n, 4);
      } else if (e === 212)
        r = this.decodeExtension(1, 0);
      else if (e === 213)
        r = this.decodeExtension(2, 0);
      else if (e === 214)
        r = this.decodeExtension(4, 0);
      else if (e === 215)
        r = this.decodeExtension(8, 0);
      else if (e === 216)
        r = this.decodeExtension(16, 0);
      else if (e === 199) {
        const n = this.lookU8();
        r = this.decodeExtension(n, 1);
      } else if (e === 200) {
        const n = this.lookU16();
        r = this.decodeExtension(n, 2);
      } else if (e === 201) {
        const n = this.lookU32();
        r = this.decodeExtension(n, 4);
      } else
        throw new ke(`Unrecognized type byte: ${Pi(e)}`);
      this.complete();
      const s = this.stack;
      for (; s.length > 0; ) {
        const n = s.top();
        if (n.type === Ao)
          if (n.array[n.position] = r, n.position++, n.position === n.size)
            r = n.array, s.release(n);
          else
            continue e;
        else if (n.type === ms) {
          if (r === "__proto__")
            throw new ke("The key __proto__ is not allowed");
          n.key = this.mapKeyConverter(r), n.type = Uh;
          continue e;
        } else if (n.map[n.key] = r, n.readCount++, n.readCount === n.size)
          r = n.map, s.release(n);
        else {
          n.key = null, n.type = ms;
          continue e;
        }
      }
      return r;
    }
  }
  readHeadByte() {
    return this.headByte === ls && (this.headByte = this.readU8()), this.headByte;
  }
  complete() {
    this.headByte = ls;
  }
  readArraySize() {
    const e = this.readHeadByte();
    switch (e) {
      case 220:
        return this.readU16();
      case 221:
        return this.readU32();
      default: {
        if (e < 160)
          return e - 144;
        throw new ke(`Unrecognized array type byte: ${Pi(e)}`);
      }
    }
  }
  pushMapState(e) {
    if (e > this.maxMapLength)
      throw new ke(`Max length exceeded: map length (${e}) > maxMapLengthLength (${this.maxMapLength})`);
    this.stack.pushMapState(e);
  }
  pushArrayState(e) {
    if (e > this.maxArrayLength)
      throw new ke(`Max length exceeded: array length (${e}) > maxArrayLength (${this.maxArrayLength})`);
    this.stack.pushArrayState(e);
  }
  decodeString(e, r) {
    return !this.rawStrings || this.stateIsMapKey() ? this.decodeUtf8String(e, r) : this.decodeBinary(e, r);
  }
  /**
   * @throws {@link RangeError}
   */
  decodeUtf8String(e, r) {
    if (e > this.maxStrLength)
      throw new ke(`Max length exceeded: UTF-8 byte length (${e}) > maxStrLength (${this.maxStrLength})`);
    if (this.bytes.byteLength < this.pos + r + e)
      throw kc;
    const s = this.pos + r;
    let n;
    return this.stateIsMapKey() && this.keyDecoder?.canBeCached(e) ? n = this.keyDecoder.decode(this.bytes, s, e) : n = Cw(this.bytes, s, e), this.pos += r + e, n;
  }
  stateIsMapKey() {
    return this.stack.length > 0 ? this.stack.top().type === ms : !1;
  }
  /**
   * @throws {@link RangeError}
   */
  decodeBinary(e, r) {
    if (e > this.maxBinLength)
      throw new ke(`Max length exceeded: bin length (${e}) > maxBinLength (${this.maxBinLength})`);
    if (!this.hasRemaining(e + r))
      throw kc;
    const s = this.pos + r, n = this.bytes.subarray(s, s + e);
    return this.pos += r + e, n;
  }
  decodeExtension(e, r) {
    if (e > this.maxExtLength)
      throw new ke(`Max length exceeded: ext length (${e}) > maxExtLength (${this.maxExtLength})`);
    const s = this.view.getInt8(this.pos + r), n = this.decodeBinary(
      e,
      r + 1
      /* extType */
    );
    return this.extensionCodec.decode(n, s, this.context);
  }
  lookU8() {
    return this.view.getUint8(this.pos);
  }
  lookU16() {
    return this.view.getUint16(this.pos);
  }
  lookU32() {
    return this.view.getUint32(this.pos);
  }
  readU8() {
    const e = this.view.getUint8(this.pos);
    return this.pos++, e;
  }
  readI8() {
    const e = this.view.getInt8(this.pos);
    return this.pos++, e;
  }
  readU16() {
    const e = this.view.getUint16(this.pos);
    return this.pos += 2, e;
  }
  readI16() {
    const e = this.view.getInt16(this.pos);
    return this.pos += 2, e;
  }
  readU32() {
    const e = this.view.getUint32(this.pos);
    return this.pos += 4, e;
  }
  readI32() {
    const e = this.view.getInt32(this.pos);
    return this.pos += 4, e;
  }
  readU64() {
    const e = Uw(this.view, this.pos);
    return this.pos += 8, e;
  }
  readI64() {
    const e = Ch(this.view, this.pos);
    return this.pos += 8, e;
  }
  readU64AsBigInt() {
    const e = this.view.getBigUint64(this.pos);
    return this.pos += 8, e;
  }
  readI64AsBigInt() {
    const e = this.view.getBigInt64(this.pos);
    return this.pos += 8, e;
  }
  readF32() {
    const e = this.view.getFloat32(this.pos);
    return this.pos += 4, e;
  }
  readF64() {
    const e = this.view.getFloat64(this.pos);
    return this.pos += 8, e;
  }
};
function i0(t, e) {
  return new n0(e).decode(t);
}
function da(t) {
  return globalThis.Buffer != null ? new Uint8Array(t.buffer, t.byteOffset, t.byteLength) : t;
}
function Mh(t = 0) {
  return globalThis.Buffer != null && globalThis.Buffer.allocUnsafe != null ? da(globalThis.Buffer.allocUnsafe(t)) : new Uint8Array(t);
}
function kt(t, e) {
  e || (e = t.reduce((n, i) => n + i.length, 0));
  const r = Mh(e);
  let s = 0;
  for (const n of t)
    r.set(n, s), s += n.length;
  return da(r);
}
function o0(t, e) {
  if (t.length >= 255)
    throw new TypeError("Alphabet too long");
  for (var r = new Uint8Array(256), s = 0; s < r.length; s++)
    r[s] = 255;
  for (var n = 0; n < t.length; n++) {
    var i = t.charAt(n), o = i.charCodeAt(0);
    if (r[o] !== 255)
      throw new TypeError(i + " is ambiguous");
    r[o] = n;
  }
  var a = t.length, c = t.charAt(0), l = Math.log(a) / Math.log(256), u = Math.log(256) / Math.log(a);
  function h(p) {
    if (p instanceof Uint8Array || (ArrayBuffer.isView(p) ? p = new Uint8Array(p.buffer, p.byteOffset, p.byteLength) : Array.isArray(p) && (p = Uint8Array.from(p))), !(p instanceof Uint8Array))
      throw new TypeError("Expected Uint8Array");
    if (p.length === 0)
      return "";
    for (var y = 0, m = 0, E = 0, $ = p.length; E !== $ && p[E] === 0; )
      E++, y++;
    for (var b = ($ - E) * u + 1 >>> 0, v = new Uint8Array(b); E !== $; ) {
      for (var x = p[E], I = 0, P = b - 1; (x !== 0 || I < m) && P !== -1; P--, I++)
        x += 256 * v[P] >>> 0, v[P] = x % a >>> 0, x = x / a >>> 0;
      if (x !== 0)
        throw new Error("Non-zero carry");
      m = I, E++;
    }
    for (var B = b - m; B !== b && v[B] === 0; )
      B++;
    for (var T = c.repeat(y); B < b; ++B)
      T += t.charAt(v[B]);
    return T;
  }
  function f(p) {
    if (typeof p != "string")
      throw new TypeError("Expected String");
    if (p.length === 0)
      return new Uint8Array();
    var y = 0;
    if (p[y] !== " ") {
      for (var m = 0, E = 0; p[y] === c; )
        m++, y++;
      for (var $ = (p.length - y) * l + 1 >>> 0, b = new Uint8Array($); p[y]; ) {
        var v = r[p.charCodeAt(y)];
        if (v === 255)
          return;
        for (var x = 0, I = $ - 1; (v !== 0 || x < E) && I !== -1; I--, x++)
          v += a * b[I] >>> 0, b[I] = v % 256 >>> 0, v = v / 256 >>> 0;
        if (v !== 0)
          throw new Error("Non-zero carry");
        E = x, y++;
      }
      if (p[y] !== " ") {
        for (var P = $ - E; P !== $ && b[P] === 0; )
          P++;
        for (var B = new Uint8Array(m + ($ - P)), T = m; P !== $; )
          B[T++] = b[P++];
        return B;
      }
    }
  }
  function g(p) {
    var y = f(p);
    if (y)
      return y;
    throw new Error(`Non-${e} character`);
  }
  return {
    encode: h,
    decodeUnsafe: f,
    decode: g
  };
}
var a0 = o0, c0 = a0;
const l0 = (t) => {
  if (t instanceof Uint8Array && t.constructor.name === "Uint8Array")
    return t;
  if (t instanceof ArrayBuffer)
    return new Uint8Array(t);
  if (ArrayBuffer.isView(t))
    return new Uint8Array(t.buffer, t.byteOffset, t.byteLength);
  throw new Error("Unknown type, must be binary type");
}, u0 = (t) => new TextEncoder().encode(t), h0 = (t) => new TextDecoder().decode(t);
class f0 {
  constructor(e, r, s) {
    this.name = e, this.prefix = r, this.baseEncode = s;
  }
  encode(e) {
    if (e instanceof Uint8Array)
      return `${this.prefix}${this.baseEncode(e)}`;
    throw Error("Unknown type, must be binary type");
  }
}
class d0 {
  constructor(e, r, s) {
    if (this.name = e, this.prefix = r, r.codePointAt(0) === void 0)
      throw new Error("Invalid prefix character");
    this.prefixCodePoint = r.codePointAt(0), this.baseDecode = s;
  }
  decode(e) {
    if (typeof e == "string") {
      if (e.codePointAt(0) !== this.prefixCodePoint)
        throw Error(`Unable to decode multibase string ${JSON.stringify(e)}, ${this.name} decoder only supports inputs prefixed with ${this.prefix}`);
      return this.baseDecode(e.slice(this.prefix.length));
    } else
      throw Error("Can only multibase decode strings");
  }
  or(e) {
    return kh(this, e);
  }
}
class p0 {
  constructor(e) {
    this.decoders = e;
  }
  or(e) {
    return kh(this, e);
  }
  decode(e) {
    const r = e[0], s = this.decoders[r];
    if (s)
      return s.decode(e);
    throw RangeError(`Unable to decode multibase string ${JSON.stringify(e)}, only inputs prefixed with ${Object.keys(this.decoders)} are supported`);
  }
}
const kh = (t, e) => new p0({
  ...t.decoders || { [t.prefix]: t },
  ...e.decoders || { [e.prefix]: e }
});
class g0 {
  constructor(e, r, s, n) {
    this.name = e, this.prefix = r, this.baseEncode = s, this.baseDecode = n, this.encoder = new f0(e, r, s), this.decoder = new d0(e, r, n);
  }
  encode(e) {
    return this.encoder.encode(e);
  }
  decode(e) {
    return this.decoder.decode(e);
  }
}
const Qn = ({ name: t, prefix: e, encode: r, decode: s }) => new g0(t, e, r, s), qs = ({ prefix: t, name: e, alphabet: r }) => {
  const { encode: s, decode: n } = c0(r, e);
  return Qn({
    prefix: t,
    name: e,
    encode: s,
    decode: (i) => l0(n(i))
  });
}, y0 = (t, e, r, s) => {
  const n = {};
  for (let u = 0; u < e.length; ++u)
    n[e[u]] = u;
  let i = t.length;
  for (; t[i - 1] === "="; )
    --i;
  const o = new Uint8Array(i * r / 8 | 0);
  let a = 0, c = 0, l = 0;
  for (let u = 0; u < i; ++u) {
    const h = n[t[u]];
    if (h === void 0)
      throw new SyntaxError(`Non-${s} character`);
    c = c << r | h, a += r, a >= 8 && (a -= 8, o[l++] = 255 & c >> a);
  }
  if (a >= r || 255 & c << 8 - a)
    throw new SyntaxError("Unexpected end of data");
  return o;
}, w0 = (t, e, r) => {
  const s = e[e.length - 1] === "=", n = (1 << r) - 1;
  let i = "", o = 0, a = 0;
  for (let c = 0; c < t.length; ++c)
    for (a = a << 8 | t[c], o += 8; o > r; )
      o -= r, i += e[n & a >> o];
  if (o && (i += e[n & a << r - o]), s)
    for (; i.length * r & 7; )
      i += "=";
  return i;
}, ve = ({ name: t, prefix: e, bitsPerChar: r, alphabet: s }) => Qn({
  prefix: e,
  name: t,
  encode(n) {
    return w0(n, s, r);
  },
  decode(n) {
    return y0(n, s, r, t);
  }
}), m0 = Qn({
  prefix: "\0",
  name: "identity",
  encode: (t) => h0(t),
  decode: (t) => u0(t)
}), b0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  identity: m0
}, Symbol.toStringTag, { value: "Module" })), v0 = ve({
  prefix: "0",
  name: "base2",
  alphabet: "01",
  bitsPerChar: 1
}), E0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  base2: v0
}, Symbol.toStringTag, { value: "Module" })), x0 = ve({
  prefix: "7",
  name: "base8",
  alphabet: "01234567",
  bitsPerChar: 3
}), _0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  base8: x0
}, Symbol.toStringTag, { value: "Module" })), S0 = qs({
  prefix: "9",
  name: "base10",
  alphabet: "0123456789"
}), I0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  base10: S0
}, Symbol.toStringTag, { value: "Module" })), D0 = ve({
  prefix: "f",
  name: "base16",
  alphabet: "0123456789abcdef",
  bitsPerChar: 4
}), A0 = ve({
  prefix: "F",
  name: "base16upper",
  alphabet: "0123456789ABCDEF",
  bitsPerChar: 4
}), O0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  base16: D0,
  base16upper: A0
}, Symbol.toStringTag, { value: "Module" })), $0 = ve({
  prefix: "b",
  name: "base32",
  alphabet: "abcdefghijklmnopqrstuvwxyz234567",
  bitsPerChar: 5
}), P0 = ve({
  prefix: "B",
  name: "base32upper",
  alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
  bitsPerChar: 5
}), T0 = ve({
  prefix: "c",
  name: "base32pad",
  alphabet: "abcdefghijklmnopqrstuvwxyz234567=",
  bitsPerChar: 5
}), B0 = ve({
  prefix: "C",
  name: "base32padupper",
  alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567=",
  bitsPerChar: 5
}), R0 = ve({
  prefix: "v",
  name: "base32hex",
  alphabet: "0123456789abcdefghijklmnopqrstuv",
  bitsPerChar: 5
}), C0 = ve({
  prefix: "V",
  name: "base32hexupper",
  alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUV",
  bitsPerChar: 5
}), N0 = ve({
  prefix: "t",
  name: "base32hexpad",
  alphabet: "0123456789abcdefghijklmnopqrstuv=",
  bitsPerChar: 5
}), U0 = ve({
  prefix: "T",
  name: "base32hexpadupper",
  alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUV=",
  bitsPerChar: 5
}), L0 = ve({
  prefix: "h",
  name: "base32z",
  alphabet: "ybndrfg8ejkmcpqxot1uwisza345h769",
  bitsPerChar: 5
}), M0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  base32: $0,
  base32hex: R0,
  base32hexpad: N0,
  base32hexpadupper: U0,
  base32hexupper: C0,
  base32pad: T0,
  base32padupper: B0,
  base32upper: P0,
  base32z: L0
}, Symbol.toStringTag, { value: "Module" })), k0 = qs({
  prefix: "k",
  name: "base36",
  alphabet: "0123456789abcdefghijklmnopqrstuvwxyz"
}), q0 = qs({
  prefix: "K",
  name: "base36upper",
  alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
}), F0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  base36: k0,
  base36upper: q0
}, Symbol.toStringTag, { value: "Module" })), j0 = qs({
  name: "base58btc",
  prefix: "z",
  alphabet: "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
}), z0 = qs({
  name: "base58flickr",
  prefix: "Z",
  alphabet: "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ"
}), H0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  base58btc: j0,
  base58flickr: z0
}, Symbol.toStringTag, { value: "Module" })), K0 = ve({
  prefix: "m",
  name: "base64",
  alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
  bitsPerChar: 6
}), V0 = ve({
  prefix: "M",
  name: "base64pad",
  alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
  bitsPerChar: 6
}), W0 = ve({
  prefix: "u",
  name: "base64url",
  alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  bitsPerChar: 6
}), G0 = ve({
  prefix: "U",
  name: "base64urlpad",
  alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=",
  bitsPerChar: 6
}), Y0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  base64: K0,
  base64pad: V0,
  base64url: W0,
  base64urlpad: G0
}, Symbol.toStringTag, { value: "Module" })), qh = Array.from("🚀🪐☄🛰🌌🌑🌒🌓🌔🌕🌖🌗🌘🌍🌏🌎🐉☀💻🖥💾💿😂❤😍🤣😊🙏💕😭😘👍😅👏😁🔥🥰💔💖💙😢🤔😆🙄💪😉☺👌🤗💜😔😎😇🌹🤦🎉💞✌✨🤷😱😌🌸🙌😋💗💚😏💛🙂💓🤩😄😀🖤😃💯🙈👇🎶😒🤭❣😜💋👀😪😑💥🙋😞😩😡🤪👊🥳😥🤤👉💃😳✋😚😝😴🌟😬🙃🍀🌷😻😓⭐✅🥺🌈😈🤘💦✔😣🏃💐☹🎊💘😠☝😕🌺🎂🌻😐🖕💝🙊😹🗣💫💀👑🎵🤞😛🔴😤🌼😫⚽🤙☕🏆🤫👈😮🙆🍻🍃🐶💁😲🌿🧡🎁⚡🌞🎈❌✊👋😰🤨😶🤝🚶💰🍓💢🤟🙁🚨💨🤬✈🎀🍺🤓😙💟🌱😖👶🥴▶➡❓💎💸⬇😨🌚🦋😷🕺⚠🙅😟😵👎🤲🤠🤧📌🔵💅🧐🐾🍒😗🤑🌊🤯🐷☎💧😯💆👆🎤🙇🍑❄🌴💣🐸💌📍🥀🤢👅💡💩👐📸👻🤐🤮🎼🥵🚩🍎🍊👼💍📣🥂"), Z0 = qh.reduce((t, e, r) => (t[r] = e, t), []), X0 = qh.reduce((t, e, r) => (t[e.codePointAt(0)] = r, t), []);
function J0(t) {
  return t.reduce((e, r) => (e += Z0[r], e), "");
}
function Q0(t) {
  const e = [];
  for (const r of t) {
    const s = X0[r.codePointAt(0)];
    if (s === void 0)
      throw new Error(`Non-base256emoji character: ${r}`);
    e.push(s);
  }
  return new Uint8Array(e);
}
const em = Qn({
  prefix: "🚀",
  name: "base256emoji",
  encode: J0,
  decode: Q0
}), tm = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  base256emoji: em
}, Symbol.toStringTag, { value: "Module" }));
new TextEncoder();
new TextDecoder();
const qc = {
  ...b0,
  ...E0,
  ..._0,
  ...I0,
  ...O0,
  ...M0,
  ...F0,
  ...H0,
  ...Y0,
  ...tm
};
function Fh(t, e, r, s) {
  return {
    name: t,
    prefix: e,
    encoder: {
      name: t,
      prefix: e,
      encode: r
    },
    decoder: { decode: s }
  };
}
const Fc = Fh("utf8", "u", (t) => "u" + new TextDecoder("utf8").decode(t), (t) => new TextEncoder().encode(t.substring(1))), Ti = Fh("ascii", "a", (t) => {
  let e = "a";
  for (let r = 0; r < t.length; r++)
    e += String.fromCharCode(t[r]);
  return e;
}, (t) => {
  t = t.substring(1);
  const e = Mh(t.length);
  for (let r = 0; r < t.length; r++)
    e[r] = t.charCodeAt(r);
  return e;
}), jh = {
  utf8: Fc,
  "utf-8": Fc,
  hex: qc.base16,
  latin1: Ti,
  ascii: Ti,
  binary: Ti,
  ...qc
};
function De(t, e = "utf8") {
  const r = jh[e];
  if (!r)
    throw new Error(`Unsupported encoding "${e}"`);
  return (e === "utf8" || e === "utf-8") && globalThis.Buffer != null && globalThis.Buffer.from != null ? da(globalThis.Buffer.from(t, "utf-8")) : r.decoder.decode(`${r.prefix}${t}`);
}
function fe(t, e = "utf8") {
  const r = jh[e];
  if (!r)
    throw new Error(`Unsupported encoding "${e}"`);
  return (e === "utf8" || e === "utf-8") && globalThis.Buffer != null && globalThis.Buffer.from != null ? globalThis.Buffer.from(t.buffer, t.byteOffset, t.byteLength).toString("utf8") : r.encoder.encode(t).substring(1);
}
const zh = (t) => Uint8Array.from(t.split("").map((e) => e.charCodeAt(0))), rm = zh("expand 16-byte k"), sm = zh("expand 32-byte k"), nm = ir(rm), im = ir(sm);
function X(t, e) {
  return t << e | t >>> 32 - e;
}
function Oo(t) {
  return t.byteOffset % 4 === 0;
}
const Js = 64, om = 16, Hh = 2 ** 32 - 1, jc = new Uint32Array();
function am(t, e, r, s, n, i, o, a) {
  const c = n.length, l = new Uint8Array(Js), u = ir(l), h = Oo(n) && Oo(i), f = h ? ir(n) : jc, g = h ? ir(i) : jc;
  for (let p = 0; p < c; o++) {
    if (t(e, r, s, u, o, a), o >= Hh)
      throw new Error("arx: counter overflow");
    const y = Math.min(Js, c - p);
    if (h && y === Js) {
      const m = p / 4;
      if (p % 4 !== 0)
        throw new Error("arx: invalid block position");
      for (let E = 0, $; E < om; E++)
        $ = m + E, g[$] = f[$] ^ u[E];
      p += Js;
      continue;
    }
    for (let m = 0, E; m < y; m++)
      E = p + m, i[E] = n[E] ^ l[m];
    p += y;
  }
}
function cm(t, e) {
  const { allowShortKeys: r, extendNonceFn: s, counterLength: n, counterRight: i, rounds: o } = bw({ allowShortKeys: !1, counterLength: 8, counterRight: !1, rounds: 20 }, e);
  if (typeof t != "function")
    throw new Error("core must be a function");
  return $i(n), $i(o), _o(i), _o(r), (a, c, l, u, h = 0) => {
    Ce(a), Ce(c), Ce(l);
    const f = l.length;
    if (u === void 0 && (u = new Uint8Array(f)), Ce(u), $i(h), h < 0 || h >= Hh)
      throw new Error("arx: counter overflow");
    if (u.length < f)
      throw new Error(`arx: output (${u.length}) is shorter than data (${f})`);
    const g = [];
    let p = a.length, y, m;
    if (p === 32)
      g.push(y = Io(a)), m = im;
    else if (p === 16 && r)
      y = new Uint8Array(32), y.set(a), y.set(a, 16), m = nm, g.push(y);
    else
      throw new Error(`arx: invalid 32-byte key, got length=${p}`);
    Oo(c) || g.push(c = Io(c));
    const E = ir(y);
    if (s) {
      if (c.length !== 24)
        throw new Error("arx: extended nonce must be 24 bytes");
      s(m, E, ir(c.subarray(0, 16)), E), c = c.subarray(16);
    }
    const $ = 16 - n;
    if ($ !== c.length)
      throw new Error(`arx: nonce must be ${$} or 16 bytes`);
    if ($ !== 12) {
      const v = new Uint8Array(12);
      v.set(c, i ? 0 : 12 - c.length), c = v, g.push(c);
    }
    const b = ir(c);
    return am(t, m, E, b, l, u, h, o), Qr(...g), u;
  };
}
const we = (t, e) => t[e++] & 255 | (t[e++] & 255) << 8;
class lm {
  constructor(e) {
    this.blockLen = 16, this.outputLen = 16, this.buffer = new Uint8Array(16), this.r = new Uint16Array(10), this.h = new Uint16Array(10), this.pad = new Uint16Array(8), this.pos = 0, this.finished = !1, e = So(e), Ce(e, 32);
    const r = we(e, 0), s = we(e, 2), n = we(e, 4), i = we(e, 6), o = we(e, 8), a = we(e, 10), c = we(e, 12), l = we(e, 14);
    this.r[0] = r & 8191, this.r[1] = (r >>> 13 | s << 3) & 8191, this.r[2] = (s >>> 10 | n << 6) & 7939, this.r[3] = (n >>> 7 | i << 9) & 8191, this.r[4] = (i >>> 4 | o << 12) & 255, this.r[5] = o >>> 1 & 8190, this.r[6] = (o >>> 14 | a << 2) & 8191, this.r[7] = (a >>> 11 | c << 5) & 8065, this.r[8] = (c >>> 8 | l << 8) & 8191, this.r[9] = l >>> 5 & 127;
    for (let u = 0; u < 8; u++)
      this.pad[u] = we(e, 16 + 2 * u);
  }
  process(e, r, s = !1) {
    const n = s ? 0 : 2048, { h: i, r: o } = this, a = o[0], c = o[1], l = o[2], u = o[3], h = o[4], f = o[5], g = o[6], p = o[7], y = o[8], m = o[9], E = we(e, r + 0), $ = we(e, r + 2), b = we(e, r + 4), v = we(e, r + 6), x = we(e, r + 8), I = we(e, r + 10), P = we(e, r + 12), B = we(e, r + 14);
    let T = i[0] + (E & 8191), L = i[1] + ((E >>> 13 | $ << 3) & 8191), U = i[2] + (($ >>> 10 | b << 6) & 8191), N = i[3] + ((b >>> 7 | v << 9) & 8191), A = i[4] + ((v >>> 4 | x << 12) & 8191), R = i[5] + (x >>> 1 & 8191), d = i[6] + ((x >>> 14 | I << 2) & 8191), w = i[7] + ((I >>> 11 | P << 5) & 8191), _ = i[8] + ((P >>> 8 | B << 8) & 8191), O = i[9] + (B >>> 5 | n), S = 0, D = S + T * a + L * (5 * m) + U * (5 * y) + N * (5 * p) + A * (5 * g);
    S = D >>> 13, D &= 8191, D += R * (5 * f) + d * (5 * h) + w * (5 * u) + _ * (5 * l) + O * (5 * c), S += D >>> 13, D &= 8191;
    let C = S + T * c + L * a + U * (5 * m) + N * (5 * y) + A * (5 * p);
    S = C >>> 13, C &= 8191, C += R * (5 * g) + d * (5 * f) + w * (5 * h) + _ * (5 * u) + O * (5 * l), S += C >>> 13, C &= 8191;
    let M = S + T * l + L * c + U * a + N * (5 * m) + A * (5 * y);
    S = M >>> 13, M &= 8191, M += R * (5 * p) + d * (5 * g) + w * (5 * f) + _ * (5 * h) + O * (5 * u), S += M >>> 13, M &= 8191;
    let z = S + T * u + L * l + U * c + N * a + A * (5 * m);
    S = z >>> 13, z &= 8191, z += R * (5 * y) + d * (5 * p) + w * (5 * g) + _ * (5 * f) + O * (5 * h), S += z >>> 13, z &= 8191;
    let k = S + T * h + L * u + U * l + N * c + A * a;
    S = k >>> 13, k &= 8191, k += R * (5 * m) + d * (5 * y) + w * (5 * p) + _ * (5 * g) + O * (5 * f), S += k >>> 13, k &= 8191;
    let q = S + T * f + L * h + U * u + N * l + A * c;
    S = q >>> 13, q &= 8191, q += R * a + d * (5 * m) + w * (5 * y) + _ * (5 * p) + O * (5 * g), S += q >>> 13, q &= 8191;
    let K = S + T * g + L * f + U * h + N * u + A * l;
    S = K >>> 13, K &= 8191, K += R * c + d * a + w * (5 * m) + _ * (5 * y) + O * (5 * p), S += K >>> 13, K &= 8191;
    let W = S + T * p + L * g + U * f + N * h + A * u;
    S = W >>> 13, W &= 8191, W += R * l + d * c + w * a + _ * (5 * m) + O * (5 * y), S += W >>> 13, W &= 8191;
    let G = S + T * y + L * p + U * g + N * f + A * h;
    S = G >>> 13, G &= 8191, G += R * u + d * l + w * c + _ * a + O * (5 * m), S += G >>> 13, G &= 8191;
    let V = S + T * m + L * y + U * p + N * g + A * f;
    S = V >>> 13, V &= 8191, V += R * h + d * u + w * l + _ * c + O * a, S += V >>> 13, V &= 8191, S = (S << 2) + S | 0, S = S + D | 0, D = S & 8191, S = S >>> 13, C += S, i[0] = D, i[1] = C, i[2] = M, i[3] = z, i[4] = k, i[5] = q, i[6] = K, i[7] = W, i[8] = G, i[9] = V;
  }
  finalize() {
    const { h: e, pad: r } = this, s = new Uint16Array(10);
    let n = e[1] >>> 13;
    e[1] &= 8191;
    for (let a = 2; a < 10; a++)
      e[a] += n, n = e[a] >>> 13, e[a] &= 8191;
    e[0] += n * 5, n = e[0] >>> 13, e[0] &= 8191, e[1] += n, n = e[1] >>> 13, e[1] &= 8191, e[2] += n, s[0] = e[0] + 5, n = s[0] >>> 13, s[0] &= 8191;
    for (let a = 1; a < 10; a++)
      s[a] = e[a] + n, n = s[a] >>> 13, s[a] &= 8191;
    s[9] -= 8192;
    let i = (n ^ 1) - 1;
    for (let a = 0; a < 10; a++)
      s[a] &= i;
    i = ~i;
    for (let a = 0; a < 10; a++)
      e[a] = e[a] & i | s[a];
    e[0] = (e[0] | e[1] << 13) & 65535, e[1] = (e[1] >>> 3 | e[2] << 10) & 65535, e[2] = (e[2] >>> 6 | e[3] << 7) & 65535, e[3] = (e[3] >>> 9 | e[4] << 4) & 65535, e[4] = (e[4] >>> 12 | e[5] << 1 | e[6] << 14) & 65535, e[5] = (e[6] >>> 2 | e[7] << 11) & 65535, e[6] = (e[7] >>> 5 | e[8] << 8) & 65535, e[7] = (e[8] >>> 8 | e[9] << 5) & 65535;
    let o = e[0] + r[0];
    e[0] = o & 65535;
    for (let a = 1; a < 8; a++)
      o = (e[a] + r[a] | 0) + (o >>> 16) | 0, e[a] = o & 65535;
    Qr(s);
  }
  update(e) {
    Uc(this), e = So(e), Ce(e);
    const { buffer: r, blockLen: s } = this, n = e.length;
    for (let i = 0; i < n; ) {
      const o = Math.min(s - this.pos, n - i);
      if (o === s) {
        for (; s <= n - i; i += s)
          this.process(e, i);
        continue;
      }
      r.set(e.subarray(i, i + o), this.pos), this.pos += o, i += o, this.pos === s && (this.process(r, 0, !1), this.pos = 0);
    }
    return this;
  }
  destroy() {
    Qr(this.h, this.r, this.buffer, this.pad);
  }
  digestInto(e) {
    Uc(this), gw(e, this), this.finished = !0;
    const { buffer: r, h: s } = this;
    let { pos: n } = this;
    if (n) {
      for (r[n++] = 1; n < 16; n++)
        r[n] = 0;
      this.process(r, 0, !0);
    }
    this.finalize();
    let i = 0;
    for (let o = 0; o < 8; o++)
      e[i++] = s[o] >>> 0, e[i++] = s[o] >>> 8;
    return e;
  }
  digest() {
    const { buffer: e, outputLen: r } = this;
    this.digestInto(e);
    const s = e.slice(0, r);
    return this.destroy(), s;
  }
}
function um(t) {
  const e = (s, n) => t(n).update(So(s)).digest(), r = t(new Uint8Array(32));
  return e.outputLen = r.outputLen, e.blockLen = r.blockLen, e.create = (s) => t(s), e;
}
const hm = um((t) => new lm(t));
function fm(t, e, r, s, n, i = 20) {
  let o = t[0], a = t[1], c = t[2], l = t[3], u = e[0], h = e[1], f = e[2], g = e[3], p = e[4], y = e[5], m = e[6], E = e[7], $ = n, b = r[0], v = r[1], x = r[2], I = o, P = a, B = c, T = l, L = u, U = h, N = f, A = g, R = p, d = y, w = m, _ = E, O = $, S = b, D = v, C = x;
  for (let z = 0; z < i; z += 2)
    I = I + L | 0, O = X(O ^ I, 16), R = R + O | 0, L = X(L ^ R, 12), I = I + L | 0, O = X(O ^ I, 8), R = R + O | 0, L = X(L ^ R, 7), P = P + U | 0, S = X(S ^ P, 16), d = d + S | 0, U = X(U ^ d, 12), P = P + U | 0, S = X(S ^ P, 8), d = d + S | 0, U = X(U ^ d, 7), B = B + N | 0, D = X(D ^ B, 16), w = w + D | 0, N = X(N ^ w, 12), B = B + N | 0, D = X(D ^ B, 8), w = w + D | 0, N = X(N ^ w, 7), T = T + A | 0, C = X(C ^ T, 16), _ = _ + C | 0, A = X(A ^ _, 12), T = T + A | 0, C = X(C ^ T, 8), _ = _ + C | 0, A = X(A ^ _, 7), I = I + U | 0, C = X(C ^ I, 16), w = w + C | 0, U = X(U ^ w, 12), I = I + U | 0, C = X(C ^ I, 8), w = w + C | 0, U = X(U ^ w, 7), P = P + N | 0, O = X(O ^ P, 16), _ = _ + O | 0, N = X(N ^ _, 12), P = P + N | 0, O = X(O ^ P, 8), _ = _ + O | 0, N = X(N ^ _, 7), B = B + A | 0, S = X(S ^ B, 16), R = R + S | 0, A = X(A ^ R, 12), B = B + A | 0, S = X(S ^ B, 8), R = R + S | 0, A = X(A ^ R, 7), T = T + L | 0, D = X(D ^ T, 16), d = d + D | 0, L = X(L ^ d, 12), T = T + L | 0, D = X(D ^ T, 8), d = d + D | 0, L = X(L ^ d, 7);
  let M = 0;
  s[M++] = o + I | 0, s[M++] = a + P | 0, s[M++] = c + B | 0, s[M++] = l + T | 0, s[M++] = u + L | 0, s[M++] = h + U | 0, s[M++] = f + N | 0, s[M++] = g + A | 0, s[M++] = p + R | 0, s[M++] = y + d | 0, s[M++] = m + w | 0, s[M++] = E + _ | 0, s[M++] = $ + O | 0, s[M++] = b + S | 0, s[M++] = v + D | 0, s[M++] = x + C | 0;
}
const dm = /* @__PURE__ */ cm(fm, {
  counterRight: !1,
  counterLength: 4,
  allowShortKeys: !1
}), pm = /* @__PURE__ */ new Uint8Array(16), zc = (t, e) => {
  t.update(e);
  const r = e.length % 16;
  r && t.update(pm.subarray(r));
}, gm = /* @__PURE__ */ new Uint8Array(32);
function Hc(t, e, r, s, n) {
  const i = t(e, r, gm), o = hm.create(i);
  n && zc(o, n), zc(o, s);
  const a = xw(s.length, n ? n.length : 0, !0);
  o.update(a);
  const c = o.digest();
  return Qr(i, a), c;
}
const ym = (t) => (e, r, s) => ({
  encrypt(i, o) {
    const a = i.length;
    o = Lc(a + 16, o, !1), o.set(i);
    const c = o.subarray(0, -16);
    t(e, r, c, c, 1);
    const l = Hc(t, e, r, c, s);
    return o.set(l, a), Qr(l), o;
  },
  decrypt(i, o) {
    o = Lc(i.length - 16, o, !1);
    const a = i.subarray(0, -16), c = i.subarray(-16), l = Hc(t, e, r, a, s);
    if (!vw(c, l))
      throw new Error("invalid tag");
    return o.set(i.subarray(0, -16)), t(e, r, o, o, 1), Qr(l), o;
  }
}), Kh = /* @__PURE__ */ Ew({ blockSize: 64, nonceLength: 12, tagLength: 16 }, ym(dm));
function wm(t, e, r) {
  return Wn(t), r === void 0 && (r = new Uint8Array(t.outputLen)), Ls(t, ct(r), ct(e));
}
const Bi = /* @__PURE__ */ Uint8Array.from([0]), Kc = /* @__PURE__ */ Uint8Array.of();
function mm(t, e, r, s = 32) {
  Wn(t), xt(s);
  const n = t.outputLen;
  if (s > 255 * n)
    throw new Error("Length should be <= 255*HashLen");
  const i = Math.ceil(s / n);
  r === void 0 && (r = Kc);
  const o = new Uint8Array(i * n), a = Ls.create(t, e), c = a._cloneInto(), l = new Uint8Array(a.outputLen);
  for (let u = 0; u < i; u++)
    Bi[0] = u + 1, c.update(u === 0 ? Kc : l).update(r).update(Bi).digestInto(l), o.set(l, n * u), a._cloneInto(c);
  return a.destroy(), c.destroy(), Xe(l, Bi), o.slice(0, s);
}
const bm = (t, e, r, s, n) => mm(t, wm(t, e, r), s, n);
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const pa = /* @__PURE__ */ BigInt(0), $o = /* @__PURE__ */ BigInt(1);
function Pn(t, e = "") {
  if (typeof t != "boolean") {
    const r = e && `"${e}"`;
    throw new Error(r + "expected boolean, got type=" + typeof t);
  }
  return t;
}
function xr(t, e, r = "") {
  const s = Vn(t), n = t?.length, i = e !== void 0;
  if (!s || i && n !== e) {
    const o = r && `"${r}" `, a = i ? ` of length ${e}` : "", c = s ? `length=${n}` : `type=${typeof t}`;
    throw new Error(o + "expected Uint8Array" + a + ", got " + c);
  }
  return t;
}
function Qs(t) {
  const e = t.toString(16);
  return e.length & 1 ? "0" + e : e;
}
function Vh(t) {
  if (typeof t != "string")
    throw new Error("hex string expected, got " + typeof t);
  return t === "" ? pa : BigInt("0x" + t);
}
function ei(t) {
  return Vh(Wr(t));
}
function Tn(t) {
  return lt(t), Vh(Wr(Uint8Array.from(t).reverse()));
}
function ga(t, e) {
  return xn(t.toString(16).padStart(e * 2, "0"));
}
function ya(t, e) {
  return ga(t, e).reverse();
}
function Ie(t, e, r) {
  let s;
  if (typeof e == "string")
    try {
      s = xn(e);
    } catch (i) {
      throw new Error(t + " must be hex string or Uint8Array, cause: " + i);
    }
  else if (Vn(e))
    s = Uint8Array.from(e);
  else
    throw new Error(t + " must be hex string or Uint8Array");
  const n = s.length;
  if (typeof r == "number" && n !== r)
    throw new Error(t + " of length " + r + " expected, got " + n);
  return s;
}
const Ri = (t) => typeof t == "bigint" && pa <= t;
function vm(t, e, r) {
  return Ri(t) && Ri(e) && Ri(r) && e <= t && t < r;
}
function Po(t, e, r, s) {
  if (!vm(e, r, s))
    throw new Error("expected valid " + t + ": " + r + " <= n < " + s + ", got " + e);
}
function Wh(t) {
  let e;
  for (e = 0; t > pa; t >>= $o, e += 1)
    ;
  return e;
}
const Fs = (t) => ($o << BigInt(t)) - $o;
function Em(t, e, r) {
  if (typeof t != "number" || t < 2)
    throw new Error("hashLen must be a number");
  if (typeof e != "number" || e < 2)
    throw new Error("qByteLen must be a number");
  if (typeof r != "function")
    throw new Error("hmacFn must be a function");
  const s = (g) => new Uint8Array(g), n = (g) => Uint8Array.of(g);
  let i = s(t), o = s(t), a = 0;
  const c = () => {
    i.fill(1), o.fill(0), a = 0;
  }, l = (...g) => r(o, i, ...g), u = (g = s(0)) => {
    o = l(n(0), g), i = l(), g.length !== 0 && (o = l(n(1), g), i = l());
  }, h = () => {
    if (a++ >= 1e3)
      throw new Error("drbg: tried 1000 values");
    let g = 0;
    const p = [];
    for (; g < e; ) {
      i = l();
      const y = i.slice();
      p.push(y), g += i.length;
    }
    return Ut(...p);
  };
  return (g, p) => {
    c(), u(g);
    let y;
    for (; !(y = p(h())); )
      u();
    return c(), y;
  };
}
function ti(t, e, r = {}) {
  if (!t || typeof t != "object")
    throw new Error("expected valid options object");
  function s(n, i, o) {
    const a = t[n];
    if (o && a === void 0)
      return;
    const c = typeof a;
    if (c !== i || a === null)
      throw new Error(`param "${n}" is invalid: expected ${i}, got ${c}`);
  }
  Object.entries(e).forEach(([n, i]) => s(n, i, !1)), Object.entries(r).forEach(([n, i]) => s(n, i, !0));
}
function Vc(t) {
  const e = /* @__PURE__ */ new WeakMap();
  return (r, ...s) => {
    const n = e.get(r);
    if (n !== void 0)
      return n;
    const i = t(r, ...s);
    return e.set(r, i), i;
  };
}
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const Ue = BigInt(0), Oe = BigInt(1), _r = /* @__PURE__ */ BigInt(2), Gh = /* @__PURE__ */ BigInt(3), Yh = /* @__PURE__ */ BigInt(4), Zh = /* @__PURE__ */ BigInt(5), xm = /* @__PURE__ */ BigInt(7), Xh = /* @__PURE__ */ BigInt(8), _m = /* @__PURE__ */ BigInt(9), Jh = /* @__PURE__ */ BigInt(16);
function qe(t, e) {
  const r = t % e;
  return r >= Ue ? r : e + r;
}
function st(t, e, r) {
  let s = t;
  for (; e-- > Ue; )
    s *= s, s %= r;
  return s;
}
function Wc(t, e) {
  if (t === Ue)
    throw new Error("invert: expected non-zero number");
  if (e <= Ue)
    throw new Error("invert: expected positive modulus, got " + e);
  let r = qe(t, e), s = e, n = Ue, i = Oe;
  for (; r !== Ue; ) {
    const a = s / r, c = s % r, l = n - i * a;
    s = r, r = c, n = i, i = l;
  }
  if (s !== Oe)
    throw new Error("invert: does not exist");
  return qe(n, e);
}
function wa(t, e, r) {
  if (!t.eql(t.sqr(e), r))
    throw new Error("Cannot find square root");
}
function Qh(t, e) {
  const r = (t.ORDER + Oe) / Yh, s = t.pow(e, r);
  return wa(t, s, e), s;
}
function Sm(t, e) {
  const r = (t.ORDER - Zh) / Xh, s = t.mul(e, _r), n = t.pow(s, r), i = t.mul(e, n), o = t.mul(t.mul(i, _r), n), a = t.mul(i, t.sub(o, t.ONE));
  return wa(t, a, e), a;
}
function Im(t) {
  const e = hr(t), r = ef(t), s = r(e, e.neg(e.ONE)), n = r(e, s), i = r(e, e.neg(s)), o = (t + xm) / Jh;
  return (a, c) => {
    let l = a.pow(c, o), u = a.mul(l, s);
    const h = a.mul(l, n), f = a.mul(l, i), g = a.eql(a.sqr(u), c), p = a.eql(a.sqr(h), c);
    l = a.cmov(l, u, g), u = a.cmov(f, h, p);
    const y = a.eql(a.sqr(u), c), m = a.cmov(l, u, y);
    return wa(a, m, c), m;
  };
}
function ef(t) {
  if (t < Gh)
    throw new Error("sqrt is not defined for small field");
  let e = t - Oe, r = 0;
  for (; e % _r === Ue; )
    e /= _r, r++;
  let s = _r;
  const n = hr(t);
  for (; Gc(n, s) === 1; )
    if (s++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  if (r === 1)
    return Qh;
  let i = n.pow(s, e);
  const o = (e + Oe) / _r;
  return function(c, l) {
    if (c.is0(l))
      return l;
    if (Gc(c, l) !== 1)
      throw new Error("Cannot find square root");
    let u = r, h = c.mul(c.ONE, i), f = c.pow(l, e), g = c.pow(l, o);
    for (; !c.eql(f, c.ONE); ) {
      if (c.is0(f))
        return c.ZERO;
      let p = 1, y = c.sqr(f);
      for (; !c.eql(y, c.ONE); )
        if (p++, y = c.sqr(y), p === u)
          throw new Error("Cannot find square root");
      const m = Oe << BigInt(u - p - 1), E = c.pow(h, m);
      u = p, h = c.sqr(E), f = c.mul(f, h), g = c.mul(g, E);
    }
    return g;
  };
}
function Dm(t) {
  return t % Yh === Gh ? Qh : t % Xh === Zh ? Sm : t % Jh === _m ? Im(t) : ef(t);
}
const Am = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function Om(t) {
  const e = {
    ORDER: "bigint",
    MASK: "bigint",
    BYTES: "number",
    BITS: "number"
  }, r = Am.reduce((s, n) => (s[n] = "function", s), e);
  return ti(t, r), t;
}
function $m(t, e, r) {
  if (r < Ue)
    throw new Error("invalid exponent, negatives unsupported");
  if (r === Ue)
    return t.ONE;
  if (r === Oe)
    return e;
  let s = t.ONE, n = e;
  for (; r > Ue; )
    r & Oe && (s = t.mul(s, n)), n = t.sqr(n), r >>= Oe;
  return s;
}
function tf(t, e, r = !1) {
  const s = new Array(e.length).fill(r ? t.ZERO : void 0), n = e.reduce((o, a, c) => t.is0(a) ? o : (s[c] = o, t.mul(o, a)), t.ONE), i = t.inv(n);
  return e.reduceRight((o, a, c) => t.is0(a) ? o : (s[c] = t.mul(o, s[c]), t.mul(o, a)), i), s;
}
function Gc(t, e) {
  const r = (t.ORDER - Oe) / _r, s = t.pow(e, r), n = t.eql(s, t.ONE), i = t.eql(s, t.ZERO), o = t.eql(s, t.neg(t.ONE));
  if (!n && !i && !o)
    throw new Error("invalid Legendre symbol result");
  return n ? 1 : i ? 0 : -1;
}
function rf(t, e) {
  e !== void 0 && xt(e);
  const r = e !== void 0 ? e : t.toString(2).length, s = Math.ceil(r / 8);
  return { nBitLength: r, nByteLength: s };
}
function hr(t, e, r = !1, s = {}) {
  if (t <= Ue)
    throw new Error("invalid field: expected ORDER > 0, got " + t);
  let n, i, o = !1, a;
  if (typeof e == "object" && e != null) {
    if (s.sqrt || r)
      throw new Error("cannot specify opts in two arguments");
    const f = e;
    f.BITS && (n = f.BITS), f.sqrt && (i = f.sqrt), typeof f.isLE == "boolean" && (r = f.isLE), typeof f.modFromBytes == "boolean" && (o = f.modFromBytes), a = f.allowedLengths;
  } else
    typeof e == "number" && (n = e), s.sqrt && (i = s.sqrt);
  const { nBitLength: c, nByteLength: l } = rf(t, n);
  if (l > 2048)
    throw new Error("invalid field: expected ORDER of <= 2048 bytes");
  let u;
  const h = Object.freeze({
    ORDER: t,
    isLE: r,
    BITS: c,
    BYTES: l,
    MASK: Fs(c),
    ZERO: Ue,
    ONE: Oe,
    allowedLengths: a,
    create: (f) => qe(f, t),
    isValid: (f) => {
      if (typeof f != "bigint")
        throw new Error("invalid field element: expected bigint, got " + typeof f);
      return Ue <= f && f < t;
    },
    is0: (f) => f === Ue,
    // is valid and invertible
    isValidNot0: (f) => !h.is0(f) && h.isValid(f),
    isOdd: (f) => (f & Oe) === Oe,
    neg: (f) => qe(-f, t),
    eql: (f, g) => f === g,
    sqr: (f) => qe(f * f, t),
    add: (f, g) => qe(f + g, t),
    sub: (f, g) => qe(f - g, t),
    mul: (f, g) => qe(f * g, t),
    pow: (f, g) => $m(h, f, g),
    div: (f, g) => qe(f * Wc(g, t), t),
    // Same as above, but doesn't normalize
    sqrN: (f) => f * f,
    addN: (f, g) => f + g,
    subN: (f, g) => f - g,
    mulN: (f, g) => f * g,
    inv: (f) => Wc(f, t),
    sqrt: i || ((f) => (u || (u = Dm(t)), u(h, f))),
    toBytes: (f) => r ? ya(f, l) : ga(f, l),
    fromBytes: (f, g = !0) => {
      if (a) {
        if (!a.includes(f.length) || f.length > l)
          throw new Error("Field.fromBytes: expected " + a + " bytes, got " + f.length);
        const y = new Uint8Array(l);
        y.set(f, r ? 0 : y.length - f.length), f = y;
      }
      if (f.length !== l)
        throw new Error("Field.fromBytes: expected " + l + " bytes, got " + f.length);
      let p = r ? Tn(f) : ei(f);
      if (o && (p = qe(p, t)), !g && !h.isValid(p))
        throw new Error("invalid field element: outside of range 0..ORDER");
      return p;
    },
    // TODO: we don't need it here, move out to separate fn
    invertBatch: (f) => tf(h, f),
    // We can't move this out because Fp6, Fp12 implement it
    // and it's unclear what to return in there.
    cmov: (f, g, p) => p ? g : f
  });
  return Object.freeze(h);
}
function sf(t) {
  if (typeof t != "bigint")
    throw new Error("field order must be bigint");
  const e = t.toString(2).length;
  return Math.ceil(e / 8);
}
function nf(t) {
  const e = sf(t);
  return e + Math.ceil(e / 2);
}
function Pm(t, e, r = !1) {
  const s = t.length, n = sf(e), i = nf(e);
  if (s < 16 || s < i || s > 1024)
    throw new Error("expected " + i + "-1024 bytes of input, got " + s);
  const o = r ? Tn(t) : ei(t), a = qe(o, e - Oe) + Oe;
  return r ? ya(a, n) : ga(a, n);
}
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const es = BigInt(0), Sr = BigInt(1);
function Bn(t, e) {
  const r = e.negate();
  return t ? r : e;
}
function Ci(t, e) {
  const r = tf(t.Fp, e.map((s) => s.Z));
  return e.map((s, n) => t.fromAffine(s.toAffine(r[n])));
}
function of(t, e) {
  if (!Number.isSafeInteger(t) || t <= 0 || t > e)
    throw new Error("invalid window size, expected [1.." + e + "], got W=" + t);
}
function Ni(t, e) {
  of(t, e);
  const r = Math.ceil(e / t) + 1, s = 2 ** (t - 1), n = 2 ** t, i = Fs(t), o = BigInt(t);
  return { windows: r, windowSize: s, mask: i, maxNumber: n, shiftBy: o };
}
function Yc(t, e, r) {
  const { windowSize: s, mask: n, maxNumber: i, shiftBy: o } = r;
  let a = Number(t & n), c = t >> o;
  a > s && (a -= i, c += Sr);
  const l = e * s, u = l + Math.abs(a) - 1, h = a === 0, f = a < 0, g = e % 2 !== 0;
  return { nextN: c, offset: u, isZero: h, isNeg: f, isNegF: g, offsetF: l };
}
function Tm(t, e) {
  if (!Array.isArray(t))
    throw new Error("array expected");
  t.forEach((r, s) => {
    if (!(r instanceof e))
      throw new Error("invalid point at index " + s);
  });
}
function Bm(t, e) {
  if (!Array.isArray(t))
    throw new Error("array of scalars expected");
  t.forEach((r, s) => {
    if (!e.isValid(r))
      throw new Error("invalid scalar at index " + s);
  });
}
const Ui = /* @__PURE__ */ new WeakMap(), af = /* @__PURE__ */ new WeakMap();
function Li(t) {
  return af.get(t) || 1;
}
function Zc(t) {
  if (t !== es)
    throw new Error("invalid wNAF");
}
class Rm {
  // Parametrized with a given Point class (not individual point)
  constructor(e, r) {
    this.BASE = e.BASE, this.ZERO = e.ZERO, this.Fn = e.Fn, this.bits = r;
  }
  // non-const time multiplication ladder
  _unsafeLadder(e, r, s = this.ZERO) {
    let n = e;
    for (; r > es; )
      r & Sr && (s = s.add(n)), n = n.double(), r >>= Sr;
    return s;
  }
  /**
   * Creates a wNAF precomputation window. Used for caching.
   * Default window size is set by `utils.precompute()` and is equal to 8.
   * Number of precomputed points depends on the curve size:
   * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
   * - 𝑊 is the window size
   * - 𝑛 is the bitlength of the curve order.
   * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
   * @param point Point instance
   * @param W window size
   * @returns precomputed point tables flattened to a single array
   */
  precomputeWindow(e, r) {
    const { windows: s, windowSize: n } = Ni(r, this.bits), i = [];
    let o = e, a = o;
    for (let c = 0; c < s; c++) {
      a = o, i.push(a);
      for (let l = 1; l < n; l++)
        a = a.add(o), i.push(a);
      o = a.double();
    }
    return i;
  }
  /**
   * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
   * More compact implementation:
   * https://github.com/paulmillr/noble-secp256k1/blob/47cb1669b6e506ad66b35fe7d76132ae97465da2/index.ts#L502-L541
   * @returns real and fake (for const-time) points
   */
  wNAF(e, r, s) {
    if (!this.Fn.isValid(s))
      throw new Error("invalid scalar");
    let n = this.ZERO, i = this.BASE;
    const o = Ni(e, this.bits);
    for (let a = 0; a < o.windows; a++) {
      const { nextN: c, offset: l, isZero: u, isNeg: h, isNegF: f, offsetF: g } = Yc(s, a, o);
      s = c, u ? i = i.add(Bn(f, r[g])) : n = n.add(Bn(h, r[l]));
    }
    return Zc(s), { p: n, f: i };
  }
  /**
   * Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
   * @param acc accumulator point to add result of multiplication
   * @returns point
   */
  wNAFUnsafe(e, r, s, n = this.ZERO) {
    const i = Ni(e, this.bits);
    for (let o = 0; o < i.windows && s !== es; o++) {
      const { nextN: a, offset: c, isZero: l, isNeg: u } = Yc(s, o, i);
      if (s = a, !l) {
        const h = r[c];
        n = n.add(u ? h.negate() : h);
      }
    }
    return Zc(s), n;
  }
  getPrecomputes(e, r, s) {
    let n = Ui.get(r);
    return n || (n = this.precomputeWindow(r, e), e !== 1 && (typeof s == "function" && (n = s(n)), Ui.set(r, n))), n;
  }
  cached(e, r, s) {
    const n = Li(e);
    return this.wNAF(n, this.getPrecomputes(n, e, s), r);
  }
  unsafe(e, r, s, n) {
    const i = Li(e);
    return i === 1 ? this._unsafeLadder(e, r, n) : this.wNAFUnsafe(i, this.getPrecomputes(i, e, s), r, n);
  }
  // We calculate precomputes for elliptic curve point multiplication
  // using windowed method. This specifies window size and
  // stores precomputed values. Usually only base point would be precomputed.
  createCache(e, r) {
    of(r, this.bits), af.set(e, r), Ui.delete(e);
  }
  hasCache(e) {
    return Li(e) !== 1;
  }
}
function Cm(t, e, r, s) {
  let n = e, i = t.ZERO, o = t.ZERO;
  for (; r > es || s > es; )
    r & Sr && (i = i.add(n)), s & Sr && (o = o.add(n)), n = n.double(), r >>= Sr, s >>= Sr;
  return { p1: i, p2: o };
}
function Nm(t, e, r, s) {
  Tm(r, t), Bm(s, e);
  const n = r.length, i = s.length;
  if (n !== i)
    throw new Error("arrays of points and scalars must have equal length");
  const o = t.ZERO, a = Wh(BigInt(n));
  let c = 1;
  a > 12 ? c = a - 3 : a > 4 ? c = a - 2 : a > 0 && (c = 2);
  const l = Fs(c), u = new Array(Number(l) + 1).fill(o), h = Math.floor((e.BITS - 1) / c) * c;
  let f = o;
  for (let g = h; g >= 0; g -= c) {
    u.fill(o);
    for (let y = 0; y < i; y++) {
      const m = s[y], E = Number(m >> BigInt(g) & l);
      u[E] = u[E].add(r[y]);
    }
    let p = o;
    for (let y = u.length - 1, m = o; y > 0; y--)
      m = m.add(u[y]), p = p.add(m);
    if (f = f.add(p), g !== 0)
      for (let y = 0; y < c; y++)
        f = f.double();
  }
  return f;
}
function Xc(t, e, r) {
  if (e) {
    if (e.ORDER !== t)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    return Om(e), e;
  } else
    return hr(t, { isLE: r });
}
function Um(t, e, r = {}, s) {
  if (s === void 0 && (s = t === "edwards"), !e || typeof e != "object")
    throw new Error(`expected valid ${t} CURVE object`);
  for (const c of ["p", "n", "h"]) {
    const l = e[c];
    if (!(typeof l == "bigint" && l > es))
      throw new Error(`CURVE.${c} must be positive bigint`);
  }
  const n = Xc(e.p, r.Fp, s), i = Xc(e.n, r.Fn, s), a = ["Gx", "Gy", "a", "b"];
  for (const c of a)
    if (!n.isValid(e[c]))
      throw new Error(`CURVE.${c} must be valid field element of CURVE.Fp`);
  return e = Object.freeze(Object.assign({}, e)), { CURVE: e, Fp: n, Fn: i };
}
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const us = BigInt(0), qr = BigInt(1), en = BigInt(2);
function Lm(t) {
  return ti(t, {
    adjustScalarBytes: "function",
    powPminus2: "function"
  }), Object.freeze({ ...t });
}
function Mm(t) {
  const e = Lm(t), { P: r, type: s, adjustScalarBytes: n, powPminus2: i, randomBytes: o } = e, a = s === "x25519";
  if (!a && s !== "x448")
    throw new Error("invalid type");
  const c = o || ur, l = a ? 255 : 448, u = a ? 32 : 56, h = BigInt(a ? 9 : 5), f = BigInt(a ? 121665 : 39081), g = a ? en ** BigInt(254) : en ** BigInt(447), p = a ? BigInt(8) * en ** BigInt(251) - qr : BigInt(4) * en ** BigInt(445) - qr, y = g + p + qr, m = (A) => qe(A, r), E = $(h);
  function $(A) {
    return ya(m(A), u);
  }
  function b(A) {
    const R = Ie("u coordinate", A, u);
    return a && (R[31] &= 127), m(Tn(R));
  }
  function v(A) {
    return Tn(n(Ie("scalar", A, u)));
  }
  function x(A, R) {
    const d = B(b(R), v(A));
    if (d === us)
      throw new Error("invalid private or public key received");
    return $(d);
  }
  function I(A) {
    return x(A, E);
  }
  function P(A, R, d) {
    const w = m(A * (R - d));
    return R = m(R - w), d = m(d + w), { x_2: R, x_3: d };
  }
  function B(A, R) {
    Po("u", A, us, r), Po("scalar", R, g, y);
    const d = R, w = A;
    let _ = qr, O = us, S = A, D = qr, C = us;
    for (let z = BigInt(l - 1); z >= us; z--) {
      const k = d >> z & qr;
      C ^= k, { x_2: _, x_3: S } = P(C, _, S), { x_2: O, x_3: D } = P(C, O, D), C = k;
      const q = _ + O, K = m(q * q), W = _ - O, G = m(W * W), V = K - G, Z = S + D, ie = S - D, oe = m(ie * q), de = m(Z * W), Je = oe + de, Qe = oe - de;
      S = m(Je * Je), D = m(w * m(Qe * Qe)), _ = m(K * G), O = m(V * (K + m(f * V)));
    }
    ({ x_2: _, x_3: S } = P(C, _, S)), { x_2: O, x_3: D } = P(C, O, D);
    const M = i(O);
    return m(_ * M);
  }
  const T = {
    secretKey: u,
    publicKey: u,
    seed: u
  }, L = (A = c(u)) => (lt(A, T.seed), A);
  function U(A) {
    const R = L(A);
    return { secretKey: R, publicKey: I(R) };
  }
  return {
    keygen: U,
    getSharedSecret: (A, R) => x(A, R),
    getPublicKey: (A) => I(A),
    scalarMult: x,
    scalarMultBase: I,
    utils: {
      randomSecretKey: L,
      randomPrivateKey: L
    },
    GuBytes: E.slice(),
    lengths: T
  };
}
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const km = BigInt(1), Jc = BigInt(2), qm = BigInt(3), Fm = BigInt(5), jm = BigInt(8), cf = BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed"), zm = {
  p: cf,
  n: BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed"),
  h: jm,
  a: BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffec"),
  d: BigInt("0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3"),
  Gx: BigInt("0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a"),
  Gy: BigInt("0x6666666666666666666666666666666666666666666666666666666666666658")
};
function Hm(t) {
  const e = BigInt(10), r = BigInt(20), s = BigInt(40), n = BigInt(80), i = cf, a = t * t % i * t % i, c = st(a, Jc, i) * a % i, l = st(c, km, i) * t % i, u = st(l, Fm, i) * l % i, h = st(u, e, i) * u % i, f = st(h, r, i) * h % i, g = st(f, s, i) * f % i, p = st(g, n, i) * g % i, y = st(p, n, i) * g % i, m = st(y, e, i) * u % i;
  return { pow_p_5_8: st(m, Jc, i) * t % i, b2: a };
}
function Km(t) {
  return t[0] &= 248, t[31] &= 127, t[31] |= 64, t;
}
const Vm = hr(zm.p, { isLE: !0 }), To = /* @__PURE__ */ (() => {
  const t = Vm.ORDER;
  return Mm({
    P: t,
    type: "x25519",
    powPminus2: (e) => {
      const { pow_p_5_8: r, b2: s } = Hm(e);
      return qe(st(r, qm, t) * s, t);
    },
    adjustScalarBytes: Km
  });
})();
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const Qc = (t, e) => (t + (t >= 0 ? e : -e) / lf) / e;
function Wm(t, e, r) {
  const [[s, n], [i, o]] = e, a = Qc(o * t, r), c = Qc(-n * t, r);
  let l = t - a * s - c * i, u = -a * n - c * o;
  const h = l < Mt, f = u < Mt;
  h && (l = -l), f && (u = -u);
  const g = Fs(Math.ceil(Wh(r) / 2)) + Yr;
  if (l < Mt || l >= g || u < Mt || u >= g)
    throw new Error("splitScalar (endomorphism): failed, k=" + t);
  return { k1neg: h, k1: l, k2neg: f, k2: u };
}
function Bo(t) {
  if (!["compact", "recovered", "der"].includes(t))
    throw new Error('Signature format must be "compact", "recovered", or "der"');
  return t;
}
function Mi(t, e) {
  const r = {};
  for (let s of Object.keys(e))
    r[s] = t[s] === void 0 ? e[s] : t[s];
  return Pn(r.lowS, "lowS"), Pn(r.prehash, "prehash"), r.format !== void 0 && Bo(r.format), r;
}
class Gm extends Error {
  constructor(e = "") {
    super(e);
  }
}
const Nt = {
  // asn.1 DER encoding utils
  Err: Gm,
  // Basic building block is TLV (Tag-Length-Value)
  _tlv: {
    encode: (t, e) => {
      const { Err: r } = Nt;
      if (t < 0 || t > 256)
        throw new r("tlv.encode: wrong tag");
      if (e.length & 1)
        throw new r("tlv.encode: unpadded data");
      const s = e.length / 2, n = Qs(s);
      if (n.length / 2 & 128)
        throw new r("tlv.encode: long form length too big");
      const i = s > 127 ? Qs(n.length / 2 | 128) : "";
      return Qs(t) + i + n + e;
    },
    // v - value, l - left bytes (unparsed)
    decode(t, e) {
      const { Err: r } = Nt;
      let s = 0;
      if (t < 0 || t > 256)
        throw new r("tlv.encode: wrong tag");
      if (e.length < 2 || e[s++] !== t)
        throw new r("tlv.decode: wrong tlv");
      const n = e[s++], i = !!(n & 128);
      let o = 0;
      if (!i)
        o = n;
      else {
        const c = n & 127;
        if (!c)
          throw new r("tlv.decode(long): indefinite length not supported");
        if (c > 4)
          throw new r("tlv.decode(long): byte length is too big");
        const l = e.subarray(s, s + c);
        if (l.length !== c)
          throw new r("tlv.decode: length bytes not complete");
        if (l[0] === 0)
          throw new r("tlv.decode(long): zero leftmost byte");
        for (const u of l)
          o = o << 8 | u;
        if (s += c, o < 128)
          throw new r("tlv.decode(long): not minimal encoding");
      }
      const a = e.subarray(s, s + o);
      if (a.length !== o)
        throw new r("tlv.decode: wrong value length");
      return { v: a, l: e.subarray(s + o) };
    }
  },
  // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
  // since we always use positive integers here. It must always be empty:
  // - add zero byte if exists
  // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
  _int: {
    encode(t) {
      const { Err: e } = Nt;
      if (t < Mt)
        throw new e("integer: negative integers are not allowed");
      let r = Qs(t);
      if (Number.parseInt(r[0], 16) & 8 && (r = "00" + r), r.length & 1)
        throw new e("unexpected DER parsing assertion: unpadded hex");
      return r;
    },
    decode(t) {
      const { Err: e } = Nt;
      if (t[0] & 128)
        throw new e("invalid signature integer: negative");
      if (t[0] === 0 && !(t[1] & 128))
        throw new e("invalid signature integer: unnecessary leading zero");
      return ei(t);
    }
  },
  toSig(t) {
    const { Err: e, _int: r, _tlv: s } = Nt, n = Ie("signature", t), { v: i, l: o } = s.decode(48, n);
    if (o.length)
      throw new e("invalid signature: left bytes after parsing");
    const { v: a, l: c } = s.decode(2, i), { v: l, l: u } = s.decode(2, c);
    if (u.length)
      throw new e("invalid signature: left bytes after parsing");
    return { r: r.decode(a), s: r.decode(l) };
  },
  hexFromSig(t) {
    const { _tlv: e, _int: r } = Nt, s = e.encode(2, r.encode(t.r)), n = e.encode(2, r.encode(t.s)), i = s + n;
    return e.encode(48, i);
  }
}, Mt = BigInt(0), Yr = BigInt(1), lf = BigInt(2), tn = BigInt(3), Ym = BigInt(4);
function zr(t, e) {
  const { BYTES: r } = t;
  let s;
  if (typeof e == "bigint")
    s = e;
  else {
    let n = Ie("private key", e);
    try {
      s = t.fromBytes(n);
    } catch {
      throw new Error(`invalid private key: expected ui8a of size ${r}, got ${typeof e}`);
    }
  }
  if (!t.isValidNot0(s))
    throw new Error("invalid private key: out of range [1..N-1]");
  return s;
}
function Zm(t, e = {}) {
  const r = Um("weierstrass", t, e), { Fp: s, Fn: n } = r;
  let i = r.CURVE;
  const { h: o, n: a } = i;
  ti(e, {}, {
    allowInfinityPoint: "boolean",
    clearCofactor: "function",
    isTorsionFree: "function",
    fromBytes: "function",
    toBytes: "function",
    endo: "object",
    wrapPrivateKey: "boolean"
  });
  const { endo: c } = e;
  if (c && (!s.is0(i.a) || typeof c.beta != "bigint" || !Array.isArray(c.basises)))
    throw new Error('invalid endo: expected "beta": bigint and "basises": array');
  const l = hf(s, n);
  function u() {
    if (!s.isOdd)
      throw new Error("compression is not supported: Field does not have .isOdd()");
  }
  function h(N, A, R) {
    const { x: d, y: w } = A.toAffine(), _ = s.toBytes(d);
    if (Pn(R, "isCompressed"), R) {
      u();
      const O = !s.isOdd(w);
      return Ut(uf(O), _);
    } else
      return Ut(Uint8Array.of(4), _, s.toBytes(w));
  }
  function f(N) {
    xr(N, void 0, "Point");
    const { publicKey: A, publicKeyUncompressed: R } = l, d = N.length, w = N[0], _ = N.subarray(1);
    if (d === A && (w === 2 || w === 3)) {
      const O = s.fromBytes(_);
      if (!s.isValid(O))
        throw new Error("bad point: is not on curve, wrong x");
      const S = y(O);
      let D;
      try {
        D = s.sqrt(S);
      } catch (z) {
        const k = z instanceof Error ? ": " + z.message : "";
        throw new Error("bad point: is not on curve, sqrt error" + k);
      }
      u();
      const C = s.isOdd(D);
      return (w & 1) === 1 !== C && (D = s.neg(D)), { x: O, y: D };
    } else if (d === R && w === 4) {
      const O = s.BYTES, S = s.fromBytes(_.subarray(0, O)), D = s.fromBytes(_.subarray(O, O * 2));
      if (!m(S, D))
        throw new Error("bad point: is not on curve");
      return { x: S, y: D };
    } else
      throw new Error(`bad point: got length ${d}, expected compressed=${A} or uncompressed=${R}`);
  }
  const g = e.toBytes || h, p = e.fromBytes || f;
  function y(N) {
    const A = s.sqr(N), R = s.mul(A, N);
    return s.add(s.add(R, s.mul(N, i.a)), i.b);
  }
  function m(N, A) {
    const R = s.sqr(A), d = y(N);
    return s.eql(R, d);
  }
  if (!m(i.Gx, i.Gy))
    throw new Error("bad curve params: generator point");
  const E = s.mul(s.pow(i.a, tn), Ym), $ = s.mul(s.sqr(i.b), BigInt(27));
  if (s.is0(s.add(E, $)))
    throw new Error("bad curve params: a or b");
  function b(N, A, R = !1) {
    if (!s.isValid(A) || R && s.is0(A))
      throw new Error(`bad point coordinate ${N}`);
    return A;
  }
  function v(N) {
    if (!(N instanceof T))
      throw new Error("ProjectivePoint expected");
  }
  function x(N) {
    if (!c || !c.basises)
      throw new Error("no endo");
    return Wm(N, c.basises, n.ORDER);
  }
  const I = Vc((N, A) => {
    const { X: R, Y: d, Z: w } = N;
    if (s.eql(w, s.ONE))
      return { x: R, y: d };
    const _ = N.is0();
    A == null && (A = _ ? s.ONE : s.inv(w));
    const O = s.mul(R, A), S = s.mul(d, A), D = s.mul(w, A);
    if (_)
      return { x: s.ZERO, y: s.ZERO };
    if (!s.eql(D, s.ONE))
      throw new Error("invZ was invalid");
    return { x: O, y: S };
  }), P = Vc((N) => {
    if (N.is0()) {
      if (e.allowInfinityPoint && !s.is0(N.Y))
        return;
      throw new Error("bad point: ZERO");
    }
    const { x: A, y: R } = N.toAffine();
    if (!s.isValid(A) || !s.isValid(R))
      throw new Error("bad point: x or y not field elements");
    if (!m(A, R))
      throw new Error("bad point: equation left != right");
    if (!N.isTorsionFree())
      throw new Error("bad point: not in prime-order subgroup");
    return !0;
  });
  function B(N, A, R, d, w) {
    return R = new T(s.mul(R.X, N), R.Y, R.Z), A = Bn(d, A), R = Bn(w, R), A.add(R);
  }
  class T {
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    constructor(A, R, d) {
      this.X = b("x", A), this.Y = b("y", R, !0), this.Z = b("z", d), Object.freeze(this);
    }
    static CURVE() {
      return i;
    }
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    static fromAffine(A) {
      const { x: R, y: d } = A || {};
      if (!A || !s.isValid(R) || !s.isValid(d))
        throw new Error("invalid affine point");
      if (A instanceof T)
        throw new Error("projective point not allowed");
      return s.is0(R) && s.is0(d) ? T.ZERO : new T(R, d, s.ONE);
    }
    static fromBytes(A) {
      const R = T.fromAffine(p(xr(A, void 0, "point")));
      return R.assertValidity(), R;
    }
    static fromHex(A) {
      return T.fromBytes(Ie("pointHex", A));
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    /**
     *
     * @param windowSize
     * @param isLazy true will defer table computation until the first multiplication
     * @returns
     */
    precompute(A = 8, R = !0) {
      return U.createCache(this, A), R || this.multiply(tn), this;
    }
    // TODO: return `this`
    /** A point on curve is valid if it conforms to equation. */
    assertValidity() {
      P(this);
    }
    hasEvenY() {
      const { y: A } = this.toAffine();
      if (!s.isOdd)
        throw new Error("Field doesn't support isOdd");
      return !s.isOdd(A);
    }
    /** Compare one point to another. */
    equals(A) {
      v(A);
      const { X: R, Y: d, Z: w } = this, { X: _, Y: O, Z: S } = A, D = s.eql(s.mul(R, S), s.mul(_, w)), C = s.eql(s.mul(d, S), s.mul(O, w));
      return D && C;
    }
    /** Flips point to one corresponding to (x, -y) in Affine coordinates. */
    negate() {
      return new T(this.X, s.neg(this.Y), this.Z);
    }
    // Renes-Costello-Batina exception-free doubling formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 3
    // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
    double() {
      const { a: A, b: R } = i, d = s.mul(R, tn), { X: w, Y: _, Z: O } = this;
      let S = s.ZERO, D = s.ZERO, C = s.ZERO, M = s.mul(w, w), z = s.mul(_, _), k = s.mul(O, O), q = s.mul(w, _);
      return q = s.add(q, q), C = s.mul(w, O), C = s.add(C, C), S = s.mul(A, C), D = s.mul(d, k), D = s.add(S, D), S = s.sub(z, D), D = s.add(z, D), D = s.mul(S, D), S = s.mul(q, S), C = s.mul(d, C), k = s.mul(A, k), q = s.sub(M, k), q = s.mul(A, q), q = s.add(q, C), C = s.add(M, M), M = s.add(C, M), M = s.add(M, k), M = s.mul(M, q), D = s.add(D, M), k = s.mul(_, O), k = s.add(k, k), M = s.mul(k, q), S = s.sub(S, M), C = s.mul(k, z), C = s.add(C, C), C = s.add(C, C), new T(S, D, C);
    }
    // Renes-Costello-Batina exception-free addition formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 1
    // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
    add(A) {
      v(A);
      const { X: R, Y: d, Z: w } = this, { X: _, Y: O, Z: S } = A;
      let D = s.ZERO, C = s.ZERO, M = s.ZERO;
      const z = i.a, k = s.mul(i.b, tn);
      let q = s.mul(R, _), K = s.mul(d, O), W = s.mul(w, S), G = s.add(R, d), V = s.add(_, O);
      G = s.mul(G, V), V = s.add(q, K), G = s.sub(G, V), V = s.add(R, w);
      let Z = s.add(_, S);
      return V = s.mul(V, Z), Z = s.add(q, W), V = s.sub(V, Z), Z = s.add(d, w), D = s.add(O, S), Z = s.mul(Z, D), D = s.add(K, W), Z = s.sub(Z, D), M = s.mul(z, V), D = s.mul(k, W), M = s.add(D, M), D = s.sub(K, M), M = s.add(K, M), C = s.mul(D, M), K = s.add(q, q), K = s.add(K, q), W = s.mul(z, W), V = s.mul(k, V), K = s.add(K, W), W = s.sub(q, W), W = s.mul(z, W), V = s.add(V, W), q = s.mul(K, V), C = s.add(C, q), q = s.mul(Z, V), D = s.mul(G, D), D = s.sub(D, q), q = s.mul(G, K), M = s.mul(Z, M), M = s.add(M, q), new T(D, C, M);
    }
    subtract(A) {
      return this.add(A.negate());
    }
    is0() {
      return this.equals(T.ZERO);
    }
    /**
     * Constant time multiplication.
     * Uses wNAF method. Windowed method may be 10% faster,
     * but takes 2x longer to generate and consumes 2x memory.
     * Uses precomputes when available.
     * Uses endomorphism for Koblitz curves.
     * @param scalar by which the point would be multiplied
     * @returns New point
     */
    multiply(A) {
      const { endo: R } = e;
      if (!n.isValidNot0(A))
        throw new Error("invalid scalar: out of range");
      let d, w;
      const _ = (O) => U.cached(this, O, (S) => Ci(T, S));
      if (R) {
        const { k1neg: O, k1: S, k2neg: D, k2: C } = x(A), { p: M, f: z } = _(S), { p: k, f: q } = _(C);
        w = z.add(q), d = B(R.beta, M, k, O, D);
      } else {
        const { p: O, f: S } = _(A);
        d = O, w = S;
      }
      return Ci(T, [d, w])[0];
    }
    /**
     * Non-constant-time multiplication. Uses double-and-add algorithm.
     * It's faster, but should only be used when you don't care about
     * an exposed secret key e.g. sig verification, which works over *public* keys.
     */
    multiplyUnsafe(A) {
      const { endo: R } = e, d = this;
      if (!n.isValid(A))
        throw new Error("invalid scalar: out of range");
      if (A === Mt || d.is0())
        return T.ZERO;
      if (A === Yr)
        return d;
      if (U.hasCache(this))
        return this.multiply(A);
      if (R) {
        const { k1neg: w, k1: _, k2neg: O, k2: S } = x(A), { p1: D, p2: C } = Cm(T, d, _, S);
        return B(R.beta, D, C, w, O);
      } else
        return U.unsafe(d, A);
    }
    multiplyAndAddUnsafe(A, R, d) {
      const w = this.multiplyUnsafe(R).add(A.multiplyUnsafe(d));
      return w.is0() ? void 0 : w;
    }
    /**
     * Converts Projective point to affine (x, y) coordinates.
     * @param invertedZ Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
     */
    toAffine(A) {
      return I(this, A);
    }
    /**
     * Checks whether Point is free of torsion elements (is in prime subgroup).
     * Always torsion-free for cofactor=1 curves.
     */
    isTorsionFree() {
      const { isTorsionFree: A } = e;
      return o === Yr ? !0 : A ? A(T, this) : U.unsafe(this, a).is0();
    }
    clearCofactor() {
      const { clearCofactor: A } = e;
      return o === Yr ? this : A ? A(T, this) : this.multiplyUnsafe(o);
    }
    isSmallOrder() {
      return this.multiplyUnsafe(o).is0();
    }
    toBytes(A = !0) {
      return Pn(A, "isCompressed"), this.assertValidity(), g(T, this, A);
    }
    toHex(A = !0) {
      return Wr(this.toBytes(A));
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
    // TODO: remove
    get px() {
      return this.X;
    }
    get py() {
      return this.X;
    }
    get pz() {
      return this.Z;
    }
    toRawBytes(A = !0) {
      return this.toBytes(A);
    }
    _setWindowSize(A) {
      this.precompute(A);
    }
    static normalizeZ(A) {
      return Ci(T, A);
    }
    static msm(A, R) {
      return Nm(T, n, A, R);
    }
    static fromPrivateKey(A) {
      return T.BASE.multiply(zr(n, A));
    }
  }
  T.BASE = new T(i.Gx, i.Gy, s.ONE), T.ZERO = new T(s.ZERO, s.ONE, s.ZERO), T.Fp = s, T.Fn = n;
  const L = n.BITS, U = new Rm(T, e.endo ? Math.ceil(L / 2) : L);
  return T.BASE.precompute(8), T;
}
function uf(t) {
  return Uint8Array.of(t ? 2 : 3);
}
function hf(t, e) {
  return {
    secretKey: e.BYTES,
    publicKey: 1 + t.BYTES,
    publicKeyUncompressed: 1 + 2 * t.BYTES,
    publicKeyHasPrefix: !0,
    signature: 2 * e.BYTES
  };
}
function Xm(t, e = {}) {
  const { Fn: r } = t, s = e.randomBytes || ur, n = Object.assign(hf(t.Fp, r), { seed: nf(r.ORDER) });
  function i(g) {
    try {
      return !!zr(r, g);
    } catch {
      return !1;
    }
  }
  function o(g, p) {
    const { publicKey: y, publicKeyUncompressed: m } = n;
    try {
      const E = g.length;
      return p === !0 && E !== y || p === !1 && E !== m ? !1 : !!t.fromBytes(g);
    } catch {
      return !1;
    }
  }
  function a(g = s(n.seed)) {
    return Pm(xr(g, n.seed, "seed"), r.ORDER);
  }
  function c(g, p = !0) {
    return t.BASE.multiply(zr(r, g)).toBytes(p);
  }
  function l(g) {
    const p = a(g);
    return { secretKey: p, publicKey: c(p) };
  }
  function u(g) {
    if (typeof g == "bigint")
      return !1;
    if (g instanceof t)
      return !0;
    const { secretKey: p, publicKey: y, publicKeyUncompressed: m } = n;
    if (r.allowedLengths || p === y)
      return;
    const E = Ie("key", g).length;
    return E === y || E === m;
  }
  function h(g, p, y = !0) {
    if (u(g) === !0)
      throw new Error("first arg must be private key");
    if (u(p) === !1)
      throw new Error("second arg must be public key");
    const m = zr(r, g);
    return t.fromHex(p).multiply(m).toBytes(y);
  }
  return Object.freeze({ getPublicKey: c, getSharedSecret: h, keygen: l, Point: t, utils: {
    isValidSecretKey: i,
    isValidPublicKey: o,
    randomSecretKey: a,
    // TODO: remove
    isValidPrivateKey: i,
    randomPrivateKey: a,
    normPrivateKeyToScalar: (g) => zr(r, g),
    precompute(g = 8, p = t.BASE) {
      return p.precompute(g, !1);
    }
  }, lengths: n });
}
function Jm(t, e, r = {}) {
  Wn(e), ti(r, {}, {
    hmac: "function",
    lowS: "boolean",
    randomBytes: "function",
    bits2int: "function",
    bits2int_modN: "function"
  });
  const s = r.randomBytes || ur, n = r.hmac || ((R, ...d) => Ls(e, R, Ut(...d))), { Fp: i, Fn: o } = t, { ORDER: a, BITS: c } = o, { keygen: l, getPublicKey: u, getSharedSecret: h, utils: f, lengths: g } = Xm(t, r), p = {
    prehash: !1,
    lowS: typeof r.lowS == "boolean" ? r.lowS : !1,
    format: void 0,
    //'compact' as ECDSASigFormat,
    extraEntropy: !1
  }, y = "compact";
  function m(R) {
    const d = a >> Yr;
    return R > d;
  }
  function E(R, d) {
    if (!o.isValidNot0(d))
      throw new Error(`invalid signature ${R}: out of range 1..Point.Fn.ORDER`);
    return d;
  }
  function $(R, d) {
    Bo(d);
    const w = g.signature, _ = d === "compact" ? w : d === "recovered" ? w + 1 : void 0;
    return xr(R, _, `${d} signature`);
  }
  class b {
    constructor(d, w, _) {
      this.r = E("r", d), this.s = E("s", w), _ != null && (this.recovery = _), Object.freeze(this);
    }
    static fromBytes(d, w = y) {
      $(d, w);
      let _;
      if (w === "der") {
        const { r: C, s: M } = Nt.toSig(xr(d));
        return new b(C, M);
      }
      w === "recovered" && (_ = d[0], w = "compact", d = d.subarray(1));
      const O = o.BYTES, S = d.subarray(0, O), D = d.subarray(O, O * 2);
      return new b(o.fromBytes(S), o.fromBytes(D), _);
    }
    static fromHex(d, w) {
      return this.fromBytes(xn(d), w);
    }
    addRecoveryBit(d) {
      return new b(this.r, this.s, d);
    }
    recoverPublicKey(d) {
      const w = i.ORDER, { r: _, s: O, recovery: S } = this;
      if (S == null || ![0, 1, 2, 3].includes(S))
        throw new Error("recovery id invalid");
      if (a * lf < w && S > 1)
        throw new Error("recovery id is ambiguous for h>1 curve");
      const C = S === 2 || S === 3 ? _ + a : _;
      if (!i.isValid(C))
        throw new Error("recovery id 2 or 3 invalid");
      const M = i.toBytes(C), z = t.fromBytes(Ut(uf((S & 1) === 0), M)), k = o.inv(C), q = x(Ie("msgHash", d)), K = o.create(-q * k), W = o.create(O * k), G = t.BASE.multiplyUnsafe(K).add(z.multiplyUnsafe(W));
      if (G.is0())
        throw new Error("point at infinify");
      return G.assertValidity(), G;
    }
    // Signatures should be low-s, to prevent malleability.
    hasHighS() {
      return m(this.s);
    }
    toBytes(d = y) {
      if (Bo(d), d === "der")
        return xn(Nt.hexFromSig(this));
      const w = o.toBytes(this.r), _ = o.toBytes(this.s);
      if (d === "recovered") {
        if (this.recovery == null)
          throw new Error("recovery bit must be present");
        return Ut(Uint8Array.of(this.recovery), w, _);
      }
      return Ut(w, _);
    }
    toHex(d) {
      return Wr(this.toBytes(d));
    }
    // TODO: remove
    assertValidity() {
    }
    static fromCompact(d) {
      return b.fromBytes(Ie("sig", d), "compact");
    }
    static fromDER(d) {
      return b.fromBytes(Ie("sig", d), "der");
    }
    normalizeS() {
      return this.hasHighS() ? new b(this.r, o.neg(this.s), this.recovery) : this;
    }
    toDERRawBytes() {
      return this.toBytes("der");
    }
    toDERHex() {
      return Wr(this.toBytes("der"));
    }
    toCompactRawBytes() {
      return this.toBytes("compact");
    }
    toCompactHex() {
      return Wr(this.toBytes("compact"));
    }
  }
  const v = r.bits2int || function(d) {
    if (d.length > 8192)
      throw new Error("input is too large");
    const w = ei(d), _ = d.length * 8 - c;
    return _ > 0 ? w >> BigInt(_) : w;
  }, x = r.bits2int_modN || function(d) {
    return o.create(v(d));
  }, I = Fs(c);
  function P(R) {
    return Po("num < 2^" + c, R, Mt, I), o.toBytes(R);
  }
  function B(R, d) {
    return xr(R, void 0, "message"), d ? xr(e(R), void 0, "prehashed message") : R;
  }
  function T(R, d, w) {
    if (["recovered", "canonical"].some((K) => K in w))
      throw new Error("sign() legacy options not supported");
    const { lowS: _, prehash: O, extraEntropy: S } = Mi(w, p);
    R = B(R, O);
    const D = x(R), C = zr(o, d), M = [P(C), P(D)];
    if (S != null && S !== !1) {
      const K = S === !0 ? s(g.secretKey) : S;
      M.push(Ie("extraEntropy", K));
    }
    const z = Ut(...M), k = D;
    function q(K) {
      const W = v(K);
      if (!o.isValidNot0(W))
        return;
      const G = o.inv(W), V = t.BASE.multiply(W).toAffine(), Z = o.create(V.x);
      if (Z === Mt)
        return;
      const ie = o.create(G * o.create(k + Z * C));
      if (ie === Mt)
        return;
      let oe = (V.x === Z ? 0 : 2) | Number(V.y & Yr), de = ie;
      return _ && m(ie) && (de = o.neg(ie), oe ^= 1), new b(Z, de, oe);
    }
    return { seed: z, k2sig: q };
  }
  function L(R, d, w = {}) {
    R = Ie("message", R);
    const { seed: _, k2sig: O } = T(R, d, w);
    return Em(e.outputLen, o.BYTES, n)(_, O);
  }
  function U(R) {
    let d;
    const w = typeof R == "string" || Vn(R), _ = !w && R !== null && typeof R == "object" && typeof R.r == "bigint" && typeof R.s == "bigint";
    if (!w && !_)
      throw new Error("invalid signature, expected Uint8Array, hex string or Signature instance");
    if (_)
      d = new b(R.r, R.s);
    else if (w) {
      try {
        d = b.fromBytes(Ie("sig", R), "der");
      } catch (O) {
        if (!(O instanceof Nt.Err))
          throw O;
      }
      if (!d)
        try {
          d = b.fromBytes(Ie("sig", R), "compact");
        } catch {
          return !1;
        }
    }
    return d || !1;
  }
  function N(R, d, w, _ = {}) {
    const { lowS: O, prehash: S, format: D } = Mi(_, p);
    if (w = Ie("publicKey", w), d = B(Ie("message", d), S), "strict" in _)
      throw new Error("options.strict was renamed to lowS");
    const C = D === void 0 ? U(R) : b.fromBytes(Ie("sig", R), D);
    if (C === !1)
      return !1;
    try {
      const M = t.fromBytes(w);
      if (O && C.hasHighS())
        return !1;
      const { r: z, s: k } = C, q = x(d), K = o.inv(k), W = o.create(q * K), G = o.create(z * K), V = t.BASE.multiplyUnsafe(W).add(M.multiplyUnsafe(G));
      return V.is0() ? !1 : o.create(V.x) === z;
    } catch {
      return !1;
    }
  }
  function A(R, d, w = {}) {
    const { prehash: _ } = Mi(w, p);
    return d = B(d, _), b.fromBytes(R, "recovered").recoverPublicKey(d).toBytes();
  }
  return Object.freeze({
    keygen: l,
    getPublicKey: u,
    getSharedSecret: h,
    utils: f,
    lengths: g,
    Point: t,
    sign: L,
    verify: N,
    recoverPublicKey: A,
    Signature: b,
    hash: e
  });
}
function Qm(t) {
  const e = {
    a: t.a,
    b: t.b,
    p: t.Fp.ORDER,
    n: t.n,
    h: t.h,
    Gx: t.Gx,
    Gy: t.Gy
  }, r = t.Fp;
  let s = t.allowedPrivateKeyLengths ? Array.from(new Set(t.allowedPrivateKeyLengths.map((o) => Math.ceil(o / 2)))) : void 0;
  const n = hr(e.n, {
    BITS: t.nBitLength,
    allowedLengths: s,
    modFromBytes: t.wrapPrivateKey
  }), i = {
    Fp: r,
    Fn: n,
    allowInfinityPoint: t.allowInfinityPoint,
    endo: t.endo,
    isTorsionFree: t.isTorsionFree,
    clearCofactor: t.clearCofactor,
    fromBytes: t.fromBytes,
    toBytes: t.toBytes
  };
  return { CURVE: e, curveOpts: i };
}
function eb(t) {
  const { CURVE: e, curveOpts: r } = Qm(t), s = {
    hmac: t.hmac,
    randomBytes: t.randomBytes,
    lowS: t.lowS,
    bits2int: t.bits2int,
    bits2int_modN: t.bits2int_modN
  };
  return { CURVE: e, curveOpts: r, hash: t.hash, ecdsaOpts: s };
}
function tb(t, e) {
  const r = e.Point;
  return Object.assign({}, e, {
    ProjectivePoint: r,
    CURVE: Object.assign({}, t, rf(r.Fn.ORDER, r.Fn.BITS))
  });
}
function rb(t) {
  const { CURVE: e, curveOpts: r, hash: s, ecdsaOpts: n } = eb(t), i = Zm(e, r), o = Jm(i, s, n);
  return tb(t, o);
}
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function ma(t, e) {
  const r = (s) => rb({ ...t, hash: s });
  return { ...r(e), create: r };
}
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const ff = {
  p: BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff"),
  n: BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"),
  h: BigInt(1),
  a: BigInt("0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc"),
  b: BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b"),
  Gx: BigInt("0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"),
  Gy: BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5")
}, df = {
  p: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffff"),
  n: BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973"),
  h: BigInt(1),
  a: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000fffffffc"),
  b: BigInt("0xb3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aef"),
  Gx: BigInt("0xaa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab7"),
  Gy: BigInt("0x3617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5f")
}, pf = {
  p: BigInt("0x1ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"),
  n: BigInt("0x01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409"),
  h: BigInt(1),
  a: BigInt("0x1fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc"),
  b: BigInt("0x0051953eb9618e1c9a1f929a21a0b68540eea2da725b99b315f3b8b489918ef109e156193951ec7e937b1652c0bd3bb1bf073573df883d2c34f1ef451fd46b503f00"),
  Gx: BigInt("0x00c6858e06b70404e9cd9e3ecb662395b4429c648139053fb521f828af606b4d3dbaa14b5e77efe75928fe1dc127a2ffa8de3348b3c1856a429bf97e7e31c2e5bd66"),
  Gy: BigInt("0x011839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650")
}, sb = hr(ff.p), nb = hr(df.p), ib = hr(pf.p), ob = ma({ ...ff, Fp: sb, lowS: !1 }, Or);
ma({ ...df, Fp: nb, lowS: !1 }, kg);
ma({ ...pf, Fp: ib, lowS: !1, allowedPrivateKeyLengths: [130, 131, 132] }, Mg);
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const ab = ob, cb = (t) => JSON.stringify(t, (e, r) => typeof r == "bigint" ? r.toString() + "n" : r), lb = (t) => {
  const e = /([\[:])?(\d{17,}|(?:[9](?:[1-9]07199254740991|0[1-9]7199254740991|00[8-9]199254740991|007[2-9]99254740991|007199[3-9]54740991|0071992[6-9]4740991|00719925[5-9]740991|007199254[8-9]40991|0071992547[5-9]0991|00719925474[1-9]991|00719925474099[2-9])))([,\}\]])/g, r = t.replace(e, '$1"$2n"$3');
  return JSON.parse(r, (s, n) => typeof n == "string" && n.match(/^\d+n$/) ? BigInt(n.substring(0, n.length - 1)) : n);
};
function $r(t) {
  if (typeof t != "string")
    throw new Error(`Cannot safe json parse value of type ${typeof t}`);
  try {
    return lb(t);
  } catch {
    return t;
  }
}
function Pr(t) {
  return typeof t == "string" ? t : cb(t) || "";
}
function ub(t) {
  return t instanceof Uint8Array || ArrayBuffer.isView(t) && t.constructor.name === "Uint8Array";
}
function gf(t, ...e) {
  if (!ub(t)) throw new Error("Uint8Array expected");
  if (e.length > 0 && !e.includes(t.length)) throw new Error("Uint8Array expected of length " + e + ", got length=" + t.length);
}
function el(t, e = !0) {
  if (t.destroyed) throw new Error("Hash instance has been destroyed");
  if (e && t.finished) throw new Error("Hash#digest() has already been called");
}
function hb(t, e) {
  gf(t);
  const r = e.outputLen;
  if (t.length < r) throw new Error("digestInto() expects output buffer of length at least " + r);
}
const Fr = typeof globalThis == "object" && "crypto" in globalThis ? globalThis.crypto : void 0;
/*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const ki = (t) => new DataView(t.buffer, t.byteOffset, t.byteLength);
function fb(t) {
  if (typeof t != "string") throw new Error("utf8ToBytes expected string, got " + typeof t);
  return new Uint8Array(new TextEncoder().encode(t));
}
function yf(t) {
  return typeof t == "string" && (t = fb(t)), gf(t), t;
}
let db = class {
  clone() {
    return this._cloneInto();
  }
};
function pb(t) {
  const e = (s) => t().update(yf(s)).digest(), r = t();
  return e.outputLen = r.outputLen, e.blockLen = r.blockLen, e.create = () => t(), e;
}
function wf(t = 32) {
  if (Fr && typeof Fr.getRandomValues == "function") return Fr.getRandomValues(new Uint8Array(t));
  if (Fr && typeof Fr.randomBytes == "function") return Fr.randomBytes(t);
  throw new Error("crypto.getRandomValues must be defined");
}
function gb(t, e, r, s) {
  if (typeof t.setBigUint64 == "function") return t.setBigUint64(e, r, s);
  const n = BigInt(32), i = BigInt(4294967295), o = Number(r >> n & i), a = Number(r & i), c = s ? 4 : 0, l = s ? 0 : 4;
  t.setUint32(e + c, o, s), t.setUint32(e + l, a, s);
}
class yb extends db {
  constructor(e, r, s, n) {
    super(), this.blockLen = e, this.outputLen = r, this.padOffset = s, this.isLE = n, this.finished = !1, this.length = 0, this.pos = 0, this.destroyed = !1, this.buffer = new Uint8Array(e), this.view = ki(this.buffer);
  }
  update(e) {
    el(this);
    const { view: r, buffer: s, blockLen: n } = this;
    e = yf(e);
    const i = e.length;
    for (let o = 0; o < i; ) {
      const a = Math.min(n - this.pos, i - o);
      if (a === n) {
        const c = ki(e);
        for (; n <= i - o; o += n) this.process(c, o);
        continue;
      }
      s.set(e.subarray(o, o + a), this.pos), this.pos += a, o += a, this.pos === n && (this.process(r, 0), this.pos = 0);
    }
    return this.length += e.length, this.roundClean(), this;
  }
  digestInto(e) {
    el(this), hb(e, this), this.finished = !0;
    const { buffer: r, view: s, blockLen: n, isLE: i } = this;
    let { pos: o } = this;
    r[o++] = 128, this.buffer.subarray(o).fill(0), this.padOffset > n - o && (this.process(s, 0), o = 0);
    for (let h = o; h < n; h++) r[h] = 0;
    gb(s, n - 8, BigInt(this.length * 8), i), this.process(s, 0);
    const a = ki(e), c = this.outputLen;
    if (c % 4) throw new Error("_sha2: outputLen should be aligned to 32bit");
    const l = c / 4, u = this.get();
    if (l > u.length) throw new Error("_sha2: outputLen bigger than state");
    for (let h = 0; h < l; h++) a.setUint32(4 * h, u[h], i);
  }
  digest() {
    const { buffer: e, outputLen: r } = this;
    this.digestInto(e);
    const s = e.slice(0, r);
    return this.destroy(), s;
  }
  _cloneInto(e) {
    e || (e = new this.constructor()), e.set(...this.get());
    const { blockLen: r, buffer: s, length: n, finished: i, destroyed: o, pos: a } = this;
    return e.length = n, e.pos = a, e.finished = i, e.destroyed = o, n % r && e.buffer.set(s), e;
  }
}
const rn = BigInt(2 ** 32 - 1), Ro = BigInt(32);
function mf(t, e = !1) {
  return e ? { h: Number(t & rn), l: Number(t >> Ro & rn) } : { h: Number(t >> Ro & rn) | 0, l: Number(t & rn) | 0 };
}
function wb(t, e = !1) {
  let r = new Uint32Array(t.length), s = new Uint32Array(t.length);
  for (let n = 0; n < t.length; n++) {
    const { h: i, l: o } = mf(t[n], e);
    [r[n], s[n]] = [i, o];
  }
  return [r, s];
}
const mb = (t, e) => BigInt(t >>> 0) << Ro | BigInt(e >>> 0), bb = (t, e, r) => t >>> r, vb = (t, e, r) => t << 32 - r | e >>> r, Eb = (t, e, r) => t >>> r | e << 32 - r, xb = (t, e, r) => t << 32 - r | e >>> r, _b = (t, e, r) => t << 64 - r | e >>> r - 32, Sb = (t, e, r) => t >>> r - 32 | e << 64 - r, Ib = (t, e) => e, Db = (t, e) => t, Ab = (t, e, r) => t << r | e >>> 32 - r, Ob = (t, e, r) => e << r | t >>> 32 - r, $b = (t, e, r) => e << r - 32 | t >>> 64 - r, Pb = (t, e, r) => t << r - 32 | e >>> 64 - r;
function Tb(t, e, r, s) {
  const n = (e >>> 0) + (s >>> 0);
  return { h: t + r + (n / 2 ** 32 | 0) | 0, l: n | 0 };
}
const Bb = (t, e, r) => (t >>> 0) + (e >>> 0) + (r >>> 0), Rb = (t, e, r, s) => e + r + s + (t / 2 ** 32 | 0) | 0, Cb = (t, e, r, s) => (t >>> 0) + (e >>> 0) + (r >>> 0) + (s >>> 0), Nb = (t, e, r, s, n) => e + r + s + n + (t / 2 ** 32 | 0) | 0, Ub = (t, e, r, s, n) => (t >>> 0) + (e >>> 0) + (r >>> 0) + (s >>> 0) + (n >>> 0), Lb = (t, e, r, s, n, i) => e + r + s + n + i + (t / 2 ** 32 | 0) | 0, Y = { fromBig: mf, split: wb, toBig: mb, shrSH: bb, shrSL: vb, rotrSH: Eb, rotrSL: xb, rotrBH: _b, rotrBL: Sb, rotr32H: Ib, rotr32L: Db, rotlSH: Ab, rotlSL: Ob, rotlBH: $b, rotlBL: Pb, add: Tb, add3L: Bb, add3H: Rb, add4L: Cb, add4H: Nb, add5H: Lb, add5L: Ub }, [Mb, kb] = Y.split(["0x428a2f98d728ae22", "0x7137449123ef65cd", "0xb5c0fbcfec4d3b2f", "0xe9b5dba58189dbbc", "0x3956c25bf348b538", "0x59f111f1b605d019", "0x923f82a4af194f9b", "0xab1c5ed5da6d8118", "0xd807aa98a3030242", "0x12835b0145706fbe", "0x243185be4ee4b28c", "0x550c7dc3d5ffb4e2", "0x72be5d74f27b896f", "0x80deb1fe3b1696b1", "0x9bdc06a725c71235", "0xc19bf174cf692694", "0xe49b69c19ef14ad2", "0xefbe4786384f25e3", "0x0fc19dc68b8cd5b5", "0x240ca1cc77ac9c65", "0x2de92c6f592b0275", "0x4a7484aa6ea6e483", "0x5cb0a9dcbd41fbd4", "0x76f988da831153b5", "0x983e5152ee66dfab", "0xa831c66d2db43210", "0xb00327c898fb213f", "0xbf597fc7beef0ee4", "0xc6e00bf33da88fc2", "0xd5a79147930aa725", "0x06ca6351e003826f", "0x142929670a0e6e70", "0x27b70a8546d22ffc", "0x2e1b21385c26c926", "0x4d2c6dfc5ac42aed", "0x53380d139d95b3df", "0x650a73548baf63de", "0x766a0abb3c77b2a8", "0x81c2c92e47edaee6", "0x92722c851482353b", "0xa2bfe8a14cf10364", "0xa81a664bbc423001", "0xc24b8b70d0f89791", "0xc76c51a30654be30", "0xd192e819d6ef5218", "0xd69906245565a910", "0xf40e35855771202a", "0x106aa07032bbd1b8", "0x19a4c116b8d2d0c8", "0x1e376c085141ab53", "0x2748774cdf8eeb99", "0x34b0bcb5e19b48a8", "0x391c0cb3c5c95a63", "0x4ed8aa4ae3418acb", "0x5b9cca4f7763e373", "0x682e6ff3d6b2b8a3", "0x748f82ee5defb2fc", "0x78a5636f43172f60", "0x84c87814a1f0ab72", "0x8cc702081a6439ec", "0x90befffa23631e28", "0xa4506cebde82bde9", "0xbef9a3f7b2c67915", "0xc67178f2e372532b", "0xca273eceea26619c", "0xd186b8c721c0c207", "0xeada7dd6cde0eb1e", "0xf57d4f7fee6ed178", "0x06f067aa72176fba", "0x0a637dc5a2c898a6", "0x113f9804bef90dae", "0x1b710b35131c471b", "0x28db77f523047d84", "0x32caab7b40c72493", "0x3c9ebe0a15c9bebc", "0x431d67c49c100d4c", "0x4cc5d4becb3e42b6", "0x597f299cfc657e2a", "0x5fcb6fab3ad6faec", "0x6c44198c4a475817"].map((t) => BigInt(t))), Zt = new Uint32Array(80), Xt = new Uint32Array(80);
let qb = class extends yb {
  constructor() {
    super(128, 64, 16, !1), this.Ah = 1779033703, this.Al = -205731576, this.Bh = -1150833019, this.Bl = -2067093701, this.Ch = 1013904242, this.Cl = -23791573, this.Dh = -1521486534, this.Dl = 1595750129, this.Eh = 1359893119, this.El = -1377402159, this.Fh = -1694144372, this.Fl = 725511199, this.Gh = 528734635, this.Gl = -79577749, this.Hh = 1541459225, this.Hl = 327033209;
  }
  get() {
    const { Ah: e, Al: r, Bh: s, Bl: n, Ch: i, Cl: o, Dh: a, Dl: c, Eh: l, El: u, Fh: h, Fl: f, Gh: g, Gl: p, Hh: y, Hl: m } = this;
    return [e, r, s, n, i, o, a, c, l, u, h, f, g, p, y, m];
  }
  set(e, r, s, n, i, o, a, c, l, u, h, f, g, p, y, m) {
    this.Ah = e | 0, this.Al = r | 0, this.Bh = s | 0, this.Bl = n | 0, this.Ch = i | 0, this.Cl = o | 0, this.Dh = a | 0, this.Dl = c | 0, this.Eh = l | 0, this.El = u | 0, this.Fh = h | 0, this.Fl = f | 0, this.Gh = g | 0, this.Gl = p | 0, this.Hh = y | 0, this.Hl = m | 0;
  }
  process(e, r) {
    for (let b = 0; b < 16; b++, r += 4) Zt[b] = e.getUint32(r), Xt[b] = e.getUint32(r += 4);
    for (let b = 16; b < 80; b++) {
      const v = Zt[b - 15] | 0, x = Xt[b - 15] | 0, I = Y.rotrSH(v, x, 1) ^ Y.rotrSH(v, x, 8) ^ Y.shrSH(v, x, 7), P = Y.rotrSL(v, x, 1) ^ Y.rotrSL(v, x, 8) ^ Y.shrSL(v, x, 7), B = Zt[b - 2] | 0, T = Xt[b - 2] | 0, L = Y.rotrSH(B, T, 19) ^ Y.rotrBH(B, T, 61) ^ Y.shrSH(B, T, 6), U = Y.rotrSL(B, T, 19) ^ Y.rotrBL(B, T, 61) ^ Y.shrSL(B, T, 6), N = Y.add4L(P, U, Xt[b - 7], Xt[b - 16]), A = Y.add4H(N, I, L, Zt[b - 7], Zt[b - 16]);
      Zt[b] = A | 0, Xt[b] = N | 0;
    }
    let { Ah: s, Al: n, Bh: i, Bl: o, Ch: a, Cl: c, Dh: l, Dl: u, Eh: h, El: f, Fh: g, Fl: p, Gh: y, Gl: m, Hh: E, Hl: $ } = this;
    for (let b = 0; b < 80; b++) {
      const v = Y.rotrSH(h, f, 14) ^ Y.rotrSH(h, f, 18) ^ Y.rotrBH(h, f, 41), x = Y.rotrSL(h, f, 14) ^ Y.rotrSL(h, f, 18) ^ Y.rotrBL(h, f, 41), I = h & g ^ ~h & y, P = f & p ^ ~f & m, B = Y.add5L($, x, P, kb[b], Xt[b]), T = Y.add5H(B, E, v, I, Mb[b], Zt[b]), L = B | 0, U = Y.rotrSH(s, n, 28) ^ Y.rotrBH(s, n, 34) ^ Y.rotrBH(s, n, 39), N = Y.rotrSL(s, n, 28) ^ Y.rotrBL(s, n, 34) ^ Y.rotrBL(s, n, 39), A = s & i ^ s & a ^ i & a, R = n & o ^ n & c ^ o & c;
      E = y | 0, $ = m | 0, y = g | 0, m = p | 0, g = h | 0, p = f | 0, { h, l: f } = Y.add(l | 0, u | 0, T | 0, L | 0), l = a | 0, u = c | 0, a = i | 0, c = o | 0, i = s | 0, o = n | 0;
      const d = Y.add3L(L, N, R);
      s = Y.add3H(d, T, U, A), n = d | 0;
    }
    ({ h: s, l: n } = Y.add(this.Ah | 0, this.Al | 0, s | 0, n | 0)), { h: i, l: o } = Y.add(this.Bh | 0, this.Bl | 0, i | 0, o | 0), { h: a, l: c } = Y.add(this.Ch | 0, this.Cl | 0, a | 0, c | 0), { h: l, l: u } = Y.add(this.Dh | 0, this.Dl | 0, l | 0, u | 0), { h, l: f } = Y.add(this.Eh | 0, this.El | 0, h | 0, f | 0), { h: g, l: p } = Y.add(this.Fh | 0, this.Fl | 0, g | 0, p | 0), { h: y, l: m } = Y.add(this.Gh | 0, this.Gl | 0, y | 0, m | 0), { h: E, l: $ } = Y.add(this.Hh | 0, this.Hl | 0, E | 0, $ | 0), this.set(s, n, i, o, a, c, l, u, h, f, g, p, y, m, E, $);
  }
  roundClean() {
    Zt.fill(0), Xt.fill(0);
  }
  destroy() {
    this.buffer.fill(0), this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
};
const Fb = pb(() => new qb());
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const ba = BigInt(0), bf = BigInt(1), jb = BigInt(2);
function va(t) {
  return t instanceof Uint8Array || ArrayBuffer.isView(t) && t.constructor.name === "Uint8Array";
}
function Ea(t) {
  if (!va(t)) throw new Error("Uint8Array expected");
}
function qi(t, e) {
  if (typeof e != "boolean") throw new Error(t + " boolean expected, got " + e);
}
const zb = Array.from({ length: 256 }, (t, e) => e.toString(16).padStart(2, "0"));
function xa(t) {
  Ea(t);
  let e = "";
  for (let r = 0; r < t.length; r++) e += zb[t[r]];
  return e;
}
function vf(t) {
  if (typeof t != "string") throw new Error("hex string expected, got " + typeof t);
  return t === "" ? ba : BigInt("0x" + t);
}
const At = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function tl(t) {
  if (t >= At._0 && t <= At._9) return t - At._0;
  if (t >= At.A && t <= At.F) return t - (At.A - 10);
  if (t >= At.a && t <= At.f) return t - (At.a - 10);
}
function Ef(t) {
  if (typeof t != "string") throw new Error("hex string expected, got " + typeof t);
  const e = t.length, r = e / 2;
  if (e % 2) throw new Error("hex string expected, got unpadded hex of length " + e);
  const s = new Uint8Array(r);
  for (let n = 0, i = 0; n < r; n++, i += 2) {
    const o = tl(t.charCodeAt(i)), a = tl(t.charCodeAt(i + 1));
    if (o === void 0 || a === void 0) {
      const c = t[i] + t[i + 1];
      throw new Error('hex string expected, got non-hex character "' + c + '" at index ' + i);
    }
    s[n] = o * 16 + a;
  }
  return s;
}
function Hb(t) {
  return vf(xa(t));
}
function gn(t) {
  return Ea(t), vf(xa(Uint8Array.from(t).reverse()));
}
function xf(t, e) {
  return Ef(t.toString(16).padStart(e * 2, "0"));
}
function Co(t, e) {
  return xf(t, e).reverse();
}
function Ot(t, e, r) {
  let s;
  if (typeof e == "string") try {
    s = Ef(e);
  } catch (i) {
    throw new Error(t + " must be hex string or Uint8Array, cause: " + i);
  }
  else if (va(e)) s = Uint8Array.from(e);
  else throw new Error(t + " must be hex string or Uint8Array");
  const n = s.length;
  if (typeof r == "number" && n !== r) throw new Error(t + " of length " + r + " expected, got " + n);
  return s;
}
function rl(...t) {
  let e = 0;
  for (let s = 0; s < t.length; s++) {
    const n = t[s];
    Ea(n), e += n.length;
  }
  const r = new Uint8Array(e);
  for (let s = 0, n = 0; s < t.length; s++) {
    const i = t[s];
    r.set(i, n), n += i.length;
  }
  return r;
}
const Fi = (t) => typeof t == "bigint" && ba <= t;
function Kb(t, e, r) {
  return Fi(t) && Fi(e) && Fi(r) && e <= t && t < r;
}
function hs(t, e, r, s) {
  if (!Kb(e, r, s)) throw new Error("expected valid " + t + ": " + r + " <= n < " + s + ", got " + e);
}
function Vb(t) {
  let e;
  for (e = 0; t > ba; t >>= bf, e += 1) ;
  return e;
}
const Wb = (t) => (jb << BigInt(t - 1)) - bf, Gb = { bigint: (t) => typeof t == "bigint", function: (t) => typeof t == "function", boolean: (t) => typeof t == "boolean", string: (t) => typeof t == "string", stringOrUint8Array: (t) => typeof t == "string" || va(t), isSafeInteger: (t) => Number.isSafeInteger(t), array: (t) => Array.isArray(t), field: (t, e) => e.Fp.isValid(t), hash: (t) => typeof t == "function" && Number.isSafeInteger(t.outputLen) };
function _a(t, e, r = {}) {
  const s = (n, i, o) => {
    const a = Gb[i];
    if (typeof a != "function") throw new Error("invalid validator function");
    const c = t[n];
    if (!(o && c === void 0) && !a(c, t)) throw new Error("param " + String(n) + " is invalid. Expected " + i + ", got " + c);
  };
  for (const [n, i] of Object.entries(e)) s(n, i, !1);
  for (const [n, i] of Object.entries(r)) s(n, i, !0);
  return t;
}
function sl(t) {
  const e = /* @__PURE__ */ new WeakMap();
  return (r, ...s) => {
    const n = e.get(r);
    if (n !== void 0) return n;
    const i = t(r, ...s);
    return e.set(r, i), i;
  };
}
const ye = BigInt(0), ne = BigInt(1), br = BigInt(2), Yb = BigInt(3), No = BigInt(4), nl = BigInt(5), il = BigInt(8);
function ue(t, e) {
  const r = t % e;
  return r >= ye ? r : e + r;
}
function Zb(t, e, r) {
  if (e < ye) throw new Error("invalid exponent, negatives unsupported");
  if (r <= ye) throw new Error("invalid modulus");
  if (r === ne) return ye;
  let s = ne;
  for (; e > ye; ) e & ne && (s = s * t % r), t = t * t % r, e >>= ne;
  return s;
}
function ht(t, e, r) {
  let s = t;
  for (; e-- > ye; ) s *= s, s %= r;
  return s;
}
function ol(t, e) {
  if (t === ye) throw new Error("invert: expected non-zero number");
  if (e <= ye) throw new Error("invert: expected positive modulus, got " + e);
  let r = ue(t, e), s = e, n = ye, i = ne;
  for (; r !== ye; ) {
    const o = s / r, a = s % r, c = n - i * o;
    s = r, r = a, n = i, i = c;
  }
  if (s !== ne) throw new Error("invert: does not exist");
  return ue(n, e);
}
function Xb(t) {
  const e = (t - ne) / br;
  let r, s, n;
  for (r = t - ne, s = 0; r % br === ye; r /= br, s++) ;
  for (n = br; n < t && Zb(n, e, t) !== t - ne; n++) if (n > 1e3) throw new Error("Cannot find square root: likely non-prime P");
  if (s === 1) {
    const o = (t + ne) / No;
    return function(a, c) {
      const l = a.pow(c, o);
      if (!a.eql(a.sqr(l), c)) throw new Error("Cannot find square root");
      return l;
    };
  }
  const i = (r + ne) / br;
  return function(o, a) {
    if (o.pow(a, e) === o.neg(o.ONE)) throw new Error("Cannot find square root");
    let c = s, l = o.pow(o.mul(o.ONE, n), r), u = o.pow(a, i), h = o.pow(a, r);
    for (; !o.eql(h, o.ONE); ) {
      if (o.eql(h, o.ZERO)) return o.ZERO;
      let f = 1;
      for (let p = o.sqr(h); f < c && !o.eql(p, o.ONE); f++) p = o.sqr(p);
      const g = o.pow(l, ne << BigInt(c - f - 1));
      l = o.sqr(g), u = o.mul(u, g), h = o.mul(h, l), c = f;
    }
    return u;
  };
}
function Jb(t) {
  if (t % No === Yb) {
    const e = (t + ne) / No;
    return function(r, s) {
      const n = r.pow(s, e);
      if (!r.eql(r.sqr(n), s)) throw new Error("Cannot find square root");
      return n;
    };
  }
  if (t % il === nl) {
    const e = (t - nl) / il;
    return function(r, s) {
      const n = r.mul(s, br), i = r.pow(n, e), o = r.mul(s, i), a = r.mul(r.mul(o, br), i), c = r.mul(o, r.sub(a, r.ONE));
      if (!r.eql(r.sqr(c), s)) throw new Error("Cannot find square root");
      return c;
    };
  }
  return Xb(t);
}
const Qb = (t, e) => (ue(t, e) & ne) === ne, e1 = ["create", "isValid", "is0", "neg", "inv", "sqrt", "sqr", "eql", "add", "sub", "mul", "pow", "div", "addN", "subN", "mulN", "sqrN"];
function t1(t) {
  const e = { ORDER: "bigint", MASK: "bigint", BYTES: "isSafeInteger", BITS: "isSafeInteger" }, r = e1.reduce((s, n) => (s[n] = "function", s), e);
  return _a(t, r);
}
function r1(t, e, r) {
  if (r < ye) throw new Error("invalid exponent, negatives unsupported");
  if (r === ye) return t.ONE;
  if (r === ne) return e;
  let s = t.ONE, n = e;
  for (; r > ye; ) r & ne && (s = t.mul(s, n)), n = t.sqr(n), r >>= ne;
  return s;
}
function s1(t, e) {
  const r = new Array(e.length), s = e.reduce((i, o, a) => t.is0(o) ? i : (r[a] = i, t.mul(i, o)), t.ONE), n = t.inv(s);
  return e.reduceRight((i, o, a) => t.is0(o) ? i : (r[a] = t.mul(i, r[a]), t.mul(i, o)), n), r;
}
function _f(t, e) {
  const r = e !== void 0 ? e : t.toString(2).length, s = Math.ceil(r / 8);
  return { nBitLength: r, nByteLength: s };
}
function Sf(t, e, r = !1, s = {}) {
  if (t <= ye) throw new Error("invalid field: expected ORDER > 0, got " + t);
  const { nBitLength: n, nByteLength: i } = _f(t, e);
  if (i > 2048) throw new Error("invalid field: expected ORDER of <= 2048 bytes");
  let o;
  const a = Object.freeze({ ORDER: t, isLE: r, BITS: n, BYTES: i, MASK: Wb(n), ZERO: ye, ONE: ne, create: (c) => ue(c, t), isValid: (c) => {
    if (typeof c != "bigint") throw new Error("invalid field element: expected bigint, got " + typeof c);
    return ye <= c && c < t;
  }, is0: (c) => c === ye, isOdd: (c) => (c & ne) === ne, neg: (c) => ue(-c, t), eql: (c, l) => c === l, sqr: (c) => ue(c * c, t), add: (c, l) => ue(c + l, t), sub: (c, l) => ue(c - l, t), mul: (c, l) => ue(c * l, t), pow: (c, l) => r1(a, c, l), div: (c, l) => ue(c * ol(l, t), t), sqrN: (c) => c * c, addN: (c, l) => c + l, subN: (c, l) => c - l, mulN: (c, l) => c * l, inv: (c) => ol(c, t), sqrt: s.sqrt || ((c) => (o || (o = Jb(t)), o(a, c))), invertBatch: (c) => s1(a, c), cmov: (c, l, u) => u ? l : c, toBytes: (c) => r ? Co(c, i) : xf(c, i), fromBytes: (c) => {
    if (c.length !== i) throw new Error("Field.fromBytes: expected " + i + " bytes, got " + c.length);
    return r ? gn(c) : Hb(c);
  } });
  return Object.freeze(a);
}
const al = BigInt(0), sn = BigInt(1);
function ji(t, e) {
  const r = e.negate();
  return t ? r : e;
}
function If(t, e) {
  if (!Number.isSafeInteger(t) || t <= 0 || t > e) throw new Error("invalid window size, expected [1.." + e + "], got W=" + t);
}
function zi(t, e) {
  If(t, e);
  const r = Math.ceil(e / t) + 1, s = 2 ** (t - 1);
  return { windows: r, windowSize: s };
}
function n1(t, e) {
  if (!Array.isArray(t)) throw new Error("array expected");
  t.forEach((r, s) => {
    if (!(r instanceof e)) throw new Error("invalid point at index " + s);
  });
}
function i1(t, e) {
  if (!Array.isArray(t)) throw new Error("array of scalars expected");
  t.forEach((r, s) => {
    if (!e.isValid(r)) throw new Error("invalid scalar at index " + s);
  });
}
const Hi = /* @__PURE__ */ new WeakMap(), Df = /* @__PURE__ */ new WeakMap();
function Ki(t) {
  return Df.get(t) || 1;
}
function o1(t, e) {
  return { constTimeNegate: ji, hasPrecomputes(r) {
    return Ki(r) !== 1;
  }, unsafeLadder(r, s, n = t.ZERO) {
    let i = r;
    for (; s > al; ) s & sn && (n = n.add(i)), i = i.double(), s >>= sn;
    return n;
  }, precomputeWindow(r, s) {
    const { windows: n, windowSize: i } = zi(s, e), o = [];
    let a = r, c = a;
    for (let l = 0; l < n; l++) {
      c = a, o.push(c);
      for (let u = 1; u < i; u++) c = c.add(a), o.push(c);
      a = c.double();
    }
    return o;
  }, wNAF(r, s, n) {
    const { windows: i, windowSize: o } = zi(r, e);
    let a = t.ZERO, c = t.BASE;
    const l = BigInt(2 ** r - 1), u = 2 ** r, h = BigInt(r);
    for (let f = 0; f < i; f++) {
      const g = f * o;
      let p = Number(n & l);
      n >>= h, p > o && (p -= u, n += sn);
      const y = g, m = g + Math.abs(p) - 1, E = f % 2 !== 0, $ = p < 0;
      p === 0 ? c = c.add(ji(E, s[y])) : a = a.add(ji($, s[m]));
    }
    return { p: a, f: c };
  }, wNAFUnsafe(r, s, n, i = t.ZERO) {
    const { windows: o, windowSize: a } = zi(r, e), c = BigInt(2 ** r - 1), l = 2 ** r, u = BigInt(r);
    for (let h = 0; h < o; h++) {
      const f = h * a;
      if (n === al) break;
      let g = Number(n & c);
      if (n >>= u, g > a && (g -= l, n += sn), g === 0) continue;
      let p = s[f + Math.abs(g) - 1];
      g < 0 && (p = p.negate()), i = i.add(p);
    }
    return i;
  }, getPrecomputes(r, s, n) {
    let i = Hi.get(s);
    return i || (i = this.precomputeWindow(s, r), r !== 1 && Hi.set(s, n(i))), i;
  }, wNAFCached(r, s, n) {
    const i = Ki(r);
    return this.wNAF(i, this.getPrecomputes(i, r, n), s);
  }, wNAFCachedUnsafe(r, s, n, i) {
    const o = Ki(r);
    return o === 1 ? this.unsafeLadder(r, s, i) : this.wNAFUnsafe(o, this.getPrecomputes(o, r, n), s, i);
  }, setWindowSize(r, s) {
    If(s, e), Df.set(r, s), Hi.delete(r);
  } };
}
function a1(t, e, r, s) {
  if (n1(r, t), i1(s, e), r.length !== s.length) throw new Error("arrays of points and scalars must have equal length");
  const n = t.ZERO, i = Vb(BigInt(r.length)), o = i > 12 ? i - 3 : i > 4 ? i - 2 : i ? 2 : 1, a = (1 << o) - 1, c = new Array(a + 1).fill(n), l = Math.floor((e.BITS - 1) / o) * o;
  let u = n;
  for (let h = l; h >= 0; h -= o) {
    c.fill(n);
    for (let g = 0; g < s.length; g++) {
      const p = s[g], y = Number(p >> BigInt(h) & BigInt(a));
      c[y] = c[y].add(r[g]);
    }
    let f = n;
    for (let g = c.length - 1, p = n; g > 0; g--) p = p.add(c[g]), f = f.add(p);
    if (u = u.add(f), h !== 0) for (let g = 0; g < o; g++) u = u.double();
  }
  return u;
}
function c1(t) {
  return t1(t.Fp), _a(t, { n: "bigint", h: "bigint", Gx: "field", Gy: "field" }, { nBitLength: "isSafeInteger", nByteLength: "isSafeInteger" }), Object.freeze({ ..._f(t.n, t.nBitLength), ...t, p: t.Fp.ORDER });
}
const et = BigInt(0), Pe = BigInt(1), nn = BigInt(2), l1 = BigInt(8), u1 = { zip215: !0 };
function h1(t) {
  const e = c1(t);
  return _a(t, { hash: "function", a: "bigint", d: "bigint", randomBytes: "function" }, { adjustScalarBytes: "function", domain: "function", uvRatio: "function", mapToCurve: "function" }), Object.freeze({ ...e });
}
function f1(t) {
  const e = h1(t), { Fp: r, n: s, prehash: n, hash: i, randomBytes: o, nByteLength: a, h: c } = e, l = nn << BigInt(a * 8) - Pe, u = r.create, h = Sf(e.n, e.nBitLength), f = e.uvRatio || ((d, w) => {
    try {
      return { isValid: !0, value: r.sqrt(d * r.inv(w)) };
    } catch {
      return { isValid: !1, value: et };
    }
  }), g = e.adjustScalarBytes || ((d) => d), p = e.domain || ((d, w, _) => {
    if (qi("phflag", _), w.length || _) throw new Error("Contexts/pre-hash are not supported");
    return d;
  });
  function y(d, w) {
    hs("coordinate " + d, w, et, l);
  }
  function m(d) {
    if (!(d instanceof b)) throw new Error("ExtendedPoint expected");
  }
  const E = sl((d, w) => {
    const { ex: _, ey: O, ez: S } = d, D = d.is0();
    w == null && (w = D ? l1 : r.inv(S));
    const C = u(_ * w), M = u(O * w), z = u(S * w);
    if (D) return { x: et, y: Pe };
    if (z !== Pe) throw new Error("invZ was invalid");
    return { x: C, y: M };
  }), $ = sl((d) => {
    const { a: w, d: _ } = e;
    if (d.is0()) throw new Error("bad point: ZERO");
    const { ex: O, ey: S, ez: D, et: C } = d, M = u(O * O), z = u(S * S), k = u(D * D), q = u(k * k), K = u(M * w), W = u(k * u(K + z)), G = u(q + u(_ * u(M * z)));
    if (W !== G) throw new Error("bad point: equation left != right (1)");
    const V = u(O * S), Z = u(D * C);
    if (V !== Z) throw new Error("bad point: equation left != right (2)");
    return !0;
  });
  class b {
    constructor(w, _, O, S) {
      this.ex = w, this.ey = _, this.ez = O, this.et = S, y("x", w), y("y", _), y("z", O), y("t", S), Object.freeze(this);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    static fromAffine(w) {
      if (w instanceof b) throw new Error("extended point not allowed");
      const { x: _, y: O } = w || {};
      return y("x", _), y("y", O), new b(_, O, Pe, u(_ * O));
    }
    static normalizeZ(w) {
      const _ = r.invertBatch(w.map((O) => O.ez));
      return w.map((O, S) => O.toAffine(_[S])).map(b.fromAffine);
    }
    static msm(w, _) {
      return a1(b, h, w, _);
    }
    _setWindowSize(w) {
      I.setWindowSize(this, w);
    }
    assertValidity() {
      $(this);
    }
    equals(w) {
      m(w);
      const { ex: _, ey: O, ez: S } = this, { ex: D, ey: C, ez: M } = w, z = u(_ * M), k = u(D * S), q = u(O * M), K = u(C * S);
      return z === k && q === K;
    }
    is0() {
      return this.equals(b.ZERO);
    }
    negate() {
      return new b(u(-this.ex), this.ey, this.ez, u(-this.et));
    }
    double() {
      const { a: w } = e, { ex: _, ey: O, ez: S } = this, D = u(_ * _), C = u(O * O), M = u(nn * u(S * S)), z = u(w * D), k = _ + O, q = u(u(k * k) - D - C), K = z + C, W = K - M, G = z - C, V = u(q * W), Z = u(K * G), ie = u(q * G), oe = u(W * K);
      return new b(V, Z, oe, ie);
    }
    add(w) {
      m(w);
      const { a: _, d: O } = e, { ex: S, ey: D, ez: C, et: M } = this, { ex: z, ey: k, ez: q, et: K } = w;
      if (_ === BigInt(-1)) {
        const Ha = u((D - S) * (k + z)), Ka = u((D + S) * (k - z)), hi = u(Ka - Ha);
        if (hi === et) return this.double();
        const Va = u(C * nn * K), Wa = u(M * nn * q), Ga = Wa + Va, Ya = Ka + Ha, Za = Wa - Va, cp = u(Ga * hi), lp = u(Ya * Za), up = u(Ga * Za), hp = u(hi * Ya);
        return new b(cp, lp, hp, up);
      }
      const W = u(S * z), G = u(D * k), V = u(M * O * K), Z = u(C * q), ie = u((S + D) * (z + k) - W - G), oe = Z - V, de = Z + V, Je = u(G - _ * W), Qe = u(ie * oe), Vs = u(de * Je), op = u(ie * Je), ap = u(oe * de);
      return new b(Qe, Vs, ap, op);
    }
    subtract(w) {
      return this.add(w.negate());
    }
    wNAF(w) {
      return I.wNAFCached(this, w, b.normalizeZ);
    }
    multiply(w) {
      const _ = w;
      hs("scalar", _, Pe, s);
      const { p: O, f: S } = this.wNAF(_);
      return b.normalizeZ([O, S])[0];
    }
    multiplyUnsafe(w, _ = b.ZERO) {
      const O = w;
      return hs("scalar", O, et, s), O === et ? x : this.is0() || O === Pe ? this : I.wNAFCachedUnsafe(this, O, b.normalizeZ, _);
    }
    isSmallOrder() {
      return this.multiplyUnsafe(c).is0();
    }
    isTorsionFree() {
      return I.unsafeLadder(this, s).is0();
    }
    toAffine(w) {
      return E(this, w);
    }
    clearCofactor() {
      const { h: w } = e;
      return w === Pe ? this : this.multiplyUnsafe(w);
    }
    static fromHex(w, _ = !1) {
      const { d: O, a: S } = e, D = r.BYTES;
      w = Ot("pointHex", w, D), qi("zip215", _);
      const C = w.slice(), M = w[D - 1];
      C[D - 1] = M & -129;
      const z = gn(C), k = _ ? l : r.ORDER;
      hs("pointHex.y", z, et, k);
      const q = u(z * z), K = u(q - Pe), W = u(O * q - S);
      let { isValid: G, value: V } = f(K, W);
      if (!G) throw new Error("Point.fromHex: invalid y coordinate");
      const Z = (V & Pe) === Pe, ie = (M & 128) !== 0;
      if (!_ && V === et && ie) throw new Error("Point.fromHex: x=0 and x_0=1");
      return ie !== Z && (V = u(-V)), b.fromAffine({ x: V, y: z });
    }
    static fromPrivateKey(w) {
      return T(w).point;
    }
    toRawBytes() {
      const { x: w, y: _ } = this.toAffine(), O = Co(_, r.BYTES);
      return O[O.length - 1] |= w & Pe ? 128 : 0, O;
    }
    toHex() {
      return xa(this.toRawBytes());
    }
  }
  b.BASE = new b(e.Gx, e.Gy, Pe, u(e.Gx * e.Gy)), b.ZERO = new b(et, Pe, Pe, et);
  const { BASE: v, ZERO: x } = b, I = o1(b, a * 8);
  function P(d) {
    return ue(d, s);
  }
  function B(d) {
    return P(gn(d));
  }
  function T(d) {
    const w = r.BYTES;
    d = Ot("private key", d, w);
    const _ = Ot("hashed private key", i(d), 2 * w), O = g(_.slice(0, w)), S = _.slice(w, 2 * w), D = B(O), C = v.multiply(D), M = C.toRawBytes();
    return { head: O, prefix: S, scalar: D, point: C, pointBytes: M };
  }
  function L(d) {
    return T(d).pointBytes;
  }
  function U(d = new Uint8Array(), ...w) {
    const _ = rl(...w);
    return B(i(p(_, Ot("context", d), !!n)));
  }
  function N(d, w, _ = {}) {
    d = Ot("message", d), n && (d = n(d));
    const { prefix: O, scalar: S, pointBytes: D } = T(w), C = U(_.context, O, d), M = v.multiply(C).toRawBytes(), z = U(_.context, M, D, d), k = P(C + z * S);
    hs("signature.s", k, et, s);
    const q = rl(M, Co(k, r.BYTES));
    return Ot("result", q, r.BYTES * 2);
  }
  const A = u1;
  function R(d, w, _, O = A) {
    const { context: S, zip215: D } = O, C = r.BYTES;
    d = Ot("signature", d, 2 * C), w = Ot("message", w), _ = Ot("publicKey", _, C), D !== void 0 && qi("zip215", D), n && (w = n(w));
    const M = gn(d.slice(C, 2 * C));
    let z, k, q;
    try {
      z = b.fromHex(_, D), k = b.fromHex(d.slice(0, C), D), q = v.multiplyUnsafe(M);
    } catch {
      return !1;
    }
    if (!D && z.isSmallOrder()) return !1;
    const K = U(S, k.toRawBytes(), z.toRawBytes(), w);
    return k.add(z.multiplyUnsafe(K)).subtract(q).clearCofactor().equals(b.ZERO);
  }
  return v._setWindowSize(8), { CURVE: e, getPublicKey: L, sign: N, verify: R, ExtendedPoint: b, utils: { getExtendedPublicKey: T, randomPrivateKey: () => o(r.BYTES), precompute(d = 8, w = b.BASE) {
    return w._setWindowSize(d), w.multiply(BigInt(3)), w;
  } } };
}
BigInt(0), BigInt(1);
const Sa = BigInt("57896044618658097711785492504343953926634992332820282019728792003956564819949"), cl = BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
BigInt(0);
const d1 = BigInt(1), ll = BigInt(2);
BigInt(3);
const p1 = BigInt(5), g1 = BigInt(8);
function y1(t) {
  const e = BigInt(10), r = BigInt(20), s = BigInt(40), n = BigInt(80), i = Sa, o = t * t % i * t % i, a = ht(o, ll, i) * o % i, c = ht(a, d1, i) * t % i, l = ht(c, p1, i) * c % i, u = ht(l, e, i) * l % i, h = ht(u, r, i) * u % i, f = ht(h, s, i) * h % i, g = ht(f, n, i) * f % i, p = ht(g, n, i) * f % i, y = ht(p, e, i) * l % i;
  return { pow_p_5_8: ht(y, ll, i) * t % i, b2: o };
}
function w1(t) {
  return t[0] &= 248, t[31] &= 127, t[31] |= 64, t;
}
function m1(t, e) {
  const r = Sa, s = ue(e * e * e, r), n = ue(s * s * e, r), i = y1(t * n).pow_p_5_8;
  let o = ue(t * s * i, r);
  const a = ue(e * o * o, r), c = o, l = ue(o * cl, r), u = a === t, h = a === ue(-t, r), f = a === ue(-t * cl, r);
  return u && (o = c), (h || f) && (o = l), Qb(o, r) && (o = ue(-o, r)), { isValid: u || h, value: o };
}
const b1 = Sf(Sa, void 0, !0), v1 = { a: BigInt(-1), d: BigInt("37095705934669439343138083508754565189542113879843219016388785533085940283555"), Fp: b1, n: BigInt("7237005577332262213973186563042994240857116359379907606001950938285454250989"), h: g1, Gx: BigInt("15112221349535400772501151409588531511454012693041857206046113283949847762202"), Gy: BigInt("46316835694926478169428394003475163141307993866256225615783033603165251855960"), hash: Fb, randomBytes: wf, adjustScalarBytes: w1, uvRatio: m1 }, Af = f1(v1), E1 = "EdDSA", x1 = "JWT", Rn = ".", ri = "base64url", Of = "utf8", $f = "utf8", _1 = ":", S1 = "did", I1 = "key", ul = "base58btc", D1 = "z", A1 = "K36", O1 = 32;
function Ia(t) {
  return globalThis.Buffer != null ? new Uint8Array(t.buffer, t.byteOffset, t.byteLength) : t;
}
function Pf(t = 0) {
  return globalThis.Buffer != null && globalThis.Buffer.allocUnsafe != null ? Ia(globalThis.Buffer.allocUnsafe(t)) : new Uint8Array(t);
}
function Tf(t, e) {
  e || (e = t.reduce((n, i) => n + i.length, 0));
  const r = Pf(e);
  let s = 0;
  for (const n of t) r.set(n, s), s += n.length;
  return Ia(r);
}
function $1(t, e) {
  if (t.length >= 255) throw new TypeError("Alphabet too long");
  for (var r = new Uint8Array(256), s = 0; s < r.length; s++) r[s] = 255;
  for (var n = 0; n < t.length; n++) {
    var i = t.charAt(n), o = i.charCodeAt(0);
    if (r[o] !== 255) throw new TypeError(i + " is ambiguous");
    r[o] = n;
  }
  var a = t.length, c = t.charAt(0), l = Math.log(a) / Math.log(256), u = Math.log(256) / Math.log(a);
  function h(p) {
    if (p instanceof Uint8Array || (ArrayBuffer.isView(p) ? p = new Uint8Array(p.buffer, p.byteOffset, p.byteLength) : Array.isArray(p) && (p = Uint8Array.from(p))), !(p instanceof Uint8Array)) throw new TypeError("Expected Uint8Array");
    if (p.length === 0) return "";
    for (var y = 0, m = 0, E = 0, $ = p.length; E !== $ && p[E] === 0; ) E++, y++;
    for (var b = ($ - E) * u + 1 >>> 0, v = new Uint8Array(b); E !== $; ) {
      for (var x = p[E], I = 0, P = b - 1; (x !== 0 || I < m) && P !== -1; P--, I++) x += 256 * v[P] >>> 0, v[P] = x % a >>> 0, x = x / a >>> 0;
      if (x !== 0) throw new Error("Non-zero carry");
      m = I, E++;
    }
    for (var B = b - m; B !== b && v[B] === 0; ) B++;
    for (var T = c.repeat(y); B < b; ++B) T += t.charAt(v[B]);
    return T;
  }
  function f(p) {
    if (typeof p != "string") throw new TypeError("Expected String");
    if (p.length === 0) return new Uint8Array();
    var y = 0;
    if (p[y] !== " ") {
      for (var m = 0, E = 0; p[y] === c; ) m++, y++;
      for (var $ = (p.length - y) * l + 1 >>> 0, b = new Uint8Array($); p[y]; ) {
        var v = r[p.charCodeAt(y)];
        if (v === 255) return;
        for (var x = 0, I = $ - 1; (v !== 0 || x < E) && I !== -1; I--, x++) v += a * b[I] >>> 0, b[I] = v % 256 >>> 0, v = v / 256 >>> 0;
        if (v !== 0) throw new Error("Non-zero carry");
        E = x, y++;
      }
      if (p[y] !== " ") {
        for (var P = $ - E; P !== $ && b[P] === 0; ) P++;
        for (var B = new Uint8Array(m + ($ - P)), T = m; P !== $; ) B[T++] = b[P++];
        return B;
      }
    }
  }
  function g(p) {
    var y = f(p);
    if (y) return y;
    throw new Error(`Non-${e} character`);
  }
  return { encode: h, decodeUnsafe: f, decode: g };
}
var P1 = $1, T1 = P1;
const Bf = (t) => {
  if (t instanceof Uint8Array && t.constructor.name === "Uint8Array") return t;
  if (t instanceof ArrayBuffer) return new Uint8Array(t);
  if (ArrayBuffer.isView(t)) return new Uint8Array(t.buffer, t.byteOffset, t.byteLength);
  throw new Error("Unknown type, must be binary type");
}, B1 = (t) => new TextEncoder().encode(t), R1 = (t) => new TextDecoder().decode(t);
let C1 = class {
  constructor(e, r, s) {
    this.name = e, this.prefix = r, this.baseEncode = s;
  }
  encode(e) {
    if (e instanceof Uint8Array) return `${this.prefix}${this.baseEncode(e)}`;
    throw Error("Unknown type, must be binary type");
  }
}, N1 = class {
  constructor(e, r, s) {
    if (this.name = e, this.prefix = r, r.codePointAt(0) === void 0) throw new Error("Invalid prefix character");
    this.prefixCodePoint = r.codePointAt(0), this.baseDecode = s;
  }
  decode(e) {
    if (typeof e == "string") {
      if (e.codePointAt(0) !== this.prefixCodePoint) throw Error(`Unable to decode multibase string ${JSON.stringify(e)}, ${this.name} decoder only supports inputs prefixed with ${this.prefix}`);
      return this.baseDecode(e.slice(this.prefix.length));
    } else throw Error("Can only multibase decode strings");
  }
  or(e) {
    return Rf(this, e);
  }
}, U1 = class {
  constructor(e) {
    this.decoders = e;
  }
  or(e) {
    return Rf(this, e);
  }
  decode(e) {
    const r = e[0], s = this.decoders[r];
    if (s) return s.decode(e);
    throw RangeError(`Unable to decode multibase string ${JSON.stringify(e)}, only inputs prefixed with ${Object.keys(this.decoders)} are supported`);
  }
};
const Rf = (t, e) => new U1({ ...t.decoders || { [t.prefix]: t }, ...e.decoders || { [e.prefix]: e } });
let L1 = class {
  constructor(e, r, s, n) {
    this.name = e, this.prefix = r, this.baseEncode = s, this.baseDecode = n, this.encoder = new C1(e, r, s), this.decoder = new N1(e, r, n);
  }
  encode(e) {
    return this.encoder.encode(e);
  }
  decode(e) {
    return this.decoder.decode(e);
  }
};
const si = ({ name: t, prefix: e, encode: r, decode: s }) => new L1(t, e, r, s), js = ({ prefix: t, name: e, alphabet: r }) => {
  const { encode: s, decode: n } = T1(r, e);
  return si({ prefix: t, name: e, encode: s, decode: (i) => Bf(n(i)) });
}, M1 = (t, e, r, s) => {
  const n = {};
  for (let u = 0; u < e.length; ++u) n[e[u]] = u;
  let i = t.length;
  for (; t[i - 1] === "="; ) --i;
  const o = new Uint8Array(i * r / 8 | 0);
  let a = 0, c = 0, l = 0;
  for (let u = 0; u < i; ++u) {
    const h = n[t[u]];
    if (h === void 0) throw new SyntaxError(`Non-${s} character`);
    c = c << r | h, a += r, a >= 8 && (a -= 8, o[l++] = 255 & c >> a);
  }
  if (a >= r || 255 & c << 8 - a) throw new SyntaxError("Unexpected end of data");
  return o;
}, k1 = (t, e, r) => {
  const s = e[e.length - 1] === "=", n = (1 << r) - 1;
  let i = "", o = 0, a = 0;
  for (let c = 0; c < t.length; ++c) for (a = a << 8 | t[c], o += 8; o > r; ) o -= r, i += e[n & a >> o];
  if (o && (i += e[n & a << r - o]), s) for (; i.length * r & 7; ) i += "=";
  return i;
}, Ee = ({ name: t, prefix: e, bitsPerChar: r, alphabet: s }) => si({ prefix: e, name: t, encode(n) {
  return k1(n, s, r);
}, decode(n) {
  return M1(n, s, r, t);
} }), q1 = si({ prefix: "\0", name: "identity", encode: (t) => R1(t), decode: (t) => B1(t) });
var F1 = Object.freeze({ __proto__: null, identity: q1 });
const j1 = Ee({ prefix: "0", name: "base2", alphabet: "01", bitsPerChar: 1 });
var z1 = Object.freeze({ __proto__: null, base2: j1 });
const H1 = Ee({ prefix: "7", name: "base8", alphabet: "01234567", bitsPerChar: 3 });
var K1 = Object.freeze({ __proto__: null, base8: H1 });
const V1 = js({ prefix: "9", name: "base10", alphabet: "0123456789" });
var W1 = Object.freeze({ __proto__: null, base10: V1 });
const G1 = Ee({ prefix: "f", name: "base16", alphabet: "0123456789abcdef", bitsPerChar: 4 }), Y1 = Ee({ prefix: "F", name: "base16upper", alphabet: "0123456789ABCDEF", bitsPerChar: 4 });
var Z1 = Object.freeze({ __proto__: null, base16: G1, base16upper: Y1 });
const X1 = Ee({ prefix: "b", name: "base32", alphabet: "abcdefghijklmnopqrstuvwxyz234567", bitsPerChar: 5 }), J1 = Ee({ prefix: "B", name: "base32upper", alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", bitsPerChar: 5 }), Q1 = Ee({ prefix: "c", name: "base32pad", alphabet: "abcdefghijklmnopqrstuvwxyz234567=", bitsPerChar: 5 }), ev = Ee({ prefix: "C", name: "base32padupper", alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567=", bitsPerChar: 5 }), tv = Ee({ prefix: "v", name: "base32hex", alphabet: "0123456789abcdefghijklmnopqrstuv", bitsPerChar: 5 }), rv = Ee({ prefix: "V", name: "base32hexupper", alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUV", bitsPerChar: 5 }), sv = Ee({ prefix: "t", name: "base32hexpad", alphabet: "0123456789abcdefghijklmnopqrstuv=", bitsPerChar: 5 }), nv = Ee({ prefix: "T", name: "base32hexpadupper", alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUV=", bitsPerChar: 5 }), iv = Ee({ prefix: "h", name: "base32z", alphabet: "ybndrfg8ejkmcpqxot1uwisza345h769", bitsPerChar: 5 });
var ov = Object.freeze({ __proto__: null, base32: X1, base32upper: J1, base32pad: Q1, base32padupper: ev, base32hex: tv, base32hexupper: rv, base32hexpad: sv, base32hexpadupper: nv, base32z: iv });
const av = js({ prefix: "k", name: "base36", alphabet: "0123456789abcdefghijklmnopqrstuvwxyz" }), cv = js({ prefix: "K", name: "base36upper", alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ" });
var lv = Object.freeze({ __proto__: null, base36: av, base36upper: cv });
const uv = js({ name: "base58btc", prefix: "z", alphabet: "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz" }), hv = js({ name: "base58flickr", prefix: "Z", alphabet: "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ" });
var fv = Object.freeze({ __proto__: null, base58btc: uv, base58flickr: hv });
const dv = Ee({ prefix: "m", name: "base64", alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", bitsPerChar: 6 }), pv = Ee({ prefix: "M", name: "base64pad", alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=", bitsPerChar: 6 }), gv = Ee({ prefix: "u", name: "base64url", alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", bitsPerChar: 6 }), yv = Ee({ prefix: "U", name: "base64urlpad", alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=", bitsPerChar: 6 });
var wv = Object.freeze({ __proto__: null, base64: dv, base64pad: pv, base64url: gv, base64urlpad: yv });
const Cf = Array.from("🚀🪐☄🛰🌌🌑🌒🌓🌔🌕🌖🌗🌘🌍🌏🌎🐉☀💻🖥💾💿😂❤😍🤣😊🙏💕😭😘👍😅👏😁🔥🥰💔💖💙😢🤔😆🙄💪😉☺👌🤗💜😔😎😇🌹🤦🎉💞✌✨🤷😱😌🌸🙌😋💗💚😏💛🙂💓🤩😄😀🖤😃💯🙈👇🎶😒🤭❣😜💋👀😪😑💥🙋😞😩😡🤪👊🥳😥🤤👉💃😳✋😚😝😴🌟😬🙃🍀🌷😻😓⭐✅🥺🌈😈🤘💦✔😣🏃💐☹🎊💘😠☝😕🌺🎂🌻😐🖕💝🙊😹🗣💫💀👑🎵🤞😛🔴😤🌼😫⚽🤙☕🏆🤫👈😮🙆🍻🍃🐶💁😲🌿🧡🎁⚡🌞🎈❌✊👋😰🤨😶🤝🚶💰🍓💢🤟🙁🚨💨🤬✈🎀🍺🤓😙💟🌱😖👶🥴▶➡❓💎💸⬇😨🌚🦋😷🕺⚠🙅😟😵👎🤲🤠🤧📌🔵💅🧐🐾🍒😗🤑🌊🤯🐷☎💧😯💆👆🎤🙇🍑❄🌴💣🐸💌📍🥀🤢👅💡💩👐📸👻🤐🤮🎼🥵🚩🍎🍊👼💍📣🥂"), mv = Cf.reduce((t, e, r) => (t[r] = e, t), []), bv = Cf.reduce((t, e, r) => (t[e.codePointAt(0)] = r, t), []);
function vv(t) {
  return t.reduce((e, r) => (e += mv[r], e), "");
}
function Ev(t) {
  const e = [];
  for (const r of t) {
    const s = bv[r.codePointAt(0)];
    if (s === void 0) throw new Error(`Non-base256emoji character: ${r}`);
    e.push(s);
  }
  return new Uint8Array(e);
}
const xv = si({ prefix: "🚀", name: "base256emoji", encode: vv, decode: Ev });
var _v = Object.freeze({ __proto__: null, base256emoji: xv }), Sv = Nf, hl = 128, Iv = -128, Dv = Math.pow(2, 31);
function Nf(t, e, r) {
  e = e || [], r = r || 0;
  for (var s = r; t >= Dv; ) e[r++] = t & 255 | hl, t /= 128;
  for (; t & Iv; ) e[r++] = t & 255 | hl, t >>>= 7;
  return e[r] = t | 0, Nf.bytes = r - s + 1, e;
}
var Av = Uo, Ov = 128, fl = 127;
function Uo(t, s) {
  var r = 0, s = s || 0, n = 0, i = s, o, a = t.length;
  do {
    if (i >= a) throw Uo.bytes = 0, new RangeError("Could not decode varint");
    o = t[i++], r += n < 28 ? (o & fl) << n : (o & fl) * Math.pow(2, n), n += 7;
  } while (o >= Ov);
  return Uo.bytes = i - s, r;
}
var $v = Math.pow(2, 7), Pv = Math.pow(2, 14), Tv = Math.pow(2, 21), Bv = Math.pow(2, 28), Rv = Math.pow(2, 35), Cv = Math.pow(2, 42), Nv = Math.pow(2, 49), Uv = Math.pow(2, 56), Lv = Math.pow(2, 63), Mv = function(t) {
  return t < $v ? 1 : t < Pv ? 2 : t < Tv ? 3 : t < Bv ? 4 : t < Rv ? 5 : t < Cv ? 6 : t < Nv ? 7 : t < Uv ? 8 : t < Lv ? 9 : 10;
}, kv = { encode: Sv, decode: Av, encodingLength: Mv }, Uf = kv;
const dl = (t, e, r = 0) => (Uf.encode(t, e, r), e), pl = (t) => Uf.encodingLength(t), Lo = (t, e) => {
  const r = e.byteLength, s = pl(t), n = s + pl(r), i = new Uint8Array(n + r);
  return dl(t, i, 0), dl(r, i, s), i.set(e, n), new qv(t, r, e, i);
};
let qv = class {
  constructor(e, r, s, n) {
    this.code = e, this.size = r, this.digest = s, this.bytes = n;
  }
};
const Lf = ({ name: t, code: e, encode: r }) => new Fv(t, e, r);
let Fv = class {
  constructor(e, r, s) {
    this.name = e, this.code = r, this.encode = s;
  }
  digest(e) {
    if (e instanceof Uint8Array) {
      const r = this.encode(e);
      return r instanceof Uint8Array ? Lo(this.code, r) : r.then((s) => Lo(this.code, s));
    } else throw Error("Unknown type, must be binary type");
  }
};
const Mf = (t) => async (e) => new Uint8Array(await crypto.subtle.digest(t, e)), jv = Lf({ name: "sha2-256", code: 18, encode: Mf("SHA-256") }), zv = Lf({ name: "sha2-512", code: 19, encode: Mf("SHA-512") });
var Hv = Object.freeze({ __proto__: null, sha256: jv, sha512: zv });
const kf = 0, Kv = "identity", qf = Bf, Vv = (t) => Lo(kf, qf(t)), Wv = { code: kf, name: Kv, encode: qf, digest: Vv };
var Gv = Object.freeze({ __proto__: null, identity: Wv });
new TextEncoder(), new TextDecoder();
const gl = { ...F1, ...z1, ...K1, ...W1, ...Z1, ...ov, ...lv, ...fv, ...wv, ..._v };
({ ...Hv, ...Gv });
function Ff(t, e, r, s) {
  return { name: t, prefix: e, encoder: { name: t, prefix: e, encode: r }, decoder: { decode: s } };
}
const yl = Ff("utf8", "u", (t) => "u" + new TextDecoder("utf8").decode(t), (t) => new TextEncoder().encode(t.substring(1))), Vi = Ff("ascii", "a", (t) => {
  let e = "a";
  for (let r = 0; r < t.length; r++) e += String.fromCharCode(t[r]);
  return e;
}, (t) => {
  t = t.substring(1);
  const e = Pf(t.length);
  for (let r = 0; r < t.length; r++) e[r] = t.charCodeAt(r);
  return e;
}), jf = { utf8: yl, "utf-8": yl, hex: gl.base16, latin1: Vi, ascii: Vi, binary: Vi, ...gl };
function ni(t, e = "utf8") {
  const r = jf[e];
  if (!r) throw new Error(`Unsupported encoding "${e}"`);
  return (e === "utf8" || e === "utf-8") && globalThis.Buffer != null && globalThis.Buffer.from != null ? globalThis.Buffer.from(t.buffer, t.byteOffset, t.byteLength).toString("utf8") : r.encoder.encode(t).substring(1);
}
function ts(t, e = "utf8") {
  const r = jf[e];
  if (!r) throw new Error(`Unsupported encoding "${e}"`);
  return (e === "utf8" || e === "utf-8") && globalThis.Buffer != null && globalThis.Buffer.from != null ? Ia(globalThis.Buffer.from(t, "utf-8")) : r.decoder.decode(`${r.prefix}${t}`);
}
function wl(t) {
  return $r(ni(ts(t, ri), Of));
}
function Cn(t) {
  return ni(ts(Pr(t), Of), ri);
}
function zf(t) {
  const e = ts(A1, ul), r = D1 + ni(Tf([e, t]), ul);
  return [S1, I1, r].join(_1);
}
function Yv(t) {
  return ni(t, ri);
}
function Zv(t) {
  return ts(t, ri);
}
function Xv(t) {
  return ts([Cn(t.header), Cn(t.payload)].join(Rn), $f);
}
function Jv(t) {
  return [Cn(t.header), Cn(t.payload), Yv(t.signature)].join(Rn);
}
function Mo(t) {
  const e = t.split(Rn), r = wl(e[0]), s = wl(e[1]), n = Zv(e[2]), i = ts(e.slice(0, 2).join(Rn), $f);
  return { header: r, payload: s, signature: n, data: i };
}
function ml(t = wf(O1)) {
  const e = Af.getPublicKey(t);
  return { secretKey: Tf([t, e]), publicKey: e };
}
async function Qv(t, e, r, s, n = F.fromMiliseconds(Date.now())) {
  const i = { alg: E1, typ: x1 }, o = zf(s.publicKey), a = n + r, c = { iss: o, sub: t, aud: e, iat: n, exp: a }, l = Xv({ header: i, payload: c }), u = Af.sign(l, s.secretKey.slice(0, 32));
  return Jv({ header: i, payload: c, signature: u });
}
const eE = { waku: { publish: "waku_publish", batchPublish: "waku_batchPublish", subscribe: "waku_subscribe", batchSubscribe: "waku_batchSubscribe", subscription: "waku_subscription", unsubscribe: "waku_unsubscribe", batchUnsubscribe: "waku_batchUnsubscribe", batchFetchMessages: "waku_batchFetchMessages" }, irn: { publish: "irn_publish", batchPublish: "irn_batchPublish", subscribe: "irn_subscribe", batchSubscribe: "irn_batchSubscribe", subscription: "irn_subscription", unsubscribe: "irn_unsubscribe", batchUnsubscribe: "irn_batchUnsubscribe", batchFetchMessages: "irn_batchFetchMessages" }, iridium: { publish: "iridium_publish", batchPublish: "iridium_batchPublish", subscribe: "iridium_subscribe", batchSubscribe: "iridium_batchSubscribe", subscription: "iridium_subscription", unsubscribe: "iridium_unsubscribe", batchUnsubscribe: "iridium_batchUnsubscribe", batchFetchMessages: "iridium_batchFetchMessages" } };
var Wi, bl;
function Hf() {
  if (bl) return Wi;
  bl = 1;
  const t = "Input must be an string, Buffer or Uint8Array";
  function e(o) {
    let a;
    if (o instanceof Uint8Array)
      a = o;
    else if (typeof o == "string")
      a = new TextEncoder().encode(o);
    else
      throw new Error(t);
    return a;
  }
  function r(o) {
    return Array.prototype.map.call(o, function(a) {
      return (a < 16 ? "0" : "") + a.toString(16);
    }).join("");
  }
  function s(o) {
    return (4294967296 + o).toString(16).substring(1);
  }
  function n(o, a, c) {
    let l = `
` + o + " = ";
    for (let u = 0; u < a.length; u += 2) {
      if (c === 32)
        l += s(a[u]).toUpperCase(), l += " ", l += s(a[u + 1]).toUpperCase();
      else if (c === 64)
        l += s(a[u + 1]).toUpperCase(), l += s(a[u]).toUpperCase();
      else throw new Error("Invalid size " + c);
      u % 6 === 4 ? l += `
` + new Array(o.length + 4).join(" ") : u < a.length - 2 && (l += " ");
    }
    console.log(l);
  }
  function i(o, a, c) {
    let l = (/* @__PURE__ */ new Date()).getTime();
    const u = new Uint8Array(a);
    for (let f = 0; f < a; f++)
      u[f] = f % 256;
    const h = (/* @__PURE__ */ new Date()).getTime();
    console.log("Generated random input in " + (h - l) + "ms"), l = h;
    for (let f = 0; f < c; f++) {
      const g = o(u), p = (/* @__PURE__ */ new Date()).getTime(), y = p - l;
      l = p, console.log("Hashed in " + y + "ms: " + g.substring(0, 20) + "..."), console.log(
        Math.round(a / (1 << 20) / (y / 1e3) * 100) / 100 + " MB PER SECOND"
      );
    }
  }
  return Wi = {
    normalizeInput: e,
    toHex: r,
    debugPrint: n,
    testSpeed: i
  }, Wi;
}
var Gi, vl;
function tE() {
  if (vl) return Gi;
  vl = 1;
  const t = Hf();
  function e(E, $, b) {
    const v = E[$] + E[b];
    let x = E[$ + 1] + E[b + 1];
    v >= 4294967296 && x++, E[$] = v, E[$ + 1] = x;
  }
  function r(E, $, b, v) {
    let x = E[$] + b;
    b < 0 && (x += 4294967296);
    let I = E[$ + 1] + v;
    x >= 4294967296 && I++, E[$] = x, E[$ + 1] = I;
  }
  function s(E, $) {
    return E[$] ^ E[$ + 1] << 8 ^ E[$ + 2] << 16 ^ E[$ + 3] << 24;
  }
  function n(E, $, b, v, x, I) {
    const P = l[x], B = l[x + 1], T = l[I], L = l[I + 1];
    e(c, E, $), r(c, E, P, B);
    let U = c[v] ^ c[E], N = c[v + 1] ^ c[E + 1];
    c[v] = N, c[v + 1] = U, e(c, b, v), U = c[$] ^ c[b], N = c[$ + 1] ^ c[b + 1], c[$] = U >>> 24 ^ N << 8, c[$ + 1] = N >>> 24 ^ U << 8, e(c, E, $), r(c, E, T, L), U = c[v] ^ c[E], N = c[v + 1] ^ c[E + 1], c[v] = U >>> 16 ^ N << 16, c[v + 1] = N >>> 16 ^ U << 16, e(c, b, v), U = c[$] ^ c[b], N = c[$ + 1] ^ c[b + 1], c[$] = N >>> 31 ^ U << 1, c[$ + 1] = U >>> 31 ^ N << 1;
  }
  const i = new Uint32Array([
    4089235720,
    1779033703,
    2227873595,
    3144134277,
    4271175723,
    1013904242,
    1595750129,
    2773480762,
    2917565137,
    1359893119,
    725511199,
    2600822924,
    4215389547,
    528734635,
    327033209,
    1541459225
  ]), o = [
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15,
    14,
    10,
    4,
    8,
    9,
    15,
    13,
    6,
    1,
    12,
    0,
    2,
    11,
    7,
    5,
    3,
    11,
    8,
    12,
    0,
    5,
    2,
    15,
    13,
    10,
    14,
    3,
    6,
    7,
    1,
    9,
    4,
    7,
    9,
    3,
    1,
    13,
    12,
    11,
    14,
    2,
    6,
    5,
    10,
    4,
    0,
    15,
    8,
    9,
    0,
    5,
    7,
    2,
    4,
    10,
    15,
    14,
    1,
    11,
    12,
    6,
    8,
    3,
    13,
    2,
    12,
    6,
    10,
    0,
    11,
    8,
    3,
    4,
    13,
    7,
    5,
    15,
    14,
    1,
    9,
    12,
    5,
    1,
    15,
    14,
    13,
    4,
    10,
    0,
    7,
    6,
    3,
    9,
    2,
    8,
    11,
    13,
    11,
    7,
    14,
    12,
    1,
    3,
    9,
    5,
    0,
    15,
    4,
    8,
    6,
    2,
    10,
    6,
    15,
    14,
    9,
    11,
    3,
    0,
    8,
    12,
    2,
    13,
    7,
    1,
    4,
    10,
    5,
    10,
    2,
    8,
    4,
    7,
    6,
    1,
    5,
    15,
    11,
    9,
    14,
    3,
    12,
    13,
    0,
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15,
    14,
    10,
    4,
    8,
    9,
    15,
    13,
    6,
    1,
    12,
    0,
    2,
    11,
    7,
    5,
    3
  ], a = new Uint8Array(
    o.map(function(E) {
      return E * 2;
    })
  ), c = new Uint32Array(32), l = new Uint32Array(32);
  function u(E, $) {
    let b = 0;
    for (b = 0; b < 16; b++)
      c[b] = E.h[b], c[b + 16] = i[b];
    for (c[24] = c[24] ^ E.t, c[25] = c[25] ^ E.t / 4294967296, $ && (c[28] = ~c[28], c[29] = ~c[29]), b = 0; b < 32; b++)
      l[b] = s(E.b, 4 * b);
    for (b = 0; b < 12; b++)
      n(0, 8, 16, 24, a[b * 16 + 0], a[b * 16 + 1]), n(2, 10, 18, 26, a[b * 16 + 2], a[b * 16 + 3]), n(4, 12, 20, 28, a[b * 16 + 4], a[b * 16 + 5]), n(6, 14, 22, 30, a[b * 16 + 6], a[b * 16 + 7]), n(0, 10, 20, 30, a[b * 16 + 8], a[b * 16 + 9]), n(2, 12, 22, 24, a[b * 16 + 10], a[b * 16 + 11]), n(4, 14, 16, 26, a[b * 16 + 12], a[b * 16 + 13]), n(6, 8, 18, 28, a[b * 16 + 14], a[b * 16 + 15]);
    for (b = 0; b < 16; b++)
      E.h[b] = E.h[b] ^ c[b] ^ c[b + 16];
  }
  const h = new Uint8Array([
    0,
    0,
    0,
    0,
    //  0: outlen, keylen, fanout, depth
    0,
    0,
    0,
    0,
    //  4: leaf length, sequential mode
    0,
    0,
    0,
    0,
    //  8: node offset
    0,
    0,
    0,
    0,
    // 12: node offset
    0,
    0,
    0,
    0,
    // 16: node depth, inner length, rfu
    0,
    0,
    0,
    0,
    // 20: rfu
    0,
    0,
    0,
    0,
    // 24: rfu
    0,
    0,
    0,
    0,
    // 28: rfu
    0,
    0,
    0,
    0,
    // 32: salt
    0,
    0,
    0,
    0,
    // 36: salt
    0,
    0,
    0,
    0,
    // 40: salt
    0,
    0,
    0,
    0,
    // 44: salt
    0,
    0,
    0,
    0,
    // 48: personal
    0,
    0,
    0,
    0,
    // 52: personal
    0,
    0,
    0,
    0,
    // 56: personal
    0,
    0,
    0,
    0
    // 60: personal
  ]);
  function f(E, $, b, v) {
    if (E === 0 || E > 64)
      throw new Error("Illegal output length, expected 0 < length <= 64");
    if ($ && $.length > 64)
      throw new Error("Illegal key, expected Uint8Array with 0 < length <= 64");
    if (b && b.length !== 16)
      throw new Error("Illegal salt, expected Uint8Array with length is 16");
    if (v && v.length !== 16)
      throw new Error("Illegal personal, expected Uint8Array with length is 16");
    const x = {
      b: new Uint8Array(128),
      h: new Uint32Array(16),
      t: 0,
      // input count
      c: 0,
      // pointer within buffer
      outlen: E
      // output length in bytes
    };
    h.fill(0), h[0] = E, $ && (h[1] = $.length), h[2] = 1, h[3] = 1, b && h.set(b, 32), v && h.set(v, 48);
    for (let I = 0; I < 16; I++)
      x.h[I] = i[I] ^ s(h, I * 4);
    return $ && (g(x, $), x.c = 128), x;
  }
  function g(E, $) {
    for (let b = 0; b < $.length; b++)
      E.c === 128 && (E.t += E.c, u(E, !1), E.c = 0), E.b[E.c++] = $[b];
  }
  function p(E) {
    for (E.t += E.c; E.c < 128; )
      E.b[E.c++] = 0;
    u(E, !0);
    const $ = new Uint8Array(E.outlen);
    for (let b = 0; b < E.outlen; b++)
      $[b] = E.h[b >> 2] >> 8 * (b & 3);
    return $;
  }
  function y(E, $, b, v, x) {
    b = b || 64, E = t.normalizeInput(E), v && (v = t.normalizeInput(v)), x && (x = t.normalizeInput(x));
    const I = f(b, $, v, x);
    return g(I, E), p(I);
  }
  function m(E, $, b, v, x) {
    const I = y(E, $, b, v, x);
    return t.toHex(I);
  }
  return Gi = {
    blake2b: y,
    blake2bHex: m,
    blake2bInit: f,
    blake2bUpdate: g,
    blake2bFinal: p
  }, Gi;
}
var Yi, El;
function rE() {
  if (El) return Yi;
  El = 1;
  const t = Hf();
  function e(p, y) {
    return p[y] ^ p[y + 1] << 8 ^ p[y + 2] << 16 ^ p[y + 3] << 24;
  }
  function r(p, y, m, E, $, b) {
    o[p] = o[p] + o[y] + $, o[E] = s(o[E] ^ o[p], 16), o[m] = o[m] + o[E], o[y] = s(o[y] ^ o[m], 12), o[p] = o[p] + o[y] + b, o[E] = s(o[E] ^ o[p], 8), o[m] = o[m] + o[E], o[y] = s(o[y] ^ o[m], 7);
  }
  function s(p, y) {
    return p >>> y ^ p << 32 - y;
  }
  const n = new Uint32Array([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]), i = new Uint8Array([
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15,
    14,
    10,
    4,
    8,
    9,
    15,
    13,
    6,
    1,
    12,
    0,
    2,
    11,
    7,
    5,
    3,
    11,
    8,
    12,
    0,
    5,
    2,
    15,
    13,
    10,
    14,
    3,
    6,
    7,
    1,
    9,
    4,
    7,
    9,
    3,
    1,
    13,
    12,
    11,
    14,
    2,
    6,
    5,
    10,
    4,
    0,
    15,
    8,
    9,
    0,
    5,
    7,
    2,
    4,
    10,
    15,
    14,
    1,
    11,
    12,
    6,
    8,
    3,
    13,
    2,
    12,
    6,
    10,
    0,
    11,
    8,
    3,
    4,
    13,
    7,
    5,
    15,
    14,
    1,
    9,
    12,
    5,
    1,
    15,
    14,
    13,
    4,
    10,
    0,
    7,
    6,
    3,
    9,
    2,
    8,
    11,
    13,
    11,
    7,
    14,
    12,
    1,
    3,
    9,
    5,
    0,
    15,
    4,
    8,
    6,
    2,
    10,
    6,
    15,
    14,
    9,
    11,
    3,
    0,
    8,
    12,
    2,
    13,
    7,
    1,
    4,
    10,
    5,
    10,
    2,
    8,
    4,
    7,
    6,
    1,
    5,
    15,
    11,
    9,
    14,
    3,
    12,
    13,
    0
  ]), o = new Uint32Array(16), a = new Uint32Array(16);
  function c(p, y) {
    let m = 0;
    for (m = 0; m < 8; m++)
      o[m] = p.h[m], o[m + 8] = n[m];
    for (o[12] ^= p.t, o[13] ^= p.t / 4294967296, y && (o[14] = ~o[14]), m = 0; m < 16; m++)
      a[m] = e(p.b, 4 * m);
    for (m = 0; m < 10; m++)
      r(0, 4, 8, 12, a[i[m * 16 + 0]], a[i[m * 16 + 1]]), r(1, 5, 9, 13, a[i[m * 16 + 2]], a[i[m * 16 + 3]]), r(2, 6, 10, 14, a[i[m * 16 + 4]], a[i[m * 16 + 5]]), r(3, 7, 11, 15, a[i[m * 16 + 6]], a[i[m * 16 + 7]]), r(0, 5, 10, 15, a[i[m * 16 + 8]], a[i[m * 16 + 9]]), r(1, 6, 11, 12, a[i[m * 16 + 10]], a[i[m * 16 + 11]]), r(2, 7, 8, 13, a[i[m * 16 + 12]], a[i[m * 16 + 13]]), r(3, 4, 9, 14, a[i[m * 16 + 14]], a[i[m * 16 + 15]]);
    for (m = 0; m < 8; m++)
      p.h[m] ^= o[m] ^ o[m + 8];
  }
  function l(p, y) {
    if (!(p > 0 && p <= 32))
      throw new Error("Incorrect output length, should be in [1, 32]");
    const m = y ? y.length : 0;
    if (y && !(m > 0 && m <= 32))
      throw new Error("Incorrect key length, should be in [1, 32]");
    const E = {
      h: new Uint32Array(n),
      // hash state
      b: new Uint8Array(64),
      // input block
      c: 0,
      // pointer within block
      t: 0,
      // input count
      outlen: p
      // output length in bytes
    };
    return E.h[0] ^= 16842752 ^ m << 8 ^ p, m > 0 && (u(E, y), E.c = 64), E;
  }
  function u(p, y) {
    for (let m = 0; m < y.length; m++)
      p.c === 64 && (p.t += p.c, c(p, !1), p.c = 0), p.b[p.c++] = y[m];
  }
  function h(p) {
    for (p.t += p.c; p.c < 64; )
      p.b[p.c++] = 0;
    c(p, !0);
    const y = new Uint8Array(p.outlen);
    for (let m = 0; m < p.outlen; m++)
      y[m] = p.h[m >> 2] >> 8 * (m & 3) & 255;
    return y;
  }
  function f(p, y, m) {
    m = m || 32, p = t.normalizeInput(p);
    const E = l(m, y);
    return u(E, p), h(E);
  }
  function g(p, y, m) {
    const E = f(p, y, m);
    return t.toHex(E);
  }
  return Yi = {
    blake2s: f,
    blake2sHex: g,
    blake2sInit: l,
    blake2sUpdate: u,
    blake2sFinal: h
  }, Yi;
}
var Zi, xl;
function sE() {
  if (xl) return Zi;
  xl = 1;
  const t = tE(), e = rE();
  return Zi = {
    blake2b: t.blake2b,
    blake2bHex: t.blake2bHex,
    blake2bInit: t.blake2bInit,
    blake2bUpdate: t.blake2bUpdate,
    blake2bFinal: t.blake2bFinal,
    blake2s: e.blake2s,
    blake2sHex: e.blake2sHex,
    blake2sInit: e.blake2sInit,
    blake2sUpdate: e.blake2sUpdate,
    blake2sFinal: e.blake2sFinal
  }, Zi;
}
var nE = sE(), bt = { exports: {} };
function iE(t) {
  try {
    return JSON.stringify(t);
  } catch {
    return '"[Circular]"';
  }
}
var oE = aE;
function aE(t, e, r) {
  var s = r && r.stringify || iE, n = 1;
  if (typeof t == "object" && t !== null) {
    var i = e.length + n;
    if (i === 1) return t;
    var o = new Array(i);
    o[0] = s(t);
    for (var a = 1; a < i; a++) o[a] = s(e[a]);
    return o.join(" ");
  }
  if (typeof t != "string") return t;
  var c = e.length;
  if (c === 0) return t;
  for (var l = "", u = 1 - n, h = -1, f = t && t.length || 0, g = 0; g < f; ) {
    if (t.charCodeAt(g) === 37 && g + 1 < f) {
      switch (h = h > -1 ? h : 0, t.charCodeAt(g + 1)) {
        case 100:
        case 102:
          if (u >= c || e[u] == null) break;
          h < g && (l += t.slice(h, g)), l += Number(e[u]), h = g + 2, g++;
          break;
        case 105:
          if (u >= c || e[u] == null) break;
          h < g && (l += t.slice(h, g)), l += Math.floor(Number(e[u])), h = g + 2, g++;
          break;
        case 79:
        case 111:
        case 106:
          if (u >= c || e[u] === void 0) break;
          h < g && (l += t.slice(h, g));
          var p = typeof e[u];
          if (p === "string") {
            l += "'" + e[u] + "'", h = g + 2, g++;
            break;
          }
          if (p === "function") {
            l += e[u].name || "<anonymous>", h = g + 2, g++;
            break;
          }
          l += s(e[u]), h = g + 2, g++;
          break;
        case 115:
          if (u >= c) break;
          h < g && (l += t.slice(h, g)), l += String(e[u]), h = g + 2, g++;
          break;
        case 37:
          h < g && (l += t.slice(h, g)), l += "%", h = g + 2, g++, u--;
          break;
      }
      ++u;
    }
    ++g;
  }
  return h === -1 ? t : (h < f && (l += t.slice(h)), l);
}
const _l = oE;
bt.exports = qt;
const Os = xE().console || {}, cE = { mapHttpRequest: on, mapHttpResponse: on, wrapRequestSerializer: Xi, wrapResponseSerializer: Xi, wrapErrorSerializer: Xi, req: on, res: on, err: Il, errWithCause: Il };
function sr(t, e) {
  return t === "silent" ? 1 / 0 : e.levels.values[t];
}
const Da = Symbol("pino.logFuncs"), ko = Symbol("pino.hierarchy"), lE = { error: "log", fatal: "error", warn: "error", info: "log", debug: "log", trace: "log" };
function Sl(t, e) {
  const r = { logger: e, parent: t[ko] };
  e[ko] = r;
}
function uE(t, e, r) {
  const s = {};
  e.forEach((n) => {
    s[n] = r[n] ? r[n] : Os[n] || Os[lE[n] || "log"] || Zr;
  }), t[Da] = s;
}
function hE(t, e) {
  return Array.isArray(t) ? t.filter(function(r) {
    return r !== "!stdSerializers.err";
  }) : t === !0 ? Object.keys(e) : !1;
}
function qt(t) {
  t = t || {}, t.browser = t.browser || {};
  const e = t.browser.transmit;
  if (e && typeof e.send != "function") throw Error("pino: transmit option must have a send function");
  const r = t.browser.write || Os;
  t.browser.write && (t.browser.asObject = !0);
  const s = t.serializers || {}, n = hE(t.browser.serialize, s);
  let i = t.browser.serialize;
  Array.isArray(t.browser.serialize) && t.browser.serialize.indexOf("!stdSerializers.err") > -1 && (i = !1);
  const o = Object.keys(t.customLevels || {}), a = ["error", "fatal", "warn", "info", "debug", "trace"].concat(o);
  typeof r == "function" && a.forEach(function(y) {
    r[y] = r;
  }), (t.enabled === !1 || t.browser.disabled) && (t.level = "silent");
  const c = t.level || "info", l = Object.create(r);
  l.log || (l.log = Zr), uE(l, a, r), Sl({}, l), Object.defineProperty(l, "levelVal", { get: h }), Object.defineProperty(l, "level", { get: f, set: g });
  const u = { transmit: e, serialize: n, asObject: t.browser.asObject, asObjectBindingsOnly: t.browser.asObjectBindingsOnly, formatters: t.browser.formatters, levels: a, timestamp: bE(t), messageKey: t.messageKey || "msg", onChild: t.onChild || Zr };
  l.levels = fE(t), l.level = c, l.isLevelEnabled = function(y) {
    return this.levels.values[y] ? this.levels.values[y] >= this.levels.values[this.level] : !1;
  }, l.setMaxListeners = l.getMaxListeners = l.emit = l.addListener = l.on = l.prependListener = l.once = l.prependOnceListener = l.removeListener = l.removeAllListeners = l.listeners = l.listenerCount = l.eventNames = l.write = l.flush = Zr, l.serializers = s, l._serialize = n, l._stdErrSerialize = i, l.child = function(...y) {
    return p.call(this, u, ...y);
  }, e && (l._logEvent = qo());
  function h() {
    return sr(this.level, this);
  }
  function f() {
    return this._level;
  }
  function g(y) {
    if (y !== "silent" && !this.levels.values[y]) throw Error("unknown level " + y);
    this._level = y, gr(this, u, l, "error"), gr(this, u, l, "fatal"), gr(this, u, l, "warn"), gr(this, u, l, "info"), gr(this, u, l, "debug"), gr(this, u, l, "trace"), o.forEach((m) => {
      gr(this, u, l, m);
    });
  }
  function p(y, m, E) {
    if (!m) throw new Error("missing bindings for child Pino");
    E = E || {}, n && m.serializers && (E.serializers = m.serializers);
    const $ = E.serializers;
    if (n && $) {
      var b = Object.assign({}, s, $), v = t.browser.serialize === !0 ? Object.keys(b) : n;
      delete m.serializers, Aa([m], v, b, this._stdErrSerialize);
    }
    function x(P) {
      this._childLevel = (P._childLevel | 0) + 1, this.bindings = m, b && (this.serializers = b, this._serialize = v), e && (this._logEvent = qo([].concat(P._logEvent.bindings, m)));
    }
    x.prototype = this;
    const I = new x(this);
    return Sl(this, I), I.child = function(...P) {
      return p.call(this, y, ...P);
    }, I.level = E.level || this.level, y.onChild(I), I;
  }
  return l;
}
function fE(t) {
  const e = t.customLevels || {}, r = Object.assign({}, qt.levels.values, e), s = Object.assign({}, qt.levels.labels, dE(e));
  return { values: r, labels: s };
}
function dE(t) {
  const e = {};
  return Object.keys(t).forEach(function(r) {
    e[t[r]] = r;
  }), e;
}
qt.levels = { values: { fatal: 60, error: 50, warn: 40, info: 30, debug: 20, trace: 10 }, labels: { 10: "trace", 20: "debug", 30: "info", 40: "warn", 50: "error", 60: "fatal" } }, qt.stdSerializers = cE, qt.stdTimeFunctions = Object.assign({}, { nullTime: Kf, epochTime: Vf, unixTime: vE, isoTime: EE });
function pE(t) {
  const e = [];
  t.bindings && e.push(t.bindings);
  let r = t[ko];
  for (; r.parent; ) r = r.parent, r.logger.bindings && e.push(r.logger.bindings);
  return e.reverse();
}
function gr(t, e, r, s) {
  if (Object.defineProperty(t, s, { value: sr(t.level, r) > sr(s, r) ? Zr : r[Da][s], writable: !0, enumerable: !0, configurable: !0 }), t[s] === Zr) {
    if (!e.transmit) return;
    const i = e.transmit.level || t.level, o = sr(i, r);
    if (sr(s, r) < o) return;
  }
  t[s] = yE(t, e, r, s);
  const n = pE(t);
  n.length !== 0 && (t[s] = gE(n, t[s]));
}
function gE(t, e) {
  return function() {
    return e.apply(this, [...t, ...arguments]);
  };
}
function yE(t, e, r, s) {
  return /* @__PURE__ */ (function(n) {
    return function() {
      const i = e.timestamp(), o = new Array(arguments.length), a = Object.getPrototypeOf && Object.getPrototypeOf(this) === Os ? Os : this;
      for (var c = 0; c < o.length; c++) o[c] = arguments[c];
      var l = !1;
      if (e.serialize && (Aa(o, this._serialize, this.serializers, this._stdErrSerialize), l = !0), e.asObject || e.formatters ? n.call(a, ...wE(this, s, o, i, e)) : n.apply(a, o), e.transmit) {
        const u = e.transmit.level || t._level, h = sr(u, r), f = sr(s, r);
        if (f < h) return;
        mE(this, { ts: i, methodLevel: s, methodValue: f, transmitValue: r.levels.values[e.transmit.level || t._level], send: e.transmit.send, val: sr(t._level, r) }, o, l);
      }
    };
  })(t[Da][s]);
}
function wE(t, e, r, s, n) {
  const { level: i, log: o = (h) => h } = n.formatters || {}, a = r.slice();
  let c = a[0];
  const l = {};
  let u = (t._childLevel | 0) + 1;
  if (u < 1 && (u = 1), s && (l.time = s), i) {
    const h = i(e, t.levels.values[e]);
    Object.assign(l, h);
  } else l.level = t.levels.values[e];
  if (n.asObjectBindingsOnly) {
    if (c !== null && typeof c == "object") for (; u-- && typeof a[0] == "object"; ) Object.assign(l, a.shift());
    return [o(l), ...a];
  } else {
    if (c !== null && typeof c == "object") {
      for (; u-- && typeof a[0] == "object"; ) Object.assign(l, a.shift());
      c = a.length ? _l(a.shift(), a) : void 0;
    } else typeof c == "string" && (c = _l(a.shift(), a));
    return c !== void 0 && (l[n.messageKey] = c), [o(l)];
  }
}
function Aa(t, e, r, s) {
  for (const n in t) if (s && t[n] instanceof Error) t[n] = qt.stdSerializers.err(t[n]);
  else if (typeof t[n] == "object" && !Array.isArray(t[n]) && e) for (const i in t[n]) e.indexOf(i) > -1 && i in r && (t[n][i] = r[i](t[n][i]));
}
function mE(t, e, r, s = !1) {
  const n = e.send, i = e.ts, o = e.methodLevel, a = e.methodValue, c = e.val, l = t._logEvent.bindings;
  s || Aa(r, t._serialize || Object.keys(t.serializers), t.serializers, t._stdErrSerialize === void 0 ? !0 : t._stdErrSerialize), t._logEvent.ts = i, t._logEvent.messages = r.filter(function(u) {
    return l.indexOf(u) === -1;
  }), t._logEvent.level.label = o, t._logEvent.level.value = a, n(o, t._logEvent, c), t._logEvent = qo(l);
}
function qo(t) {
  return { ts: 0, messages: [], bindings: t || [], level: { label: "", value: 0 } };
}
function Il(t) {
  const e = { type: t.constructor.name, msg: t.message, stack: t.stack };
  for (const r in t) e[r] === void 0 && (e[r] = t[r]);
  return e;
}
function bE(t) {
  return typeof t.timestamp == "function" ? t.timestamp : t.timestamp === !1 ? Kf : Vf;
}
function on() {
  return {};
}
function Xi(t) {
  return t;
}
function Zr() {
}
function Kf() {
  return !1;
}
function Vf() {
  return Date.now();
}
function vE() {
  return Math.round(Date.now() / 1e3);
}
function EE() {
  return new Date(Date.now()).toISOString();
}
function xE() {
  function t(e) {
    return typeof e < "u" && e;
  }
  try {
    return typeof globalThis < "u" || Object.defineProperty(Object.prototype, "globalThis", { get: function() {
      return delete Object.prototype.globalThis, this.globalThis = this;
    }, configurable: !0 }), globalThis;
  } catch {
    return t(self) || t(window) || t(this) || {};
  }
}
bt.exports.default = qt;
bt.exports.pino = qt;
const _E = { level: "info" }, ii = "custom_context", Oa = 1e3 * 1024;
var SE = Object.defineProperty, IE = (t, e, r) => e in t ? SE(t, e, { enumerable: !0, configurable: !0, writable: !0, value: r }) : t[e] = r, rr = (t, e, r) => IE(t, typeof e != "symbol" ? e + "" : e, r);
let DE = class {
  constructor(e) {
    rr(this, "nodeValue"), rr(this, "sizeInBytes"), rr(this, "next"), this.nodeValue = e, this.sizeInBytes = new TextEncoder().encode(this.nodeValue).length, this.next = null;
  }
  get value() {
    return this.nodeValue;
  }
  get size() {
    return this.sizeInBytes;
  }
}, Dl = class {
  constructor(e) {
    rr(this, "lengthInNodes"), rr(this, "sizeInBytes"), rr(this, "head"), rr(this, "tail"), rr(this, "maxSizeInBytes"), this.head = null, this.tail = null, this.lengthInNodes = 0, this.maxSizeInBytes = e, this.sizeInBytes = 0;
  }
  append(e) {
    const r = new DE(e);
    if (r.size > this.maxSizeInBytes) throw new Error(`[LinkedList] Value too big to insert into list: ${e} with size ${r.size}`);
    for (; this.size + r.size > this.maxSizeInBytes; ) this.shift();
    this.head ? (this.tail && (this.tail.next = r), this.tail = r) : (this.head = r, this.tail = r), this.lengthInNodes++, this.sizeInBytes += r.size;
  }
  shift() {
    if (!this.head) return;
    const e = this.head;
    this.head = this.head.next, this.head || (this.tail = null), this.lengthInNodes--, this.sizeInBytes -= e.size;
  }
  toArray() {
    const e = [];
    let r = this.head;
    for (; r !== null; ) e.push(r.value), r = r.next;
    return e;
  }
  get length() {
    return this.lengthInNodes;
  }
  get size() {
    return this.sizeInBytes;
  }
  toOrderedArray() {
    return Array.from(this);
  }
  [Symbol.iterator]() {
    let e = this.head;
    return { next: () => {
      if (!e) return { done: !0, value: null };
      const r = e.value;
      return e = e.next, { done: !1, value: r };
    } };
  }
};
const AE = (t) => JSON.stringify(t, (e, r) => typeof r == "bigint" ? r.toString() + "n" : r);
function Al(t) {
  return typeof t == "string" ? t : AE(t) || "";
}
var OE = Object.defineProperty, $E = (t, e, r) => e in t ? OE(t, e, { enumerable: !0, configurable: !0, writable: !0, value: r }) : t[e] = r, an = (t, e, r) => $E(t, typeof e != "symbol" ? e + "" : e, r);
let Wf = class {
  constructor(e, r = Oa) {
    an(this, "logs"), an(this, "level"), an(this, "levelValue"), an(this, "MAX_LOG_SIZE_IN_BYTES"), this.level = e ?? "error", this.levelValue = bt.exports.levels.values[this.level], this.MAX_LOG_SIZE_IN_BYTES = r, this.logs = new Dl(this.MAX_LOG_SIZE_IN_BYTES);
  }
  forwardToConsole(e, r) {
    r === bt.exports.levels.values.error ? console.error(e) : r === bt.exports.levels.values.warn ? console.warn(e) : r === bt.exports.levels.values.debug ? console.debug(e) : r === bt.exports.levels.values.trace ? console.trace(e) : console.log(e);
  }
  appendToLogs(e) {
    this.logs.append(Al({ timestamp: (/* @__PURE__ */ new Date()).toISOString(), log: e }));
    const r = typeof e == "string" ? JSON.parse(e).level : e.level;
    r >= this.levelValue && this.forwardToConsole(e, r);
  }
  getLogs() {
    return this.logs;
  }
  clearLogs() {
    this.logs = new Dl(this.MAX_LOG_SIZE_IN_BYTES);
  }
  getLogArray() {
    return Array.from(this.logs);
  }
  logsToBlob(e) {
    const r = this.getLogArray();
    return r.push(Al({ extraMetadata: e })), new Blob(r, { type: "application/json" });
  }
};
var PE = Object.defineProperty, TE = (t, e, r) => e in t ? PE(t, e, { enumerable: !0, configurable: !0, writable: !0, value: r }) : t[e] = r, BE = (t, e, r) => TE(t, e + "", r);
let RE = class {
  constructor(e, r = Oa) {
    BE(this, "baseChunkLogger"), this.baseChunkLogger = new Wf(e, r);
  }
  write(e) {
    this.baseChunkLogger.appendToLogs(e);
  }
  getLogs() {
    return this.baseChunkLogger.getLogs();
  }
  clearLogs() {
    this.baseChunkLogger.clearLogs();
  }
  getLogArray() {
    return this.baseChunkLogger.getLogArray();
  }
  logsToBlob(e) {
    return this.baseChunkLogger.logsToBlob(e);
  }
  downloadLogsBlobInBrowser(e) {
    const r = URL.createObjectURL(this.logsToBlob(e)), s = document.createElement("a");
    s.href = r, s.download = `walletconnect-logs-${(/* @__PURE__ */ new Date()).toISOString()}.txt`, document.body.appendChild(s), s.click(), document.body.removeChild(s), URL.revokeObjectURL(r);
  }
};
var CE = Object.defineProperty, NE = (t, e, r) => e in t ? CE(t, e, { enumerable: !0, configurable: !0, writable: !0, value: r }) : t[e] = r, UE = (t, e, r) => NE(t, e + "", r);
let LE = class {
  constructor(e, r = Oa) {
    UE(this, "baseChunkLogger"), this.baseChunkLogger = new Wf(e, r);
  }
  write(e) {
    this.baseChunkLogger.appendToLogs(e);
  }
  getLogs() {
    return this.baseChunkLogger.getLogs();
  }
  clearLogs() {
    this.baseChunkLogger.clearLogs();
  }
  getLogArray() {
    return this.baseChunkLogger.getLogArray();
  }
  logsToBlob(e) {
    return this.baseChunkLogger.logsToBlob(e);
  }
};
var ME = Object.defineProperty, kE = Object.defineProperties, qE = Object.getOwnPropertyDescriptors, Ol = Object.getOwnPropertySymbols, FE = Object.prototype.hasOwnProperty, jE = Object.prototype.propertyIsEnumerable, $l = (t, e, r) => e in t ? ME(t, e, { enumerable: !0, configurable: !0, writable: !0, value: r }) : t[e] = r, or = (t, e) => {
  for (var r in e || (e = {})) FE.call(e, r) && $l(t, r, e[r]);
  if (Ol) for (var r of Ol(e)) jE.call(e, r) && $l(t, r, e[r]);
  return t;
}, ar = (t, e) => kE(t, qE(e));
function zE(t) {
  return ar(or({}, t), { level: t?.level || _E.level });
}
function HE(t, e, r = ii) {
  return t[r] = e, t;
}
function Le(t, e = ii) {
  return t[e] || "";
}
function KE(t, e, r = ii) {
  const s = Le(t, r);
  return s.trim() ? `${s}/${e}` : e;
}
function ze(t, e, r = ii) {
  const s = KE(t, e, r), n = t.child({ context: s });
  return HE(n, s, r);
}
function VE(t) {
  var e, r;
  const s = new RE((e = t.opts) == null ? void 0 : e.level, t.maxSizeInBytes);
  return { logger: bt.exports(ar(or({}, t.opts), { level: "trace", browser: ar(or({}, (r = t.opts) == null ? void 0 : r.browser), { write: (n) => s.write(n) }) })), chunkLoggerController: s };
}
function WE(t) {
  var e, r;
  const s = new LE((e = t.opts) == null ? void 0 : e.level, t.maxSizeInBytes);
  return { logger: bt.exports(ar(or({}, t.opts), { level: "trace", browser: ar(or({}, (r = t.opts) == null ? void 0 : r.browser), { write: (n) => s.write(n) }) }), s), chunkLoggerController: s };
}
function Gf(t) {
  var e;
  if (typeof t.loggerOverride < "u" && typeof t.loggerOverride != "string") return { logger: t.loggerOverride, chunkLoggerController: null };
  const r = ar(or({}, t.opts), { level: typeof t.loggerOverride == "string" ? t.loggerOverride : (e = t.opts) == null ? void 0 : e.level });
  return typeof window < "u" ? VE(ar(or({}, t), { opts: r })) : WE(ar(or({}, t), { opts: r }));
}
const GE = ":";
function Ft(t) {
  const [e, r] = t.split(GE);
  return { namespace: e, reference: r };
}
function Pl(t, e = []) {
  const r = [];
  return Object.keys(t).forEach((s) => {
    if (e.length && !e.includes(s)) return;
    const n = t[s];
    r.push(...n.accounts);
  }), r;
}
function Yf(t, e) {
  return t.includes(":") ? [t] : e.chains || [];
}
const YE = { INVALID_METHOD: { message: "Invalid method.", code: 1001 }, INVALID_EVENT: { message: "Invalid event.", code: 1002 }, INVALID_UPDATE_REQUEST: { message: "Invalid update request.", code: 1003 }, INVALID_EXTEND_REQUEST: { message: "Invalid extend request.", code: 1004 }, INVALID_SESSION_SETTLE_REQUEST: { message: "Invalid session settle request.", code: 1005 }, UNAUTHORIZED_METHOD: { message: "Unauthorized method.", code: 3001 }, UNAUTHORIZED_EVENT: { message: "Unauthorized event.", code: 3002 }, UNAUTHORIZED_UPDATE_REQUEST: { message: "Unauthorized update request.", code: 3003 }, UNAUTHORIZED_EXTEND_REQUEST: { message: "Unauthorized extend request.", code: 3004 }, USER_REJECTED: { message: "User rejected.", code: 5e3 }, USER_REJECTED_CHAINS: { message: "User rejected chains.", code: 5001 }, USER_REJECTED_METHODS: { message: "User rejected methods.", code: 5002 }, USER_REJECTED_EVENTS: { message: "User rejected events.", code: 5003 }, UNSUPPORTED_CHAINS: { message: "Unsupported chains.", code: 5100 }, UNSUPPORTED_METHODS: { message: "Unsupported methods.", code: 5101 }, UNSUPPORTED_EVENTS: { message: "Unsupported events.", code: 5102 }, UNSUPPORTED_ACCOUNTS: { message: "Unsupported accounts.", code: 5103 }, UNSUPPORTED_NAMESPACE_KEY: { message: "Unsupported namespace key.", code: 5104 }, USER_DISCONNECTED: { message: "User disconnected.", code: 6e3 }, SESSION_SETTLEMENT_FAILED: { message: "Session settlement failed.", code: 7e3 }, WC_METHOD_UNSUPPORTED: { message: "Unsupported wc_ method.", code: 10001 } }, ZE = { NOT_INITIALIZED: { message: "Not initialized.", code: 1 }, NO_MATCHING_KEY: { message: "No matching key.", code: 2 }, RESTORE_WILL_OVERRIDE: { message: "Restore will override.", code: 3 }, RESUBSCRIBED: { message: "Resubscribed.", code: 4 }, MISSING_OR_INVALID: { message: "Missing or invalid.", code: 5 }, EXPIRED: { message: "Expired.", code: 6 }, UNKNOWN_TYPE: { message: "Unknown type.", code: 7 }, MISMATCHED_TOPIC: { message: "Mismatched topic.", code: 8 }, NON_CONFORMING_NAMESPACES: { message: "Non conforming namespaces.", code: 9 } };
function j(t, e) {
  const { message: r, code: s } = ZE[t];
  return { message: e ? `${r} ${e}` : r, code: s };
}
function Q(t, e) {
  const { message: r, code: s } = YE[t];
  return { message: e ? `${r} ${e}` : r, code: s };
}
const XE = "ReactNative", Fe = { reactNative: "react-native", node: "node", browser: "browser", unknown: "unknown" }, JE = "js";
function Nn() {
  return typeof process < "u" && typeof process.versions < "u" && typeof process.versions.node < "u";
}
function fr() {
  return !zt.getDocument() && !!zt.getNavigator() && navigator.product === XE;
}
function QE() {
  return fr() && typeof global < "u" && typeof global?.Platform < "u" && global?.Platform.OS === "android";
}
function e2() {
  return fr() && typeof global < "u" && typeof global?.Platform < "u" && global?.Platform.OS === "ios";
}
function rs() {
  return !Nn() && !!zt.getNavigator() && !!zt.getDocument();
}
function zs() {
  return fr() ? Fe.reactNative : Nn() ? Fe.node : rs() ? Fe.browser : Fe.unknown;
}
function Tl() {
  try {
    return fr() && typeof global < "u" && typeof global?.Application < "u" ? global.Application?.applicationId : void 0;
  } catch {
    return;
  }
}
function t2(t, e) {
  const r = new URLSearchParams(t);
  return Object.entries(e).sort(([s], [n]) => s.localeCompare(n)).forEach(([s, n]) => {
    n != null && r.set(s, String(n));
  }), r.toString();
}
function r2(t) {
  const e = Zf();
  try {
    return t?.url && e.url && new URL(t.url).host !== new URL(e.url).host && (console.warn(`The configured WalletConnect 'metadata.url':${t.url} differs from the actual page url:${e.url}. This is probably unintended and can lead to issues.`), t.url = e.url), t?.icons?.length && t.icons.length > 0 && (t.icons = t.icons.filter((r) => r !== "")), { ...e, ...t, url: t?.url || e.url, name: t?.name || e.name, description: t?.description || e.description, icons: t?.icons?.length && t.icons.length > 0 ? t.icons : e.icons };
  } catch (r) {
    return console.warn("Error populating app metadata", r), t || e;
  }
}
function Zf() {
  return sg.getWindowMetadata() || { name: "", description: "", url: "", icons: [""] };
}
function s2() {
  if (zs() === Fe.reactNative && typeof global < "u" && typeof global?.Platform < "u") {
    const { OS: r, Version: s } = global.Platform;
    return [r, s].join("-");
  }
  const t = Ep();
  if (t === null) return "unknown";
  const e = t.os ? t.os.replace(" ", "").toLowerCase() : "unknown";
  return t.type === "browser" ? [e, t.name, t.version].join("-") : [e, t.version].join("-");
}
function n2() {
  const t = zs();
  return t === Fe.browser ? [t, zt.getLocation()?.host || "unknown"].join(":") : t;
}
function Xf(t, e, r) {
  const s = s2(), n = n2();
  return [[t, e].join("-"), [JE, r].join("-"), s, n].join("/");
}
function i2({ protocol: t, version: e, relayUrl: r, sdkVersion: s, auth: n, projectId: i, useOnCloseEvent: o, bundleId: a, packageName: c }) {
  const l = r.split("?"), u = Xf(t, e, s), h = { auth: n, ua: u, projectId: i, useOnCloseEvent: o, packageName: c || void 0, bundleId: a || void 0 }, f = t2(l[1] || "", h);
  return l[0] + "?" + f;
}
function Ir(t, e) {
  return t.filter((r) => e.includes(r)).length === t.length;
}
function Fo(t) {
  return Object.fromEntries(t.entries());
}
function jo(t) {
  return new Map(Object.entries(t));
}
function mr(t = F.FIVE_MINUTES, e) {
  const r = F.toMiliseconds(t || F.FIVE_MINUTES);
  let s, n, i, o;
  return { resolve: (a) => {
    i && s && (clearTimeout(i), s(a), o = Promise.resolve(a));
  }, reject: (a) => {
    i && n && (clearTimeout(i), n(a));
  }, done: () => new Promise((a, c) => {
    if (o) return a(o);
    i = setTimeout(() => {
      const l = j("EXPIRED"), u = new Error(e || l.message);
      u.code = l.code, c(u);
    }, r), s = a, n = c;
  }) };
}
function at(t, e, r) {
  return new Promise(async (s, n) => {
    const i = setTimeout(() => n(new Error(r)), e);
    try {
      const o = await t;
      s(o);
    } catch (o) {
      n(o);
    }
    clearTimeout(i);
  });
}
function Jf(t, e) {
  if (typeof e == "string" && e.startsWith(`${t}:`)) return e;
  if (t.toLowerCase() === "topic") {
    if (typeof e != "string") throw new Error('Value must be "string" for expirer target type: topic');
    return `topic:${e}`;
  } else if (t.toLowerCase() === "id") {
    if (typeof e != "number") throw new Error('Value must be "number" for expirer target type: id');
    return `id:${e}`;
  }
  throw new Error(`Unknown expirer target type: ${t}`);
}
function o2(t) {
  return Jf("topic", t);
}
function a2(t) {
  return Jf("id", t);
}
function Qf(t) {
  const [e, r] = t.split(":"), s = { id: void 0, topic: void 0 };
  if (e === "topic" && typeof r == "string") s.topic = r;
  else if (e === "id" && Number.isInteger(Number(r))) s.id = Number(r);
  else throw new Error(`Invalid target, expected id:number or topic:string, got ${e}:${r}`);
  return s;
}
function ae(t, e) {
  return F.fromMiliseconds(Date.now() + F.toMiliseconds(t));
}
function wt(t) {
  return Date.now() >= F.toMiliseconds(t);
}
function J(t, e) {
  return `${t}${e ? `:${e}` : ""}`;
}
function vt(t = [], e = []) {
  return [.../* @__PURE__ */ new Set([...t, ...e])];
}
async function c2({ id: t, topic: e, wcDeepLink: r }) {
  try {
    if (!r) return;
    const s = (typeof r == "string" ? JSON.parse(r) : r)?.href;
    if (typeof s != "string") return;
    const n = l2(s, t, e), i = zs();
    if (i === Fe.browser) {
      if (!zt.getDocument()?.hasFocus()) {
        console.warn("Document does not have focus, skipping deeplink.");
        return;
      }
      u2(n);
    } else i === Fe.reactNative && typeof global?.Linking < "u" && await global.Linking.openURL(n);
  } catch (s) {
    console.error(s);
  }
}
function l2(t, e, r) {
  const s = `requestId=${e}&sessionTopic=${r}`;
  t.endsWith("/") && (t = t.slice(0, -1));
  let n = `${t}`;
  if (t.startsWith("https://t.me")) {
    const i = t.includes("?") ? "&startapp=" : "?startapp=";
    n = `${n}${i}${p2(s, !0)}`;
  } else n = `${n}/wc?${s}`;
  return n;
}
function u2(t) {
  let e = "_self";
  d2() ? e = "_top" : (f2() || t.startsWith("https://") || t.startsWith("http://")) && (e = "_blank"), window.open(t, e, "noreferrer noopener");
}
async function h2(t, e) {
  let r = "";
  try {
    if (rs() && (r = localStorage.getItem(e), r)) return r;
    r = await t.getItem(e);
  } catch (s) {
    console.error(s);
  }
  return r;
}
function Bl(t, e) {
  if (!t.includes(e)) return null;
  const r = t.split(/([&,?,=])/), s = r.indexOf(e);
  return r[s + 2];
}
function Rl() {
  return typeof crypto < "u" && crypto?.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/gu, (t) => {
    const e = Math.random() * 16 | 0;
    return (t === "x" ? e : e & 3 | 8).toString(16);
  });
}
function $a() {
  return typeof process < "u" && process.env.IS_VITEST === "true";
}
function f2() {
  return typeof window < "u" && (!!window.TelegramWebviewProxy || !!window.Telegram || !!window.TelegramWebviewProxyProto);
}
function d2() {
  try {
    return window.self !== window.top;
  } catch {
    return !1;
  }
}
function p2(t, e = !1) {
  const r = new TextEncoder().encode(t), s = new Array(r.length);
  for (let i = 0; i < r.length; i++) s[i] = String.fromCharCode(r[i]);
  const n = btoa(s.join(""));
  return e ? n.replace(/[=]/g, "") : n;
}
function ed(t) {
  const e = t + "=".repeat((4 - t.length % 4) % 4), r = atob(e), s = new Uint8Array(r.length);
  for (let n = 0; n < r.length; n++) s[n] = r.charCodeAt(n);
  return new TextDecoder().decode(s);
}
function g2(t) {
  return new Promise((e) => setTimeout(e, t));
}
class y2 {
  constructor({ limit: e }) {
    this.limit = e, this.set = /* @__PURE__ */ new Set();
  }
  add(e) {
    if (!this.set.has(e)) {
      if (this.set.size >= this.limit) {
        const r = this.set.values().next().value;
        r && this.set.delete(r);
      }
      this.set.add(e);
    }
  }
  has(e) {
    return this.set.has(e);
  }
}
const w2 = "https://rpc.walletconnect.org/v1";
function Ar(t) {
  const e = t + "=".repeat((4 - t.length % 4) % 4), r = atob(e), s = new Uint8Array(r.length);
  for (let n = 0; n < r.length; n++) s[n] = r.charCodeAt(n);
  return s;
}
const m2 = /^0x[0-9a-fA-F]{64}$/;
function b2(t) {
  return m2.test(t);
}
function td(t) {
  const e = new TextEncoder().encode(t), r = new TextEncoder().encode(`Ethereum Signed Message:
${e.length}`);
  return "0x" + fe(Gu(kt([r, e])), "base16");
}
async function v2(t, e, r, s, n, i) {
  switch (r.t) {
    case "eip191":
      return await E2(t, e, r.s);
    case "eip1271":
      return await x2(t, e, r.s, s, n, i);
    default:
      throw new Error(`verifySignature failed: Attempted to verify CacaoSignature with unknown type: ${r.t}`);
  }
}
function E2(t, e, r) {
  const s = Jy(r);
  return dw({ payload: td(e), signature: s }).toLowerCase() === t.toLowerCase();
}
async function x2(t, e, r, s, n, i) {
  const o = Ft(s);
  if (!o.namespace || !o.reference) throw new Error(`isValidEip1271Signature failed: chainId must be in CAIP-2 format, received: ${s}`);
  try {
    const a = "0x1626ba7e", c = "0000000000000000000000000000000000000000000000000000000000000040", l = r.substring(2), u = (l.length / 2).toString(16).padStart(64, "0"), h = (b2(e) ? e : td(e)).substring(2), f = a + h + c + u + l, g = await fetch(`${i || w2}/?chainId=${s}&projectId=${n}`, { headers: { "Content-Type": "application/json" }, method: "POST", body: JSON.stringify({ id: _2(), jsonrpc: "2.0", method: "eth_call", params: [{ to: t, data: f }, "latest"] }) }), { result: p } = await g.json();
    return p ? p.slice(0, a.length).toLowerCase() === a.toLowerCase() : !1;
  } catch (a) {
    return console.error("isValidEip1271Signature: ", a), !1;
  }
}
function _2() {
  return Date.now() + Math.floor(Math.random() * 1e3);
}
function S2(t) {
  const e = Ar(t), r = e[0];
  if (r === 0) throw new Error("No signatures found");
  const s = 1 + r * 64;
  if (e.length < s) throw new Error("Transaction data too short for claimed signature count");
  if (e.length < 100) throw new Error("Transaction too short");
  const n = e.slice(1, 65);
  return ks.encode(n);
}
function I2(t) {
  const e = Ar(t), r = new TextEncoder().encode("TransactionData::"), s = new Uint8Array(r.length + e.length);
  s.set(r), s.set(e, r.length);
  const n = aw(s, { dkLen: 32 });
  return ks.encode(n);
}
function Cl(t) {
  const e = new Uint8Array(Or(D2(t)));
  return ks.encode(e);
}
function D2(t) {
  if (t instanceof Uint8Array) return t;
  if (Array.isArray(t)) return new Uint8Array(t);
  if (typeof t == "object" && t?.data) return new Uint8Array(Object.values(t.data));
  if (typeof t == "object" && t) return new Uint8Array(Object.values(t));
  throw new Error("getNearUint8ArrayFromBytes: Unexpected result type from bytes array");
}
function Nl(t) {
  const e = Ar(t), r = i0(e).txn;
  if (!r) throw new Error("Invalid signed transaction: missing 'txn' field");
  const s = Zw(r), n = new TextEncoder().encode("TX"), i = kt([n, new Uint8Array(s)]), o = qg(i);
  return hw.encode(o).replace(/=+$/, "");
}
function Ji(t) {
  const e = [];
  let r = BigInt(t);
  for (; r >= 0x80n; ) e.push(Number(r & 0x7fn | 0x80n)), r >>= 7n;
  return e.push(Number(r)), new Uint8Array(e);
}
function A2(t) {
  const e = Ar(t.signed.bodyBytes), r = Ar(t.signed.authInfoBytes), s = Ar(t.signature.signature), n = [];
  n.push(new Uint8Array([10])), n.push(Ji(e.length)), n.push(e), n.push(new Uint8Array([18])), n.push(Ji(r.length)), n.push(r), n.push(new Uint8Array([26])), n.push(Ji(s.length)), n.push(s);
  const i = kt(n), o = Or(i);
  return fe(o, "base16").toUpperCase();
}
const O2 = { pubnet: "Public Global Stellar Network ; September 2015", testnet: "Test SDF Network ; September 2015" }, $2 = 0, Qi = 2, Ul = 5, Ll = 72, P2 = 64, T2 = 20;
function zo(t, e) {
  return new DataView(t.buffer, t.byteOffset, t.byteLength).getUint32(e, !1);
}
function B2(t) {
  for (let e = T2; e >= 0; e--) {
    const r = t.length - 4 - Ll * e;
    if (r < 4 || zo(t, r) !== e) continue;
    let s = !0;
    for (let n = 0; n < e; n++) {
      const i = r + 4 + Ll * n;
      if (zo(t, i + 4) !== P2) {
        s = !1;
        break;
      }
    }
    if (s) return r;
  }
  throw new Error("getStellarTransactionHash: could not locate envelope signature array");
}
function R2(t, e) {
  const r = Ar(t);
  if (r.length < 8) throw new Error("getStellarTransactionHash: envelope too short");
  const s = zo(r, 0);
  let n, i;
  switch (s) {
    case $2:
      n = Qi, i = 0;
      break;
    case Qi:
      n = Qi, i = 4;
      break;
    case Ul:
      n = Ul, i = 4;
      break;
    default:
      throw new Error(`getStellarTransactionHash: unsupported envelope type: ${s}`);
  }
  const o = B2(r), a = e?.split(":").pop() ?? "pubnet", c = O2[a];
  if (!c) throw new Error(`getStellarTransactionHash: unknown Stellar network: ${a}`);
  const l = Or(new TextEncoder().encode(c)), u = new Uint8Array([0, 0, 0, n]), h = kt([l, u, r.slice(i, o)]);
  return fe(Or(h), "base16");
}
function C2(t) {
  const e = [];
  try {
    if (typeof t == "string") return e.push(t), e;
    if (typeof t != "object") return e;
    t?.id && e.push(t.id);
    const r = t?.capabilities?.caip345?.transactionHashes;
    r && e.push(...r);
  } catch (r) {
    console.warn("getWalletSendCallsHashes failed: ", r);
  }
  return e;
}
const rd = "did:pkh:", N2 = { eip155: "Ethereum", solana: "Solana", bip122: "Bitcoin" }, U2 = (t) => t ? N2[t] || t : "", oi = (t) => t?.split(":"), L2 = (t) => {
  const e = t && oi(t);
  if (e) return t.includes(rd) ? e[3] : e[1];
}, M2 = (t) => {
  const e = t && oi(t);
  if (e) return t.includes(rd) ? e[2] : e[0];
}, Un = (t) => {
  const e = t && oi(t);
  if (e) return e[2] + ":" + e[3];
}, Ln = (t) => {
  const e = t && oi(t);
  if (e) return e.pop();
};
async function Ml(t) {
  const { cacao: e, projectId: r } = t, { s, p: n } = e;
  let i;
  try {
    i = sd(n, n.iss);
  } catch {
    return !1;
  }
  const o = Ln(n.iss);
  try {
    return await v2(o, i, s, Un(n.iss), r);
  } catch {
    return !1;
  }
}
function k2(t) {
  const { cacao: e, request: r } = t, { p: s } = e;
  if (s.domain !== r.domain) return { valid: !1, reason: `domain mismatch: requested ${r.domain}, got ${s.domain}` };
  if (s.nonce !== r.nonce) return { valid: !1, reason: `nonce mismatch: requested ${r.nonce}, got ${s.nonce}` };
  const n = r.aud || r.uri, i = s.aud || s.uri;
  if (n && i !== n) return { valid: !1, reason: `aud mismatch: requested ${n}, got ${i}` };
  if (r.chains?.length) {
    const a = Un(s.iss);
    if (!a || !r.chains.includes(a)) return { valid: !1, reason: `cacao issued for chain ${a} which was not requested` };
  }
  const o = Date.now();
  if (s.exp) {
    const a = new Date(s.exp).getTime();
    if (isNaN(a)) return { valid: !1, reason: `malformed exp: ${s.exp}` };
    if (a < o) return { valid: !1, reason: "cacao has expired" };
  }
  if (s.nbf) {
    const a = new Date(s.nbf).getTime();
    if (isNaN(a)) return { valid: !1, reason: `malformed nbf: ${s.nbf}` };
    if (a > o) return { valid: !1, reason: "cacao is not yet valid" };
  }
  return { valid: !0 };
}
const sd = (t, e) => {
  const r = M2(e);
  if (!r) throw new Error("Invalid issuer: " + e);
  const s = `${t.domain} wants you to sign in with your ${U2(r)} account:`, n = Ln(e);
  if (!t.aud && !t.uri) throw new Error("Either `aud` or `uri` is required to construct the message");
  let i = t.statement || void 0;
  const o = `URI: ${t.aud || t.uri}`, a = `Version: ${t.version}`, c = `Chain ID: ${L2(e)}`, l = `Nonce: ${t.nonce}`, u = `Issued At: ${t.iat}`, h = t.exp ? `Expiration Time: ${t.exp}` : void 0, f = t.nbf ? `Not Before: ${t.nbf}` : void 0, g = t.requestId ? `Request ID: ${t.requestId}` : void 0, p = t.resources ? `Resources:${t.resources.map((m) => `
- ${m}`).join("")}` : void 0, y = yn(t.resources);
  if (y) {
    const m = $s(y);
    i = G2(i, m);
  }
  if (i && /\r|\n/.test(i)) throw new Error("Statement must not contain line breaks (`\\r` or `\\n`)");
  return [s, n, "", i, "", o, a, c, l, u, h, f, g, p].filter((m) => m != null).join(`
`);
};
function q2(t) {
  const e = JSON.stringify(t), r = new TextEncoder().encode(e), s = new Array(r.length);
  for (let n = 0; n < r.length; n++) s[n] = String.fromCharCode(r[n]);
  return btoa(s.join(""));
}
function F2(t) {
  const e = t + "=".repeat((4 - t.length % 4) % 4), r = atob(e), s = new Uint8Array(r.length);
  for (let n = 0; n < r.length; n++) s[n] = r.charCodeAt(n);
  return JSON.parse(new TextDecoder().decode(s));
}
function Tr(t) {
  if (!t) throw new Error("No recap provided, value is undefined");
  if (!t.att) throw new Error("No `att` property found");
  const e = Object.keys(t.att);
  if (!e?.length) throw new Error("No resources found in `att` property");
  e.forEach((r) => {
    const s = t.att[r];
    if (Array.isArray(s)) throw new Error(`Resource must be an object: ${r}`);
    if (typeof s != "object") throw new Error(`Resource must be an object: ${r}`);
    if (!Object.keys(s).length) throw new Error(`Resource object is empty: ${r}`);
    Object.keys(s).forEach((n) => {
      const i = s[n];
      if (!Array.isArray(i)) throw new Error(`Ability limits ${n} must be an array of objects, found: ${i}`);
      if (!i.length) throw new Error(`Value of ${n} is empty array, must be an array with objects`);
      i.forEach((o) => {
        if (typeof o != "object") throw new Error(`Ability limits (${n}) must be an array of objects, found: ${o}`);
      });
    });
  });
}
function j2(t, e, r, s = {}) {
  return r?.sort((n, i) => n.localeCompare(i)), { att: { [t]: z2(e, r, s) } };
}
function z2(t, e, r = {}) {
  e = e?.sort((n, i) => n.localeCompare(i));
  const s = e.map((n) => ({ [`${t}/${n}`]: [r] }));
  return Object.assign({}, ...s);
}
function nd(t) {
  return Tr(t), `urn:recap:${q2(t).replace(/=/g, "")}`;
}
function $s(t) {
  const e = F2(t.replace("urn:recap:", ""));
  return Tr(e), e;
}
function H2(t, e, r) {
  const s = j2(t, e, r);
  return nd(s);
}
function K2(t) {
  return t && t.includes("urn:recap:");
}
function V2(t, e) {
  const r = $s(t), s = $s(e), n = W2(r, s);
  return nd(n);
}
function W2(t, e) {
  Tr(t), Tr(e);
  const r = Object.keys(t.att).concat(Object.keys(e.att)).sort((n, i) => n.localeCompare(i)), s = { att: {} };
  return r.forEach((n) => {
    Object.keys(t.att?.[n] || {}).concat(Object.keys(e.att?.[n] || {})).sort((i, o) => i.localeCompare(o)).forEach((i) => {
      s.att[n] = { ...s.att[n], [i]: t.att[n]?.[i] || e.att[n]?.[i] };
    });
  }), s;
}
function G2(t = "", e) {
  Tr(e);
  const r = "I further authorize the stated URI to perform the following actions on my behalf: ";
  if (t.includes(r)) return t;
  const s = [];
  let n = 0;
  Object.keys(e.att).forEach((a) => {
    const c = Object.keys(e.att[a]).map((h) => ({ ability: h.split("/")[0], action: h.split("/")[1] }));
    c.sort((h, f) => h.action.localeCompare(f.action));
    const l = {};
    c.forEach((h) => {
      l[h.ability] || (l[h.ability] = []), l[h.ability].push(h.action);
    });
    const u = Object.keys(l).map((h) => (n++, `(${n}) '${h}': '${l[h].join("', '")}' for '${a}'.`));
    s.push(u.join(", ").replace(".,", "."));
  });
  const i = s.join(" "), o = `${r}${i}`;
  return `${t ? t + " " : ""}${o}`;
}
function kl(t) {
  const e = $s(t);
  Tr(e);
  const r = e.att?.eip155;
  return r ? Object.keys(r).map((s) => s.split("/")[1]) : [];
}
function ql(t) {
  const e = $s(t);
  Tr(e);
  const r = [];
  return Object.values(e.att).forEach((s) => {
    Object.values(s).forEach((n) => {
      n?.[0]?.chains && r.push(n[0].chains);
    });
  }), [...new Set(r.flat())];
}
function yn(t) {
  if (!t) return;
  const e = t?.[t.length - 1];
  return K2(e) ? e : void 0;
}
const id = "base10", $e = "base16", be = "base64pad", mt = "base64url", Hs = "utf8", od = 0, jt = 1, Br = 2, Y2 = 0, Fl = 1, bs = 12, Pa = 32;
function Z2() {
  const t = To.utils.randomPrivateKey(), e = To.getPublicKey(t);
  return { privateKey: fe(t, $e), publicKey: fe(e, $e) };
}
function Ho() {
  const t = ur(Pa);
  return fe(t, $e);
}
function X2(t, e) {
  const r = To.getSharedSecret(De(t, $e), De(e, $e)), s = bm(Yn, r, void 0, void 0, Pa);
  return fe(s, $e);
}
function wn(t) {
  const e = Yn(De(t, $e));
  return fe(e, $e);
}
function Ge(t) {
  const e = Yn(De(t, Hs));
  return fe(e, $e);
}
function ad(t) {
  return De(`${t}`, id);
}
function Rr(t) {
  return Number(fe(t, id));
}
function cd(t) {
  return t.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function Mn(t) {
  const e = t.replace(/-/g, "+").replace(/_/g, "/"), r = (4 - e.length % 4) % 4;
  return e + "=".repeat(r);
}
function J2(t) {
  const e = ad(typeof t.type < "u" ? t.type : od);
  if (Rr(e) === jt && typeof t.senderPublicKey > "u") throw new Error("Missing sender public key for type 1 envelope");
  const r = typeof t.senderPublicKey < "u" ? De(t.senderPublicKey, $e) : void 0, s = typeof t.iv < "u" ? De(t.iv, $e) : ur(bs), n = De(t.symKey, $e), i = Kh(n, s).encrypt(De(t.message, Hs)), o = ld({ type: e, sealed: i, iv: s, senderPublicKey: r });
  return t.encoding === mt ? cd(o) : o;
}
function Q2(t) {
  const e = De(t.symKey, $e), { sealed: r, iv: s } = Ps({ encoded: t.encoded, encoding: t.encoding }), n = Kh(e, s).decrypt(r);
  if (n === null) throw new Error("Failed to decrypt");
  return fe(n, Hs);
}
function ex(t, e) {
  const r = ad(Br), s = ur(bs), n = De(t, Hs), i = ld({ type: r, sealed: n, iv: s });
  return e === mt ? cd(i) : i;
}
function tx(t, e) {
  const { sealed: r } = Ps({ encoded: t, encoding: e });
  return fe(r, Hs);
}
function ld(t) {
  if (Rr(t.type) === Br) return fe(kt([t.type, t.sealed]), be);
  if (Rr(t.type) === jt) {
    if (typeof t.senderPublicKey > "u") throw new Error("Missing sender public key for type 1 envelope");
    return fe(kt([t.type, t.senderPublicKey, t.iv, t.sealed]), be);
  }
  return fe(kt([t.type, t.iv, t.sealed]), be);
}
function Ps(t) {
  const e = (t.encoding || be) === mt ? Mn(t.encoded) : t.encoded, r = De(e, be), s = r.slice(Y2, Fl), n = Fl;
  if (Rr(s) === jt) {
    const c = n + Pa, l = c + bs, u = r.slice(n, c), h = r.slice(c, l), f = r.slice(l);
    return { type: s, sealed: f, iv: h, senderPublicKey: u };
  }
  if (Rr(s) === Br) {
    const c = r.slice(n), l = ur(bs);
    return { type: s, sealed: c, iv: l };
  }
  const i = n + bs, o = r.slice(n, i), a = r.slice(i);
  return { type: s, sealed: a, iv: o };
}
function rx(t, e) {
  const r = Ps({ encoded: t, encoding: e?.encoding });
  return ud({ type: Rr(r.type), senderPublicKey: typeof r.senderPublicKey < "u" ? fe(r.senderPublicKey, $e) : void 0, receiverPublicKey: e?.receiverPublicKey });
}
function ud(t) {
  const e = t?.type || od;
  if (e === jt) {
    if (typeof t?.senderPublicKey > "u") throw new Error("missing sender public key");
    if (typeof t?.receiverPublicKey > "u") throw new Error("missing receiver public key");
  }
  return { type: e, senderPublicKey: t?.senderPublicKey, receiverPublicKey: t?.receiverPublicKey };
}
function jl(t) {
  return t.type === jt && typeof t.senderPublicKey == "string" && typeof t.receiverPublicKey == "string";
}
function zl(t) {
  return t.type === Br;
}
function sx(t) {
  const e = De(Mn(t.x), be), r = De(Mn(t.y), be);
  return kt([new Uint8Array([4]), e, r]);
}
function nx(t, e) {
  const [r, s, n] = t.split("."), i = De(Mn(n), be);
  if (i.length !== 64) throw new Error("Invalid signature length");
  const o = i.slice(0, 32), a = i.slice(32, 64), c = `${r}.${s}`, l = Yn(c), u = sx(e);
  if (!ab.verify(kt([o, a]), l, u)) throw new Error("Invalid signature");
  return Mo(t).payload;
}
const ix = "irn";
function kn(t) {
  return t?.relay || { protocol: ix };
}
function Hr(t) {
  const e = eE[t];
  if (typeof e > "u") throw new Error(`Relay Protocol not supported: ${t}`);
  return e;
}
function ox(t, e = "-") {
  const r = {}, s = "relay" + e;
  return Object.keys(t).forEach((n) => {
    if (n.startsWith(s)) {
      const i = n.replace(s, ""), o = t[n];
      r[i] = o;
    }
  }), r;
}
function Hl(t) {
  if (!t.includes("wc:")) {
    const l = ed(t);
    l?.includes("wc:") && (t = l);
  }
  t = t.includes("wc://") ? t.replace("wc://", "") : t, t = t.includes("wc:") ? t.replace("wc:", "") : t;
  const e = t.indexOf(":"), r = t.indexOf("?") !== -1 ? t.indexOf("?") : void 0, s = t.substring(0, e), n = t.substring(e + 1, r).split("@"), i = typeof r < "u" ? t.substring(r) : "", o = new URLSearchParams(i), a = Object.fromEntries(o.entries()), c = typeof a.methods == "string" ? a.methods.split(",") : void 0;
  return { protocol: s, topic: ax(n[0]), version: parseInt(n[1], 10), symKey: a.symKey, relay: ox(a), methods: c, expiryTimestamp: a.expiryTimestamp ? parseInt(a.expiryTimestamp, 10) : void 0 };
}
function ax(t) {
  return t.startsWith("//") ? t.substring(2) : t;
}
function cx(t, e = "-") {
  const r = "relay", s = {};
  return Object.keys(t).forEach((n) => {
    const i = n, o = r + e + i;
    t[i] && (s[o] = t[i]);
  }), s;
}
function Kl(t) {
  const e = new URLSearchParams(), r = { ...cx(t.relay), symKey: t.symKey, ...t.expiryTimestamp && { expiryTimestamp: t.expiryTimestamp.toString() }, ...t.methods && { methods: t.methods.join(",") } };
  return Object.entries(r).sort(([s], [n]) => s.localeCompare(n)).forEach(([s, n]) => {
    n !== void 0 && e.append(s, String(n));
  }), `${t.protocol}:${t.topic}@${t.version}?${e}`;
}
function cn(t, e, r) {
  return `${t}?wc_ev=${r}&topic=${e}`;
}
function ss(t) {
  const e = [];
  return t.forEach((r) => {
    const [s, n] = r.split(":");
    e.push(`${s}:${n}`);
  }), e;
}
function hd(t) {
  const e = [];
  return Object.values(t).forEach((r) => {
    e.push(...ss(r.accounts));
  }), [...new Set(e)];
}
function lx(t) {
  const e = [];
  return Object.values(t).forEach((r) => {
    e.push(...r.methods);
  }), [...new Set(e)];
}
function ux(t) {
  const e = [];
  return Object.values(t).forEach((r) => {
    e.push(...r.events);
  }), [...new Set(e)];
}
function hx(t, e) {
  const r = [];
  return Object.values(t).forEach((s) => {
    ss(s.accounts).includes(e) && r.push(...s.methods);
  }), r;
}
function fx(t, e) {
  const r = [];
  return Object.values(t).forEach((s) => {
    ss(s.accounts).includes(e) && r.push(...s.events);
  }), r;
}
function ai(t) {
  return t.includes(":");
}
function Kr(t) {
  return ai(t) ? t.split(":")[0] : t;
}
function Vl(t) {
  const e = {};
  if (!Et(t)) return e;
  for (const [r, s] of Object.entries(t)) {
    const n = ai(r) ? [r] : s.chains, i = s.methods || [], o = s.events || [], a = Kr(r);
    e[a] = { ...e[a], chains: vt(n, e[a]?.chains), methods: vt(i, e[a]?.methods), events: vt(o, e[a]?.events) };
  }
  return e;
}
function dx(t) {
  const e = {};
  return t?.forEach((r) => {
    const [s, n] = r.split(":");
    e[s] || (e[s] = { accounts: [], chains: [], events: [], methods: [] }), e[s].accounts.push(r), e[s].chains?.push(`${s}:${n}`);
  }), e;
}
function Wl(t, e) {
  e = e.map((s) => s.replace("did:pkh:", ""));
  const r = dx(e);
  for (const [s, n] of Object.entries(r)) n.methods ? n.methods = vt(n.methods, t) : n.methods = t, n.events = ["chainChanged", "accountsChanged"];
  return r;
}
function px(t, e) {
  const r = Vl(t), s = Vl(e), n = {}, i = Object.keys(r).concat(Object.keys(s));
  for (const o of i) n[o] = { chains: vt(r[o]?.chains, s[o]?.chains), methods: vt(r[o]?.methods, s[o]?.methods), events: vt(r[o]?.events, s[o]?.events) };
  return n;
}
function Ze(t, e) {
  return !!Array.isArray(t);
}
function Et(t) {
  return Object.getPrototypeOf(t) === Object.prototype && Object.keys(t).length;
}
function he(t) {
  return typeof t > "u";
}
function ce(t, e) {
  return e && he(t) ? !0 : typeof t == "string" && !!t.trim().length;
}
function Ta(t, e) {
  return e && he(t) ? !0 : typeof t == "number" && !isNaN(t);
}
function gx(t, e) {
  const { requiredNamespaces: r } = e, s = Object.keys(t.namespaces), n = Object.keys(r);
  let i = !0;
  return Ir(n, s) ? (s.forEach((o) => {
    const { accounts: a, methods: c, events: l } = t.namespaces[o], u = ss(a), h = r[o];
    (!Ir(Yf(o, h), u) || !Ir(h.methods, c) || !Ir(h.events, l)) && (i = !1);
  }), i) : !1;
}
function qn(t) {
  return ce(t, !1) && t.includes(":") ? t.split(":").length === 2 : !1;
}
function yx(t) {
  if (ce(t, !1) && t.includes(":")) {
    const e = t.split(":");
    if (e.length === 3) {
      const r = e[0] + ":" + e[1];
      return !!e[2] && qn(r);
    }
  }
  return !1;
}
function wx(t) {
  function e(r) {
    try {
      return typeof new URL(r) < "u";
    } catch {
      return !1;
    }
  }
  try {
    if (ce(t, !1)) {
      if (e(t)) return !0;
      const r = ed(t);
      return e(r);
    }
  } catch {
  }
  return !1;
}
function mx(t) {
  return t?.proposer?.publicKey;
}
function bx(t) {
  return t?.topic;
}
function vx(t, e) {
  let r = null;
  return ce(t?.publicKey, !1) || (r = j("MISSING_OR_INVALID", `${e} controller public key should be a string`)), r;
}
function Gl(t) {
  let e = !0;
  return Ze(t) ? t.length && (e = t.every((r) => ce(r, !1))) : e = !1, e;
}
function Ex(t, e, r) {
  let s = null;
  return Ze(e) && e.length ? e.forEach((n) => {
    s || qn(n) || (s = Q("UNSUPPORTED_CHAINS", `${r}, chain ${n} should be a string and conform to "namespace:chainId" format`));
  }) : qn(t) || (s = Q("UNSUPPORTED_CHAINS", `${r}, chains must be defined as "namespace:chainId" e.g. "eip155:1": {...} in the namespace key OR as an array of CAIP-2 chainIds e.g. eip155: { chains: ["eip155:1", "eip155:5"] }`)), s;
}
function xx(t, e, r) {
  let s = null;
  return Object.entries(t).forEach(([n, i]) => {
    if (s) return;
    const o = Ex(n, Yf(n, i), `${e} ${r}`);
    o && (s = o);
  }), s;
}
function _x(t, e) {
  let r = null;
  return Ze(t) ? t.forEach((s) => {
    r || yx(s) || (r = Q("UNSUPPORTED_ACCOUNTS", `${e}, account ${s} should be a string and conform to "namespace:chainId:address" format`));
  }) : r = Q("UNSUPPORTED_ACCOUNTS", `${e}, accounts should be an array of strings conforming to "namespace:chainId:address" format`), r;
}
function Sx(t, e) {
  let r = null;
  return Object.values(t).forEach((s) => {
    if (r) return;
    const n = _x(s?.accounts, `${e} namespace`);
    n && (r = n);
  }), r;
}
function Ix(t, e) {
  let r = null;
  return Gl(t?.methods) ? Gl(t?.events) || (r = Q("UNSUPPORTED_EVENTS", `${e}, events should be an array of strings or empty array for no events`)) : r = Q("UNSUPPORTED_METHODS", `${e}, methods should be an array of strings or empty array for no methods`), r;
}
function fd(t, e) {
  let r = null;
  return Object.values(t).forEach((s) => {
    if (r) return;
    const n = Ix(s, `${e}, namespace`);
    n && (r = n);
  }), r;
}
function Dx(t, e, r) {
  let s = null;
  if (t && Et(t)) {
    const n = fd(t, e);
    n && (s = n);
    const i = xx(t, e, r);
    i && (s = i);
  } else s = j("MISSING_OR_INVALID", `${e}, ${r} should be an object with data`);
  return s;
}
function eo(t, e) {
  let r = null;
  if (t && Et(t)) {
    const s = fd(t, e);
    s && (r = s);
    const n = Sx(t, e);
    n && (r = n);
  } else r = j("MISSING_OR_INVALID", `${e}, namespaces should be an object with data`);
  return r;
}
function dd(t) {
  return ce(t.protocol, !0);
}
function Ax(t, e) {
  let r = !1;
  return t ? t && Ze(t) && t.length && t.forEach((s) => {
    r = dd(s);
  }) : r = !0, r;
}
function Ox(t) {
  return typeof t == "number";
}
function Be(t) {
  return typeof t < "u" && typeof t !== null;
}
function $x(t) {
  return !(!t || typeof t != "object" || !t.code || !Ta(t.code, !1) || !t.message || !ce(t.message, !1));
}
function Px(t) {
  return !(he(t) || !ce(t.method, !1));
}
function Tx(t) {
  return !(he(t) || he(t.result) && he(t.error) || !Ta(t.id, !1) || !ce(t.jsonrpc, !1));
}
function Bx(t) {
  return !(he(t) || !ce(t.name, !1));
}
function Yl(t, e) {
  return !(!qn(e) || !hd(t).includes(e));
}
function Rx(t, e, r) {
  return ce(r, !1) ? hx(t, e).includes(r) : !1;
}
function Cx(t, e, r) {
  return ce(r, !1) ? fx(t, e).includes(r) : !1;
}
function Zl(t, e, r) {
  let s = null;
  const n = Nx(t), i = Ux(e), o = Object.keys(n), a = Object.keys(i), c = Xl(Object.keys(t)), l = Xl(Object.keys(e)), u = c.filter((h) => !l.includes(h));
  return u.length && (s = j("NON_CONFORMING_NAMESPACES", `${r} namespaces keys don't satisfy requiredNamespaces.
      Required: ${u.toString()}
      Received: ${Object.keys(e).toString()}`)), Ir(o, a) || (s = j("NON_CONFORMING_NAMESPACES", `${r} namespaces chains don't satisfy required namespaces.
      Required: ${o.toString()}
      Approved: ${a.toString()}`)), Object.keys(e).forEach((h) => {
    if (!h.includes(":") || s) return;
    const f = ss(e[h].accounts);
    f.includes(h) || (s = j("NON_CONFORMING_NAMESPACES", `${r} namespaces accounts don't satisfy namespace accounts for ${h}
        Required: ${h}
        Approved: ${f.toString()}`));
  }), o.forEach((h) => {
    s || (Ir(n[h].methods, i[h].methods) ? Ir(n[h].events, i[h].events) || (s = j("NON_CONFORMING_NAMESPACES", `${r} namespaces events don't satisfy namespace events for ${h}`)) : s = j("NON_CONFORMING_NAMESPACES", `${r} namespaces methods don't satisfy namespace methods for ${h}`));
  }), s;
}
function Nx(t) {
  const e = {};
  return Object.keys(t).forEach((r) => {
    r.includes(":") ? e[r] = t[r] : t[r].chains?.forEach((s) => {
      e[s] = { methods: t[r].methods, events: t[r].events };
    });
  }), e;
}
function Xl(t) {
  return [...new Set(t.map((e) => e.includes(":") ? e.split(":")[0] : e))];
}
function Ux(t) {
  const e = {};
  return Object.keys(t).forEach((r) => {
    r.includes(":") ? e[r] = t[r] : ss(t[r].accounts)?.forEach((s) => {
      e[s] = { accounts: t[r].accounts.filter((n) => n.includes(`${s}:`)), methods: t[r].methods, events: t[r].events };
    });
  }), e;
}
function Lx(t, e) {
  return Ta(t, !1) && t <= e.max && t >= e.min;
}
function Jl() {
  const t = zs();
  return new Promise((e) => {
    switch (t) {
      case Fe.browser:
        e(Mx());
        break;
      case Fe.reactNative:
        e(kx());
        break;
      case Fe.node:
        e(qx());
        break;
      default:
        e(!0);
    }
  });
}
function Mx() {
  return rs() && navigator?.onLine;
}
async function kx() {
  return fr() && typeof global < "u" && global?.NetInfo ? (await global?.NetInfo.fetch())?.isConnected : !0;
}
function qx() {
  return !0;
}
function Fx(t) {
  switch (zs()) {
    case Fe.browser:
      jx(t);
      break;
    case Fe.reactNative:
      zx(t);
      break;
  }
}
function jx(t) {
  !fr() && rs() && (window.addEventListener("online", () => t(!0)), window.addEventListener("offline", () => t(!1)));
}
function zx(t) {
  fr() && typeof global < "u" && global?.NetInfo && global?.NetInfo.addEventListener((e) => t(e?.isConnected));
}
function Hx() {
  return rs() && zt.getDocument() ? zt.getDocument()?.visibilityState === "visible" : !0;
}
const to = {};
class fs {
  static get(e) {
    return to[e];
  }
  static set(e, r) {
    to[e] = r;
  }
  static delete(e) {
    delete to[e];
  }
}
function Kx(t) {
  const e = ks.decode(t);
  if (e.length < 33) throw new Error("Too short to contain a public key");
  return e.slice(1, 33);
}
function Vx({ publicKey: t, signature: e, payload: r }) {
  const s = Fn(r.method), n = 128 | parseInt(r.version?.toString() || "4"), i = Yx(r.address), o = r.era === "00" ? new Uint8Array([0]) : Fn(r.era);
  if (o.length !== 1 && o.length !== 2) throw new Error("Invalid era length");
  const a = parseInt(r.nonce, 16), c = new Uint8Array([a & 255, a >> 8 & 255]), l = BigInt(`0x${Gx(r.tip)}`), u = Xx(l), h = new Uint8Array([0, ...t, i, ...e, ...o, ...c, ...u, ...s]), f = Zx(h.length + 1);
  return new Uint8Array([...f, n, ...h]);
}
function Wx(t) {
  const e = Fn(t), r = nE.blake2b(e, void 0, 32);
  return "0x" + fe(r, "base16");
}
function Fn(t) {
  return new Uint8Array(t.replace(/^0x/, "").match(/.{1,2}/g).map((e) => parseInt(e, 16)));
}
function Gx(t) {
  return t.startsWith("0x") ? t.slice(2) : t;
}
function Yx(t) {
  const e = ks.decode(t)[0];
  return e === 42 ? 0 : e === 60 ? 2 : 1;
}
function Zx(t) {
  if (t < 64) return new Uint8Array([t << 2]);
  if (t < 16384) {
    const e = t << 2 | 1;
    return new Uint8Array([e & 255, e >> 8 & 255]);
  } else if (t < 1 << 30) {
    const e = t << 2 | 2;
    return new Uint8Array([e & 255, e >> 8 & 255, e >> 16 & 255, e >> 24 & 255]);
  } else throw new Error("Compact encoding > 2^30 not supported");
}
function Xx(t) {
  if (t < 1n << 6n) return new Uint8Array([Number(t << 2n)]);
  if (t < 1n << 14n) {
    const e = t << 2n | 0x01n;
    return new Uint8Array([Number(e & 0xffn), Number(e >> 8n & 0xffn)]);
  } else if (t < 1n << 30n) {
    const e = t << 2n | 0x02n;
    return new Uint8Array([Number(e & 0xffn), Number(e >> 8n & 0xffn), Number(e >> 16n & 0xffn), Number(e >> 24n & 0xffn)]);
  } else throw new Error("BigInt compact encoding not supported > 2^30");
}
function Jx(t) {
  const e = Fn(t.signature), r = Kx(t.transaction.address), s = Vx({ publicKey: r, signature: e, payload: t.transaction }), n = fe(s, "base16");
  return Wx(n);
}
const Qx = /* @__PURE__ */ new Set(["TransferFactory_Transfer", "DelegateProxy_TransferFactory_Transfer"]);
function e_(t) {
  const e = t?.commands;
  if (!Array.isArray(e)) return [];
  const r = [];
  for (const s of e) {
    const n = s?.ExerciseCommand;
    if (!n || !Qx.has(n.choice)) continue;
    const i = n.choiceArgument?.transfer;
    !i?.amount || !i?.instrumentId?.id || r.push({ amount: String(i.amount), instrumentId: String(i.instrumentId.id) });
  }
  return r;
}
function t_(t, e) {
  const r = e?.payload?.updateId;
  if (!r) return [];
  const s = e_(t);
  return s.length === 0 ? [String(r)] : s.map((n) => `${r}:${n.amount}:${n.instrumentId}`);
}
function Ba({ logger: t, name: e }) {
  const r = typeof t == "string" ? Gf({ opts: { level: t, name: e } }).logger : t;
  return r.level = typeof t == "string" ? t : t.level, r;
}
class Cr {
}
let r_ = class extends Cr {
  constructor(e) {
    super();
  }
};
const Ql = F.FIVE_SECONDS, Nr = { pulse: "heartbeat_pulse" };
class Ra extends r_ {
  constructor(e) {
    super(e), this.events = new je.EventEmitter(), this.interval = Ql, this.interval = e?.interval || Ql;
  }
  static async init(e) {
    const r = new Ra(e);
    return await r.init(), r;
  }
  async init() {
    await this.initialize();
  }
  stop() {
    clearInterval(this.intervalRef);
  }
  on(e, r) {
    this.events.on(e, r);
  }
  once(e, r) {
    this.events.once(e, r);
  }
  off(e, r) {
    this.events.off(e, r);
  }
  removeListener(e, r) {
    this.events.removeListener(e, r);
  }
  async initialize() {
    this.intervalRef = setInterval(() => this.pulse(), F.toMiliseconds(this.interval));
  }
  pulse() {
    this.events.emit(Nr.pulse);
  }
}
const s_ = /"(?:_|\\u0{2}5[Ff]){2}(?:p|\\u0{2}70)(?:r|\\u0{2}72)(?:o|\\u0{2}6[Ff])(?:t|\\u0{2}74)(?:o|\\u0{2}6[Ff])(?:_|\\u0{2}5[Ff]){2}"\s*:/, n_ = /"(?:c|\\u0063)(?:o|\\u006[Ff])(?:n|\\u006[Ee])(?:s|\\u0073)(?:t|\\u0074)(?:r|\\u0072)(?:u|\\u0075)(?:c|\\u0063)(?:t|\\u0074)(?:o|\\u006[Ff])(?:r|\\u0072)"\s*:/, i_ = /^\s*["[{]|^\s*-?\d{1,16}(\.\d{1,17})?([Ee][+-]?\d+)?\s*$/;
function o_(t, e) {
  if (t === "__proto__" || t === "constructor" && e && typeof e == "object" && "prototype" in e) {
    a_(t);
    return;
  }
  return e;
}
function a_(t) {
  console.warn(`[destr] Dropping "${t}" key to prevent prototype pollution.`);
}
function ln(t, e = {}) {
  if (typeof t != "string")
    return t;
  if (t[0] === '"' && t[t.length - 1] === '"' && t.indexOf("\\") === -1)
    return t.slice(1, -1);
  const r = t.trim();
  if (r.length <= 9)
    switch (r.toLowerCase()) {
      case "true":
        return !0;
      case "false":
        return !1;
      case "undefined":
        return;
      case "null":
        return null;
      case "nan":
        return Number.NaN;
      case "infinity":
        return Number.POSITIVE_INFINITY;
      case "-infinity":
        return Number.NEGATIVE_INFINITY;
    }
  if (!i_.test(t)) {
    if (e.strict)
      throw new SyntaxError("[destr] Invalid JSON");
    return t;
  }
  try {
    if (s_.test(t) || n_.test(t)) {
      if (e.strict)
        throw new Error("[destr] Possible prototype pollution");
      return JSON.parse(t, o_);
    }
    return JSON.parse(t);
  } catch (s) {
    if (e.strict)
      throw s;
    return t;
  }
}
function c_(t) {
  return !t || typeof t.then != "function" ? Promise.resolve(t) : t;
}
function pe(t, ...e) {
  try {
    return c_(t(...e));
  } catch (r) {
    return Promise.reject(r);
  }
}
function l_(t) {
  const e = typeof t;
  return t === null || e !== "object" && e !== "function";
}
function u_(t) {
  const e = Object.getPrototypeOf(t);
  return !e || e.isPrototypeOf(Object);
}
function mn(t) {
  if (l_(t))
    return String(t);
  if (u_(t) || Array.isArray(t))
    return JSON.stringify(t);
  if (typeof t.toJSON == "function")
    return mn(t.toJSON());
  throw new Error("[unstorage] Cannot stringify value!");
}
const Ko = "base64:";
function h_(t) {
  return typeof t == "string" ? t : Ko + p_(t);
}
function f_(t) {
  return typeof t != "string" || !t.startsWith(Ko) ? t : d_(t.slice(Ko.length));
}
function d_(t) {
  return globalThis.Buffer ? Buffer.from(t, "base64") : Uint8Array.from(
    globalThis.atob(t),
    (e) => e.codePointAt(0)
  );
}
function p_(t) {
  return globalThis.Buffer ? Buffer.from(t).toString("base64") : globalThis.btoa(String.fromCodePoint(...t));
}
function Te(t) {
  return t && t.split("?")[0]?.replace(/[/\\]/g, ":").replace(/:+/g, ":").replace(/^:|:$/g, "") || "";
}
function g_(...t) {
  return Te(t.join(":"));
}
function un(t) {
  return t = Te(t), t ? t + ":" : "";
}
function y_(t, e) {
  if (e === void 0)
    return !0;
  let r = 0, s = t.indexOf(":");
  for (; s > -1; )
    r++, s = t.indexOf(":", s + 1);
  return r <= e;
}
function w_(t, e) {
  return e ? t.startsWith(e) && t[t.length - 1] !== "$" : t[t.length - 1] !== "$";
}
const m_ = "memory", b_ = () => {
  const t = /* @__PURE__ */ new Map();
  return {
    name: m_,
    getInstance: () => t,
    hasItem(e) {
      return t.has(e);
    },
    getItem(e) {
      return t.get(e) ?? null;
    },
    getItemRaw(e) {
      return t.get(e) ?? null;
    },
    setItem(e, r) {
      t.set(e, r);
    },
    setItemRaw(e, r) {
      t.set(e, r);
    },
    removeItem(e) {
      t.delete(e);
    },
    getKeys() {
      return [...t.keys()];
    },
    clear() {
      t.clear();
    },
    dispose() {
      t.clear();
    }
  };
};
function v_(t = {}) {
  const e = {
    mounts: { "": t.driver || b_() },
    mountpoints: [""],
    watching: !1,
    watchListeners: [],
    unwatch: {}
  }, r = (l) => {
    for (const u of e.mountpoints)
      if (l.startsWith(u))
        return {
          base: u,
          relativeKey: l.slice(u.length),
          driver: e.mounts[u]
        };
    return {
      base: "",
      relativeKey: l,
      driver: e.mounts[""]
    };
  }, s = (l, u) => e.mountpoints.filter(
    (h) => h.startsWith(l) || u && l.startsWith(h)
  ).map((h) => ({
    relativeBase: l.length > h.length ? l.slice(h.length) : void 0,
    mountpoint: h,
    driver: e.mounts[h]
  })), n = (l, u) => {
    if (e.watching) {
      u = Te(u);
      for (const h of e.watchListeners)
        h(l, u);
    }
  }, i = async () => {
    if (!e.watching) {
      e.watching = !0;
      for (const l in e.mounts)
        e.unwatch[l] = await eu(
          e.mounts[l],
          n,
          l
        );
    }
  }, o = async () => {
    if (e.watching) {
      for (const l in e.unwatch)
        await e.unwatch[l]();
      e.unwatch = {}, e.watching = !1;
    }
  }, a = (l, u, h) => {
    const f = /* @__PURE__ */ new Map(), g = (p) => {
      let y = f.get(p.base);
      return y || (y = {
        driver: p.driver,
        base: p.base,
        items: []
      }, f.set(p.base, y)), y;
    };
    for (const p of l) {
      const y = typeof p == "string", m = Te(y ? p : p.key), E = y ? void 0 : p.value, $ = y || !p.options ? u : { ...u, ...p.options }, b = r(m);
      g(b).items.push({
        key: m,
        value: E,
        relativeKey: b.relativeKey,
        options: $
      });
    }
    return Promise.all([...f.values()].map((p) => h(p))).then(
      (p) => p.flat()
    );
  }, c = {
    // Item
    hasItem(l, u = {}) {
      l = Te(l);
      const { relativeKey: h, driver: f } = r(l);
      return pe(f.hasItem, h, u);
    },
    getItem(l, u = {}) {
      l = Te(l);
      const { relativeKey: h, driver: f } = r(l);
      return pe(f.getItem, h, u).then(
        (g) => ln(g)
      );
    },
    getItems(l, u = {}) {
      return a(l, u, (h) => h.driver.getItems ? pe(
        h.driver.getItems,
        h.items.map((f) => ({
          key: f.relativeKey,
          options: f.options
        })),
        u
      ).then(
        (f) => f.map((g) => ({
          key: g_(h.base, g.key),
          value: ln(g.value)
        }))
      ) : Promise.all(
        h.items.map((f) => pe(
          h.driver.getItem,
          f.relativeKey,
          f.options
        ).then((g) => ({
          key: f.key,
          value: ln(g)
        })))
      ));
    },
    getItemRaw(l, u = {}) {
      l = Te(l);
      const { relativeKey: h, driver: f } = r(l);
      return f.getItemRaw ? pe(f.getItemRaw, h, u) : pe(f.getItem, h, u).then(
        (g) => f_(g)
      );
    },
    async setItem(l, u, h = {}) {
      if (u === void 0)
        return c.removeItem(l);
      l = Te(l);
      const { relativeKey: f, driver: g } = r(l);
      g.setItem && (await pe(g.setItem, f, mn(u), h), g.watch || n("update", l));
    },
    async setItems(l, u) {
      await a(l, u, async (h) => {
        if (h.driver.setItems)
          return pe(
            h.driver.setItems,
            h.items.map((f) => ({
              key: f.relativeKey,
              value: mn(f.value),
              options: f.options
            })),
            u
          );
        h.driver.setItem && await Promise.all(
          h.items.map((f) => pe(
            h.driver.setItem,
            f.relativeKey,
            mn(f.value),
            f.options
          ))
        );
      });
    },
    async setItemRaw(l, u, h = {}) {
      if (u === void 0)
        return c.removeItem(l, h);
      l = Te(l);
      const { relativeKey: f, driver: g } = r(l);
      if (g.setItemRaw)
        await pe(g.setItemRaw, f, u, h);
      else if (g.setItem)
        await pe(g.setItem, f, h_(u), h);
      else
        return;
      g.watch || n("update", l);
    },
    async removeItem(l, u = {}) {
      typeof u == "boolean" && (u = { removeMeta: u }), l = Te(l);
      const { relativeKey: h, driver: f } = r(l);
      f.removeItem && (await pe(f.removeItem, h, u), (u.removeMeta || u.removeMata) && await pe(f.removeItem, h + "$", u), f.watch || n("remove", l));
    },
    // Meta
    async getMeta(l, u = {}) {
      typeof u == "boolean" && (u = { nativeOnly: u }), l = Te(l);
      const { relativeKey: h, driver: f } = r(l), g = /* @__PURE__ */ Object.create(null);
      if (f.getMeta && Object.assign(g, await pe(f.getMeta, h, u)), !u.nativeOnly) {
        const p = await pe(
          f.getItem,
          h + "$",
          u
        ).then((y) => ln(y));
        p && typeof p == "object" && (typeof p.atime == "string" && (p.atime = new Date(p.atime)), typeof p.mtime == "string" && (p.mtime = new Date(p.mtime)), Object.assign(g, p));
      }
      return g;
    },
    setMeta(l, u, h = {}) {
      return this.setItem(l + "$", u, h);
    },
    removeMeta(l, u = {}) {
      return this.removeItem(l + "$", u);
    },
    // Keys
    async getKeys(l, u = {}) {
      l = un(l);
      const h = s(l, !0);
      let f = [];
      const g = [];
      let p = !0;
      for (const m of h) {
        m.driver.flags?.maxDepth || (p = !1);
        const E = await pe(
          m.driver.getKeys,
          m.relativeBase,
          u
        );
        for (const $ of E) {
          const b = m.mountpoint + Te($);
          f.some((v) => b.startsWith(v)) || g.push(b);
        }
        f = [
          m.mountpoint,
          ...f.filter(($) => !$.startsWith(m.mountpoint))
        ];
      }
      const y = u.maxDepth !== void 0 && !p;
      return g.filter(
        (m) => (!y || y_(m, u.maxDepth)) && w_(m, l)
      );
    },
    // Utils
    async clear(l, u = {}) {
      l = un(l), await Promise.all(
        s(l, !1).map(async (h) => {
          if (h.driver.clear)
            return pe(h.driver.clear, h.relativeBase, u);
          if (h.driver.removeItem) {
            const f = await h.driver.getKeys(h.relativeBase || "", u);
            return Promise.all(
              f.map((g) => h.driver.removeItem(g, u))
            );
          }
        })
      );
    },
    async dispose() {
      await Promise.all(
        Object.values(e.mounts).map((l) => tu(l))
      );
    },
    async watch(l) {
      return await i(), e.watchListeners.push(l), async () => {
        e.watchListeners = e.watchListeners.filter(
          (u) => u !== l
        ), e.watchListeners.length === 0 && await o();
      };
    },
    async unwatch() {
      e.watchListeners = [], await o();
    },
    // Mount
    mount(l, u) {
      if (l = un(l), l && e.mounts[l])
        throw new Error(`already mounted at ${l}`);
      return l && (e.mountpoints.push(l), e.mountpoints.sort((h, f) => f.length - h.length)), e.mounts[l] = u, e.watching && Promise.resolve(eu(u, n, l)).then((h) => {
        e.unwatch[l] = h;
      }).catch(console.error), c;
    },
    async unmount(l, u = !0) {
      l = un(l), !(!l || !e.mounts[l]) && (e.watching && l in e.unwatch && (e.unwatch[l]?.(), delete e.unwatch[l]), u && await tu(e.mounts[l]), e.mountpoints = e.mountpoints.filter((h) => h !== l), delete e.mounts[l]);
    },
    getMount(l = "") {
      l = Te(l) + ":";
      const u = r(l);
      return {
        driver: u.driver,
        base: u.base
      };
    },
    getMounts(l = "", u = {}) {
      return l = Te(l), s(l, u.parents).map((f) => ({
        driver: f.driver,
        base: f.mountpoint
      }));
    },
    // Aliases
    keys: (l, u = {}) => c.getKeys(l, u),
    get: (l, u = {}) => c.getItem(l, u),
    set: (l, u, h = {}) => c.setItem(l, u, h),
    has: (l, u = {}) => c.hasItem(l, u),
    del: (l, u = {}) => c.removeItem(l, u),
    remove: (l, u = {}) => c.removeItem(l, u)
  };
  return c;
}
function eu(t, e, r) {
  return t.watch ? t.watch((s, n) => e(s, r + n)) : () => {
  };
}
async function tu(t) {
  typeof t.dispose == "function" && await pe(t.dispose);
}
function Ur(t) {
  return new Promise((e, r) => {
    t.oncomplete = t.onsuccess = () => e(t.result), t.onabort = t.onerror = () => r(t.error);
  });
}
function pd(t, e) {
  const r = indexedDB.open(t);
  r.onupgradeneeded = () => r.result.createObjectStore(e);
  const s = Ur(r);
  return (n, i) => s.then((o) => i(o.transaction(e, n).objectStore(e)));
}
let ro;
function Ks() {
  return ro || (ro = pd("keyval-store", "keyval")), ro;
}
function ru(t, e = Ks()) {
  return e("readonly", (r) => Ur(r.get(t)));
}
function E_(t, e, r = Ks()) {
  return r("readwrite", (s) => (s.put(e, t), Ur(s.transaction)));
}
function x_(t, e = Ks()) {
  return e("readwrite", (r) => (r.delete(t), Ur(r.transaction)));
}
function __(t = Ks()) {
  return t("readwrite", (e) => (e.clear(), Ur(e.transaction)));
}
function S_(t, e) {
  return t.openCursor().onsuccess = function() {
    this.result && (e(this.result), this.result.continue());
  }, Ur(t.transaction);
}
function I_(t = Ks()) {
  return t("readonly", (e) => {
    if (e.getAllKeys)
      return Ur(e.getAllKeys());
    const r = [];
    return S_(e, (s) => r.push(s.key)).then(() => r);
  });
}
const D_ = "idb-keyval";
var A_ = (t = {}) => {
  const e = t.base && t.base.length > 0 ? `${t.base}:` : "", r = (n) => e + n;
  let s;
  return t.dbName && t.storeName && (s = pd(t.dbName, t.storeName)), { name: D_, options: t, async hasItem(n) {
    return !(typeof await ru(r(n), s) > "u");
  }, async getItem(n) {
    return await ru(r(n), s) ?? null;
  }, setItem(n, i) {
    return E_(r(n), i, s);
  }, removeItem(n) {
    return x_(r(n), s);
  }, getKeys() {
    return I_(s);
  }, clear() {
    return __(s);
  } };
};
const O_ = "WALLET_CONNECT_V2_INDEXED_DB", $_ = "keyvaluestorage";
let P_ = class {
  constructor() {
    this.indexedDb = v_({ driver: A_({ dbName: O_, storeName: $_ }) });
  }
  async getKeys() {
    return this.indexedDb.getKeys();
  }
  async getEntries() {
    return (await this.indexedDb.getItems(await this.indexedDb.getKeys())).map((e) => [e.key, e.value]);
  }
  async getItem(e) {
    const r = await this.indexedDb.getItem(e);
    if (r !== null) return r;
  }
  async setItem(e, r) {
    await this.indexedDb.setItem(e, Pr(r));
  }
  async removeItem(e) {
    await this.indexedDb.removeItem(e);
  }
};
var so = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : {}, bn = { exports: {} };
(function() {
  let t;
  function e() {
  }
  t = e, t.prototype.getItem = function(r) {
    return this.hasOwnProperty(r) ? String(this[r]) : null;
  }, t.prototype.setItem = function(r, s) {
    this[r] = String(s);
  }, t.prototype.removeItem = function(r) {
    delete this[r];
  }, t.prototype.clear = function() {
    const r = this;
    Object.keys(r).forEach(function(s) {
      r[s] = void 0, delete r[s];
    });
  }, t.prototype.key = function(r) {
    return r = r || 0, Object.keys(this)[r];
  }, t.prototype.__defineGetter__("length", function() {
    return Object.keys(this).length;
  }), typeof so < "u" && so.localStorage ? bn.exports = so.localStorage : typeof window < "u" && window.localStorage ? bn.exports = window.localStorage : bn.exports = new e();
})();
function T_(t) {
  var e;
  return [t[0], $r((e = t[1]) != null ? e : "")];
}
let B_ = class {
  constructor() {
    this.localStorage = bn.exports;
  }
  async getKeys() {
    return Object.keys(this.localStorage);
  }
  async getEntries() {
    return Object.entries(this.localStorage).map(T_);
  }
  async getItem(e) {
    const r = this.localStorage.getItem(e);
    if (r !== null) return $r(r);
  }
  async setItem(e, r) {
    this.localStorage.setItem(e, Pr(r));
  }
  async removeItem(e) {
    this.localStorage.removeItem(e);
  }
};
const R_ = "wc_storage_version", su = 1, C_ = async (t, e, r) => {
  const s = R_, n = await e.getItem(s);
  if (n && n >= su) {
    r(e);
    return;
  }
  const i = await t.getKeys();
  if (!i.length) {
    r(e);
    return;
  }
  const o = [];
  for (; i.length; ) {
    const a = i.shift();
    if (!a) continue;
    const c = a.toLowerCase();
    if (c.includes("wc@") || c.includes("walletconnect") || c.includes("wc_") || c.includes("wallet_connect")) {
      const l = await t.getItem(a);
      await e.setItem(a, l), o.push(a);
    }
  }
  await e.setItem(s, su), r(e), N_(t, o);
}, N_ = async (t, e) => {
  e.length && e.forEach(async (r) => {
    await t.removeItem(r);
  });
};
let U_ = class {
  constructor() {
    this.initialized = !1, this.setInitialized = (r) => {
      this.storage = r, this.initialized = !0;
    };
    const e = new B_();
    this.storage = e;
    try {
      const r = new P_();
      C_(e, r, this.setInitialized);
    } catch {
      this.initialized = !0;
    }
  }
  async getKeys() {
    return await this.initialize(), this.storage.getKeys();
  }
  async getEntries() {
    return await this.initialize(), this.storage.getEntries();
  }
  async getItem(e) {
    return await this.initialize(), this.storage.getItem(e);
  }
  async setItem(e, r) {
    return await this.initialize(), this.storage.setItem(e, r);
  }
  async removeItem(e) {
    return await this.initialize(), this.storage.removeItem(e);
  }
  async initialize() {
    this.initialized || await new Promise((e) => {
      const r = setInterval(() => {
        this.initialized && (clearInterval(r), e());
      }, 20);
    });
  }
}, L_ = class extends Cr {
  constructor(e) {
    super(), this.opts = e, this.protocol = "wc", this.version = 2;
  }
}, M_ = class extends Cr {
  constructor(e, r) {
    super(), this.core = e, this.logger = r, this.records = /* @__PURE__ */ new Map();
  }
};
class k_ {
  constructor(e, r) {
    this.logger = e, this.core = r;
  }
}
let q_ = class extends Cr {
  constructor(e, r) {
    super(), this.relayer = e, this.logger = r;
  }
}, F_ = class extends Cr {
  constructor(e) {
    super();
  }
}, j_ = class {
  constructor(e, r, s, n) {
    this.core = e, this.logger = r, this.name = s;
  }
}, z_ = class extends Cr {
  constructor(e, r) {
    super(), this.relayer = e, this.logger = r;
  }
}, H_ = class extends Cr {
  constructor(e, r) {
    super(), this.core = e, this.logger = r;
  }
}, K_ = class {
  constructor(e, r, s) {
    this.core = e, this.logger = r, this.store = s;
  }
}, V_ = class {
  constructor(e, r) {
    this.projectId = e, this.logger = r;
  }
};
class W_ {
  constructor(e, r, s) {
    this.core = e, this.logger = r, this.telemetryEnabled = s;
  }
}
let G_ = class {
  constructor(e) {
    this.opts = e, this.protocol = "wc", this.version = 2;
  }
}, Y_ = class {
  constructor(e) {
    this.client = e;
  }
};
const Z_ = "PARSE_ERROR", X_ = "INVALID_REQUEST", J_ = "METHOD_NOT_FOUND", Q_ = "INVALID_PARAMS", gd = "INTERNAL_ERROR", Ca = "SERVER_ERROR", eS = [-32700, -32600, -32601, -32602, -32603], vs = {
  [Z_]: { code: -32700, message: "Parse error" },
  [X_]: { code: -32600, message: "Invalid Request" },
  [J_]: { code: -32601, message: "Method not found" },
  [Q_]: { code: -32602, message: "Invalid params" },
  [gd]: { code: -32603, message: "Internal error" },
  [Ca]: { code: -32e3, message: "Server error" }
}, yd = Ca;
function tS(t) {
  return eS.includes(t);
}
function nu(t) {
  return Object.keys(vs).includes(t) ? vs[t] : vs[yd];
}
function rS(t) {
  const e = Object.values(vs).find((r) => r.code === t);
  return e || vs[yd];
}
function wd(t, e, r) {
  return t.message.includes("getaddrinfo ENOTFOUND") || t.message.includes("connect ECONNREFUSED") ? new Error(`Unavailable ${r} RPC url at ${e}`) : t;
}
var no = {};
/*! *****************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
var Vo = function(t, e) {
  return Vo = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(r, s) {
    r.__proto__ = s;
  } || function(r, s) {
    for (var n in s) s.hasOwnProperty(n) && (r[n] = s[n]);
  }, Vo(t, e);
};
function sS(t, e) {
  Vo(t, e);
  function r() {
    this.constructor = t;
  }
  t.prototype = e === null ? Object.create(e) : (r.prototype = e.prototype, new r());
}
var Wo = function() {
  return Wo = Object.assign || function(e) {
    for (var r, s = 1, n = arguments.length; s < n; s++) {
      r = arguments[s];
      for (var i in r) Object.prototype.hasOwnProperty.call(r, i) && (e[i] = r[i]);
    }
    return e;
  }, Wo.apply(this, arguments);
};
function nS(t, e) {
  var r = {};
  for (var s in t) Object.prototype.hasOwnProperty.call(t, s) && e.indexOf(s) < 0 && (r[s] = t[s]);
  if (t != null && typeof Object.getOwnPropertySymbols == "function")
    for (var n = 0, s = Object.getOwnPropertySymbols(t); n < s.length; n++)
      e.indexOf(s[n]) < 0 && Object.prototype.propertyIsEnumerable.call(t, s[n]) && (r[s[n]] = t[s[n]]);
  return r;
}
function iS(t, e, r, s) {
  var n = arguments.length, i = n < 3 ? e : s === null ? s = Object.getOwnPropertyDescriptor(e, r) : s, o;
  if (typeof Reflect == "object" && typeof Reflect.decorate == "function") i = Reflect.decorate(t, e, r, s);
  else for (var a = t.length - 1; a >= 0; a--) (o = t[a]) && (i = (n < 3 ? o(i) : n > 3 ? o(e, r, i) : o(e, r)) || i);
  return n > 3 && i && Object.defineProperty(e, r, i), i;
}
function oS(t, e) {
  return function(r, s) {
    e(r, s, t);
  };
}
function aS(t, e) {
  if (typeof Reflect == "object" && typeof Reflect.metadata == "function") return Reflect.metadata(t, e);
}
function cS(t, e, r, s) {
  function n(i) {
    return i instanceof r ? i : new r(function(o) {
      o(i);
    });
  }
  return new (r || (r = Promise))(function(i, o) {
    function a(u) {
      try {
        l(s.next(u));
      } catch (h) {
        o(h);
      }
    }
    function c(u) {
      try {
        l(s.throw(u));
      } catch (h) {
        o(h);
      }
    }
    function l(u) {
      u.done ? i(u.value) : n(u.value).then(a, c);
    }
    l((s = s.apply(t, e || [])).next());
  });
}
function lS(t, e) {
  var r = { label: 0, sent: function() {
    if (i[0] & 1) throw i[1];
    return i[1];
  }, trys: [], ops: [] }, s, n, i, o;
  return o = { next: a(0), throw: a(1), return: a(2) }, typeof Symbol == "function" && (o[Symbol.iterator] = function() {
    return this;
  }), o;
  function a(l) {
    return function(u) {
      return c([l, u]);
    };
  }
  function c(l) {
    if (s) throw new TypeError("Generator is already executing.");
    for (; r; ) try {
      if (s = 1, n && (i = l[0] & 2 ? n.return : l[0] ? n.throw || ((i = n.return) && i.call(n), 0) : n.next) && !(i = i.call(n, l[1])).done) return i;
      switch (n = 0, i && (l = [l[0] & 2, i.value]), l[0]) {
        case 0:
        case 1:
          i = l;
          break;
        case 4:
          return r.label++, { value: l[1], done: !1 };
        case 5:
          r.label++, n = l[1], l = [0];
          continue;
        case 7:
          l = r.ops.pop(), r.trys.pop();
          continue;
        default:
          if (i = r.trys, !(i = i.length > 0 && i[i.length - 1]) && (l[0] === 6 || l[0] === 2)) {
            r = 0;
            continue;
          }
          if (l[0] === 3 && (!i || l[1] > i[0] && l[1] < i[3])) {
            r.label = l[1];
            break;
          }
          if (l[0] === 6 && r.label < i[1]) {
            r.label = i[1], i = l;
            break;
          }
          if (i && r.label < i[2]) {
            r.label = i[2], r.ops.push(l);
            break;
          }
          i[2] && r.ops.pop(), r.trys.pop();
          continue;
      }
      l = e.call(t, r);
    } catch (u) {
      l = [6, u], n = 0;
    } finally {
      s = i = 0;
    }
    if (l[0] & 5) throw l[1];
    return { value: l[0] ? l[1] : void 0, done: !0 };
  }
}
function uS(t, e, r, s) {
  s === void 0 && (s = r), t[s] = e[r];
}
function hS(t, e) {
  for (var r in t) r !== "default" && !e.hasOwnProperty(r) && (e[r] = t[r]);
}
function Go(t) {
  var e = typeof Symbol == "function" && Symbol.iterator, r = e && t[e], s = 0;
  if (r) return r.call(t);
  if (t && typeof t.length == "number") return {
    next: function() {
      return t && s >= t.length && (t = void 0), { value: t && t[s++], done: !t };
    }
  };
  throw new TypeError(e ? "Object is not iterable." : "Symbol.iterator is not defined.");
}
function md(t, e) {
  var r = typeof Symbol == "function" && t[Symbol.iterator];
  if (!r) return t;
  var s = r.call(t), n, i = [], o;
  try {
    for (; (e === void 0 || e-- > 0) && !(n = s.next()).done; ) i.push(n.value);
  } catch (a) {
    o = { error: a };
  } finally {
    try {
      n && !n.done && (r = s.return) && r.call(s);
    } finally {
      if (o) throw o.error;
    }
  }
  return i;
}
function fS() {
  for (var t = [], e = 0; e < arguments.length; e++)
    t = t.concat(md(arguments[e]));
  return t;
}
function dS() {
  for (var t = 0, e = 0, r = arguments.length; e < r; e++) t += arguments[e].length;
  for (var s = Array(t), n = 0, e = 0; e < r; e++)
    for (var i = arguments[e], o = 0, a = i.length; o < a; o++, n++)
      s[n] = i[o];
  return s;
}
function Ts(t) {
  return this instanceof Ts ? (this.v = t, this) : new Ts(t);
}
function pS(t, e, r) {
  if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
  var s = r.apply(t, e || []), n, i = [];
  return n = {}, o("next"), o("throw"), o("return"), n[Symbol.asyncIterator] = function() {
    return this;
  }, n;
  function o(f) {
    s[f] && (n[f] = function(g) {
      return new Promise(function(p, y) {
        i.push([f, g, p, y]) > 1 || a(f, g);
      });
    });
  }
  function a(f, g) {
    try {
      c(s[f](g));
    } catch (p) {
      h(i[0][3], p);
    }
  }
  function c(f) {
    f.value instanceof Ts ? Promise.resolve(f.value.v).then(l, u) : h(i[0][2], f);
  }
  function l(f) {
    a("next", f);
  }
  function u(f) {
    a("throw", f);
  }
  function h(f, g) {
    f(g), i.shift(), i.length && a(i[0][0], i[0][1]);
  }
}
function gS(t) {
  var e, r;
  return e = {}, s("next"), s("throw", function(n) {
    throw n;
  }), s("return"), e[Symbol.iterator] = function() {
    return this;
  }, e;
  function s(n, i) {
    e[n] = t[n] ? function(o) {
      return (r = !r) ? { value: Ts(t[n](o)), done: n === "return" } : i ? i(o) : o;
    } : i;
  }
}
function yS(t) {
  if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
  var e = t[Symbol.asyncIterator], r;
  return e ? e.call(t) : (t = typeof Go == "function" ? Go(t) : t[Symbol.iterator](), r = {}, s("next"), s("throw"), s("return"), r[Symbol.asyncIterator] = function() {
    return this;
  }, r);
  function s(i) {
    r[i] = t[i] && function(o) {
      return new Promise(function(a, c) {
        o = t[i](o), n(a, c, o.done, o.value);
      });
    };
  }
  function n(i, o, a, c) {
    Promise.resolve(c).then(function(l) {
      i({ value: l, done: a });
    }, o);
  }
}
function wS(t, e) {
  return Object.defineProperty ? Object.defineProperty(t, "raw", { value: e }) : t.raw = e, t;
}
function mS(t) {
  if (t && t.__esModule) return t;
  var e = {};
  if (t != null) for (var r in t) Object.hasOwnProperty.call(t, r) && (e[r] = t[r]);
  return e.default = t, e;
}
function bS(t) {
  return t && t.__esModule ? t : { default: t };
}
function vS(t, e) {
  if (!e.has(t))
    throw new TypeError("attempted to get private field on non-instance");
  return e.get(t);
}
function ES(t, e, r) {
  if (!e.has(t))
    throw new TypeError("attempted to set private field on non-instance");
  return e.set(t, r), r;
}
const xS = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  get __assign() {
    return Wo;
  },
  __asyncDelegator: gS,
  __asyncGenerator: pS,
  __asyncValues: yS,
  __await: Ts,
  __awaiter: cS,
  __classPrivateFieldGet: vS,
  __classPrivateFieldSet: ES,
  __createBinding: uS,
  __decorate: iS,
  __exportStar: hS,
  __extends: sS,
  __generator: lS,
  __importDefault: bS,
  __importStar: mS,
  __makeTemplateObject: wS,
  __metadata: aS,
  __param: oS,
  __read: md,
  __rest: nS,
  __spread: fS,
  __spreadArrays: dS,
  __values: Go
}, Symbol.toStringTag, { value: "Module" })), _S = /* @__PURE__ */ Nu(xS);
var $t = {}, iu;
function SS() {
  if (iu) return $t;
  iu = 1, Object.defineProperty($t, "__esModule", { value: !0 }), $t.isBrowserCryptoAvailable = $t.getSubtleCrypto = $t.getBrowerCrypto = void 0;
  function t() {
    return yt?.crypto || yt?.msCrypto || {};
  }
  $t.getBrowerCrypto = t;
  function e() {
    const s = t();
    return s.subtle || s.webkitSubtle;
  }
  $t.getSubtleCrypto = e;
  function r() {
    return !!t() && !!e();
  }
  return $t.isBrowserCryptoAvailable = r, $t;
}
var Pt = {}, ou;
function IS() {
  if (ou) return Pt;
  ou = 1, Object.defineProperty(Pt, "__esModule", { value: !0 }), Pt.isBrowser = Pt.isNode = Pt.isReactNative = void 0;
  function t() {
    return typeof document > "u" && typeof navigator < "u" && navigator.product === "ReactNative";
  }
  Pt.isReactNative = t;
  function e() {
    return typeof process < "u" && typeof process.versions < "u" && typeof process.versions.node < "u";
  }
  Pt.isNode = e;
  function r() {
    return !t() && !e();
  }
  return Pt.isBrowser = r, Pt;
}
var au;
function DS() {
  return au || (au = 1, (function(t) {
    Object.defineProperty(t, "__esModule", { value: !0 });
    const e = _S;
    e.__exportStar(SS(), t), e.__exportStar(IS(), t);
  })(no)), no;
}
var AS = DS();
function pt(t = 3) {
  const e = Date.now() * Math.pow(10, t), r = Math.floor(Math.random() * Math.pow(10, t));
  return e + r;
}
function nr(t = 6) {
  return BigInt(pt(t));
}
function ot(t, e, r) {
  return {
    id: r || pt(),
    jsonrpc: "2.0",
    method: t,
    params: e
  };
}
function Bs(t, e) {
  return {
    id: t,
    jsonrpc: "2.0",
    result: e
  };
}
function ci(t, e, r) {
  return {
    id: t,
    jsonrpc: "2.0",
    error: OS(e)
  };
}
function OS(t, e) {
  return typeof t > "u" ? nu(gd) : (typeof t == "string" && (t = Object.assign(Object.assign({}, nu(Ca)), { message: t })), tS(t.code) && (t = rS(t.code)), t);
}
class $S {
}
class PS extends $S {
  constructor() {
    super();
  }
}
class TS extends PS {
  constructor(e) {
    super();
  }
}
const BS = "^https?:", RS = "^wss?:";
function CS(t) {
  const e = t.match(new RegExp(/^\w+:/, "gi"));
  if (!(!e || !e.length))
    return e[0];
}
function bd(t, e) {
  const r = CS(t);
  return typeof r > "u" ? !1 : new RegExp(e).test(r);
}
function cu(t) {
  return bd(t, BS);
}
function lu(t) {
  return bd(t, RS);
}
function NS(t) {
  return new RegExp("wss?://localhost(:d{2,5})?").test(t);
}
function vd(t) {
  return typeof t == "object" && "id" in t && "jsonrpc" in t && t.jsonrpc === "2.0";
}
function Na(t) {
  return vd(t) && "method" in t;
}
function li(t) {
  return vd(t) && (gt(t) || Ye(t));
}
function gt(t) {
  return "result" in t;
}
function Ye(t) {
  return "error" in t;
}
let Ua = class extends TS {
  constructor(e) {
    super(e), this.events = new je.EventEmitter(), this.hasRegisteredEventListeners = !1, this.connection = this.setConnection(e), this.connection.connected && this.registerEventListeners();
  }
  async connect(e = this.connection) {
    await this.open(e);
  }
  async disconnect() {
    await this.close();
  }
  on(e, r) {
    this.events.on(e, r);
  }
  once(e, r) {
    this.events.once(e, r);
  }
  off(e, r) {
    this.events.off(e, r);
  }
  removeListener(e, r) {
    this.events.removeListener(e, r);
  }
  async request(e, r) {
    return this.requestStrict(ot(e.method, e.params || [], e.id || nr().toString()), r);
  }
  async requestStrict(e, r) {
    return new Promise(async (s, n) => {
      if (!this.connection.connected) try {
        await this.open();
      } catch (i) {
        n(i);
      }
      this.events.on(`${e.id}`, (i) => {
        Ye(i) ? n(i.error) : s(i.result);
      });
      try {
        await this.connection.send(e, r);
      } catch (i) {
        n(i);
      }
    });
  }
  setConnection(e = this.connection) {
    return e;
  }
  onPayload(e) {
    this.events.emit("payload", e), li(e) ? this.events.emit(`${e.id}`, e) : this.events.emit("message", { type: e.method, data: e.params });
  }
  onClose(e) {
    e && e.code === 3e3 && this.events.emit("error", new Error(`WebSocket connection closed abnormally with code: ${e.code} ${e.reason ? `(${e.reason})` : ""}`)), this.events.emit("disconnect");
  }
  async open(e = this.connection) {
    this.connection === e && this.connection.connected || (this.connection.connected && this.close(), typeof e == "string" && (await this.connection.open(e), e = this.connection), this.connection = this.setConnection(e), await this.connection.open(), this.registerEventListeners(), this.events.emit("connect"));
  }
  async close() {
    await this.connection.close();
  }
  registerEventListeners() {
    this.hasRegisteredEventListeners || (this.connection.on("payload", (e) => this.onPayload(e)), this.connection.on("close", (e) => this.onClose(e)), this.connection.on("error", (e) => this.events.emit("error", e)), this.connection.on("register_error", (e) => this.onClose()), this.hasRegisteredEventListeners = !0);
  }
};
const US = () => typeof WebSocket < "u" ? WebSocket : typeof global < "u" && typeof global.WebSocket < "u" ? global.WebSocket : typeof window < "u" && typeof window.WebSocket < "u" ? window.WebSocket : typeof self < "u" && typeof self.WebSocket < "u" ? self.WebSocket : require("ws"), LS = () => typeof WebSocket < "u" || typeof global < "u" && typeof global.WebSocket < "u" || typeof window < "u" && typeof window.WebSocket < "u" || typeof self < "u" && typeof self.WebSocket < "u", uu = (t) => t.split("?")[0], hu = 10, MS = US();
let kS = class {
  constructor(e) {
    if (this.url = e, this.events = new je.EventEmitter(), this.registering = !1, !lu(e)) throw new Error(`Provided URL is not compatible with WebSocket connection: ${e}`);
    this.url = e;
  }
  get connected() {
    return typeof this.socket < "u";
  }
  get connecting() {
    return this.registering;
  }
  on(e, r) {
    this.events.on(e, r);
  }
  once(e, r) {
    this.events.once(e, r);
  }
  off(e, r) {
    this.events.off(e, r);
  }
  removeListener(e, r) {
    this.events.removeListener(e, r);
  }
  async open(e = this.url) {
    await this.register(e);
  }
  async close() {
    return new Promise((e, r) => {
      if (typeof this.socket > "u") {
        r(new Error("Connection already closed"));
        return;
      }
      this.socket.onclose = (s) => {
        this.onClose(s), e();
      }, this.socket.close();
    });
  }
  async send(e) {
    typeof this.socket > "u" && (this.socket = await this.register());
    try {
      this.socket.send(Pr(e));
    } catch (r) {
      this.onError(e.id, r);
    }
  }
  register(e = this.url) {
    if (!lu(e)) throw new Error(`Provided URL is not compatible with WebSocket connection: ${e}`);
    if (this.registering) {
      const r = this.events.getMaxListeners();
      return (this.events.listenerCount("register_error") >= r || this.events.listenerCount("open") >= r) && this.events.setMaxListeners(r + 1), new Promise((s, n) => {
        this.events.once("register_error", (i) => {
          this.resetMaxListeners(), n(i);
        }), this.events.once("open", () => {
          if (this.resetMaxListeners(), typeof this.socket > "u") return n(new Error("WebSocket connection is missing or invalid"));
          s(this.socket);
        });
      });
    }
    return this.url = e, this.registering = !0, new Promise((r, s) => {
      const n = AS.isReactNative() ? void 0 : { rejectUnauthorized: !NS(e) }, i = new MS(e, [], n);
      LS() ? i.onerror = (o) => {
        const a = o;
        s(this.emitError(a.error));
      } : i.on("error", (o) => {
        s(this.emitError(o));
      }), i.onopen = () => {
        this.onOpen(i), r(i);
      };
    });
  }
  onOpen(e) {
    e.onmessage = (r) => this.onPayload(r), e.onclose = (r) => this.onClose(r), this.socket = e, this.registering = !1, this.events.emit("open");
  }
  onClose(e) {
    this.socket = void 0, this.registering = !1, this.events.emit("close", e);
  }
  onPayload(e) {
    if (typeof e.data > "u") return;
    const r = typeof e.data == "string" ? $r(e.data) : e.data;
    this.events.emit("payload", r);
  }
  onError(e, r) {
    const s = this.parseError(r), n = s.message || s.toString(), i = ci(e, n);
    this.events.emit("payload", i);
  }
  parseError(e, r = this.url) {
    return wd(e, uu(r), "WS");
  }
  resetMaxListeners() {
    this.events.getMaxListeners() > hu && this.events.setMaxListeners(hu);
  }
  emitError(e) {
    const r = this.parseError(new Error(e?.message || `WebSocket connection failed for host: ${uu(this.url)}`));
    return this.events.emit("register_error", r), r;
  }
};
function qS(t) {
  return Number.isSafeInteger(t) && t >= 0;
}
function FS(t) {
  return t != null && typeof t != "function" && qS(t.length);
}
function jS(t) {
  return t === "__proto__";
}
function La(t) {
  return t == null || typeof t != "object" && typeof t != "function";
}
function zS(t, e) {
  return t === e || Number.isNaN(t) && Number.isNaN(e);
}
function jn(t) {
  return Object.getOwnPropertySymbols(t).filter((e) => Object.prototype.propertyIsEnumerable.call(t, e));
}
function Rs(t) {
  return t == null ? t === void 0 ? "[object Undefined]" : "[object Null]" : Object.prototype.toString.call(t);
}
const Ed = "[object RegExp]", Ma = "[object String]", ka = "[object Number]", qa = "[object Boolean]", zn = "[object Arguments]", xd = "[object Symbol]", _d = "[object Date]", Sd = "[object Map]", Id = "[object Set]", Dd = "[object Array]", HS = "[object Function]", Ad = "[object ArrayBuffer]", Es = "[object Object]", KS = "[object Error]", Od = "[object DataView]", $d = "[object Uint8Array]", Pd = "[object Uint8ClampedArray]", Td = "[object Uint16Array]", Bd = "[object Uint32Array]", VS = "[object BigUint64Array]", Rd = "[object Int8Array]", Cd = "[object Int16Array]", Nd = "[object Int32Array]", WS = "[object BigInt64Array]", Ud = "[object Float32Array]", Ld = "[object Float64Array]";
function Fa(t) {
  return ArrayBuffer.isView(t) && !(t instanceof DataView);
}
function GS(t, e) {
  return Vr(t, void 0, t, /* @__PURE__ */ new Map(), e);
}
function Vr(t, e, r, s = /* @__PURE__ */ new Map(), n = void 0) {
  const i = n?.(t, e, r, s);
  if (i !== void 0)
    return i;
  if (La(t))
    return t;
  if (s.has(t))
    return s.get(t);
  if (Array.isArray(t)) {
    const o = new Array(t.length);
    s.set(t, o);
    for (let a = 0; a < t.length; a++)
      o[a] = Vr(t[a], a, r, s, n);
    return Object.hasOwn(t, "index") && (o.index = t.index), Object.hasOwn(t, "input") && (o.input = t.input), o;
  }
  if (t instanceof Date)
    return new Date(t.getTime());
  if (t instanceof RegExp) {
    const o = new RegExp(t.source, t.flags);
    return o.lastIndex = t.lastIndex, o;
  }
  if (t instanceof Map) {
    const o = /* @__PURE__ */ new Map();
    s.set(t, o);
    for (const [a, c] of t)
      o.set(a, Vr(c, a, r, s, n));
    return o;
  }
  if (t instanceof Set) {
    const o = /* @__PURE__ */ new Set();
    s.set(t, o);
    for (const a of t)
      o.add(Vr(a, void 0, r, s, n));
    return o;
  }
  if (typeof Buffer < "u" && Buffer.isBuffer(t))
    return t.subarray();
  if (Fa(t)) {
    const o = new (Object.getPrototypeOf(t)).constructor(t.length);
    s.set(t, o);
    for (let a = 0; a < t.length; a++)
      o[a] = Vr(t[a], a, r, s, n);
    return o;
  }
  if (t instanceof ArrayBuffer || typeof SharedArrayBuffer < "u" && t instanceof SharedArrayBuffer)
    return t.slice(0);
  if (t instanceof DataView) {
    const o = new DataView(t.buffer.slice(0), t.byteOffset, t.byteLength);
    return s.set(t, o), it(o, t, r, s, n), o;
  }
  if (typeof File < "u" && t instanceof File) {
    const o = new File([t], t.name, {
      type: t.type
    });
    return s.set(t, o), it(o, t, r, s, n), o;
  }
  if (typeof Blob < "u" && t instanceof Blob) {
    const o = new Blob([t], { type: t.type });
    return s.set(t, o), it(o, t, r, s, n), o;
  }
  if (t instanceof Error) {
    const o = structuredClone(t);
    return s.set(t, o), o.message = t.message, o.name = t.name, o.stack = t.stack, o.cause = t.cause, o.constructor = t.constructor, it(o, t, r, s, n), o;
  }
  if (t instanceof Boolean) {
    const o = new Boolean(t.valueOf());
    return s.set(t, o), it(o, t, r, s, n), o;
  }
  if (t instanceof Number) {
    const o = new Number(t.valueOf());
    return s.set(t, o), it(o, t, r, s, n), o;
  }
  if (t instanceof String) {
    const o = new String(t.valueOf());
    return s.set(t, o), it(o, t, r, s, n), o;
  }
  if (typeof t == "object" && YS(t)) {
    const o = Object.create(Object.getPrototypeOf(t));
    return s.set(t, o), it(o, t, r, s, n), o;
  }
  return t;
}
function it(t, e, r = t, s, n) {
  const i = [...Object.keys(e), ...jn(e)];
  for (let o = 0; o < i.length; o++) {
    const a = i[o], c = Object.getOwnPropertyDescriptor(t, a);
    (c == null || c.writable) && (t[a] = Vr(e[a], a, r, s, n));
  }
}
function YS(t) {
  switch (Rs(t)) {
    case zn:
    case Dd:
    case Ad:
    case Od:
    case qa:
    case _d:
    case Ud:
    case Ld:
    case Rd:
    case Cd:
    case Nd:
    case Sd:
    case ka:
    case Es:
    case Ed:
    case Id:
    case Ma:
    case xd:
    case $d:
    case Pd:
    case Td:
    case Bd:
      return !0;
    default:
      return !1;
  }
}
function ZS(t, e) {
  return GS(t, (r, s, n, i) => {
    if (typeof t == "object") {
      if (Rs(t) === Es && typeof t.constructor != "function") {
        const o = {};
        return i.set(t, o), it(o, t, n, i), o;
      }
      switch (Object.prototype.toString.call(t)) {
        case ka:
        case Ma:
        case qa: {
          const o = new t.constructor(t?.valueOf());
          return it(o, t), o;
        }
        case zn: {
          const o = {};
          return it(o, t), o.length = t.length, o[Symbol.iterator] = t[Symbol.iterator], o;
        }
        default:
          return;
      }
    }
  });
}
function fu(t) {
  return ZS(t);
}
function du(t) {
  return t !== null && typeof t == "object" && Rs(t) === "[object Arguments]";
}
function Yo(t) {
  return typeof t == "object" && t !== null;
}
function XS(t) {
  return Yo(t) && FS(t);
}
function pu(t) {
  if (!t || typeof t != "object")
    return !1;
  const e = Object.getPrototypeOf(t);
  return e === null || e === Object.prototype || Object.getPrototypeOf(e) === null ? Object.prototype.toString.call(t) === "[object Object]" : !1;
}
function JS(t, e, r) {
  return ws(t, e, void 0, void 0, void 0, void 0, r);
}
function ws(t, e, r, s, n, i, o) {
  const a = o(t, e, r, s, n, i);
  if (a !== void 0)
    return a;
  if (typeof t == typeof e)
    switch (typeof t) {
      case "bigint":
      case "string":
      case "boolean":
      case "symbol":
      case "undefined":
        return t === e;
      case "number":
        return t === e || Object.is(t, e);
      case "function":
        return t === e;
      case "object":
        return xs(t, e, i, o);
    }
  return xs(t, e, i, o);
}
function xs(t, e, r, s) {
  if (Object.is(t, e))
    return !0;
  let n = Rs(t), i = Rs(e);
  if (n === zn && (n = Es), i === zn && (i = Es), n !== i)
    return !1;
  switch (n) {
    case Ma:
      return t.toString() === e.toString();
    case ka: {
      const c = t.valueOf(), l = e.valueOf();
      return zS(c, l);
    }
    case qa:
    case _d:
    case xd:
      return Object.is(t.valueOf(), e.valueOf());
    case Ed:
      return t.source === e.source && t.flags === e.flags;
    case HS:
      return t === e;
  }
  r = r ?? /* @__PURE__ */ new Map();
  const o = r.get(t), a = r.get(e);
  if (o != null && a != null)
    return o === e;
  r.set(t, e), r.set(e, t);
  try {
    switch (n) {
      case Sd: {
        if (t.size !== e.size)
          return !1;
        for (const [c, l] of t.entries())
          if (!e.has(c) || !ws(l, e.get(c), c, t, e, r, s))
            return !1;
        return !0;
      }
      case Id: {
        if (t.size !== e.size)
          return !1;
        const c = Array.from(t.values()), l = Array.from(e.values());
        for (let u = 0; u < c.length; u++) {
          const h = c[u], f = l.findIndex((g) => ws(h, g, void 0, t, e, r, s));
          if (f === -1)
            return !1;
          l.splice(f, 1);
        }
        return !0;
      }
      case Dd:
      case $d:
      case Pd:
      case Td:
      case Bd:
      case VS:
      case Rd:
      case Cd:
      case Nd:
      case WS:
      case Ud:
      case Ld: {
        if (typeof Buffer < "u" && Buffer.isBuffer(t) !== Buffer.isBuffer(e) || t.length !== e.length)
          return !1;
        for (let c = 0; c < t.length; c++)
          if (!ws(t[c], e[c], c, t, e, r, s))
            return !1;
        return !0;
      }
      case Ad:
        return t.byteLength !== e.byteLength ? !1 : xs(new Uint8Array(t), new Uint8Array(e), r, s);
      case Od:
        return t.byteLength !== e.byteLength || t.byteOffset !== e.byteOffset ? !1 : xs(new Uint8Array(t), new Uint8Array(e), r, s);
      case KS:
        return t.name === e.name && t.message === e.message;
      case Es: {
        if (!(xs(t.constructor, e.constructor, r, s) || pu(t) && pu(e)))
          return !1;
        const l = [...Object.keys(t), ...jn(t)], u = [...Object.keys(e), ...jn(e)];
        if (l.length !== u.length)
          return !1;
        for (let h = 0; h < l.length; h++) {
          const f = l[h], g = t[f];
          if (!Object.hasOwn(e, f))
            return !1;
          const p = e[f];
          if (!ws(g, p, f, t, e, r, s))
            return !1;
        }
        return !0;
      }
      default:
        return !1;
    }
  } finally {
    r.delete(t), r.delete(e);
  }
}
function Md() {
}
function QS(t, e) {
  return JS(t, e, Md);
}
function io(t) {
  return Fa(t);
}
function oo(t) {
  if (typeof t != "object" || t == null)
    return !1;
  if (Object.getPrototypeOf(t) === null)
    return !0;
  if (Object.prototype.toString.call(t) !== "[object Object]") {
    const r = t[Symbol.toStringTag];
    return r == null || !Object.getOwnPropertyDescriptor(t, Symbol.toStringTag)?.writable ? !1 : t.toString() === `[object ${r}]`;
  }
  let e = t;
  for (; Object.getPrototypeOf(e) !== null; )
    e = Object.getPrototypeOf(e);
  return Object.getPrototypeOf(t) === e;
}
function eI(t) {
  if (La(t))
    return t;
  if (Array.isArray(t) || Fa(t) || t instanceof ArrayBuffer || typeof SharedArrayBuffer < "u" && t instanceof SharedArrayBuffer)
    return t.slice(0);
  const e = Object.getPrototypeOf(t);
  if (e == null)
    return Object.assign(Object.create(e), t);
  const r = e.constructor;
  if (t instanceof Date || t instanceof Map || t instanceof Set)
    return new r(t);
  if (t instanceof RegExp) {
    const s = new r(t);
    return s.lastIndex = t.lastIndex, s;
  }
  if (t instanceof DataView)
    return new r(t.buffer.slice(0));
  if (t instanceof Error) {
    let s;
    return t instanceof AggregateError ? s = new r(t.errors, t.message, { cause: t.cause }) : s = new r(t.message, { cause: t.cause }), s.stack = t.stack, Object.assign(s, t), s;
  }
  if (typeof File < "u" && t instanceof File)
    return new r([t], t.name, { type: t.type, lastModified: t.lastModified });
  if (typeof t == "object") {
    const s = Object.create(e);
    return Object.assign(s, t);
  }
  return t;
}
function tI(t, ...e) {
  const r = e.slice(0, -1), s = e[e.length - 1];
  let n = t;
  for (let i = 0; i < r.length; i++) {
    const o = r[i];
    n = vn(n, o, s, /* @__PURE__ */ new Map());
  }
  return n;
}
function vn(t, e, r, s) {
  if (La(t) && (t = Object(t)), e == null || typeof e != "object")
    return t;
  if (s.has(e))
    return eI(s.get(e));
  if (s.set(e, t), Array.isArray(e)) {
    e = e.slice();
    for (let i = 0; i < e.length; i++)
      e[i] = e[i] ?? void 0;
  }
  const n = [...Object.keys(e), ...jn(e)];
  for (let i = 0; i < n.length; i++) {
    const o = n[i];
    if (jS(o))
      continue;
    let a = e[o], c = t[o];
    if (du(a) && (a = { ...a }), du(c) && (c = { ...c }), typeof Buffer < "u" && Buffer.isBuffer(a) && (a = fu(a)), Array.isArray(a))
      if (Array.isArray(c)) {
        const u = [], h = Reflect.ownKeys(c);
        for (let f = 0; f < h.length; f++) {
          const g = h[f];
          u[g] = c[g];
        }
        c = u;
      } else if (XS(c)) {
        const u = [];
        for (let h = 0; h < c.length; h++)
          u[h] = c[h];
        c = u;
      } else
        c = [];
    const l = r(c, a, o, t, e, s);
    l !== void 0 ? t[o] = l : Array.isArray(a) || Yo(c) && Yo(a) && (oo(c) || oo(a) || io(c) || io(a)) ? t[o] = vn(c, a, r, s) : c == null && oo(a) ? t[o] = vn({}, a, r, s) : c == null && io(a) ? t[o] = fu(a) : (c === void 0 || a !== void 0) && (t[o] = a);
  }
  return t;
}
function rI(t, ...e) {
  return tI(t, ...e, Md);
}
const kd = "wc", qd = 2, Zo = "core", _t = `${kd}@2:${Zo}:`, sI = { logger: "error" }, nI = { database: ":memory:" }, iI = "crypto", gu = "client_ed25519_seed", oI = F.ONE_DAY, aI = "keychain", cI = "0.3", lI = "messages", uI = "0.3", hI = F.SIX_HOURS, fI = "publisher", Fd = "irn", dI = "error", jd = "wss://relay.walletconnect.org", pI = "relayer", se = { message: "relayer_message", message_ack: "relayer_message_ack", connect: "relayer_connect", disconnect: "relayer_disconnect", error: "relayer_error", connection_stalled: "relayer_connection_stalled", transport_closed: "relayer_transport_closed", publish: "relayer_publish" }, gI = "_subscription", Ke = { payload: "payload", connect: "connect", disconnect: "disconnect", error: "error" }, yI = 0.1, Xo = "2.26.0", te = { link_mode: "link_mode", relay: "relay" }, En = { inbound: "inbound", outbound: "outbound" }, wI = "0.3", mI = "WALLETCONNECT_CLIENT_ID", yu = "WALLETCONNECT_LINK_MODE_APPS", Me = { created: "subscription_created", deleted: "subscription_deleted", expired: "subscription_expired", disabled: "subscription_disabled", sync: "subscription_sync", resubscribed: "subscription_resubscribed" }, bI = "subscription", vI = "0.3", EI = "pairing", xI = "0.3", ds = { wc_pairingDelete: { req: { ttl: F.ONE_DAY, prompt: !1, tag: 1e3 }, res: { ttl: F.ONE_DAY, prompt: !1, tag: 1001 } }, wc_pairingPing: { req: { ttl: F.THIRTY_SECONDS, prompt: !1, tag: 1002 }, res: { ttl: F.THIRTY_SECONDS, prompt: !1, tag: 1003 } }, unregistered_method: { req: { ttl: F.ONE_DAY, prompt: !1, tag: 0 }, res: { ttl: F.ONE_DAY, prompt: !1, tag: 0 } } }, vr = { create: "pairing_create", expire: "pairing_expire", delete: "pairing_delete", ping: "pairing_ping" }, tt = { created: "history_created", updated: "history_updated", deleted: "history_deleted", sync: "history_sync" }, _I = "history", SI = "0.3", II = "expirer", Ve = { created: "expirer_created", deleted: "expirer_deleted", expired: "expirer_expired", sync: "expirer_sync" }, DI = "0.3", AI = "verify-api", OI = "https://verify.walletconnect.com", zd = "https://verify.walletconnect.org", _s = zd, $I = `${_s}/v3`, PI = [OI, zd], TI = "echo", BI = "https://echo.walletconnect.com", dt = { pairing_started: "pairing_started", pairing_uri_validation_success: "pairing_uri_validation_success", pairing_uri_not_expired: "pairing_uri_not_expired", store_new_pairing: "store_new_pairing", subscribing_pairing_topic: "subscribing_pairing_topic", subscribe_pairing_topic_success: "subscribe_pairing_topic_success", existing_pairing: "existing_pairing", pairing_not_expired: "pairing_not_expired", emit_inactive_pairing: "emit_inactive_pairing", emit_session_proposal: "emit_session_proposal", subscribing_to_pairing_topic: "subscribing_to_pairing_topic" }, Bt = { no_wss_connection: "no_wss_connection", no_internet_connection: "no_internet_connection", malformed_pairing_uri: "malformed_pairing_uri", active_pairing_already_exists: "active_pairing_already_exists", subscribe_pairing_topic_failure: "subscribe_pairing_topic_failure", pairing_expired: "pairing_expired", proposal_expired: "proposal_expired", proposal_listener_not_found: "proposal_listener_not_found" }, rt = { session_approve_started: "session_approve_started", proposal_not_expired: "proposal_not_expired", session_namespaces_validation_success: "session_namespaces_validation_success", create_session_topic: "create_session_topic", subscribing_session_topic: "subscribing_session_topic", subscribe_session_topic_success: "subscribe_session_topic_success", publishing_session_approve: "publishing_session_approve", session_approve_publish_success: "session_approve_publish_success", store_session: "store_session", publishing_session_settle: "publishing_session_settle", session_settle_publish_success: "session_settle_publish_success", session_request_response_started: "session_request_response_started", session_request_response_validation_success: "session_request_response_validation_success", session_request_response_publish_started: "session_request_response_publish_started" }, yr = { no_internet_connection: "no_internet_connection", no_wss_connection: "no_wss_connection", proposal_expired: "proposal_expired", subscribe_session_topic_failure: "subscribe_session_topic_failure", session_approve_publish_failure: "session_approve_publish_failure", session_settle_publish_failure: "session_settle_publish_failure", session_approve_namespace_validation_failure: "session_approve_namespace_validation_failure", proposal_not_found: "proposal_not_found", session_request_response_validation_failure: "session_request_response_validation_failure", session_request_response_publish_failure: "session_request_response_publish_failure" }, wr = { authenticated_session_approve_started: "authenticated_session_approve_started", create_authenticated_session_topic: "create_authenticated_session_topic", cacaos_verified: "cacaos_verified", store_authenticated_session: "store_authenticated_session", subscribing_authenticated_session_topic: "subscribing_authenticated_session_topic", subscribe_authenticated_session_topic_success: "subscribe_authenticated_session_topic_success", publishing_authenticated_session_approve: "publishing_authenticated_session_approve" }, ps = { no_internet_connection: "no_internet_connection", invalid_cacao: "invalid_cacao", subscribe_authenticated_session_topic_failure: "subscribe_authenticated_session_topic_failure", authenticated_session_approve_publish_failure: "authenticated_session_approve_publish_failure", authenticated_session_pending_request_not_found: "authenticated_session_pending_request_not_found" }, RI = 0.1, CI = "event-client", NI = 86400, UI = "https://pulse.walletconnect.org/batch";
let LI = class {
  constructor(e, r) {
    this.core = e, this.logger = r, this.keychain = /* @__PURE__ */ new Map(), this.name = aI, this.version = cI, this.initialized = !1, this.storagePrefix = _t, this.init = async () => {
      if (!this.initialized) {
        const s = await this.getKeyChain();
        typeof s < "u" && (this.keychain = s), this.initialized = !0;
      }
    }, this.has = (s) => (this.isInitialized(), this.keychain.has(s)), this.set = async (s, n) => {
      this.isInitialized(), this.keychain.set(s, n), await this.persist();
    }, this.get = (s) => {
      this.isInitialized();
      const n = this.keychain.get(s);
      if (typeof n > "u") {
        const { message: i } = j("NO_MATCHING_KEY", `${this.name}: ${s}`);
        throw new Error(i);
      }
      return n;
    }, this.del = async (s) => {
      this.isInitialized(), this.keychain.delete(s), await this.persist();
    }, this.core = e, this.logger = ze(r, this.name);
  }
  get context() {
    return Le(this.logger);
  }
  get storageKey() {
    return this.storagePrefix + this.version + this.core.customStoragePrefix + "//" + this.name;
  }
  async setKeyChain(e) {
    await this.core.storage.setItem(this.storageKey, Fo(e));
  }
  async getKeyChain() {
    const e = await this.core.storage.getItem(this.storageKey);
    return typeof e < "u" ? jo(e) : void 0;
  }
  async persist() {
    await this.setKeyChain(this.keychain);
  }
  isInitialized() {
    if (!this.initialized) {
      const { message: e } = j("NOT_INITIALIZED", this.name);
      throw new Error(e);
    }
  }
}, MI = class {
  constructor(e, r, s) {
    this.core = e, this.logger = r, this.name = iI, this.randomSessionIdentifier = Ho(), this.initialized = !1, this.init = async () => {
      this.initialized || (await this.keychain.init(), this.initialized = !0);
    }, this.hasKeys = (n) => (this.isInitialized(), this.keychain.has(n)), this.getClientId = async () => {
      if (this.isInitialized(), this.clientId) return this.clientId;
      const n = await this.getClientSeed(), i = ml(n), o = zf(i.publicKey);
      return this.clientId = o, o;
    }, this.generateKeyPair = () => {
      this.isInitialized();
      const n = Z2();
      return this.setPrivateKey(n.publicKey, n.privateKey);
    }, this.signJWT = async (n) => {
      this.isInitialized();
      const i = await this.getClientSeed(), o = ml(i), a = this.randomSessionIdentifier;
      return await Qv(a, n, oI, o);
    }, this.generateSharedKey = (n, i, o) => {
      this.isInitialized();
      const a = this.getPrivateKey(n), c = X2(a, i);
      return this.setSymKey(c, o);
    }, this.setSymKey = async (n, i) => {
      this.isInitialized();
      const o = i || wn(n);
      return await this.keychain.set(o, n), o;
    }, this.deleteKeyPair = async (n) => {
      this.isInitialized(), await this.keychain.del(n);
    }, this.deleteSymKey = async (n) => {
      this.isInitialized(), await this.keychain.del(n);
    }, this.encode = async (n, i, o) => {
      this.isInitialized();
      const a = ud(o), c = Pr(i);
      if (zl(a)) return ex(c, o?.encoding);
      if (jl(a)) {
        const f = a.senderPublicKey, g = a.receiverPublicKey;
        n = await this.generateSharedKey(f, g);
      }
      const l = this.getSymKey(n), { type: u, senderPublicKey: h } = a;
      return J2({ type: u, symKey: l, message: c, senderPublicKey: h, encoding: o?.encoding });
    }, this.decode = async (n, i, o) => {
      this.isInitialized();
      const a = rx(i, o);
      if (zl(a)) {
        const c = tx(i, o?.encoding);
        return $r(c);
      }
      if (jl(a)) {
        const c = a.receiverPublicKey, l = a.senderPublicKey;
        n = await this.generateSharedKey(c, l);
      }
      try {
        const c = this.getSymKey(n), l = Q2({ symKey: c, encoded: i, encoding: o?.encoding });
        return $r(l);
      } catch (c) {
        this.logger.error(`Failed to decode message from topic: '${n}', clientId: '${await this.getClientId()}'`), this.logger.error(c);
      }
    }, this.getPayloadType = (n, i = be) => {
      const o = Ps({ encoded: n, encoding: i });
      return Rr(o.type);
    }, this.getPayloadSenderPublicKey = (n, i = be) => {
      const o = Ps({ encoded: n, encoding: i });
      return o.senderPublicKey ? fe(o.senderPublicKey, $e) : void 0;
    }, this.core = e, this.logger = ze(r, this.name), this.keychain = s || new LI(this.core, this.logger);
  }
  get context() {
    return Le(this.logger);
  }
  async setPrivateKey(e, r) {
    return await this.keychain.set(e, r), e;
  }
  getPrivateKey(e) {
    return this.keychain.get(e);
  }
  async getClientSeed() {
    let e = "";
    try {
      e = this.keychain.get(gu);
    } catch {
      e = Ho(), await this.keychain.set(gu, e);
    }
    return De(e, "base16");
  }
  getSymKey(e) {
    return this.keychain.get(e);
  }
  isInitialized() {
    if (!this.initialized) {
      const { message: e } = j("NOT_INITIALIZED", this.name);
      throw new Error(e);
    }
  }
};
class kI extends k_ {
  constructor(e, r) {
    super(e, r), this.logger = e, this.core = r, this.messages = /* @__PURE__ */ new Map(), this.messagesWithoutClientAck = /* @__PURE__ */ new Map(), this.name = lI, this.version = uI, this.initialized = !1, this.storagePrefix = _t, this.init = async () => {
      if (!this.initialized) {
        this.logger.trace("Initialized");
        try {
          const s = await this.getRelayerMessages();
          typeof s < "u" && (this.messages = s);
          const n = await this.getRelayerMessagesWithoutClientAck();
          typeof n < "u" && (this.messagesWithoutClientAck = n), this.logger.debug(`Successfully Restored records for ${this.name}`), this.logger.trace({ type: "method", method: "restore", size: this.messages.size });
        } catch (s) {
          this.logger.debug(`Failed to Restore records for ${this.name}`), this.logger.error(s);
        } finally {
          this.initialized = !0;
        }
      }
    }, this.set = async (s, n, i) => {
      this.isInitialized();
      const o = Ge(n);
      let a = this.messages.get(s);
      if (typeof a > "u" && (a = {}), typeof a[o] < "u") return o;
      if (a[o] = n, this.messages.set(s, a), i === En.inbound) {
        const c = this.messagesWithoutClientAck.get(s) || {};
        this.messagesWithoutClientAck.set(s, { ...c, [o]: n });
      }
      return await this.persist(), o;
    }, this.get = (s) => {
      this.isInitialized();
      let n = this.messages.get(s);
      return typeof n > "u" && (n = {}), n;
    }, this.getWithoutAck = (s) => {
      this.isInitialized();
      const n = {};
      for (const i of s) {
        const o = this.messagesWithoutClientAck.get(i) || {};
        n[i] = Object.values(o);
      }
      return n;
    }, this.has = (s, n) => {
      this.isInitialized();
      const i = this.get(s), o = Ge(n);
      return typeof i[o] < "u";
    }, this.ack = async (s, n) => {
      this.isInitialized();
      const i = this.messagesWithoutClientAck.get(s);
      if (typeof i > "u") return;
      const o = Ge(n);
      delete i[o], Object.keys(i).length === 0 ? this.messagesWithoutClientAck.delete(s) : this.messagesWithoutClientAck.set(s, i), await this.persist();
    }, this.del = async (s) => {
      this.isInitialized(), this.messages.delete(s), this.messagesWithoutClientAck.delete(s), await this.persist();
    }, this.logger = ze(e, this.name), this.core = r;
  }
  get context() {
    return Le(this.logger);
  }
  get storageKey() {
    return this.storagePrefix + this.version + this.core.customStoragePrefix + "//" + this.name;
  }
  get storageKeyWithoutClientAck() {
    return this.storagePrefix + this.version + this.core.customStoragePrefix + "//" + this.name + "_withoutClientAck";
  }
  async setRelayerMessages(e) {
    await this.core.storage.setItem(this.storageKey, Fo(e));
  }
  async setRelayerMessagesWithoutClientAck(e) {
    await this.core.storage.setItem(this.storageKeyWithoutClientAck, Fo(e));
  }
  async getRelayerMessages() {
    const e = await this.core.storage.getItem(this.storageKey);
    return typeof e < "u" ? jo(e) : void 0;
  }
  async getRelayerMessagesWithoutClientAck() {
    const e = await this.core.storage.getItem(this.storageKeyWithoutClientAck);
    return typeof e < "u" ? jo(e) : void 0;
  }
  async persist() {
    await this.setRelayerMessages(this.messages), await this.setRelayerMessagesWithoutClientAck(this.messagesWithoutClientAck);
  }
  isInitialized() {
    if (!this.initialized) {
      const { message: e } = j("NOT_INITIALIZED", this.name);
      throw new Error(e);
    }
  }
}
class qI extends q_ {
  constructor(e, r) {
    super(e, r), this.relayer = e, this.logger = r, this.events = new je.EventEmitter(), this.name = fI, this.queue = /* @__PURE__ */ new Map(), this.publishTimeout = F.toMiliseconds(F.ONE_MINUTE), this.initialPublishTimeout = F.toMiliseconds(F.ONE_SECOND * 15), this.needsTransportRestart = !1, this.publish = async (s, n, i) => {
      this.logger.debug("Publishing Payload"), this.logger.trace({ type: "method", method: "publish", params: { topic: s, message: n, opts: i } });
      const o = i?.ttl || hI, a = i?.prompt || !1, c = i?.tag || 0, l = i?.id || nr().toString(), u = Hr(kn().protocol), h = { id: l, method: i?.publishMethod || u.publish, params: { topic: s, message: n, ttl: o, prompt: a, tag: c, attestation: i?.attestation, ...i?.tvf } }, f = `Failed to publish payload, please try again. id:${l} tag:${c}`;
      try {
        he(h.params?.prompt) && delete h.params?.prompt, he(h.params?.tag) && delete h.params?.tag;
        const g = new Promise(async (p) => {
          const y = ({ id: E }) => {
            h.id?.toString() === E.toString() && (this.removeRequestFromQueue(E), this.relayer.events.removeListener(se.publish, y), p());
          };
          this.relayer.events.on(se.publish, y);
          const m = at(new Promise((E, $) => {
            this.rpcPublish(h, i).then(E).catch((b) => {
              this.logger.warn(b, b?.message), $(b);
            });
          }), this.initialPublishTimeout, `Failed initial publish, retrying.... id:${l} tag:${c}`);
          try {
            await m, this.events.removeListener(se.publish, y);
          } catch (E) {
            this.queue.set(l, { request: h, opts: i, attempt: 1 }), this.logger.warn(E, E?.message);
          }
        });
        this.logger.trace({ type: "method", method: "publish", params: { id: l, topic: s, message: n, opts: i } }), await at(g, this.publishTimeout, f);
      } catch (g) {
        if (this.logger.debug("Failed to Publish Payload"), this.logger.error(g), i?.internal?.throwOnFailedPublish) throw g;
      } finally {
        this.queue.delete(l);
      }
    }, this.publishCustom = async (s) => {
      this.logger.debug("Publishing custom payload"), this.logger.trace({ type: "method", method: "publishCustom", params: s });
      const { payload: n, opts: i = {} } = s, { attestation: o, tvf: a, publishMethod: c, prompt: l, tag: u, ttl: h = F.FIVE_MINUTES } = i, f = i.id || nr().toString(), g = Hr(kn().protocol), p = c || g.publish, y = { id: f, method: p, params: { ...n, ttl: h, prompt: l, tag: u, attestation: o, ...a } }, m = `Failed to publish custom payload, please try again. id:${f} tag:${u}`;
      try {
        he(y.params?.prompt) && delete y.params?.prompt, he(y.params?.tag) && delete y.params?.tag;
        const E = new Promise(async ($) => {
          const b = ({ id: x }) => {
            y.id?.toString() === x.toString() && (this.removeRequestFromQueue(x), this.relayer.events.removeListener(se.publish, b), $());
          };
          this.relayer.events.on(se.publish, b);
          const v = at(new Promise((x, I) => {
            this.rpcPublish(y, i).then(x).catch((P) => {
              this.logger.warn(P, P?.message), I(P);
            });
          }), this.initialPublishTimeout, `Failed initial custom payload publish, retrying.... method:${p} id:${f} tag:${u}`);
          try {
            await v, this.events.removeListener(se.publish, b);
          } catch (x) {
            this.queue.set(f, { request: y, opts: i, attempt: 1 }), this.logger.warn(x, x?.message);
          }
        });
        this.logger.trace({ type: "method", method: "publish", params: { id: f, payload: n, opts: i } }), await at(E, this.publishTimeout, m);
      } catch (E) {
        if (this.logger.debug("Failed to Publish Payload"), this.logger.error(E), i?.internal?.throwOnFailedPublish) throw E;
      } finally {
        this.queue.delete(f);
      }
    }, this.on = (s, n) => {
      this.events.on(s, n);
    }, this.once = (s, n) => {
      this.events.once(s, n);
    }, this.off = (s, n) => {
      this.events.off(s, n);
    }, this.removeListener = (s, n) => {
      this.events.removeListener(s, n);
    }, this.relayer = e, this.logger = ze(r, this.name), this.registerEventListeners();
  }
  get context() {
    return Le(this.logger);
  }
  async rpcPublish(e, r) {
    this.logger.debug("Outgoing Relay Payload"), this.logger.trace({ type: "message", direction: "outgoing", request: e });
    const s = await this.relayer.request(e);
    return this.relayer.events.emit(se.publish, { ...e, ...r }), this.logger.debug("Successfully Published Payload"), s;
  }
  removeRequestFromQueue(e) {
    this.queue.delete(e);
  }
  checkQueue() {
    this.queue.forEach(async (e, r) => {
      const s = e.attempt + 1;
      this.queue.set(r, { ...e, attempt: s }), this.logger.warn({}, `Publisher: queue->publishing: ${e.request.id}, tag: ${e.request.params?.tag}, attempt: ${s}`), await this.rpcPublish(e.request, e.opts), this.logger.warn({}, `Publisher: queue->published: ${e.request.id}`);
    });
  }
  registerEventListeners() {
    this.relayer.core.heartbeat.on(Nr.pulse, () => {
      if (this.needsTransportRestart) {
        this.needsTransportRestart = !1, this.relayer.events.emit(se.connection_stalled);
        return;
      }
      this.checkQueue();
    }), this.relayer.on(se.message_ack, (e) => {
      this.removeRequestFromQueue(e.id.toString());
    });
  }
}
class FI {
  constructor() {
    this.map = /* @__PURE__ */ new Map(), this.set = (e, r) => {
      const s = this.get(e);
      this.exists(e, r) || this.map.set(e, [...s, r]);
    }, this.get = (e) => this.map.get(e) || [], this.exists = (e, r) => this.get(e).includes(r), this.delete = (e, r) => {
      if (typeof r > "u") {
        this.map.delete(e);
        return;
      }
      if (!this.map.has(e)) return;
      const s = this.get(e);
      if (!this.exists(e, r)) return;
      const n = s.filter((i) => i !== r);
      if (!n.length) {
        this.map.delete(e);
        return;
      }
      this.map.set(e, n);
    }, this.clear = () => {
      this.map.clear();
    };
  }
  get topics() {
    return Array.from(this.map.keys());
  }
}
let jI = class extends z_ {
  constructor(e, r) {
    super(e, r), this.relayer = e, this.logger = r, this.subscriptions = /* @__PURE__ */ new Map(), this.topicMap = new FI(), this.events = new je.EventEmitter(), this.name = bI, this.version = vI, this.pending = /* @__PURE__ */ new Map(), this.cached = [], this.initialized = !1, this.storagePrefix = _t, this.subscribeTimeout = F.toMiliseconds(F.ONE_MINUTE), this.initialSubscribeTimeout = F.toMiliseconds(F.ONE_SECOND * 15), this.batchSubscribeTopicsLimit = 500, this.init = async () => {
      this.initialized || (this.logger.trace("Initialized"), this.registerEventListeners(), await this.restore()), this.initialized = !0;
    }, this.subscribe = async (s, n) => {
      this.isInitialized(), this.logger.debug("Subscribing Topic"), this.logger.trace({ type: "method", method: "subscribe", params: { topic: s, opts: n } });
      try {
        const i = kn(n), o = { topic: s, relay: i, transportType: n?.transportType };
        n?.internal?.skipSubscribe || this.pending.set(s, o);
        const a = await this.rpcSubscribe(s, i, n);
        return typeof a == "string" && (this.onSubscribe(a, o), this.logger.debug("Successfully Subscribed Topic"), this.logger.trace({ type: "method", method: "subscribe", params: { topic: s, opts: n } })), a;
      } catch (i) {
        throw this.logger.debug("Failed to Subscribe Topic"), this.logger.error(i), i;
      }
    }, this.unsubscribe = async (s, n) => {
      this.isInitialized(), typeof n?.id < "u" ? await this.unsubscribeById(s, n.id, n) : await this.unsubscribeByTopic(s, n);
    }, this.isSubscribed = (s) => new Promise((n) => {
      n(this.topicMap.topics.includes(s));
    }), this.isKnownTopic = (s) => new Promise((n) => {
      n(this.topicMap.topics.includes(s) || this.pending.has(s) || this.cached.some((i) => i.topic === s));
    }), this.on = (s, n) => {
      this.events.on(s, n);
    }, this.once = (s, n) => {
      this.events.once(s, n);
    }, this.off = (s, n) => {
      this.events.off(s, n);
    }, this.removeListener = (s, n) => {
      this.events.removeListener(s, n);
    }, this.start = async () => {
      await this.onConnect();
    }, this.stop = async () => {
      await this.onDisconnect();
    }, this.restart = async () => {
      await this.restore(), await this.onRestart();
    }, this.checkPending = async () => {
      if (this.pending.size === 0 && (!this.initialized || !this.relayer.connected)) return;
      const s = [];
      this.pending.forEach((n) => {
        s.push(n);
      }), await this.batchSubscribe(s);
    }, this.registerEventListeners = () => {
      this.relayer.core.heartbeat.on(Nr.pulse, async () => {
        await this.checkPending();
      }), this.events.on(Me.created, async (s) => {
        const n = Me.created;
        this.logger.info(`Emitting ${n}`), this.logger.debug({ type: "event", event: n, data: s }), await this.persist();
      }), this.events.on(Me.deleted, async (s) => {
        const n = Me.deleted;
        this.logger.info(`Emitting ${n}`), this.logger.debug({ type: "event", event: n, data: s }), await this.persist();
      });
    }, this.relayer = e, this.logger = ze(r, this.name), this.clientId = "";
  }
  get context() {
    return Le(this.logger);
  }
  get storageKey() {
    return this.storagePrefix + this.version + this.relayer.core.customStoragePrefix + "//" + this.name;
  }
  get length() {
    return this.subscriptions.size;
  }
  get ids() {
    return Array.from(this.subscriptions.keys());
  }
  get values() {
    return Array.from(this.subscriptions.values());
  }
  get topics() {
    return this.topicMap.topics;
  }
  get hasAnyTopics() {
    return this.topicMap.topics.length > 0 || this.pending.size > 0 || this.cached.length > 0 || this.subscriptions.size > 0;
  }
  hasSubscription(e, r) {
    let s = !1;
    try {
      s = this.getSubscription(e).topic === r;
    } catch {
    }
    return s;
  }
  reset() {
    this.cached = [], this.initialized = !0;
  }
  onDisable() {
    this.values.length > 0 && (this.cached = this.values), this.subscriptions.clear(), this.topicMap.clear();
  }
  async unsubscribeByTopic(e, r) {
    const s = this.topicMap.get(e);
    await Promise.all(s.map(async (n) => await this.unsubscribeById(e, n, r)));
  }
  async unsubscribeById(e, r, s) {
    this.logger.debug("Unsubscribing Topic"), this.logger.trace({ type: "method", method: "unsubscribe", params: { topic: e, id: r, opts: s } });
    try {
      const n = Q("USER_DISCONNECTED", `${this.name}, ${e}`);
      await this.onUnsubscribe(e, r, n);
      const i = kn(s);
      await this.restartToComplete({ topic: e, id: r, relay: i }), await this.rpcUnsubscribe(e, r, i), this.logger.debug("Successfully Unsubscribed Topic"), this.logger.trace({ type: "method", method: "unsubscribe", params: { topic: e, id: r, opts: s } });
    } catch (n) {
      throw this.logger.debug("Failed to Unsubscribe Topic"), this.logger.error(n), n;
    }
  }
  async rpcSubscribe(e, r, s) {
    const n = await this.getSubscriptionId(e);
    if (s?.internal?.skipSubscribe) return n;
    (!s || s?.transportType === te.relay) && await this.restartToComplete({ topic: e, id: e, relay: r });
    const i = { method: Hr(r.protocol).subscribe, params: { topic: e } };
    this.logger.debug("Outgoing Relay Payload"), this.logger.trace({ type: "payload", direction: "outgoing", request: i });
    const o = s?.internal?.throwOnFailedPublish;
    try {
      if (s?.transportType === te.link_mode) return setTimeout(() => {
        (this.relayer.connected || this.relayer.connecting) && this.relayer.request(i).catch((l) => this.logger.warn(l));
      }, F.toMiliseconds(F.ONE_SECOND)), n;
      const a = new Promise(async (l) => {
        const u = (h) => {
          h.topic === e && (this.events.removeListener(Me.created, u), l(h.id));
        };
        this.events.on(Me.created, u);
        try {
          const h = await at(new Promise((f, g) => {
            this.relayer.request(i).catch((p) => {
              this.logger.warn(p, p?.message), g(p);
            }).then(f);
          }), this.initialSubscribeTimeout, `Subscribing to ${e} failed, please try again`);
          this.events.removeListener(Me.created, u), l(h);
        } catch {
        }
      }), c = await at(a, this.subscribeTimeout, `Subscribing to ${e} failed, please try again`);
      if (!c && o) throw new Error(`Subscribing to ${e} failed, please try again`);
      return c ? n : null;
    } catch (a) {
      if (this.logger.debug("Outgoing Relay Subscribe Payload stalled"), this.relayer.events.emit(se.connection_stalled), o) throw a;
    }
    return null;
  }
  async rpcBatchSubscribe(e) {
    if (!e.length) return !0;
    const r = e[0].relay, s = { method: Hr(r.protocol).batchSubscribe, params: { topics: e.map((n) => n.topic) } };
    this.logger.debug("Outgoing Relay Payload"), this.logger.trace({ type: "payload", direction: "outgoing", request: s });
    try {
      return await at(new Promise((n, i) => {
        this.relayer.request(s).then(n).catch((o) => {
          this.logger.warn(o), i(o);
        });
      }), this.subscribeTimeout, "rpcBatchSubscribe failed, please try again"), !0;
    } catch {
      return this.relayer.events.emit(se.connection_stalled), !1;
    }
  }
  async rpcBatchFetchMessages(e) {
    if (!e.length) return;
    const r = e[0].relay, s = { method: Hr(r.protocol).batchFetchMessages, params: { topics: e.map((i) => i.topic) } };
    this.logger.debug("Outgoing Relay Payload"), this.logger.trace({ type: "payload", direction: "outgoing", request: s });
    let n;
    try {
      n = await await at(new Promise((i, o) => {
        this.relayer.request(s).catch((a) => {
          this.logger.warn(a), o(a);
        }).then(i);
      }), this.subscribeTimeout, "rpcBatchFetchMessages failed, please try again");
    } catch {
      this.relayer.events.emit(se.connection_stalled);
    }
    return n;
  }
  rpcUnsubscribe(e, r, s) {
    const n = { method: Hr(s.protocol).unsubscribe, params: { topic: e, id: r } };
    return this.logger.debug("Outgoing Relay Payload"), this.logger.trace({ type: "payload", direction: "outgoing", request: n }), this.relayer.request(n);
  }
  onSubscribe(e, r) {
    this.setSubscription(e, { ...r, id: e }), this.pending.delete(r.topic);
  }
  onBatchSubscribe(e) {
    e.length && e.forEach((r) => {
      this.setSubscription(r.id, { ...r }), this.pending.delete(r.topic);
    });
  }
  async onUnsubscribe(e, r, s) {
    this.events.removeAllListeners(r), this.hasSubscription(r, e) && this.deleteSubscription(r, s), await this.relayer.messages.del(e);
  }
  async setRelayerSubscriptions(e) {
    await this.relayer.core.storage.setItem(this.storageKey, e);
  }
  async getRelayerSubscriptions() {
    return await this.relayer.core.storage.getItem(this.storageKey);
  }
  setSubscription(e, r) {
    this.logger.debug("Setting subscription"), this.logger.trace({ type: "method", method: "setSubscription", id: e, subscription: r }), this.addSubscription(e, r);
  }
  addSubscription(e, r) {
    this.subscriptions.set(e, { ...r }), this.topicMap.set(r.topic, e), this.events.emit(Me.created, r);
  }
  getSubscription(e) {
    this.logger.debug("Getting subscription"), this.logger.trace({ type: "method", method: "getSubscription", id: e });
    const r = this.subscriptions.get(e);
    if (!r) {
      const { message: s } = j("NO_MATCHING_KEY", `${this.name}: ${e}`);
      throw new Error(s);
    }
    return r;
  }
  deleteSubscription(e, r) {
    this.logger.debug("Deleting subscription"), this.logger.trace({ type: "method", method: "deleteSubscription", id: e, reason: r });
    const s = this.getSubscription(e);
    this.subscriptions.delete(e), this.topicMap.delete(s.topic, e), this.events.emit(Me.deleted, { ...s, reason: r });
  }
  async persist() {
    await this.setRelayerSubscriptions(this.values), this.events.emit(Me.sync);
  }
  async onRestart() {
    if (this.cached.length) {
      const e = [...this.cached], r = Math.ceil(this.cached.length / this.batchSubscribeTopicsLimit);
      for (let s = 0; s < r; s++) {
        const n = e.splice(0, this.batchSubscribeTopicsLimit);
        await this.batchSubscribe(n);
      }
    }
    this.events.emit(Me.resubscribed);
  }
  async restore() {
    try {
      const e = await this.getRelayerSubscriptions();
      if (typeof e > "u" || !e.length) return;
      if (this.subscriptions.size && !e.every((r) => r.topic === this.subscriptions.get(r.id)?.topic)) {
        const { message: r } = j("RESTORE_WILL_OVERRIDE", this.name);
        throw this.logger.error(r), this.logger.error(`${this.name}: ${JSON.stringify(this.values)}`), new Error(r);
      }
      this.cached = e, this.logger.debug(`Successfully Restored subscriptions for ${this.name}`), this.logger.trace({ type: "method", method: "restore", subscriptions: this.values });
    } catch (e) {
      this.logger.debug(`Failed to Restore subscriptions for ${this.name}`), this.logger.error(e);
    }
  }
  async batchSubscribe(e) {
    if (e.length) {
      if (!await this.rpcBatchSubscribe(e)) {
        this.logger.warn(`Batch subscribe failed for ${e.length} topics, adding to pending for retry`), e.forEach((r) => {
          this.pending.set(r.topic, r);
        });
        return;
      }
      this.onBatchSubscribe(await Promise.all(e.map(async (r) => ({ ...r, id: await this.getSubscriptionId(r.topic) }))));
    }
  }
  async batchFetchMessages(e) {
    if (!e.length) return;
    this.logger.trace(`Fetching batch messages for ${e.length} subscriptions`);
    const r = await this.rpcBatchFetchMessages(e);
    r && r.messages && (await g2(F.toMiliseconds(F.ONE_SECOND)), await this.relayer.handleBatchMessageEvents(r.messages));
  }
  async onConnect() {
    await this.restart(), this.reset();
  }
  onDisconnect() {
    this.onDisable();
  }
  isInitialized() {
    if (!this.initialized) {
      const { message: e } = j("NOT_INITIALIZED", this.name);
      throw new Error(e);
    }
  }
  async restartToComplete(e) {
    !this.relayer.connected && !this.relayer.connecting && (this.cached.push(e), await this.relayer.transportOpen());
  }
  async getClientId() {
    return this.clientId || (this.clientId = await this.relayer.core.crypto.getClientId()), this.clientId;
  }
  async getSubscriptionId(e) {
    return Ge(e + await this.getClientId());
  }
}, zI = class extends F_ {
  constructor(e) {
    super(e), this.protocol = "wc", this.version = 2, this.events = new je.EventEmitter(), this.name = pI, this.transportExplicitlyClosed = !1, this.initialized = !1, this.connectionAttemptInProgress = !1, this.hasExperiencedNetworkDisruption = !1, this.heartBeatTimeout = F.toMiliseconds(F.THIRTY_SECONDS + F.FIVE_SECONDS), this.reconnectInProgress = !1, this.requestsInFlight = [], this.connectTimeout = F.toMiliseconds(F.ONE_SECOND * 15), this.stalledRestartInProgress = !1, this.stalledRestartBackoff = 0, this.stalledRestartBaseInterval = F.toMiliseconds(F.ONE_SECOND * 2), this.stalledRestartMaxInterval = F.toMiliseconds(F.THIRTY_SECONDS), this.request = async (r) => {
      this.logger.debug("Publishing Request Payload");
      const s = r.id || nr().toString();
      await this.toEstablishConnection();
      try {
        this.logger.trace({ id: s, method: r.method, topic: r.params?.topic }, "relayer.request - publishing...");
        const n = `${s}:${r.params?.tag || ""}`;
        this.requestsInFlight.push(n);
        const i = await this.provider.request(r);
        return this.requestsInFlight = this.requestsInFlight.filter((o) => o !== n), i;
      } catch (n) {
        throw this.logger.debug(`Failed to Publish Request: ${s}`), n;
      }
    }, this.resetPingTimeout = () => {
      Nn() && (clearTimeout(this.pingTimeout), this.pingTimeout = setTimeout(() => {
        try {
          this.logger.debug({}, "pingTimeout: Connection stalled, terminating..."), this.provider?.connection?.socket?.terminate?.();
        } catch (r) {
          this.logger.warn(r, r?.message);
        }
      }, this.heartBeatTimeout));
    }, this.onPayloadHandler = (r) => {
      this.onProviderPayload(r), this.resetPingTimeout();
    }, this.onConnectHandler = () => {
      this.logger.warn({}, "Relayer connected 🛜"), this.startPingTimeout(), this.stalledRestartBackoff = 0, this.events.emit(se.connect);
    }, this.onDisconnectHandler = () => {
      this.logger.warn({}, "Relayer disconnected 🛑"), this.requestsInFlight = [], this.onProviderDisconnect();
    }, this.onProviderErrorHandler = (r) => {
      this.logger.fatal(`Fatal socket error: ${r.message}`), this.events.emit(se.error, r), this.logger.fatal("Fatal socket error received, closing transport"), this.transportExplicitlyClosed = !0, clearTimeout(this.reconnectTimeout), this.reconnectTimeout = void 0, this.reconnectInProgress = !1, this.transportClose().catch((s) => this.logger.warn(s));
    }, this.registerProviderListeners = () => {
      this.provider.on(Ke.payload, this.onPayloadHandler), this.provider.on(Ke.connect, this.onConnectHandler), this.provider.on(Ke.disconnect, this.onDisconnectHandler), this.provider.on(Ke.error, this.onProviderErrorHandler);
    }, this.core = e.core, this.logger = Ba({ logger: e.logger ?? dI, name: this.name }), this.messages = new kI(this.logger, e.core), this.subscriber = new jI(this, this.logger), this.publisher = new qI(this, this.logger), this.projectId = e.projectId, this.relayUrl = e.relayUrl || jd, QE() ? this.packageName = Tl() : e2() && (this.bundleId = Tl()), this.provider = {};
  }
  async init() {
    this.logger.trace("Initialized"), this.registerEventListeners(), await Promise.all([this.messages.init(), this.subscriber.init()]), this.initialized = !0, this.transportOpen().catch((e) => this.logger.warn(e, e?.message));
  }
  get context() {
    return Le(this.logger);
  }
  get connected() {
    return this.provider?.connection?.socket?.readyState === 1;
  }
  get connecting() {
    return this.provider?.connection?.socket?.readyState === 0 || this.connectPromise !== void 0;
  }
  async publish(e, r, s) {
    this.isInitialized(), await this.publisher.publish(e, r, s), await this.recordMessageEvent({ topic: e, message: r, publishedAt: Date.now(), transportType: te.relay }, En.outbound);
  }
  async publishCustom(e) {
    this.isInitialized(), await this.publisher.publishCustom(e);
  }
  async subscribe(e, r) {
    this.isInitialized(), (!r?.transportType || r?.transportType === "relay") && await this.toEstablishConnection();
    const s = r?.internal?.throwOnFailedPublish ?? !0;
    let n = this.subscriber.topicMap.get(e)?.[0] || "", i;
    const o = (a) => {
      a.topic === e && (this.subscriber.off(Me.created, o), i());
    };
    return await Promise.all([new Promise((a) => {
      i = a, this.subscriber.on(Me.created, o);
    }), new Promise((a, c) => {
      this.subscriber.subscribe(e, { internal: { throwOnFailedPublish: s }, ...r }).then((l) => {
        n = l || n, a();
      }).catch((l) => {
        s ? c(l) : a();
      });
    })]), n;
  }
  async unsubscribe(e, r) {
    this.isInitialized(), await this.subscriber.unsubscribe(e, r);
  }
  on(e, r) {
    this.events.on(e, r);
  }
  once(e, r) {
    this.events.once(e, r);
  }
  off(e, r) {
    this.events.off(e, r);
  }
  removeListener(e, r) {
    this.events.removeListener(e, r);
  }
  async transportDisconnect() {
    this.provider.disconnect && (this.hasExperiencedNetworkDisruption || this.connected) ? await at(this.provider.disconnect(), 2e3, "provider.disconnect()").catch(() => this.onProviderDisconnect()) : this.onProviderDisconnect();
  }
  async transportClose() {
    this.transportExplicitlyClosed = !0, clearTimeout(this.stalledRestartTimeout), this.stalledRestartInProgress = !1, this.stalledRestartBackoff = 0, await this.resetTransport();
  }
  async transportOpen(e) {
    if (!this.subscriber.hasAnyTopics) {
      this.logger.info("Starting WS connection skipped because the client has no topics to work with.");
      return;
    }
    if (this.connectPromise ? (this.logger.debug({}, "Waiting for existing connection attempt to resolve..."), await this.connectPromise, this.logger.debug({}, "Existing connection attempt resolved")) : (this.connectPromise = this.connect(e).finally(() => {
      this.connectPromise = void 0;
    }), await this.connectPromise), !this.connected) throw new Error(`Couldn't establish socket connection to the relay server: ${this.relayUrl}`);
  }
  async restartTransport(e) {
    this.logger.debug({}, "Restarting transport..."), !this.connectionAttemptInProgress && (this.relayUrl = e || this.relayUrl, await this.confirmOnlineStateOrThrow(), await this.resetTransport(), await this.transportOpen());
  }
  async resetTransport() {
    this.reconnectInProgress = !0, clearTimeout(this.reconnectTimeout), this.reconnectTimeout = void 0, await this.transportDisconnect(), await this.subscriber.stop(), this.reconnectInProgress = !1;
  }
  async confirmOnlineStateOrThrow() {
    if (!await Jl()) throw new Error("No internet connection detected. Please restart your network and try again.");
  }
  async handleBatchMessageEvents(e) {
    if (e?.length === 0) {
      this.logger.trace("Batch message events is empty. Ignoring...");
      return;
    }
    const r = e.sort((s, n) => s.publishedAt - n.publishedAt);
    this.logger.debug(`Batch of ${r.length} message events sorted`);
    for (const s of r) try {
      await this.onMessageEvent(s);
    } catch (n) {
      this.logger.warn(n, "Error while processing batch message event: " + n?.message);
    }
    this.logger.trace(`Batch of ${r.length} message events processed`);
  }
  async onLinkMessageEvent(e, r) {
    const { topic: s } = e;
    if (!r.sessionExists) {
      const n = ae(F.FIVE_MINUTES), i = { topic: s, expiry: n, relay: { protocol: "irn" }, active: !1 };
      await this.core.pairing.pairings.set(s, i);
    }
    this.events.emit(se.message, e), await this.recordMessageEvent(e, En.inbound);
  }
  async connect(e) {
    await this.confirmOnlineStateOrThrow(), e && e !== this.relayUrl && (this.relayUrl = e, await this.transportDisconnect()), this.transportExplicitlyClosed = !1;
    let r = 1;
    try {
      for (; r < 6; ) {
        this.connectionAttemptInProgress = !0;
        try {
          if (this.transportExplicitlyClosed) break;
          this.logger.debug({}, `Connecting to ${this.relayUrl}, attempt: ${r}...`), await this.createProvider(), await new Promise((s, n) => {
            const i = () => {
              n(new Error("Connection interrupted while trying to connect"));
            };
            this.provider.once(Ke.disconnect, i), at(this.provider.connect(), this.connectTimeout, `Socket stalled when trying to connect to ${this.relayUrl}`).then(() => s()).catch(n).finally(() => {
              this.provider.off(Ke.disconnect, i), clearTimeout(this.reconnectTimeout);
            });
          }), await new Promise((s, n) => {
            const i = () => {
              n(new Error("Connection interrupted while trying to subscribe"));
            };
            this.provider.once(Ke.disconnect, i), this.subscriber.start().then(s).catch(n).finally(() => {
              this.provider.off(Ke.disconnect, i);
            });
          }), this.hasExperiencedNetworkDisruption = !1;
        } catch (s) {
          await this.subscriber.stop();
          const n = s;
          this.logger.warn({}, n.message), this.hasExperiencedNetworkDisruption = !0;
        }
        if (this.connected) {
          this.logger.debug({}, `Connected to ${this.relayUrl} successfully on attempt: ${r}`);
          break;
        }
        await new Promise((s) => setTimeout(s, F.toMiliseconds(r * 1))), r++;
      }
    } finally {
      this.connectionAttemptInProgress = !1, clearTimeout(this.reconnectTimeout), this.reconnectTimeout = void 0, this.reconnectInProgress = !1;
    }
  }
  startPingTimeout() {
    if (Nn()) try {
      this.provider?.connection?.socket?.on("ping", () => {
        this.resetPingTimeout();
      }), this.resetPingTimeout();
    } catch (e) {
      this.logger.warn(e, e?.message);
    }
  }
  async createProvider() {
    if (this.provider.connection && (this.unregisterProviderListeners(), this.connected)) try {
      await at(this.provider.disconnect(), 1e3, "Closing previous provider");
    } catch {
    }
    const e = await this.core.crypto.signJWT(this.relayUrl);
    this.provider = new Ua(new kS(i2({ sdkVersion: Xo, protocol: this.protocol, version: this.version, relayUrl: this.relayUrl, projectId: this.projectId, auth: e, useOnCloseEvent: !0, bundleId: this.bundleId, packageName: this.packageName }))), this.registerProviderListeners();
  }
  async recordMessageEvent(e, r) {
    const { topic: s, message: n } = e;
    await this.messages.set(s, n, r);
  }
  async shouldIgnoreMessageEvent(e) {
    const { topic: r, message: s } = e;
    if (!s || s.length === 0) return this.logger.warn(`Ignoring invalid/empty message: ${s}`), !0;
    if (!await this.subscriber.isKnownTopic(r)) return this.logger.warn(`Ignoring message for unknown topic ${r}`), !0;
    const n = this.messages.has(r, s);
    return n && this.logger.warn(`Ignoring duplicate message: ${s}`), n;
  }
  async onProviderPayload(e) {
    if (this.logger.debug("Incoming Relay Payload"), this.logger.trace({ type: "payload", direction: "incoming", payload: e }), Na(e)) {
      if (!e.method.endsWith(gI)) return;
      const r = e.params, { topic: s, message: n, publishedAt: i, attestation: o } = r.data, a = { topic: s, message: n, publishedAt: i, transportType: te.relay, attestation: o };
      this.logger.debug("Emitting Relayer Payload"), this.logger.trace({ type: "event", event: r.id, ...a }), this.events.emit(r.id, a), await this.acknowledgePayload(e), await this.onMessageEvent(a);
    } else li(e) && this.events.emit(se.message_ack, e);
  }
  async onMessageEvent(e) {
    await this.shouldIgnoreMessageEvent(e) || (await this.recordMessageEvent(e, En.inbound), this.events.emit(se.message, e));
  }
  async acknowledgePayload(e) {
    const r = Bs(e.id, !0);
    await this.provider.connection.send(r);
  }
  unregisterProviderListeners() {
    this.provider.off(Ke.payload, this.onPayloadHandler), this.provider.off(Ke.connect, this.onConnectHandler), this.provider.off(Ke.disconnect, this.onDisconnectHandler), this.provider.off(Ke.error, this.onProviderErrorHandler), clearTimeout(this.pingTimeout);
  }
  async registerEventListeners() {
    let e = await Jl();
    Fx(async (r) => {
      e !== r && (e = r, r ? await this.transportOpen().catch((s) => this.logger.error(s, s?.message)) : (this.hasExperiencedNetworkDisruption = !0, await this.transportDisconnect(), this.transportExplicitlyClosed = !1));
    }), this.core.heartbeat.on(Nr.pulse, async () => {
      if (!this.transportExplicitlyClosed && !this.connected && Hx()) try {
        await this.confirmOnlineStateOrThrow(), await this.transportOpen();
      } catch (r) {
        this.logger.warn(r, r?.message);
      }
    }), this.events.on(se.connection_stalled, () => {
      if (this.transportExplicitlyClosed || this.stalledRestartInProgress) return;
      this.stalledRestartInProgress = !0;
      const r = this.stalledRestartBackoff === 0 ? 0 : Math.min(Math.pow(2, this.stalledRestartBackoff - 1) * this.stalledRestartBaseInterval, this.stalledRestartMaxInterval);
      this.stalledRestartBackoff++, this.logger.warn(`Connection stalled, restarting transport${r ? ` in ${r}ms` : ""}...`), this.stalledRestartTimeout = setTimeout(async () => {
        try {
          if (this.transportExplicitlyClosed) return;
          await this.restartTransport();
        } catch (s) {
          this.logger.error(s, s?.message);
        } finally {
          this.stalledRestartInProgress = !1;
        }
      }, r);
    });
  }
  async onProviderDisconnect() {
    if (clearTimeout(this.pingTimeout), this.events.emit(se.disconnect), !this.reconnectInProgress) {
      this.reconnectInProgress = !0;
      try {
        await this.subscriber.stop();
      } catch (e) {
        this.logger.warn(e, "subscriber.stop() failed during disconnect");
      }
      if (!this.subscriber.hasAnyTopics || this.transportExplicitlyClosed) {
        this.reconnectInProgress = !1;
        return;
      }
      this.reconnectTimeout = setTimeout(async () => {
        await this.transportOpen().catch((e) => this.logger.error(e, e?.message)), this.reconnectTimeout = void 0, this.reconnectInProgress = !1;
      }, F.toMiliseconds(yI));
    }
  }
  isInitialized() {
    if (!this.initialized) {
      const { message: e } = j("NOT_INITIALIZED", this.name);
      throw new Error(e);
    }
  }
  async toEstablishConnection() {
    if (await this.confirmOnlineStateOrThrow(), !this.connected) {
      if (this.connectPromise) {
        await this.connectPromise;
        return;
      }
      this.connectPromise = this.connect().finally(() => {
        this.connectPromise = void 0;
      }), await this.connectPromise;
    }
  }
}, Lr = class extends j_ {
  constructor(e, r, s, n = _t, i = void 0) {
    super(e, r, s, n), this.core = e, this.logger = r, this.name = s, this.map = /* @__PURE__ */ new Map(), this.version = wI, this.cached = [], this.initialized = !1, this.storagePrefix = _t, this.recentlyDeleted = [], this.recentlyDeletedLimit = 200, this.init = async () => {
      this.initialized || (this.logger.trace("Initialized"), await this.restore(), this.cached.forEach((o) => {
        this.getKey && o !== null && !he(o) ? this.map.set(this.getKey(o), o) : mx(o) ? this.map.set(o.id, o) : bx(o) && this.map.set(o.topic, o);
      }), this.cached = [], this.initialized = !0);
    }, this.set = async (o, a) => {
      this.isInitialized(), this.map.has(o) ? await this.update(o, a) : (this.logger.debug("Setting value"), this.logger.trace({ type: "method", method: "set", key: o, value: a }), this.map.set(o, a), await this.persist());
    }, this.get = (o) => (this.isInitialized(), this.logger.debug("Getting value"), this.logger.trace({ type: "method", method: "get", key: o }), this.getData(o)), this.getAll = (o) => (this.isInitialized(), o ? this.values.filter((a) => Object.keys(o).every((c) => QS(a[c], o[c]))) : this.values), this.update = async (o, a) => {
      this.isInitialized(), this.logger.debug("Updating value"), this.logger.trace({ type: "method", method: "update", key: o, update: a });
      const c = { ...this.getData(o), ...a };
      this.map.set(o, c), await this.persist();
    }, this.delete = async (o, a) => {
      this.isInitialized(), this.map.has(o) && (this.logger.debug("Deleting value"), this.logger.trace({ type: "method", method: "delete", key: o, reason: a }), this.map.delete(o), this.addToRecentlyDeleted(o), await this.persist());
    }, this.logger = ze(r, this.name), this.storagePrefix = n, this.getKey = i;
  }
  get context() {
    return Le(this.logger);
  }
  get storageKey() {
    return this.storagePrefix + this.version + this.core.customStoragePrefix + "//" + this.name;
  }
  get length() {
    return this.map.size;
  }
  get keys() {
    return Array.from(this.map.keys());
  }
  get values() {
    return Array.from(this.map.values());
  }
  addToRecentlyDeleted(e) {
    this.recentlyDeleted.push(e), this.recentlyDeleted.length >= this.recentlyDeletedLimit && this.recentlyDeleted.splice(0, this.recentlyDeletedLimit / 2);
  }
  async setDataStore(e) {
    await this.core.storage.setItem(this.storageKey, e);
  }
  async getDataStore() {
    return await this.core.storage.getItem(this.storageKey);
  }
  getData(e) {
    const r = this.map.get(e);
    if (!r) {
      if (this.recentlyDeleted.includes(e)) {
        const { message: n } = j("MISSING_OR_INVALID", `Record was recently deleted - ${this.name}: ${e}`);
        throw this.logger.error(n), new Error(n);
      }
      const { message: s } = j("NO_MATCHING_KEY", `${this.name}: ${e}`);
      throw this.logger.error(s), new Error(s);
    }
    return r;
  }
  async persist() {
    await this.setDataStore(this.values);
  }
  async restore() {
    try {
      const e = await this.getDataStore();
      if (typeof e > "u" || !e.length) return;
      if (this.map.size) {
        const { message: r } = j("RESTORE_WILL_OVERRIDE", this.name);
        throw this.logger.error(r), new Error(r);
      }
      this.cached = e, this.logger.debug(`Successfully Restored value for ${this.name}`), this.logger.trace({ type: "method", method: "restore", value: this.values });
    } catch (e) {
      this.logger.debug(`Failed to Restore value for ${this.name}`), this.logger.error(e);
    }
  }
  isInitialized() {
    if (!this.initialized) {
      const { message: e } = j("NOT_INITIALIZED", this.name);
      throw new Error(e);
    }
  }
};
class HI {
  constructor(e, r) {
    this.core = e, this.logger = r, this.name = EI, this.version = xI, this.events = new ea(), this.initialized = !1, this.storagePrefix = _t, this.ignoredPayloadTypes = [jt], this.registeredMethods = [], this.init = async () => {
      this.initialized || (await this.pairings.init(), await this.cleanup(), this.registerRelayerEvents(), this.registerExpirerEvents(), this.initialized = !0, this.logger.trace("Initialized"));
    }, this.register = ({ methods: s }) => {
      this.isInitialized(), this.registeredMethods = [.../* @__PURE__ */ new Set([...this.registeredMethods, ...s])];
    }, this.create = async (s) => {
      this.isInitialized();
      const n = Ho(), i = await this.core.crypto.setSymKey(n), o = ae(F.FIVE_MINUTES), a = { protocol: Fd }, c = { topic: i, expiry: o, relay: a, active: !1, methods: s?.methods }, l = Kl({ protocol: this.core.protocol, version: this.core.version, topic: i, symKey: n, relay: a, expiryTimestamp: o, methods: s?.methods });
      return this.events.emit(vr.create, c), this.core.expirer.set(i, o), await this.pairings.set(i, c), await this.core.relayer.subscribe(i, { transportType: s?.transportType, internal: s?.internal }), { topic: i, uri: l };
    }, this.pair = async (s) => {
      this.isInitialized();
      const n = this.core.eventClient.createEvent({ properties: { topic: s?.uri, trace: [dt.pairing_started] } });
      this.isValidPair(s, n);
      const { topic: i, symKey: o, relay: a, expiryTimestamp: c, methods: l } = Hl(s.uri);
      n.props.properties.topic = i, n.addTrace(dt.pairing_uri_validation_success), n.addTrace(dt.pairing_uri_not_expired);
      let u;
      if (this.pairings.keys.includes(i)) {
        if (u = this.pairings.get(i), n.addTrace(dt.existing_pairing), u.active) throw n.setError(Bt.active_pairing_already_exists), new Error(`Pairing already exists: ${i}. Please try again with a new connection URI.`);
        n.addTrace(dt.pairing_not_expired);
      }
      const h = c || ae(F.FIVE_MINUTES), f = { topic: i, relay: a, expiry: h, active: !1, methods: l };
      this.core.expirer.set(i, h), await this.pairings.set(i, f), n.addTrace(dt.store_new_pairing), s.activatePairing && await this.activate({ topic: i }), this.events.emit(vr.create, f), n.addTrace(dt.emit_inactive_pairing), this.core.crypto.keychain.has(i) || await this.core.crypto.setSymKey(o, i), n.addTrace(dt.subscribing_pairing_topic);
      try {
        await this.core.relayer.confirmOnlineStateOrThrow();
      } catch {
        n.setError(Bt.no_internet_connection);
      }
      try {
        await this.core.relayer.subscribe(i, { relay: a });
      } catch (g) {
        throw n.setError(Bt.subscribe_pairing_topic_failure), g;
      }
      return n.addTrace(dt.subscribe_pairing_topic_success), f;
    }, this.activate = async ({ topic: s }) => {
      this.isInitialized();
      const n = ae(F.FIVE_MINUTES);
      this.core.expirer.set(s, n), await this.pairings.update(s, { active: !0, expiry: n });
    }, this.ping = async (s) => {
      this.isInitialized(), await this.isValidPing(s), this.logger.warn("ping() is deprecated and will be removed in the next major release.");
      const { topic: n } = s;
      if (this.pairings.keys.includes(n)) {
        const i = await this.sendRequest(n, "wc_pairingPing", {}), { done: o, resolve: a, reject: c } = mr();
        this.events.once(J("pairing_ping", i), ({ error: l }) => {
          l ? c(l) : a();
        }), await o();
      }
    }, this.updateExpiry = async ({ topic: s, expiry: n }) => {
      this.isInitialized(), await this.pairings.update(s, { expiry: n });
    }, this.updateMetadata = async ({ topic: s, metadata: n }) => {
      this.isInitialized(), await this.pairings.update(s, { peerMetadata: n });
    }, this.getPairings = () => (this.isInitialized(), this.pairings.values), this.disconnect = async (s) => {
      this.isInitialized(), await this.isValidDisconnect(s);
      const { topic: n } = s;
      this.pairings.keys.includes(n) && (await this.sendRequest(n, "wc_pairingDelete", Q("USER_DISCONNECTED")), await this.deletePairing(n));
    }, this.formatUriFromPairing = (s) => {
      this.isInitialized();
      const { topic: n, relay: i, expiry: o, methods: a } = s, c = this.core.crypto.keychain.get(n);
      return Kl({ protocol: this.core.protocol, version: this.core.version, topic: n, symKey: c, relay: i, expiryTimestamp: o, methods: a });
    }, this.sendRequest = async (s, n, i) => {
      const o = ot(n, i), a = await this.core.crypto.encode(s, o), c = ds[n].req;
      return this.core.history.set(s, o), this.core.relayer.publish(s, a, c), o.id;
    }, this.sendResult = async (s, n, i) => {
      const o = Bs(s, i), a = await this.core.crypto.encode(n, o), c = (await this.core.history.get(n, s)).request.method, l = ds[c].res;
      await this.core.relayer.publish(n, a, l), await this.core.history.resolve(o);
    }, this.sendError = async (s, n, i) => {
      const o = ci(s, i), a = await this.core.crypto.encode(n, o), c = (await this.core.history.get(n, s)).request.method, l = ds[c] ? ds[c].res : ds.unregistered_method.res;
      await this.core.relayer.publish(n, a, l), await this.core.history.resolve(o);
    }, this.deletePairing = async (s, n) => {
      await this.core.relayer.unsubscribe(s), await Promise.all([this.pairings.delete(s, Q("USER_DISCONNECTED")), this.core.crypto.deleteSymKey(s), n ? Promise.resolve() : this.core.expirer.del(s)]);
    }, this.cleanup = async () => {
      const s = this.pairings.getAll().filter((n) => wt(n.expiry));
      await Promise.all(s.map((n) => this.deletePairing(n.topic)));
    }, this.onRelayEventRequest = async (s) => {
      const { topic: n, payload: i } = s;
      switch (i.method) {
        case "wc_pairingPing":
          return await this.onPairingPingRequest(n, i);
        case "wc_pairingDelete":
          return await this.onPairingDeleteRequest(n, i);
        default:
          return await this.onUnknownRpcMethodRequest(n, i);
      }
    }, this.onRelayEventResponse = async (s) => {
      const { topic: n, payload: i } = s, o = (await this.core.history.get(n, i.id)).request.method;
      switch (o) {
        case "wc_pairingPing":
          return this.onPairingPingResponse(n, i);
        default:
          return this.onUnknownRpcMethodResponse(o);
      }
    }, this.onPairingPingRequest = async (s, n) => {
      const { id: i } = n;
      try {
        this.isValidPing({ topic: s }), await this.sendResult(i, s, !0), this.events.emit(vr.ping, { id: i, topic: s });
      } catch (o) {
        await this.sendError(i, s, o), this.logger.error(o);
      }
    }, this.onPairingPingResponse = (s, n) => {
      const { id: i } = n;
      setTimeout(() => {
        gt(n) ? this.events.emit(J("pairing_ping", i), {}) : Ye(n) && this.events.emit(J("pairing_ping", i), { error: n.error });
      }, 500);
    }, this.onPairingDeleteRequest = async (s, n) => {
      const { id: i } = n;
      try {
        this.isValidDisconnect({ topic: s }), await this.deletePairing(s), this.events.emit(vr.delete, { id: i, topic: s });
      } catch (o) {
        await this.sendError(i, s, o), this.logger.error(o);
      }
    }, this.onUnknownRpcMethodRequest = async (s, n) => {
      const { id: i, method: o } = n;
      try {
        if (this.registeredMethods.includes(o)) return;
        const a = Q("WC_METHOD_UNSUPPORTED", o);
        await this.sendError(i, s, a), this.logger.error(a);
      } catch (a) {
        await this.sendError(i, s, a), this.logger.error(a);
      }
    }, this.onUnknownRpcMethodResponse = (s) => {
      this.registeredMethods.includes(s) || this.logger.error(Q("WC_METHOD_UNSUPPORTED", s));
    }, this.isValidPair = (s, n) => {
      if (!Be(s)) {
        const { message: o } = j("MISSING_OR_INVALID", `pair() params: ${s}`);
        throw n.setError(Bt.malformed_pairing_uri), new Error(o);
      }
      if (!wx(s.uri)) {
        const { message: o } = j("MISSING_OR_INVALID", `pair() uri: ${s.uri}`);
        throw n.setError(Bt.malformed_pairing_uri), new Error(o);
      }
      const i = Hl(s?.uri);
      if (!i?.relay?.protocol) {
        const { message: o } = j("MISSING_OR_INVALID", "pair() uri#relay-protocol");
        throw n.setError(Bt.malformed_pairing_uri), new Error(o);
      }
      if (!i?.symKey) {
        const { message: o } = j("MISSING_OR_INVALID", "pair() uri#symKey");
        throw n.setError(Bt.malformed_pairing_uri), new Error(o);
      }
      if (i?.expiryTimestamp && F.toMiliseconds(i?.expiryTimestamp) < Date.now()) {
        n.setError(Bt.pairing_expired);
        const { message: o } = j("EXPIRED", "pair() URI has expired. Please try again with a new connection URI.");
        throw new Error(o);
      }
    }, this.isValidPing = async (s) => {
      if (!Be(s)) {
        const { message: i } = j("MISSING_OR_INVALID", `ping() params: ${s}`);
        throw new Error(i);
      }
      const { topic: n } = s;
      await this.isValidPairingTopic(n);
    }, this.isValidDisconnect = async (s) => {
      if (!Be(s)) {
        const { message: i } = j("MISSING_OR_INVALID", `disconnect() params: ${s}`);
        throw new Error(i);
      }
      const { topic: n } = s;
      await this.isValidPairingTopic(n);
    }, this.isValidPairingTopic = async (s) => {
      if (!ce(s, !1)) {
        const { message: n } = j("MISSING_OR_INVALID", `pairing topic should be a string: ${s}`);
        throw new Error(n);
      }
      if (!this.pairings.keys.includes(s)) {
        const { message: n } = j("NO_MATCHING_KEY", `pairing topic doesn't exist: ${s}`);
        throw new Error(n);
      }
      if (wt(this.pairings.get(s).expiry)) {
        await this.deletePairing(s);
        const { message: n } = j("EXPIRED", `pairing topic: ${s}`);
        throw new Error(n);
      }
    }, this.core = e, this.logger = ze(r, this.name), this.pairings = new Lr(this.core, this.logger, this.name, this.storagePrefix);
  }
  get context() {
    return Le(this.logger);
  }
  isInitialized() {
    if (!this.initialized) {
      const { message: e } = j("NOT_INITIALIZED", this.name);
      throw new Error(e);
    }
  }
  registerRelayerEvents() {
    this.core.relayer.on(se.message, async (e) => {
      const { topic: r, message: s, transportType: n } = e;
      if (this.pairings.keys.includes(r) && n !== te.link_mode) {
        try {
          if (this.core.crypto.getPayloadType(s, mt) === Br) {
            this.logger.warn(`registerRelayerEvents() -> non-link mode TYPE_2 payload ignored: ${s}`);
            return;
          }
        } catch {
        }
        if (!this.ignoredPayloadTypes.includes(this.core.crypto.getPayloadType(s))) try {
          const i = await this.core.crypto.decode(r, s);
          Na(i) ? (this.core.history.set(r, i), await this.onRelayEventRequest({ topic: r, payload: i })) : li(i) && (await this.core.history.resolve(i), await this.onRelayEventResponse({ topic: r, payload: i }), this.core.history.delete(r, i.id)), await this.core.relayer.messages.ack(r, s);
        } catch (i) {
          this.logger.error(i);
        }
      }
    });
  }
  registerExpirerEvents() {
    this.core.expirer.on(Ve.expired, async (e) => {
      const { topic: r } = Qf(e.target);
      r && this.pairings.keys.includes(r) && (await this.deletePairing(r, !0), this.events.emit(vr.expire, { topic: r }));
    });
  }
}
class KI extends M_ {
  constructor(e, r) {
    super(e, r), this.core = e, this.logger = r, this.records = /* @__PURE__ */ new Map(), this.events = new je.EventEmitter(), this.name = _I, this.version = SI, this.cached = [], this.initialized = !1, this.storagePrefix = _t, this.init = async () => {
      this.initialized || (this.logger.trace("Initialized"), await this.restore(), this.cached.forEach((s) => this.records.set(s.id, s)), this.cached = [], this.registerEventListeners(), this.initialized = !0);
    }, this.set = (s, n, i) => {
      if (this.isInitialized(), this.logger.debug("Setting JSON-RPC request history record"), this.logger.trace({ type: "method", method: "set", topic: s, request: n, chainId: i }), this.records.has(n.id)) return;
      const o = { id: n.id, topic: s, request: { method: n.method, params: n.params || null }, chainId: i, expiry: ae(F.THIRTY_DAYS) };
      this.records.set(o.id, o), this.persist(), this.events.emit(tt.created, o);
    }, this.resolve = async (s) => {
      if (this.isInitialized(), this.logger.debug("Updating JSON-RPC response history record"), this.logger.trace({ type: "method", method: "update", response: s }), !this.records.has(s.id)) return;
      const n = await this.getRecord(s.id);
      typeof n.response < "u" || (n.response = Ye(s) ? { error: s.error } : { result: s.result }, this.records.set(n.id, n), this.persist(), this.events.emit(tt.updated, n));
    }, this.get = async (s, n) => (this.isInitialized(), this.logger.debug("Getting record"), this.logger.trace({ type: "method", method: "get", topic: s, id: n }), await this.getRecord(n)), this.delete = (s, n) => {
      this.isInitialized(), this.logger.debug("Deleting record"), this.logger.trace({ type: "method", method: "delete", id: n }), this.values.forEach((i) => {
        if (i.topic === s) {
          if (typeof n < "u" && i.id !== n) return;
          this.records.delete(i.id), this.events.emit(tt.deleted, i);
        }
      }), this.persist();
    }, this.exists = async (s, n) => (this.isInitialized(), this.records.has(n) ? (await this.getRecord(n)).topic === s : !1), this.on = (s, n) => {
      this.events.on(s, n);
    }, this.once = (s, n) => {
      this.events.once(s, n);
    }, this.off = (s, n) => {
      this.events.off(s, n);
    }, this.removeListener = (s, n) => {
      this.events.removeListener(s, n);
    }, this.logger = ze(r, this.name);
  }
  get context() {
    return Le(this.logger);
  }
  get storageKey() {
    return this.storagePrefix + this.version + this.core.customStoragePrefix + "//" + this.name;
  }
  get size() {
    return this.records.size;
  }
  get keys() {
    return Array.from(this.records.keys());
  }
  get values() {
    return Array.from(this.records.values());
  }
  get pending() {
    const e = [];
    return this.values.forEach((r) => {
      if (typeof r.response < "u") return;
      const s = { topic: r.topic, request: ot(r.request.method, r.request.params, r.id), chainId: r.chainId };
      return e.push(s);
    }), e;
  }
  async setJsonRpcRecords(e) {
    await this.core.storage.setItem(this.storageKey, e);
  }
  async getJsonRpcRecords() {
    return await this.core.storage.getItem(this.storageKey);
  }
  getRecord(e) {
    this.isInitialized();
    const r = this.records.get(e);
    if (!r) {
      const { message: s } = j("NO_MATCHING_KEY", `${this.name}: ${e}`);
      throw new Error(s);
    }
    return r;
  }
  async persist() {
    await this.setJsonRpcRecords(this.values), this.events.emit(tt.sync);
  }
  async restore() {
    try {
      const e = await this.getJsonRpcRecords();
      if (typeof e > "u" || !e.length) return;
      if (this.records.size) {
        const { message: r } = j("RESTORE_WILL_OVERRIDE", this.name);
        throw this.logger.error(r), new Error(r);
      }
      this.cached = e, this.logger.debug(`Successfully Restored records for ${this.name}`), this.logger.trace({ type: "method", method: "restore", records: this.values });
    } catch (e) {
      this.logger.debug(`Failed to Restore records for ${this.name}`), this.logger.error(e);
    }
  }
  registerEventListeners() {
    this.events.on(tt.created, (e) => {
      const r = tt.created;
      this.logger.info(`Emitting ${r}`), this.logger.debug({ type: "event", event: r, record: e });
    }), this.events.on(tt.updated, (e) => {
      const r = tt.updated;
      this.logger.info(`Emitting ${r}`), this.logger.debug({ type: "event", event: r, record: e });
    }), this.events.on(tt.deleted, (e) => {
      const r = tt.deleted;
      this.logger.info(`Emitting ${r}`), this.logger.debug({ type: "event", event: r, record: e });
    }), this.core.heartbeat.on(Nr.pulse, () => {
      this.cleanup();
    });
  }
  cleanup() {
    try {
      this.isInitialized();
      let e = !1;
      this.records.forEach((r) => {
        F.toMiliseconds(r.expiry || 0) - Date.now() <= 0 && (this.logger.info(`Deleting expired history log: ${r.id}`), this.records.delete(r.id), this.events.emit(tt.deleted, r, !1), e = !0);
      }), e && this.persist();
    } catch (e) {
      this.logger.warn(e);
    }
  }
  isInitialized() {
    if (!this.initialized) {
      const { message: e } = j("NOT_INITIALIZED", this.name);
      throw new Error(e);
    }
  }
}
class VI extends H_ {
  constructor(e, r) {
    super(e, r), this.core = e, this.logger = r, this.expirations = /* @__PURE__ */ new Map(), this.events = new je.EventEmitter(), this.name = II, this.version = DI, this.cached = [], this.initialized = !1, this.storagePrefix = _t, this.init = async () => {
      this.initialized || (this.logger.trace("Initialized"), await this.restore(), this.cached.forEach((s) => this.expirations.set(s.target, s)), this.cached = [], this.registerEventListeners(), this.initialized = !0);
    }, this.has = (s) => {
      try {
        const n = this.formatTarget(s);
        return typeof this.getExpiration(n) < "u";
      } catch {
        return !1;
      }
    }, this.set = (s, n) => {
      this.isInitialized();
      const i = this.formatTarget(s), o = { target: i, expiry: n };
      this.expirations.set(i, o), this.checkExpiry(i, o), this.events.emit(Ve.created, { target: i, expiration: o });
    }, this.get = (s) => {
      this.isInitialized();
      const n = this.formatTarget(s);
      return this.getExpiration(n);
    }, this.del = (s) => {
      if (this.isInitialized(), this.has(s)) {
        const n = this.formatTarget(s), i = this.getExpiration(n);
        this.expirations.delete(n), this.events.emit(Ve.deleted, { target: n, expiration: i });
      }
    }, this.on = (s, n) => {
      this.events.on(s, n);
    }, this.once = (s, n) => {
      this.events.once(s, n);
    }, this.off = (s, n) => {
      this.events.off(s, n);
    }, this.removeListener = (s, n) => {
      this.events.removeListener(s, n);
    }, this.logger = ze(r, this.name);
  }
  get context() {
    return Le(this.logger);
  }
  get storageKey() {
    return this.storagePrefix + this.version + this.core.customStoragePrefix + "//" + this.name;
  }
  get length() {
    return this.expirations.size;
  }
  get keys() {
    return Array.from(this.expirations.keys());
  }
  get values() {
    return Array.from(this.expirations.values());
  }
  formatTarget(e) {
    if (typeof e == "string") return o2(e);
    if (typeof e == "number") return a2(e);
    const { message: r } = j("UNKNOWN_TYPE", `Target type: ${typeof e}`);
    throw new Error(r);
  }
  async setExpirations(e) {
    await this.core.storage.setItem(this.storageKey, e);
  }
  async getExpirations() {
    return await this.core.storage.getItem(this.storageKey);
  }
  async persist() {
    await this.setExpirations(this.values), this.events.emit(Ve.sync);
  }
  async restore() {
    try {
      const e = await this.getExpirations();
      if (typeof e > "u" || !e.length) return;
      if (this.expirations.size) {
        const { message: r } = j("RESTORE_WILL_OVERRIDE", this.name);
        throw this.logger.error(r), new Error(r);
      }
      this.cached = e, this.logger.debug(`Successfully Restored expirations for ${this.name}`), this.logger.trace({ type: "method", method: "restore", expirations: this.values });
    } catch (e) {
      this.logger.debug(`Failed to Restore expirations for ${this.name}`), this.logger.error(e);
    }
  }
  getExpiration(e) {
    const r = this.expirations.get(e);
    if (!r) {
      const { message: s } = j("NO_MATCHING_KEY", `${this.name}: ${e}`);
      throw this.logger.warn(s), new Error(s);
    }
    return r;
  }
  checkExpiry(e, r) {
    const { expiry: s } = r;
    F.toMiliseconds(s) - Date.now() <= 0 && this.expire(e, r);
  }
  expire(e, r) {
    this.expirations.delete(e), this.events.emit(Ve.expired, { target: e, expiration: r });
  }
  checkExpirations() {
    this.core.relayer.connected && this.expirations.forEach((e, r) => this.checkExpiry(r, e));
  }
  registerEventListeners() {
    this.core.heartbeat.on(Nr.pulse, () => this.checkExpirations()), this.events.on(Ve.created, (e) => {
      const r = Ve.created;
      this.logger.info(`Emitting ${r}`), this.logger.debug({ type: "event", event: r, data: e }), this.persist();
    }), this.events.on(Ve.expired, (e) => {
      const r = Ve.expired;
      this.logger.info(`Emitting ${r}`), this.logger.debug({ type: "event", event: r, data: e }), this.persist();
    }), this.events.on(Ve.deleted, (e) => {
      const r = Ve.deleted;
      this.logger.info(`Emitting ${r}`), this.logger.debug({ type: "event", event: r, data: e }), this.persist();
    });
  }
  isInitialized() {
    if (!this.initialized) {
      const { message: e } = j("NOT_INITIALIZED", this.name);
      throw new Error(e);
    }
  }
}
class WI extends K_ {
  constructor(e, r, s) {
    super(e, r, s), this.core = e, this.logger = r, this.store = s, this.name = AI, this.verifyUrlV3 = $I, this.storagePrefix = _t, this.version = qd, this.init = async () => {
      this.isDevEnv || (this.publicKey = await this.store.getItem(this.storeKey), this.publicKey && F.toMiliseconds(this.publicKey?.expiresAt) < Date.now() && (this.logger.debug("verify v2 public key expired"), await this.removePublicKey()));
    }, this.register = async (n) => {
      if (!rs() || this.isDevEnv) return;
      const i = window.location.origin, { id: o, decryptedId: a } = n, c = `${this.verifyUrlV3}/attestation?projectId=${this.core.projectId}&origin=${i}&id=${o}&decryptedId=${a}`;
      try {
        const l = zt.getDocument(), u = this.startAbortTimer(F.ONE_SECOND * 5), h = await new Promise((f, g) => {
          const p = () => {
            window.removeEventListener("message", m), l.body.removeChild(y), g("attestation aborted");
          };
          this.abortController.signal.addEventListener("abort", p);
          const y = l.createElement("iframe");
          y.src = c, y.style.display = "none", y.addEventListener("error", p, { signal: this.abortController.signal });
          const m = (E) => {
            if (E.data && typeof E.data == "string") try {
              const $ = JSON.parse(E.data);
              if ($.type === "verify_attestation") {
                if (Mo($.attestation).payload.id !== o) return;
                clearInterval(u), l.body.removeChild(y), this.abortController.signal.removeEventListener("abort", p), window.removeEventListener("message", m), f($.attestation === null ? "" : $.attestation);
              }
            } catch ($) {
              this.logger.warn($);
            }
          };
          l.body.appendChild(y), window.addEventListener("message", m, { signal: this.abortController.signal });
        });
        return this.logger.debug(h, "jwt attestation"), h;
      } catch (l) {
        this.logger.warn(l);
      }
      return "";
    }, this.resolve = async (n) => {
      if (this.isDevEnv) return "";
      const { attestationId: i, hash: o, encryptedId: a } = n;
      if (i === "") {
        this.logger.debug("resolve: attestationId is empty, skipping");
        return;
      }
      if (i) {
        if (Mo(i).payload.id !== a) return;
        const l = await this.isValidJwtAttestation(i);
        if (l) {
          if (!l.isVerified) {
            this.logger.warn("resolve: jwt attestation: origin url not verified");
            return;
          }
          return l;
        }
      }
      if (!o) return;
      const c = this.getVerifyUrl(n?.verifyUrl);
      return this.fetchAttestation(o, c);
    }, this.fetchAttestation = async (n, i) => {
      this.logger.debug(`resolving attestation: ${n} from url: ${i}`);
      const o = this.startAbortTimer(F.ONE_SECOND * 5), a = await fetch(`${i}/attestation/${n}?v2Supported=true`, { signal: this.abortController.signal });
      return clearTimeout(o), a.status === 200 ? await a.json() : void 0;
    }, this.getVerifyUrl = (n) => {
      let i = n || _s;
      return PI.includes(i) || (this.logger.info(`verify url: ${i}, not included in trusted list, assigning default: ${_s}`), i = _s), i;
    }, this.fetchPublicKey = async () => {
      try {
        this.logger.debug(`fetching public key from: ${this.verifyUrlV3}`);
        const n = this.startAbortTimer(F.FIVE_SECONDS), i = await fetch(`${this.verifyUrlV3}/public-key`, { signal: this.abortController.signal });
        return clearTimeout(n), await i.json();
      } catch (n) {
        this.logger.warn(n);
      }
    }, this.persistPublicKey = async (n) => {
      this.logger.debug(n, "persisting public key to local storage"), await this.store.setItem(this.storeKey, n), this.publicKey = n;
    }, this.removePublicKey = async () => {
      this.logger.debug("removing verify v2 public key from storage"), await this.store.removeItem(this.storeKey), this.publicKey = void 0;
    }, this.isValidJwtAttestation = async (n) => {
      const i = await this.getPublicKey();
      try {
        if (i) return this.validateAttestation(n, i);
      } catch (a) {
        this.logger.error(a), this.logger.warn("error validating attestation");
      }
      const o = await this.fetchAndPersistPublicKey();
      try {
        if (o) return this.validateAttestation(n, o);
      } catch (a) {
        this.logger.error(a), this.logger.warn("error validating attestation");
      }
    }, this.getPublicKey = async () => this.publicKey ? this.publicKey : await this.fetchAndPersistPublicKey(), this.fetchAndPersistPublicKey = async () => {
      if (this.fetchPromise) return await this.fetchPromise, this.publicKey;
      this.fetchPromise = new Promise(async (i) => {
        const o = await this.fetchPublicKey();
        o && (await this.persistPublicKey(o), i(o));
      });
      const n = await this.fetchPromise;
      return this.fetchPromise = void 0, n;
    }, this.validateAttestation = (n, i) => {
      const o = nx(n, i.publicKey), a = { hasExpired: F.toMiliseconds(o.exp) < Date.now(), payload: o };
      if (a.hasExpired) throw this.logger.warn("resolve: jwt attestation expired"), new Error("JWT attestation expired");
      return { origin: a.payload.origin, isScam: a.payload.isScam, isVerified: a.payload.isVerified };
    }, this.logger = ze(r, this.name), this.abortController = new AbortController(), this.isDevEnv = $a(), this.init();
  }
  get storeKey() {
    return this.storagePrefix + this.version + this.core.customStoragePrefix + "//verify:public:key";
  }
  get context() {
    return Le(this.logger);
  }
  startAbortTimer(e) {
    return this.abortController = new AbortController(), setTimeout(() => this.abortController.abort(), F.toMiliseconds(e));
  }
}
class GI extends V_ {
  constructor(e, r) {
    super(e, r), this.projectId = e, this.logger = r, this.context = TI, this.registerDeviceToken = async (s) => {
      const { clientId: n, token: i, notificationType: o, enableEncrypted: a = !1 } = s, c = `${BI}/${this.projectId}/clients`;
      await fetch(c, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: n, type: o, token: i, always_raw: a }) });
    }, this.logger = ze(r, this.context);
  }
}
let YI = class extends W_ {
  constructor(e, r, s = !0) {
    super(e, r, s), this.core = e, this.logger = r, this.context = CI, this.storagePrefix = _t, this.storageVersion = RI, this.events = /* @__PURE__ */ new Map(), this.shouldPersist = !1, this.init = async (n) => {
      if ($a()) return;
      const i = n?.sdk;
      try {
        const o = { eventId: Rl(), timestamp: Date.now(), domain: this.getAppDomain(), props: { event: "INIT", type: "", properties: { client_id: await this.core.crypto.getClientId(), user_agent: Xf(this.core.relayer.protocol, this.core.relayer.version, Xo), ...i?.name && i.version ? { sdk_name: i.name, sdk_version: i.version } : {} } } };
        await this.sendEvent([o]);
      } catch (o) {
        this.logger.warn(o);
      }
    }, this.createEvent = (n) => {
      const { event: i = "ERROR", type: o = "", properties: { topic: a, trace: c } } = n, l = Rl(), u = this.core.projectId || "", h = Date.now(), f = { eventId: l, timestamp: h, props: { event: i, type: o, properties: { topic: a, trace: c } }, bundleId: u, domain: this.getAppDomain(), ...this.setMethods(l) };
      return this.telemetryEnabled && (this.events.set(l, f), this.shouldPersist = !0), f;
    }, this.getEvent = (n) => {
      const { eventId: i, topic: o } = n;
      if (i) return this.events.get(i);
      const a = Array.from(this.events.values()).find((c) => c.props.properties.topic === o);
      if (a) return { ...a, ...this.setMethods(a.eventId) };
    }, this.deleteEvent = (n) => {
      const { eventId: i } = n;
      this.events.delete(i), this.shouldPersist = !0;
    }, this.setEventListeners = () => {
      this.core.heartbeat.on(Nr.pulse, async () => {
        this.shouldPersist && await this.persist(), this.events.forEach((n) => {
          F.fromMiliseconds(Date.now()) - F.fromMiliseconds(n.timestamp) > NI && (this.events.delete(n.eventId), this.shouldPersist = !0);
        });
      });
    }, this.setMethods = (n) => ({ addTrace: (i) => this.addTrace(n, i), setError: (i) => this.setError(n, i) }), this.addTrace = (n, i) => {
      const o = this.events.get(n);
      o && (o.props.properties.trace.push(i), this.events.set(n, o), this.shouldPersist = !0);
    }, this.setError = (n, i) => {
      const o = this.events.get(n);
      o && (o.props.type = i, o.timestamp = Date.now(), this.events.set(n, o), this.shouldPersist = !0);
    }, this.persist = async () => {
      await this.core.storage.setItem(this.storageKey, Array.from(this.events.values())), this.shouldPersist = !1;
    }, this.restore = async () => {
      try {
        const n = await this.core.storage.getItem(this.storageKey) || [];
        if (!n.length) return;
        n.forEach((i) => {
          this.events.set(i.eventId, { ...i, ...this.setMethods(i.eventId) });
        });
      } catch (n) {
        this.logger.warn(n);
      }
    }, this.submit = async () => {
      if (!this.telemetryEnabled || this.events.size === 0) return;
      const n = [];
      for (const [i, o] of this.events) o.props.type && n.push(o);
      if (n.length !== 0) try {
        if ((await this.sendEvent(n)).ok) for (const i of n) this.events.delete(i.eventId), this.shouldPersist = !0;
      } catch (i) {
        this.logger.warn(i);
      }
    }, this.sendEvent = async (n) => {
      const i = this.getAppDomain() ? "" : "&sp=desktop";
      return await fetch(`${UI}?projectId=${this.core.projectId}&st=events_sdk&sv=js-${Xo}${i}`, { method: "POST", body: JSON.stringify(n) });
    }, this.getAppDomain = () => Zf().url, this.logger = ze(r, this.context), this.telemetryEnabled = s, s ? this.restore().then(async () => {
      await this.submit(), this.setEventListeners();
    }) : this.persist();
  }
  get storageKey() {
    return this.storagePrefix + this.storageVersion + this.core.customStoragePrefix + "//" + this.context;
  }
}, ZI = class Hd extends L_ {
  constructor(e) {
    super(e), this.protocol = kd, this.version = qd, this.name = Zo, this.events = new je.EventEmitter(), this.initialized = !1, this.on = (o, a) => this.events.on(o, a), this.once = (o, a) => this.events.once(o, a), this.off = (o, a) => this.events.off(o, a), this.removeListener = (o, a) => this.events.removeListener(o, a), this.dispatchEnvelope = ({ topic: o, message: a, sessionExists: c }) => {
      if (!o || !a) return;
      const l = { topic: o, message: a, publishedAt: Date.now(), transportType: te.link_mode };
      this.relayer.onLinkMessageEvent(l, { sessionExists: c });
    };
    const r = this.getGlobalCore(e?.customStoragePrefix);
    if (r) try {
      return this.customStoragePrefix = r.customStoragePrefix, this.logger = r.logger, this.heartbeat = r.heartbeat, this.crypto = r.crypto, this.history = r.history, this.expirer = r.expirer, this.storage = r.storage, this.relayer = r.relayer, this.pairing = r.pairing, this.verify = r.verify, this.echoClient = r.echoClient, this.linkModeSupportedApps = r.linkModeSupportedApps, this.eventClient = r.eventClient, this.initialized = r.initialized, this.logChunkController = r.logChunkController, r;
    } catch (o) {
      console.warn("Failed to copy global core", o);
    }
    this.projectId = e?.projectId, this.relayUrl = e?.relayUrl || jd, this.customStoragePrefix = e?.customStoragePrefix ? `:${e.customStoragePrefix}` : "";
    const s = zE({ level: typeof e?.logger == "string" && e.logger ? e.logger : sI.logger, name: Zo }), { logger: n, chunkLoggerController: i } = Gf({ opts: s, maxSizeInBytes: e?.maxLogBlobSizeInBytes, loggerOverride: e?.logger });
    this.logChunkController = i, this.logChunkController?.downloadLogsBlobInBrowser && (window.downloadLogsBlobInBrowser = async () => {
      this.logChunkController?.downloadLogsBlobInBrowser && this.logChunkController?.downloadLogsBlobInBrowser({ clientId: await this.crypto.getClientId() });
    }), this.logger = ze(n, this.name), this.heartbeat = new Ra(), this.crypto = new MI(this, this.logger, e?.keychain), this.history = new KI(this, this.logger), this.expirer = new VI(this, this.logger), this.storage = e?.storage ? e.storage : new U_({ ...nI, ...e?.storageOptions }), this.relayer = new zI({ core: this, logger: this.logger, relayUrl: this.relayUrl, projectId: this.projectId }), this.pairing = new HI(this, this.logger), this.verify = new WI(this, this.logger, this.storage), this.echoClient = new GI(this.projectId || "", this.logger), this.linkModeSupportedApps = [], this.eventClient = new YI(this, this.logger, e?.telemetryEnabled), this.setGlobalCore(this);
  }
  static async init(e) {
    const r = new Hd(e);
    await r.initialize();
    const s = await r.crypto.getClientId();
    return await r.storage.setItem(mI, s), r;
  }
  get context() {
    return Le(this.logger);
  }
  async start() {
    this.initialized || await this.initialize();
  }
  async getLogsBlob() {
    return this.logChunkController?.logsToBlob({ clientId: await this.crypto.getClientId() });
  }
  async addLinkModeSupportedApp(e) {
    this.linkModeSupportedApps.includes(e) || (this.linkModeSupportedApps.push(e), await this.storage.setItem(yu, this.linkModeSupportedApps));
  }
  async initialize() {
    this.logger.trace("Initialized");
    try {
      await this.crypto.init(), await this.history.init(), await this.expirer.init(), await this.relayer.init(), await this.heartbeat.init(), await this.pairing.init(), this.linkModeSupportedApps = await this.storage.getItem(yu) || [], this.initialized = !0, this.logger.info("Core Initialization Success");
    } catch (e) {
      throw this.logger.warn(e, `Core Initialization Failure at epoch ${Date.now()}`), this.logger.error(e.message), e;
    }
  }
  getGlobalCore(e = "") {
    try {
      if (this.isGlobalCoreDisabled()) return;
      const r = `_walletConnectCore_${e}`, s = `${r}_count`;
      return globalThis[s] = (globalThis[s] || 0) + 1, globalThis[s] > 1 && console.warn(`WalletConnect Core is already initialized. This is probably a mistake and can lead to unexpected behavior. Init() was called ${globalThis[s]} times.`), globalThis[r];
    } catch (r) {
      console.warn("Failed to get global WalletConnect core", r);
      return;
    }
  }
  setGlobalCore(e) {
    try {
      if (this.isGlobalCoreDisabled()) return;
      const r = `_walletConnectCore_${e.opts?.customStoragePrefix || ""}`;
      globalThis[r] = e;
    } catch (r) {
      console.warn("Failed to set global WalletConnect core", r);
    }
  }
  isGlobalCoreDisabled() {
    try {
      return typeof process < "u" && process.env.DISABLE_GLOBAL_CORE === "true";
    } catch {
      return !0;
    }
  }
};
const XI = ZI, Kd = "wc", Vd = 2, Wd = "client", ja = `${Kd}@${Vd}:${Wd}:`, ao = { name: Wd, logger: "error" }, wu = "WALLETCONNECT_DEEPLINK_CHOICE", JI = "proposal", mu = "Proposal expired", QI = "session", jr = F.SEVEN_DAYS, e3 = "engine", me = { wc_sessionPropose: { req: { ttl: F.FIVE_MINUTES, prompt: !0, tag: 1100 }, res: { ttl: F.FIVE_MINUTES, prompt: !1, tag: 1101 }, reject: { ttl: F.FIVE_MINUTES, prompt: !1, tag: 1120 }, autoReject: { ttl: F.FIVE_MINUTES, prompt: !1, tag: 1121 } }, wc_sessionSettle: { req: { ttl: F.FIVE_MINUTES, prompt: !1, tag: 1102 }, res: { ttl: F.FIVE_MINUTES, prompt: !1, tag: 1103 } }, wc_sessionUpdate: { req: { ttl: F.ONE_DAY, prompt: !1, tag: 1104 }, res: { ttl: F.ONE_DAY, prompt: !1, tag: 1105 } }, wc_sessionExtend: { req: { ttl: F.ONE_DAY, prompt: !1, tag: 1106 }, res: { ttl: F.ONE_DAY, prompt: !1, tag: 1107 } }, wc_sessionRequest: { req: { ttl: F.FIVE_MINUTES * 3, prompt: !0, tag: 1108 }, res: { ttl: F.FIVE_MINUTES * 3, prompt: !1, tag: 1109 } }, wc_sessionEvent: { req: { ttl: F.FIVE_MINUTES, prompt: !0, tag: 1110 }, res: { ttl: F.FIVE_MINUTES, prompt: !1, tag: 1111 } }, wc_sessionDelete: { req: { ttl: F.ONE_DAY, prompt: !1, tag: 1112 }, res: { ttl: F.ONE_DAY, prompt: !1, tag: 1113 } }, wc_sessionPing: { req: { ttl: F.ONE_DAY, prompt: !1, tag: 1114 }, res: { ttl: F.ONE_DAY, prompt: !1, tag: 1115 } }, wc_sessionAuthenticate: { req: { ttl: F.ONE_HOUR, prompt: !0, tag: 1116 }, res: { ttl: F.ONE_HOUR, prompt: !1, tag: 1117 }, reject: { ttl: F.FIVE_MINUTES, prompt: !1, tag: 1118 }, autoReject: { ttl: F.FIVE_MINUTES, prompt: !1, tag: 1119 } } }, co = { min: F.FIVE_MINUTES, max: F.SEVEN_DAYS }, ft = { idle: "IDLE", active: "ACTIVE" }, t3 = { eth_sendTransaction: { key: "" }, eth_sendRawTransaction: { key: "" }, wallet_sendCalls: { key: "" }, solana_signTransaction: { key: "signature" }, solana_signAllTransactions: { key: "transactions" }, solana_signAndSendTransaction: { key: "signature" }, sui_signAndExecuteTransaction: { key: "digest" }, sui_signTransaction: { key: "" }, hedera_signAndExecuteTransaction: { key: "transactionId" }, hedera_executeTransaction: { key: "transactionId" }, near_signTransaction: { key: "" }, near_signTransactions: { key: "" }, tron_signTransaction: { key: "txID" }, xrpl_signTransaction: { key: "" }, xrpl_signTransactionFor: { key: "" }, algo_signTxn: { key: "" }, sendTransfer: { key: "txid" }, stacks_stxTransfer: { key: "txId" }, polkadot_signTransaction: { key: "" }, cosmos_signDirect: { key: "" }, canton_prepareSignExecute: { key: "" }, stellar_signXDR: { key: "" }, stellar_signAndSubmitXDR: { key: "tx_hash" } }, r3 = "request", s3 = ["wc_sessionPropose", "wc_sessionRequest", "wc_authRequest", "wc_sessionAuthenticate"], n3 = "wc", i3 = "auth", o3 = "authKeys", a3 = "pairingTopics", c3 = "requests", ui = `${n3}@${1.5}:${i3}:`, Jt = `${ui}:PUB_KEY`;
class l3 extends Y_ {
  constructor(e) {
    super(e), this.name = e3, this.events = new ea(), this.initialized = !1, this.requestQueue = { state: ft.idle, queue: [] }, this.sessionRequestQueue = { state: ft.idle, queue: [] }, this.emittedSessionRequests = new y2({ limit: 500 }), this.requestQueueDelay = F.ONE_SECOND, this.expectedPairingMethodMap = /* @__PURE__ */ new Map(), this.recentlyDeletedMap = /* @__PURE__ */ new Map(), this.recentlyDeletedLimit = 200, this.relayMessageCache = [], this.pendingSessions = /* @__PURE__ */ new Map(), this.init = async () => {
      this.initialized || (await this.cleanup(), this.registerRelayerEvents(), this.registerExpirerEvents(), this.registerPairingEvents(), this.registerSubscriptionCleanup(), await this.registerLinkModeListeners(), this.client.core.pairing.register({ methods: Object.keys(me) }), this.initialized = !0, setTimeout(async () => {
        await this.processPendingMessageEvents(), this.sessionRequestQueue.queue = this.getPendingSessionRequests(), this.processSessionRequestQueue();
      }, F.toMiliseconds(this.requestQueueDelay)));
    }, this.connect = async (r) => {
      this.isInitialized(), await this.confirmOnlineStateOrThrow();
      const s = { ...r, requiredNamespaces: r.requiredNamespaces || {}, optionalNamespaces: r.optionalNamespaces || {} };
      await this.isValidConnect(s), s.optionalNamespaces = px(s.requiredNamespaces, s.optionalNamespaces), s.requiredNamespaces = {};
      const { pairingTopic: n, requiredNamespaces: i, optionalNamespaces: o, sessionProperties: a, scopedProperties: c, relays: l, authentication: u, walletPay: h } = s, f = u?.[0]?.ttl || me.wc_sessionPropose.req.ttl || F.FIVE_MINUTES;
      this.validateRequestExpiry(f);
      let g = n, p, y = !1;
      try {
        if (g) {
          const B = this.client.core.pairing.pairings.get(g);
          this.client.logger.warn("connect() with existing pairing topic is deprecated and will be removed in the next major release."), y = B.active;
        }
      } catch (B) {
        throw this.client.logger.error(`connect() -> pairing.get(${g}) failed`), B;
      }
      if (!g || !y) {
        const { topic: B, uri: T } = await this.client.core.pairing.create({ internal: { skipSubscribe: !0 } });
        g = B, p = T;
      }
      if (!g) {
        const { message: B } = j("NO_MATCHING_KEY", `connect() pairing topic: ${g}`);
        throw new Error(B);
      }
      const m = await this.client.core.crypto.generateKeyPair(), E = ae(f), $ = { requiredNamespaces: i, optionalNamespaces: o, relays: l ?? [{ protocol: Fd }], proposer: { publicKey: m, metadata: this.client.metadata }, expiryTimestamp: E, pairingTopic: g, ...a && { sessionProperties: a }, ...c && { scopedProperties: c }, id: pt(), ...(u || h) && { requests: { authentication: u?.map((B) => {
        const { domain: T, chains: L, nonce: U, uri: N, exp: A, nbf: R, type: d, statement: w, requestId: _, resources: O, signatureTypes: S } = B;
        return { domain: T, chains: L, nonce: U, type: d ?? "caip122", aud: N, version: "1", iat: (/* @__PURE__ */ new Date()).toISOString(), exp: A, nbf: R, statement: w, requestId: _, resources: O, signatureTypes: S };
      }), walletPay: h } } }, b = J("session_connect", $.id), { reject: v, resolve: x, done: I } = mr(f, mu), P = ({ id: B }) => {
        if (B === $.id) {
          this.client.events.off("proposal_expire", P);
          const T = this.pendingSessions.get($.id);
          if (T) {
            const { sessionTopic: L, publicKey: U } = T;
            Promise.all([this.client.core.relayer.unsubscribe(L), this.client.core.crypto.keychain.has(L) ? this.client.core.crypto.deleteSymKey(L) : Promise.resolve(), this.client.core.crypto.keychain.has(U) ? this.client.core.crypto.deleteKeyPair(U) : Promise.resolve()]).catch((N) => this.client.logger.warn(N));
          }
          this.pendingSessions.delete($.id), this.events.emit(b, { error: { message: mu, code: 0 } });
        }
      };
      return this.client.events.on("proposal_expire", P), this.events.once(b, ({ error: B, session: T }) => {
        this.client.events.off("proposal_expire", P), B ? v(B) : T && x(T);
      }), await this.setProposal($.id, $), await this.sendProposeSession({ proposal: $, publishOpts: { internal: { throwOnFailedPublish: !0 }, tvf: { correlationId: $.id } } }).catch((B) => {
        throw this.deleteProposal($.id), B;
      }), { uri: p, approval: I };
    }, this.pair = async (r) => {
      this.isInitialized(), await this.confirmOnlineStateOrThrow();
      try {
        return await this.client.core.pairing.pair(r);
      } catch (s) {
        throw this.client.logger.error("pair() failed"), s;
      }
    }, this.approve = async (r) => {
      const s = this.client.core.eventClient.createEvent({ properties: { topic: r?.id?.toString(), trace: [rt.session_approve_started] } });
      try {
        this.isInitialized(), await this.confirmOnlineStateOrThrow();
      } catch (P) {
        throw s.setError(yr.no_internet_connection), P;
      }
      try {
        await this.isValidProposalId(r?.id);
      } catch (P) {
        throw this.client.logger.error(`approve() -> proposal.get(${r?.id}) failed`), s.setError(yr.proposal_not_found), P;
      }
      try {
        await this.isValidApprove(r);
      } catch (P) {
        throw this.client.logger.error("approve() -> isValidApprove() failed"), s.setError(yr.session_approve_namespace_validation_failure), P;
      }
      const { id: n, relayProtocol: i, namespaces: o, sessionProperties: a, scopedProperties: c, sessionConfig: l, proposalRequestsResponses: u } = r, h = this.client.proposal.get(n);
      this.client.core.eventClient.deleteEvent({ eventId: s.eventId });
      const { pairingTopic: f, proposer: g, requiredNamespaces: p, optionalNamespaces: y } = h;
      let m = this.client.core.eventClient?.getEvent({ topic: f });
      m || (m = this.client.core.eventClient?.createEvent({ type: rt.session_approve_started, properties: { topic: f, trace: [rt.session_approve_started, rt.session_namespaces_validation_success] } }));
      const E = await this.client.core.crypto.generateKeyPair(), $ = g.publicKey, b = await this.client.core.crypto.generateSharedKey(E, $), v = { relay: { protocol: i ?? "irn" }, namespaces: o, controller: { publicKey: E, metadata: this.client.metadata }, expiry: ae(jr), ...a && { sessionProperties: a }, ...c && { scopedProperties: c }, ...l && { sessionConfig: l }, proposalRequestsResponses: u }, x = te.relay;
      m.addTrace(rt.subscribing_session_topic);
      try {
        await this.client.core.relayer.subscribe(b, { transportType: x, internal: { skipSubscribe: !0 } });
      } catch (P) {
        throw m.setError(yr.subscribe_session_topic_failure), P;
      }
      m.addTrace(rt.subscribe_session_topic_success);
      const I = { ...v, topic: b, requiredNamespaces: p, optionalNamespaces: y, pairingTopic: f, acknowledged: !1, self: v.controller, peer: { publicKey: g.publicKey, metadata: g.metadata }, controller: E, transportType: te.relay, authentication: u?.authentication, walletPayResult: u?.walletPay };
      await this.client.session.set(b, I), m.addTrace(rt.store_session);
      try {
        await this.sendApproveSession({ sessionTopic: b, proposal: h, pairingProposalResponse: { relay: { protocol: i ?? "irn" }, responderPublicKey: E }, sessionSettleRequest: v, publishOpts: { internal: { throwOnFailedPublish: !0 }, tvf: { correlationId: n, ...this.getTVFApproveParams(I) } } }), m.addTrace(rt.session_approve_publish_success);
      } catch (P) {
        throw this.client.logger.error(P), this.client.session.delete(b, Q("USER_DISCONNECTED")), await this.client.core.relayer.unsubscribe(b), P;
      }
      return this.client.core.eventClient.deleteEvent({ eventId: m.eventId }), await this.client.core.pairing.updateMetadata({ topic: f, metadata: g.metadata }), await this.deleteProposal(n), await this.client.core.pairing.activate({ topic: f }), await this.setExpiry(b, ae(jr)), { topic: b, acknowledged: () => Promise.resolve(this.client.session.get(b)) };
    }, this.reject = async (r) => {
      this.isInitialized(), await this.confirmOnlineStateOrThrow();
      try {
        await this.isValidReject(r);
      } catch (o) {
        throw this.client.logger.error("reject() -> isValidReject() failed"), o;
      }
      const { id: s, reason: n } = r;
      let i;
      try {
        i = this.client.proposal.get(s).pairingTopic;
      } catch (o) {
        throw this.client.logger.error(`reject() -> proposal.get(${s}) failed`), o;
      }
      i && await this.sendError({ id: s, topic: i, error: n, rpcOpts: me.wc_sessionPropose.reject }), await this.deleteProposal(s);
    }, this.update = async (r) => {
      this.isInitialized(), await this.confirmOnlineStateOrThrow();
      try {
        await this.isValidUpdate(r);
      } catch (f) {
        throw this.client.logger.error("update() -> isValidUpdate() failed"), f;
      }
      const { topic: s, namespaces: n } = r, i = this.client.session.get(s);
      if (i.self.publicKey !== i.controller) {
        const { message: f } = Q("UNAUTHORIZED_UPDATE_REQUEST");
        throw new Error(f);
      }
      const { done: o, resolve: a, reject: c } = mr(F.FIVE_MINUTES, "Session update request expired without receiving any acknowledgement"), l = pt(), u = nr().toString(), h = this.client.session.get(s).namespaces;
      return this.events.once(J("session_update", l), ({ error: f }) => {
        f ? c(f) : a();
      }), await this.client.session.update(s, { namespaces: n }), await this.sendRequest({ topic: s, method: "wc_sessionUpdate", params: { namespaces: n }, throwOnFailedPublish: !0, clientRpcId: l, relayRpcId: u }).catch((f) => {
        this.client.logger.error(f), this.client.session.update(s, { namespaces: h }), c(f);
      }), { acknowledged: o };
    }, this.extend = async (r) => {
      this.isInitialized(), await this.confirmOnlineStateOrThrow();
      try {
        await this.isValidExtend(r);
      } catch (c) {
        throw this.client.logger.error("extend() -> isValidExtend() failed"), c;
      }
      const { topic: s } = r, n = pt(), { done: i, resolve: o, reject: a } = mr(F.FIVE_MINUTES, "Session extend request expired without receiving any acknowledgement");
      return this.events.once(J("session_extend", n), ({ error: c }) => {
        c ? a(c) : o();
      }), await this.setExpiry(s, ae(jr)), this.sendRequest({ topic: s, method: "wc_sessionExtend", params: {}, clientRpcId: n, throwOnFailedPublish: !0 }).catch((c) => {
        a(c);
      }), { acknowledged: i };
    }, this.request = async (r) => {
      this.isInitialized();
      try {
        await this.isValidRequest(r);
      } catch (m) {
        throw this.client.logger.error("request() -> isValidRequest() failed"), m;
      }
      const { chainId: s, request: n, topic: i, expiry: o = me.wc_sessionRequest.req.ttl } = r, a = this.client.session.get(i);
      a?.transportType === te.relay && await this.confirmOnlineStateOrThrow();
      const c = pt(), l = nr().toString(), { done: u, resolve: h, reject: f } = mr(o, "Request expired. Please try again.");
      this.events.once(J("session_request", c), ({ error: m, result: E }) => {
        m ? f(m) : h(E);
      });
      const g = "wc_sessionRequest", p = this.getAppLinkIfEnabled(a.peer.metadata, a.transportType);
      if (p) return await this.sendRequest({ clientRpcId: c, relayRpcId: l, topic: i, method: g, params: { request: { ...n, expiryTimestamp: ae(o) }, chainId: s }, expiry: o, throwOnFailedPublish: !0, appLink: p }).catch((m) => f(m)), this.client.events.emit("session_request_sent", { topic: i, request: n, chainId: s, id: c }), await u();
      const y = { request: { ...n, expiryTimestamp: ae(o) }, chainId: s };
      return await Promise.all([new Promise(async (m) => {
        await this.sendRequest({ clientRpcId: c, relayRpcId: l, topic: i, method: g, params: y, expiry: o, throwOnFailedPublish: !0, tvf: this.getTVFParams(c, y) }).catch((E) => f(E)), this.client.events.emit("session_request_sent", { topic: i, request: n, chainId: s, id: c }), m();
      }), new Promise(async (m) => {
        if (!a.sessionConfig?.disableDeepLink) {
          const E = await h2(this.client.core.storage, wu);
          await c2({ id: c, topic: i, wcDeepLink: E });
        }
        m();
      }), u()]).then((m) => m[2]);
    }, this.respond = async (r) => {
      this.isInitialized();
      const s = this.client.core.eventClient.createEvent({ properties: { topic: r?.topic || r?.response?.id?.toString(), trace: [rt.session_request_response_started] } });
      try {
        await this.isValidRespond(r);
      } catch (l) {
        throw s.addTrace(l?.message), s.setError(yr.session_request_response_validation_failure), l;
      }
      s.addTrace(rt.session_request_response_validation_success);
      const { topic: n, response: i } = r, { id: o } = i, a = this.client.session.get(n);
      a.transportType === te.relay && await this.confirmOnlineStateOrThrow();
      const c = this.getAppLinkIfEnabled(a.peer.metadata, a.transportType);
      try {
        s.addTrace(rt.session_request_response_publish_started), gt(i) ? await this.sendResult({ id: o, topic: n, result: i.result, throwOnFailedPublish: !0, appLink: c }) : Ye(i) && await this.sendError({ id: o, topic: n, error: i.error, appLink: c }), this.cleanupAfterResponse(r);
      } catch (l) {
        throw s.addTrace(l?.message), s.setError(yr.session_request_response_publish_failure), l;
      }
    }, this.ping = async (r) => {
      this.isInitialized(), await this.confirmOnlineStateOrThrow();
      try {
        await this.isValidPing(r);
      } catch (n) {
        throw this.client.logger.error("ping() -> isValidPing() failed"), n;
      }
      const { topic: s } = r;
      if (this.client.session.keys.includes(s)) {
        const n = pt(), i = nr().toString(), { done: o, resolve: a, reject: c } = mr(F.FIVE_MINUTES, "Ping request expired without receiving any acknowledgement");
        this.events.once(J("session_ping", n), ({ error: l }) => {
          l ? c(l) : a();
        }), await Promise.all([this.sendRequest({ topic: s, method: "wc_sessionPing", params: {}, throwOnFailedPublish: !0, clientRpcId: n, relayRpcId: i }), o()]);
      } else this.client.core.pairing.pairings.keys.includes(s) && (this.client.logger.warn("ping() on pairing topic is deprecated and will be removed in the next major release."), await this.client.core.pairing.ping({ topic: s }));
    }, this.emit = async (r) => {
      this.isInitialized(), await this.confirmOnlineStateOrThrow(), await this.isValidEmit(r);
      const { topic: s, event: n, chainId: i } = r, o = nr().toString(), a = pt();
      await this.sendRequest({ topic: s, method: "wc_sessionEvent", params: { event: n, chainId: i }, throwOnFailedPublish: !0, relayRpcId: o, clientRpcId: a });
    }, this.disconnect = async (r) => {
      this.isInitialized(), await this.confirmOnlineStateOrThrow(), await this.isValidDisconnect(r);
      const { topic: s } = r;
      if (this.client.session.keys.includes(s)) await this.sendRequest({ topic: s, method: "wc_sessionDelete", params: Q("USER_DISCONNECTED"), throwOnFailedPublish: !0 }), await this.deleteSession({ topic: s, emitEvent: !1 });
      else if (this.client.core.pairing.pairings.keys.includes(s)) await this.client.core.pairing.disconnect({ topic: s });
      else {
        const { message: n } = j("MISMATCHED_TOPIC", `Session or pairing topic not found: ${s}`);
        throw new Error(n);
      }
    }, this.find = (r) => (this.isInitialized(), this.client.session.getAll().filter((s) => gx(s, r))), this.getPendingSessionRequests = () => this.client.pendingRequest.getAll(), this.authenticate = async (r, s) => {
      this.isInitialized(), this.isValidAuthenticate(r);
      const n = s && this.client.core.linkModeSupportedApps.includes(s) && this.client.metadata.redirect?.linkMode, i = n ? te.link_mode : te.relay;
      i === te.relay && await this.confirmOnlineStateOrThrow();
      const { chains: o, statement: a = "", uri: c, domain: l, nonce: u, type: h, exp: f, nbf: g, methods: p = [], expiry: y } = r, m = [...r.resources || []], { topic: E, uri: $ } = await this.client.core.pairing.create({ methods: ["wc_sessionAuthenticate"], transportType: i });
      if (this.client.logger.info({ message: "Generated new pairing", pairing: { topic: E, uri: $ } }), this.client.auth.authKeys.keys.includes(Jt)) {
        const { responseTopic: S, publicKey: D } = this.client.auth.authKeys.get(Jt);
        S && (await this.client.core.relayer.unsubscribe(S).catch((C) => this.client.logger.warn(C)), await this.client.auth.pairingTopics.delete(S, { message: "replaced", code: 0 }).catch((C) => this.client.logger.warn(C))), D && this.client.core.crypto.keychain.has(D) && await this.client.core.crypto.deleteKeyPair(D);
      }
      const b = await this.client.core.crypto.generateKeyPair(), v = wn(b);
      if (await Promise.all([this.client.auth.authKeys.set(Jt, { responseTopic: v, publicKey: b }), this.client.auth.pairingTopics.set(v, { topic: v, pairingTopic: E })]), await this.client.core.relayer.subscribe(v, { transportType: i }), this.client.logger.info(`sending request to new pairing topic: ${E}`), p.length > 0) {
        const { namespace: S } = Ft(o[0]);
        let D = H2(S, "request", p);
        yn(m) && (D = V2(D, m.pop())), m.push(D);
      }
      const x = y && y > me.wc_sessionAuthenticate.req.ttl ? y : me.wc_sessionAuthenticate.req.ttl, I = { authPayload: { type: h ?? "caip122", chains: o, statement: a, aud: c, domain: l, version: "1", nonce: u, iat: (/* @__PURE__ */ new Date()).toISOString(), exp: f, nbf: g, resources: m }, requester: { publicKey: b, metadata: this.client.metadata }, expiryTimestamp: ae(x) }, P = { eip155: { chains: o, methods: [.../* @__PURE__ */ new Set(["personal_sign", ...p])], events: ["chainChanged", "accountsChanged"] } }, B = { requiredNamespaces: {}, optionalNamespaces: P, relays: [{ protocol: "irn" }], pairingTopic: E, proposer: { publicKey: b, metadata: this.client.metadata }, expiryTimestamp: ae(me.wc_sessionPropose.req.ttl), id: pt() }, { done: T, resolve: L, reject: U } = mr(x, "Request expired"), N = pt(), A = J("session_connect", B.id), R = J("session_request", N), d = async ({ error: S, session: D }) => {
        this.events.off(R, _), S ? U(S) : D && L({ session: D });
      }, w = async (S) => {
        if (await this.deletePendingAuthRequest(N, { message: "fulfilled", code: 0 }), S.error) {
          const K = Q("WC_METHOD_UNSUPPORTED", "wc_sessionAuthenticate");
          return S.error.code === K.code ? void 0 : (this.events.off(A, d), U(S.error.message));
        }
        await this.deleteProposal(B.id), this.events.off(A, d);
        const { cacaos: D, responder: C } = S.result, M = [], z = [];
        for (const K of D) {
          if (!await Ml({ cacao: K, projectId: this.client.core.projectId })) return this.client.logger.error(K, "Signature verification failed"), U(Q("SESSION_SETTLEMENT_FAILED", "Signature verification failed"));
          const W = k2({ cacao: K, request: I.authPayload });
          if (!W.valid) return this.client.logger.error(K, `Cacao does not match the request: ${W.reason}`), U(Q("SESSION_SETTLEMENT_FAILED", `Cacao does not match the request: ${W.reason}`));
          const { p: G } = K, V = yn(G.resources), Z = [Un(G.iss)], ie = Ln(G.iss);
          if (V) {
            const oe = kl(V), de = ql(V);
            M.push(...oe), Z.push(...de);
          }
          for (const oe of Z) z.push(`${oe}:${ie}`);
        }
        const k = await this.client.core.crypto.generateSharedKey(b, C.publicKey);
        let q;
        M.length > 0 && (q = { topic: k, acknowledged: !0, self: { publicKey: b, metadata: this.client.metadata }, peer: C, controller: C.publicKey, expiry: ae(jr), requiredNamespaces: {}, optionalNamespaces: {}, relay: { protocol: "irn" }, pairingTopic: E, namespaces: Wl([...new Set(M)], [...new Set(z)]), transportType: i }, await this.client.core.relayer.subscribe(k, { transportType: i }), await this.client.session.set(k, q), E && await this.client.core.pairing.updateMetadata({ topic: E, metadata: C.metadata }), q = this.client.session.get(k)), this.client.metadata.redirect?.linkMode && C.metadata.redirect?.linkMode && C.metadata.redirect?.universal && s && (this.client.core.addLinkModeSupportedApp(C.metadata.redirect.universal), this.client.session.update(k, { transportType: te.link_mode })), L({ auths: D, session: q });
      }, _ = (S) => w(S).catch((D) => {
        this.client.logger.error(D, "Failed to process authenticate response"), U(Q("SESSION_SETTLEMENT_FAILED", D?.message || "Failed to process authenticate response"));
      });
      this.events.once(A, d), this.events.once(R, _);
      let O;
      try {
        if (n) {
          const S = ot("wc_sessionAuthenticate", I, N);
          this.client.core.history.set(E, S);
          const D = await this.client.core.crypto.encode("", S, { type: Br, encoding: mt });
          O = cn(s, E, D);
        } else await Promise.all([this.sendRequest({ topic: E, method: "wc_sessionAuthenticate", params: I, expiry: r.expiry, throwOnFailedPublish: !0, clientRpcId: N }), this.sendRequest({ topic: E, method: "wc_sessionPropose", params: B, expiry: me.wc_sessionPropose.req.ttl, throwOnFailedPublish: !0, clientRpcId: B.id })]);
      } catch (S) {
        throw this.events.off(A, d), this.events.off(R, _), S;
      }
      return await this.setProposal(B.id, B), await this.setAuthRequest(N, { request: { ...I, verifyContext: {} }, pairingTopic: E, transportType: i }), { uri: O ?? $, response: T };
    }, this.approveSessionAuthenticate = async (r) => {
      const { id: s, auths: n } = r, i = this.client.core.eventClient.createEvent({ properties: { topic: s.toString(), trace: [wr.authenticated_session_approve_started] } });
      try {
        this.isInitialized();
      } catch (m) {
        throw i.setError(ps.no_internet_connection), m;
      }
      const o = this.getPendingAuthRequest(s);
      if (!o) throw i.setError(ps.authenticated_session_pending_request_not_found), new Error(`Could not find pending auth request with id ${s}`);
      const a = o.transportType || te.relay;
      a === te.relay && await this.confirmOnlineStateOrThrow();
      const c = o.requester.publicKey, l = await this.client.core.crypto.generateKeyPair(), u = wn(c), h = { type: jt, receiverPublicKey: c, senderPublicKey: l }, f = [], g = [];
      for (const m of n) {
        if (!await Ml({ cacao: m, projectId: this.client.core.projectId })) {
          i.setError(ps.invalid_cacao);
          const x = Q("SESSION_SETTLEMENT_FAILED", "Signature verification failed");
          throw await this.sendError({ id: s, topic: u, error: x, encodeOpts: h }), new Error(x.message);
        }
        i.addTrace(wr.cacaos_verified);
        const { p: E } = m, $ = yn(E.resources), b = [Un(E.iss)], v = Ln(E.iss);
        if ($) {
          const x = kl($), I = ql($);
          f.push(...x), b.push(...I);
        }
        for (const x of b) g.push(`${x}:${v}`);
      }
      const p = await this.client.core.crypto.generateSharedKey(l, c);
      i.addTrace(wr.create_authenticated_session_topic);
      let y;
      if (f?.length > 0) {
        y = { topic: p, acknowledged: !0, self: { publicKey: l, metadata: this.client.metadata }, peer: { publicKey: c, metadata: o.requester.metadata }, controller: c, expiry: ae(jr), authentication: n, requiredNamespaces: {}, optionalNamespaces: {}, relay: { protocol: "irn" }, pairingTopic: o.pairingTopic, namespaces: Wl([...new Set(f)], [...new Set(g)]), transportType: a }, i.addTrace(wr.subscribing_authenticated_session_topic);
        try {
          await this.client.core.relayer.subscribe(p, { transportType: a });
        } catch (m) {
          throw i.setError(ps.subscribe_authenticated_session_topic_failure), m;
        }
        i.addTrace(wr.subscribe_authenticated_session_topic_success), await this.client.session.set(p, y), i.addTrace(wr.store_authenticated_session), await this.client.core.pairing.updateMetadata({ topic: o.pairingTopic, metadata: o.requester.metadata });
      }
      i.addTrace(wr.publishing_authenticated_session_approve);
      try {
        await this.sendResult({ topic: u, id: s, result: { cacaos: n, responder: { publicKey: l, metadata: this.client.metadata } }, encodeOpts: h, throwOnFailedPublish: !0, appLink: this.getAppLinkIfEnabled(o.requester.metadata, a) });
      } catch (m) {
        throw i.setError(ps.authenticated_session_approve_publish_failure), m;
      }
      return await this.client.auth.requests.delete(s, { message: "fulfilled", code: 0 }), await this.client.core.pairing.activate({ topic: o.pairingTopic }), this.client.core.eventClient.deleteEvent({ eventId: i.eventId }), { session: y };
    }, this.rejectSessionAuthenticate = async (r) => {
      this.isInitialized();
      const { id: s, reason: n } = r, i = this.getPendingAuthRequest(s);
      if (!i) throw new Error(`Could not find pending auth request with id ${s}`);
      i.transportType === te.relay && await this.confirmOnlineStateOrThrow();
      const o = i.requester.publicKey, a = await this.client.core.crypto.generateKeyPair(), c = wn(o), l = { type: jt, receiverPublicKey: o, senderPublicKey: a };
      await this.sendError({ id: s, topic: c, error: n, encodeOpts: l, rpcOpts: me.wc_sessionAuthenticate.reject, appLink: this.getAppLinkIfEnabled(i.requester.metadata, i.transportType) }), await this.client.auth.requests.delete(s, { message: "rejected", code: 0 }), await this.deleteProposal(s);
    }, this.formatAuthMessage = (r) => {
      this.isInitialized();
      const { request: s, iss: n } = r;
      return sd(s, n);
    }, this.processRelayMessageCache = () => {
      setTimeout(async () => {
        if (this.relayMessageCache.length !== 0) for (; this.relayMessageCache.length > 0; ) try {
          const r = this.relayMessageCache.shift();
          r && await this.onRelayMessage(r);
        } catch (r) {
          this.client.logger.error(r);
        }
      }, 50);
    }, this.cleanupDuplicatePairings = async (r) => {
      if (r.pairingTopic) try {
        const s = this.client.core.pairing.pairings.get(r.pairingTopic), n = this.client.core.pairing.pairings.getAll().filter((i) => i.peerMetadata?.url && i.peerMetadata?.url === r.peer.metadata.url && i.topic && i.topic !== s.topic);
        if (n.length === 0) return;
        this.client.logger.info(`Cleaning up ${n.length} duplicate pairing(s)`), await Promise.all(n.map((i) => this.client.core.pairing.disconnect({ topic: i.topic }))), this.client.logger.info("Duplicate pairings clean up finished");
      } catch (s) {
        this.client.logger.error(s);
      }
    }, this.deleteSession = async (r) => {
      const { topic: s, expirerHasDeleted: n = !1, emitEvent: i = !0, id: o = 0 } = r, { self: a } = this.client.session.get(s);
      await this.client.core.relayer.unsubscribe(s), await this.client.session.delete(s, Q("USER_DISCONNECTED")), this.addToRecentlyDeleted(s, "session"), this.client.core.crypto.keychain.has(a.publicKey) && await this.client.core.crypto.deleteKeyPair(a.publicKey), this.client.core.crypto.keychain.has(s) && await this.client.core.crypto.deleteSymKey(s), n || this.client.core.expirer.del(s), this.client.core.storage.removeItem(wu).catch((c) => this.client.logger.warn(c)), s === this.sessionRequestQueue.queue[0]?.topic && (this.sessionRequestQueue.state = ft.idle), await Promise.all(this.getPendingSessionRequests().filter((c) => c.topic === s).map((c) => this.deletePendingSessionRequest(c.id, Q("USER_DISCONNECTED")))), i && this.client.events.emit("session_delete", { id: o, topic: s });
    }, this.deleteProposal = async (r, s) => {
      if (s) try {
        const n = this.client.proposal.get(r);
        this.client.core.eventClient.getEvent({ topic: n.pairingTopic })?.setError(yr.proposal_expired);
      } catch {
      }
      await Promise.all([this.client.proposal.delete(r, Q("USER_DISCONNECTED")), s ? Promise.resolve() : this.client.core.expirer.del(r)]), this.addToRecentlyDeleted(r, "proposal");
    }, this.deletePendingSessionRequest = async (r, s, n = !1) => {
      await Promise.all([this.client.pendingRequest.delete(r, s), n ? Promise.resolve() : this.client.core.expirer.del(r)]), this.addToRecentlyDeleted(r, "request"), this.sessionRequestQueue.queue = this.sessionRequestQueue.queue.filter((i) => i.id !== r), n && (this.sessionRequestQueue.state = ft.idle, this.client.events.emit("session_request_expire", { id: r }));
    }, this.deletePendingAuthRequest = async (r, s, n = !1) => {
      await Promise.all([this.client.auth.requests.delete(r, s), n ? Promise.resolve() : this.client.core.expirer.del(r)]);
    }, this.setExpiry = async (r, s) => {
      this.client.session.keys.includes(r) && (this.client.core.expirer.set(r, s), await this.client.session.update(r, { expiry: s }));
    }, this.setProposal = async (r, s) => {
      this.client.core.expirer.set(r, ae(me.wc_sessionPropose.req.ttl)), await this.client.proposal.set(r, s);
    }, this.setAuthRequest = async (r, s) => {
      const { request: n, pairingTopic: i, transportType: o = te.relay } = s;
      this.client.core.expirer.set(r, n.expiryTimestamp), await this.client.auth.requests.set(r, { authPayload: n.authPayload, requester: n.requester, expiryTimestamp: n.expiryTimestamp, id: r, pairingTopic: i, verifyContext: n.verifyContext, transportType: o });
    }, this.setPendingSessionRequest = async (r) => {
      const { id: s, topic: n, params: i, verifyContext: o } = r, a = i.request.expiryTimestamp || ae(me.wc_sessionRequest.req.ttl);
      this.client.core.expirer.set(s, a), await this.client.pendingRequest.set(s, { id: s, topic: n, params: i, verifyContext: o });
    }, this.sendRequest = async (r) => {
      const { topic: s, method: n, params: i, expiry: o, relayRpcId: a, clientRpcId: c, throwOnFailedPublish: l, appLink: u, tvf: h, publishOpts: f = {} } = r, g = ot(n, i, c);
      let p;
      const y = !!u;
      try {
        const $ = y ? mt : be;
        p = await this.client.core.crypto.encode(s, g, { encoding: $ });
      } catch ($) {
        throw await this.cleanup(), this.client.logger.error(`sendRequest() -> core.crypto.encode() for topic ${s} failed`), $;
      }
      let m;
      if (s3.includes(n)) {
        const $ = Ge(JSON.stringify(g)), b = Ge(p);
        m = await this.client.core.verify.register({ id: b, decryptedId: $ });
      }
      const E = { ...me[n].req, ...f };
      if (E.attestation = m, o && (E.ttl = o), a && (E.id = a), this.client.core.history.set(s, g), y) {
        const $ = cn(u, s, p);
        await global.Linking.openURL($, this.client.name);
      } else E.tvf = { ...h, correlationId: g.id }, l ? (E.internal = { ...E.internal, throwOnFailedPublish: !0 }, await this.client.core.relayer.publish(s, p, E)) : this.client.core.relayer.publish(s, p, E).catch(($) => this.client.logger.error($));
      return g.id;
    }, this.sendProposeSession = async (r) => {
      const { proposal: s, publishOpts: n } = r, i = ot("wc_sessionPropose", s, s.id);
      this.client.core.history.set(s.pairingTopic, i);
      const o = await this.client.core.crypto.encode(s.pairingTopic, i, { encoding: be }), a = Ge(JSON.stringify(i)), c = Ge(o), l = await this.client.core.verify.register({ id: c, decryptedId: a });
      await this.client.core.relayer.publishCustom({ payload: { pairingTopic: s.pairingTopic, sessionProposal: o }, opts: { ...n, publishMethod: "wc_proposeSession", attestation: l } });
    }, this.sendApproveSession = async (r) => {
      const { sessionTopic: s, pairingProposalResponse: n, proposal: i, sessionSettleRequest: o, publishOpts: a } = r, c = Bs(i.id, n), l = await this.client.core.crypto.encode(i.pairingTopic, c, { encoding: be }), u = ot("wc_sessionSettle", o, a?.id), h = await this.client.core.crypto.encode(s, u, { encoding: be });
      this.client.core.history.set(s, u), await this.client.core.relayer.publishCustom({ payload: { sessionTopic: s, pairingTopic: i.pairingTopic, sessionProposalResponse: l, sessionSettlementRequest: h }, opts: { ...a, publishMethod: "wc_approveSession" } });
    }, this.sendResult = async (r) => {
      const { id: s, topic: n, result: i, throwOnFailedPublish: o, encodeOpts: a, appLink: c } = r, l = Bs(s, i);
      let u;
      const h = c && typeof global?.Linking < "u";
      try {
        const p = h ? mt : be;
        u = await this.client.core.crypto.encode(n, l, { ...a || {}, encoding: p });
      } catch (p) {
        throw await this.cleanup(), this.client.logger.error(`sendResult() -> core.crypto.encode() for topic ${n} failed`), p;
      }
      let f, g;
      try {
        f = await this.client.core.history.get(n, s);
        const p = f.request;
        try {
          g = this.getTVFParams(s, p.params, i);
        } catch (y) {
          this.client.logger.warn(`sendResult() -> getTVFParams() failed: ${y?.message}`);
        }
      } catch (p) {
        throw this.client.logger.error(`sendResult() -> history.get(${n}, ${s}) failed`), p;
      }
      if (h) {
        const p = cn(c, n, u);
        await global.Linking.openURL(p, this.client.name);
      } else {
        const p = f.request.method, y = me[p].res;
        y.tvf = { ...g, correlationId: s }, o ? (y.internal = { ...y.internal, throwOnFailedPublish: !0 }, await this.client.core.relayer.publish(n, u, y)) : this.client.core.relayer.publish(n, u, y).catch((m) => this.client.logger.error(m));
      }
      await this.client.core.history.resolve(l);
    }, this.sendError = async (r) => {
      const { id: s, topic: n, error: i, encodeOpts: o, rpcOpts: a, appLink: c } = r, l = ci(s, i);
      let u;
      const h = c && typeof global?.Linking < "u";
      try {
        const g = h ? mt : be;
        u = await this.client.core.crypto.encode(n, l, { ...o || {}, encoding: g });
      } catch (g) {
        throw await this.cleanup(), this.client.logger.error(`sendError() -> core.crypto.encode() for topic ${n} failed`), g;
      }
      let f;
      try {
        f = await this.client.core.history.get(n, s);
      } catch (g) {
        throw this.client.logger.error(`sendError() -> history.get(${n}, ${s}) failed`), g;
      }
      if (h) {
        const g = cn(c, n, u);
        await global.Linking.openURL(g, this.client.name);
      } else {
        const g = f.request.method, p = a || me[g].res;
        this.client.core.relayer.publish(n, u, p);
      }
      await this.client.core.history.resolve(l);
    }, this.cleanup = async () => {
      const r = [], s = [];
      this.client.session.getAll().forEach((n) => {
        let i = !1;
        wt(n.expiry) && (i = !0), this.client.core.crypto.keychain.has(n.topic) || (i = !0), i && r.push(n.topic);
      }), this.client.proposal.getAll().forEach((n) => {
        wt(n.expiryTimestamp) && s.push(n.id);
      }), await Promise.all([...r.map((n) => this.deleteSession({ topic: n })), ...s.map((n) => this.deleteProposal(n))]);
    }, this.onProviderMessageEvent = async (r) => {
      !this.initialized || this.relayMessageCache.length > 0 ? this.relayMessageCache.push(r) : await this.onRelayMessage(r);
    }, this.onRelayEventRequest = async (r) => {
      this.requestQueue.queue.push(r), await this.processRequestsQueue();
    }, this.processRequestsQueue = async () => {
      if (this.requestQueue.state === ft.active) {
        this.client.logger.info("Request queue already active, skipping...");
        return;
      }
      for (this.client.logger.info(`Request queue starting with ${this.requestQueue.queue.length} requests`); this.requestQueue.queue.length > 0; ) {
        this.requestQueue.state = ft.active;
        const r = this.requestQueue.queue.shift();
        if (r) try {
          await this.processRequest(r);
        } catch (s) {
          this.client.logger.warn(s);
        }
      }
      this.requestQueue.state = ft.idle;
    }, this.processRequest = async (r) => {
      const { topic: s, payload: n, attestation: i, transportType: o, encryptedId: a } = r, c = n.method;
      if (!this.shouldIgnorePairingRequest({ topic: s, requestMethod: c })) switch (c) {
        case "wc_sessionPropose":
          return await this.onSessionProposeRequest({ topic: s, payload: n, attestation: i, encryptedId: a });
        case "wc_sessionSettle":
          return await this.onSessionSettleRequest(s, n);
        case "wc_sessionUpdate":
          return await this.onSessionUpdateRequest(s, n);
        case "wc_sessionExtend":
          return await this.onSessionExtendRequest(s, n);
        case "wc_sessionPing":
          return await this.onSessionPingRequest(s, n);
        case "wc_sessionDelete":
          return await this.onSessionDeleteRequest(s, n);
        case "wc_sessionRequest":
          return await this.onSessionRequest({ topic: s, payload: n, attestation: i, encryptedId: a, transportType: o });
        case "wc_sessionEvent":
          return await this.onSessionEventRequest(s, n);
        case "wc_sessionAuthenticate":
          return await this.onSessionAuthenticateRequest({ topic: s, payload: n, attestation: i, encryptedId: a, transportType: o });
        default:
          return this.client.logger.info(`Unsupported request method ${c}`);
      }
    }, this.onRelayEventResponse = async (r) => {
      const { topic: s, payload: n, transportType: i } = r, o = (await this.client.core.history.get(s, n.id)).request.method;
      switch (o) {
        case "wc_sessionPropose":
          return this.onSessionProposeResponse(s, n, i);
        case "wc_sessionSettle":
          return this.onSessionSettleResponse(s, n);
        case "wc_sessionUpdate":
          return this.onSessionUpdateResponse(s, n);
        case "wc_sessionExtend":
          return this.onSessionExtendResponse(s, n);
        case "wc_sessionPing":
          return this.onSessionPingResponse(s, n);
        case "wc_sessionRequest":
          return this.onSessionRequestResponse(s, n);
        case "wc_sessionAuthenticate":
          return this.onSessionAuthenticateResponse(s, n);
        default:
          return this.client.logger.info(`Unsupported response method ${o}`);
      }
    }, this.onRelayEventUnknownPayload = (r) => {
      const { topic: s } = r, { message: n } = j("MISSING_OR_INVALID", `Decoded payload on topic ${s} is not identifiable as a JSON-RPC request or a response.`);
      throw new Error(n);
    }, this.shouldIgnorePairingRequest = (r) => {
      const { topic: s, requestMethod: n } = r, i = this.expectedPairingMethodMap.get(s);
      return !i || i.includes(n) ? !1 : !!(i.includes("wc_sessionAuthenticate") && this.client.events.listenerCount("session_authenticate") > 0);
    }, this.onSessionProposeRequest = async (r) => {
      const { topic: s, payload: n, attestation: i, encryptedId: o } = r, { params: a, id: c } = n;
      try {
        const l = this.client.core.eventClient.getEvent({ topic: s });
        this.client.events.listenerCount("session_proposal") === 0 && (console.warn("No listener for session_proposal event"), l?.setError(Bt.proposal_listener_not_found)), this.isValidConnect({ ...n.params });
        const u = a.expiryTimestamp || ae(me.wc_sessionPropose.req.ttl), h = { id: c, pairingTopic: s, expiryTimestamp: u, attestation: i, encryptedId: o, ...a };
        await this.setProposal(c, h);
        const f = await this.getVerifyContext({ attestationId: i, hash: Ge(JSON.stringify(n)), encryptedId: o, metadata: h.proposer.metadata });
        l?.addTrace(dt.emit_session_proposal), this.client.events.emit("session_proposal", { id: c, params: h, verifyContext: f });
      } catch (l) {
        await this.sendError({ id: c, topic: s, error: l, rpcOpts: me.wc_sessionPropose.autoReject }), this.client.logger.error(l);
      }
    }, this.onSessionProposeResponse = async (r, s, n) => {
      const { id: i } = s;
      if (gt(s)) {
        const { result: o } = s;
        this.client.logger.trace({ type: "method", method: "onSessionProposeResponse", result: o });
        const a = this.client.proposal.get(i);
        this.client.logger.trace({ type: "method", method: "onSessionProposeResponse", proposal: a });
        const c = a.proposer.publicKey;
        this.client.logger.trace({ type: "method", method: "onSessionProposeResponse", selfPublicKey: c });
        const l = o.responderPublicKey;
        this.client.logger.trace({ type: "method", method: "onSessionProposeResponse", peerPublicKey: l });
        const u = await this.client.core.crypto.generateSharedKey(c, l);
        this.pendingSessions.set(i, { sessionTopic: u, pairingTopic: r, proposalId: i, publicKey: c });
        const h = await this.client.core.relayer.subscribe(u, { transportType: n });
        this.client.logger.trace({ type: "method", method: "onSessionProposeResponse", subscriptionId: h }), await this.client.core.pairing.activate({ topic: r });
      } else if (Ye(s)) {
        await this.deleteProposal(i);
        const o = J("session_connect", i);
        if (this.events.listenerCount(o) === 0) throw new Error(`emitting ${o} without any listeners, 954`);
        this.events.emit(o, { error: s.error });
      }
    }, this.onSessionSettleRequest = async (r, s) => {
      const { id: n, params: i } = s;
      try {
        this.isValidSessionSettleRequest(i);
        const { relay: o, controller: a, expiry: c, namespaces: l, sessionProperties: u, scopedProperties: h, sessionConfig: f, proposalRequestsResponses: g } = s.params, p = [...this.pendingSessions.values()].find((E) => E.sessionTopic === r);
        if (!p) return this.client.logger.error(`Pending session not found for topic ${r}`);
        const y = this.client.proposal.get(p.proposalId), m = { topic: r, relay: o, expiry: c, namespaces: l, acknowledged: !0, pairingTopic: p.pairingTopic, requiredNamespaces: y.requiredNamespaces, optionalNamespaces: y.optionalNamespaces, controller: a.publicKey, self: { publicKey: p.publicKey, metadata: this.client.metadata }, peer: { publicKey: a.publicKey, metadata: a.metadata }, ...u && { sessionProperties: u }, ...h && { scopedProperties: h }, ...f && { sessionConfig: f }, transportType: te.relay, authentication: g?.authentication, walletPayResult: g?.walletPay };
        await this.client.session.set(m.topic, m), await this.setExpiry(m.topic, m.expiry), await this.client.core.pairing.updateMetadata({ topic: p.pairingTopic, metadata: m.peer.metadata }), this.pendingSessions.delete(p.proposalId), this.deleteProposal(p.proposalId, !1), this.cleanupDuplicatePairings(m), await this.sendResult({ id: s.id, topic: r, throwOnFailedPublish: !0, result: !0 }), this.client.events.emit("session_connect", { session: m }), this.events.emit(J("session_connect", p.proposalId), { session: m });
      } catch (o) {
        await this.sendError({ id: n, topic: r, error: o }), this.client.logger.error(o);
      }
    }, this.onSessionSettleResponse = async (r, s) => {
      const { id: n } = s;
      gt(s) ? (await this.client.session.update(r, { acknowledged: !0 }), this.events.emit(J("session_approve", n), {})) : Ye(s) && (await this.deleteSession({ topic: r, emitEvent: !1 }), this.events.emit(J("session_approve", n), { error: s.error }));
    }, this.onSessionUpdateRequest = async (r, s) => {
      const { params: n, id: i } = s;
      try {
        const o = `${r}_session_update`, a = fs.get(o);
        if (a && this.isRequestOutOfSync(a, i)) {
          this.client.logger.warn(`Discarding out of sync request - ${i}`), this.sendError({ id: i, topic: r, error: Q("INVALID_UPDATE_REQUEST") });
          return;
        }
        await this.isValidUpdate({ topic: r, ...n });
        const c = this.client.session.get(r);
        if (c.peer.publicKey !== c.controller) throw Q("UNAUTHORIZED_UPDATE_REQUEST");
        try {
          fs.set(o, i), await this.client.session.update(r, { namespaces: n.namespaces }), await this.sendResult({ id: i, topic: r, result: !0 });
        } catch (l) {
          throw fs.delete(o), l;
        }
        this.client.events.emit("session_update", { id: i, topic: r, params: n });
      } catch (o) {
        await this.sendError({ id: i, topic: r, error: o }), this.client.logger.error(o);
      }
    }, this.isRequestOutOfSync = (r, s) => s.toString().slice(0, -3) < r.toString().slice(0, -3), this.onSessionUpdateResponse = (r, s) => {
      const { id: n } = s, i = J("session_update", n);
      if (this.events.listenerCount(i) === 0) throw new Error(`emitting ${i} without any listeners`);
      gt(s) ? this.events.emit(J("session_update", n), {}) : Ye(s) && this.events.emit(J("session_update", n), { error: s.error });
    }, this.onSessionExtendRequest = async (r, s) => {
      const { id: n } = s;
      try {
        await this.isValidExtend({ topic: r }), await this.setExpiry(r, ae(jr)), await this.sendResult({ id: n, topic: r, result: !0 }), this.client.events.emit("session_extend", { id: n, topic: r });
      } catch (i) {
        await this.sendError({ id: n, topic: r, error: i }), this.client.logger.error(i);
      }
    }, this.onSessionExtendResponse = (r, s) => {
      const { id: n } = s, i = J("session_extend", n);
      if (this.events.listenerCount(i) === 0) throw new Error(`emitting ${i} without any listeners`);
      gt(s) ? this.events.emit(J("session_extend", n), {}) : Ye(s) && this.events.emit(J("session_extend", n), { error: s.error });
    }, this.onSessionPingRequest = async (r, s) => {
      const { id: n } = s;
      try {
        this.isValidPing({ topic: r }), await this.sendResult({ id: n, topic: r, result: !0, throwOnFailedPublish: !0 }), this.client.events.emit("session_ping", { id: n, topic: r });
      } catch (i) {
        await this.sendError({ id: n, topic: r, error: i }), this.client.logger.error(i);
      }
    }, this.onSessionPingResponse = (r, s) => {
      const { id: n } = s, i = J("session_ping", n);
      setTimeout(() => {
        if (this.events.listenerCount(i) === 0) throw new Error(`emitting ${i} without any listeners 2176`);
        gt(s) ? this.events.emit(J("session_ping", n), {}) : Ye(s) && this.events.emit(J("session_ping", n), { error: s.error });
      }, 500);
    }, this.onSessionDeleteRequest = async (r, s) => {
      const { id: n } = s;
      try {
        await this.isValidDisconnect({ topic: r, reason: s.params }), this.cleanupPendingSentRequestsForTopic({ topic: r, error: Q("USER_DISCONNECTED") }), await this.deleteSession({ topic: r, id: n });
      } catch (i) {
        this.client.logger.error(i);
      }
    }, this.onSessionRequest = async (r) => {
      const { topic: s, payload: n, attestation: i, encryptedId: o, transportType: a } = r, { id: c, params: l } = n;
      try {
        await this.isValidRequest({ topic: s, ...l });
        const u = this.client.session.get(s), h = await this.getVerifyContext({ attestationId: i, hash: Ge(JSON.stringify(ot("wc_sessionRequest", l, c))), encryptedId: o, metadata: u.peer.metadata, transportType: a }), f = { id: c, topic: s, params: l, verifyContext: h };
        await this.setPendingSessionRequest(f), a === te.link_mode && u.peer.metadata.redirect?.universal && this.client.core.addLinkModeSupportedApp(u.peer.metadata.redirect?.universal), this.client.signConfig?.disableRequestQueue ? this.emitSessionRequest(f) : (this.addSessionRequestToSessionRequestQueue(f), this.processSessionRequestQueue());
      } catch (u) {
        await this.sendError({ id: c, topic: s, error: u }), this.client.logger.error(u);
      }
    }, this.onSessionRequestResponse = (r, s) => {
      const { id: n } = s, i = J("session_request", n);
      if (this.events.listenerCount(i) === 0) throw new Error(`emitting ${i} without any listeners`);
      gt(s) ? this.events.emit(J("session_request", n), { result: s.result }) : Ye(s) && this.events.emit(J("session_request", n), { error: s.error });
    }, this.onSessionEventRequest = async (r, s) => {
      const { id: n, params: i } = s;
      try {
        const o = `${r}_session_event_${i.event.name}`, a = fs.get(o);
        if (a && this.isRequestOutOfSync(a, n)) {
          this.client.logger.info(`Discarding out of sync request - ${n}`);
          return;
        }
        this.isValidEmit({ topic: r, ...i }), this.client.events.emit("session_event", { id: n, topic: r, params: i }), fs.set(o, n);
      } catch (o) {
        await this.sendError({ id: n, topic: r, error: o }), this.client.logger.error(o);
      }
    }, this.onSessionAuthenticateResponse = (r, s) => {
      const { id: n } = s;
      this.client.logger.trace({ type: "method", method: "onSessionAuthenticateResponse", topic: r, payload: s }), gt(s) ? this.events.emit(J("session_request", n), { result: s.result }) : Ye(s) && this.events.emit(J("session_request", n), { error: s.error });
    }, this.onSessionAuthenticateRequest = async (r) => {
      const { topic: s, payload: n, attestation: i, encryptedId: o, transportType: a } = r;
      try {
        const { requester: c, authPayload: l, expiryTimestamp: u } = n.params, h = await this.getVerifyContext({ attestationId: i, hash: Ge(JSON.stringify(n)), encryptedId: o, metadata: c.metadata, transportType: a }), f = { requester: c, pairingTopic: s, id: n.id, authPayload: l, verifyContext: h, expiryTimestamp: u };
        await this.setAuthRequest(n.id, { request: f, pairingTopic: s, transportType: a }), a === te.link_mode && c.metadata.redirect?.universal && this.client.core.addLinkModeSupportedApp(c.metadata.redirect.universal), this.client.events.emit("session_authenticate", { topic: s, params: n.params, id: n.id, verifyContext: h });
      } catch (c) {
        this.client.logger.error(c);
        const l = n.params.requester.publicKey, u = await this.client.core.crypto.generateKeyPair(), h = this.getAppLinkIfEnabled(n.params.requester.metadata, a), f = { type: jt, receiverPublicKey: l, senderPublicKey: u };
        await this.sendError({ id: n.id, topic: s, error: c, encodeOpts: f, rpcOpts: me.wc_sessionAuthenticate.autoReject, appLink: h });
      }
    }, this.addSessionRequestToSessionRequestQueue = (r) => {
      this.sessionRequestQueue.queue.push(r);
    }, this.cleanupAfterResponse = (r) => {
      this.deletePendingSessionRequest(r.response.id, { message: "fulfilled", code: 0 }), setTimeout(() => {
        this.sessionRequestQueue.state = ft.idle, this.processSessionRequestQueue();
      }, F.toMiliseconds(this.requestQueueDelay));
    }, this.cleanupPendingSentRequestsForTopic = ({ topic: r, error: s }) => {
      const n = this.client.core.history.pending;
      n.length > 0 && n.filter((i) => i.topic === r && i.request.method === "wc_sessionRequest").forEach((i) => {
        this.events.emit(J("session_request", i.request.id), { error: s });
      });
    }, this.processSessionRequestQueue = () => {
      if (this.sessionRequestQueue.state === ft.active) {
        this.client.logger.info("session request queue is already active.");
        return;
      }
      const r = this.sessionRequestQueue.queue[0];
      if (!r) {
        this.client.logger.info("session request queue is empty.");
        return;
      }
      try {
        this.emitSessionRequest(r);
      } catch (s) {
        this.client.logger.error(s);
      }
    }, this.emitSessionRequest = (r) => {
      if (this.emittedSessionRequests.has(r.id)) {
        this.client.logger.warn({ id: r.id }, `Skipping emitting \`session_request\` event for duplicate request. id: ${r.id}`);
        return;
      }
      this.sessionRequestQueue.state = ft.active, this.emittedSessionRequests.add(r.id), this.client.events.emit("session_request", r);
    }, this.cleanupInProgress = !1, this.cleanupOrphanedSubscriptions = async () => {
      const r = this.client.core.relayer.subscriber.topics;
      if (r.length === 0) return;
      const s = new Set(this.client.session.keys), n = new Set(this.client.core.pairing.pairings.keys), i = new Set([...this.pendingSessions.values()].map((a) => a.sessionTopic));
      let o;
      if (this.client.auth.authKeys.keys.includes(Jt)) {
        const { responseTopic: a } = this.client.auth.authKeys.get(Jt);
        o = a;
      }
      for (const a of r) if (!s.has(a) && !n.has(a) && !i.has(a) && a !== o) {
        this.client.logger.info(`Cleaning up orphaned subscriber topic: ${a}`);
        try {
          await this.client.core.relayer.subscriber.unsubscribe(a);
        } catch (c) {
          this.client.logger.warn(c, `Failed to clean up orphaned subscription: ${a}`);
        }
      }
    }, this.onPairingCreated = (r) => {
      if (r.methods && this.expectedPairingMethodMap.set(r.topic, r.methods), r.active) return;
      const s = this.client.proposal.getAll().find((n) => n.pairingTopic === r.topic);
      s && this.onSessionProposeRequest({ topic: r.topic, payload: ot("wc_sessionPropose", { ...s, requiredNamespaces: s.requiredNamespaces, optionalNamespaces: s.optionalNamespaces, relays: s.relays, proposer: s.proposer, sessionProperties: s.sessionProperties, scopedProperties: s.scopedProperties }, s.id), attestation: s.attestation, encryptedId: s.encryptedId });
    }, this.isValidConnect = async (r) => {
      if (!Be(r)) {
        const { message: l } = j("MISSING_OR_INVALID", `connect() params: ${JSON.stringify(r)}`);
        throw new Error(l);
      }
      const { pairingTopic: s, requiredNamespaces: n, optionalNamespaces: i, sessionProperties: o, scopedProperties: a, relays: c } = r;
      if (he(s) || await this.isValidPairingTopic(s), !Ax(c)) {
        const { message: l } = j("MISSING_OR_INVALID", `connect() relays: ${c}`);
        throw new Error(l);
      }
      if (n && !he(n) && Et(n) !== 0) {
        const l = "requiredNamespaces are deprecated and are automatically assigned to optionalNamespaces";
        ["fatal", "error", "silent"].includes(this.client.logger.level) ? console.warn(l) : this.client.logger.warn(l), this.validateNamespaces(n, "requiredNamespaces");
      }
      if (i && !he(i) && Et(i) !== 0 && this.validateNamespaces(i, "optionalNamespaces"), o && !he(o) && this.validateSessionProps(o, "sessionProperties"), a && !he(a)) {
        this.validateSessionProps(a, "scopedProperties");
        const l = Object.keys(n || {}).concat(Object.keys(i || {}));
        if (!Object.keys(a).every((u) => l.includes(u.split(":")[0]))) throw new Error(`Scoped properties must be a subset of required/optional namespaces, received: ${JSON.stringify(a)}, required/optional namespaces: ${JSON.stringify(l)}`);
      }
    }, this.validateNamespaces = (r, s) => {
      const n = Dx(r, "connect()", s);
      if (n) throw new Error(n.message);
    }, this.isValidApprove = async (r) => {
      if (!Be(r)) throw new Error(j("MISSING_OR_INVALID", `approve() params: ${r}`).message);
      const { id: s, namespaces: n, relayProtocol: i, sessionProperties: o, scopedProperties: a } = r;
      this.checkRecentlyDeleted(s), await this.isValidProposalId(s);
      const c = this.client.proposal.get(s), l = eo(n, "approve()");
      if (l) throw new Error(l.message);
      const u = Zl(c.requiredNamespaces, n, "approve()");
      if (u) throw new Error(u.message);
      if (!ce(i, !0)) {
        const { message: h } = j("MISSING_OR_INVALID", `approve() relayProtocol: ${i}`);
        throw new Error(h);
      }
      if (o && !he(o) && this.validateSessionProps(o, "sessionProperties"), a && !he(a)) {
        this.validateSessionProps(a, "scopedProperties");
        const h = new Set(Object.keys(n));
        if (!Object.keys(a).every((f) => h.has(f.split(":")[0]))) throw new Error(`Scoped properties must be a subset of approved namespaces, received: ${JSON.stringify(a)}, approved namespaces: ${Array.from(h).join(", ")}`);
      }
    }, this.isValidReject = async (r) => {
      if (!Be(r)) {
        const { message: i } = j("MISSING_OR_INVALID", `reject() params: ${r}`);
        throw new Error(i);
      }
      const { id: s, reason: n } = r;
      if (this.checkRecentlyDeleted(s), await this.isValidProposalId(s), !$x(n)) {
        const { message: i } = j("MISSING_OR_INVALID", `reject() reason: ${JSON.stringify(n)}`);
        throw new Error(i);
      }
    }, this.isValidSessionSettleRequest = (r) => {
      if (!Be(r)) {
        const { message: l } = j("MISSING_OR_INVALID", `onSessionSettleRequest() params: ${r}`);
        throw new Error(l);
      }
      const { relay: s, controller: n, namespaces: i, expiry: o } = r;
      if (!dd(s)) {
        const { message: l } = j("MISSING_OR_INVALID", "onSessionSettleRequest() relay protocol should be a string");
        throw new Error(l);
      }
      const a = vx(n, "onSessionSettleRequest()");
      if (a) throw new Error(a.message);
      const c = eo(i, "onSessionSettleRequest()");
      if (c) throw new Error(c.message);
      if (wt(o)) {
        const { message: l } = j("EXPIRED", "onSessionSettleRequest()");
        throw new Error(l);
      }
    }, this.isValidUpdate = async (r) => {
      if (!Be(r)) {
        const { message: c } = j("MISSING_OR_INVALID", `update() params: ${r}`);
        throw new Error(c);
      }
      const { topic: s, namespaces: n } = r;
      this.checkRecentlyDeleted(s), await this.isValidSessionTopic(s);
      const i = this.client.session.get(s), o = eo(n, "update()");
      if (o) throw new Error(o.message);
      const a = Zl(i.requiredNamespaces, n, "update()");
      if (a) throw new Error(a.message);
    }, this.isValidExtend = async (r) => {
      if (!Be(r)) {
        const { message: n } = j("MISSING_OR_INVALID", `extend() params: ${r}`);
        throw new Error(n);
      }
      const { topic: s } = r;
      this.checkRecentlyDeleted(s), await this.isValidSessionTopic(s);
    }, this.isValidRequest = async (r) => {
      if (!Be(r)) {
        const { message: c } = j("MISSING_OR_INVALID", `request() params: ${r}`);
        throw new Error(c);
      }
      const { topic: s, request: n, chainId: i, expiry: o } = r;
      this.checkRecentlyDeleted(s), await this.isValidSessionTopic(s);
      const { namespaces: a } = this.client.session.get(s);
      if (!Yl(a, i)) {
        const { message: c } = j("MISSING_OR_INVALID", `request() chainId: ${i}`);
        throw new Error(c);
      }
      if (!Px(n)) {
        const { message: c } = j("MISSING_OR_INVALID", `request() ${JSON.stringify(n)}`);
        throw new Error(c);
      }
      if (!Rx(a, i, n.method)) {
        const { message: c } = j("MISSING_OR_INVALID", `request() method: ${n.method}`);
        throw new Error(c);
      }
      this.validateRequestExpiry(o);
    }, this.isValidRespond = async (r) => {
      if (!Be(r)) {
        const { message: o } = j("MISSING_OR_INVALID", `respond() params: ${r}`);
        throw new Error(o);
      }
      const { topic: s, response: n } = r;
      try {
        await this.isValidSessionTopic(s);
      } catch (o) {
        throw r?.response?.id && this.cleanupAfterResponse(r), o;
      }
      if (!Tx(n)) {
        const { message: o } = j("MISSING_OR_INVALID", `respond() response: ${JSON.stringify(n)}`);
        throw new Error(o);
      }
      const i = this.client.pendingRequest.get(n.id);
      if (i.topic !== s) {
        const { message: o } = j("MISMATCHED_TOPIC", `Request response topic mismatch. reqId: ${n.id}, expected topic: ${i.topic}, received topic: ${s}`);
        throw new Error(o);
      }
    }, this.isValidPing = async (r) => {
      if (!Be(r)) {
        const { message: n } = j("MISSING_OR_INVALID", `ping() params: ${r}`);
        throw new Error(n);
      }
      const { topic: s } = r;
      await this.isValidSessionOrPairingTopic(s);
    }, this.isValidEmit = async (r) => {
      if (!Be(r)) {
        const { message: a } = j("MISSING_OR_INVALID", `emit() params: ${r}`);
        throw new Error(a);
      }
      const { topic: s, event: n, chainId: i } = r;
      await this.isValidSessionTopic(s);
      const { namespaces: o } = this.client.session.get(s);
      if (!Yl(o, i)) {
        const { message: a } = j("MISSING_OR_INVALID", `emit() chainId: ${i}`);
        throw new Error(a);
      }
      if (!Bx(n)) {
        const { message: a } = j("MISSING_OR_INVALID", `emit() event: ${JSON.stringify(n)}`);
        throw new Error(a);
      }
      if (!Cx(o, i, n.name)) {
        const { message: a } = j("MISSING_OR_INVALID", `emit() event: ${JSON.stringify(n)}`);
        throw new Error(a);
      }
    }, this.isValidDisconnect = async (r) => {
      if (!Be(r)) {
        const { message: n } = j("MISSING_OR_INVALID", `disconnect() params: ${r}`);
        throw new Error(n);
      }
      const { topic: s } = r;
      await this.isValidSessionOrPairingTopic(s);
    }, this.isValidAuthenticate = (r) => {
      const { chains: s, uri: n, domain: i, nonce: o } = r;
      if (!Array.isArray(s) || s.length === 0) throw new Error("chains is required and must be a non-empty array");
      if (!ce(n, !1)) throw new Error("uri is required parameter");
      if (!ce(i, !1)) throw new Error("domain is required parameter");
      if (!ce(o, !1)) throw new Error("nonce is required parameter");
      if ([...new Set(s.map((c) => Ft(c).namespace))].length > 1) throw new Error("Multi-namespace requests are not supported. Please request single namespace only.");
      const { namespace: a } = Ft(s[0]);
      if (a !== "eip155") throw new Error("Only eip155 namespace is supported for authenticated sessions. Please use .connect() for non-eip155 chains.");
    }, this.getVerifyContext = async (r) => {
      const { attestationId: s, hash: n, encryptedId: i, metadata: o, transportType: a } = r, c = { verified: { verifyUrl: o.verifyUrl || _s, validation: "UNKNOWN", origin: o.url || "" } };
      try {
        if (a === te.link_mode) {
          const u = this.getAppLinkIfEnabled(o, a);
          return c.verified.validation = u && new URL(u).origin === new URL(o.url).origin ? "VALID" : "INVALID", c;
        }
        const l = await this.client.core.verify.resolve({ attestationId: s, hash: n, encryptedId: i, verifyUrl: o.verifyUrl });
        l && (c.verified.origin = l.origin, c.verified.isScam = l.isScam, c.verified.validation = l.origin === new URL(o.url).origin ? "VALID" : "INVALID");
      } catch (l) {
        this.client.logger.warn(l);
      }
      return this.client.logger.debug(`Verify context: ${JSON.stringify(c)}`), c;
    }, this.validateSessionProps = (r, s) => {
      Object.values(r).forEach((n, i) => {
        if (n == null) {
          const { message: o } = j("MISSING_OR_INVALID", `${s} must contain an existing value for each key. Received: ${n} for key ${Object.keys(r)[i]}`);
          throw new Error(o);
        }
      });
    }, this.getPendingAuthRequest = (r) => {
      const s = this.client.auth.requests.get(r);
      return typeof s == "object" ? s : void 0;
    }, this.addToRecentlyDeleted = (r, s) => {
      if (this.recentlyDeletedMap.set(r, s), this.recentlyDeletedMap.size >= this.recentlyDeletedLimit) {
        let n = 0;
        const i = this.recentlyDeletedLimit / 2;
        for (const o of this.recentlyDeletedMap.keys()) {
          if (n++ >= i) break;
          this.recentlyDeletedMap.delete(o);
        }
      }
    }, this.checkRecentlyDeleted = (r) => {
      const s = this.recentlyDeletedMap.get(r);
      if (s) {
        const { message: n } = j("MISSING_OR_INVALID", `Record was recently deleted - ${s}: ${r}`);
        throw new Error(n);
      }
    }, this.isLinkModeEnabled = (r, s) => !r || s !== te.link_mode ? !1 : this.client.metadata?.redirect?.linkMode === !0 && this.client.metadata?.redirect?.universal !== void 0 && this.client.metadata?.redirect?.universal !== "" && r?.redirect?.universal !== void 0 && r?.redirect?.universal !== "" && r?.redirect?.linkMode === !0 && this.client.core.linkModeSupportedApps.includes(r.redirect.universal) && typeof global?.Linking < "u", this.getAppLinkIfEnabled = (r, s) => this.isLinkModeEnabled(r, s) ? r?.redirect?.universal : void 0, this.handleLinkModeMessage = ({ url: r }) => {
      if (!r || !r.includes("wc_ev") || !r.includes("topic")) return;
      const s = Bl(r, "topic") || "", n = decodeURIComponent(Bl(r, "wc_ev") || ""), i = this.client.session.keys.includes(s);
      i && this.client.session.update(s, { transportType: te.link_mode }), this.client.core.dispatchEnvelope({ topic: s, message: n, sessionExists: i });
    }, this.registerLinkModeListeners = async () => {
      if ($a() || fr() && this.client.metadata.redirect?.linkMode) {
        const r = global?.Linking;
        if (typeof r < "u") {
          r.addEventListener("url", this.handleLinkModeMessage, this.client.name);
          const s = await r.getInitialURL();
          s && setTimeout(() => {
            this.handleLinkModeMessage({ url: s });
          }, 50);
        }
      }
    }, this.getTVFApproveParams = (r) => {
      try {
        const s = hd(r.namespaces), n = lx(r.namespaces), i = ux(r.namespaces), o = r.sessionProperties, a = r.scopedProperties;
        return { approvedChains: s, approvedMethods: n, approvedEvents: i, sessionProperties: o, scopedProperties: a };
      } catch (s) {
        return this.client.logger.warn(s, "Error getting TVF approve params"), {};
      }
    }, this.getTVFParams = (r, s, n) => {
      if (!s.request?.method) return {};
      const i = { correlationId: r, rpcMethods: [s.request.method], chainId: s.chainId };
      try {
        const o = this.extractTxHashesFromResult(s.request, n);
        i.txHashes = o, i.contractAddresses = this.isValidContractData(s.request.params) ? [s.request.params?.[0]?.to] : [];
      } catch (o) {
        this.client.logger.warn(o, "Error getting TVF params");
      }
      return i;
    }, this.isValidContractData = (r) => {
      if (!r) return !1;
      try {
        const s = r?.data || r?.[0]?.data;
        if (!s.startsWith("0x")) return !1;
        const n = s.slice(2);
        return /^[0-9a-fA-F]*$/.test(n) ? n.length % 2 === 0 : !1;
      } catch {
      }
      return !1;
    }, this.extractTxHashesFromResult = (r, s) => {
      try {
        if (!s) return [];
        const n = r.method, i = t3[n];
        if (n === "sui_signTransaction") return [I2(s.transactionBytes)];
        if (n === "near_signTransaction") return [Cl(s)];
        if (n === "near_signTransactions") return s.map((a) => Cl(a));
        if (n === "xrpl_signTransactionFor" || n === "xrpl_signTransaction") return [s.tx_json?.hash];
        if (n === "polkadot_signTransaction") return [Jx({ transaction: r.params.transactionPayload, signature: s.signature })];
        if (n === "algo_signTxn") return Ze(s) ? s.map((a) => Nl(a)) : [Nl(s)];
        if (n === "cosmos_signDirect") return [A2(s)];
        if (n === "stellar_signXDR") return [R2(s.signedXDR, r.params?.chain)];
        if (n === "wallet_sendCalls") return C2(s);
        if (n === "canton_prepareSignExecute") return t_(r.params, s);
        if (typeof s == "string") return [s];
        const o = s[i.key];
        if (Ze(o)) return n === "solana_signAllTransactions" ? o.map((a) => S2(a)) : o;
        if (typeof o == "string") return [o];
      } catch (n) {
        this.client.logger.warn(n, "Error extracting tx hashes from result");
      }
      return [];
    };
  }
  async processPendingMessageEvents() {
    try {
      const e = this.client.session.keys, r = this.client.core.relayer.messages.getWithoutAck(e);
      for (const [s, n] of Object.entries(r)) for (const i of n) try {
        await this.onProviderMessageEvent({ topic: s, message: i, publishedAt: Date.now() });
      } catch {
        this.client.logger.warn(`Error processing pending message event for topic: ${s}, message: ${i}`);
      }
    } catch (e) {
      this.client.logger.warn(e, "processPendingMessageEvents failed");
    }
  }
  isInitialized() {
    if (!this.initialized) {
      const { message: e } = j("NOT_INITIALIZED", this.name);
      throw new Error(e);
    }
  }
  async confirmOnlineStateOrThrow() {
    await this.client.core.relayer.confirmOnlineStateOrThrow();
  }
  registerRelayerEvents() {
    this.client.core.relayer.on(se.message, (e) => {
      this.onProviderMessageEvent(e);
    });
  }
  async onRelayMessage(e) {
    const { topic: r, message: s, attestation: n, transportType: i } = e, { publicKey: o } = this.client.auth.authKeys.keys.includes(Jt) ? this.client.auth.authKeys.get(Jt) : { publicKey: void 0 };
    try {
      try {
        if (i !== te.link_mode && this.client.core.crypto.getPayloadType(s, mt) === Br) {
          this.client.logger.warn(`onRelayMessage() -> non-link mode TYPE_2 payload ignored: ${s}`);
          return;
        }
      } catch {
      }
      const a = await this.client.core.crypto.decode(r, s, { receiverPublicKey: o, encoding: i === te.link_mode ? mt : be });
      Na(a) ? (this.client.core.history.set(r, a), await this.onRelayEventRequest({ topic: r, payload: a, attestation: n, transportType: i, encryptedId: Ge(s) })) : li(a) ? (await this.client.core.history.resolve(a), await this.onRelayEventResponse({ topic: r, payload: a, transportType: i }), this.client.core.history.delete(r, a.id)) : (this.client.logger.error(`onRelayMessage() -> unknown payload: ${JSON.stringify(a)}`), await this.onRelayEventUnknownPayload({ topic: r, payload: a, transportType: i })), await this.client.core.relayer.messages.ack(r, s);
    } catch (a) {
      this.client.logger.error(`onRelayMessage() -> failed to process an inbound message: ${s}`), this.client.logger.error(a?.message);
    }
  }
  registerExpirerEvents() {
    this.client.core.expirer.on(Ve.expired, async (e) => {
      const { topic: r, id: s } = Qf(e.target);
      if (s && this.client.pendingRequest.keys.includes(s)) return await this.deletePendingSessionRequest(s, j("EXPIRED"), !0);
      if (s && this.client.auth.requests.keys.includes(s)) return await this.deletePendingAuthRequest(s, j("EXPIRED"), !0);
      r ? this.client.session.keys.includes(r) && (await this.deleteSession({ topic: r, expirerHasDeleted: !0 }), this.client.events.emit("session_expire", { topic: r })) : s && (await this.deleteProposal(s, !0), this.client.events.emit("proposal_expire", { id: s }));
    });
  }
  registerSubscriptionCleanup() {
    this.client.core.heartbeat.on("heartbeat_pulse", async () => {
      if (!this.cleanupInProgress) {
        this.cleanupInProgress = !0;
        try {
          await this.cleanupOrphanedSubscriptions();
        } catch (e) {
          this.client.logger.warn(e);
        } finally {
          this.cleanupInProgress = !1;
        }
      }
    });
  }
  registerPairingEvents() {
    this.client.core.pairing.events.on(vr.create, (e) => this.onPairingCreated(e)), this.client.core.pairing.events.on(vr.delete, (e) => {
      this.addToRecentlyDeleted(e.topic, "pairing");
    });
  }
  isValidPairingTopic(e) {
    if (!ce(e, !1)) {
      const { message: r } = j("MISSING_OR_INVALID", `pairing topic should be a string: ${e}`);
      throw new Error(r);
    }
    if (!this.client.core.pairing.pairings.keys.includes(e)) {
      const { message: r } = j("NO_MATCHING_KEY", `pairing topic doesn't exist: ${e}`);
      throw new Error(r);
    }
    if (wt(this.client.core.pairing.pairings.get(e).expiry)) {
      const { message: r } = j("EXPIRED", `pairing topic: ${e}`);
      throw new Error(r);
    }
  }
  async isValidSessionTopic(e) {
    if (!ce(e, !1)) {
      const { message: r } = j("MISSING_OR_INVALID", `session topic should be a string: ${e}`);
      throw new Error(r);
    }
    if (this.checkRecentlyDeleted(e), !this.client.session.keys.includes(e)) {
      const { message: r } = j("NO_MATCHING_KEY", `session topic doesn't exist: ${e}`);
      throw new Error(r);
    }
    if (wt(this.client.session.get(e).expiry)) {
      await this.deleteSession({ topic: e });
      const { message: r } = j("EXPIRED", `session topic: ${e}`);
      throw new Error(r);
    }
    if (!this.client.core.crypto.keychain.has(e)) {
      const { message: r } = j("MISSING_OR_INVALID", `session topic does not exist in keychain: ${e}`);
      throw await this.deleteSession({ topic: e }), new Error(r);
    }
  }
  async isValidSessionOrPairingTopic(e) {
    if (this.checkRecentlyDeleted(e), this.client.session.keys.includes(e)) await this.isValidSessionTopic(e);
    else if (this.client.core.pairing.pairings.keys.includes(e)) this.isValidPairingTopic(e);
    else if (ce(e, !1)) {
      const { message: r } = j("NO_MATCHING_KEY", `session or pairing topic doesn't exist: ${e}`);
      throw new Error(r);
    } else {
      const { message: r } = j("MISSING_OR_INVALID", `session or pairing topic should be a string: ${e}`);
      throw new Error(r);
    }
  }
  async isValidProposalId(e) {
    if (!Ox(e)) {
      const { message: r } = j("MISSING_OR_INVALID", `proposal id should be a number: ${e}`);
      throw new Error(r);
    }
    if (!this.client.proposal.keys.includes(e)) {
      const { message: r } = j("NO_MATCHING_KEY", `proposal id doesn't exist: ${e}`);
      throw new Error(r);
    }
    if (wt(this.client.proposal.get(e).expiryTimestamp)) {
      await this.deleteProposal(e);
      const { message: r } = j("EXPIRED", `proposal id: ${e}`);
      throw new Error(r);
    }
  }
  validateRequestExpiry(e) {
    if (e && !Lx(e, co)) {
      const { message: r } = j("MISSING_OR_INVALID", `request() expiry: ${e}. Expiry must be a number (in seconds) between ${co.min} and ${co.max}`);
      throw new Error(r);
    }
  }
}
class u3 extends Lr {
  constructor(e, r) {
    super(e, r, JI, ja), this.core = e, this.logger = r;
  }
}
class h3 extends Lr {
  constructor(e, r) {
    super(e, r, QI, ja), this.core = e, this.logger = r;
  }
}
class f3 extends Lr {
  constructor(e, r) {
    super(e, r, r3, ja, (s) => s.id), this.core = e, this.logger = r;
  }
}
class d3 extends Lr {
  constructor(e, r) {
    super(e, r, o3, ui, () => Jt), this.core = e, this.logger = r;
  }
}
class p3 extends Lr {
  constructor(e, r) {
    super(e, r, a3, ui), this.core = e, this.logger = r;
  }
}
class g3 extends Lr {
  constructor(e, r) {
    super(e, r, c3, ui, (s) => s.id), this.core = e, this.logger = r;
  }
}
class y3 {
  constructor(e, r) {
    this.core = e, this.logger = r, this.authKeys = new d3(this.core, this.logger), this.pairingTopics = new p3(this.core, this.logger), this.requests = new g3(this.core, this.logger);
  }
  async init() {
    await this.authKeys.init(), await this.pairingTopics.init(), await this.requests.init();
  }
}
let w3 = class Gd extends G_ {
  constructor(e) {
    super(e), this.protocol = Kd, this.version = Vd, this.name = ao.name, this.events = new je.EventEmitter(), this.on = (s, n) => this.events.on(s, n), this.once = (s, n) => this.events.once(s, n), this.off = (s, n) => this.events.off(s, n), this.removeListener = (s, n) => this.events.removeListener(s, n), this.removeAllListeners = (s) => this.events.removeAllListeners(s), this.connect = async (s) => {
      try {
        return await this.engine.connect(s);
      } catch (n) {
        throw this.logger.error(n.message), n;
      }
    }, this.pair = async (s) => {
      try {
        return await this.engine.pair(s);
      } catch (n) {
        throw this.logger.error(n.message), n;
      }
    }, this.approve = async (s) => {
      try {
        return await this.engine.approve(s);
      } catch (n) {
        throw this.logger.error(n.message), n;
      }
    }, this.reject = async (s) => {
      try {
        return await this.engine.reject(s);
      } catch (n) {
        throw this.logger.error(n.message), n;
      }
    }, this.update = async (s) => {
      try {
        return await this.engine.update(s);
      } catch (n) {
        throw this.logger.error(n.message), n;
      }
    }, this.extend = async (s) => {
      try {
        return await this.engine.extend(s);
      } catch (n) {
        throw this.logger.error(n.message), n;
      }
    }, this.request = async (s) => {
      try {
        return await this.engine.request(s);
      } catch (n) {
        throw this.logger.error(n.message), n;
      }
    }, this.respond = async (s) => {
      try {
        return await this.engine.respond(s);
      } catch (n) {
        throw this.logger.error(n.message), n;
      }
    }, this.ping = async (s) => {
      try {
        return await this.engine.ping(s);
      } catch (n) {
        throw this.logger.error(n.message), n;
      }
    }, this.emit = async (s) => {
      try {
        return await this.engine.emit(s);
      } catch (n) {
        throw this.logger.error(n.message), n;
      }
    }, this.disconnect = async (s) => {
      try {
        return await this.engine.disconnect(s);
      } catch (n) {
        throw this.logger.error(n.message), n;
      }
    }, this.find = (s) => {
      try {
        return this.engine.find(s);
      } catch (n) {
        throw this.logger.error(n.message), n;
      }
    }, this.getPendingSessionRequests = () => {
      try {
        return this.engine.getPendingSessionRequests();
      } catch (s) {
        throw this.logger.error(s.message), s;
      }
    }, this.authenticate = async (s, n) => {
      try {
        return console.warn("[WalletConnect] `authenticate` is deprecated and will be removed in a future release. Use `connect()`'s `authentication` instead to establish an authenticated session."), await this.engine.authenticate(s, n);
      } catch (i) {
        throw this.logger.error(i.message), i;
      }
    }, this.formatAuthMessage = (s) => {
      try {
        return this.engine.formatAuthMessage(s);
      } catch (n) {
        throw this.logger.error(n.message), n;
      }
    }, this.approveSessionAuthenticate = async (s) => {
      try {
        return await this.engine.approveSessionAuthenticate(s);
      } catch (n) {
        throw this.logger.error(n.message), n;
      }
    }, this.rejectSessionAuthenticate = async (s) => {
      try {
        return await this.engine.rejectSessionAuthenticate(s);
      } catch (n) {
        throw this.logger.error(n.message), n;
      }
    }, this.name = e?.name || ao.name, this.metadata = r2(e?.metadata), this.signConfig = e?.signConfig;
    const r = Ba({ logger: e?.logger || ao.logger, name: this.name });
    this.logger = r, this.core = e?.core || new XI(e), this.session = new h3(this.core, this.logger), this.proposal = new u3(this.core, this.logger), this.pendingRequest = new f3(this.core, this.logger), this.engine = new l3(this), this.auth = new y3(this.core, this.logger);
  }
  static async init(e) {
    const r = new Gd(e);
    return await r.initialize(), r;
  }
  get context() {
    return Le(this.logger);
  }
  get pairing() {
    return this.core.pairing.pairings;
  }
  async initialize() {
    this.logger.trace("Initialized");
    try {
      await this.core.start(), await this.session.init(), await this.proposal.init(), await this.pendingRequest.init(), await this.auth.init(), await this.engine.init(), this.logger.info("SignClient Initialization Success");
    } catch (e) {
      throw this.logger.info("SignClient Initialization Failure"), this.logger.error(e.message), e;
    }
  }
};
const m3 = w3;
var hn = { exports: {} }, bu;
function b3() {
  return bu || (bu = 1, (function(t, e) {
    var r = typeof globalThis < "u" && globalThis || typeof self < "u" && self || typeof yt < "u" && yt, s = (function() {
      function i() {
        this.fetch = !1, this.DOMException = r.DOMException;
      }
      return i.prototype = r, new i();
    })();
    (function(i) {
      (function(o) {
        var a = typeof i < "u" && i || typeof self < "u" && self || // eslint-disable-next-line no-undef
        typeof yt < "u" && yt || {}, c = {
          searchParams: "URLSearchParams" in a,
          iterable: "Symbol" in a && "iterator" in Symbol,
          blob: "FileReader" in a && "Blob" in a && (function() {
            try {
              return new Blob(), !0;
            } catch {
              return !1;
            }
          })(),
          formData: "FormData" in a,
          arrayBuffer: "ArrayBuffer" in a
        };
        function l(d) {
          return d && DataView.prototype.isPrototypeOf(d);
        }
        if (c.arrayBuffer)
          var u = [
            "[object Int8Array]",
            "[object Uint8Array]",
            "[object Uint8ClampedArray]",
            "[object Int16Array]",
            "[object Uint16Array]",
            "[object Int32Array]",
            "[object Uint32Array]",
            "[object Float32Array]",
            "[object Float64Array]"
          ], h = ArrayBuffer.isView || function(d) {
            return d && u.indexOf(Object.prototype.toString.call(d)) > -1;
          };
        function f(d) {
          if (typeof d != "string" && (d = String(d)), /[^a-z0-9\-#$%&'*+.^_`|~!]/i.test(d) || d === "")
            throw new TypeError('Invalid character in header field name: "' + d + '"');
          return d.toLowerCase();
        }
        function g(d) {
          return typeof d != "string" && (d = String(d)), d;
        }
        function p(d) {
          var w = {
            next: function() {
              var _ = d.shift();
              return { done: _ === void 0, value: _ };
            }
          };
          return c.iterable && (w[Symbol.iterator] = function() {
            return w;
          }), w;
        }
        function y(d) {
          this.map = {}, d instanceof y ? d.forEach(function(w, _) {
            this.append(_, w);
          }, this) : Array.isArray(d) ? d.forEach(function(w) {
            if (w.length != 2)
              throw new TypeError("Headers constructor: expected name/value pair to be length 2, found" + w.length);
            this.append(w[0], w[1]);
          }, this) : d && Object.getOwnPropertyNames(d).forEach(function(w) {
            this.append(w, d[w]);
          }, this);
        }
        y.prototype.append = function(d, w) {
          d = f(d), w = g(w);
          var _ = this.map[d];
          this.map[d] = _ ? _ + ", " + w : w;
        }, y.prototype.delete = function(d) {
          delete this.map[f(d)];
        }, y.prototype.get = function(d) {
          return d = f(d), this.has(d) ? this.map[d] : null;
        }, y.prototype.has = function(d) {
          return this.map.hasOwnProperty(f(d));
        }, y.prototype.set = function(d, w) {
          this.map[f(d)] = g(w);
        }, y.prototype.forEach = function(d, w) {
          for (var _ in this.map)
            this.map.hasOwnProperty(_) && d.call(w, this.map[_], _, this);
        }, y.prototype.keys = function() {
          var d = [];
          return this.forEach(function(w, _) {
            d.push(_);
          }), p(d);
        }, y.prototype.values = function() {
          var d = [];
          return this.forEach(function(w) {
            d.push(w);
          }), p(d);
        }, y.prototype.entries = function() {
          var d = [];
          return this.forEach(function(w, _) {
            d.push([_, w]);
          }), p(d);
        }, c.iterable && (y.prototype[Symbol.iterator] = y.prototype.entries);
        function m(d) {
          if (!d._noBody) {
            if (d.bodyUsed)
              return Promise.reject(new TypeError("Already read"));
            d.bodyUsed = !0;
          }
        }
        function E(d) {
          return new Promise(function(w, _) {
            d.onload = function() {
              w(d.result);
            }, d.onerror = function() {
              _(d.error);
            };
          });
        }
        function $(d) {
          var w = new FileReader(), _ = E(w);
          return w.readAsArrayBuffer(d), _;
        }
        function b(d) {
          var w = new FileReader(), _ = E(w), O = /charset=([A-Za-z0-9_-]+)/.exec(d.type), S = O ? O[1] : "utf-8";
          return w.readAsText(d, S), _;
        }
        function v(d) {
          for (var w = new Uint8Array(d), _ = new Array(w.length), O = 0; O < w.length; O++)
            _[O] = String.fromCharCode(w[O]);
          return _.join("");
        }
        function x(d) {
          if (d.slice)
            return d.slice(0);
          var w = new Uint8Array(d.byteLength);
          return w.set(new Uint8Array(d)), w.buffer;
        }
        function I() {
          return this.bodyUsed = !1, this._initBody = function(d) {
            this.bodyUsed = this.bodyUsed, this._bodyInit = d, d ? typeof d == "string" ? this._bodyText = d : c.blob && Blob.prototype.isPrototypeOf(d) ? this._bodyBlob = d : c.formData && FormData.prototype.isPrototypeOf(d) ? this._bodyFormData = d : c.searchParams && URLSearchParams.prototype.isPrototypeOf(d) ? this._bodyText = d.toString() : c.arrayBuffer && c.blob && l(d) ? (this._bodyArrayBuffer = x(d.buffer), this._bodyInit = new Blob([this._bodyArrayBuffer])) : c.arrayBuffer && (ArrayBuffer.prototype.isPrototypeOf(d) || h(d)) ? this._bodyArrayBuffer = x(d) : this._bodyText = d = Object.prototype.toString.call(d) : (this._noBody = !0, this._bodyText = ""), this.headers.get("content-type") || (typeof d == "string" ? this.headers.set("content-type", "text/plain;charset=UTF-8") : this._bodyBlob && this._bodyBlob.type ? this.headers.set("content-type", this._bodyBlob.type) : c.searchParams && URLSearchParams.prototype.isPrototypeOf(d) && this.headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8"));
          }, c.blob && (this.blob = function() {
            var d = m(this);
            if (d)
              return d;
            if (this._bodyBlob)
              return Promise.resolve(this._bodyBlob);
            if (this._bodyArrayBuffer)
              return Promise.resolve(new Blob([this._bodyArrayBuffer]));
            if (this._bodyFormData)
              throw new Error("could not read FormData body as blob");
            return Promise.resolve(new Blob([this._bodyText]));
          }), this.arrayBuffer = function() {
            if (this._bodyArrayBuffer) {
              var d = m(this);
              return d || (ArrayBuffer.isView(this._bodyArrayBuffer) ? Promise.resolve(
                this._bodyArrayBuffer.buffer.slice(
                  this._bodyArrayBuffer.byteOffset,
                  this._bodyArrayBuffer.byteOffset + this._bodyArrayBuffer.byteLength
                )
              ) : Promise.resolve(this._bodyArrayBuffer));
            } else {
              if (c.blob)
                return this.blob().then($);
              throw new Error("could not read as ArrayBuffer");
            }
          }, this.text = function() {
            var d = m(this);
            if (d)
              return d;
            if (this._bodyBlob)
              return b(this._bodyBlob);
            if (this._bodyArrayBuffer)
              return Promise.resolve(v(this._bodyArrayBuffer));
            if (this._bodyFormData)
              throw new Error("could not read FormData body as text");
            return Promise.resolve(this._bodyText);
          }, c.formData && (this.formData = function() {
            return this.text().then(L);
          }), this.json = function() {
            return this.text().then(JSON.parse);
          }, this;
        }
        var P = ["CONNECT", "DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT", "TRACE"];
        function B(d) {
          var w = d.toUpperCase();
          return P.indexOf(w) > -1 ? w : d;
        }
        function T(d, w) {
          if (!(this instanceof T))
            throw new TypeError('Please use the "new" operator, this DOM object constructor cannot be called as a function.');
          w = w || {};
          var _ = w.body;
          if (d instanceof T) {
            if (d.bodyUsed)
              throw new TypeError("Already read");
            this.url = d.url, this.credentials = d.credentials, w.headers || (this.headers = new y(d.headers)), this.method = d.method, this.mode = d.mode, this.signal = d.signal, !_ && d._bodyInit != null && (_ = d._bodyInit, d.bodyUsed = !0);
          } else
            this.url = String(d);
          if (this.credentials = w.credentials || this.credentials || "same-origin", (w.headers || !this.headers) && (this.headers = new y(w.headers)), this.method = B(w.method || this.method || "GET"), this.mode = w.mode || this.mode || null, this.signal = w.signal || this.signal || (function() {
            if ("AbortController" in a) {
              var D = new AbortController();
              return D.signal;
            }
          })(), this.referrer = null, (this.method === "GET" || this.method === "HEAD") && _)
            throw new TypeError("Body not allowed for GET or HEAD requests");
          if (this._initBody(_), (this.method === "GET" || this.method === "HEAD") && (w.cache === "no-store" || w.cache === "no-cache")) {
            var O = /([?&])_=[^&]*/;
            if (O.test(this.url))
              this.url = this.url.replace(O, "$1_=" + (/* @__PURE__ */ new Date()).getTime());
            else {
              var S = /\?/;
              this.url += (S.test(this.url) ? "&" : "?") + "_=" + (/* @__PURE__ */ new Date()).getTime();
            }
          }
        }
        T.prototype.clone = function() {
          return new T(this, { body: this._bodyInit });
        };
        function L(d) {
          var w = new FormData();
          return d.trim().split("&").forEach(function(_) {
            if (_) {
              var O = _.split("="), S = O.shift().replace(/\+/g, " "), D = O.join("=").replace(/\+/g, " ");
              w.append(decodeURIComponent(S), decodeURIComponent(D));
            }
          }), w;
        }
        function U(d) {
          var w = new y(), _ = d.replace(/\r?\n[\t ]+/g, " ");
          return _.split("\r").map(function(O) {
            return O.indexOf(`
`) === 0 ? O.substr(1, O.length) : O;
          }).forEach(function(O) {
            var S = O.split(":"), D = S.shift().trim();
            if (D) {
              var C = S.join(":").trim();
              try {
                w.append(D, C);
              } catch (M) {
                console.warn("Response " + M.message);
              }
            }
          }), w;
        }
        I.call(T.prototype);
        function N(d, w) {
          if (!(this instanceof N))
            throw new TypeError('Please use the "new" operator, this DOM object constructor cannot be called as a function.');
          if (w || (w = {}), this.type = "default", this.status = w.status === void 0 ? 200 : w.status, this.status < 200 || this.status > 599)
            throw new RangeError("Failed to construct 'Response': The status provided (0) is outside the range [200, 599].");
          this.ok = this.status >= 200 && this.status < 300, this.statusText = w.statusText === void 0 ? "" : "" + w.statusText, this.headers = new y(w.headers), this.url = w.url || "", this._initBody(d);
        }
        I.call(N.prototype), N.prototype.clone = function() {
          return new N(this._bodyInit, {
            status: this.status,
            statusText: this.statusText,
            headers: new y(this.headers),
            url: this.url
          });
        }, N.error = function() {
          var d = new N(null, { status: 200, statusText: "" });
          return d.ok = !1, d.status = 0, d.type = "error", d;
        };
        var A = [301, 302, 303, 307, 308];
        N.redirect = function(d, w) {
          if (A.indexOf(w) === -1)
            throw new RangeError("Invalid status code");
          return new N(null, { status: w, headers: { location: d } });
        }, o.DOMException = a.DOMException;
        try {
          new o.DOMException();
        } catch {
          o.DOMException = function(w, _) {
            this.message = w, this.name = _;
            var O = Error(w);
            this.stack = O.stack;
          }, o.DOMException.prototype = Object.create(Error.prototype), o.DOMException.prototype.constructor = o.DOMException;
        }
        function R(d, w) {
          return new Promise(function(_, O) {
            var S = new T(d, w);
            if (S.signal && S.signal.aborted)
              return O(new o.DOMException("Aborted", "AbortError"));
            var D = new XMLHttpRequest();
            function C() {
              D.abort();
            }
            D.onload = function() {
              var k = {
                statusText: D.statusText,
                headers: U(D.getAllResponseHeaders() || "")
              };
              S.url.indexOf("file://") === 0 && (D.status < 200 || D.status > 599) ? k.status = 200 : k.status = D.status, k.url = "responseURL" in D ? D.responseURL : k.headers.get("X-Request-URL");
              var q = "response" in D ? D.response : D.responseText;
              setTimeout(function() {
                _(new N(q, k));
              }, 0);
            }, D.onerror = function() {
              setTimeout(function() {
                O(new TypeError("Network request failed"));
              }, 0);
            }, D.ontimeout = function() {
              setTimeout(function() {
                O(new TypeError("Network request timed out"));
              }, 0);
            }, D.onabort = function() {
              setTimeout(function() {
                O(new o.DOMException("Aborted", "AbortError"));
              }, 0);
            };
            function M(k) {
              try {
                return k === "" && a.location.href ? a.location.href : k;
              } catch {
                return k;
              }
            }
            if (D.open(S.method, M(S.url), !0), S.credentials === "include" ? D.withCredentials = !0 : S.credentials === "omit" && (D.withCredentials = !1), "responseType" in D && (c.blob ? D.responseType = "blob" : c.arrayBuffer && (D.responseType = "arraybuffer")), w && typeof w.headers == "object" && !(w.headers instanceof y || a.Headers && w.headers instanceof a.Headers)) {
              var z = [];
              Object.getOwnPropertyNames(w.headers).forEach(function(k) {
                z.push(f(k)), D.setRequestHeader(k, g(w.headers[k]));
              }), S.headers.forEach(function(k, q) {
                z.indexOf(q) === -1 && D.setRequestHeader(q, k);
              });
            } else
              S.headers.forEach(function(k, q) {
                D.setRequestHeader(q, k);
              });
            S.signal && (S.signal.addEventListener("abort", C), D.onreadystatechange = function() {
              D.readyState === 4 && S.signal.removeEventListener("abort", C);
            }), D.send(typeof S._bodyInit > "u" ? null : S._bodyInit);
          });
        }
        return R.polyfill = !0, a.fetch || (a.fetch = R, a.Headers = y, a.Request = T, a.Response = N), o.Headers = y, o.Request = T, o.Response = N, o.fetch = R, Object.defineProperty(o, "__esModule", { value: !0 }), o;
      })({});
    })(s), s.fetch.ponyfill = !0, delete s.fetch.polyfill;
    var n = r.fetch ? r : s;
    e = n.fetch, e.default = n.fetch, e.fetch = n.fetch, e.Headers = n.Headers, e.Request = n.Request, e.Response = n.Response, t.exports = e;
  })(hn, hn.exports)), hn.exports;
}
var v3 = b3();
const vu = /* @__PURE__ */ Cu(v3);
var E3 = Object.defineProperty, x3 = Object.defineProperties, _3 = Object.getOwnPropertyDescriptors, Eu = Object.getOwnPropertySymbols, S3 = Object.prototype.hasOwnProperty, I3 = Object.prototype.propertyIsEnumerable, xu = (t, e, r) => e in t ? E3(t, e, { enumerable: !0, configurable: !0, writable: !0, value: r }) : t[e] = r, _u = (t, e) => {
  for (var r in e || (e = {})) S3.call(e, r) && xu(t, r, e[r]);
  if (Eu) for (var r of Eu(e)) I3.call(e, r) && xu(t, r, e[r]);
  return t;
}, Su = (t, e) => x3(t, _3(e));
const D3 = { Accept: "application/json", "Content-Type": "application/json" }, A3 = "POST", Iu = { headers: D3, method: A3 }, Du = 10;
let Yd = class {
  constructor(e, r = !1) {
    if (this.url = e, this.disableProviderPing = r, this.events = new je.EventEmitter(), this.isAvailable = !1, this.registering = !1, !cu(e)) throw new Error(`Provided URL is not compatible with HTTP connection: ${e}`);
    this.url = e, this.disableProviderPing = r;
  }
  get connected() {
    return this.isAvailable;
  }
  get connecting() {
    return this.registering;
  }
  on(e, r) {
    this.events.on(e, r);
  }
  once(e, r) {
    this.events.once(e, r);
  }
  off(e, r) {
    this.events.off(e, r);
  }
  removeListener(e, r) {
    this.events.removeListener(e, r);
  }
  async open(e = this.url) {
    await this.register(e);
  }
  async close() {
    if (!this.isAvailable) throw new Error("Connection already closed");
    this.onClose();
  }
  async send(e) {
    this.isAvailable || await this.register();
    try {
      const r = Pr(e), s = await (await vu(this.url, Su(_u({}, Iu), { body: r }))).json();
      this.onPayload({ data: s });
    } catch (r) {
      this.onError(e.id, r);
    }
  }
  async register(e = this.url) {
    if (!cu(e)) throw new Error(`Provided URL is not compatible with HTTP connection: ${e}`);
    if (this.registering) {
      const r = this.events.getMaxListeners();
      return (this.events.listenerCount("register_error") >= r || this.events.listenerCount("open") >= r) && this.events.setMaxListeners(r + 1), new Promise((s, n) => {
        this.events.once("register_error", (i) => {
          this.resetMaxListeners(), n(i);
        }), this.events.once("open", () => {
          if (this.resetMaxListeners(), typeof this.isAvailable > "u") return n(new Error("HTTP connection is missing or invalid"));
          s();
        });
      });
    }
    this.url = e, this.registering = !0;
    try {
      if (!this.disableProviderPing) {
        const r = Pr({ id: 1, jsonrpc: "2.0", method: "test", params: [] });
        await vu(e, Su(_u({}, Iu), { body: r }));
      }
      this.onOpen();
    } catch (r) {
      const s = this.parseError(r);
      throw this.events.emit("register_error", s), this.onClose(), s;
    }
  }
  onOpen() {
    this.isAvailable = !0, this.registering = !1, this.events.emit("open");
  }
  onClose() {
    this.isAvailable = !1, this.registering = !1, this.events.emit("close");
  }
  onPayload(e) {
    if (typeof e.data > "u") return;
    const r = typeof e.data == "string" ? $r(e.data) : e.data;
    this.events.emit("payload", r);
  }
  onError(e, r) {
    const s = this.parseError(r), n = s.message || s.toString(), i = ci(e, n);
    this.events.emit("payload", i);
  }
  parseError(e, r = this.url) {
    return wd(e, r, "HTTP");
  }
  resetMaxListeners() {
    this.events.getMaxListeners() > Du && this.events.setMaxListeners(Du);
  }
};
const Au = "error", O3 = "wss://relay.walletconnect.org", $3 = "wc", Zd = "universal_provider", fn = `${$3}@2:${Zd}:`, Xd = "https://rpc.walletconnect.org/v1/", Jd = "generic", P3 = `${Xd}bundler`, Xr = "call_status", T3 = 86400, za = { DEFAULT_CHAIN_CHANGED: "default_chain_changed" };
function Qd(t, e, r) {
  const s = Ft(t);
  return e.rpcMap?.[s.reference] || `${Xd}?chainId=${s.namespace}:${s.reference}&projectId=${r}`;
}
function B3(t) {
  return t.includes(":") ? t.split(":")[1] : t;
}
function ep(t) {
  return t.map((e) => `${e.split(":")[0]}:${e.split(":")[1]}`);
}
function R3(t, e) {
  const r = Object.keys(e.namespaces).filter((n) => n.includes(t));
  if (!r.length) return [];
  const s = [];
  return r.forEach((n) => {
    const i = e.namespaces[n].accounts;
    s.push(...i);
  }), s;
}
function Ou(t) {
  return Object.fromEntries(Object.entries(t).filter(([e, r]) => r?.chains?.length && r?.chains?.length > 0));
}
function dn(t = {}, e = {}) {
  const r = Ou($u(t)), s = Ou($u(e));
  return rI(r, s);
}
function $u(t) {
  const e = {};
  if (!Et(t)) return e;
  for (const [r, s] of Object.entries(t)) {
    const n = ai(r) ? [r] : s.chains, i = s.methods || [], o = s.events || [], a = s.rpcMap || {}, c = Kr(r);
    e[c] = { ...e[c], ...s, chains: vt(n, e[c]?.chains), methods: vt(i, e[c]?.methods), events: vt(o, e[c]?.events) }, (Et(a) || Et(e[c]?.rpcMap || {})) && (e[c].rpcMap = { ...a, ...e[c]?.rpcMap });
  }
  return e;
}
function Pu(t) {
  return t.includes(":") ? t.split(":")[2] : t;
}
function Tu(t) {
  const e = {};
  for (const [r, s] of Object.entries(t)) {
    const n = s.methods || [], i = s.events || [], o = s.accounts || [], a = ai(r) ? [r] : s.chains ? s.chains : ep(s.accounts);
    e[r] = { chains: a, methods: n, events: i, accounts: o };
  }
  return e;
}
function lo(t) {
  return typeof t == "number" ? t : t.includes("0x") ? parseInt(t, 16) : (t = t.includes(":") ? t.split(":")[1] : t, isNaN(Number(t)) ? t : Number(t));
}
function C3(t) {
  try {
    const e = JSON.parse(t);
    return typeof e == "object" && e !== null && !Array.isArray(e);
  } catch {
    return !1;
  }
}
const tp = {}, Jr = (t) => tp[t], uo = (t, e) => {
  tp[t] = e;
}, Bu = "eip155", N3 = ["atomic", "flow-control", "paymasterService", "sessionKeys", "auxiliaryFunds"], U3 = (t) => t && t.startsWith("0x") ? BigInt(t).toString(10) : t, ho = (t) => t && t.startsWith("0x") ? t : `0x${BigInt(t).toString(16)}`, Ru = (t) => Object.keys(t).filter((e) => N3.includes(e)).reduce((e, r) => (e[r] = L3(t[r]), e), {}), L3 = (t) => typeof t == "string" && C3(t) ? JSON.parse(t) : t, M3 = (t, e, r) => {
  const { sessionProperties: s = {}, scopedProperties: n = {} } = t, i = {};
  if (!Et(n) && !Et(s)) return;
  const o = Ru(s);
  for (const a of r) {
    const c = U3(a);
    if (!c) continue;
    i[ho(c)] = o;
    const l = n?.[`${Bu}:${c}`];
    if (l) {
      const u = l?.[`${Bu}:${c}:${e}`];
      i[ho(c)] = { ...i[ho(c)], ...Ru(u || l) };
    }
  }
  for (const [a, c] of Object.entries(i)) Object.keys(c).length === 0 && delete i[a];
  return Object.keys(i).length > 0 ? i : void 0;
};
let fo, k3 = class rp {
  constructor(e) {
    this.storage = e;
  }
  async getItem(e) {
    return await this.storage.getItem(e);
  }
  async setItem(e, r) {
    return await this.storage.setItem(e, r);
  }
  async removeItem(e) {
    return await this.storage.removeItem(e);
  }
  static getStorage(e) {
    return fo || (fo = new rp(e)), fo;
  }
};
async function q3(t, e) {
  const r = Ft(t.result.capabilities.caip345.caip2), s = t.result.capabilities.caip345.transactionHashes, n = await Promise.allSettled(s.map((h) => F3(r.reference, h, e))), i = n.filter((h) => h.status === "fulfilled").map((h) => h.value).filter((h) => h);
  n.filter((h) => h.status === "rejected").forEach((h) => console.warn("Failed to fetch transaction receipt:", h.reason));
  const o = !i.length || i.some((h) => !h), a = i.every((h) => h?.status === "0x1"), c = i.every((h) => h?.status === "0x0"), l = i.some((h) => h?.status === "0x0");
  let u;
  return o ? u = 100 : a ? u = 200 : c ? u = 500 : l && (u = 600), { id: t.result.id, version: t.request.version, atomic: t.request.atomicRequired, chainId: t.request.chainId, capabilities: t.result.capabilities, receipts: i, status: u };
}
async function F3(t, e, r) {
  return await r(parseInt(t)).request(ot("eth_getTransactionReceipt", [e]));
}
async function j3({ sendCalls: t, storage: e }) {
  const r = await e.getItem(Xr);
  await e.setItem(Xr, { ...r, [t.result.id]: { request: t.request, result: t.result, expiry: ae(T3) } });
}
async function z3({ resultId: t, storage: e }) {
  const r = await e.getItem(Xr);
  if (r) {
    delete r[t], await e.setItem(Xr, r);
    for (const s in r) wt(r[s].expiry) && delete r[s];
    await e.setItem(Xr, r);
  }
}
async function H3({ resultId: t, storage: e }) {
  const r = (await e.getItem(Xr))?.[t];
  if (r && !wt(r.expiry)) return r;
  await z3({ resultId: t, storage: e });
}
class K3 {
  constructor(e) {
    this.name = "eip155", this.namespace = e.namespace, this.events = Jr("events"), this.client = Jr("client"), this.httpProviders = this.createHttpProviders(), this.chainId = parseInt(this.getDefaultChain()), this.storage = k3.getStorage(this.client.core.storage);
  }
  async request(e) {
    switch (e.request.method) {
      case "eth_requestAccounts":
        return this.getAccounts();
      case "eth_accounts":
        return this.getAccounts();
      case "wallet_switchEthereumChain":
        return await this.handleSwitchChain(e);
      case "eth_chainId":
        return parseInt(this.getDefaultChain());
      case "wallet_getCapabilities":
        return await this.getCapabilities(e);
      case "wallet_getCallsStatus":
        return await this.getCallStatus(e);
      case "wallet_sendCalls":
        return await this.sendCalls(e);
    }
    return this.namespace.methods.includes(e.request.method) ? await this.client.request(e) : this.getHttpProvider().request(e.request);
  }
  updateNamespace(e) {
    this.namespace = Object.assign(this.namespace, e);
  }
  setDefaultChain(e, r) {
    this.httpProviders[e] || this.setHttpProvider(parseInt(e), r);
    const s = this.chainId;
    this.chainId = parseInt(e), this.events.emit(za.DEFAULT_CHAIN_CHANGED, { currentCaipChainId: `${this.name}:${e}`, previousCaipChainId: `${this.name}:${s}` });
  }
  requestAccounts() {
    return this.getAccounts();
  }
  getDefaultChain() {
    if (this.chainId) return this.chainId.toString();
    if (this.namespace.defaultChain) return this.namespace.defaultChain;
    const e = this.namespace.chains[0];
    if (!e) throw new Error("ChainId not found");
    return e.split(":")[1];
  }
  createHttpProvider(e, r) {
    const s = r || Qd(`${this.name}:${e}`, this.namespace, this.client.core.projectId);
    if (!s) throw new Error(`No RPC url provided for chainId: ${e}`);
    return new Ua(new Yd(s, Jr("disableProviderPing")));
  }
  setHttpProvider(e, r) {
    const s = this.createHttpProvider(e, r);
    s && (this.httpProviders[e] = s);
  }
  createHttpProviders() {
    const e = {};
    return this.namespace.chains.forEach((r) => {
      const s = parseInt(B3(r));
      e[s] = this.createHttpProvider(s, this.namespace.rpcMap?.[r]);
    }), e;
  }
  getAccounts() {
    const e = this.namespace.accounts;
    return e ? [...new Set(e.filter((r) => r.split(":")[1] === this.chainId.toString()).map((r) => r.split(":")[2]))] : [];
  }
  getHttpProvider(e) {
    const r = e || this.chainId;
    return this.httpProviders[r] || (this.httpProviders = { ...this.httpProviders, [r]: this.createHttpProvider(r) }, this.httpProviders[r]);
  }
  async handleSwitchChain(e) {
    let r = e.request.params ? e.request.params[0]?.chainId : "0x0";
    r = r.startsWith("0x") ? r : `0x${r}`;
    const s = parseInt(r, 16);
    if (this.isChainApproved(s)) this.setDefaultChain(`${s}`);
    else if (this.namespace.methods.includes("wallet_switchEthereumChain")) await this.client.request({ topic: e.topic, request: { method: e.request.method, params: [{ chainId: r }] }, chainId: this.namespace.chains?.[0] }), this.setDefaultChain(`${s}`);
    else throw new Error(`Failed to switch to chain 'eip155:${s}'. The chain is not approved or the wallet does not support 'wallet_switchEthereumChain' method.`);
    return null;
  }
  isChainApproved(e) {
    return this.namespace.chains.includes(`${this.name}:${e}`);
  }
  async getCapabilities(e) {
    const r = e.request?.params?.[0], s = e.request?.params?.[1] || [];
    if (!r) throw new Error("Missing address parameter in `wallet_getCapabilities` request");
    const n = this.client.session.get(e.topic), i = n?.sessionProperties?.capabilities || {}, o = s.length > 0 ? s.join(",") : `0x${this.chainId.toString(16)}`, a = `${r}${o}`, c = i?.[a];
    if (c) return c;
    let l;
    try {
      l = M3(n, r, s);
    } catch (h) {
      console.warn("Failed to extract capabilities from session", h);
    }
    if (l) return l;
    const u = await this.client.request(e);
    try {
      await this.client.session.update(e.topic, { sessionProperties: { ...n.sessionProperties || {}, capabilities: { ...i || {}, [a]: u } } });
    } catch (h) {
      console.warn("Failed to update session with capabilities", h);
    }
    return u;
  }
  async getCallStatus(e) {
    const r = this.client.session.get(e.topic), s = r.sessionProperties?.bundler_name;
    if (s) {
      const o = this.getBundlerUrl(e.chainId, s);
      try {
        return await this.getUserOperationReceipt(o, e);
      } catch (a) {
        console.warn("Failed to fetch call status from bundler", a, o);
      }
    }
    const n = r.sessionProperties?.bundler_url;
    if (n) try {
      return await this.getUserOperationReceipt(n, e);
    } catch (o) {
      console.warn("Failed to fetch call status from custom bundler", o, n);
    }
    const i = await H3({ resultId: e.request.params?.[0], storage: this.storage });
    if (i) try {
      return await q3(i, this.getHttpProvider.bind(this));
    } catch (o) {
      console.warn("Failed to fetch call status from stored send calls", o, i);
    }
    if (this.namespace.methods.includes(e.request.method)) return await this.client.request(e);
    throw new Error("Fetching call status not approved by the wallet.");
  }
  async getUserOperationReceipt(e, r) {
    const s = new URL(e), n = await fetch(s, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ot("eth_getUserOperationReceipt", [r.request.params?.[0]])) });
    if (!n.ok) throw new Error(`Failed to fetch user operation receipt - ${n.status}`);
    return await n.json();
  }
  getBundlerUrl(e, r) {
    return `${P3}?projectId=${this.client.core.projectId}&chainId=${e}&bundler=${r}`;
  }
  async sendCalls(e) {
    const r = await this.client.request(e), s = e.request.params?.[0], n = r?.id, i = r?.capabilities || {}, o = i?.caip345?.caip2, a = i?.caip345?.transactionHashes;
    return !n || !o || !a?.length || await j3({ sendCalls: { request: s, result: r }, storage: this.storage }), r;
  }
}
class V3 {
  constructor(e) {
    this.name = Jd, this.namespace = e.namespace, this.events = Jr("events"), this.client = Jr("client"), this.chainId = this.getDefaultChain(), this.name = this.getNamespaceName(), this.httpProviders = this.createHttpProviders();
  }
  updateNamespace(e) {
    this.namespace.chains = [...new Set((this.namespace.chains || []).concat(e.chains || []))], this.namespace.accounts = [...new Set((this.namespace.accounts || []).concat(e.accounts || []))], this.namespace.methods = [...new Set((this.namespace.methods || []).concat(e.methods || []))], this.namespace.events = [...new Set((this.namespace.events || []).concat(e.events || []))], this.httpProviders = this.createHttpProviders();
  }
  requestAccounts() {
    return this.getAccounts();
  }
  request(e) {
    return this.namespace.methods.includes(e.request.method) ? this.client.request(e) : this.getHttpProvider(e.chainId).request(e.request);
  }
  setDefaultChain(e, r) {
    this.httpProviders[e] || this.setHttpProvider(e, r);
    const s = this.chainId;
    this.chainId = e, this.events.emit(za.DEFAULT_CHAIN_CHANGED, { currentCaipChainId: `${this.name}:${e}`, previousCaipChainId: `${this.name}:${s}` });
  }
  getDefaultChain() {
    if (this.chainId) return this.chainId;
    if (this.namespace.defaultChain) return this.namespace.defaultChain;
    const e = this.namespace.chains[0];
    if (!e) throw new Error("ChainId not found");
    return e.split(":")[1];
  }
  getNamespaceName() {
    const e = this.namespace.chains[0];
    if (!e) throw new Error("ChainId not found");
    return Ft(e).namespace;
  }
  getAccounts() {
    const e = this.namespace.accounts;
    return e ? [...new Set(e.filter((r) => r.split(":")[1] === this.chainId.toString()).map((r) => r.split(":")[2]))] : [];
  }
  createHttpProviders() {
    const e = {};
    return this.namespace?.accounts?.forEach((r) => {
      const s = Ft(r), n = this.namespace?.rpcMap?.[`${s.namespace}:${s.reference}`];
      e[s.reference] = this.createHttpProvider(r, n);
    }), e;
  }
  getHttpProvider(e) {
    const r = Ft(e).reference, s = this.httpProviders[r];
    if (typeof s > "u") throw new Error(`JSON-RPC provider for ${e} not found`);
    return s;
  }
  setHttpProvider(e, r) {
    const s = this.createHttpProvider(e, r);
    s && (this.httpProviders[e] = s);
  }
  createHttpProvider(e, r) {
    const s = r || Qd(e, this.namespace, this.client.core.projectId);
    if (!s) throw new Error(`No RPC url provided for chainId: ${e}`);
    return new Ua(new Yd(s, Jr("disableProviderPing")));
  }
}
let W3 = class sp {
  constructor(e) {
    this.events = new ea(), this.rpcProviders = {}, this.disableProviderPing = !1, this.providerOpts = e, this.logger = Ba({ logger: e.logger ?? Au, name: this.providerOpts.name ?? Zd }), this.disableProviderPing = e?.disableProviderPing || !1;
  }
  static async init(e) {
    const r = new sp(e);
    return await r.initialize(), r;
  }
  async request(e, r, s) {
    const [n, i] = this.validateChain(r);
    if (!this.session) throw new Error("Please call connect() before request()");
    return await this.getProvider(n).request({ request: { ...e }, chainId: `${n}:${i}`, topic: this.session.topic, expiry: s });
  }
  sendAsync(e, r, s, n) {
    const i = (/* @__PURE__ */ new Date()).getTime();
    this.request(e, s, n).then((o) => r(null, Bs(i, o))).catch((o) => r(o, void 0));
  }
  async enable() {
    if (!this.client) throw new Error("Sign Client not initialized");
    return this.session || await this.connect({ namespaces: this.namespaces, optionalNamespaces: this.optionalNamespaces, sessionProperties: this.sessionProperties, scopedProperties: this.scopedProperties }), await this.requestAccounts();
  }
  async disconnect() {
    if (!this.session) throw new Error("Please call connect() before enable()");
    await this.client.disconnect({ topic: this.session?.topic, reason: Q("USER_DISCONNECTED") }), await this.cleanup();
  }
  async connect(e) {
    if (!this.client) throw new Error("Sign Client not initialized");
    if (this.connectParams = e, this.setNamespaces(e), this.cleanupPendingPairings(), !e.skipPairing) return await this.pair(e.pairingTopic);
  }
  async authenticate(e, r) {
    if (!this.client) throw new Error("Sign Client not initialized");
    this.setNamespaces(e), await this.cleanupPendingPairings();
    const { uri: s, response: n } = await this.client.authenticate(e, r);
    s && (this.uri = s, this.events.emit("display_uri", s));
    const i = await n();
    if (this.session = i.session, this.session) {
      const o = Tu(this.session.namespaces);
      this.namespaces = dn(this.namespaces, o), await this.persist("namespaces", this.namespaces), this.onConnect();
    }
    return i;
  }
  on(e, r) {
    this.events.on(e, r);
  }
  once(e, r) {
    this.events.once(e, r);
  }
  removeListener(e, r) {
    this.events.removeListener(e, r);
  }
  off(e, r) {
    this.events.off(e, r);
  }
  get isWalletConnect() {
    return !0;
  }
  async pair(e) {
    const { uri: r, approval: s } = await this.client.connect({ pairingTopic: e, requiredNamespaces: this.namespaces, optionalNamespaces: this.optionalNamespaces, sessionProperties: this.sessionProperties, scopedProperties: this.scopedProperties, authentication: this.connectParams?.authentication, walletPay: this.connectParams?.walletPay });
    r && (this.uri = r, this.events.emit("display_uri", r));
    const n = await s();
    this.session = n;
    const i = Tu(n.namespaces);
    return this.namespaces = dn(this.namespaces, i), await this.persist("namespaces", this.namespaces), await this.persist("optionalNamespaces", this.optionalNamespaces), this.onConnect(), this.session;
  }
  setDefaultChain(e, r) {
    try {
      if (!this.session) return;
      const [s, n] = this.validateChain(e), i = this.getProvider(s);
      i ? i.setDefaultChain(n, r) : this.session && this.logger.warn(`Provider for namespace '${s}' not found in setDefaultChain`);
    } catch (s) {
      if (!/Please call connect/.test(s.message)) throw s;
    }
  }
  async cleanupPendingPairings(e = {}) {
    try {
      this.logger.info("Cleaning up inactive pairings...");
      const r = this.client.pairing.getAll();
      if (!Ze(r)) return;
      for (const s of r) e.deletePairings ? this.client.core.expirer.set(s.topic, 0) : await this.client.core.relayer.subscriber.unsubscribe(s.topic);
      this.logger.info(`Inactive pairings cleared: ${r.length}`);
    } catch (r) {
      this.logger.warn(r, "Failed to cleanup pending pairings");
    }
  }
  abortPairingAttempt() {
    this.logger.warn("abortPairingAttempt is deprecated. This is now a no-op.");
  }
  async checkStorage() {
    this.namespaces = await this.getFromStore("namespaces") || {}, this.optionalNamespaces = await this.getFromStore("optionalNamespaces") || {}, this.session && this.createProviders();
  }
  async initialize() {
    this.logger.trace("Initialized"), await this.createClient(), await this.checkStorage(), this.registerEventListeners();
  }
  async createClient() {
    if (this.client = this.providerOpts.client || await m3.init({ core: this.providerOpts.core, logger: this.providerOpts.logger || Au, relayUrl: this.providerOpts.relayUrl || O3, projectId: this.providerOpts.projectId, metadata: this.providerOpts.metadata, storageOptions: this.providerOpts.storageOptions, storage: this.providerOpts.storage, name: this.providerOpts.name, customStoragePrefix: this.providerOpts.customStoragePrefix, telemetryEnabled: this.providerOpts.telemetryEnabled }), this.providerOpts.session) try {
      this.session = this.client.session.get(this.providerOpts.session.topic);
    } catch (e) {
      throw this.logger.error(e, "Failed to get session"), new Error(`The provided session: ${this.providerOpts?.session?.topic} doesn't exist in the Sign client`);
    }
    else {
      const e = this.client.session.getAll();
      this.session = e[0];
    }
    this.logger.trace("SignClient Initialized");
  }
  createProviders() {
    if (!this.client) throw new Error("Sign Client not initialized");
    if (!this.session) throw new Error("Session not initialized. Please call connect() before enable()");
    const e = [...new Set(Object.keys(this.session.namespaces).map((r) => Kr(r)))];
    uo("client", this.client), uo("events", this.events), uo("disableProviderPing", this.disableProviderPing), e.forEach((r) => {
      if (!this.session) return;
      const s = R3(r, this.session);
      if (s?.length === 0) return;
      const n = ep(s), i = { ...dn(this.namespaces, this.optionalNamespaces)[r], accounts: s, chains: n };
      switch (r) {
        case "eip155":
          this.rpcProviders[r] = new K3({ namespace: i });
          break;
        default:
          this.rpcProviders[r] = new V3({ namespace: i });
      }
    });
  }
  registerEventListeners() {
    if (typeof this.client > "u") throw new Error("Sign Client is not initialized");
    this.client.on("session_ping", (e) => {
      const { topic: r } = e;
      r === this.session?.topic && this.events.emit("session_ping", e);
    }), this.client.on("session_event", (e) => {
      const { params: r, topic: s } = e;
      if (s !== this.session?.topic) return;
      const { event: n } = r;
      if (n.name === "accountsChanged") {
        const i = n.data;
        i && Ze(i) && this.events.emit("accountsChanged", i.map(Pu));
      } else if (n.name === "chainChanged") {
        const i = r.chainId, o = r.event.data, a = Kr(i), c = lo(i) !== lo(o) ? `${a}:${lo(o)}` : i;
        this.onChainChanged({ currentCaipChainId: c });
      } else this.events.emit(n.name, n.data);
      this.events.emit("session_event", e);
    }), this.client.on("session_update", ({ topic: e, params: r }) => {
      if (e !== this.session?.topic) return;
      const { namespaces: s } = r, n = this.client?.session.get(e);
      this.session = { ...n, namespaces: s }, this.onSessionUpdate(), this.events.emit("session_update", { topic: e, params: r });
    }), this.client.on("session_delete", async (e) => {
      e.topic === this.session?.topic && (await this.cleanup(), this.events.emit("session_delete", e), this.events.emit("disconnect", { ...Q("USER_DISCONNECTED"), data: e.topic }));
    }), this.on(za.DEFAULT_CHAIN_CHANGED, (e) => {
      this.onChainChanged({ ...e, internal: !0 });
    });
  }
  getProvider(e) {
    return this.rpcProviders[e] || this.rpcProviders[Jd];
  }
  onSessionUpdate() {
    Object.keys(this.rpcProviders).forEach((e) => {
      this.getProvider(e).updateNamespace(this.session?.namespaces[e]);
    });
  }
  setNamespaces(e) {
    const { namespaces: r = {}, optionalNamespaces: s = {}, sessionProperties: n, scopedProperties: i } = e;
    this.optionalNamespaces = dn(r, s), this.sessionProperties = n, this.scopedProperties = i;
  }
  validateChain(e) {
    const [r, s] = e?.split(":") || ["", ""];
    if (!this.namespaces || !Object.keys(this.namespaces).length) return [r, s];
    if (r && !Object.keys(this.namespaces || {}).map((o) => Kr(o)).includes(r)) throw new Error(`Namespace '${r}' is not configured. Please call connect() first with namespace config.`);
    if (r && s) return [r, s];
    const n = Kr(Object.keys(this.namespaces)[0]), i = this.rpcProviders[n].getDefaultChain();
    return [n, i];
  }
  async requestAccounts() {
    const [e] = this.validateChain();
    return await this.getProvider(e).requestAccounts();
  }
  async onChainChanged({ currentCaipChainId: e, previousCaipChainId: r, internal: s = !1 }) {
    if (!this.namespaces) return;
    const [n, i] = this.validateChain(e);
    if (i) {
      if (this.updateNamespaceChain(n, i), s) this.events.emit("chainChanged", i), this.emitAccountsChangedOnChainChange({ namespace: n, currentCaipChainId: e, previousCaipChainId: r });
      else {
        const o = this.getProvider(n);
        o ? o.setDefaultChain(i) : this.session && this.logger.warn(`Provider for namespace '${n}' not found during chain change`);
      }
      await this.persist("namespaces", this.namespaces);
    }
  }
  emitAccountsChangedOnChainChange({ namespace: e, currentCaipChainId: r, previousCaipChainId: s }) {
    try {
      if (s === r) return;
      const n = this.session?.namespaces[e]?.accounts;
      if (!n) return;
      const i = n.filter((o) => o.includes(`${r}:`)).map(Pu);
      if (!Ze(i)) return;
      this.events.emit("accountsChanged", i);
    } catch (n) {
      this.logger.warn(n, "Failed to emit accountsChanged on chain change");
    }
  }
  updateNamespaceChain(e, r) {
    if (!this.namespaces) return;
    const s = this.namespaces[e] ? e : `${e}:${r}`, n = { chains: [], methods: [], events: [], defaultChain: r };
    this.namespaces[s] ? this.namespaces[s] && (this.namespaces[s].defaultChain = r) : this.namespaces[s] = n;
  }
  onConnect() {
    this.createProviders(), this.events.emit("connect", { session: this.session });
  }
  async cleanup() {
    this.connectParams = void 0, this.namespaces = void 0, this.optionalNamespaces = void 0, this.sessionProperties = void 0, await this.deleteFromStore("namespaces"), await this.deleteFromStore("optionalNamespaces"), await this.deleteFromStore("sessionProperties"), this.session = void 0, this.cleanupPendingPairings({ deletePairings: !0 }), await this.cleanupStorage();
  }
  async persist(e, r) {
    const s = this.session?.topic || "";
    await this.client.core.storage.setItem(`${fn}/${e}${s}`, r);
  }
  async getFromStore(e) {
    const r = this.session?.topic || "";
    return await this.client.core.storage.getItem(`${fn}/${e}${r}`);
  }
  async deleteFromStore(e) {
    const r = this.session?.topic || "";
    await this.client.core.storage.removeItem(`${fn}/${e}${r}`);
  }
  async cleanupStorage() {
    try {
      if (this.client?.session.length > 0) return;
      const e = await this.client.core.storage.getKeys();
      for (const r of e) r.startsWith(fn) && await this.client.core.storage.removeItem(r);
    } catch (e) {
      this.logger.warn(e, "Failed to cleanup storage");
    }
  }
};
const G3 = W3, Y3 = "wc", Z3 = "ethereum_provider", X3 = `${Y3}@2:${Z3}:`, J3 = "https://rpc.walletconnect.org/v1/", Jo = ["eth_sendTransaction", "personal_sign"], Q3 = ["eth_accounts", "eth_requestAccounts", "eth_sendRawTransaction", "eth_sign", "eth_signTransaction", "eth_signTypedData", "eth_signTypedData_v3", "eth_signTypedData_v4", "eth_sendTransaction", "personal_sign", "wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_getPermissions", "wallet_requestPermissions", "wallet_registerOnboarding", "wallet_watchAsset", "wallet_scanQRCode", "wallet_sendCalls", "wallet_getCapabilities", "wallet_getCallsStatus", "wallet_showCallsStatus"], Qo = ["chainChanged", "accountsChanged"], e8 = ["chainChanged", "accountsChanged", "message", "disconnect", "connect"], t8 = async () => {
  const { createAppKit: t } = await import("./core-BYcSNc6Q.js").then((e) => e.bC);
  return t;
};
function Hn(t) {
  return Number(t[0].split(":")[1]);
}
function pn(t) {
  return `0x${t.toString(16)}`;
}
function r8(t) {
  const { chains: e, optionalChains: r, methods: s, optionalMethods: n, events: i, optionalEvents: o, rpcMap: a } = t;
  if (!Ze(e)) throw new Error("Invalid chains");
  const c = { chains: e, methods: s || Jo, events: i || Qo, rpcMap: { ...e.length ? { [Hn(e)]: a[Hn(e)] } : {} } }, l = i?.filter((g) => !Qo.includes(g)), u = s?.filter((g) => !Jo.includes(g));
  if (!r && !o && !n && !l?.length && !u?.length) return { required: e.length ? c : void 0 };
  const h = l?.length && u?.length || !r, f = { chains: [...new Set(h ? c.chains.concat(r || []) : r)], methods: [...new Set(c.methods.concat(n?.length ? n : Q3))], events: [...new Set(c.events.concat(o?.length ? o : e8))], rpcMap: a };
  return { required: e.length ? c : void 0, optional: r.length ? f : void 0 };
}
let s8 = class np {
  constructor() {
    this.events = new je.EventEmitter(), this.namespace = "eip155", this.accounts = [], this.chainId = 1, this.STORAGE_KEY = X3, this.on = (e, r) => (this.events.on(e, r), this), this.once = (e, r) => (this.events.once(e, r), this), this.removeListener = (e, r) => (this.events.removeListener(e, r), this), this.off = (e, r) => (this.events.off(e, r), this), this.parseAccount = (e) => this.isCompatibleChainId(e) ? this.parseAccountId(e).address : e, this.signer = {}, this.rpc = {};
  }
  static async init(e) {
    const r = new np();
    return await r.initialize(e), r;
  }
  async request(e, r) {
    return await this.signer.request(e, this.formatChainId(this.chainId), r);
  }
  sendAsync(e, r, s) {
    this.signer.sendAsync(e, r, this.formatChainId(this.chainId), s);
  }
  get connected() {
    return this.signer.client ? this.signer.client.core.relayer.connected : !1;
  }
  get connecting() {
    return this.signer.client ? this.signer.client.core.relayer.connecting : !1;
  }
  async enable() {
    return this.session || await this.connect(), await this.request({ method: "eth_requestAccounts" });
  }
  async connect(e) {
    if (!this.signer.client) throw new Error("Provider not initialized. Call init() first");
    this.loadConnectOpts(e);
    const { required: r, optional: s } = r8(this.rpc);
    try {
      const n = await new Promise(async (o, a) => {
        this.rpc.showQrModal && (this.modal?.open(), this.modal?.subscribeState((l) => {
          !l.open && !this.signer.session && (this.signer.abortPairingAttempt(), a(new Error("Connection request reset. Please try again.")));
        }));
        const c = e?.scopedProperties ? { [this.namespace]: e.scopedProperties } : void 0;
        await this.signer.connect({ namespaces: { ...r && { [this.namespace]: r } }, ...s && { optionalNamespaces: { [this.namespace]: s } }, pairingTopic: e?.pairingTopic, scopedProperties: c }).then((l) => {
          o(l);
        }).catch((l) => {
          this.modal?.showErrorMessage("Unable to connect"), a(new Error(l.message));
        });
      });
      if (!n) return;
      const i = Pl(n.namespaces, [this.namespace]);
      this.setChainIds(this.rpc.chains.length ? this.rpc.chains : i), this.setAccounts(i), this.events.emit("connect", { chainId: pn(this.chainId) });
    } catch (n) {
      throw this.signer.logger.error(n), n;
    } finally {
      this.modal?.close();
    }
  }
  async authenticate(e, r) {
    if (!this.signer.client) throw new Error("Provider not initialized. Call init() first");
    this.loadConnectOpts({ chains: e?.chains });
    try {
      const s = await new Promise(async (i, o) => {
        this.rpc.showQrModal && (this.modal?.open(), this.modal?.subscribeState((a) => {
          !a.open && !this.signer.session && (this.signer.abortPairingAttempt(), o(new Error("Connection request reset. Please try again.")));
        })), await this.signer.authenticate({ ...e, chains: this.rpc.chains }, r).then((a) => {
          i(a);
        }).catch((a) => {
          this.modal?.showErrorMessage("Unable to connect"), o(new Error(a.message));
        });
      }), n = s.session;
      if (n) {
        const i = Pl(n.namespaces, [this.namespace]);
        this.setChainIds(this.rpc.chains.length ? this.rpc.chains : i), this.setAccounts(i), this.events.emit("connect", { chainId: pn(this.chainId) });
      }
      return s;
    } catch (s) {
      throw this.signer.logger.error(s), s;
    } finally {
      this.modal?.close();
    }
  }
  async disconnect() {
    this.session && await this.signer.disconnect(), this.reset();
  }
  get isWalletConnect() {
    return !0;
  }
  get session() {
    return this.signer.session;
  }
  registerEventListeners() {
    this.signer.on("session_event", (e) => {
      const { params: r } = e, { event: s } = r;
      s.name === "accountsChanged" ? (this.accounts = this.parseAccounts(s.data), this.events.emit("accountsChanged", this.accounts)) : s.name === "chainChanged" ? this.setChainId(this.formatChainId(s.data)) : this.events.emit(s.name, s.data), this.events.emit("session_event", e);
    }), this.signer.on("accountsChanged", (e) => {
      this.accounts = this.parseAccounts(e), this.events.emit("accountsChanged", this.accounts);
    }), this.signer.on("chainChanged", (e) => {
      const r = parseInt(e);
      this.chainId = r, this.events.emit("chainChanged", pn(this.chainId)), this.persist();
    }), this.signer.on("session_update", (e) => {
      this.events.emit("session_update", e);
    }), this.signer.on("session_delete", (e) => {
      this.reset(), this.events.emit("session_delete", e), this.events.emit("disconnect", { ...Q("USER_DISCONNECTED"), data: e.topic, name: "USER_DISCONNECTED" });
    }), this.signer.on("display_uri", (e) => {
      this.events.emit("display_uri", e);
    });
  }
  switchEthereumChain(e) {
    this.request({ method: "wallet_switchEthereumChain", params: [{ chainId: e.toString(16) }] });
  }
  isCompatibleChainId(e) {
    return typeof e == "string" ? e.startsWith(`${this.namespace}:`) : !1;
  }
  formatChainId(e) {
    return `${this.namespace}:${e}`;
  }
  parseChainId(e) {
    return Number(e.split(":")[1]);
  }
  setChainIds(e) {
    const r = e.filter((s) => this.isCompatibleChainId(s)).map((s) => this.parseChainId(s));
    r.length && (this.chainId = r[0], this.events.emit("chainChanged", pn(this.chainId)), this.persist());
  }
  setChainId(e) {
    if (this.isCompatibleChainId(e)) {
      const r = this.parseChainId(e);
      this.chainId = r, this.switchEthereumChain(r);
    }
  }
  parseAccountId(e) {
    const [r, s, n] = e.split(":");
    return { chainId: `${r}:${s}`, address: n };
  }
  setAccounts(e) {
    this.accounts = e.filter((r) => this.parseChainId(this.parseAccountId(r).chainId) === this.chainId).map((r) => this.parseAccountId(r).address), this.events.emit("accountsChanged", this.accounts);
  }
  getRpcConfig(e) {
    const r = e?.chains ?? [], s = e?.optionalChains ?? [], n = r.concat(s);
    if (!n.length) throw new Error("No chains specified in either `chains` or `optionalChains`");
    const i = r.length ? e?.methods || Jo : [], o = r.length ? e?.events || Qo : [], a = e?.optionalMethods || [], c = e?.optionalEvents || [], l = e?.rpcMap || this.buildRpcMap(n, e.projectId), u = e?.qrModalOptions || void 0;
    return { chains: r?.map((h) => this.formatChainId(h)), optionalChains: s.map((h) => this.formatChainId(h)), methods: i, events: o, optionalMethods: a, optionalEvents: c, rpcMap: l, showQrModal: !!e?.showQrModal, qrModalOptions: u, projectId: e.projectId, metadata: e.metadata };
  }
  buildRpcMap(e, r) {
    const s = {};
    return e.forEach((n) => {
      s[n] = this.getRpcUrl(n, r);
    }), s;
  }
  async initialize(e) {
    if (this.rpc = this.getRpcConfig(e), this.chainId = this.rpc.chains.length ? Hn(this.rpc.chains) : Hn(this.rpc.optionalChains), this.signer = await G3.init({ projectId: this.rpc.projectId, metadata: this.rpc.metadata, disableProviderPing: e.disableProviderPing, relayUrl: e.relayUrl, storage: e.storage, storageOptions: e.storageOptions, customStoragePrefix: e.customStoragePrefix, telemetryEnabled: e.telemetryEnabled, logger: e.logger, client: e.client, core: e.core }), this.registerEventListeners(), await this.loadPersistedSession(), this.rpc.showQrModal) {
      let r;
      try {
        const s = await t8(), { convertWCMToAppKitOptions: n } = await Promise.resolve().then(function() {
          return c8;
        }), i = n({ ...this.rpc.qrModalOptions, chains: [.../* @__PURE__ */ new Set([...this.rpc.chains, ...this.rpc.optionalChains])], metadata: this.rpc.metadata, projectId: this.rpc.projectId });
        if (!i.networks.length) throw new Error("No networks found for WalletConnect");
        r = s({ ...i, universalProvider: this.signer, manualWCControl: !0, enableMobileFullScreen: this.rpc.qrModalOptions?.enableMobileFullScreen === !0 });
      } catch (s) {
        throw console.warn(s), new Error("To use QR modal, please install @reown/appkit package");
      }
      if (r) try {
        this.modal = r;
      } catch (s) {
        throw this.signer.logger.error(s), new Error("Could not generate WalletConnectModal Instance");
      }
    }
  }
  loadConnectOpts(e) {
    if (!e) return;
    const { chains: r, optionalChains: s, rpcMap: n } = e;
    r && Ze(r) && (this.rpc.chains = r.map((i) => this.formatChainId(i)), r.forEach((i) => {
      this.rpc.rpcMap[i] = n?.[i] || this.getRpcUrl(i);
    })), s && Ze(s) && (this.rpc.optionalChains = [], this.rpc.optionalChains = s?.map((i) => this.formatChainId(i)), s.forEach((i) => {
      this.rpc.rpcMap[i] = n?.[i] || this.getRpcUrl(i);
    }));
  }
  getRpcUrl(e, r) {
    return this.rpc.rpcMap?.[e] || `${J3}?chainId=eip155:${e}&projectId=${r || this.rpc.projectId}`;
  }
  async loadPersistedSession() {
    if (this.session) try {
      const e = await this.signer.client.core.storage.getItem(`${this.STORAGE_KEY}/chainId`), r = this.session.namespaces[`${this.namespace}:${e}`] ? this.session.namespaces[`${this.namespace}:${e}`] : this.session.namespaces[this.namespace];
      this.setChainIds(e ? [this.formatChainId(e)] : r?.accounts), this.setAccounts(r?.accounts);
    } catch (e) {
      this.signer.logger.error("Failed to load persisted session, clearing state..."), this.signer.logger.error(e), await this.disconnect().catch((r) => this.signer.logger.warn(r));
    }
  }
  reset() {
    this.chainId = 1, this.accounts = [];
  }
  persist() {
    this.session && this.signer.client.core.storage.setItem(`${this.STORAGE_KEY}/chainId`, this.chainId);
  }
  parseAccounts(e) {
    return typeof e == "string" || e instanceof String ? [this.parseAccount(e)] : e.map((r) => this.parseAccount(r));
  }
};
const n8 = s8;
function i8(t) {
  if (t) return { "--w3m-font-family": t["--wcm-font-family"], "--w3m-accent": t["--wcm-accent-color"], "--w3m-color-mix": t["--wcm-background-color"], "--w3m-z-index": t["--wcm-z-index"] ? Number(t["--wcm-z-index"]) : void 0, "--w3m-qr-color": t["--wcm-accent-color"], "--w3m-font-size-master": t["--wcm-text-medium-regular-size"], "--w3m-border-radius-master": t["--wcm-container-border-radius"], "--w3m-color-mix-strength": 0 };
}
const o8 = (t) => {
  const [e, r] = t.split(":");
  return ip({ id: r, caipNetworkId: t, chainNamespace: e, name: "", nativeCurrency: { name: "", symbol: "", decimals: 8 }, rpcUrls: { default: { http: ["https://rpc.walletconnect.org/v1"] } } });
};
function a8(t) {
  const e = t.chains?.map(o8).filter(Boolean);
  if (e.length === 0) throw new Error("At least one chain must be specified");
  const r = e.find((n) => n.id === t.defaultChain?.id), s = { projectId: t.projectId, networks: e, themeMode: t.themeMode, themeVariables: i8(t.themeVariables), chainImages: t.chainImages, connectorImages: t.walletImages, defaultNetwork: r, metadata: { ...t.metadata, name: t.metadata?.name || "WalletConnect", description: t.metadata?.description || "Connect to WalletConnect-compatible wallets", url: t.metadata?.url || "https://walletconnect.org", icons: t.metadata?.icons || ["https://walletconnect.org/walletconnect-logo.png"] }, showWallets: !0, featuredWalletIds: t.explorerRecommendedWalletIds === "NONE" ? [] : Array.isArray(t.explorerRecommendedWalletIds) ? t.explorerRecommendedWalletIds : [], excludeWalletIds: t.explorerExcludedWalletIds === "ALL" ? [] : Array.isArray(t.explorerExcludedWalletIds) ? t.explorerExcludedWalletIds : [], enableEIP6963: !1, enableInjected: !1, enableCoinbase: !0, enableWalletConnect: !0, features: { email: !1, socials: !1 } };
  if (t.mobileWallets?.length || t.desktopWallets?.length) {
    const n = [...(t.mobileWallets || []).map((a) => ({ id: a.id, name: a.name, links: a.links })), ...(t.desktopWallets || []).map((a) => ({ id: a.id, name: a.name, links: { native: a.links.native, universal: a.links.universal } }))], i = [...s.featuredWalletIds || [], ...s.excludeWalletIds || []], o = n.filter((a) => !i.includes(a.id));
    o.length && (s.customWallets = o);
  }
  return s;
}
function ip(t) {
  return { formatters: void 0, fees: void 0, serializers: void 0, ...t };
}
var c8 = Object.freeze({ __proto__: null, convertWCMToAppKitOptions: a8, defineChain: ip });
let po;
async function Z8(t) {
  if (t === "injected") {
    const r = window, s = [r.safepalProvider, ...(r.ethereum?.providers || []).filter((n) => n.isSafePal), r.ethereum].find((n) => typeof n?.request == "function");
    if (!s) throw Error("No browser wallet detected. Choose WalletConnect or open this page in your wallet browser.");
    return await s.request({ method: "eth_requestAccounts" }), s;
  }
  po ??= n8.init({ projectId: "41040f658e4d4120399041c145b5e8b0", optionalChains: [97], showQrModal: !0, rpcMap: { 97: "https://bsc-testnet-rpc.publicnode.com" }, metadata: { name: "Global testnet migration", description: "Owner-approved testnet state copy and server reporter authorization", url: location.origin, icons: [new URL("/favicon.svg", location.origin).href] } }).catch((r) => {
    throw po = void 0, r;
  });
  const e = await po;
  return await e.enable(), e;
}
export {
  Nr as A,
  Ua as B,
  eE as C,
  kS as D,
  Na as E,
  li as F,
  zE as G,
  Bs as H,
  Cr as I,
  ea as J,
  Qv as K,
  nr as L,
  ci as M,
  gt as N,
  Ye as O,
  ml as P,
  zf as Q,
  ze as R,
  pt as S,
  Yd as T,
  Gf as U,
  Cu as V,
  Z8 as W,
  Pr as a,
  pd as b,
  v_ as c,
  __ as d,
  x_ as e,
  E_ as f,
  ru as g,
  sg as h,
  De as i,
  F as j,
  I_ as k,
  zt as l,
  Ep as m,
  kt as n,
  Mo as o,
  ks as p,
  i0 as q,
  Zw as r,
  $r as s,
  fe as t,
  hw as u,
  nE as v,
  je as w,
  Ra as x,
  Le as y,
  ot as z
};
