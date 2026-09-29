const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const files = [
  { duration: 6682566, file_info_key: 'part_1', chat: 'https://videoimg.sooplive.com/php/ChatLoadSplit.php?rowKey=part_1_c' },
  { duration: 3234634, file_info_key: 'part_2', chat: 'https://videoimg.sooplive.com/php/ChatLoadSplit.php?rowKey=part_2_c' },
  { duration: 11130233, file_info_key: 'part_3', chat: 'https://videoimg.sooplive.com/php/ChatLoadSplit.php?rowKey=part_3_c' }
];

function loadTimeHelpers(scriptPath, clockText, localTime, chatCoreKey, nativeChatUrl) {
  const source = fs.readFileSync(scriptPath, 'utf8');
  const entry = /  init\(\);\r?\n\}\)\(\);\s*$/;
  assert.match(source, entry);
  const instrumented = source.replace(entry,
    '  window.testHelpers = { state, getPlaybackTimeSec, getFilePlan };\n})();');
  const page = { oChatCore: { preChatItemFileInfoKey: chatCoreKey } };
  const context = {
    window: page,
    document: {
      querySelector(selector) {
        return selector.includes('time-current')
          ? clockText == null ? null : { textContent: clockText }
          : { currentTime: localTime };
      }
    },
    location: { href: 'https://vod.sooplive.com/player/208196001' },
    URL
  };
  vm.runInNewContext(instrumented, context, { filename: scriptPath });
  page.testHelpers.state.vodInfo = { data: { files, chat_duration: 300 } };
  page.testHelpers.state.nativeChatUrl = nativeChatUrl;
  return page.testHelpers;
}

for (const relativePath of ['prev-chat.js', 'firefox/prev-chat.js']) {
  const scriptPath = path.join(root, relativePath);

  test(`${relativePath}: the displayed VOD time selects the third part`, () => {
    const helpers = loadTimeHelpers(scriptPath, '4:50:51', 2 * 3600 + 5 * 60 + 34, '', null);
    const playbackSec = helpers.getPlaybackTimeSec();
    assert.equal(playbackSec, 17451);
    const plan = helpers.getFilePlan(playbackSec - 0.05, playbackSec);
    assert.equal(plan.tasks.length, 1);
    assert.equal(plan.tasks[0].chatUrl, files[2].chat);
    assert.equal(plan.tasks[0].relativeStartSec, 7500);
    assert.equal(plan.tasks[0].fileStartSec, 9917.2);
  });

  test(`${relativePath}: the active chat part supplies the offset when the clock is absent`, () => {
    const localTime = 17451 - 9917.2;
    const helpers = loadTimeHelpers(scriptPath, null, localTime, 'part_3', files[1].chat);
    assert.ok(Math.abs(helpers.getPlaybackTimeSec() - 17451) < 0.001);
  });
}
