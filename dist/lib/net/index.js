'use strict';var _exportNames={createSocketListener:!0,createSocketSpeaker:!0,createSocketSpeakerReconnect:!0};Object.defineProperty(exports,"__esModule",{value:!0});exports.createSocketListener=createSocketListener,exports.createSocketSpeaker=createSocketSpeaker,exports.createSocketSpeakerReconnect=createSocketSpeakerReconnect;var _socketListener=_interopRequireDefault(require("./socketListener")),_socketSpeaker=_interopRequireDefault(require("./socketSpeaker")),_socketSpeakerReconnect=_interopRequireDefault(require("./socketSpeakerReconnect")),_networkBase=require("./networkBase");Object.keys(_networkBase).forEach(function(a){"default"===a||"__esModule"===a||Object.prototype.hasOwnProperty.call(_exportNames,a)||a in exports&&exports[a]===_networkBase[a]||Object.defineProperty(exports,a,{enumerable:!0,get:function get(){return _networkBase[a]}})});function _interopRequireDefault(a){return a&&a.__esModule?a:{default:a}}function createSocketListener(a){return new _socketListener["default"](a)}function createSocketSpeaker(){for(var a=arguments.length,b=Array(a),c=0;c<a;c++)b[c]=arguments[c];var d=1<=b.length?[].slice.call(b,0):[];return new _socketSpeaker["default"](d)}function createSocketSpeakerReconnect(){for(var a=arguments.length,b=Array(a),c=0;c<a;c++)b[c]=arguments[c];var d=1<=b.length?[].slice.call(b,0):[];return new _socketSpeakerReconnect["default"](d)}