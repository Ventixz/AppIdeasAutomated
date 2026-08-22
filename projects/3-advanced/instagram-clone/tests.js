// tests.js — dependency-free test suite for instagram-core.js.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const Core = require('./instagram-core.js');
const {
  validateUsername, validateEmail, validatePassword, validateImage,
  hashPassword, memoryStore, blankState, createApp,
} = Core;

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
// Assert that `fn` throws an Error whose `.code` is `code`.
function throwsCode(fn, code, msg) {
  try {
    fn();
    assert(false, `${msg} (expected throw ${code}, but nothing was thrown)`);
  } catch (e) {
    eq(e.code, code, msg);
  }
}

// A fresh app backed by an isolated in-memory store.
function freshApp() {
  return createApp(memoryStore(blankState()));
}

// Register + return a logged-in user. `n` seeds a unique, stamped joinedAt.
function signUp(app, username, n) {
  return app.register(
    { username, name: username.toUpperCase(), email: `${username}@ex.com`, password: 'secret1' },
    { at: n || 0 }
  );
}

// --- 1. Field validation --------------------------------------------------
console.log('1. Field validation');
eq(validateUsername('  Ada_01 '), 'ada_01', 'username is trimmed + lowercased');
throwsCode(() => validateUsername(''), 'EMPTY_USERNAME', 'empty username rejected');
throwsCode(() => validateUsername('ab'), 'USERNAME_TOO_SHORT', 'too-short username rejected');
throwsCode(() => validateUsername('a'.repeat(21)), 'USERNAME_TOO_LONG', 'too-long username rejected');
throwsCode(() => validateUsername('has space'), 'USERNAME_INVALID', 'spaces rejected');
throwsCode(() => validateUsername('bad<script>'), 'USERNAME_INVALID', 'markup chars rejected');
eq(validateEmail(' A@B.CO '), 'a@b.co', 'email normalized');
throwsCode(() => validateEmail('nope'), 'EMAIL_INVALID', 'bad email rejected');
throwsCode(() => validatePassword('12345'), 'PASSWORD_TOO_SHORT', 'short password rejected');
throwsCode(() => validateImage('   '), 'EMPTY_IMAGE', 'empty image rejected');
eq(validateImage('data:image/png;base64,AAA'), 'data:image/png;base64,AAA', 'image passes through');

// --- 2. Password hashing --------------------------------------------------
console.log('2. Password hashing');
assert(hashPassword('secret1', 'salt') === hashPassword('secret1', 'salt'), 'hash is deterministic');
assert(hashPassword('secret1', 'salt') !== hashPassword('secret1', 'other'), 'salt changes the hash');
assert(hashPassword('secret1', 'salt') !== 'secret1', 'hash is not the plaintext');

// --- 3. Registration + login ---------------------------------------------
console.log('3. Registration + login');
{
  const app = freshApp();
  const ada = signUp(app, 'ada', 1);
  eq(ada.username, 'ada', 'registered username');
  assert(!('passHash' in ada) && !('salt' in ada), 'public user hides secrets');
  eq(app.currentUser().username, 'ada', 'registering logs you in');

  throwsCode(() => signUp(app, 'ada', 2), 'USERNAME_TAKEN', 'duplicate username rejected');
  throwsCode(
    () => app.register({ username: 'ada2', name: 'A', email: 'ada@ex.com', password: 'secret1' }),
    'EMAIL_TAKEN', 'duplicate email rejected'
  );

  app.logout();
  eq(app.currentUser(), null, 'logout clears the session');
  throwsCode(() => app.login('ada', 'wrong!!'), 'BAD_PASSWORD', 'wrong password rejected');
  throwsCode(() => app.login('ghost', 'secret1'), 'NO_SUCH_USER', 'unknown user rejected');
  eq(app.login('ada', 'secret1').username, 'ada', 'login by username works');
  app.logout();
  eq(app.login('ADA@EX.COM', 'secret1').username, 'ada', 'login by email works');
}

// --- 4. Posting requires a session ---------------------------------------
console.log('4. Posting + ownership');
{
  const app = freshApp();
  app.logout();
  throwsCode(() => app.createPost({ image: 'data:x' }), 'NOT_LOGGED_IN', 'anonymous cannot post');

  signUp(app, 'ada', 1);
  const post = app.createPost({ image: 'data:img1', caption: 'hello world' }, { at: 10 });
  eq(post.author, 'ada', 'post records author');
  eq(post.caption, 'hello world', 'caption stored');
  eq(app.postsBy('ada').length, 1, 'post shows in author grid');

  signUp(app, 'bob', 2); // switches session to bob
  throwsCode(() => app.deletePost(post.id), 'NOT_OWNER', 'cannot delete another user\'s post');
  app.login('ada', 'secret1');
  app.deletePost(post.id);
  eq(app.postsBy('ada').length, 0, 'owner can delete own post');
}

// --- 5. Follow graph ------------------------------------------------------
console.log('5. Follow graph');
{
  const app = freshApp();
  signUp(app, 'ada', 1);
  signUp(app, 'bob', 2);
  signUp(app, 'cid', 3);
  app.login('ada', 'secret1');

  throwsCode(() => app.follow('ada'), 'CANNOT_FOLLOW_SELF', 'cannot follow yourself');
  throwsCode(() => app.follow('ghost'), 'NO_SUCH_USER', 'cannot follow a ghost');
  app.follow('bob');
  app.follow('bob'); // idempotent
  app.follow('cid');
  eq(app.currentUser().following.length, 2, 'following two, no duplicates');
  assert(app.isFollowing('bob'), 'isFollowing true after follow');
  eq(app.counts('bob').followers, 1, 'bob has one follower');

  app.unfollow('bob');
  assert(!app.isFollowing('bob'), 'isFollowing false after unfollow');
  eq(app.followersOf('cid').join(','), 'ada', 'followersOf derived from graph');
}

// --- 6. Home feed = followed + self, newest first ------------------------
console.log('6. Home feed');
{
  const app = freshApp();
  signUp(app, 'ada', 1);
  signUp(app, 'bob', 2);
  signUp(app, 'cid', 3);

  app.login('bob', 'secret1');
  app.createPost({ image: 'b1', caption: 'bob 1' }, { at: 10 });
  app.login('cid', 'secret1');
  app.createPost({ image: 'c1', caption: 'cid 1' }, { at: 20 });
  app.login('ada', 'secret1');
  app.createPost({ image: 'a1', caption: 'ada 1' }, { at: 30 });
  app.follow('bob'); // follows bob but NOT cid

  const feed = app.homeFeed();
  const authors = feed.map((p) => p.author);
  assert(authors.indexOf('cid') === -1, 'unfollowed user excluded from home feed');
  assert(authors.indexOf('bob') !== -1, 'followed user included');
  assert(authors.indexOf('ada') !== -1, 'own posts included in home feed');
  eq(feed[0].caption, 'ada 1', 'home feed is newest first');

  const global = app.globalFeed();
  eq(global.length, 3, 'global feed shows everyone');
  eq(global[0].author, 'ada', 'global feed newest first');
  assert(global.map((p) => p.author).indexOf('cid') !== -1, 'global feed includes unfollowed users');
}

// --- 7. Likes -------------------------------------------------------------
console.log('7. Likes');
{
  const app = freshApp();
  signUp(app, 'ada', 1);
  const p = app.createPost({ image: 'a1' }, { at: 10 });
  signUp(app, 'bob', 2);
  let r = app.toggleLike(p.id);
  eq(r.likes, 1, 'like increments count');
  assert(r.liked, 'toggle reports liked=true');
  r = app.toggleLike(p.id);
  eq(r.likes, 0, 'unlike decrements count');
  assert(!r.liked, 'toggle reports liked=false');
  throwsCode(() => app.toggleLike('nope'), 'NO_SUCH_POST', 'liking a missing post throws');

  app.toggleLike(p.id);
  const decorated = app.postsBy('ada')[0];
  eq(decorated.likeCount, 1, 'decorated post carries likeCount');
  assert(decorated.likedByMe, 'likedByMe reflects the current user');
}

// --- 8. Suggestions -------------------------------------------------------
console.log('8. Suggestions');
{
  const app = freshApp();
  signUp(app, 'ada', 1);
  signUp(app, 'bob', 2);
  app.createPost({ image: 'b1' }, { at: 10 });
  app.createPost({ image: 'b2' }, { at: 11 });
  signUp(app, 'cid', 3);
  app.createPost({ image: 'c1' }, { at: 12 });

  app.login('ada', 'secret1');
  const sug = app.suggestions();
  const names = sug.map((x) => x.user.username);
  assert(names.indexOf('ada') === -1, 'suggestions exclude yourself');
  eq(names[0], 'bob', 'busiest user suggested first');
  app.follow('bob');
  assert(app.suggestions().map((x) => x.user.username).indexOf('bob') === -1,
    'already-followed users drop out of suggestions');
}

// --- 9. Persistence across app instances ---------------------------------
console.log('9. Persistence through the store');
{
  const store = memoryStore(blankState());
  const app1 = createApp(store);
  signUp(app1, 'ada', 1);
  app1.createPost({ image: 'a1', caption: 'saved' }, { at: 10 });

  // A brand-new app over the SAME store sees the saved data (like a page reload
  // reading localStorage). The session persists too.
  const app2 = createApp(store);
  eq(app2.currentUser().username, 'ada', 'session survives a reload');
  eq(app2.postsBy('ada')[0].caption, 'saved', 'posts survive a reload');
}

// --- Summary --------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
