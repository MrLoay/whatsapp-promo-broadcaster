const fs = require('fs');
const path = require('path');

const utilsPath = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js');

if (!fs.existsSync(utilsPath)) {
  console.log('[patch-wwebjs] whatsapp-web.js Utils.js not found, skipping patch.');
  process.exit(0);
}

let content = fs.readFileSync(utilsPath, 'utf8');
let modified = false;

// 1. Ensure __x_id is deleted from message and message.id is preserved
if (!content.includes('delete message.__x_id;')) {
  const target = 'const message = {\n            ...options,';
  const replacement = `const message = {\n            ...options,`;
  // Look for end of message object definition
  const extraOptTarget = '...extraOptions,\n        };';
  if (content.includes(extraOptTarget)) {
    content = content.replace(extraOptTarget, `${extraOptTarget}\n\n        delete message.__x_id;\n        if (!message.id) {\n            message.id = newMsgKey;\n        }`);
    modified = true;
    console.log('[patch-wwebjs] Applied delete message.__x_id patch.');
  }
} else if (!content.includes('if (!message.id) {')) {
  content = content.replace('delete message.__x_id;', 'delete message.__x_id;\n        if (!message.id) {\n            message.id = newMsgKey;\n        }');
  modified = true;
  console.log('[patch-wwebjs] Added message.id safeguard.');
}

// 2. Ensure processMediaData strips __x_id from mediaData
if (!content.includes('delete mediaData.__x_id;')) {
  const returnTarget = 'return mediaData;\n    };';
  if (content.includes(returnTarget)) {
    content = content.replace(returnTarget, `try { delete mediaData.__x_id; } catch (e) {}\n        return mediaData;\n    };`);
    modified = true;
    console.log('[patch-wwebjs] Applied processMediaData __x_id strip patch.');
  }
}

if (modified) {
  fs.writeFileSync(utilsPath, content, 'utf8');
  console.log('[patch-wwebjs] Successfully patched whatsapp-web.js Utils.js');
} else {
  console.log('[patch-wwebjs] whatsapp-web.js Utils.js already up to date.');
}
