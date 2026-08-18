// tests.js — dependency-free test suite for chat-core.js.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const C = require('./chat-core.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}
function eq(a, b, msg) {
  assert(a === b, `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}
function deepEq(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}
function throwsCode(fn, code, msg) {
  let got = null;
  try { fn(); } catch (e) { got = e.code || e.message; }
  eq(got, code, msg);
}

// --- Username validation --------------------------------------------------

eq(C.validateUsername('  John   Doe '), 'John Doe', 'username is trimmed and space-collapsed');
eq(C.validateUsername('a_b.c-1'), 'a_b.c-1', 'allowed punctuation kept');
throwsCode(() => C.validateUsername('   '), 'EMPTY_USERNAME', 'blank username rejected');
throwsCode(() => C.validateUsername(''), 'EMPTY_USERNAME', 'empty username rejected');
throwsCode(() => C.validateUsername('x'.repeat(25)), 'USERNAME_TOO_LONG', 'over-long username rejected');
eq(C.validateUsername('x'.repeat(24)), 'x'.repeat(24), 'exactly max length accepted');
throwsCode(() => C.validateUsername('bad<name>'), 'USERNAME_INVALID', 'angle brackets rejected');
throwsCode(() => C.validateUsername('emoji😀'), 'USERNAME_INVALID', 'non-ascii rejected');

// --- Channel normalization ------------------------------------------------

eq(C.normalizeChannel('  General Chat! '), 'general-chat', 'channel slugified');
eq(C.normalizeChannel('C++ Devs'), 'c-devs', 'symbols collapse to a single dash');
eq(C.normalizeChannel('---trim---'), 'trim', 'leading/trailing dashes trimmed');
eq(C.normalizeChannel('!!!'), '', 'all-symbol channel becomes empty');
throwsCode(() => C.validateChannel('!!!'), 'EMPTY_CHANNEL', 'empty channel rejected');
eq(C.validateChannel('Random Talk'), 'random-talk', 'valid channel returns slug');

// --- dmKey symmetry -------------------------------------------------------

eq(C.dmKey('Alice', 'Bob'), C.dmKey('Bob', 'Alice'), 'dmKey is order-independent');
eq(C.dmKey('Alice', 'Bob'), C.dmKey('alice', 'BOB'), 'dmKey is case-insensitive');
assert(C.dmKey('Alice', 'Bob') !== C.dmKey('Alice', 'Carol'), 'different pairs get different keys');

// --- Emoji shortcodes -----------------------------------------------------

eq(C.applyEmoji('hi :smile:'), 'hi 😄', 'known shortcode replaced');
eq(C.applyEmoji(':fire: :rocket:'), '🔥 🚀', 'multiple shortcodes replaced');
eq(C.applyEmoji(':nope:'), ':nope:', 'unknown shortcode left intact');
eq(C.applyEmoji('ratio 3:5 done'), 'ratio 3:5 done', 'non-shortcode colons untouched');
eq(C.applyEmoji(':100:'), '💯', 'numeric shortcode works');
eq(C.applyEmoji(''), '', 'empty string stays empty');

// --- Rich content parsing -------------------------------------------------

assert(C.isImageUrl('http://x/pic.PNG'), 'image extension detected case-insensitively');
assert(C.isImageUrl('http://x/a.jpg?v=2'), 'image with query string detected');
assert(!C.isImageUrl('http://x/page.html'), 'non-image url not treated as image');

deepEq(C.parseTokens('plain text'), [{ type: 'text', value: 'plain text' }], 'plain text is one text token');

deepEq(
  C.parseTokens('see http://a.com/page and http://a.com/p.png'),
  [
    { type: 'text', value: 'see ' },
    { type: 'link', value: 'http://a.com/page' },
    { type: 'text', value: ' and ' },
    { type: 'image', value: 'http://a.com/p.png' },
  ],
  'links and images split out, images tagged'
);

deepEq(
  C.parseTokens('hey @john and @Mary-Jane!'),
  [
    { type: 'text', value: 'hey ' },
    { type: 'mention', value: '@john', name: 'john' },
    { type: 'text', value: ' and ' },
    { type: 'mention', value: '@Mary-Jane', name: 'Mary-Jane' },
    { type: 'text', value: '!' },
  ],
  'mentions parsed out of text'
);

deepEq(
  C.parseTokens('love it :heart:'),
  [{ type: 'text', value: 'love it ❤️' }],
  'emoji expanded before tokenizing'
);

// A URL containing an @ stays a single link, not a mention.
deepEq(
  C.parseTokens('http://a.com/@handle'),
  [{ type: 'link', value: 'http://a.com/@handle' }],
  '@ inside a url does not become a mention'
);

assert(C.mentionMatches('john', 'John Doe'), 'mention matches first name part');
assert(C.mentionMatches('JOHN', 'john'), 'mention match is case-insensitive');
assert(!C.mentionMatches('joh', 'John Doe'), 'partial mention does not match');
assert(!C.mentionMatches('', 'John'), 'empty mention never matches');

// --- Command parsing ------------------------------------------------------

deepEq(C.parseCommand('   '), { type: 'empty' }, 'blank line is empty intent');
deepEq(C.parseCommand('hello world'), { type: 'chat', text: 'hello world' }, 'plain text is chat');
deepEq(C.parseCommand('  spaced   out  '), { type: 'chat', text: 'spaced out' }, 'chat text is space-collapsed');
deepEq(C.parseCommand('/help'), { type: 'help' }, '/help parsed');
deepEq(C.parseCommand('/nick New Name'), { type: 'nick', name: 'New Name' }, '/nick parsed and validated');
eq(C.parseCommand('/nick <bad>').type, 'error', '/nick with bad name is an error intent');
eq(C.parseCommand('/nick <bad>').code, 'USERNAME_INVALID', '/nick error carries the code');
deepEq(C.parseCommand('/join Random Room'), { type: 'join', channel: 'random-room' }, '/join slugifies channel');
deepEq(C.parseCommand('/me waves'), { type: 'me', text: 'waves' }, '/me parsed');
eq(C.parseCommand('/me').code, 'ME_NO_TEXT', '/me with no text errors');
deepEq(C.parseCommand('/msg Bob hi there'), { type: 'msg', to: 'Bob', text: 'hi there' }, '/msg parsed');
deepEq(C.parseCommand('/msg "Bob Smith" hello'), { type: 'msg', to: 'Bob Smith', text: 'hello' }, '/msg quoted name');
eq(C.parseCommand('/msg Bob').code, 'MSG_NO_TEXT', '/msg without body errors');
eq(C.parseCommand('/msg').code, 'MSG_NO_USER', '/msg without user errors');
eq(C.parseCommand('/bogus x').code, 'UNKNOWN_COMMAND', 'unknown command errors');
// A message that only *starts* with text similar to a command is still chat.
deepEq(C.parseCommand('help me please'), { type: 'chat', text: 'help me please' }, 'no leading slash means chat');

// --- splitRecipient edge cases -------------------------------------------

deepEq(C.splitRecipient('Bob hello world'), { to: 'Bob', text: 'hello world' }, 'recipient split from body');
deepEq(C.splitRecipient('Bob'), { to: 'Bob', text: '' }, 'recipient with no body');
deepEq(C.splitRecipient('"Bob Smith" hi'), { to: 'Bob Smith', text: 'hi' }, 'quoted recipient');
deepEq(C.splitRecipient(''), { to: '', text: '' }, 'empty rest');

// --- Message builders & formatLine ---------------------------------------

const chat = C.chatMessage({ user: '  John  ', channel: 'General', text: '  Hello World!  ', now: 1000, id: 'm-1' });
eq(chat.kind, 'chat', 'chatMessage kind');
eq(chat.user, 'John', 'chatMessage trims user');
eq(chat.channel, 'general', 'chatMessage normalizes channel');
eq(chat.text, 'Hello World!', 'chatMessage trims text');
eq(chat.ts, 1000, 'chatMessage keeps injected timestamp');
eq(C.formatLine(chat), 'John: Hello World!', 'formatLine renders Username: Message');
assert(Object.isFrozen(chat), 'built messages are immutable');

const dm = C.privateMessage({ user: 'Alice', to: 'Bob', text: 'secret', now: 2000, id: 'm-2' });
eq(dm.kind, 'private', 'privateMessage kind');
eq(dm.channel, C.dmKey('Alice', 'Bob'), 'privateMessage files under dmKey');
eq(dm.to, 'Bob', 'privateMessage keeps recipient');

const sys = C.systemMessage({ channel: 'general', text: 'Alice joined', now: 3000, id: 'm-3' });
eq(sys.kind, 'system', 'systemMessage kind');
eq(sys.user, '', 'systemMessage has no author');
eq(C.formatLine(sys), 'Alice joined', 'system line renders as bare text');

// --- Conversation helpers -------------------------------------------------

const history = [
  C.chatMessage({ user: 'Alice', channel: 'general', text: 'first', now: 10, id: 'm-b' }),
  C.chatMessage({ user: 'Bob', channel: 'general', text: 'second', now: 10, id: 'm-a' }),
  C.chatMessage({ user: 'Alice', channel: 'random', text: 'elsewhere', now: 5, id: 'm-c' }),
  C.privateMessage({ user: 'Alice', to: 'Bob', text: 'hi', now: 20, id: 'm-d' }),
  C.privateMessage({ user: 'Bob', to: 'Alice', text: 'yo', now: 30, id: 'm-e' }),
];

const inGeneral = C.messagesFor(history, 'general');
eq(inGeneral.length, 2, 'messagesFor filters by channel');
// Equal timestamps tie-break on id ('m-a' before 'm-b').
deepEq(inGeneral.map((m) => m.id), ['m-a', 'm-b'], 'messagesFor sorts by ts then id');

const threads = C.dmThreadsFor(history, 'Alice');
eq(threads.length, 1, 'both private messages collapse into one thread');
eq(threads[0].other, 'Bob', 'thread names the other participant');
eq(threads[0].ts, 30, 'thread carries newest activity time');

deepEq(C.channelsInUse(history), ['general', 'random'], 'channelsInUse lists chat channels, skipping DMs');

// --- Done -----------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
