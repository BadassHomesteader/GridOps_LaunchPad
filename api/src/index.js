// Entry point — registers all Azure Functions v4 handlers

if (typeof globalThis.crypto === 'undefined') {
    globalThis.crypto = require('crypto');
}

require('./functions/me');
require('./functions/collections');
require('./functions/personal');
require('./functions/users');
require('./functions/feedback');
require('./functions/announcements');
