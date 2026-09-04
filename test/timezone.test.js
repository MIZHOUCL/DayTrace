import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTimeZone, systemTimeZone, utcOffsetLabel, dayRange, localDateOf } from '../src/time.js';

const ORIGINAL_TZ = process.env.TZ;
function restore() {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
}

test('不传时区时跟随本机，返回本机 IANA 名', () => {
  const tz = applyTimeZone(null);
  assert.equal(tz, systemTimeZone());
  assert.ok(tz === null || /^[A-Za-z]+\/[A-Za-z_+\-0-9]+$|^UTC$/.test(tz), `意外的时区名：${tz}`);
});

test('非法时区名立刻报错，不静默退回 UTC', () => {
  assert.throws(() => applyTimeZone('Mars/Olympus_Mons'), /无法识别的时区/);
  assert.throws(() => applyTimeZone('UTC+8'), /无法识别的时区/);
  restore();
});

test('指定时区后日界折算随之改变', () => {
  try {
    applyTimeZone('UTC');
    const utc = dayRange('2026-09-04', 4);
    assert.equal(utc.startUtc, '2026-09-04T04:00:00.000Z', 'UTC 下日界 4 点就是 04:00Z');
    assert.equal(utc.timeZone, 'UTC');

    applyTimeZone('Asia/Shanghai');
    const sh = dayRange('2026-09-04', 4);
    assert.equal(sh.startUtc, '2026-09-03T20:00:00.000Z', 'UTC+8 下日界 4 点是前一天 20:00Z');
    assert.equal(sh.timeZone, 'Asia/Shanghai');
    assert.equal(utcOffsetLabel(new Date('2026-09-04T00:00:00Z')), '+08:00');

    applyTimeZone('Asia/Tokyo');
    assert.equal(dayRange('2026-09-04', 4).startUtc, '2026-09-03T19:00:00.000Z', 'UTC+9');
  } finally {
    restore();
  }
});

test('归属日按生效时区判定：同一瞬间在不同时区可能属于不同天', () => {
  try {
    // 2026-09-03T20:30:00Z：上海是 09-04 04:30（过了日界，算 09-04）
    applyTimeZone('Asia/Shanghai');
    assert.equal(localDateOf('2026-09-03T20:30:00.000Z', 4), '2026-09-04');
    // 同一瞬间在 UTC 是 09-03 20:30（还没到 09-04 的日界，算 09-03）
    applyTimeZone('UTC');
    assert.equal(localDateOf('2026-09-03T20:30:00.000Z', 4), '2026-09-03');
  } finally {
    restore();
  }
});

test('夏令时切换日的区间长度不是 24 小时', () => {
  try {
    applyTimeZone('America/New_York');
    // 2026-03-08 是美国东部夏令时开始日，当天只有 23 小时
    const spring = dayRange('2026-03-08', 0);
    const hours = (Date.parse(spring.endUtc) - Date.parse(spring.startUtc)) / 3_600_000;
    assert.equal(hours, 23, `夏令时开始日应为 23 小时，实际 ${hours}`);
    // 2026-11-01 是结束日，25 小时
    const fall = dayRange('2026-11-01', 0);
    const fallHours = (Date.parse(fall.endUtc) - Date.parse(fall.startUtc)) / 3_600_000;
    assert.equal(fallHours, 25, `夏令时结束日应为 25 小时，实际 ${fallHours}`);
  } finally {
    restore();
  }
});
