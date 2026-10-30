import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMapsUrl, isShortMapsLink, isGoogleMapsUrl } from '../src/lib/maps-link.js';

test('place URL: !3d!4d 핀 좌표를 @중심 좌표보다 우선', () => {
  const r = parseMapsUrl('https://www.google.com/maps/place/%E7%89%9B%E3%81%8B%E3%81%A4+%E5%86%A8%E7%94%B0/@34.6670,135.5050,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d34.66683!4d135.50621!16s');
  assert.equal(r.precision, 'pin');
  assert.equal(r.lat, 34.66683);
  assert.equal(r.lng, 135.50621);
  assert.equal(r.name, '牛かつ 冨田');
});

test('@lat,lng 만 있으면 center', () => {
  const r = parseMapsUrl('https://www.google.com/maps/@37.5665,126.978,15z');
  assert.deepEqual([r.lat, r.lng, r.precision], [37.5665, 126.978, 'center']);
});

test('?q=lat,lng', () => {
  const r = parseMapsUrl('https://maps.google.com/?q=35.6895,139.6917');
  assert.deepEqual([r.lat, r.lng, r.precision], [35.6895, 139.6917, 'pin']);
});

test('?api=1&query=lat,lng (앱이 만드는 검색 링크)', () => {
  const r = parseMapsUrl('https://www.google.com/maps/search/?api=1&query=34.6698,135.5065');
  assert.deepEqual([r.lat, r.lng], [34.6698, 135.5065]);
});

test('?q=이름 주소 → 좌표 없이 검색어만', () => {
  const r = parseMapsUrl('https://maps.google.com/?q=Gyukatsu+Tomita,+Osaka&ftid=0x6000e70d:0x1');
  assert.equal(r.lat, null);
  assert.equal(r.precision, 'query');
  assert.equal(r.query, 'Gyukatsu Tomita, Osaka');
  assert.equal(r.name, 'Gyukatsu Tomita');
});

test('남반구/서반구 음수 좌표', () => {
  const r = parseMapsUrl('https://www.google.com/maps/place/Sydney/data=!3d-33.8688!4d151.2093');
  assert.deepEqual([r.lat, r.lng], [-33.8688, 151.2093]);
  const r2 = parseMapsUrl('https://www.google.com/maps/@40.7128,-74.006,12z');
  assert.deepEqual([r2.lat, r2.lng], [40.7128, -74.006]);
});

test('짧은 링크 판별', () => {
  assert.ok(isShortMapsLink('https://maps.app.goo.gl/adQEKaKGMTo81mA98'));
  assert.ok(isShortMapsLink('https://goo.gl/maps/abc'));
  assert.ok(!isShortMapsLink('https://www.google.com/maps/@1,2,3z'));
});

test('구글 맵 링크가 아닌 것은 거부', () => {
  assert.ok(isGoogleMapsUrl('https://www.google.co.jp/maps/place/x'));
  assert.ok(!isGoogleMapsUrl('https://evil.example.com/maps/@1,2'));
  assert.ok(!isGoogleMapsUrl('https://www.google.com/search?q=maps'));
  assert.ok(!isGoogleMapsUrl('not a url'));
});

test('잘못된 범위 좌표는 무시', () => {
  const r = parseMapsUrl('https://www.google.com/maps/@999,999,15z');
  assert.equal(r.lat, null);
});
