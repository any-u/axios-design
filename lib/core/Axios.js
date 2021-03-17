'use strict';

var utils = require('./../utils');
var buildURL = require('../helpers/buildURL');
var InterceptorManager = require('./InterceptorManager');
var dispatchRequest = require('./dispatchRequest');
var mergeConfig = require('./mergeConfig');

/**
 * Create a new instance of Axios
 *
 * @param {Object} instanceConfig The default config for the instance
 */
function Axios(instanceConfig) {
  this.defaults = instanceConfig;
  this.interceptors = {
    request: new InterceptorManager(),
    response: new InterceptorManager()
  };
}

/**
 * Dispatch a request
 *
 * @param {Object} config The config specific for this request (merged with this.defaults)
 */
Axios.prototype.request = function request(config) {
  /*eslint no-param-reassign:0*/
  // Allow for axios('example/url'[, config]) a la fetch API
  if (typeof config === 'string') {
    config = arguments[1] || {};
    config.url = arguments[0];
  } else {
    config = config || {};
  }

  config = mergeConfig(this.defaults, config);

  // Set config.method
  if (config.method) {
    config.method = config.method.toLowerCase();
  } else if (this.defaults.method) {
    config.method = this.defaults.method.toLowerCase();
  } else {
    config.method = 'get';
  }

  /**
   * 链式调用思路
   * 先得明白拦截器
   * 前置拦截器: 在请求前执行的拦截器，用户API --> axios.interceptors.request.use
   * |> 使用场景，比如请求header中添加token
   * 后置拦截器: 在请求后执行的拦截器，用户API --> axios.interceptors.response.use
   * |> 使用场景，比如请求后统一处理服务器结果
   * 
   * 比如设置前置拦截器 [beforeRequestResolve, beforRequestReject] 
   * |> beforeRequestResolve 前置拦截器正常响应函数
   * |> beforRequestReject 前置拦截器报错响应函数
   * |> beforeRequestResolve 和 beforRequestReject 类似于Promise中的resolve和reject函数
   * 后置拦截器 [afterRequestResolve, afterRequestReject]
   * 
   * 用户请求的函数会被处理成 [requestResolve, requestReject]
   * 
   * 调用链即会被转成[beforeRequestResolve, beforRequestReject, requestResolve, requestReject, afterRequestResolve, afterRequestReject]
   * 用while判断调用链的长度，每次取2个值，一个做resolve， 一个做reject
   * 放到Promise.then中，传入这个resolve,reject，然后利用Promise.then的链式调用来依次处理前置拦截器 -> 用户请求函数 -> 后置拦截器，
   * 执行完后置拦截器后，返回最后结果，这样用户请求函数得到的值就是经过了前置拦截器 -> 用户请求函数 -> 后置拦截器三个阶段的值
   * 
   */

  // 前置拦截器链式数组
  var requestInterceptorChain = [];

  // 拦截器是否同步请求，默认设为true
  var synchronousRequestInterceptors = true;

  // 前置拦截器过滤需要跳过的拦截器
  this.interceptors.request.forEach(function unshiftRequestInterceptors(interceptor) {

    // axios的API runWhen -> 拦截器执行条件
    // |> runWhen是函数，且interceptor.runWhen(config)结果为false ，则提够哦
    if (typeof interceptor.runWhen === 'function' && interceptor.runWhen(config) === false) {
      return;
    }

    // 设置拦截器是否同步请求，获取拦截器配置中的synchronous
    // |> synchronous -> 新API，可查看文档
    synchronousRequestInterceptors = synchronousRequestInterceptors && interceptor.synchronous;

    // 前置拦截器函数添加拦截器的resolve和reject函数
    // |> requestInterceptorChain 用于保存前置拦截器,类似于上面的[beforeRequestResolve, beforRequestReject] 
    // |> 这里用来requestInterceptorChain和responseInterceptorChain分别保存前置拦截器和后置拦截器
    // |> 为啥不适用一个数组，老版本axios是一个数组，新版本新增了synchronousRequestInterceptors这个功能，所以用了这种方式
    requestInterceptorChain.unshift(interceptor.fulfilled, interceptor.rejected);
  });

  // 后置拦截器同理
  var responseInterceptorChain = [];
  this.interceptors.response.forEach(function pushResponseInterceptors(interceptor) {
    responseInterceptorChain.push(interceptor.fulfilled, interceptor.rejected);
  });

  var promise;

  if (!synchronousRequestInterceptors) {
    var chain = [dispatchRequest, undefined];

    Array.prototype.unshift.apply(chain, requestInterceptorChain);
    chain.concat(responseInterceptorChain);

    promise = Promise.resolve(config);
    while (chain.length) {
      promise = promise.then(chain.shift(), chain.shift());
    }

    return promise;
  }


  var newConfig = config;
  while (requestInterceptorChain.length) {
    var onFulfilled = requestInterceptorChain.shift();
    var onRejected = requestInterceptorChain.shift();
    try {
      newConfig = onFulfilled(newConfig);
    } catch (error) {
      onRejected(error);
      break;
    }
  }

  try {
    promise = dispatchRequest(newConfig);
  } catch (error) {
    return Promise.reject(error);
  }

  while (responseInterceptorChain.length) {
    promise = promise.then(responseInterceptorChain.shift(), responseInterceptorChain.shift());
  }

  return promise;
};

Axios.prototype.getUri = function getUri(config) {
  config = mergeConfig(this.defaults, config);
  return buildURL(config.url, config.params, config.paramsSerializer).replace(/^\?/, '');
};

// Provide aliases for supported request methods
utils.forEach(['delete', 'get', 'head', 'options'], function forEachMethodNoData(method) {
  /*eslint func-names:0*/
  Axios.prototype[method] = function(url, config) {
    return this.request(mergeConfig(config || {}, {
      method: method,
      url: url,
      data: (config || {}).data
    }));
  };
});

utils.forEach(['post', 'put', 'patch'], function forEachMethodWithData(method) {
  /*eslint func-names:0*/
  Axios.prototype[method] = function(url, data, config) {
    return this.request(mergeConfig(config || {}, {
      method: method,
      url: url,
      data: data
    }));
  };
});

module.exports = Axios;
